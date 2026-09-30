/**
 * wOS Core's HTTP API: the environment descriptor, `CoreRoutes`, local sign-in on a self-hosted Core, and every
 * bundled app's routes mounted under its `/apps/<id>` prefix with the permissions its manifest declares.
 */
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  ActiveApps,
  type ApiErrorCode,
  CONTRACTS_VERSION,
  CoreRoutes,
  EnvironmentDescriptor,
  MobileScreen,
} from "../../../modules/core-contracts/src/index.js";
import { type ActiveApp, cloudActiveApps, selfHostedActiveApps } from "../../../modules/core/src/active-apps.js";
import type { Principal } from "../../../modules/core/src/app-module.js";
import type { Bundle } from "../../../modules/core/src/bundle.js";
import { checkEnvironmentToken, EnvironmentKeyCache, type Fetch } from "../../../modules/core/src/env-token.js";
import { roleHas } from "../../../modules/core/src/permissions.js";
import { type CoreConfig, emailAllowed } from "./config.js";
import type { Mailer } from "./mail.js";
import type { CoreStore, Role } from "./store.js";

export const SIGNIN_TTL_SECONDS = 15 * 60;
export const SIGNIN_PER_EMAIL_PER_HOUR = 5;
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type CoreDeps = {
  config: CoreConfig;
  bundle: Bundle;
  /** Required on a self-hosted Core; unused on wOS Cloud (it keeps no accounts). */
  store: CoreStore | null;
  mailer: Mailer | null;
  /** Used ONLY in cloud mode, to read the control plane's environment keys. */
  fetch: Fetch;
  now: () => Date;
  log: (msg: string, fields?: Record<string, unknown>) => void;
};

type Auth = { principal: Principal; active: ActiveApp[] };

const errorBody = (code: ApiErrorCode, message: string) => ({ error: { code, message, requestId: randomUUID() } });
const STATUS: Partial<Record<ApiErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};
const fail = (c: Context, code: ApiErrorCode, message: string) => c.json(errorBody(code, message), (STATUS[code] ?? 400) as 400);

export function signinCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

export function createCoreApp(deps: CoreDeps): Hono {
  const { config, bundle } = deps;
  const hash = (...parts: string[]) =>
    createHash("sha256")
      .update([config.secret, ...parts].join("\0"))
      .digest("hex");
  const nowSeconds = () => Math.floor(deps.now().getTime() / 1000);
  const keys = config.mode === "cloud" ? new EnvironmentKeyCache(config.controlPlaneUrl!, deps.fetch, nowSeconds) : null;
  if (config.mode === "self_hosted" && (!deps.store || !deps.mailer)) throw new Error("a self-hosted Core needs a store and a mailer");
  const selfActive = config.mode === "self_hosted" ? selfHostedActiveApps(bundle, config.apps) : [];

  let environmentId: string | null = config.environmentId;
  const envId = async () => {
    environmentId ??= (await deps.store!.environment(config.environmentName)).id;
    return environmentId;
  };

  async function authenticate(c: Context): Promise<Auth | null> {
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const token = header.slice(7).trim();
    if (config.mode === "cloud") {
      const r = await checkEnvironmentToken(token, keys!, await envId(), nowSeconds());
      if (!r.ok) {
        deps.log("environment token refused", { reason: r.reason });
        return null;
      }
      const { claims } = r;
      return {
        principal: { kind: "environment_token", userId: claims.sub, organizationId: claims.org, role: claims.role },
        active: cloudActiveApps(bundle, claims.apps),
      };
    }
    const s = await deps.store!.getSession(hash("session", token), deps.now());
    if (!s) return null;
    return { principal: { kind: "local_session", userId: s.userId, organizationId: s.organizationId, role: s.role }, active: selfActive };
  }

  const app = new Hono();

  app.get(CoreRoutes.environment.path, async (c) => {
    const descriptor = EnvironmentDescriptor.parse({
      schema: "wos-environment.v1",
      environmentId: await envId(),
      name: config.environmentName,
      kind: config.mode === "cloud" ? "cloud" : "self_hosted",
      protocol: "wos-app/v1",
      coreVersion: bundle.coreVersion,
      apiBase: config.publicUrl,
      auth: config.mode === "cloud" ? { kind: "wos_cloud", issuer: config.controlPlaneUrl } : { kind: "local" },
    });
    c.header("cache-control", "public, max-age=60");
    return c.json(descriptor);
  });

  app.get("/v1/core/health", (c) =>
    c.json({ ok: true, coreVersion: bundle.coreVersion, contractsVersion: CONTRACTS_VERSION, mode: config.mode }),
  );

  app.get(CoreRoutes.activeApps.path, async (c) => {
    const auth = await authenticate(c);
    if (!auth) return fail(c, "UNAUTHENTICATED", "sign in to this environment");
    c.header("cache-control", "no-store");
    return c.json(ActiveApps.parse({ environmentId: await envId(), organizationId: auth.principal.organizationId, apps: auth.active }));
  });

  app.get(CoreRoutes.screens.path, async (c) => {
    const auth = await authenticate(c);
    if (!auth) return fail(c, "UNAUTHENTICATED", "sign in to this environment");
    const active = auth.active.find((a) => a.id === c.req.param("app"));
    if (!active) return fail(c, "NOT_FOUND", "that app is not active here");
    const screens = bundle.apps.get(active.id)!.screens.filter((s) => roleHas(active.manifest, auth.principal.role, s.permission));
    return c.json(
      CoreRoutes.screens.response.parse({ app: active.id, version: active.version, screens: z.array(MobileScreen).parse(screens) }),
    );
  });

  // ---- logout (CoreRoutes.logout, contracts 5.6.0): ends a local session; with an environment token a no-op.
  app.post(CoreRoutes.logout.path, async (c) => {
    const auth = await authenticate(c);
    if (!auth) return fail(c, "UNAUTHENTICATED", "sign in to this environment");
    if (auth.principal.kind === "local_session") {
      const token = (c.req.header("authorization") ?? "").slice(7).trim();
      await deps.store!.deleteSession(hash("session", token));
    }
    c.header("cache-control", "no-store");
    return c.json(CoreRoutes.logout.response.parse({ ok: true }));
  });

  // ---- local sign-in (CoreRoutes.localSignInStart / localSignInRedeem): self-hosted only; wOS Cloud answers 404.
  if (config.mode === "self_hosted") {
    const store = deps.store!;
    app.post(CoreRoutes.localSignInStart.path, async (c) => {
      const body = CoreRoutes.localSignInStart.body.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return fail(c, "VALIDATION_FAILED", "send { email }");
      const email = body.data.email.trim().toLowerCase();
      const now = deps.now();
      const requestId = randomUUID();
      const expiresAt = new Date(now.getTime() + SIGNIN_TTL_SECONDS * 1000);
      // Same answer whether or not the address may sign in (no enumeration); only allowed addresses get a code.
      if (emailAllowed(config, email)) {
        if ((await store.signinRequestsSince(email, new Date(now.getTime() - 3600_000))) >= SIGNIN_PER_EMAIL_PER_HOUR)
          return fail(c, "RATE_LIMITED", "too many sign-in requests; try again later");
        const code = signinCode();
        await store.createSigninRequest({ id: requestId, email, codeHash: hash("signin", requestId, code), expiresAt });
        try {
          await deps.mailer!.sendSigninCode({ to: email, code, requestId, expiresAt, environmentName: config.environmentName });
        } catch (err) {
          // Same 202 either way (no enumeration); the operator sees the failure, never the code.
          deps.log("sign-in email failed", { requestId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return c.json(CoreRoutes.localSignInStart.response.parse({ requestId, expiresAt: expiresAt.toISOString() }), 202);
    });

    app.post(CoreRoutes.localSignInRedeem.path, async (c) => {
      const body = CoreRoutes.localSignInRedeem.body.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return fail(c, "VALIDATION_FAILED", "send { requestId, code } with the code as XXXX-XXXX");
      const now = deps.now();
      const r = await store.redeemSignin(body.data.requestId, hash("signin", body.data.requestId, body.data.code), now);
      if (!r.ok) return fail(c, "UNAUTHENTICATED", "that code is not valid (it may be used, expired or mistyped)");
      const org = await store.organization(config.organizationName);
      const roleIfNew = (members: number): Role =>
        r.email === config.ownerEmail || (members === 0 && !config.ownerEmail) ? "owner" : "member";
      const m = await store.ensureMember(org.id, r.email, roleIfNew);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
      await store.createSession({ tokenHash: hash("session", token), userId: m.userId, organizationId: org.id, expiresAt });
      c.header("cache-control", "no-store");
      return c.json(
        CoreRoutes.localSignInRedeem.response.parse({
          token,
          expiresAt: expiresAt.toISOString(),
          userId: m.userId,
          organizationId: org.id,
          role: m.role,
        }),
      );
    });
  }

  // ---- /apps/<id>/**: each bundled app's routes, gated by activation and the declared permission
  for (const bundled of bundle.apps.values()) {
    const { manifest, server } = bundled;
    if (!server || manifest.routes.api === null) continue;
    for (const route of server.routes) {
      app.on(route.method, `${manifest.routes.api}${route.path}`, async (c) => {
        const auth = await authenticate(c);
        if (!auth) return fail(c, "UNAUTHENTICATED", "sign in to this environment");
        const active = auth.active.find((a) => a.id === manifest.app.id);
        if (!active) return fail(c, "NOT_FOUND", `${manifest.app.name} is not active for this organization`);
        if (!roleHas(manifest, auth.principal.role, route.permission)) return fail(c, "FORBIDDEN", `needs ${route.permission}`);
        let body: unknown = null;
        if (route.method !== "GET" && route.method !== "DELETE") {
          body = await c.req.json().catch(() => undefined);
          if (body === undefined) return fail(c, "VALIDATION_FAILED", "the body must be JSON");
        }
        const out = await route.handler({
          principal: auth.principal,
          manifest,
          params: c.req.param() as Record<string, string>,
          query: new URL(c.req.url).searchParams,
          body,
        });
        c.header("cache-control", "no-store");
        if (out.status === 204) return c.body(null, 204);
        return c.json(out.body as object, (out.status ?? 200) as 200);
      });
    }
  }

  app.notFound((c) => fail(c, "NOT_FOUND", "no such route"));
  app.onError((err, c) => {
    deps.log("unhandled error", { error: err.message });
    return fail(c, "INTERNAL", "internal error");
  });
  return app;
}

/**
 * A test double of the control plane's AppRoutes (the real one is the control-plane workstream's): accounts sign in
 * with a code, one personal organization, the registry built from the bundled manifests, EntitlementMachine-shaped
 * enable/disable and environment tokens signed with a throwaway key. Only for tests; no user ever sees it.
 */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import {
  activeAppIds,
  AppRoutes,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  Routes,
  signEnvironmentToken,
  WOS_CLOUD_ENVIRONMENT_ID,
} from "../../../modules/core-contracts/src/index.js";
import { loadBundle } from "../../../modules/core/src/bundle.js";
import type { Clock, TestKey } from "../../api/test/support.js";

export const CODE = "ABCD-EFGH";

export function fakeControlPlane(key: TestKey, clock: Clock, issuer: string) {
  const bundle = loadBundle(BUNDLED_APPS);
  const org = {
    id: "0192f000-0000-7000-8000-00000000a001",
    slug: "sam",
    name: "Sam",
    kind: "personal" as const,
    createdAt: "2026-09-01T00:00:00.000Z",
    role: "owner" as const,
  };
  const account = "0192f000-0000-7000-8000-00000000b001";
  const entitlements = new Map<string, { state: "enabled" | "disabled"; rowVersion: number; changedAt: string }>();
  const sessions = new Set<string>();
  const app = new Hono();
  const iso = () => clock.now.toISOString();

  const entry = (id: string) => {
    const m = bundle.apps.get(id)!.manifest;
    const av = (s: boolean) => ({ available: s, version: s ? m.app.version : null });
    return {
      id,
      name: m.app.name,
      kind: m.app.kind,
      billing: m.app.billing,
      summary: m.app.summary,
      currentVersion: m.app.version,
      protocol: m.protocol,
      capabilities: m.provides,
      dependencies: m.requires.apps,
      features: m.features,
      replaces: m.replaces,
      surfaces: {
        web: av(m.surfaces.web.supported),
        desktop: { ...av(m.surfaces.desktop.supported), package: null },
        ios: av(m.surfaces.ios.supported),
        android: av(m.surfaces.android.supported),
        api: av(m.surfaces.api.supported),
      },
      selfHost: { compatible: m.hosting.selfHost.supported },
      hosted: { compatible: m.hosting.hosted.supported },
      publishedAt: "2026-09-30T00:00:00.000Z",
    };
  };
  const view = (id: string) => {
    const e = entitlements.get(id);
    return {
      app: entry(id),
      entitlement: {
        organizationId: org.id,
        app: id,
        state: e?.state ?? "available",
        changedAt: e?.changedAt ?? null,
        rowVersion: e?.rowVersion ?? 0,
      },
    };
  };
  const enabled = () => [...entitlements].filter(([, e]) => e.state === "enabled").map(([id]) => id);
  const authed = (h: string | undefined) => h?.startsWith("Bearer ") && sessions.has(h.slice(7));

  app.get(AppRoutes.getEnvironmentKeys.path, (c) => c.json({ keys: [{ kid: key.kid, alg: "EdDSA", publicKey: key.publicKey }] }));
  app.post(Routes.startEmailSignIn.path, (c) => {
    setCookie(c, "wos_signin", "poll-secret", { httpOnly: true, path: "/v1/auth" });
    return c.json({ requestId: randomUUID(), pollSecret: null, expiresAt: iso() }, 202);
  });
  app.post(Routes.redeemEmailSignIn.path, async (c) => {
    const b = (await c.req.json()) as { code: string; pollSecret: string };
    if (b.code !== CODE || b.pollSecret !== "poll-secret")
      return c.json({ error: { code: "UNAUTHENTICATED", message: "no", requestId: "x" } }, 401);
    const access = randomUUID();
    sessions.add(access);
    setCookie(c, "wos_session", access, { httpOnly: true });
    setCookie(c, "wos_refresh", `r-${access}`, { httpOnly: true, path: "/v1/auth" });
    const exp = new Date(clock.now.getTime() + 3600_000).toISOString();
    return c.json({
      accessToken: "",
      accessExpiresAt: exp,
      refreshToken: "",
      refreshExpiresAt: exp,
      deviceId: null,
      created: true,
      me: {},
    });
  });
  app.post(Routes.logout.path, (c) => c.json({ ok: true }));
  app.get(AppRoutes.listMyOrganizations.path, (c) => (authed(c.req.header("authorization")) ? c.json({ items: [org] }) : c.json({}, 401)));
  app.get(AppRoutes.listOrgApps.path, (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({}, 401);
    const active = new Set(activeAppIds(bundle.registry, enabled()));
    const listed = [...bundle.apps.keys()].filter((id) => id !== "core"); // core has no published release yet (12.4)
    return c.json({
      organizationId: org.id,
      yourApps: listed.filter((id) => active.has(id)).map(view),
      availableApps: listed.filter((id) => !active.has(id) && bundle.apps.get(id)!.manifest.app.kind === "app").map(view),
    });
  });
  for (const action of ["enable", "disable"] as const) {
    const route = action === "enable" ? AppRoutes.enableApp : AppRoutes.disableApp;
    app.post(route.path, async (c) => {
      if (!authed(c.req.header("authorization"))) return c.json({}, 401);
      const id = c.req.param("app")!;
      const { expectedRowVersion } = (await c.req.json()) as { expectedRowVersion: number | null };
      const cur = entitlements.get(id);
      if ((cur?.rowVersion ?? null) !== expectedRowVersion)
        return c.json({ error: { code: "CONFLICT", message: "stale", requestId: "x" } }, 409);
      entitlements.set(id, {
        state: action === "enable" ? "enabled" : "disabled",
        rowVersion: (cur?.rowVersion ?? 0) + 1,
        changedAt: iso(),
      });
      return c.json(view(id));
    });
  }
  app.post(AppRoutes.issueEnvironmentToken.path, async (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({}, 401);
    const iat = Math.floor(clock.now.getTime() / 1000);
    const claims = {
      iss: issuer,
      aud: WOS_CLOUD_ENVIRONMENT_ID,
      sub: account,
      org: org.id,
      role: org.role,
      apps: activeAppIds(bundle.registry, enabled()),
      iat,
      exp: iat + ENVIRONMENT_TOKEN_TTL_SECONDS,
    };
    const token = signEnvironmentToken(claims, key.kid, key.privateKey);
    return c.json({ token, expiresAt: new Date((iat + ENVIRONMENT_TOKEN_TTL_SECONDS) * 1000).toISOString(), claims });
  });
  return { app, org, entitlements };
}

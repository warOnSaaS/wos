/**
 * A test double of the control plane's AppRoutes (the real one is the control-plane workstream's; tests/web-app-cloud
 * .test.ts drives wOS Web against it): accounts sign in as clientKind web_app (S-43: pollSecret and tokens in bodies,
 * the link to HOSTS.app + WEB_APP_SIGNIN_CODE_PATH, single use, 15 minutes), one personal organization, the registry built from the bundled manifests, EntitlementMachine-shaped
 * enable/disable and environment tokens signed with a throwaway key. Only for tests; no user ever sees it.
 */
import { randomUUID } from "node:crypto";
import { type Context, Hono } from "hono";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import {
  activeAppIds,
  AppRoutes,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  HOSTS,
  Routes,
  signEnvironmentToken,
  WEB_APP_SIGNIN_CODE_PATH,
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
  const refreshTokens = new Map<string, string>();
  const requests = new Map<string, { pollSecret: string; linkToken: string; expiresAt: number; used: boolean }>();
  /** What the control plane emailed: the link wOS Web receives and the code. */
  const mails: { to: string; link: string; code: string }[] = [];
  const me = {
    id: account,
    email: "sam@example.test",
    handle: null,
    github: null,
    canContribute: false,
    displayName: null,
    roles: [],
    leaderboardOptIn: false,
    status: "active",
    followedTargets: [],
    progressEmails: false,
    attestations: [],
    balance: { held: 0, available: 0, score: 0 },
  };
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
  app.post(Routes.startEmailSignIn.path, async (c) => {
    const b = Routes.startEmailSignIn.body.parse(await c.req.json());
    if (b.clientKind !== "web_app")
      return c.json({ error: { code: "VALIDATION_FAILED", message: "web_app only here", requestId: "x" } }, 400);
    const requestId = randomUUID();
    const pollSecret = `poll-${randomUUID()}`;
    const linkToken = `link-${randomUUID()}`;
    const expiresAt = clock.now.getTime() + 15 * 60_000;
    requests.set(requestId, { pollSecret, linkToken, expiresAt, used: false });
    mails.push({
      to: b.email,
      link: `${HOSTS.app}${WEB_APP_SIGNIN_CODE_PATH}?${new URLSearchParams({ r: requestId, t: linkToken })}`,
      code: CODE,
    });
    return c.json({ requestId, pollSecret, expiresAt: new Date(expiresAt).toISOString() }, 202);
  });
  const issue = () => {
    const access = `wos_at_${randomUUID()}`;
    const refresh = `wos_rt_${randomUUID()}`;
    sessions.add(access);
    refreshTokens.set(refresh, access);
    const exp = new Date(clock.now.getTime() + 3600_000).toISOString();
    return { accessToken: access, accessExpiresAt: exp, refreshToken: refresh, refreshExpiresAt: exp };
  };
  const denied = (c: Context) => c.json({ error: { code: "UNAUTHENTICATED", message: "no", requestId: "x" } }, 401);
  app.post(Routes.redeemEmailSignIn.path, async (c) => {
    const b = Routes.redeemEmailSignIn.body.parse(await c.req.json());
    const r = requests.get(b.requestId);
    const proofOk = b.code !== null ? b.code === CODE && b.linkToken === null : b.linkToken === r?.linkToken;
    if (!r || r.used || r.expiresAt <= clock.now.getTime() || b.pollSecret !== r.pollSecret || !proofOk) return denied(c);
    r.used = true;
    return c.json({ ...issue(), deviceId: null, created: true, me });
  });
  app.post(Routes.refreshSession.path, async (c) => {
    const b = Routes.refreshSession.body.parse(await c.req.json());
    const access = refreshTokens.get(b.refreshToken);
    if (!access) return denied(c);
    refreshTokens.delete(b.refreshToken);
    sessions.delete(access);
    return c.json(issue());
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
  return { app, org, entitlements, mails };
}

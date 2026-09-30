import { describe, expect, it } from "vitest";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import {
  ActiveApps,
  CoreRoutes,
  ENVIRONMENT_TOKEN_SKEW_SECONDS,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  EnvironmentDescriptor,
  ScreenListData,
  WOS_CLOUD_ENVIRONMENT_ID,
} from "../../../modules/core-contracts/src/index.js";
import { cloudActiveApps, parseWosApps, selfHostedActiveApps } from "../../../modules/core/src/active-apps.js";
import { loadBundle } from "../../../modules/core/src/bundle.js";
import { checkEnvironmentToken, EnvironmentKeyCache } from "../../../modules/core/src/env-token.js";
import { loadConfig } from "../src/config.js";
import { SIGNIN_MAX_ATTEMPTS } from "../src/store.js";
import { bearer, CONTROL_PLANE, Clock, cloudCore, keysFetch, mint, post, SECRET, selfHostedCore, signInLocal, testKey } from "./support.js";

const bundle = loadBundle(BUNDLED_APPS);
const ids = (a: { id: string }[]) => a.map((x) => x.id);

describe("suite-shell Core: environment descriptor", () => {
  it("self-hosted: kind self_hosted, local auth, a persisted environment id", async () => {
    const { app } = selfHostedCore();
    const d = EnvironmentDescriptor.parse(await (await app.request("/.well-known/wos-environment")).json());
    expect(d).toMatchObject({ kind: "self_hosted", auth: { kind: "local" }, coreVersion: "0.1.0", apiBase: "https://wos.example.test" });
    const again = EnvironmentDescriptor.parse(await (await app.request("/.well-known/wos-environment")).json());
    expect(again.environmentId).toBe(d.environmentId);
    expect(d.environmentId).not.toBe(WOS_CLOUD_ENVIRONMENT_ID);
  });

  it("cloud: wOS Cloud's id and the control plane as issuer", async () => {
    const key = testKey();
    const { app } = cloudCore({ keys: () => [key] });
    const d = EnvironmentDescriptor.parse(await (await app.request("/.well-known/wos-environment")).json());
    expect(d).toMatchObject({ kind: "cloud", environmentId: WOS_CLOUD_ENVIRONMENT_ID, auth: { kind: "wos_cloud", issuer: CONTROL_PLANE } });
  });
});

describe("suite-shell Core: environment-token verification (C-8)", () => {
  const key = testKey();
  const nowS = (d: Date) => Math.floor(d.getTime() / 1000);

  it("accepts a token from a published key and activates exactly the claimed apps", async () => {
    const { app } = cloudCore({ keys: () => [key] });
    const res = await app.request("/v1/core/apps", bearer(mint(key, { apps: ["contacts", "core", "crm"] })));
    expect(res.status).toBe(200);
    const body = ActiveApps.parse(await res.json());
    expect(body.apps.map((a) => [a.id, a.source])).toEqual([
      ["contacts", "dependency"],
      ["core", "core"],
      ["crm", "entitlement"],
    ]);
  });

  it("honours ENVIRONMENT_TOKEN_SKEW_SECONDS on both ends and refuses beyond it", async () => {
    const cache = new EnvironmentKeyCache(
      CONTROL_PLANE,
      keysFetch(() => [key]),
      () => 0,
    );
    const iat = new Date("2026-10-01T12:00:00Z");
    const token = mint(key, { apps: ["core"] }, iat);
    const at = (s: number) => checkEnvironmentToken(token, cache, WOS_CLOUD_ENVIRONMENT_ID, nowS(iat) + s);
    expect((await at(-ENVIRONMENT_TOKEN_SKEW_SECONDS)).ok).toBe(true);
    expect(await at(-ENVIRONMENT_TOKEN_SKEW_SECONDS - 1)).toEqual({ ok: false, reason: "issued in the future" });
    expect((await at(ENVIRONMENT_TOKEN_TTL_SECONDS + ENVIRONMENT_TOKEN_SKEW_SECONDS - 1)).ok).toBe(true);
    expect(await at(ENVIRONMENT_TOKEN_TTL_SECONDS + ENVIRONMENT_TOKEN_SKEW_SECONDS)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses another environment's audience, a tampered token and an unknown key", async () => {
    const { app } = cloudCore({ keys: () => [key] });
    const other = mint(key, { apps: ["core", "crm"], aud: "0192f000-0000-7000-8000-0000000000ff" });
    expect((await app.request("/v1/core/apps", bearer(other))).status).toBe(401);
    const good = mint(key, { apps: ["core"] });
    const [h, c, s] = good.split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, role: "owner" })).toString("base64url")}.${s}`;
    expect((await app.request("/v1/core/apps", bearer(forged))).status).toBe(401);
    const stranger = testKey("wos-env-2099");
    expect((await app.request("/v1/core/apps", bearer(mint(stranger, { apps: ["core"] })))).status).toBe(401);
  });

  it("refetches keys when a token names a new kid (rotation), at most every 30 s", async () => {
    const next = testKey("wos-env-2027");
    let published = [key];
    const calls: string[] = [];
    const clock = new Clock();
    const { app } = cloudCore({ keys: () => published, clock, fetchCalls: calls });
    expect((await app.request("/v1/core/apps", bearer(mint(key, { apps: ["core"] }, clock.now)))).status).toBe(200);
    expect(calls).toHaveLength(1);
    published = [key, next];
    expect((await app.request("/v1/core/apps", bearer(mint(next, { apps: ["core"] }, clock.now)))).status).toBe(401);
    clock.advance(31);
    expect((await app.request("/v1/core/apps", bearer(mint(next, { apps: ["core"] }, clock.now)))).status).toBe(200);
    expect(calls).toHaveLength(2);
  });
});

describe("suite-shell Core: ActiveApps", () => {
  it("cloud: disabling CRM (a token without crm) removes crm and contacts; Build is never an environment app", () => {
    expect(ids(cloudActiveApps(bundle, ["contacts", "core", "crm", "build"]))).toEqual(["contacts", "core", "crm"]);
    expect(ids(cloudActiveApps(bundle, ["core"]))).toEqual(["core"]);
    // An app whose requirement is not claimed is not activated.
    expect(ids(cloudActiveApps(bundle, ["core", "crm"]))).toEqual(["core"]);
  });

  it("self-hosted: WOS_APPS=crm activates crm (self_host_config), contacts (dependency) and core", () => {
    const apps = selfHostedActiveApps(bundle, parseWosApps("crm", bundle));
    expect(apps.map((a) => [a.id, a.source])).toEqual([
      ["contacts", "dependency"],
      ["core", "core"],
      ["crm", "self_host_config"],
    ]);
    expect(ids(selfHostedActiveApps(bundle, parseWosApps("", bundle)))).toEqual(["core"]);
  });

  it("WOS_APPS refuses core, modules and unknown apps", () => {
    expect(() => parseWosApps("contacts", bundle)).toThrow(/module/);
    expect(() => parseWosApps("core", bundle)).toThrow(/always active/);
    expect(() => parseWosApps("salesforce", bundle)).toThrow(/does not bundle/);
  });
});

describe("suite-shell Core: configuration keeps the two modes apart (S-41)", () => {
  const base = { WOS_PUBLIC_URL: "https://x.test", WOS_CORE_SECRET: SECRET };
  it("cloud refuses WOS_APPS; self-hosted refuses a control-plane URL and open sign-in", () => {
    expect(() => loadConfig({ ...base, WOS_MODE: "cloud", WOS_APPS: "crm" }, bundle)).toThrow(/WOS_APPS/);
    expect(() => loadConfig({ ...base, WOS_OWNER_EMAIL: "a@b.test", WOS_CONTROL_PLANE_URL: "https://api.waronsaas.com" }, bundle)).toThrow(
      /never calls/,
    );
    expect(() => loadConfig({ ...base }, bundle)).toThrow(/WOS_OWNER_EMAIL/);
    expect(() => loadConfig({ ...base, WOS_OWNER_EMAIL: "a@b.test", WOS_CORE_SECRET: "short" }, bundle)).toThrow(/WOS_CORE_SECRET/);
  });

  it("a self-hosted Core never fetches anything and refuses environment tokens", async () => {
    const calls: string[] = [];
    const { app, mailer } = selfHostedCore({ fetchCalls: calls });
    const key = testKey();
    expect((await app.request("/v1/core/apps", bearer(mint(key, { apps: ["core", "crm", "contacts"] })))).status).toBe(401);
    const { token } = await signInLocal(app, mailer, "owner@example.test");
    expect((await app.request("/v1/core/apps", bearer(token))).status).toBe(200);
    expect(calls).toEqual([]);
  });
});

describe("suite-shell Core: local sign-in", () => {
  it("the owner signs in as owner, an allowed address as member; codes are single use", async () => {
    const { app, mailer } = selfHostedCore();
    expect((await signInLocal(app, mailer, "owner@example.test")).role).toBe("owner");
    expect((await signInLocal(app, mailer, "sam@example.test")).role).toBe("member");
    const m = mailer.sent[0]!;
    expect((await app.request("/v1/core/auth/local/redeem", post({ requestId: m.requestId, code: m.code }))).status).toBe(401);
  });

  it("an address that may not sign in gets the same 202 and no code", async () => {
    const { app, mailer } = selfHostedCore();
    const res = await app.request("/v1/core/auth/local/start", post({ email: "stranger@elsewhere.test" }));
    expect(res.status).toBe(202);
    expect(mailer.sent).toHaveLength(0);
  });

  it(`a request dies after ${SIGNIN_MAX_ATTEMPTS} wrong codes, and after 15 minutes`, async () => {
    const { app, mailer, clock } = selfHostedCore();
    const start = async () => {
      const r = (await (await app.request("/v1/core/auth/local/start", post({ email: "owner@example.test" }))).json()) as {
        requestId: string;
      };
      return mailer.sent.find((s) => s.requestId === r.requestId)!;
    };
    const m = await start();
    for (let i = 0; i < SIGNIN_MAX_ATTEMPTS; i++)
      expect((await app.request("/v1/core/auth/local/redeem", post({ requestId: m.requestId, code: "AAAA-AAAA" }))).status).toBe(401);
    expect((await app.request("/v1/core/auth/local/redeem", post({ requestId: m.requestId, code: m.code }))).status).toBe(401);
    const late = await start();
    clock.advance(15 * 60);
    expect((await app.request("/v1/core/auth/local/redeem", post({ requestId: late.requestId, code: late.code }))).status).toBe(401);
  });

  it("logout ends the session; it needs a Bearer (auth environment_session)", async () => {
    const { app, mailer } = selfHostedCore();
    const { token } = await signInLocal(app, mailer, "owner@example.test");
    expect((await app.request(CoreRoutes.logout.path, { method: "POST" })).status).toBe(401);
    const out = await app.request(CoreRoutes.logout.path, { method: "POST", ...bearer(token) });
    expect(out.status).toBe(200);
    expect(CoreRoutes.logout.response.parse(await out.json())).toEqual({ ok: true });
    expect((await app.request("/v1/core/apps", bearer(token))).status).toBe(401);
    expect((await app.request(CoreRoutes.logout.path, { method: "POST", ...bearer(token) })).status).toBe(401);
  });

  it("serves exactly the contracted routes and shapes (B-0001-suite-shell, contracts 5.6.0)", async () => {
    expect(CoreRoutes.localSignInStart.path).toBe("/v1/core/auth/local/start");
    const { app, mailer } = selfHostedCore();
    const bad = await app.request(
      CoreRoutes.localSignInRedeem.path,
      post({ requestId: "0192f000-0000-7000-8000-000000000001", code: "abcd-efgh" }),
    );
    expect(bad.status).toBe(422);
    const start = await app.request(CoreRoutes.localSignInStart.path, post({ email: "owner@example.test" }));
    const started = CoreRoutes.localSignInStart.response.parse(await start.json());
    const code = mailer.sent.find((m) => m.requestId === started.requestId)!.code;
    const res = await app.request(CoreRoutes.localSignInRedeem.path, post({ requestId: started.requestId, code }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "organizationId", "role", "token", "userId"]);
    expect(CoreRoutes.localSignInRedeem.response.safeParse(body).success).toBe(true);
  });

  it("a wOS Cloud Core answers 404 to local sign-in; logout with an environment token is a no-op", async () => {
    const key = testKey();
    const { app } = cloudCore({ keys: () => [key] });
    expect((await app.request(CoreRoutes.localSignInStart.path, post({ email: "owner@example.test" }))).status).toBe(404);
    expect(
      (await app.request(CoreRoutes.localSignInRedeem.path, post({ requestId: "0192f000-0000-7000-8000-000000000001", code: "ABCD-EFGH" })))
        .status,
    ).toBe(404);
    const token = mint(key, { apps: ["core"] });
    const out = await app.request(CoreRoutes.logout.path, { method: "POST", ...bearer(token) });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect((await app.request("/v1/core/apps", bearer(token))).status).toBe(200);
  });

  it("a failed email still answers 202 (no enumeration), logs the failure and never the code", async () => {
    const lines: string[] = [];
    const codes: string[] = [];
    const { app } = selfHostedCore({
      mailer: {
        sendSigninCode: async (m) => {
          codes.push(m.code);
          throw new Error("smtp down");
        },
      },
      log: (msg, fields) => lines.push(`${msg} ${JSON.stringify(fields)}`),
    });
    const res = await app.request(CoreRoutes.localSignInStart.path, post({ email: "owner@example.test" }));
    expect(res.status).toBe(202);
    expect(codes).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("sign-in email failed");
    expect(lines[0]).toContain("smtp down");
    expect(lines[0]).not.toContain(codes[0]!);
  });
});

describe("suite-shell Core: /apps/<id> mounting with declared permissions", () => {
  it("crm answers its features as ScreenListData: none built, so an empty list", async () => {
    const { app, mailer } = selfHostedCore();
    const { token } = await signInLocal(app, mailer, "sam@example.test");
    const res = await app.request("/apps/crm/features", bearer(token));
    expect(res.status).toBe(200);
    expect(ScreenListData.parse(await res.json())).toEqual({ items: [], nextCursor: null });
    expect((await app.request("/apps/contacts/features", bearer(token))).status).toBe(200);
  });

  it("an app that is not active answers 404, and an unauthenticated call 401", async () => {
    const { app, mailer } = selfHostedCore({ apps: "" });
    expect((await app.request("/apps/crm/features")).status).toBe(401);
    const { token } = await signInLocal(app, mailer, "owner@example.test");
    expect((await app.request("/apps/crm/features", bearer(token))).status).toBe(404);
    expect((await app.request("/v1/core/apps/crm/screens", bearer(token))).status).toBe(404);
    expect((await app.request("/apps/core/me", bearer(token))).status).toBe(200);
  });

  it("a role without the declared permission gets 403", async () => {
    const crm = BUNDLED_APPS.find((a) => (a.manifest as { app: { id: string } }).app.id === "crm")!;
    const m = crm.manifest as { permissions: { key: string; description: string; grantedTo: string[] }[] };
    const ownerOnly = { ...crm, manifest: { ...m, permissions: m.permissions.map((p) => ({ ...p, grantedTo: ["owner"] })) } };
    const custom = loadBundle(BUNDLED_APPS.map((a) => (a === crm ? ownerOnly : a)));
    const { app, mailer } = selfHostedCore({ bundle: custom });
    const member = await signInLocal(app, mailer, "sam@example.test");
    expect((await app.request("/apps/crm/features", bearer(member.token))).status).toBe(403);
    const owner = await signInLocal(app, mailer, "owner@example.test");
    expect((await app.request("/apps/crm/features", bearer(owner.token))).status).toBe(200);
  });

  it("screens: the active app's wos-screen.v1 screens, on wOS Cloud too", async () => {
    const key = testKey();
    const { app } = cloudCore({ keys: () => [key] });
    const res = await app.request("/v1/core/apps/crm/screens", bearer(mint(key, { apps: ["core", "contacts", "crm"] })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { app: string; screens: { id: string }[] };
    expect(body.screens.map((s) => s.id)).toEqual(["crm.features.list"]);
  });
});

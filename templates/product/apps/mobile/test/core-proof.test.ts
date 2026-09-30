/**
 * V1 proof step 6 (WORKSTREAMS 12.2): "CRM appears in Mobile navigation and runtime: a declarative screen renders from
 * the CRM API." Run against the template's real wOS Core (apps/api), in process: the phone's runtime talks to Core's
 * Hono app instead of the network. Nothing is mocked between the runtime and Core; only the transport is in-process.
 *
 * CRM has built nothing yet, so the screen that renders is CRM's list of features in this version, and it is empty:
 * the phone shows 0, never sample records.
 */
import { describe, expect, it } from "vitest";
import { type Clock, CONTROL_PLANE, cloudCore, mint, selfHostedCore, testKey } from "../../api/test/support.js";
import { ENVIRONMENT_TOKEN_TTL_SECONDS, WOS_CLOUD_ENVIRONMENT_ID } from "../src/contracts.js";
import { BUNDLED_MOBILE_MODULES } from "../src/modules/index.js";
import { ActiveAppsController } from "../src/runtime/active-apps.js";
import { WosClient, type WosState } from "../src/runtime/client.js";
import { discoverEnvironment } from "../src/runtime/environment.js";
import type { HttpFetch } from "../src/runtime/http.js";
import { mobileNavigation } from "../src/runtime/navigation.js";
import { loadList } from "../src/runtime/renderer.js";
import { findScreen, loadScreens } from "../src/runtime/screens.js";
import { ENV_TOKEN_REFRESH_MARGIN_SECONDS, EnvironmentSession } from "../src/runtime/session.js";
import { MemorySecureStore, sessionKey } from "../src/runtime/storage.js";
import { ManualTime } from "./support.js";

type AppLike = { request: (url: string, init?: RequestInit) => Response | Promise<Response> };

/** The phone's fetch, answered by an in-process Core (and, for wOS Cloud, a control plane double). */
function inProcess(routes: Record<string, AppLike>): HttpFetch & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    urls.push(`${init.method} ${url}`);
    const origin = /^https?:\/\/[^/]+/.exec(url)?.[0] ?? "";
    const app = routes[origin];
    if (!app) throw new Error(`no route to ${origin}`);
    const res = await app.request(url, { method: init.method, headers: init.headers, body: init.body });
    return { status: res.status, json: () => res.json() };
  }) as HttpFetch & { urls: string[] };
  f.urls = urls;
  return f;
}

function ready(s: WosState) {
  if (s.phase !== "ready") throw new Error(`expected ready, got ${s.phase}`);
  return s;
}

describe("mobile-runtime V1 proof step 6: CRM in wOS Mobile, against the template's wOS Core", () => {
  it("self-hosted (WOS_APPS=crm): discover, sign in by email code, CRM in navigation, its screen renders from the CRM API as an honest 0", async () => {
    const core = selfHostedCore({ apps: "crm" });
    const fetch = inProcess({ "https://wos.example.test": core.app });
    const store = new MemorySecureStore();
    const time = new ManualTime();
    const client = new WosClient({ fetch, store, platform: "ios", modules: BUNDLED_MOBILE_MODULES, clock: time, timers: time });

    await client.init();
    expect(client.current.phase).toBe("choose_environment");
    await client.connect("wos.example.test");
    const signIn = client.current;
    expect(signIn).toMatchObject({ phase: "sign_in", environment: { descriptor: { kind: "self_hosted", auth: { kind: "local" } } } });

    await client.startSignIn("member@example.test");
    const code = core.mailer.sent.at(-1)?.code;
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await client.redeemCode(code!.toLowerCase().replace("-", " "));

    const home = ready(client.current);
    expect(home.activeApps.apps?.apps.map((a) => [a.id, a.source])).toEqual([
      ["contacts", "dependency"],
      ["core", "core"],
      ["crm", "self_host_config"],
    ]);
    expect(home.navigation).toEqual([
      {
        app: "crm",
        appName: "wOS CRM",
        id: "crm.home",
        title: "CRM",
        route: "/crm",
        order: 100,
        screen: "crm.features.list",
        needsUpdate: false,
      },
    ]);

    // Open CRM: its screens come from Core, and the list screen reads CRM's own API.
    const session = client.session!;
    const screens = await loadScreens(session, "crm", BUNDLED_MOBILE_MODULES.get("crm"));
    expect(screens.source).toBe("environment");
    const screen = findScreen(screens, home.navigation[0]!.screen!)!;
    const manifest = home.activeApps.apps!.apps.find((a) => a.id === "crm")!.manifest;
    const model = await loadList((req) => session.authorized(req), { screen, manifest, role: session.role! });
    expect(model).toMatchObject({
      kind: "list",
      title: "CRM features in this version",
      rows: [],
      count: 0,
      nextCursor: null,
      empty: { title: "0 RECORDS" },
    });
    expect(fetch.urls).toContain("GET https://wos.example.test/apps/crm/features");

    // The session is in secure storage only, under this environment's id.
    const envId = home.environment.descriptor.environmentId;
    expect([...store.items.keys()].sort()).toEqual([sessionKey(envId), "wos.environments"].sort());
    // A self-hosted Core never calls warOnSaaS (S-41).
    expect(core.fetchCalls).toEqual([]);
    client.dispose();
  });

  it("self-hosted without CRM (WOS_APPS empty): no CRM in navigation, and CRM's API refuses the phone", async () => {
    const core = selfHostedCore({ apps: "" });
    const fetch = inProcess({ "https://wos.example.test": core.app });
    const time = new ManualTime();
    const client = new WosClient({
      fetch,
      store: new MemorySecureStore(),
      platform: "android",
      modules: BUNDLED_MOBILE_MODULES,
      clock: time,
      timers: time,
    });
    await client.connect("https://wos.example.test");
    await client.startSignIn("owner@example.test");
    await client.redeemCode(core.mailer.sent.at(-1)!.code);
    const home = ready(client.current);
    expect(home.activeApps.apps?.apps.map((a) => a.id)).toEqual(["core"]);
    expect(home.navigation).toEqual([]);
    await expect(client.session!.authorized({ method: "GET", path: "/apps/crm/features" })).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    client.dispose();
  });

  it("wOS Cloud: with an environment token claiming CRM, CRM appears and renders; a token without it removes CRM at the next refresh", async () => {
    const time = new ManualTime();
    const key = testKey();
    // Hosted Core reads the same manual clock as the phone, so token lifetimes line up.
    const coreClock = {
      get now() {
        return new Date(time.now());
      },
      advance() {},
    } as unknown as Clock;
    const core = cloudCore({ keys: () => [key], clock: coreClock });
    let claims = ["contacts", "core", "crm"];
    let minted = 0;
    // A control plane double that mints real C-8 tokens with the test key; hosted Core verifies them with its keys.
    const controlPlane: AppLike = {
      request: async (url, init) => {
        if (!(url.endsWith(`/v1/environments/${WOS_CLOUD_ENVIRONMENT_ID}/token`) && init?.method === "POST"))
          return new Response("{}", { status: 404 });
        minted++;
        const now = new Date(time.now());
        const token = mint(key, { apps: claims, role: "member" }, now);
        const claimsOut = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
        return Response.json({ token, expiresAt: new Date(claimsOut.exp * 1000).toISOString(), claims: claimsOut });
      },
    };
    const fetch = inProcess({ "https://core.example.test": core.app, [CONTROL_PLANE]: controlPlane });
    const environment = await discoverEnvironment(fetch, "https://core.example.test", { trustedCloudIssuers: [CONTROL_PLANE] });
    expect(environment.descriptor).toMatchObject({ kind: "cloud", environmentId: WOS_CLOUD_ENVIRONMENT_ID });

    const session = new EnvironmentSession({ fetch, store: new MemorySecureStore(), environment, clock: time, timers: time });
    await session.signInCloud({
      kind: "wos_cloud",
      issuer: CONTROL_PLANE,
      accessToken: "account-access",
      accessExpiresAt: new Date(time.now() + 3600_000).toISOString(),
      refreshToken: "account-refresh",
      refreshExpiresAt: new Date(time.now() + 86400_000).toISOString(),
      organizationId: "0192f000-0000-7000-8000-000000000002",
    });
    const apps = new ActiveAppsController(session, time);
    await apps.start();
    const nav = () => mobileNavigation(apps.current.apps?.apps ?? [], "ios", session.role, BUNDLED_MOBILE_MODULES).map((n) => n.id);
    expect(apps.current.apps?.apps.map((a) => [a.id, a.source])).toEqual([
      ["contacts", "dependency"],
      ["core", "core"],
      ["crm", "entitlement"],
    ]);
    expect(nav()).toEqual(["crm.home"]);

    const screens = await loadScreens(session, "crm", BUNDLED_MOBILE_MODULES.get("crm"));
    const manifest = apps.current.apps!.apps.find((a) => a.id === "crm")!.manifest;
    const model = await loadList((req) => session.authorized(req), {
      screen: findScreen(screens, "crm.features.list")!,
      manifest,
      role: session.role!,
    });
    expect(model.rows).toEqual([]);
    expect(model.empty?.title).toBe("0 RECORDS");

    claims = ["core"]; // the organization disables CRM; the next environment token no longer claims it
    await time.advance(ENVIRONMENT_TOKEN_TTL_SECONDS - ENV_TOKEN_REFRESH_MARGIN_SECONDS);
    expect(minted).toBe(2);
    expect(nav()).toEqual([]);
    await expect(session.authorized({ method: "GET", path: "/apps/crm/features" })).rejects.toMatchObject({ status: 404 });
    apps.stop();
    session.dispose();
  });
});

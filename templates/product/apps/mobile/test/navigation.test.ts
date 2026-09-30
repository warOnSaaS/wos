/** mobile-runtime: navigation from the active manifests, and ActiveApps refresh (start, 60 s, foreground, token refresh). */
import { describe, expect, it } from "vitest";
import crmManifestJson from "../../../applications/crm/wos-app.json" with { type: "json" };
import { ACTIVE_APPS_REFRESH_SECONDS, type ActiveAppT, ENVIRONMENT_TOKEN_TTL_SECONDS, WosAppManifest } from "../src/contracts.js";
import { BUNDLED_MOBILE_MODULES } from "../src/modules/index.js";
import { ActiveAppsController } from "../src/runtime/active-apps.js";
import { mobileNavigation } from "../src/runtime/navigation.js";
import { ENV_TOKEN_REFRESH_MARGIN_SECONDS, EnvironmentSession } from "../src/runtime/session.js";
import { MemorySecureStore } from "../src/runtime/storage.js";
import {
  apiError,
  CLOUD_ENV_ID,
  cloudEnvironment,
  cloudSession,
  controlPlane,
  fixtureManifest,
  LOCAL_ENV_ID,
  localEnvironment,
  ManualTime,
  ORG_ID,
  type Req,
  scriptedFetch,
  USER_ID,
} from "./support.js";

const crm = WosAppManifest.parse(crmManifestJson);
const active = (...ms: (typeof crm)[]): ActiveAppT[] =>
  ms.map((m) => ({ id: m.app.id, version: m.app.version, source: "entitlement", manifest: m }));

describe("mobile-runtime: navigation from the active manifests", () => {
  it("CRM active -> its ios/android entry opens the bundled CRM module's features screen", () => {
    expect(mobileNavigation(active(crm), "ios", "member", BUNDLED_MOBILE_MODULES)).toEqual([
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
    expect(mobileNavigation(active(crm), "android", "owner", BUNDLED_MOBILE_MODULES).map((n) => n.id)).toEqual(["crm.home"]);
  });

  it("nothing active, or no role, shows nothing (never a placeholder app)", () => {
    expect(mobileNavigation([], "ios", "owner", BUNDLED_MOBILE_MODULES)).toEqual([]);
    expect(mobileNavigation(active(crm), "ios", null, BUNDLED_MOBILE_MODULES)).toEqual([]);
  });

  it("filters by platform and by the role's declared permissions, ordered by `order`", () => {
    const modules = new Map([
      ["fixture", { app: "fixture", entries: { "/fixture": "fixture.items.list", "/fixture/admin": "fixture.items.list" }, screens: [] }],
    ]);
    const all = [...modules, ...BUNDLED_MOBILE_MODULES];
    const nav = (platform: "ios" | "android", role: "owner" | "member") =>
      mobileNavigation(active(crm, fixtureManifest), platform, role, new Map(all)).map((n) => n.id);
    expect(nav("ios", "owner")).toEqual(["fixture.admin", "fixture.items", "crm.home"]);
    expect(nav("ios", "member")).toEqual(["fixture.items", "crm.home"]); // fixture.admin needs fixture.items.delete
    expect(nav("android", "owner")).toEqual(["fixture.items", "crm.home"]); // fixture.admin is ios-only
  });

  it("an active app this build does not carry is listed as needing a wOS Mobile update, not faked", () => {
    const [entry] = mobileNavigation(active(fixtureManifest), "android", "member", BUNDLED_MOBILE_MODULES);
    expect(entry).toMatchObject({ id: "fixture.items", screen: null, needsUpdate: true });
  });

  it("an app whose manifest does not support the platform (Contacts: api only) contributes nothing", () => {
    const contacts = WosAppManifest.parse({
      ...crmManifestJson,
      app: { ...crmManifestJson.app, id: "contacts", name: "wOS Contacts", kind: "module", billing: "free" },
      requires: { wos: "^0.1.0", apps: [] },
      surfaces: {
        web: { supported: false },
        desktop: { supported: false },
        ios: { supported: false },
        android: { supported: false },
        api: { supported: true },
      },
      mobile: null,
      data: { schema: "app_contacts", migrations: null, owns: [] },
      permissions: [],
      routes: { ui: "/contacts", api: "/apps/contacts" },
      navigation: [],
    });
    expect(mobileNavigation(active(contacts), "ios", "owner", BUNDLED_MOBILE_MODULES)).toEqual([]);
  });
});

describe("mobile-runtime: ActiveApps refresh", () => {
  function setup(opts: { environmentId?: string } = {}) {
    const time = new ManualTime();
    const state = { apps: active(crm), fail: false, reads: 0 };
    const core = (req: Req) => {
      if (req.path !== "/v1/core/apps") return undefined;
      state.reads++;
      if (state.fail) return apiError(500, "INTERNAL");
      return { status: 200, body: { environmentId: opts.environmentId ?? LOCAL_ENV_ID, organizationId: ORG_ID, apps: state.apps } };
    };
    const session = new EnvironmentSession({
      fetch: scriptedFetch(core),
      store: new MemorySecureStore(),
      environment: localEnvironment(),
      clock: time,
      timers: time,
    });
    const controller = new ActiveAppsController(session, time);
    return { time, state, session, controller };
  }
  const signIn = (session: EnvironmentSession, time: ManualTime) =>
    session.signInLocal({
      kind: "local",
      token: "local-session-token-0123456789",
      expiresAt: new Date(time.now() + 12 * 3600_000).toISOString(),
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "member",
    });

  it(`reads on start, then every ${ACTIVE_APPS_REFRESH_SECONDS} s; a disabled app leaves the navigation at the next read`, async () => {
    const { time, state, session, controller } = setup();
    await signIn(session, time);
    await controller.start();
    expect(state.reads).toBe(1);
    expect(controller.current.apps?.apps.map((a) => a.id)).toEqual(["crm"]);

    state.apps = []; // the organization disables CRM
    await time.advance(ACTIVE_APPS_REFRESH_SECONDS - 1);
    expect(state.reads).toBe(1);
    await time.advance(1);
    expect(state.reads).toBe(2);
    expect(mobileNavigation(controller.current.apps?.apps ?? [], "ios", session.role, BUNDLED_MOBILE_MODULES)).toEqual([]);

    await time.advance(ACTIVE_APPS_REFRESH_SECONDS * 3);
    expect(state.reads).toBe(5);
    controller.stop();
    await time.advance(ACTIVE_APPS_REFRESH_SECONDS * 3);
    expect(state.reads).toBe(5);
  });

  it("re-reads when the app returns to the foreground", async () => {
    const { time, state, session, controller } = setup();
    await signIn(session, time);
    await controller.start();
    await controller.onForeground();
    expect(state.reads).toBe(2);
    controller.stop();
  });

  it("wOS Cloud: re-reads on every environment-token refresh, and the new token's apps are what Core answers", async () => {
    const time = new ManualTime();
    const cp = controlPlane(time);
    let reads = 0;
    const core = (req: Req) => {
      if (!req.url.startsWith("https://core.waronsaas.com") || req.path !== "/v1/core/apps") return undefined;
      reads++;
      // Hosted Core activates exactly the token's claims; the double answers CRM while the token claims it.
      const claimsCrm = cp.state.apps.includes("crm");
      return { status: 200, body: { environmentId: CLOUD_ENV_ID, organizationId: ORG_ID, apps: claimsCrm ? active(crm) : [] } };
    };
    const session = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler, core),
      store: new MemorySecureStore(),
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    await session.signInCloud(cloudSession(time));
    const controller = new ActiveAppsController(session, time);
    await controller.start();
    expect(reads).toBe(1);
    expect(controller.current.apps?.apps.map((a) => a.id)).toEqual(["crm"]);

    cp.state.apps = ["core"]; // CRM disabled: the next token no longer claims it
    await time.advance(ENVIRONMENT_TOKEN_TTL_SECONDS - ENV_TOKEN_REFRESH_MARGIN_SECONDS);
    expect(cp.state.minted).toBe(2);
    // 13 ticks of 60 s plus one read for the refresh at 780 s (coalesced when they coincide).
    expect(reads).toBeGreaterThanOrEqual(1 + 13);
    expect(controller.current.apps?.apps).toEqual([]);
    controller.stop();
    session.dispose();
  });

  it("a failed read keeps the last good list and reports the error; signed out, the list is dropped", async () => {
    const { time, state, session, controller } = setup();
    await signIn(session, time);
    await controller.start();
    state.fail = true;
    await controller.refresh();
    expect(controller.current.apps?.apps.map((a) => a.id)).toEqual(["crm"]);
    expect(controller.current.error).toBe("internal");
    await session.signOut();
    await controller.refresh();
    expect(controller.current.apps).toBeNull();
    expect(state.reads).toBe(2);
    controller.stop();
  });

  it("refuses an answer for another environment", async () => {
    const { time, session, controller } = setup({ environmentId: "0192f000-0000-7000-8000-0000000000ff" });
    await signIn(session, time);
    await controller.refresh();
    expect(controller.current.apps).toBeNull();
    expect(controller.current.error).toMatch(/different environment/);
  });
});

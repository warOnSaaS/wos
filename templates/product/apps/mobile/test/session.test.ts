/** mobile-runtime: environment and account token refresh (C-8 environment tokens, S-4 rotating refresh), and discovery. */
import { describe, expect, it } from "vitest";
import { ENVIRONMENT_TOKEN_TTL_SECONDS } from "../src/contracts.js";
import { normalizeCode, startCloudSignIn } from "../src/runtime/auth.js";
import { checkDescriptor, discoverEnvironment, normalizeEnvironmentUrl, TRUSTED_CLOUD_ISSUERS } from "../src/runtime/environment.js";
import { ENV_TOKEN_REFRESH_MARGIN_SECONDS, EnvironmentSession } from "../src/runtime/session.js";
import { loadSession, MemorySecureStore, saveSession, sessionKey } from "../src/runtime/storage.js";
import {
  apiError,
  CLOUD_ENV_ID,
  cloudEnvironment,
  cloudSession,
  controlPlane,
  ISSUER,
  iso,
  localEnvironment,
  LOCAL_ENV_ID,
  ManualTime,
  ORG_ID,
  type Req,
  scriptedFetch,
  settle,
  USER_ID,
} from "./support.js";

describe("mobile-runtime: wOS Cloud environment token refresh", () => {
  it("signs in: picks the personal org, mints a token, and never stores the environment token", async () => {
    const time = new ManualTime();
    const cp = controlPlane(time);
    const store = new MemorySecureStore();
    const s = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler),
      store,
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    await s.signInCloud(cloudSession(time));
    expect(s.state).toBe("ready");
    expect(s.role).toBe("admin");
    expect(s.organizationId).toBe(ORG_ID);
    expect(await s.bearer()).toMatch(/^env-token-1/);
    const stored = await loadSession(store, CLOUD_ENV_ID);
    expect(stored).toMatchObject({ kind: "wos_cloud", organizationId: ORG_ID, refreshToken: "ref-0" });
    expect([...store.items.values()].join("")).not.toContain("env-token");
  });

  it(`re-mints ${ENV_TOKEN_REFRESH_MARGIN_SECONDS} s before exp (inside the 900 s lifetime), emitting token_refreshed each time`, async () => {
    const time = new ManualTime();
    const cp = controlPlane(time);
    const s = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler),
      store: new MemorySecureStore(),
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    const events: string[] = [];
    s.subscribe((e) => events.push(e.type));
    await s.signInCloud(cloudSession(time));
    expect(time.scheduled).toEqual([(ENVIRONMENT_TOKEN_TTL_SECONDS - ENV_TOKEN_REFRESH_MARGIN_SECONDS) * 1000]);
    await time.advance(ENVIRONMENT_TOKEN_TTL_SECONDS - ENV_TOKEN_REFRESH_MARGIN_SECONDS - 1);
    expect(cp.state.minted).toBe(1);
    await time.advance(1);
    expect(cp.state.minted).toBe(2);
    expect(await s.bearer()).toMatch(/^env-token-2/);
    await time.advance(3 * 780);
    expect(cp.state.minted).toBe(5);
    expect(events).toEqual(["token_refreshed", "signed_in", "token_refreshed", "token_refreshed", "token_refreshed", "token_refreshed"]);
    s.dispose();
  });

  it("on foreground after the phone slept past exp, re-mints at once; a fresh token is left alone", async () => {
    const time = new ManualTime();
    const cp = controlPlane(time);
    const s = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler),
      store: new MemorySecureStore(),
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    await s.signInCloud(cloudSession(time));
    await s.onForeground();
    expect(cp.state.minted).toBe(1);
    time.jump(2000); // the phone slept; no timer ran
    await s.onForeground();
    expect(cp.state.minted).toBe(2);
    expect(time.scheduled).toEqual([780_000]); // the stale timer was replaced, not doubled
  });

  it("an expired account access token is refreshed (rotating) and stored before minting", async () => {
    const time = new ManualTime();
    const cp = controlPlane(time);
    const store = new MemorySecureStore();
    const s = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler),
      store,
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    await s.signInCloud(cloudSession(time));
    cp.state.expireAccess = true; // the control plane now refuses acc-0
    await time.advance(780);
    expect(cp.state.refreshed).toBe(1);
    expect(cp.state.minted).toBe(2);
    expect(await loadSession(store, CLOUD_ENV_ID)).toMatchObject({ accessToken: "acc-1", refreshToken: "ref-1" });
  });

  it("a 401 from Core re-mints once and retries; a refused refresh signs the phone out and forgets the session", async () => {
    const time = new ManualTime();
    const cp = controlPlane(time);
    let coreRefusals = 1;
    const core = (req: Req) => {
      if (!req.url.startsWith("https://core.waronsaas.com")) return undefined;
      if (coreRefusals-- > 0) return apiError(401, "UNAUTHENTICATED");
      return { status: 200, body: { seen: req.headers.authorization } };
    };
    const store = new MemorySecureStore();
    const s = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler, core),
      store,
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    await s.signInCloud(cloudSession(time));
    const r = await s.authorized({ method: "GET", path: "/v1/core/apps" });
    expect(r.json).toEqual({ seen: expect.stringMatching(/^Bearer env-token-2/) });

    const events: string[] = [];
    s.subscribe((e) => events.push(e.type));
    cp.state.expireAccess = true;
    cp.state.refuseRefresh = true;
    await time.advance(780);
    expect(s.state).toBe("signed_out");
    expect(events).toContain("signed_out");
    expect(store.items.has(sessionKey(CLOUD_ENV_ID))).toBe(false);
    await expect(s.bearer()).rejects.toThrow(/sign in/);
  });

  it("restore: a stored account session mints on start; one past its refresh expiry is dropped", async () => {
    const time = new ManualTime();
    const cp = controlPlane(time);
    const store = new MemorySecureStore();
    await saveSession(store, CLOUD_ENV_ID, { ...cloudSession(time), organizationId: ORG_ID });
    const s = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler),
      store,
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    expect(await s.restore()).toBe("ready");
    expect(cp.state.minted).toBe(1);

    await saveSession(store, CLOUD_ENV_ID, { ...cloudSession(time), organizationId: ORG_ID, refreshExpiresAt: iso(time.now() - 1) });
    const old = new EnvironmentSession({
      fetch: scriptedFetch(cp.handler),
      store,
      environment: cloudEnvironment(),
      clock: time,
      timers: time,
    });
    expect(await old.restore()).toBe("signed_out");
    expect(store.items.has(sessionKey(CLOUD_ENV_ID))).toBe(false);
  });

  it("sessions are per environment: a cloud session is not a self-hosted one", async () => {
    const time = new ManualTime();
    const store = new MemorySecureStore();
    await saveSession(store, CLOUD_ENV_ID, { ...cloudSession(time), organizationId: ORG_ID });
    const local = new EnvironmentSession({ fetch: scriptedFetch(), store, environment: localEnvironment(), clock: time, timers: time });
    expect(await local.restore()).toBe("signed_out");
  });
});

describe("mobile-runtime: self-hosted session", () => {
  const local = (time: ManualTime) => ({
    kind: "local" as const,
    token: "local-session-token-0123456789",
    expiresAt: iso(time.now() + 12 * 3600_000),
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "member" as const,
  });

  it("uses the Core's own token as Bearer until expiresAt, then signs out", async () => {
    const time = new ManualTime();
    const store = new MemorySecureStore();
    const s = new EnvironmentSession({ fetch: scriptedFetch(), store, environment: localEnvironment(), clock: time, timers: time });
    await s.signInLocal(local(time));
    expect(await s.bearer()).toBe("local-session-token-0123456789");
    expect(s.role).toBe("member");
    expect(time.scheduled).toEqual([]); // nothing to re-mint on a self-hosted Core
    await time.advance(12 * 3600);
    await expect(s.bearer()).rejects.toThrow(/sign in/);
    expect(store.items.has(sessionKey(LOCAL_ENV_ID))).toBe(false);
  });

  it("a 401 from its Core signs out (the Core no longer knows the token)", async () => {
    const time = new ManualTime();
    const s = new EnvironmentSession({
      fetch: scriptedFetch(() => apiError(401, "UNAUTHENTICATED")),
      store: new MemorySecureStore(),
      environment: localEnvironment(),
      clock: time,
      timers: time,
    });
    await s.signInLocal(local(time));
    await expect(s.authorized({ method: "GET", path: "/v1/core/apps" })).rejects.toThrow();
    expect(s.state).toBe("signed_out");
  });

  it("sign out calls the Core's logout, and forgets the session even when the Core is unreachable", async () => {
    const time = new ManualTime();
    const f = scriptedFetch((r) => (r.path === "/v1/core/auth/logout" ? { status: 200, body: { ok: true } } : undefined));
    const store = new MemorySecureStore();
    const s = new EnvironmentSession({ fetch: f, store, environment: localEnvironment(), clock: time, timers: time });
    await s.signInLocal(local(time));
    await s.signOut();
    expect(f.requests.map((r) => [r.method, r.path, r.headers.authorization])).toEqual([
      ["POST", "/v1/core/auth/logout", "Bearer local-session-token-0123456789"],
    ]);
    expect(store.items.size).toBe(0);

    const offline = new EnvironmentSession({
      fetch: async () => {
        throw new Error("offline");
      },
      store,
      environment: localEnvironment(),
      clock: time,
      timers: time,
    });
    await offline.signInLocal(local(time));
    await offline.signOut();
    await settle();
    expect(store.items.size).toBe(0);
  });
});

describe("mobile-runtime: environment discovery and sign-in inputs", () => {
  it("normalises addresses; plain http only on the local network", () => {
    expect(normalizeEnvironmentUrl(" wos.example.com/ ")).toEqual({ ok: true, url: "https://wos.example.com" });
    expect(normalizeEnvironmentUrl("http://192.168.1.20:8080")).toEqual({ ok: true, url: "http://192.168.1.20:8080" });
    expect(normalizeEnvironmentUrl("http://wos.example.com").ok).toBe(false);
    expect(normalizeEnvironmentUrl("").ok).toBe(false);
  });

  it("reads /.well-known/wos-environment and refuses a wos_cloud issuer that is not the wOS account service", async () => {
    const d = cloudEnvironment().descriptor;
    const f = scriptedFetch((r) => (r.path === "/.well-known/wos-environment" ? { status: 200, body: d } : undefined));
    await expect(discoverEnvironment(f, "https://core.waronsaas.com")).resolves.toEqual({
      url: "https://core.waronsaas.com",
      descriptor: d,
    });
    expect(TRUSTED_CLOUD_ISSUERS).toEqual(["https://api.waronsaas.com"]);
    expect(checkDescriptor({ ...d, auth: { kind: "wos_cloud", issuer: "https://phish.example" } }, TRUSTED_CLOUD_ISSUERS)).toMatch(
      /not the wOS account service/,
    );
    expect(checkDescriptor({ ...d, apiBase: "http://core.example.com" }, TRUSTED_CLOUD_ISSUERS)).toMatch(/https/);
  });

  it("wOS Cloud sign-in starts as clientKind mobile, with no device key, and keeps the pollSecret from the body (B-0001 ruled)", async () => {
    const answer = { requestId: "0192f000-0000-7000-8000-0000000000aa", pollSecret: "p".repeat(43), expiresAt: "2026-09-30T12:15:00.000Z" };
    const f = scriptedFetch((r) => (r.path === "/v1/auth/email/start" ? { status: 202, body: answer } : undefined));
    await expect(startCloudSignIn(f, ISSUER, " me@example.test ")).resolves.toEqual({ ok: true, ...answer });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({
      method: "POST",
      path: "/v1/auth/email/start",
      body: { email: "me@example.test", clientKind: "mobile", deviceName: "wOS Mobile", devicePublicKey: null },
    });
  });

  it("a build without the mobile client kind still stops at the blocker without calling the control plane", async () => {
    const f = scriptedFetch();
    await expect(startCloudSignIn(f, ISSUER, "me@example.test", null)).resolves.toMatchObject({
      ok: false,
      blocker: "B-0001-mobile-runtime",
    });
    expect(f.requests).toEqual([]);
  });

  it("normalises a typed code", () => {
    expect(normalizeCode("abcd ef23")).toBe("ABCD-EF23");
    expect(normalizeCode("ABCD-EF2")).toBeNull();
    expect(normalizeCode("ABCD-EF10")).toBeNull(); // 1 and 0 are not in the code alphabet
  });
});

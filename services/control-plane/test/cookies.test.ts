/**
 * SECURITY.md S-5 as amended at contracts 5.6.0 (B-0008-control-plane), with production cookie settings: every cookie
 * the control plane sets is host-only on api.waronsaas.com (no Domain attribute, so app., core. and the apex never
 * receive it, A10), HttpOnly (wos_csrf included), Secure and SameSite=Lax. The CSRF value reaches the site in the
 * redeem and refresh bodies (`csrfToken`), equal to the wos_csrf cookie the router compares X-wOS-Csrf with.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createControlPlane } from "../src/app.js";
import { configFromEnv } from "../src/deps.js";
import { createHarness, HAS_DB, type Harness } from "./support/harness.js";

interface Cookie {
  name: string;
  value: string;
  attrs: Map<string, string | true>;
}

const parse = (header: string): Cookie => {
  const [pair, ...rest] = header.split(";").map((s) => s.trim());
  const i = pair!.indexOf("=");
  const attrs = new Map<string, string | true>();
  for (const a of rest) {
    const j = a.indexOf("=");
    attrs.set((j < 0 ? a : a.slice(0, j)).toLowerCase(), j < 0 ? true : a.slice(j + 1));
  }
  return { name: pair!.slice(0, i), value: pair!.slice(i + 1), attrs };
};

describe("cookie scope from the environment", () => {
  it("has no cookie-domain setting at all: production, preview and local are all host-only", () => {
    const base = { CRON_SECRET: "x", SESSION_TOKEN_PEPPER: "x", IP_HASH_SECRET: "x" };
    for (const WOS_ENV of ["production", "preview", "local"]) {
      const config = configFromEnv({ ...base, WOS_ENV });
      expect(config).not.toHaveProperty("cookieDomain");
      expect(config.webOrigin).toBe("https://waronsaas.com");
      expect(config.appOrigin).toBe("https://app.waronsaas.com");
    }
    expect(configFromEnv({ ...base, APP_ORIGIN: "https://app.preview.test" }).appOrigin).toBe("https://app.preview.test");
  });
});

describe.skipIf(!HAS_DB)("S-5: web sign-in cookies with production settings", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("every cookie is host-only, HttpOnly, Secure and SameSite=Lax; the CSRF value comes in the body", async () => {
    const app = createControlPlane({ ...h.deps, config: { ...h.deps.config, env: "production" } });
    const call = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
      app.request(path, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const start = await call("POST", "/v1/auth/email/start", {
      email: "cookie@example.com",
      clientKind: "web",
      deviceName: null,
      devicePublicKey: null,
    });
    expect(start.status, await start.clone().text()).toBe(202);
    const started = start.headers.getSetCookie().map(parse);
    expect(started.map((c) => c.name)).toEqual(["wos_signin"]);
    const { requestId } = (await start.json()) as { requestId: string };
    const redeem = await call(
      "POST",
      "/v1/auth/email/redeem",
      { requestId, pollSecret: null, linkToken: null, code: h.mailer.lastTo("cookie@example.com").code },
      { cookie: `wos_signin=${started[0]!.value}` },
    );
    expect(redeem.status, await redeem.clone().text()).toBe(200);
    const redeemed = (await redeem.json()) as { accessToken: string; refreshToken: string; csrfToken: string };
    const set = [...started, ...redeem.headers.getSetCookie().map(parse)];
    const byName = new Map(set.filter((c) => c.attrs.get("max-age") !== "0").map((c) => [c.name, c]));
    expect([...byName.keys()].sort()).toEqual(["wos_csrf", "wos_refresh", "wos_session", "wos_signin"]);
    for (const c of set) {
      expect(c.attrs.has("domain"), `${c.name} must be host-only`).toBe(false);
      expect(c.attrs.get("secure"), c.name).toBe(true);
      expect(c.attrs.get("samesite"), c.name).toBe("Lax");
      expect(c.attrs.get("httponly"), c.name).toBe(true);
    }
    expect(byName.get("wos_refresh")!.attrs.get("path")).toBe("/v1/auth");
    expect(byName.get("wos_signin")!.attrs.get("path")).toBe("/v1/auth");
    expect(byName.get("wos_session")!.attrs.get("path")).toBe("/");
    expect(byName.get("wos_csrf")!.attrs.get("path")).toBe("/");
    // Tokens never in a web body; the CSRF value is, and it is the cookie's value.
    expect(redeemed.accessToken).toBe("");
    expect(redeemed.refreshToken).toBe("");
    expect(redeemed.csrfToken).toBe(byName.get("wos_csrf")!.value);
    expect(redeemed.csrfToken.length).toBeGreaterThanOrEqual(16);

    const session = byName.get("wos_session")!.value;
    const csrf = redeemed.csrfToken;
    const jar = `wos_session=${session}; wos_csrf=${csrf}`;
    expect((await call("PATCH", "/v1/me", { leaderboardOptIn: true }, { cookie: jar })).status).toBe(403);
    expect((await call("PATCH", "/v1/me", { leaderboardOptIn: true }, { cookie: jar, "x-wos-csrf": "x".repeat(32) })).status).toBe(403);
    expect((await call("PATCH", "/v1/me", { leaderboardOptIn: true }, { cookie: jar, "x-wos-csrf": csrf })).status).toBe(200);

    // Refresh rotates the session and the CSRF value; the new body value matches the new cookie.
    const refresh = await call(
      "POST",
      "/v1/auth/refresh",
      { refreshToken: "" },
      { cookie: `wos_refresh=${byName.get("wos_refresh")!.value}` },
    );
    expect(refresh.status, await refresh.clone().text()).toBe(200);
    const refreshed = (await refresh.json()) as { accessToken: string; csrfToken: string };
    const rotated = new Map(
      refresh.headers
        .getSetCookie()
        .map(parse)
        .map((c) => [c.name, c]),
    );
    for (const c of rotated.values()) {
      expect(c.attrs.has("domain"), c.name).toBe(false);
      expect(c.attrs.get("httponly"), c.name).toBe(true);
    }
    expect(refreshed.accessToken).toBe("");
    expect(refreshed.csrfToken).toBe(rotated.get("wos_csrf")!.value);
    expect(refreshed.csrfToken).not.toBe(csrf);

    // Logout clears the session, refresh and CSRF cookies, host-only too.
    const jar2 = `wos_session=${rotated.get("wos_session")!.value}; wos_csrf=${refreshed.csrfToken}`;
    const out = await call("POST", "/v1/auth/logout", undefined, { cookie: jar2, "x-wos-csrf": refreshed.csrfToken });
    expect(out.status, await out.clone().text()).toBe(200);
    const cleared = out.headers.getSetCookie().map(parse);
    expect(cleared.map((c) => c.name).sort()).toEqual(["wos_csrf", "wos_refresh", "wos_session"]);
    for (const c of cleared) {
      expect(c.attrs.get("max-age"), c.name).toBe("0");
      expect(c.attrs.has("domain"), c.name).toBe(false);
    }
    expect(h.violations).toEqual([]);
  });
});

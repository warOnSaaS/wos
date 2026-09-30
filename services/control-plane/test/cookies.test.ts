/**
 * SECURITY.md S-5 (web cookies and CSRF) with production cookie settings: every cookie the control plane sets on the
 * web sign-in path is Secure and SameSite=Lax, the session and refresh cookies and the sign-in binding are HttpOnly,
 * the double-submit `wos_csrf` is readable by the site, and the Domain attribute is exactly what S-5 specifies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createControlPlane } from "../src/app.js";
import { configFromEnv } from "../src/deps.js";
import { createHarness, HAS_DB, type Harness } from "./support/harness.js";

interface Cookie {
  name: string;
  attrs: Map<string, string | true>;
}

const parse = (header: string): Cookie => {
  const [pair, ...rest] = header.split(";").map((s) => s.trim());
  const name = pair!.slice(0, pair!.indexOf("="));
  const attrs = new Map<string, string | true>();
  for (const a of rest) {
    const i = a.indexOf("=");
    attrs.set((i < 0 ? a : a.slice(0, i)).toLowerCase(), i < 0 ? true : a.slice(i + 1));
  }
  return { name, attrs };
};

describe("cookie domain from the environment", () => {
  it("production scopes cookies to the web origin's host (S-5 Domain=waronsaas.com); other environments are host-only", () => {
    const base = { CRON_SECRET: "x", SESSION_TOKEN_PEPPER: "x", IP_HASH_SECRET: "x" };
    expect(configFromEnv({ ...base, WOS_ENV: "production" }).cookieDomain).toBe("waronsaas.com");
    expect(configFromEnv({ ...base, WOS_ENV: "preview" }).cookieDomain).toBeNull();
    expect(configFromEnv(base).cookieDomain).toBeNull();
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

  it("sets wos_signin, wos_session, wos_refresh (HttpOnly) and wos_csrf (readable), all Secure and SameSite=Lax", async () => {
    const app = createControlPlane({ ...h.deps, config: { ...h.deps.config, env: "production", cookieDomain: "waronsaas.com" } });
    const post = (path: string, body: unknown, cookie?: string) =>
      app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const start = await post("/v1/auth/email/start", {
      email: "cookie@example.com",
      clientKind: "web",
      deviceName: null,
      devicePublicKey: null,
    });
    expect(start.status, await start.clone().text()).toBe(202);
    const started = start.headers.getSetCookie().map(parse);
    expect(started.map((c) => c.name)).toEqual(["wos_signin"]);
    const { requestId } = (await start.json()) as { requestId: string };
    const signin = start.headers.getSetCookie()[0]!.split(";")[0]!;
    const redeem = await post(
      "/v1/auth/email/redeem",
      { requestId, pollSecret: null, linkToken: null, code: h.mailer.lastTo("cookie@example.com").code },
      signin,
    );
    expect(redeem.status, await redeem.clone().text()).toBe(200);
    const set = [...started, ...redeem.headers.getSetCookie().map(parse)];
    const byName = new Map(set.filter((c) => c.attrs.get("max-age") !== "0").map((c) => [c.name, c]));
    expect([...byName.keys()].sort()).toEqual(["wos_csrf", "wos_refresh", "wos_session", "wos_signin"]);
    for (const c of byName.values()) {
      expect(c.attrs.get("secure"), c.name).toBe(true);
      expect(c.attrs.get("samesite"), c.name).toBe("Lax");
      expect(c.attrs.get("domain"), c.name).toBe("waronsaas.com");
      expect(c.attrs.get("httponly"), c.name).toBe(c.name === "wos_csrf" ? undefined : true);
    }
    expect(byName.get("wos_refresh")!.attrs.get("path")).toBe("/v1/auth");
    expect(byName.get("wos_signin")!.attrs.get("path")).toBe("/v1/auth");
    expect(byName.get("wos_session")!.attrs.get("path")).toBe("/");
  });
});

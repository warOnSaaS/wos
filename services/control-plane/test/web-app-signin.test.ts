/**
 * S-43 (contracts 5.6.0, B-0002-suite-shell; migration 0009): authenticated wOS Web signs a wOS account in from its
 * SERVER as clientKind `web_app`. The pollSecret and tokens travel in response bodies only, the emailed link lands on
 * app.waronsaas.com/sign-in/code, and the link or code is redeemable only with the pollSecret of the browser that
 * started (the D8 binding). Single use, 15 minutes, 5 tries; rotating refresh; no cookie anywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, HAS_DB, type Harness } from "./support/harness.js";

describe.skipIf(!HAS_DB)("S-43: web_app sign-in (wOS Web's server)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const start = (email: string, extra: Record<string, unknown> = {}) =>
    h.call("POST", "/v1/auth/email/start", {
      body: { email, clientKind: "web_app", deviceName: null, devicePublicKey: null, ...extra },
    });
  const redeem = (body: Record<string, unknown>) =>
    h.call("POST", "/v1/auth/email/redeem", { body: { linkToken: null, code: null, ...body } });
  const mailText = (email: string) => [...h.mailer.sent].reverse().find((m) => m.to === email)!.text;

  it("start answers the pollSecret in the body, sets no cookie, and emails a link to app.waronsaas.com/sign-in/code", async () => {
    const s = await start("app-link@example.com");
    expect(s.status, JSON.stringify(s.body)).toBe(202);
    expect(typeof s.body.pollSecret).toBe("string");
    expect(s.body.pollSecret.length).toBeGreaterThanOrEqual(32);
    expect(s.headers.getSetCookie()).toEqual([]);
    const link = new URL(/(https:\/\/\S+)/.exec(mailText("app-link@example.com"))![1]!);
    expect(link.origin).toBe("https://app.waronsaas.com");
    expect(link.pathname).toBe("/sign-in/code");
    expect([...link.searchParams.keys()].sort()).toEqual(["r", "t"]);
    expect(link.searchParams.get("r")).toBe(s.body.requestId);
    expect(mailText("app-link@example.com")).toContain("in the browser where you started signing in");
    const [row] = await h.owner<{ client_kind: string; device_public_key: string | null }[]>`
      select client_kind, device_public_key from wos.email_signin_requests where id = ${s.body.requestId}`;
    expect(row).toEqual({ client_kind: "web_app", device_public_key: null });
  });

  it("the web (site) and cli links still land on waronsaas.com/auth/verify, never on app.", async () => {
    await h.call("POST", "/v1/auth/email/start", {
      body: { email: "site-link@example.com", clientKind: "web", deviceName: null, devicePublicKey: null },
    });
    const site = new URL(/(https:\/\/\S+)/.exec(mailText("site-link@example.com"))![1]!);
    expect(`${site.origin}${site.pathname}`).toBe("https://waronsaas.com/auth/verify");
    await h.signIn("cli-link@example.com");
    const cli = new URL(/(https:\/\/\S+)/.exec(mailText("cli-link@example.com"))![1]!);
    expect(`${cli.origin}${cli.pathname}`).toBe("https://waronsaas.com/auth/verify");
  });

  it("refuses a device key: wOS Web's server registers no device", async () => {
    const s = await start("app-device@example.com", { devicePublicKey: Buffer.alloc(32, 7).toString("base64") });
    expect(s.status).toBe(400);
    expect(s.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("the link redeems once, with the starting browser's pollSecret, into body tokens (no cookie, no device)", async () => {
    const s = await start("app-redeem@example.com");
    const { linkToken } = h.mailer.lastTo("app-redeem@example.com");
    // Opened in another browser: wOS Web has no sealed pollSecret for it.
    expect((await redeem({ requestId: s.body.requestId, pollSecret: null, linkToken })).status).toBe(401);
    expect((await redeem({ requestId: s.body.requestId, pollSecret: "another-browsers-secret", linkToken })).status).toBe(401);
    const ok = await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, linkToken });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.accessToken).toMatch(/^wos_at_/);
    expect(ok.body.refreshToken).toMatch(/^wos_rt_/);
    expect(ok.body.deviceId).toBeNull();
    expect(ok.body).not.toHaveProperty("csrfToken");
    expect(ok.headers.getSetCookie()).toEqual([]);
    expect(ok.body.me.email).toBe("app-redeem@example.com");
    // Reuse of the link is refused.
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, linkToken })).status).toBe(401);
    const [session] = await h.owner<{ client_kind: string; device_id: string | null }[]>`
      select client_kind, device_id from wos.sessions where account_id = ${ok.body.me.id}`;
    expect(session).toEqual({ client_kind: "web_app", device_id: null });
    const me = await h.call("GET", "/v1/me", { token: ok.body.accessToken });
    expect(me.status).toBe(200);
  });

  it("the typed code works once and not after 15 minutes", async () => {
    const s = await start("app-code@example.com");
    const { code } = h.mailer.lastTo("app-code@example.com");
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code })).status).toBe(200);
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code })).status).toBe(401);

    const late = await start("app-late@example.com");
    const lateCode = h.mailer.lastTo("app-late@example.com").code;
    await h.owner`update wos.email_signin_requests set created_at = created_at - interval '16 minutes', expires_at = expires_at - interval '16 minutes'
                  where id = ${late.body.requestId}`;
    expect((await redeem({ requestId: late.body.requestId, pollSecret: late.body.pollSecret, code: lateCode })).status).toBe(401);
  });

  it("refresh rotates in the body; a rotated refresh token presented again revokes the family; logout ends it", async () => {
    const s = await start("app-refresh@example.com");
    const { code } = h.mailer.lastTo("app-refresh@example.com");
    const first = (await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code })).body;
    const r1 = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: first.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).toMatch(/^wos_rt_/);
    expect(r1.body).not.toHaveProperty("csrfToken");
    expect(r1.headers.getSetCookie()).toEqual([]);
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: first.refreshToken } })).status).toBe(401);
    expect((await h.call("GET", "/v1/me", { token: r1.body.accessToken })).status).toBe(401);

    const again = await start("app-refresh@example.com");
    const code2 = h.mailer.lastTo("app-refresh@example.com").code;
    const second = (await redeem({ requestId: again.body.requestId, pollSecret: again.body.pollSecret, code: code2 })).body;
    expect((await h.call("POST", "/v1/auth/logout", { token: second.accessToken })).status).toBe(200);
    expect((await h.call("GET", "/v1/me", { token: second.accessToken })).status).toBe(401);
    expect(h.violations).toEqual([]);
  });
});

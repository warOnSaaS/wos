/**
 * B-0001-mobile-runtime (contracts 5.11.0, migration 0011): wOS Mobile signs a wOS account in to wOS Cloud as
 * clientKind `mobile`. The pollSecret and tokens travel in response bodies; no device key is registered; the email
 * carries the code only (no link: a browser could never hold the app's pollSecret). The code is redeemable only with
 * the pollSecret of the app that started (S-2), once, within 15 minutes; refresh rotates in the body; logout ends it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, HAS_DB, type Harness } from "./support/harness.js";

describe.skipIf(!HAS_DB)("B-0001-mobile-runtime: mobile sign-in (wOS Mobile on wOS Cloud)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const start = (email: string, extra: Record<string, unknown> = {}) =>
    h.call("POST", "/v1/auth/email/start", {
      body: { email, clientKind: "mobile", deviceName: "iPhone", devicePublicKey: null, ...extra },
    });
  const redeem = (body: Record<string, unknown>) =>
    h.call("POST", "/v1/auth/email/redeem", { body: { linkToken: null, code: null, ...body } });
  const mailText = (email: string) => [...h.mailer.sent].reverse().find((m) => m.to === email)!.text;

  it("start answers the pollSecret in the body, sets no cookie, and emails the code with no link", async () => {
    const s = await start("phone-start@example.com");
    expect(s.status, JSON.stringify(s.body)).toBe(202);
    expect(typeof s.body.pollSecret).toBe("string");
    expect(s.body.pollSecret.length).toBeGreaterThanOrEqual(32);
    expect(s.headers.getSetCookie()).toEqual([]);
    const text = mailText("phone-start@example.com");
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).toMatch(/Your code: [A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
    expect(text).toContain("wOS Mobile");
    const [row] = await h.owner<{ client_kind: string; device_public_key: string | null }[]>`
      select client_kind, device_public_key from wos.email_signin_requests where id = ${s.body.requestId}`;
    expect(row).toEqual({ client_kind: "mobile", device_public_key: null });
  });

  it("refuses a device key: a phone registers no device", async () => {
    const s = await start("phone-device@example.com", { devicePublicKey: Buffer.alloc(32, 7).toString("base64") });
    expect(s.status).toBe(400);
    expect(s.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("the typed code redeems once, only with the starting app's pollSecret, into body tokens (no cookie, no device)", async () => {
    const s = await start("phone-redeem@example.com");
    const { code } = h.mailer.lastTo("phone-redeem@example.com");
    // Typed on another device: it holds no pollSecret, or another one.
    expect((await redeem({ requestId: s.body.requestId, pollSecret: null, code })).status).toBe(401);
    expect((await redeem({ requestId: s.body.requestId, pollSecret: "another-apps-secret", code })).status).toBe(401);
    const ok = await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.accessToken).toMatch(/^wos_at_/);
    expect(ok.body.refreshToken).toMatch(/^wos_rt_/);
    expect(ok.body.deviceId).toBeNull();
    expect(ok.body).not.toHaveProperty("csrfToken");
    expect(ok.headers.getSetCookie()).toEqual([]);
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code })).status).toBe(401);
    const [session] = await h.owner<{ client_kind: string; device_id: string | null }[]>`
      select client_kind, device_id from wos.sessions where account_id = ${ok.body.me.id}`;
    expect(session).toEqual({ client_kind: "mobile", device_id: null });
    const devices = await h.owner`select 1 from wos.devices where account_id = ${ok.body.me.id}`;
    expect(devices).toHaveLength(0);
    // The phone then lists its organizations (personal first) to mint environment tokens.
    const orgs = await h.call("GET", "/v1/orgs", { token: ok.body.accessToken });
    expect(orgs.status).toBe(200);
    expect(orgs.body.items[0].kind).toBe("personal");
  });

  it("refresh rotates in the body; reuse of a rotated refresh token revokes the family; logout ends it", async () => {
    const s = await start("phone-refresh@example.com");
    const { code } = h.mailer.lastTo("phone-refresh@example.com");
    const first = (await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code })).body;
    const r1 = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: first.refreshToken } });
    expect(r1.status).toBe(200);
    expect(r1.headers.getSetCookie()).toEqual([]);
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: first.refreshToken } })).status).toBe(401);
    expect((await h.call("GET", "/v1/me", { token: r1.body.accessToken })).status).toBe(401);
    const again = await start("phone-refresh@example.com");
    const code2 = h.mailer.lastTo("phone-refresh@example.com").code;
    const second = (await redeem({ requestId: again.body.requestId, pollSecret: again.body.pollSecret, code: code2 })).body;
    expect((await h.call("POST", "/v1/auth/logout", { token: second.accessToken })).status).toBe(200);
    expect((await h.call("GET", "/v1/me", { token: second.accessToken })).status).toBe(401);
    expect(h.violations).toEqual([]);
  });
});

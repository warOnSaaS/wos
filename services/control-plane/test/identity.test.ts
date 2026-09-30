/** D8 identity: email sign-in (S-1..S-3), rotating sessions (S-4), web cookies and CSRF (S-5), GitHub linking (S-6). */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, HAS_DB, type Harness, seedFeature } from "./support/harness.js";

const OTHER_CODE = (code: string) => (code.startsWith("A") ? `B${code.slice(1)}` : `A${code.slice(1)}`);

describe.skipIf(!HAS_DB)("email sign-in (magic link and code)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const start = (email: string, ip = `192.0.2.${Math.floor(Math.random() * 250)}`) =>
    h.call("POST", "/v1/auth/email/start", {
      body: { email, clientKind: "cli", deviceName: "laptop", devicePublicKey: Buffer.alloc(32, email.length).toString("base64") },
      headers: { "x-forwarded-for": ip },
    });
  const redeem = (body: Record<string, unknown>) =>
    h.call("POST", "/v1/auth/email/redeem", { body: { linkToken: null, code: null, ...body } });

  it("magic-link-sign-in R-001 a code is single use", async () => {
    const s = await start("single@example.com");
    const { code } = h.mailer.lastTo("single@example.com");
    const first = await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    const again = await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("magic-link-sign-in R-001 the link token works once too", async () => {
    const s = await start("link@example.com");
    const { linkToken } = h.mailer.lastTo("link@example.com");
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, linkToken })).status).toBe(200);
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, linkToken })).status).toBe(401);
  });

  it("magic-link-sign-in R-001 expires 15 minutes after it was issued", async () => {
    const s = await start("expiry@example.com");
    const expiresIn = Date.parse(s.body.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(14 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    const { code } = h.mailer.lastTo("expiry@example.com");
    await h.owner`update wos.email_signin_requests set created_at = created_at - interval '16 minutes', expires_at = expires_at - interval '16 minutes'
                   where id = ${s.body.requestId}`;
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code })).status).toBe(401);
  });

  it("magic-link-sign-in R-001 stores only hashes: no raw link token, code or poll secret in the row", async () => {
    const s = await start("hashes@example.com");
    const { code, linkToken } = h.mailer.lastTo("hashes@example.com");
    const [row] = await h.owner<{ text: string; link_token_hash: Buffer }[]>`
      select row_to_json(r)::text as text, r.link_token_hash from wos.email_signin_requests r where id = ${s.body.requestId}`;
    for (const secret of [code, code.replace("-", ""), linkToken, s.body.pollSecret]) expect(row!.text).not.toContain(secret);
    expect(Buffer.from(row!.link_token_hash).equals(createHmac("sha256", "test-pepper").update(linkToken).digest())).toBe(true);
    const [mail] = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.outbound_emails where status = 'sent'`;
    expect(mail!.n).toBeGreaterThan(0);
    const [plain] = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.outbound_emails where to_hash::text like '%hashes%'`;
    expect(plain!.n).toBe(0);
  });

  it("magic-link-sign-in R-001 the fifth failed try kills the request", async () => {
    const s = await start("tries@example.com");
    const { code } = h.mailer.lastTo("tries@example.com");
    for (let i = 0; i < 5; i++) {
      expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code: OTHER_CODE(code) })).status).toBe(401);
    }
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, code })).status).toBe(401);
    const [row] = await h.owner<
      { attempts: number; redeemed_at: Date | null }[]
    >`select attempts, redeemed_at from wos.email_signin_requests where id = ${s.body.requestId}`;
    expect(row).toEqual({ attempts: 5, redeemed_at: null });
  });

  it("magic-link-sign-in R-002 the right token with a wrong poll secret fails (binding to the starting client)", async () => {
    const s = await start("bound@example.com");
    const { linkToken } = h.mailer.lastTo("bound@example.com");
    const phished = await redeem({ requestId: s.body.requestId, pollSecret: "not-the-secret", linkToken });
    expect(phished.status).toBe(401);
    const missing = await redeem({ requestId: s.body.requestId, pollSecret: null, linkToken });
    expect(missing.status).toBe(401);
    expect((await redeem({ requestId: s.body.requestId, pollSecret: s.body.pollSecret, linkToken })).status).toBe(200);
  });

  it("magic-link-sign-in R-003 the start response is identical for known and unknown emails", async () => {
    await h.signIn("known@example.com");
    const known = await start("known@example.com");
    const unknown = await start("nobody-yet@example.com");
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    const shape = (b: Record<string, unknown>) => Object.entries(b).map(([k, v]) => [k, typeof v, typeof v === "string" ? v.length : 0]);
    expect(shape(known.body)).toEqual(shape(unknown.body));
    expect([...known.headers.keys()].sort()).toEqual([...unknown.headers.keys()].sort());
    const [n] = await h.owner<
      { n: number }[]
    >`select count(*)::int as n from wos.account_emails where email_normalized = 'nobody-yet@example.com'`;
    expect(n!.n).toBe(0); // accounts are created on first redeem only
  });

  it("magic-link-sign-in R-003 limits starts to 5 per email per hour", async () => {
    for (let i = 0; i < 5; i++) expect((await start("Limit@Example.com")).status).toBe(202);
    const sixth = await start("limit@example.com");
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("RATE_LIMITED");
  });

  it("magic-link-sign-in R-003 limits starts to 20 per IP per hour", async () => {
    for (let i = 0; i < 20; i++) expect((await start(`ip${i}@example.com`, "198.51.100.7")).status).toBe(202);
    expect((await start("ip20@example.com", "198.51.100.7")).status).toBe(429);
    expect((await start("ip20@example.com", "198.51.100.8")).status).toBe(202);
  });

  it("web sign-in keeps the poll secret in an HttpOnly cookie and enforces the CSRF header (S-5)", async () => {
    const s = await h.call("POST", "/v1/auth/email/start", {
      body: { email: "web@example.com", clientKind: "web", deviceName: null, devicePublicKey: null },
    });
    expect(s.status).toBe(202);
    expect(s.body.pollSecret).toBeNull();
    const signin = /wos_signin=([^;]+);/.exec(s.headers.get("set-cookie") ?? "")![1]!;
    expect(s.headers.get("set-cookie")).toContain("HttpOnly");
    const { code } = h.mailer.lastTo("web@example.com");
    const r = await h.call("POST", "/v1/auth/email/redeem", {
      body: { requestId: s.body.requestId, pollSecret: null, linkToken: null, code },
      headers: { cookie: `wos_signin=${signin}` },
    });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBe("");
    const cookies = r.headers.getSetCookie();
    const session = /wos_session=([^;]+)/.exec(cookies.find((c) => c.startsWith("wos_session="))!)![1]!;
    // S-5 as amended at 5.6.0: wos_csrf is HttpOnly too; the site gets the value from the body.
    const csrf = r.body.csrfToken as string;
    expect(cookies.find((c) => c.startsWith("wos_session="))).toContain("HttpOnly");
    expect(cookies.find((c) => c.startsWith("wos_csrf="))).toContain("HttpOnly");
    expect(cookies.find((c) => c.startsWith("wos_csrf="))).toContain(`wos_csrf=${csrf};`);
    const me = await h.call("GET", "/v1/me", { headers: { cookie: `wos_session=${session}` } });
    expect(me.body.email).toBe("web@example.com");
    const noHeader = await h.call("PATCH", "/v1/me", {
      body: { leaderboardOptIn: true },
      headers: { cookie: `wos_session=${session}; wos_csrf=${csrf}` },
    });
    expect(noHeader.status).toBe(403);
    const withHeader = await h.call("PATCH", "/v1/me", {
      body: { leaderboardOptIn: true },
      headers: { cookie: `wos_session=${session}; wos_csrf=${csrf}`, "x-wos-csrf": csrf },
    });
    expect(withHeader.status).toBe(200);
    expect(withHeader.body.leaderboardOptIn).toBe(true);
  });

  it("CORS allows only the website origin with credentials", async () => {
    const ok = await h.app.request("/v1/public/targets", { headers: { origin: "https://waronsaas.com" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://waronsaas.com");
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const evil = await h.app.request("/v1/public/targets", { headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never violates the route contract", () => {
    expect(h.violations).toEqual([]);
  });
});

describe.skipIf(!HAS_DB)("sessions (S-4)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("device-sessions R-001 refresh rotates, and reusing a rotated refresh token revokes the whole family", async () => {
    const a = await h.signIn("rotate@example.com");
    const r1 = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: a.refresh } });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(a.refresh);
    expect((await h.call("GET", "/v1/me", { token: r1.body.accessToken })).status).toBe(200);
    // The rotated pair's access token stops working.
    expect((await h.call("GET", "/v1/me", { token: a.token })).status).toBe(401);
    // Theft signal: the old refresh token is presented again.
    const reuse = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: a.refresh } });
    expect(reuse.status).toBe(401);
    expect((await h.call("GET", "/v1/me", { token: r1.body.accessToken })).status).toBe(401);
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: r1.body.refreshToken } })).status).toBe(401);
    const [n] = await h.owner<{ n: number }[]>`
      select count(*)::int as n from wos.sessions where account_id = ${a.id} and revoked_at is null`;
    expect(n!.n).toBe(0);
  });

  it("logout revokes the family; tokens are stored only as hashes", async () => {
    const a = await h.signIn("logout@example.com");
    const [row] = await h.owner<{ text: string }[]>`select row_to_json(s)::text as text from wos.sessions s where account_id = ${a.id}`;
    expect(row!.text).not.toContain(a.token);
    expect(row!.text).not.toContain(a.refresh);
    expect((await h.call("POST", "/v1/auth/logout", { token: a.token })).status).toBe(200);
    expect((await h.call("GET", "/v1/me", { token: a.token })).status).toBe(401);
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: a.refresh } })).status).toBe(401);
  });

  it("a desktop/CLI sign-in registers the device key once", async () => {
    const a = await h.signIn("device@example.com");
    const [d] = await h.owner<{ client_kind: string }[]>`select client_kind from wos.devices where id = ${a.deviceId}`;
    expect(d!.client_kind).toBe("cli");
  });
});

describe.skipIf(!HAS_DB)("GitHub identity link (S-6)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const linkAttempt = async (token: string, userId: number, login: string) => {
    const s = await h.call("POST", "/v1/me/github/link", { token, body: { flow: "device" } });
    if (s.status !== 200) return s;
    const [req] = await h.owner<{ device_code: string }[]>`select device_code from wos.github_link_requests where id = ${s.body.linkId}`;
    h.github.deviceGrants.set(req!.device_code, {
      status: "ok",
      user: { userId, login, createdAt: "2020-01-01T00:00:00Z", avatarUrl: null },
    });
    return h.call("POST", "/v1/me/github/link/poll", { token, body: { linkId: s.body.linkId } });
  };

  it("contributor routes require a linked GitHub (GITHUB_REQUIRED)", async () => {
    const a = await h.signIn("nogithub@example.com");
    const r = await h.call("GET", "/v1/me/work", { token: a.token });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("GITHUB_REQUIRED");
  });

  it("github-identity-link R-001 one GitHub per account and one account per GitHub", async () => {
    const alice = await h.contributor("alice-gh", { githubUserId: 9001 });
    expect((await h.call("GET", "/v1/me", { token: alice.token })).body.github.userId).toBe(9001);
    const second = await h.call("POST", "/v1/me/github/link", { token: alice.token, body: { flow: "device" } });
    expect(second.status).toBe(409);
    const bob = await h.signIn("bob-gh@example.com");
    const stolen = await linkAttempt(bob.token, 9001, "alice-gh");
    expect(stolen.status).toBe(409);
    expect(stolen.body.error.code).toBe("GITHUB_LINKED_ELSEWHERE");
    const me = await h.call("GET", "/v1/me", { token: bob.token });
    expect(me.body.github).toBeNull();
    expect(me.body.canContribute).toBe(false);
  });

  it("github-identity-link R-002 unlink is refused while a lease is active; the identity stays reserved 90 days", async () => {
    const seeded = await seedFeature(h.owner, { feature: "invoices", abus: [{ n: "01", write: ["modules/invoices/**"] }] });
    const carol = await h.contributor("carol-gh", { githubUserId: 9100 });
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: carol.token,
      idem: true,
      body: { deviceId: carol.deviceId },
    });
    expect(claim.status).toBe(200);
    const busy = await h.call("POST", "/v1/me/github/unlink", { token: carol.token, idem: true, body: { confirm: true } });
    expect(busy.status).toBe(409);
    await h.call("POST", `/v1/leases/${claim.body.lease.id}/release`, { token: carol.token, idem: true, body: { reason: "done" } });
    const ok = await h.call("POST", "/v1/me/github/unlink", { token: carol.token, idem: true, body: { confirm: true } });
    expect(ok.status).toBe(200);
    expect(ok.body.github).toBeNull();
    expect(ok.body.handle).toBe("carol-gh"); // the handle never changes
    const [hist] = await h.owner<{ days: number }[]>`
      select round(extract(epoch from reserved_until - occurred_at) / 86400)::int as days from wos.github_identity_history
       where github_user_id = 9100 and action = 'unlinked'`;
    expect(hist!.days).toBe(90);
    const dave = await h.signIn("dave-gh@example.com");
    const reserved = await linkAttempt(dave.token, 9100, "carol-gh");
    expect(reserved.body.error.code).toBe("GITHUB_RESERVED");
    const back = await linkAttempt(carol.token, 9100, "carol-gh");
    expect(back.body.status).toBe("linked");
  });

  it("the web OAuth callback links through a hashed state and redirects", async () => {
    const erin = await h.signIn("erin-gh@example.com");
    const s = await h.call("POST", "/v1/me/github/link", { token: erin.token, body: { flow: "web" } });
    const state = new URL(s.body.authorizeUrl).searchParams.get("state")!;
    h.github.deviceGrants.set("oauth-code-1", {
      status: "ok",
      user: { userId: 9200, login: "erin-gh", createdAt: "2019-01-01T00:00:00Z", avatarUrl: null },
    });
    const cb = await h.app.request(`/v1/github/oauth/callback?code=oauth-code-1&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("https://waronsaas.com/account?github=linked");
    const [row] = await h.owner<
      { text: string }[]
    >`select row_to_json(r)::text as text from wos.github_link_requests r where id = ${s.body.linkId}`;
    expect(row!.text).not.toContain(state);
    expect((await h.call("GET", "/v1/me", { token: erin.token })).body.github.login).toBe("erin-gh");
  });

  it("never violates the route contract", () => {
    expect(h.violations).toEqual([]);
  });
});

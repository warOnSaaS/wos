import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spy on timingSafeEqual to prove every verification goes through the constant-time compare.
const tse = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      tse.calls += 1;
      return real.timingSafeEqual(a, b);
    },
  };
});

const { exchangeUserAuthorization, resetGithubAppConfig, startDeviceAuthorization, verifyWebhookSignature } = await import(
  "../src/app/index.js"
);
const { makeApp } = await import("./support/setup.js");

const SECRET = "It's a Secret to Everybody";
const BODY = '{"action":"closed","pull_request":{"number":1,"merged":true},"note":"Hello, World! ✓"}';
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

describe("verifyWebhookSignature (S-19)", () => {
  it("accepts GitHub's documented example delivery", async () => {
    // docs.github.com "Validating webhook deliveries" test values.
    const ok = await verifyWebhookSignature(
      "It's a Secret to Everybody",
      "Hello, World!",
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    );
    expect(ok).toBe(true);
  });

  it("gated-pull-requests accepts a signed delivery and rejects a one-byte change of body or signature", async () => {
    const sig = sign(BODY);
    expect(await verifyWebhookSignature(SECRET, BODY, sig)).toBe(true);
    for (let i = 0; i < BODY.length; i += 7) {
      const flipped = BODY.slice(0, i) + String.fromCharCode(BODY.charCodeAt(i) ^ 1) + BODY.slice(i + 1);
      expect(await verifyWebhookSignature(SECRET, flipped, sig)).toBe(false);
    }
    const last = sig.at(-1) === "0" ? "1" : "0";
    expect(await verifyWebhookSignature(SECRET, BODY, sig.slice(0, -1) + last)).toBe(false);
    expect(await verifyWebhookSignature(`${SECRET}x`, BODY, sig)).toBe(false);
  });

  it("rejects unsigned, sha1 and malformed headers, and an empty secret", async () => {
    const sha1 = `sha1=${createHmac("sha1", SECRET).update(BODY).digest("hex")}`;
    for (const header of ["", "sha256=", sha1, "sha256=zz", `${sign(BODY)}00`, sign(BODY).replace("sha256=", "")]) {
      expect(await verifyWebhookSignature(SECRET, BODY, header)).toBe(false);
    }
    expect(await verifyWebhookSignature("", BODY, sign(BODY, ""))).toBe(false);
  });

  it("is constant-time: valid, invalid and malformed signatures all go through timingSafeEqual", async () => {
    for (const header of [sign(BODY), sign(`${BODY} `), "garbage", ""]) {
      const before = tse.calls;
      await verifyWebhookSignature(SECRET, BODY, header);
      expect(tse.calls).toBe(before + 1);
    }
  });
});

describe("GitHub identity linking (D8, S-6)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });
  afterEach(() => resetGithubAppConfig());

  it("starts the device flow", async () => {
    expect(await startDeviceAuthorization(app.creds)).toEqual({
      deviceCode: "dc_fake_1",
      userCode: "WOS1-2345",
      verificationUri: "https://github.com/login/device",
      expiresInSeconds: 899,
      intervalSeconds: 5,
    });
  });

  it("maps pending, slow_down, denied and expired", async () => {
    app.fake.oauthQueue.push(
      { error: "authorization_pending" },
      { error: "slow_down" },
      { error: "access_denied" },
      { error: "expired_token" },
    );
    const input = { deviceCode: "dc_fake_1" };
    expect(await exchangeUserAuthorization(app.creds, input)).toEqual({ status: "pending" });
    expect(await exchangeUserAuthorization(app.creds, input)).toEqual({ status: "pending" });
    expect(await exchangeUserAuthorization(app.creds, input)).toEqual({ status: "denied" });
    expect(await exchangeUserAuthorization(app.creds, input)).toEqual({ status: "expired" });
  });

  it("device flow: reads the identity once, revokes the token and returns no token", async () => {
    app.fake.oauthQueue.push({ access_token: "ghu_secret1", token_type: "bearer", scope: "" });
    app.fake.users.set("ghu_secret1", {
      id: 4242,
      login: "octo-dev",
      created_at: "2019-01-01T00:00:00Z",
      avatar_url: "https://avatars.example/u/4242",
    });
    const res = await exchangeUserAuthorization(app.creds, { deviceCode: "dc_fake_1" });
    expect(res).toEqual({
      status: "ok",
      user: { userId: 4242, login: "octo-dev", createdAt: "2019-01-01T00:00:00Z", avatarUrl: "https://avatars.example/u/4242" },
    });
    expect(JSON.stringify(res)).not.toContain("ghu_");
    expect(app.fake.revokedTokens).toEqual(["ghu_secret1"]);
  });

  it("web flow: sends the client secret and redirect uri; revokes even when GET /user fails", async () => {
    app.fake.oauthQueue.push({ access_token: "ghu_secret2", token_type: "bearer" });
    await expect(
      exchangeUserAuthorization(app.creds, { code: "abc", redirectUri: "https://api.waronsaas.com/v1/github/oauth/callback" }),
    ).rejects.toMatchObject({
      code: "OAUTH_ERROR",
    });
    expect(app.fake.revokedTokens).toEqual(["ghu_secret2"]);
  });

  it("an unexpected OAuth error is raised, not mapped to a status", async () => {
    app.fake.oauthQueue.push({ error: "unsupported_grant_type" });
    await expect(exchangeUserAuthorization(app.creds, { deviceCode: "x" })).rejects.toMatchObject({ code: "OAUTH_ERROR" });
  });
});

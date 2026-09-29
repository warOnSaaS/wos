import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resendMailer } from "../src/deps.js";
import { createHarness, HAS_DB, type Harness, seedFeature } from "./support/harness.js";
import { buildAndSubmit } from "./support/flow.js";

describe("transactional email", () => {
  it("transactional-email R-001 sends from the notify subdomain through Resend, never the apex", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const mailer = resendMailer({ RESEND_API_KEY: "re_test" }, () => {});
      const out = await mailer.send({
        template: "signin",
        to: "a@example.com",
        subject: "Your warOnSaaS sign-in code",
        text: "x",
        html: "<p>x</p>",
      });
      expect(out.providerId).toBe("re_1");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      const body = JSON.parse(String(init.body)) as { from: string; to: string[] };
      expect(body.from).toBe("warOnSaaS <signin@notify.waronsaas.com>");
      expect(body.from).not.toMatch(/@waronsaas\.com>$/);
      expect(body.to).toEqual(["a@example.com"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe.skipIf(!HAS_DB)("contributor profile", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("contributor-profile R-001 a contributor sees contributions and token history, and controls the opt-in", async () => {
    const seeded = await seedFeature(h.owner, { feature: "profile", abus: [{ n: "01", write: ["modules/profile/**"] }] });
    const b = await h.contributor("profiled");
    await buildAndSubmit(h, b, seeded.abus.get("01")!, [{ path: "modules/profile/a.ts", content: "a" }]);
    const profile = await h.call("GET", "/v1/public/contributors/profiled");
    expect(profile.status).toBe(200);
    expect(profile.body.leaderboardOptIn).toBe(false);
    expect(profile.body.score).toBeNull(); // score shown only when opted in
    expect((await h.call("GET", "/v1/public/contributors/profiled/ledger")).status).toBe(404);
    const optIn = await h.call("PATCH", "/v1/me", { token: b.token, body: { leaderboardOptIn: true } });
    expect(optIn.body.leaderboardOptIn).toBe(true);
    expect((await h.call("GET", "/v1/public/contributors/profiled")).body.score).toBe(0);
    const ledger = await h.call("GET", "/v1/public/contributors/profiled/ledger");
    expect(ledger.status).toBe(200);
    expect(ledger.body.items).toEqual([]);
    const board = await h.call("GET", "/v1/public/leaderboard");
    expect(board.body.disclaimer).toBe("WOS tokens are in-app credits with no cash value.");
    expect((await h.call("GET", "/v1/public/contributors/nobody-here")).status).toBe(404);
    expect(h.violations).toEqual([]);
  });
});

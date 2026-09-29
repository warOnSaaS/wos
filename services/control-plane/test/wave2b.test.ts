/** Wave 2b (WORKSTREAMS.md sections 8, 10, 11.3): rewards loader end to end, D13 toolchain at claim, D15 builtWith. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import {
  BASE_SHA,
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  REPO_MANIFEST,
  seedFeature,
  verdict,
  webhookHeaders,
} from "./support/harness.js";

describe.skipIf(!HAS_DB)("Wave 2b", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  const hook = (event: string, body: unknown) => h.call("POST", "/v1/github/webhook", { body, headers: webhookHeaders(event, body) });
  const cron = (p: string) => h.call("GET", p, { headers: { authorization: `Bearer ${CRON_SECRET}` } });

  it("tokens are written for a merged unit end to end: implementation, reviews, feature pool, application pool, release", async () => {
    h.deps.schedule = { ...h.deps.schedule, holdDays: 0 }; // releases due immediately, so the sweep can be proved here
    const seeded = await seedFeature(h.owner, {
      feature: "paid",
      target: "docusign",
      abus: [{ n: "01", write: ["modules/paid/**"], size: 3 }],
    });
    const builder = await h.contributor("paid-builder");
    const astra = await h.contributor("paid-astra");
    const fable = await h.contributor("paid-fable");
    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [{ path: "modules/paid/a.ts", content: "export {};" }]);
    expect(b.submit.status).toBe(200);
    const head = h.github.commits.at(-1)!.sha;
    await hook("check_suite", {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 71, head_sha: head, conclusion: "success" },
    });
    await reviewAs(h, astra, "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await reviewAs(h, fable, "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await cron("/v1/cron/dispatch");
    const pr = h.github.prs.at(-1)!;
    await hook("pull_request", {
      action: "closed",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: pr.number, merged: true, merge_commit_sha: "5".repeat(40) },
    });
    const awards = async () =>
      h.owner<{ account_id: string; category: string; amount: string }[]>`
        select account_id, category, amount from wos.ledger_entries where kind = 'award' order by category, account_id`;
    const s = h.deps.schedule;
    const paid = (await awards()).map((a) => [a.category, a.account_id, Number(a.amount)]);
    expect(paid).toEqual(
      expect.arrayContaining([
        ["implementation", builder.id, s.implementation.tokensPerSizePoint * 3],
        ["review", astra.id, s.review.implementationReviewPerSizePoint * 3],
        ["review", fable.id, s.review.implementationReviewPerSizePoint * 3],
      ]),
    );
    // Profile acceptance -> feature BUILT -> feature completion pool; the app is 100% built -> application pool.
    await hook("check_run", {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_run: {
        id: 72,
        name: "wos-acceptance/paid/docusign/web",
        head_sha: "5".repeat(40),
        conclusion: "success",
        check_suite: { id: 73 },
      },
    });
    await cron("/v1/cron/dispatch");
    const pools = await h.owner<{ kind: string; state: string; amount: string }[]>`
      select p.kind, p.state, p.amount from wos.reward_pools p join wos.targets t on t.id = p.target_id where t.slug = 'docusign' order by p.kind`;
    expect(pools.map((p) => [p.kind, p.state])).toEqual([
      ["application_completion", "distributed"],
      ["feature_completion", "distributed"],
    ]);
    const after = (await awards()).map((a) => a.category);
    expect(after).toContain("feature_completion_pool");
    expect(after).toContain("application_completion_pool");
    // The sweeper releases every award through computeReleaseDrafts.
    const sweep = await cron("/v1/cron/sweep");
    expect(sweep.body.released).toBeGreaterThanOrEqual(5);
    const me = await h.call("GET", "/v1/me", { token: builder.token });
    expect(me.body.balance.held).toBe(0);
    expect(me.body.balance.available).toBeGreaterThan(s.implementation.tokensPerSizePoint * 3);
    // Replays write nothing new.
    const count = (await h.owner<{ n: number }[]>`select count(*)::int as n from wos.ledger_entries`)[0]!.n;
    await cron("/v1/cron/dispatch");
    await cron("/v1/cron/sweep");
    expect((await h.owner<{ n: number }[]>`select count(*)::int as n from wos.ledger_entries`)[0]!.n).toBe(count);
    // D15 provenance and view: the unit records which provider and model built it.
    const attempt = await h.call("GET", `/v1/attempts/${b.attemptId}`, { token: builder.token });
    expect(attempt.body.builtWith).toEqual({ provider: "claude_cli", model: "opus", modelId: "claude-opus-5-5" });
    const [prov] = await h.owner<{ record: { agentRuns: Array<{ provider?: string; role: string }> } }[]>`
      select p.record from wos.provenance_records p join wos.pull_requests r on r.id = p.pull_request_id where r.attempt_id = ${b.attemptId}`;
    expect(prov!.record.agentRuns.every((r) => r.provider === "claude_cli" || r.provider === "codex_cli")).toBe(true);
    expect(h.violations).toEqual([]);
  });

  it("D13: a Linux device cannot claim an ABU under apps/mobile/ios/**; a macOS device with Xcode can; JS-only mobile needs nothing", async () => {
    const manifest = {
      ...REPO_MANIFEST,
      toolchainRequirements: [
        { id: "ios-native", paths: ["apps/mobile/ios/**"], os: ["macos"], tools: [{ name: "xcode", minVersion: "17.0" }] },
      ],
    };
    h.github.putFile("waronsaas/product", BASE_SHA, "wos.json", JSON.stringify(manifest));
    const seeded = await seedFeature(h.owner, {
      feature: "native",
      target: "slack",
      abus: [
        { n: "01", write: ["apps/mobile/ios/**"] },
        { n: "02", write: ["apps/mobile/src/**"] },
      ],
    });
    const attest = async (
      acct: { token: string; deviceId: string },
      os: "linux" | "macos",
      tools: Array<{ name: "xcode" | "node"; version: string }>,
    ) =>
      h.call("POST", "/v1/me/attestations", {
        token: acct.token,
        idem: true,
        body: { deviceId: acct.deviceId, providers: [], toolchain: { os, osVersion: "1", tools, checkedAt: new Date().toISOString() } },
      });
    const linux = await h.contributor("linux-dev");
    expect((await attest(linux, "linux", [{ name: "node", version: "22.12.0" }])).status).toBe(200);
    const [stored] = await h.owner<{ os: string }[]>`select os from wos.toolchain_attestations where account_id = ${linux.id}`;
    expect(stored!.os).toBe("linux");
    const refused = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: linux.token,
      idem: true,
      body: { deviceId: linux.deviceId },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("NOT_ELIGIBLE");
    expect(JSON.stringify(refused.body.error.details)).toContain("ios-native");
    const jsOnly = await h.call("POST", `/v1/abus/${seeded.abus.get("02")}/claim`, {
      token: linux.token,
      idem: true,
      body: { deviceId: linux.deviceId },
    });
    expect(jsOnly.status).toBe(200);
    const oldXcode = await h.contributor("old-xcode");
    await attest(oldXcode, "macos", [{ name: "xcode", version: "16.4" }]);
    expect(
      (
        await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
          token: oldXcode.token,
          idem: true,
          body: { deviceId: oldXcode.deviceId },
        })
      ).body.error.code,
    ).toBe("NOT_ELIGIBLE");
    const mac = await h.contributor("mac-dev");
    await attest(mac, "macos", [{ name: "xcode", version: "17.1" }]);
    const ok = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: mac.token,
      idem: true,
      body: { deviceId: mac.deviceId },
    });
    expect(ok.status).toBe(200);
    h.github.files.delete(`waronsaas/product@${BASE_SHA}:wos.json`);
  });
});

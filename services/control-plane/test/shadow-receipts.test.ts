/**
 * P1 shadow accounting, first slice (contracts 5.20.0): the public receipt routes. A real contribution is driven end
 * to end (build -> review -> PR -> merge), then: the list is newest first with honest counts, the detail carries the
 * agent runs with hashes and usage as reported, the review rounds with their labels and verdicts, the outcome, the
 * shadow budget ("shadow — no value", the frozen protocol's own numbers), and a receipt hash anyone recomputes.
 * Sealed reviews never leak (RLS: a round that is not revealed lists with its state and no verdicts), and no private
 * field (email, device, lease, account id, signature) ever appears. A roadmap author's document gets a receipt too.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Routes, shadowReceiptSha256 } from "@waronsaas/contracts";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import { authorRevision, roadmapFiles } from "./support/roadmap-fixture.js";
import {
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Account,
  type Harness,
  manifestFor,
  seedFeature,
  signedChangeset,
  signedRun,
  verdict,
  webhookHeaders,
} from "./support/harness.js";

describe.skipIf(!HAS_DB)("P1 shadow receipts: the public routes", () => {
  let h: Harness;
  // Set by the first test, asserted by the second (tests run in order within the file).
  let attemptId = "";
  let secondAttemptId = "";
  let documentId = "";
  let builder: Account;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("a merged ABU build gets a public receipt: runs, reviews, outcome, shadow budget, verifiable hash", async () => {
    const cron = { authorization: `Bearer ${CRON_SECRET}` };
    const dispatch = () => h.call("GET", "/v1/cron/dispatch", { headers: cron });

    const seeded = await seedFeature(h.owner, {
      abus: [
        { n: "01", write: ["modules/contacts/a/**"] },
        { n: "02", write: ["modules/contacts/b/**"] },
      ],
    });
    const builderAcct = await h.contributor("shadow-builder");
    builder = builderAcct;

    // Build -> manifest -> TWO signed runs (the second with usageDetail, contracts 5.19.0: cost as reported)
    // -> verifying -> changeset. Inlined like buildAndSubmit so the second run lands before the lease completes.
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")!}/claim`, {
      token: builder.token,
      idem: true,
      body: { deviceId: builder.deviceId },
    });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    const plan = claim.body.contextPlan;
    const leaseId = claim.body.lease.id;
    attemptId = claim.body.attempt.id;
    const m = await manifestFor(h, plan, "abu_build");
    expect((await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: builder.token, idem: true, body: m })).status).toBe(200);
    expect(
      (
        await h.call("POST", `/v1/leases/${leaseId}/agent-runs`, {
          token: builder.token,
          idem: true,
          body: signedRun(builder.key, plan, leaseId, builder.deviceId, m.manifestSha256),
        })
      ).status,
    ).toBe(200);
    const second = await h.call("POST", `/v1/leases/${leaseId}/agent-runs`, {
      token: builder.token,
      idem: true,
      body: signedRun(builder.key, plan, leaseId, builder.deviceId, m.manifestSha256, {
        usageDetail: {
          inputTokens: 1200,
          outputTokens: 300,
          reasoningTokens: 100,
          cacheReadTokens: 50,
          cacheWriteTokens: 10,
          costUsd: 0.5,
          steps: 2,
          lastFinishReason: "stop",
        },
      }),
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(
      (
        await h.call("POST", `/v1/attempts/${attemptId}/phase`, {
          token: builder.token,
          idem: true,
          body: { phase: "verifying", localRepair: false },
        })
      ).status,
    ).toBe(200);
    const cs = signedChangeset(builder.key, {
      taskId: plan.taskId,
      leaseId,
      deviceId: builder.deviceId,
      parentCommit: plan.source.commit,
      manifestSha256: m.manifestSha256,
      files: [{ path: "modules/contacts/a/x.ts", content: "a\n" }],
    });
    const submit = await h.call("POST", `/v1/leases/${leaseId}/changeset`, { token: builder.token, idem: true, body: cs });
    expect(submit.status, JSON.stringify(submit.body)).toBe(200);

    // Sealed until revealed: after Astra's verdict only, the round lists with its state and no verdicts.
    const head = h.github.commits.at(-1)!.sha;
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 10, head_sha: head, conclusion: "success" },
    };
    await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    await reviewAs(h, await h.contributor("shadow-astra"), "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    const sealed = await h.call("GET", `/v1/public/receipts/${attemptId}`);
    expect(sealed.status).toBe(200);
    expect(sealed.body.rounds.at(-1).state).toBe("awaiting_reviews");
    expect(sealed.body.rounds.at(-1).reviews).toEqual([]);
    expect(sealed.body.reviewCount).toBe(0);

    // Both seats: the round reveals, the PR opens, merges, the contribution is recorded.
    await reviewAs(h, await h.contributor("shadow-fable"), "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await dispatch();
    const pr = h.github.prs.at(-1)!;
    const merged = {
      action: "closed",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: pr.number, merged: true, merge_commit_sha: "9".repeat(40), user: { login: "waronsaas-wos[bot]" } },
    };
    expect((await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) })).status).toBe(
      200,
    );
    await dispatch();

    const detail = await h.call("GET", `/v1/public/receipts/${attemptId}`);
    expect(detail.status).toBe(200);
    expect(Routes.getShadowReceipt.response.safeParse(detail.body).success, JSON.stringify(detail.body)).toBe(true);
    expect(detail.body.kind).toBe("abu_build");
    expect(detail.body.handle).toBe(builder.handle);
    expect(detail.body.abu).toBe("contacts#01");
    expect(detail.body.abuTitle).toBe("Unit 01");
    expect(detail.body.target).toBe("salesforce");
    expect(detail.body.provider).toBe(plan.provider);
    expect(detail.body.modelId).toBe(plan.modelId);
    expect(detail.body.runCount).toBe(2);
    expect(detail.body.runs.map((r: { inputTokens: number | null }) => r.inputTokens)).toEqual([1, 1200]);
    expect(detail.body.costUsd).toBe(0.5); // as reported, summed over the runs that report one
    expect(detail.body.roundCount).toBe(1);
    expect(detail.body.reviewCount).toBe(2);
    expect(detail.body.rounds[0].state).toBe("revealed");
    expect(detail.body.rounds[0].outcome).toBe("consensus");
    expect(new Set(detail.body.rounds[0].reviews.map((r: { slot: string }) => r.slot))).toEqual(new Set(["astra", "fable"]));
    expect(detail.body.rounds[0].reviews.every((r: { verdict: string }) => r.verdict === "NO_MATERIAL_GAPS")).toBe(true);
    expect(detail.body.outcome.merged).toBe(true);
    expect(detail.body.outcome.pr.number).toBe(pr.number);
    expect(["pending", "accepted"]).toContain(detail.body.outcome.contribution);
    expect(detail.body.shadowBudget).toMatchObject({
      label: "shadow — no value",
      taskKind: "abu_build",
      sizePoints: 2,
      budgetAcuMicro: "8000000",
      basePriceAcuMicro: "6666666",
      queueBonusBp: 2000,
    });
    // S-2: the hash is recomputable by anyone from the served JSON.
    expect(detail.body.receiptSha256).toBe(shadowReceiptSha256(detail.body));
    expect(detail.body.runs.every((r: { manifestSha256: string }) => /^sha256:[0-9a-f]{64}$/.test(r.manifestSha256))).toBe(true);

    // No private field ever appears: no email, no device id, no account id, no lease id, no signature.
    const raw = JSON.stringify(detail.body);
    expect(raw).not.toContain(builder.email);
    expect(raw).not.toContain(builder.deviceId);
    expect(raw).not.toContain(builder.id);
    expect(raw).not.toContain(leaseId);
    expect(raw).not.toContain("signature");
  });

  it("a submitted-but-unreviewed attempt and a roadmap author's document get receipts too; the list is newest first", async () => {
    // A second submitted attempt: no reviews yet, outcome still in the pipeline.
    const [abu02] = await h.owner<{ id: string }[]>`
      select id from wos.abus where key = 'contacts#02' limit 1`;
    const b2 = await buildAndSubmit(h, builder, abu02!.id, [{ path: "modules/contacts/b/y.ts", content: "b\n" }]);
    expect(b2.submit.status, JSON.stringify(b2.submit.body)).toBe(200);
    secondAttemptId = b2.attemptId;

    // Roadmap author work: a document that reached review gets a receipt with its own budget.
    const maint = await h.contributor("shadow-maint", { maintainer: true });
    const slack = await h.call("POST", "/v1/admin/targets/slack/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "Shadow receipts: a roadmap author run" },
    });
    expect(slack.status, JSON.stringify(slack.body)).toBe(200);
    const authored = await authorRevision(h, builder, slack.body.taskId, roadmapFiles({ target: "slack", feature: "chat" }));
    expect(authored.res.status, JSON.stringify(authored.res.body)).toBe(200);
    documentId = authored.claim.body.task.documentId;

    const doc = await h.call("GET", `/v1/public/receipts/${documentId}`);
    expect(doc.status).toBe(200);
    expect(Routes.getShadowReceipt.response.safeParse(doc.body).success, JSON.stringify(doc.body)).toBe(true);
    expect(doc.body.kind).toBe("roadmap_author");
    expect(doc.body.documentKind).toBe("roadmap");
    expect(doc.body.documentVersion).toBe(1);
    expect(doc.body.target).toBe("slack");
    expect(doc.body.handle).toBe(builder.handle);
    expect(doc.body.runCount).toBe(1);
    expect(doc.body.shadowBudget).toMatchObject({
      label: "shadow — no value",
      taskKind: "roadmap_author",
      budgetAcuMicro: "60000000",
    });

    const submitted = await h.call("GET", `/v1/public/receipts/${secondAttemptId}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.outcome.merged).toBe(false);
    expect(submitted.body.outcome.contribution).toBeNull();
    expect(submitted.body.roundCount).toBe(0); // no check suite yet: no round, no reviews
    expect(submitted.body.rounds).toEqual([]);
    expect(submitted.body.shadowBudget.budgetAcuMicro).toBe("8000000");

    // The list: newest first, both kinds, honest counts, and it parses as the route's response schema.
    const list = await h.call("GET", "/v1/public/receipts");
    expect(list.status).toBe(200);
    expect(Routes.listShadowReceipts.response.safeParse(list.body).success).toBe(true);
    const items = list.body.items as Array<{ id: string; updatedAt: string; handle: string | null }>;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.map((i) => i.id)).toEqual(
      [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? 1 : -1)).map((i) => i.id),
    );
    expect(new Set(items.map((i) => i.id))).toContain(attemptId);
    expect(new Set(items.map((i) => i.id))).toContain(secondAttemptId);
    expect(new Set(items.map((i) => i.id))).toContain(documentId);
    for (const i of items) expect(i.handle === null || typeof i.handle === "string").toBe(true);
    expect(list.body.nextCursor).toBeNull();

    // An unknown id is a clean 404.
    const missing = await h.call("GET", "/v1/public/receipts/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    expect(h.violations).toEqual([]);
  });
});

/**
 * The implementation pipeline end to end against Postgres with a fake GitHub:
 * LEASE -> BUILD -> VERIFY -> submit -> CI -> REVIEW (sealed, revealed) -> QUALIFY -> PR -> merge.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import {
  BASE_SHA,
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  manifestFor,
  seedFeature,
  signedRun,
  verdict,
  webhookHeaders,
} from "./support/harness.js";

describe.skipIf(!HAS_DB)("implementation pipeline (Postgres, fake GitHub)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("review-rounds R-001 R-002 provenance-and-merge R-001 R-002: claim to merge, sealed then revealed, bound, provenance, dependents, progress", async () => {
    const seeded = await seedFeature(h.owner, {
      abus: [
        { n: "01", write: ["modules/contacts/list/**"] },
        { n: "02", write: ["modules/contacts/detail/**"], dependsOn: ["01"] },
      ],
    });
    const builder = await h.contributor("builder1");
    const astra = await h.contributor("rev-astra");
    const fable = await h.contributor("rev-fable");

    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [
      { path: "modules/contacts/list/index.ts", content: "export const list = [];\n" },
    ]);
    expect(b.claim.body.contextPlan.source.commit).toBe(BASE_SHA);
    expect(b.submit.status).toBe(200);
    expect(b.submit.body.attempt.state).toBe("candidate_pushed");
    const head = h.github.commits[0]!;
    expect(head.branch).toBe(`wos/candidate/${b.attemptId}`);
    expect(head.trailers["wOS-Attempt"]).toBe(b.attemptId);
    expect(head.message).toContain("Co-authored-by: builder1 <");

    // CI on exactly the candidate head opens a round with one task per slot.
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 77, head_sha: head.sha, conclusion: "success", app: { slug: "github-actions" } },
    };
    const hook = await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    expect(hook.status).toBe(200);
    const [att1] = await h.owner<{ state: string }[]>`select state from wos.attempts where id = ${b.attemptId}`;
    expect(att1!.state).toBe("in_review");

    const a1 = await reviewAs(h, astra, "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    expect(a1.res.status).toBe(200);
    expect(a1.res.body.sealed).toBe(true);
    // Sealed: nobody else sees it, not even the builder or the public ABU page.
    const sealedView = await h.call("GET", `/v1/attempts/${b.attemptId}`, { token: builder.token });
    expect(sealedView.body.reviews).toEqual([]);
    const publicAbu = await h.call("GET", `/v1/public/abus/${seeded.abus.get("01")}`);
    expect(publicAbu.body.reviews).toEqual([]);

    // A verdict bound to another head is refused (D9 binding).
    const f1claim = await h.call("POST", "/v1/reviews/claim", {
      token: fable.token,
      idem: true,
      body: { deviceId: fable.deviceId, slot: "fable", kinds: ["implementation_review"] },
    });
    const fplan = f1claim.body.contextPlan;
    const fm = await manifestFor(h, fplan, "implementation_review");
    await h.call("POST", `/v1/leases/${f1claim.body.lease.id}/manifest`, { token: fable.token, idem: true, body: fm });
    const frun = await h.call("POST", `/v1/leases/${f1claim.body.lease.id}/agent-runs`, {
      token: fable.token,
      idem: true,
      body: signedRun(fable.key, fplan, f1claim.body.lease.id, fable.deviceId, fm.manifestSha256),
    });
    const [round] = await h.owner<
      { head_sha: string; submission_sha256: string }[]
    >`select head_sha, submission_sha256 from wos.rounds where id = ${fplan.roundId}`;
    const wrong = await h.call("POST", `/v1/leases/${f1claim.body.lease.id}/verdict`, {
      token: fable.token,
      idem: true,
      body: {
        verdict: verdict("NO_MATERIAL_GAPS"),
        headSha: "e".repeat(40),
        submissionSha256: round!.submission_sha256,
        agentRunId: frun.body.agentRunId,
      },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("VALIDATION_FAILED");
    const right = await h.call("POST", `/v1/leases/${f1claim.body.lease.id}/verdict`, {
      token: fable.token,
      idem: true,
      body: {
        verdict: verdict("NO_MATERIAL_GAPS"),
        headSha: round!.head_sha,
        submissionSha256: round!.submission_sha256,
        agentRunId: frun.body.agentRunId,
      },
    });
    expect(right.status).toBe(200);

    // Revealed atomically: both visible, round revealed, attempt qualified.
    const revealed = await h.call("GET", `/v1/attempts/${b.attemptId}`, { token: builder.token });
    expect(revealed.body.reviews.map((r: { slot: string }) => r.slot).sort()).toEqual(["astra", "fable"]);
    expect(revealed.body.state).toBe("qualified");
    const [rr] = await h.owner<
      { state: string; outcome: string; independence: string }[]
    >`select state, outcome, independence from wos.rounds where id = ${fplan.roundId}`;
    expect(rr).toEqual({ state: "revealed", outcome: "consensus", independence: "independent" });

    // github_sync opens the PR from the official branch at the reviewed head, sets wos/qualified, writes provenance.
    const dispatch = await h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(dispatch.status).toBe(200);
    expect(h.github.prs).toHaveLength(1);
    const pr = h.github.prs[0]!;
    expect(h.github.branches.get(`waronsaas/product:${pr.head}`)).toBe(head.sha);
    expect(h.github.statuses).toContainEqual({ repo: "waronsaas/product", sha: head.sha, context: "wos/qualified", state: "success" });
    const [prov] = await h.owner<
      { record: { authors: unknown[]; reviews: unknown[]; agentRuns: unknown[]; ci: unknown[]; headSha: string } }[]
    >`
      select p.record from wos.provenance_records p join wos.pull_requests r on r.id = p.pull_request_id where r.attempt_id = ${b.attemptId}`;
    expect(prov!.record.headSha).toBe(head.sha);
    expect(prov!.record.authors).toHaveLength(1);
    expect(prov!.record.reviews).toHaveLength(2);
    expect(prov!.record.agentRuns).toHaveLength(3);
    expect(prov!.record.ci).toHaveLength(1);
    const [att2] = await h.owner<
      { state: string; pr_number: number }[]
    >`select state, pr_number from wos.attempts where id = ${b.attemptId}`;
    expect(att2).toEqual({ state: "pr_open", pr_number: pr.number });

    // Merge: ABU merged, dependent unlocked, progress recomputed.
    const merged = {
      action: "closed",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: pr.number, merged: true, merge_commit_sha: "f".repeat(40), user: { login: "waronsaas-wos[bot]" } },
    };
    expect((await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) })).status).toBe(
      200,
    );
    const abus = await h.owner<
      { key: string; state: string }[]
    >`select key, state from wos.abus where catalog_feature_id = ${seeded.featureId} order by key`;
    expect(abus).toEqual([
      { key: "contacts#01", state: "merged" },
      { key: "contacts#02", state: "ready" },
    ]);
    const [task2] = await h.owner<
      { state: string }[]
    >`select state from wos.tasks where abu_id = ${seeded.abus.get("02")!} and kind = 'abu_build'`;
    expect(task2!.state).toBe("open");
    const locks = await h.owner`select 1 from wos.resource_locks where attempt_id = ${b.attemptId} and released_at is null`;
    expect(locks).toHaveLength(0);
    const target = await h.call("GET", "/v1/public/targets/salesforce");
    expect(target.body.progress.specifiedBp).toBe(10000);
    expect(target.body.progress.builtBp).toBe(5000); // 2 of 4 relevant size points merged
    const [contribution] = await h.owner<
      { state: string }[]
    >`select state from wos.contributions where attempt_id = ${b.attemptId} and category = 'implementation'`;
    expect(contribution!.state).toBe("accepted");
    expect(h.violations).toEqual([]);
  });

  it("CI failure requests changes with a revision task restricted to the builder; the revision resumes the attempt", async () => {
    const seeded = await seedFeature(h.owner, { feature: "tickets", abus: [{ n: "01", write: ["modules/tickets/**"] }] });
    const builder = await h.contributor("builder2");
    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [{ path: "modules/tickets/a.ts", content: "x\n" }]);
    expect(b.submit.status).toBe(200);
    const head = h.github.commits.at(-1)!;
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 78, head_sha: head.sha, conclusion: "failure" },
    };
    await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    const [a] = await h.owner<
      { state: string; revision_deadline_at: Date }[]
    >`select state, revision_deadline_at from wos.attempts where id = ${b.attemptId}`;
    expect(a!.state).toBe("changes_requested");
    const tasks = await h.call("GET", "/v1/tasks?kind=abu_revision", { token: builder.token });
    expect(tasks.body.items).toHaveLength(1);
    const other = await h.contributor("not-the-builder");
    const refused = await h.call("POST", `/v1/tasks/${tasks.body.items[0].id}/claim`, {
      token: other.token,
      idem: true,
      body: { deviceId: other.deviceId },
    });
    expect(refused.body.error.code).toBe("NOT_ELIGIBLE");
    const claim = await h.call("POST", `/v1/tasks/${tasks.body.items[0].id}/claim`, {
      token: builder.token,
      idem: true,
      body: { deviceId: builder.deviceId },
    });
    expect(claim.status).toBe(200);
    expect(claim.body.attempt.state).toBe("building");
    expect(claim.body.attempt.repairCount).toBe(1);
    expect(claim.body.contextPlan.source.commit).toBe(head.sha);
    expect(h.violations).toEqual([]);
  });
});

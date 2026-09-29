/** Proving tests of the Wave 1 gate brief (WORKSTREAMS.md section 7.4, contracts 3.0.0). */
import { DomainEvent } from "@waronsaas/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventWire } from "../src/handlers/account.js";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import {
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  manifestFor,
  seedFeature,
  signedChangeset,
  signedRun,
  verdict,
  webhookHeaders,
} from "./support/harness.js";

describe.skipIf(!HAS_DB)("Wave 1 gate: contracts 3.0.0 shapes and rulings", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const hook = (event: string, body: unknown) => h.call("POST", "/v1/github/webhook", { body, headers: webhookHeaders(event, body) });

  it("feature work has target null, every app it serves in relevantTo, and its repo; roadmap work has one target", async () => {
    const seeded = await seedFeature(h.owner, { feature: "shared", abus: [{ n: "01", write: ["modules/shared/**"] }] });
    const [hub] = await h.owner<{ id: string }[]>`select id from wos.targets where slug = 'hubspot'`;
    const [req] = await h.owner<{ id: string }[]>`select id from wos.requirements where document_id = ${seeded.contractDocId}`;
    await h.owner`insert into wos.requirement_profiles (document_id, target_id, requirement_id) values (${seeded.contractDocId}, ${hub!.id}, ${req!.id})`;
    const b = await h.contributor("shared-builder");
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    expect(claim.status).toBe(200);
    expect(claim.body.task).toMatchObject({
      target: null,
      feature: "shared",
      relevantTo: ["hubspot", "salesforce"],
      repo: "waronsaas/suite",
    });
    expect(claim.body.attempt).toMatchObject({ feature: "shared", relevantTo: ["hubspot", "salesforce"], repo: "waronsaas/suite" });
    expect(claim.body.contextPlan).toMatchObject({ target: null, feature: "shared", taskKind: "abu_build" });
    const work = await h.call("GET", "/v1/me/work", { token: b.token });
    expect(work.body.tasks[0].relevantTo).toEqual(["hubspot", "salesforce"]);
    const created = await h.owner`select 1 from wos.events where type = 'attempt.created' and aggregate_id = ${claim.body.attempt.id}`;
    expect(created).toHaveLength(1);
    expect(await h.owner`select 1 from wos.events where type = 'attempt.state_changed' and payload->>'from' = 'none'`).toHaveLength(0);

    const maint = await h.contributor("gate-maint", { maintainer: true });
    const opened = await h.call("POST", "/v1/admin/targets/shopify/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "Shopify roadmap" },
    });
    const tasks = await h.call("GET", "/v1/tasks?target=shopify", { token: maint.token });
    expect(tasks.body.items.find((t: { id: string }) => t.id === opened.body.taskId)).toMatchObject({
      target: "shopify",
      feature: null,
      relevantTo: ["shopify"],
      repo: "waronsaas/suite",
    });
    expect((await h.call("GET", "/v1/tasks?feature=shared", { token: maint.token })).body.items).toEqual([]);
  });

  it("TGT-00 work lands in the platform repo: plans and GitHub calls use the ABU's repo", async () => {
    const seeded = await seedFeature(h.owner, {
      feature: "wos-leases",
      target: "waronsaas",
      abus: [{ n: "01", write: ["services/control-plane/**"] }],
    });
    h.github.heads.set("waronsaas/waronsaas", "7".repeat(40));
    const b = await h.contributor("dogfooder");
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    expect(claim.body.contextPlan.source).toEqual({ repo: "waronsaas/waronsaas", commit: "7".repeat(40) });
    expect(claim.body.task.repo).toBe("waronsaas/waronsaas");
  });

  it("serves a planned server document by query ref, and 403 for any ref outside the lease plan", async () => {
    const seeded = await seedFeature(h.owner, { feature: "docs", abus: [{ n: "01", write: ["modules/docs/**"] }] });
    const b = await h.contributor("doc-reader");
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    const leaseId = claim.body.lease.id;
    const planned = claim.body.contextPlan.artifacts.filter((a: { kind: string }) => a.kind === "server_document");
    expect(planned.length).toBeGreaterThanOrEqual(2);
    for (const a of planned) {
      const r = await h.call("GET", `/v1/leases/${leaseId}/documents?ref=${encodeURIComponent(a.ref)}`, { token: b.token });
      expect(r.status).toBe(200);
      expect(r.body.sha256).toBe(a.sha256);
      expect(r.body.ref).toBe(a.ref);
    }
    for (const ref of [
      `wos:task/${claim.body.task.id}x`,
      "wos:verdict/0192f000-0000-7000-8000-000000000001/astra",
      "wos:policy/builder@agent-policy.v9",
    ]) {
      const r = await h.call("GET", `/v1/leases/${leaseId}/documents?ref=${encodeURIComponent(ref)}`, { token: b.token });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("FORBIDDEN");
    }
    const other = await h.contributor("doc-thief");
    const stolen = await h.call("GET", `/v1/leases/${leaseId}/documents?ref=${encodeURIComponent(planned[0].ref)}`, { token: other.token });
    expect(stolen.body.error.code).toBe("LEASE_NOT_HELD");
    // Several manifests per lease: a repair run posts a new one; both are accepted.
    const m1 = manifestFor(claim.body.contextPlan, "abu_build");
    const m2 = { ...m1, renderedPromptSha256: `sha256:${"e".repeat(64)}` };
    const { computeManifestSha256 } = await import("@waronsaas/contracts/canonical");
    const m2full = { ...m2, manifestSha256: computeManifestSha256(m2) };
    expect((await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: b.token, idem: true, body: m1 })).status).toBe(200);
    expect((await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: b.token, idem: true, body: m2full })).status).toBe(200);
  });

  it("a submission whose App commit fails records nothing; a retry with the same key succeeds", async () => {
    const seeded = await seedFeature(h.owner, { feature: "flaky", abus: [{ n: "01", write: ["modules/flaky/**"] }] });
    const b = await h.contributor("flaky-builder");
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    const plan = claim.body.contextPlan;
    const leaseId = claim.body.lease.id;
    const m = manifestFor(plan, "abu_build");
    await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: b.token, idem: true, body: m });
    await h.call("POST", `/v1/leases/${leaseId}/agent-runs`, {
      token: b.token,
      idem: true,
      body: signedRun(b.key, plan, leaseId, b.deviceId, m.manifestSha256),
    });
    await h.call("POST", `/v1/attempts/${claim.body.attempt.id}/phase`, {
      token: b.token,
      idem: true,
      body: { phase: "verifying", localRepair: false },
    });
    const cs = signedChangeset(b.key, {
      taskId: plan.taskId,
      leaseId,
      deviceId: b.deviceId,
      parentCommit: plan.source.commit,
      manifestSha256: m.manifestSha256,
      files: [{ path: "modules/flaky/a.ts", content: "a" }],
    });
    const key = "0192f000-0000-7000-8000-0000000f1a4e";
    h.github.failCommits = 2; // both tries of this request fail
    const failed = await h.call("POST", `/v1/leases/${leaseId}/changeset`, { token: b.token, idem: key, body: cs });
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe("UPSTREAM_GITHUB");
    expect(await h.owner`select 1 from wos.changesets where lease_id = ${leaseId}`).toHaveLength(0);
    expect(
      await h.owner`select 1 from wos.candidate_commits cc join wos.changesets c on c.id = cc.changeset_id where c.lease_id = ${leaseId}`,
    ).toHaveLength(0);
    const [a] = await h.owner<{ state: string }[]>`select state from wos.attempts where id = ${claim.body.attempt.id}`;
    expect(a!.state).toBe("verifying");
    const [l] = await h.owner<{ state: string }[]>`select state from wos.leases where id = ${leaseId}`;
    expect(l!.state).toBe("active");
    const retry = await h.call("POST", `/v1/leases/${leaseId}/changeset`, { token: b.token, idem: key, body: cs });
    expect(retry.status).toBe(200);
    expect(retry.body.attempt.state).toBe("candidate_pushed");
    const states = await h.owner<{ payload: { from: string; to: string } }[]>`
      select payload from wos.events where type = 'attempt.state_changed' and aggregate_id = ${claim.body.attempt.id} order by id`;
    expect(states.map((e) => e.payload.to).slice(-2)).toEqual(["submitted", "candidate_pushed"]);
  });

  it("refuses a verdict whose agent run belongs to another lease", async () => {
    const seeded = await seedFeature(h.owner, { feature: "binding", abus: [{ n: "01", write: ["modules/binding/**"] }] });
    const builder = await h.contributor("bind-builder");
    await buildAndSubmit(h, builder, seeded.abus.get("01")!, [{ path: "modules/binding/a.ts", content: "a" }]);
    const head = h.github.commits.at(-1)!.sha;
    await hook("check_suite", {
      action: "completed",
      repository: { full_name: "waronsaas/suite" },
      check_suite: { id: 31, head_sha: head, conclusion: "success" },
    });
    const astra = await h.contributor("bind-astra");
    const fable = await h.contributor("bind-fable");
    const claimFor = async (acct: typeof astra, slot: "astra" | "fable") => {
      const c = await h.call("POST", "/v1/reviews/claim", {
        token: acct.token,
        idem: true,
        body: { deviceId: acct.deviceId, slot, kinds: ["implementation_review"] },
      });
      const m = manifestFor(c.body.contextPlan, "implementation_review");
      await h.call("POST", `/v1/leases/${c.body.lease.id}/manifest`, { token: acct.token, idem: true, body: m });
      const run = await h.call("POST", `/v1/leases/${c.body.lease.id}/agent-runs`, {
        token: acct.token,
        idem: true,
        body: signedRun(acct.key, c.body.contextPlan, c.body.lease.id, acct.deviceId, m.manifestSha256),
      });
      return { c, runId: run.body.agentRunId as string };
    };
    const a = await claimFor(astra, "astra");
    const f = await claimFor(fable, "fable");
    const [round] = await h.owner<
      { head_sha: string; submission_sha256: string }[]
    >`select head_sha, submission_sha256 from wos.rounds where id = ${a.c.body.contextPlan.roundId}`;
    const borrowed = await h.call("POST", `/v1/leases/${f.c.body.lease.id}/verdict`, {
      token: fable.token,
      idem: true,
      body: {
        verdict: verdict("NO_MATERIAL_GAPS"),
        headSha: round!.head_sha,
        submissionSha256: round!.submission_sha256,
        agentRunId: a.runId,
      },
    });
    expect(borrowed.status).toBe(400);
    expect(borrowed.body.error.code).toBe("VALIDATION_FAILED");
    const own = await h.call("POST", `/v1/leases/${f.c.body.lease.id}/verdict`, {
      token: fable.token,
      idem: true,
      body: {
        verdict: verdict("NO_MATERIAL_GAPS"),
        headSha: round!.head_sha,
        submissionSha256: round!.submission_sha256,
        agentRunId: f.runId,
      },
    });
    expect(own.status).toBe(200);
    const [stored] = await h.owner<{ agent_run_id: string }[]>`select agent_run_id from wos.reviews where id = ${own.body.reviewId}`;
    expect(stored!.agent_run_id).toBe(f.runId);
  });

  it("a profile-acceptance check run moves a fully merged feature to BUILT 10000; toolchain changes are flagged on the PR", async () => {
    const seeded = await seedFeature(h.owner, { feature: "accept", target: "zoom", abus: [{ n: "01", write: ["modules/accept/**"] }] });
    const builder = await h.contributor("accept-builder");
    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [
      { path: "modules/accept/index.ts", content: "export {};" },
      { path: "modules/accept/package.json", content: "{}" },
    ]);
    expect(b.submit.status).toBe(200);
    const head = h.github.commits.at(-1)!.sha;
    await hook("check_suite", {
      action: "completed",
      repository: { full_name: "waronsaas/suite" },
      check_suite: { id: 41, head_sha: head, conclusion: "success" },
    });
    await reviewAs(h, await h.contributor("accept-astra"), "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await reviewAs(h, await h.contributor("accept-fable"), "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    const pr = h.github.prs.at(-1)!;
    expect(pr.labels).toContain("wos:toolchain");
    expect(pr.body).toContain("@waronsaas/maintainers");
    expect(h.github.deleted).toContain(`waronsaas/suite:wos/candidate/${b.attemptId}`);
    await hook("pull_request", {
      action: "closed",
      repository: { full_name: "waronsaas/suite" },
      pull_request: { number: pr.number, merged: true, merge_commit_sha: "4".repeat(40) },
    });
    const before = await h.call("GET", "/v1/public/targets/zoom/features/accept");
    expect(before.body).toMatchObject({ specifiedBp: 10000, builtBp: 9999 }); // capped until acceptance passes
    const run = {
      action: "completed",
      repository: { full_name: "waronsaas/suite" },
      check_run: { id: 501, name: "wos-acceptance/accept/zoom", head_sha: "4".repeat(40), conclusion: "success", check_suite: { id: 502 } },
    };
    expect((await hook("check_run", run)).status).toBe(200);
    const after = await h.call("GET", "/v1/public/targets/zoom/features/accept");
    expect(after.body).toMatchObject({ state: "built", specifiedBp: 10000, builtBp: 10000 });
    const recorded =
      await h.owner`select 1 from wos.events where type = 'verification.recorded' and payload->>'subject' = 'profile_acceptance'`;
    expect(recorded).toHaveLength(1);
    expect(h.violations).toEqual([]);
  });

  it("every event the control plane emitted parses as DomainEvent", async () => {
    const rows = await h.owner<Parameters<typeof eventWire>[0][]>`select * from wos.events order by id`;
    expect(rows.length).toBeGreaterThan(50);
    const bad = rows.filter((r) => !DomainEvent.safeParse(eventWire(r)).success).map((r) => r.type);
    expect(bad).toEqual([]);
  });
});

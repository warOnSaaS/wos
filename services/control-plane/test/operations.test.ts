/** S-31 maintainer actions, the sweeper (revision windows, releases, bootstrap exit) and submission security rules. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAndSubmit } from "./support/flow.js";
import {
  type Account,
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  manifestFor,
  seedFeature,
  signedChangeset,
  signedRun,
  webhookHeaders,
} from "./support/harness.js";

describe.skipIf(!HAS_DB)("maintainer actions, sweeper and submission security", () => {
  let h: Harness;
  let maint: Account;
  beforeAll(async () => {
    h = await createHarness();
    maint = await h.contributor("ops-maint", { maintainer: true });
  });
  afterAll(async () => {
    await h?.close();
  });

  const act = (body: Record<string, unknown>) => h.call("POST", "/v1/admin/actions", { token: maint.token, idem: true, body });
  const sweep = () => h.call("GET", "/v1/cron/sweep", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  const event = async (type: string) =>
    h.owner<
      { payload: Record<string, unknown>; actor_kind: string }[]
    >`select payload, actor_kind from wos.events where type = ${type} order by id desc limit 1`;

  it("suspend_account revokes sessions and leases and fails live attempts", async () => {
    const seeded = await seedFeature(h.owner, { feature: "suspend", abus: [{ n: "01", write: ["modules/suspend/**"] }] });
    const bad = await h.contributor("bad-actor");
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: bad.token,
      idem: true,
      body: { deviceId: bad.deviceId },
    });
    expect(claim.status).toBe(200);
    expect((await act({ action: "suspend_account", handleOrEmail: "bad-actor", reason: "Fabricated verdicts" })).status).toBe(200);
    expect((await h.call("GET", "/v1/me", { token: bad.token })).status).toBe(401);
    const [lease] = await h.owner<{ state: string }[]>`select state from wos.leases where id = ${claim.body.lease.id}`;
    expect(lease!.state).toBe("revoked");
    const [attempt] = await h.owner<{ state: string }[]>`select state from wos.attempts where id = ${claim.body.attempt.id}`;
    expect(["failed", "expired"]).toContain(attempt!.state);
    const [abu] = await h.owner<{ state: string }[]>`select state from wos.abus where id = ${seeded.abus.get("01")!}`;
    expect(abu!.state).toBe("ready");
    expect((await event("account.suspended"))[0]!.actor_kind).toBe("maintainer");
    expect((await act({ action: "suspend_account", handleOrEmail: "bad-actor@example.com", reason: "Again please" })).body.error.code).toBe(
      "CONFLICT",
    );
  });

  it("fail_attempt and flag_abu_for_decomposition", async () => {
    const seeded = await seedFeature(h.owner, {
      feature: "failing",
      abus: [
        { n: "01", write: ["modules/failing/a/**"] },
        { n: "02", write: ["modules/failing/b/**"] },
      ],
    });
    const b = await h.contributor("failing-builder");
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    expect((await act({ action: "fail_attempt", attemptId: claim.body.attempt.id, reason: "Tampered submission" })).status).toBe(200);
    const [a] = await h.owner<
      { state: string; failure_reason: string }[]
    >`select state, failure_reason from wos.attempts where id = ${claim.body.attempt.id}`;
    expect(a).toEqual({ state: "failed", failure_reason: "Tampered submission" });
    expect(
      await h.owner`select 1 from wos.resource_locks where attempt_id = ${claim.body.attempt.id} and released_at is null`,
    ).toHaveLength(0);
    expect(
      (await act({ action: "flag_abu_for_decomposition", abuId: seeded.abus.get("02"), reason: "Too big for one builder" })).status,
    ).toBe(200);
    const [abu] = await h.owner<{ state: string }[]>`select state from wos.abus where id = ${seeded.abus.get("02")!}`;
    expect(abu!.state).toBe("needs_decomposition");
    const [task] = await h.owner<{ state: string }[]>`select state from wos.tasks where abu_id = ${seeded.abus.get("02")!}`;
    expect(task!.state).toBe("cancelled");
  });

  it("abandon_document and reopen_document", async () => {
    const opened = await h.call("POST", "/v1/admin/targets/jira/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "Jira roadmap" },
    });
    expect((await act({ action: "abandon_document", documentId: opened.body.documentId, reason: "Wrong start" })).status).toBe(200);
    const [d] = await h.owner<
      { state: string; ended_reason: string }[]
    >`select state, ended_reason from wos.documents where id = ${opened.body.documentId}`;
    expect(d).toEqual({ state: "abandoned", ended_reason: "Wrong start" });
    const [t] = await h.owner<{ state: string }[]>`select state from wos.tasks where id = ${opened.body.taskId}`;
    expect(t!.state).toBe("cancelled");
    expect((await event("document.abandoned"))[0]!.payload.reason).toBe("Wrong start");
    // A new version can open after abandonment; reopen works from consensus only.
    const second = await h.call("POST", "/v1/admin/targets/jira/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "Try again" },
    });
    expect(second.status).toBe(200);
    expect((await act({ action: "reopen_document", documentId: second.body.documentId, reason: "Not in consensus" })).body.error.code).toBe(
      "CONFLICT",
    );
    await h.owner`update wos.documents set state = 'consensus', head_sha = ${"1".repeat(40)} where id = ${second.body.documentId}`;
    await h.owner`update wos.tasks set state = 'completed' where id = ${second.body.taskId}`;
    expect((await act({ action: "reopen_document", documentId: second.body.documentId, reason: "Weights need another look" })).status).toBe(
      200,
    );
    const [d2] = await h.owner<{ state: string }[]>`select state from wos.documents where id = ${second.body.documentId}`;
    expect(d2!.state).toBe("revising");
    const open =
      await h.owner`select 1 from wos.tasks where document_id = ${second.body.documentId} and kind = 'roadmap_author' and state = 'open'`;
    expect(open).toHaveLength(1);
  });

  it("set_hosting, end_bootstrap, ledger_adjustment and award_security write public records", async () => {
    expect(
      (await act({ action: "set_hosting", target: "zendesk", hostedUrl: "https://zendesk.waronsaas.com", selfHostable: true })).status,
    ).toBe(200);
    const t = await h.call("GET", "/v1/public/targets/zendesk");
    expect(t.body.hosted).toEqual({ available: true, url: "https://zendesk.waronsaas.com" });
    expect(t.body.selfHostable).toBe(true);

    const reporter = await h.contributor("reporter");
    expect(
      (
        await act({
          action: "award_security",
          handle: "reporter",
          severity: "medium",
          reference: "https://github.com/waronsaas/product/security/advisories/1",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await act({
          action: "ledger_adjustment",
          handle: "reporter",
          amount: 7,
          bucket: "available",
          memo: "Correction for a missed award",
        })
      ).status,
    ).toBe(200);
    const me = await h.call("GET", "/v1/me", { token: reporter.token });
    expect(me.body.balance).toEqual({ held: 100, available: 7, score: 107 });
    expect(
      (
        await act({
          action: "award_security",
          handle: "reporter",
          severity: "medium",
          reference: "https://github.com/waronsaas/product/security/advisories/1",
        })
      ).body.error.code,
    ).toBe("CONFLICT");
    // reverse_contribution: the held award is voided.
    const [c] = await h.owner<
      { id: string }[]
    >`select id from wos.contributions where category = 'security' and account_id = ${reporter.id}`;
    expect((await act({ action: "reverse_contribution", contributionId: c!.id, reason: "Duplicate of an earlier report" })).status).toBe(
      200,
    );
    const after = await h.call("GET", "/v1/me", { token: reporter.token });
    expect(after.body.balance).toEqual({ held: 0, available: 7, score: 7 });
  });

  it("the sweeper releases awards past their hold, but not bootstrap_self ones", async () => {
    const earner = await h.contributor("earner");
    const [gh] = await h.owner<{ github_user_id: string }[]>`select github_user_id from wos.accounts where id = ${earner.id}`;
    const mk = async (independence: string) => {
      const cid = randomUUID();
      await h.owner`insert into wos.contributions (id, account_id, github_user_id, category, state, independence, idempotency_key, accepted_at)
                    values (${cid}, ${earner.id}, ${gh!.github_user_id}, 'implementation', 'accepted', ${independence}, ${`t:${cid}`}, now())`;
      await h.owner`insert into wos.ledger_entries (id, account_id, kind, bucket, amount, category, contribution_id, idempotency_key, schedule_version, memo, release_after, created_by_kind)
                    values (${randomUUID()}, ${earner.id}, 'award', 'held', 40, 'implementation', ${cid}, ${`award:t:${cid}`}, 'rewards.v1', 'test award', now() - interval '1 day', 'system')`;
    };
    await mk("independent");
    await mk("bootstrap_self");
    const s = await sweep();
    expect(s.body.released).toBe(1);
    expect((await h.call("GET", "/v1/me", { token: earner.token })).body.balance).toEqual({ held: 40, available: 40, score: 80 });
    expect((await sweep()).body.released).toBe(0); // idempotent
  });

  it("the sweeper lapses a revision window: attempt expired, ABU ready again", async () => {
    const seeded = await seedFeature(h.owner, { feature: "window", abus: [{ n: "01", write: ["modules/window/**"] }] });
    const b = await h.contributor("window-builder");
    const built = await buildAndSubmit(h, b, seeded.abus.get("01")!, [{ path: "modules/window/a.ts", content: "a" }]);
    const head = h.github.commits.at(-1)!.sha;
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 11, head_sha: head, conclusion: "timed_out" },
    };
    await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    await h.owner`update wos.attempts set revision_deadline_at = now() - interval '1 minute' where id = ${built.attemptId}`;
    const s = await sweep();
    expect(s.body.expiredAttempts).toBeGreaterThanOrEqual(1);
    const [a] = await h.owner<{ state: string }[]>`select state from wos.attempts where id = ${built.attemptId}`;
    expect(a!.state).toBe("expired");
    const [abu] = await h.owner<
      { state: string; failed_attempts: number }[]
    >`select state, failed_attempts from wos.abus where id = ${seeded.abus.get("01")!}`;
    expect(abu).toEqual({ state: "ready", failed_attempts: 1 });
    const [rev] = await h.owner<
      { state: string }[]
    >`select state from wos.tasks where attempt_id = ${built.attemptId} and kind = 'abu_revision'`;
    expect(rev!.state).toBe("cancelled");
  });

  it("a forged signature is refused before GitHub is called; repeated security rejections fail the attempt", async () => {
    const seeded = await seedFeature(h.owner, { feature: "forged", abus: [{ n: "01", write: ["modules/forged/**"] }] });
    const b = await h.contributor("forger");
    const claim = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: b.token,
      idem: true,
      body: { deviceId: b.deviceId },
    });
    const plan = claim.body.contextPlan;
    const leaseId = claim.body.lease.id;
    const m = await manifestFor(h, plan, "abu_build");
    await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: b.token, idem: true, body: m });
    const run = signedRun(b.key, plan, leaseId, b.deviceId, m.manifestSha256);
    const badRun = await h.call("POST", `/v1/leases/${leaseId}/agent-runs`, { token: b.token, idem: true, body: { ...run, exitCode: 1 } });
    expect(badRun.status).toBe(200);
    const [stored] = await h.owner<
      { signature_valid: boolean }[]
    >`select signature_valid from wos.agent_runs where id = ${badRun.body.agentRunId}`;
    expect(stored!.signature_valid).toBe(false); // S-13: stored, flagged, blocks qualification
    await h.call("POST", `/v1/attempts/${claim.body.attempt.id}/phase`, {
      token: b.token,
      idem: true,
      body: { phase: "verifying", localRepair: false },
    });
    const commitsBefore = h.github.commits.length;
    const forge = () => {
      const cs = signedChangeset(b.key, {
        taskId: plan.taskId,
        leaseId,
        deviceId: b.deviceId,
        parentCommit: plan.source.commit,
        manifestSha256: m.manifestSha256,
        files: [{ path: "modules/forged/a.ts", content: "ok" }],
      });
      return h.call("POST", `/v1/leases/${leaseId}/changeset`, {
        token: b.token,
        idem: true,
        body: { ...cs, summary: { ...cs.summary, summary: "changed after signing" } },
      });
    };
    const first = await forge();
    expect(first.status).toBe(422);
    expect(first.body.error.details.errors.map((e: { code: string }) => e.code)).toContain("SIGNATURE_INVALID");
    expect(h.github.commits.length).toBe(commitsBefore);
    const workflow = signedChangeset(b.key, {
      taskId: plan.taskId,
      leaseId,
      deviceId: b.deviceId,
      parentCommit: plan.source.commit,
      manifestSha256: m.manifestSha256,
      files: [{ path: ".github/workflows/wos-verify.yml", content: "on: push" }],
    });
    const second = await h.call("POST", `/v1/leases/${leaseId}/changeset`, { token: b.token, idem: true, body: workflow });
    expect(second.body.error.details.errors.map((e: { code: string }) => e.code)).toContain("WORKFLOW_FILE");
    const [a] = await h.owner<{ state: string }[]>`select state from wos.attempts where id = ${claim.body.attempt.id}`;
    expect(a!.state).toBe("failed");
    const rejected = await h.owner<{ ok: boolean }[]>`select ok from wos.changesets where lease_id = ${leaseId}`;
    expect(rejected.every((r) => r.ok === false)).toBe(true);
  });

  it("closes a PR not opened by the App (S-18 fallback)", async () => {
    const pr = {
      action: "opened",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: 999, user: { login: "someone", type: "User" } },
    };
    await h.call("POST", "/v1/github/webhook", { body: pr, headers: webhookHeaders("pull_request", pr) });
    expect(h.github.closed).toContainEqual({ repo: "waronsaas/product", number: 999 });
    const dupe = await h.call("POST", "/v1/github/webhook", { body: pr, headers: webhookHeaders("pull_request", pr, "fixed-delivery") });
    expect(dupe.status).toBe(200);
    const again = await h.call("POST", "/v1/github/webhook", { body: pr, headers: webhookHeaders("pull_request", pr, "fixed-delivery") });
    expect(again.status).toBe(200);
    expect(h.github.closed.filter((c) => c.number === 999)).toHaveLength(2); // one per distinct delivery, the duplicate is ignored
  });

  it("never violates the route contract", () => {
    expect(h.violations).toEqual([]);
  });
});

// Bootstrap exit is one-way (migration 0002), so each exit path gets its own database.
describe.skipIf(!HAS_DB)("bootstrap exit (one-way)", () => {
  it("a maintainer ends bootstrap once; it can never be re-entered", async () => {
    const h = await createHarness();
    try {
      const maint = await h.contributor("boot-maint", { maintainer: true });
      const act = (body: Record<string, unknown>) => h.call("POST", "/v1/admin/actions", { token: maint.token, idem: true, body });
      expect((await act({ action: "end_bootstrap", reason: "Enough reviewers joined" })).status).toBe(200);
      expect((await h.call("GET", "/v1/public/status")).body.bootstrapMode).toBe(false);
      expect((await act({ action: "end_bootstrap", reason: "Twice is refused" })).body.error.code).toBe("CONFLICT");
      await expect(h.owner`update wos.platform_settings set value = '{"enabled": true}' where key = 'bootstrap_mode'`).rejects.toThrow(
        /re-entered/,
      );
      expect(h.violations).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("bootstrap ends automatically once each slot has 3 non-maintainer reviewers with recent completed leases", async () => {
    const h = await createHarness();
    const sweep = () => h.call("GET", "/v1/cron/sweep", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    const event = async (type: string) =>
      h.owner<{ actor_kind: string }[]>`select actor_kind from wos.events where type = ${type} order by id desc limit 1`;
    try {
      const reviewers: Account[] = [];
      for (let i = 0; i < 3; i++) reviewers.push(await h.contributor(`seed-reviewer-${i}`));
      for (const r of reviewers) {
        const [task] = await h.owner<
          { id: string }[]
        >`insert into wos.tasks (kind, state, role, target_id) select 'roadmap_author', 'completed', 'roadmap_author', id from wos.targets where slug = 'hubspot' returning id`;
        await h.owner`insert into wos.leases (task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at, ended_at)
                      values (${task!.id}, ${r.id}, ${r.deviceId}, 'completed', '{}', now(), now(), now())`;
      }
      await sweep();
      expect((await h.call("GET", "/v1/public/status")).body.bootstrapMode).toBe(false);
      expect((await event("platform.bootstrap_ended"))[0]!.actor_kind).toBe("system");
    } finally {
      await h.close();
    }
  });
});

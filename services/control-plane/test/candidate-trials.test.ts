/**
 * D69 candidate trials (contracts 5.17.0, migration 0015) and D70 network by role (agent-policy.v2) in the control plane:
 * a maintainer designates one open roadmap_author task for glm; only glm claims it (and the document's later author
 * tasks), glm claims nothing else, the claim declares its launch; the round, PR, commit and contributions carry the
 * label; research plans carry their web allowlist and reviewers see what the authors fetched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderServerDocument } from "../src/domain/plans.js";
import { reviewAs } from "./support/flow.js";
import { type Account, CRON_SECRET, createHarness, HAS_DB, type Harness, verdict } from "./support/harness.js";
import { authorRevision, roadmapFiles } from "./support/roadmap-fixture.js";

const LAUNCH = { provider: "opencode-go", baseUrl: null, identity: "self_reported" } as const;

describe.skipIf(!HAS_DB)("D69 candidate trials, D70 web by role", () => {
  let h: Harness;
  let founder: Account;
  let astra: Account;
  let fable: Account;
  beforeAll(async () => {
    h = await createHarness();
    founder = await h.contributor("ct-founder", { maintainer: true });
    astra = await h.contributor("ct-astra");
    fable = await h.contributor("ct-fable");
    // The founder's machine also attests the opencode CLI on OpenCode Go (glm).
    const now = new Date().toISOString();
    const att = await h.call("POST", "/v1/me/attestations", {
      token: founder.token,
      idem: true,
      body: {
        deviceId: founder.deviceId,
        providers: [
          {
            provider: "claude_cli",
            installed: true,
            cliVersion: "2.1.284",
            signedIn: true,
            authMethod: "claude.ai",
            models: ["opus", "fable"],
            checkedAt: now,
          },
          {
            provider: "opencode_cli",
            installed: true,
            cliVersion: "1.18.31",
            signedIn: true,
            authMethod: "opencode-go",
            models: ["glm"],
            checkedAt: now,
          },
        ],
      },
    });
    expect(att.status, JSON.stringify(att.body)).toBe(200);
  });
  afterAll(async () => {
    await h?.close();
  });

  const dispatch = () => h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  const action = (acct: Account, body: unknown) => h.call("POST", "/v1/admin/actions", { token: acct.token, idem: true, body });
  const claim = (acct: Account, taskId: string, body: Record<string, unknown>) =>
    h.call("POST", `/v1/tasks/${taskId}/claim`, { token: acct.token, idem: true, body: { deviceId: acct.deviceId, ...body } });
  const openTask = async (documentId: string) => {
    const [t] = await h.owner<{ id: string }[]>`
      select id from wos.tasks where document_id = ${documentId} and kind = 'roadmap_author' and state = 'open' order by created_at desc limit 1`;
    return t!.id;
  };

  it("without a trial, glm is refused everywhere (D52), even with its launch declared", async () => {
    const r = await h.call("POST", "/v1/admin/targets/hubspot/roadmaps", {
      token: founder.token,
      idem: true,
      body: { reason: "Open hubspot" },
    });
    expect(r.status).toBe(200);
    const c = await claim(founder, r.body.taskId, { model: "glm", launch: LAUNCH });
    expect(c.status).toBe(403);
    expect(c.body.error.code).toBe("NOT_ELIGIBLE");
    expect(JSON.stringify(c.body.error.details)).toContain(
      "glm is a candidate model: not eligible for any role until it passes qualification (D52)",
    );
    await action(founder, { action: "abandon_document", documentId: r.body.documentId, reason: "trial test: no trial here" });
  });

  it("assign_candidate_trial designates the task; only glm claims it, with its launch; round, PR, commit and contributions are labelled", async () => {
    const opened = await h.call("POST", "/v1/admin/targets/salesforce/roadmaps", {
      token: founder.token,
      idem: true,
      body: { reason: "Salesforce roadmap v1" },
    });
    expect(opened.status).toBe(200);
    const { taskId, documentId } = opened.body as { taskId: string; documentId: string };

    // Not a candidate, not an open roadmap_author task, not a maintainer: refused.
    expect((await action(founder, { action: "assign_candidate_trial", taskId, candidate: "opus", reason: "not a candidate" })).status).toBe(
      400,
    );
    expect((await action(astra, { action: "assign_candidate_trial", taskId, candidate: "glm", reason: "not a maintainer" })).status).toBe(
      403,
    );
    const ok = await action(founder, {
      action: "assign_candidate_trial",
      taskId,
      candidate: "glm",
      reason: "GLM first on the Salesforce roadmap (founder)",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await action(founder, { action: "assign_candidate_trial", taskId, candidate: "glm", reason: "again" })).status).toBe(409);
    const [ev] = await h.owner<{ visibility: string; payload: Record<string, unknown> }[]>`
      select visibility, payload from wos.events where type = 'task.candidate_trial_assigned' and aggregate_id = ${taskId}`;
    expect(ev).toEqual({
      visibility: "public",
      payload: {
        taskId,
        documentId,
        candidate: "glm",
        label: "candidate_trial:glm",
        reason: "GLM first on the Salesforce roadmap (founder)",
      },
    });

    // The open task shows the trial.
    const list = await h.call("GET", "/v1/tasks?kind=roadmap_author&target=salesforce", { token: founder.token });
    expect(list.body.items.find((t: { id: string }) => t.id === taskId).candidateTrial).toEqual({
      candidate: "glm",
      label: "candidate_trial:glm",
    });

    // Opus may not take the designated task; glm must declare its launch.
    const opus = await claim(founder, taskId, { model: "opus" });
    expect(opus.status).toBe(403);
    expect(JSON.stringify(opus.body.error.details)).toContain("designated for the candidate glm");
    const bare = await claim(founder, taskId, { model: "glm" });
    expect(bare.status).toBe(403);
    expect(JSON.stringify(bare.body.error.details)).toContain("launch.provider one of opencode-go, zai");

    const fetches = [
      {
        kind: "fetch",
        target: "https://help.salesforce.com/s/articleView?id=sf.exporting_data.htm",
        at: "2026-09-30T20:00:00.000Z",
        contentSha256: `sha256:${"c".repeat(64)}`,
        tool: "webfetch",
      },
    ];
    const sub = await authorRevision(h, founder, taskId, roadmapFiles({ target: "salesforce" }), {
      model: "glm",
      launch: LAUNCH,
      run: { launch: LAUNCH, subagentCount: 4, maxConcurrentSubagents: 3, fetches },
    });
    expect(sub.res.status, JSON.stringify(sub.res.body)).toBe(200);
    expect(sub.plan).toMatchObject({
      model: "glm",
      modelId: "opencode-go/glm-5.3",
      provider: "opencode_cli",
      reasoning: "max",
      policyVersion: "agent-policy.v2",
    });
    expect(sub.plan.web.domains).toEqual(expect.arrayContaining(["salesforce.com", "force.com", "apps.apple.com", "play.google.com"]));
    expect(sub.plan.web.search).toBe(true);
    const [claimRow] = await h.owner<{ model_id: string; provider_declared: string; identity: string }[]>`
      select model_id, provider_declared, identity from wos.candidate_trial_claims where task_id = ${taskId}`;
    expect(claimRow).toEqual({ model_id: "opencode-go/glm-5.3", provider_declared: "opencode-go", identity: "self_reported" });
    const [cev] = await h.owner<{ visibility: string }[]>`select visibility from wos.events where type = 'lease.candidate_trial_claimed'`;
    expect(cev!.visibility).toBe("public");

    // The round carries the label (pinned by the database), made public; the commit carries the trailer; the PR the label.
    const [round] = await h.owner<{ id: string; trial_label: string | null }[]>`
      select id, trial_label from wos.rounds where document_id = ${documentId} order by round_number desc limit 1`;
    expect(round!.trial_label).toBe("candidate_trial:glm");
    await expect(h.owner`update wos.rounds set trial_label = null where id = ${round!.id}`).rejects.toThrow(/fixed when it opens/);
    const [rev] = await h.owner<{ payload: { label: string } }[]>`
      select payload from wos.events where type = 'round.candidate_trial' and aggregate_id = ${round!.id}`;
    expect(rev!.payload.label).toBe("candidate_trial:glm");
    expect(h.github.commits.at(-1)!.message).toContain("wOS-Candidate-Trial: candidate_trial:glm");
    await dispatch();
    const pr = h.github.prs.find((p) => p.head === "wos/roadmap/salesforce/v1")!;
    expect(pr.labels).toEqual(["wos:roadmap", "candidate_trial:glm"]);
    expect(pr.body).toContain("candidate_trial:glm");

    // D70: the Astra reviewer's plan reads the same allowlist and gets what the author fetched.
    const reviewed = await reviewAs(h, astra, "astra", "roadmap_review", verdict("MATERIAL_GAPS"));
    expect(reviewed.plan.web.domains).toContain("salesforce.com");
    const ref = `wos:fetches/${documentId}`;
    expect(reviewed.plan.artifacts.find((a: { ref?: string }) => a.ref === ref)).toMatchObject({ kind: "server_document", required: true });
    // (The lease's document route closes with the lease: render the same server document directly.)
    const text = (await h.owner.begin((tx) => renderServerDocument(tx as never, h.deps, ref)))!;
    expect(text).toContain("https://help.salesforce.com/s/articleView?id=sf.exporting_data.htm");
    expect(text).toContain("opencode-go/glm-5.3");
    await reviewAs(h, fable, "fable", "roadmap_review", verdict("MATERIAL_GAPS"));

    // Contributions of the trial's document carry the label.
    const labels = await h.owner<
      { trial_label: string | null }[]
    >`select trial_label from wos.contributions where document_id = ${documentId}`;
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l.trial_label === "candidate_trial:glm")).toBe(true);

    // Gaps: the revision task of the same document is covered by the trial: glm yes, Opus no.
    const next = await openTask(documentId);
    expect(next).not.toBe(taskId);
    expect((await claim(founder, next, { model: "opus" })).status).toBe(403);
    // Revoked (e.g. GLM fell short): the document's author task follows the normal rules again; glm is refused.
    expect((await action(founder, { action: "revoke_candidate_trial", taskId: next, reason: "reassign to Opus" })).status).toBe(200);
    expect((await action(founder, { action: "revoke_candidate_trial", taskId: next, reason: "twice" })).status).toBe(404);
    expect((await claim(founder, next, { model: "glm", launch: LAUNCH })).status).toBe(403);
    const opusNow = await claim(founder, next, { model: "opus" });
    expect(opusNow.status, JSON.stringify(opusNow.body)).toBe(200);
    expect(opusNow.body.contextPlan.provider).toBe("claude_cli");
    // Forward-only: a trial is never deleted or re-opened.
    await expect(h.owner`delete from wos.candidate_trials`).rejects.toThrow();
    await expect(h.owner`update wos.candidate_trials set revoked_at = null, revoked_by = null, revoked_reason = null`).rejects.toThrow();
  });

  it("D70: offline roles get no web; the implementation-side plans stay offline", async () => {
    const plans = await h.owner<{ plan: { role: string; web?: unknown } }[]>`select context_plan as plan from wos.leases`;
    for (const p of plans) {
      if (["builder", "implementation_reviewer_astra", "implementation_reviewer_fable", "conflict_resolver"].includes(p.plan.role))
        expect(p.plan.web ?? null).toBeNull();
      if (p.plan.role.startsWith("roadmap_")) expect(p.plan.web).toBeTruthy();
    }
  });
});

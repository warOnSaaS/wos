/**
 * contracts 5.20.0, `wos resubmit`: the archived output of an earlier lease of the same task by the same account, whose
 * submission never reached a commit, is re-sent on a fresh lease with no model run. The server checks the earlier lease
 * and its signed agent run, requires the same model, and records the link (commit trailer, public event).
 */
import { signChangeset, submissionSha256 } from "@waronsaas/contracts/canonical";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Account, createHarness, HAS_DB, type Harness, manifestFor, sha256, signedRun } from "./support/harness.js";
import { roadmapFiles } from "./support/roadmap-fixture.js";

describe.skipIf(!HAS_DB)("wos resubmit: the server side", () => {
  let h: Harness;
  let maint: Account;
  let writer: Account;
  beforeAll(async () => {
    h = await createHarness();
    maint = await h.contributor("rs-maint", { maintainer: true });
    writer = await h.contributor("rs-writer");
  });
  afterAll(async () => {
    await h?.close();
  });

  const claim = async (taskId: string, model: string) => {
    const c = await h.call("POST", `/v1/tasks/${taskId}/claim`, {
      token: writer.token,
      idem: true,
      body: { deviceId: writer.deviceId, model },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const m = await manifestFor(h, c.body.contextPlan);
    expect((await h.call("POST", `/v1/leases/${c.body.lease.id}/manifest`, { token: writer.token, idem: true, body: m })).status).toBe(200);
    return { leaseId: c.body.lease.id as string, plan: c.body.contextPlan, manifestSha256: m.manifestSha256 };
  };
  const changeset = (taskId: string, lease: Awaited<ReturnType<typeof claim>>, fromLeaseId: string | null) => {
    const files = roadmapFiles({ target: "salesforce" }).map((f) => ({
      op: "upsert" as const,
      path: f.path,
      mode: "100644" as const,
      contentBase64: Buffer.from(f.content).toString("base64"),
      sha256: sha256(f.content),
      bytes: Buffer.byteLength(f.content),
    }));
    return signChangeset(
      {
        schema: "wos-changeset.v1",
        taskId,
        leaseId: lease.leaseId,
        deviceId: writer.deviceId,
        parentCommit: lease.plan.source.commit,
        manifestSha256: lease.manifestSha256,
        submissionSha256: submissionSha256(lease.plan.source.commit, files),
        files,
        summary: { schema: "author-summary.v1", summary: "Roadmap v1.", responses: [], proposalsAddressed: [] },
        localVerification: [],
        ...(fromLeaseId
          ? { resubmission: { fromLeaseId, reason: "wos resubmit: run A's archived output; no model ran on this lease" } }
          : {}),
      },
      writer.key,
    );
  };
  const submit = (leaseId: string, cs: unknown) =>
    h.call("POST", `/v1/leases/${leaseId}/changeset`, { token: writer.token, idem: true, body: cs });

  it("re-sends run A's output on a fresh lease, linked to run A's agent run; refuses the wrong model or a lease without a run", async () => {
    const opened = await h.call("POST", "/v1/admin/targets/salesforce/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "Resubmit test" },
    });
    const taskId = opened.body.taskId as string;
    // Run A: claimed, context posted, the model ran (signed run record), the submission never reached a commit.
    const a = await claim(taskId, "opus");
    const run = await h.call("POST", `/v1/leases/${a.leaseId}/agent-runs`, {
      token: writer.token,
      idem: true,
      body: signedRun(writer.key, a.plan, a.leaseId, writer.deviceId, a.manifestSha256),
    });
    expect(run.status).toBe(200);
    // While run A's lease is active, nothing can be re-sent from it (and it is the current lease anyway).
    expect((await submit(a.leaseId, changeset(taskId, a, a.leaseId))).status).toBe(400);
    await h.call("POST", `/v1/leases/${a.leaseId}/release`, {
      token: writer.token,
      idem: true,
      body: { reason: "UPSTREAM_GITHUB: resubmit" },
    });

    // A fresh lease on another model may not carry run A's output.
    const wrong = await claim(taskId, "fable");
    const refused = await submit(wrong.leaseId, changeset(taskId, wrong, a.leaseId));
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain("claim the task with the model that produced the output");
    await h.call("POST", `/v1/leases/${wrong.leaseId}/release`, { token: writer.token, idem: true, body: { reason: "wrong model" } });

    // A lease that never ran a model has no output to re-send.
    const b = await claim(taskId, "opus");
    const empty = await submit(b.leaseId, changeset(taskId, b, wrong.leaseId));
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toContain("no signed agent run");

    // The same model: committed, with the trailer and the public event naming run A's agent run.
    const ok = await submit(b.leaseId, changeset(taskId, b, a.leaseId));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const commit = h.github.commits.at(-1)!;
    expect(commit.message).toContain(`wOS-Resubmitted-From-Run: ${run.body.agentRunId}`);
    expect(commit.message.trimEnd().split("\n").at(-1)).toMatch(/^Co-authored-by: rs-writer </);
    const [ev] = await h.owner<{ visibility: string; payload: Record<string, unknown> }[]>`
      select visibility, payload from wos.events where type = 'changeset.resubmitted'`;
    expect(ev).toMatchObject({
      visibility: "public",
      payload: { taskId, leaseId: b.leaseId, fromLeaseId: a.leaseId, fromAgentRunId: run.body.agentRunId, commitSha: commit.sha },
    });
    expect(h.violations).toEqual([]);
  });
});

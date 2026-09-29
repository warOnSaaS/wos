/** Client-side steps a contributor's orchestrator performs, driven through the API. */
import { expect } from "vitest";
import { type Account, type Harness, manifestFor, signedChangeset, signedRun, type verdict } from "./harness.js";

export async function reviewAs(
  h: Harness,
  acct: Account,
  slot: "astra" | "fable",
  kind: "implementation_review" | "roadmap_review" | "feature_review",
  v: ReturnType<typeof verdict>,
) {
  const claim = await h.call("POST", "/v1/reviews/claim", {
    token: acct.token,
    idem: true,
    body: { deviceId: acct.deviceId, slot, kinds: [kind] },
  });
  if (claim.status !== 200 || !claim.body) throw new Error(`claimReview ${claim.status} ${JSON.stringify(claim.body)}`);
  const plan = claim.body.contextPlan;
  const leaseId = claim.body.lease.id;
  const m = await manifestFor(h, plan, kind);
  const mr = await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: acct.token, idem: true, body: m });
  if (mr.status !== 200) throw new Error(`manifest ${mr.status} ${JSON.stringify(mr.body)}`);
  const run = await h.call("POST", `/v1/leases/${leaseId}/agent-runs`, {
    token: acct.token,
    idem: true,
    body: signedRun(acct.key, plan, leaseId, acct.deviceId, m.manifestSha256),
  });
  const [round] = await h.owner<
    { head_sha: string; submission_sha256: string }[]
  >`select head_sha, submission_sha256 from wos.rounds where id = ${plan.roundId}`;
  const res = await h.call("POST", `/v1/leases/${leaseId}/verdict`, {
    token: acct.token,
    idem: true,
    body: { verdict: v, headSha: round!.head_sha, submissionSha256: round!.submission_sha256, agentRunId: run.body.agentRunId },
  });
  return { claim, res, plan };
}

export async function buildAndSubmit(h: Harness, builder: Account, abuId: string, files: Array<{ path: string; content: string }>) {
  const claim = await h.call("POST", `/v1/abus/${abuId}/claim`, { token: builder.token, idem: true, body: { deviceId: builder.deviceId } });
  if (claim.status !== 200) throw new Error(`claim ${claim.status} ${JSON.stringify(claim.body)}`);
  const plan = claim.body.contextPlan;
  const leaseId = claim.body.lease.id;
  const attemptId = claim.body.attempt.id;
  const m = await manifestFor(h, plan, "abu_build");
  expect((await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: builder.token, idem: true, body: m })).status).toBe(200);
  const run = await h.call("POST", `/v1/leases/${leaseId}/agent-runs`, {
    token: builder.token,
    idem: true,
    body: signedRun(builder.key, plan, leaseId, builder.deviceId, m.manifestSha256),
  });
  expect(run.status).toBe(200);
  const phase = await h.call("POST", `/v1/attempts/${attemptId}/phase`, {
    token: builder.token,
    idem: true,
    body: { phase: "verifying", localRepair: false },
  });
  expect(phase.body.state).toBe("verifying");
  const cs = signedChangeset(builder.key, {
    taskId: plan.taskId,
    leaseId,
    deviceId: builder.deviceId,
    parentCommit: plan.source.commit,
    manifestSha256: m.manifestSha256,
    files,
  });
  const submit = await h.call("POST", `/v1/leases/${leaseId}/changeset`, { token: builder.token, idem: true, body: cs });
  return { claim, plan, leaseId, attemptId, cs, submit };
}

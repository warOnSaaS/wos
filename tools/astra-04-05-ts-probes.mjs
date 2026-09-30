// Astra reviews 04 and 05: TypeScript probes of the engine and the rules (run before and after the fix pass).
// Needs built contracts: npm run build -w @waronsaas/contracts. Each line prints REPRODUCED (the finding's sequence is
// accepted or fails the honest case) or FIXED (refused for the right reason / the honest case now works).
// Pre-fix output: docs/protocol/reviews/ASTRA-REVIEW-04-05-repros-prefix.txt. The fixed behaviour is asserted in
// packages/contracts/test/protocol.test.ts and protocol-rules.test.ts.
import { readFileSync } from "node:fs";
import * as P from "../packages/contracts/dist/protocol/index.js";

const json = (f) => JSON.parse(readFileSync(new URL(`../packages/contracts/src/protocol/data/${f}`, import.meta.url), "utf8"));
const reward = json("reward-policy.v1.json");
const completion = json("completion-policy.v1.json");
const base = P.engineParamsFrom(reward, completion);
const p = { ...base, emissionReserve: 1000n, budgetPpm: 0n, holdbackBp: 0n };
const st = (o) => ({ ...P.initialState(1000n), ...o });
const E = (input, params = p) => P.computeEpoch({ consumedIds: new Set(), ...input }, params);
const probe = (name, f) => {
  let verdict;
  try {
    verdict = f();
  } catch (e) {
    verdict = `THROWS ${e.message}`;
  }
  console.log(`${name} => ${verdict}`);
};
const exported = new Set(Object.keys(P));
const has = (name) => exported.has(name);

console.log("---- engine (review 04 finding 1 / review 05 B7, B3, B4, B5, B8, B9; review 04 finding 10)");
probe("R04-1a/B7 dispute of tokens already delivered", () => {
  const s = E({
    epochNumber: 1,
    state: st({ remainingReserve: 900n, cumulativeIssued: 100n, claimable: new Map([["alice", 100n]]) }),
    claims: [{ id: "c1", beneficiaryId: "alice", amount: 100n }],
  }).state;
  const input = P.engineParamsFrom ? { epochNumber: 2, state: s } : null;
  const d = has("openEpoch")
    ? { id: "d1", recoveries: [{ beneficiaryId: "alice", from: "delivered", amount: 100n }], bounties: [] }
    : { id: "d1", excessBase: 100n, bounties: [] };
  const r = E({ ...input, disputeSettlements: [d] }).state;
  return r.remainingReserve === 1000n
    ? `REPRODUCED: reserve back to ${r.remainingReserve} and issuance ${r.cumulativeIssued} although alice's 100 was delivered`
    : `FIXED: reserve ${r.remainingReserve}, issuance ${r.cumulativeIssued}, alice owes offset ${r.offsets.get("alice") ?? 0n}`;
});
probe("R04-1b/B7 dispute of alice's unclaimed 20", () => {
  const s = st({ remainingReserve: 900n, cumulativeIssued: 100n, claimable: new Map([["alice", 100n]]) });
  const d = has("openEpoch")
    ? { id: "d1", recoveries: [{ beneficiaryId: "alice", from: "claimable", amount: 20n }], bounties: [] }
    : { id: "d1", excessBase: 20n, bounties: [] };
  const r = E({ epochNumber: 1, state: s, disputeSettlements: [d] }).state;
  return `FIXED: alice claimable ${r.claimable.get("alice")}, issuance ${r.cumulativeIssued}, reserve ${r.remainingReserve}`;
});
probe("R04-10 computeEpoch without consumedIds at runtime", () => {
  const r = P.computeEpoch({ epochNumber: 1, state: st({}) }, p);
  return `REPRODUCED: accepted, reserve ${r.state.remainingReserve}`;
});
const pt = {
  ...base,
  emissionReserve: 1000n,
  budgetPpm: 1_000_000n,
  rateCeilingInitialBasePerAcu: 100n,
  rateCeilingDecayPpm: 0n,
  holdbackBp: 0n,
};
const iss = (taskId, acu, extra = {}) => ({
  taskId,
  kind: "execution",
  budgetAcuMicro: acu * 1_000_000n,
  featurePoolKeys: ["feature"],
  applicationPoolKeys: ["app"],
  ...extra,
});
probe("B3a issue and accept the same task in one epoch", () => {
  const r = E(
    {
      epochNumber: 1,
      state: st({}),
      issuances: [iss("same", 1n)],
      acceptances: [{ taskId: "same", shares: [{ accountId: "a", beneficiaryId: "a", shareBp: 10000 }] }],
    },
    pt,
  );
  return `FIXED: accepted ${r.acceptedBase} in the epoch it was issued`;
});
probe("B3b a second computeEpoch call for the same epoch draws capacity again", () => {
  const first = E({ epochNumber: 1, state: st({}), issuances: [iss("first", 7n)] }, pt);
  const second = E({ epochNumber: 1, state: first.state, issuances: [iss("second", 1n)] }, pt);
  const total = [...second.state.reserved.values()].reduce((t, x) => t + x.amount, 0n);
  return `REPRODUCED: ${total} reserved under epoch 1 (first call's capacity ${first.taskCapacity.execution + first.taskCapacity.planning + first.taskCapacity.human_review})`;
});
probe("B4 accept at epoch 9 a task that expired at epoch 5", () => {
  const first = E({ epochNumber: 1, state: st({}), issuances: [iss("t", 1n)] }, pt);
  const r = E(
    {
      epochNumber: 9,
      state: first.state,
      acceptances: [{ taskId: "t", shares: [{ accountId: "a", beneficiaryId: "a", shareBp: 10000 }] }],
    },
    pt,
  );
  return `REPRODUCED: paid ${r.acceptedBase} after expiry (expires at ${first.state.reserved.get("t").expiresAtEpoch})`;
});
probe("B5 a released task leaves its pool and security accrual behind", () => {
  const first = E({ epochNumber: 1, state: st({}), issuances: [iss("t", 1n)] }, pt);
  const r = E({ epochNumber: 2, state: first.state, releases: [{ taskId: "t" }] }, { ...pt, budgetPpm: 0n });
  const pools = [...r.state.poolBalances.values()].reduce((t, x) => t + x, 0n);
  return pools + r.state.securityReserve > 0n
    ? `REPRODUCED: pools ${pools} + security ${r.state.securityReserve} remain after the task failed`
    : `FIXED: pools ${pools}, security ${r.state.securityReserve} after the task failed`;
});
probe("B8 an unfunded task retried next epoch under the same id", () => {
  const first = E({ epochNumber: 1, state: st({}), issuances: [iss("big", 100n)] }, pt);
  const consumed = new Set(first.consumedIds);
  const r = P.computeEpoch({ epochNumber: 2, state: first.state, consumedIds: consumed, issuances: [iss("big", 1n)] }, pt);
  return `FIXED: retried and funded ${r.funded.join(",")}`;
});
probe(
  "B9 engine reservation of a 1 micro-ACU budget at 500000 per ACU",
  () => `engine ${P.budgetToBase(1n, 500000n)} (SQL side in the SQL repro)`,
);

console.log("---- rules (review 05 B1, B2, B6, B10; review 04 findings 4, 6, 7, 9, 11)");
probe("B1 a budget bounded against a caller-supplied model 100x the real one", () => {
  const r = P.budgetRefusals({
    budgetMicro: 1_000_000_000n,
    modelMicro: 1_000_000_000n,
    humanAboveBp: 12500,
    hardMaxBp: 20000,
    justification: "",
    approvalRefusals: null,
    objectiveBudgetMicro: 10_000_000_000n,
    objectiveUsedMicro: 0n,
    epochOpenWithRate: true,
    cluster: "devnet",
    ...(has("budgetModelMicro")
      ? {
          computedModel: P.budgetModelMicro(
            {
              capabilityBudgets: P.CAPABILITY_POLICY_V1.budgets,
              model: reward.budgets.model,
              humanReviewWeights: reward.humanReview.weightAcuEqMicro,
            },
            { taskKind: "abu_build", sizePoints: 2, difficultyBp: 10000, importanceBp: 10000 },
          ),
          objectiveConsensus: { revealed: true, outcome: "consensus", coversBudget: true },
        }
      : {}),
  });
  return r.length === 0 ? "REPRODUCED: no refusal" : `FIXED: ${r.join("; ")}`;
});
probe("B2 a 50/50 task allocated 100/0", () => {
  if (!has("taskAllocationRefusals"))
    return "REPRODUCED: no rule derives per-receipt amounts from the declared shares (allocationLineRefusals checks slice/account/beneficiary only)";
  const r = P.taskAllocationRefusals({
    reservedBase: 100n,
    receipts: [
      { receiptId: "a", shareBp: 5000, orgShareBp: 0 },
      { receiptId: "b", shareBp: 5000, orgShareBp: 0 },
    ],
    lines: [
      { receiptId: "a", beneficiary: "person", amount: 100n },
      { receiptId: "b", beneficiary: "person", amount: 0n },
    ],
  });
  return r.length ? `FIXED: ${r.join("; ")}` : "REPRODUCED";
});
probe("B6 a HUMAN_REVIEW receipt with no human review behind it", () => {
  if (!has("receiptRouteRefusals")) return "REPRODUCED: receiptRefusals has no contribution-type route or human-review binding";
  const r = P.receiptRouteRefusals({
    acceptance: reward.acceptance,
    contributionType: "HUMAN_REVIEW",
    slice: "human_review",
    evidenceClass: "accepted_budget",
    taskKind: "human_review",
    hasLease: false,
    humanReview: null,
    receiptAccountId: "a",
    taskId: "t",
  });
  return r.length ? `FIXED: ${r.join("; ")}` : "REPRODUCED";
});
probe("B10 a valid accepted task refused because its optional telemetry was reused", () => {
  const args = {
    consentAccepted: true,
    epochState: "OPEN",
    cluster: "devnet",
    contributionType: "IMPLEMENTATION",
    subjectKind: "attempt",
    attemptMerged: true,
    qualificationOk: true,
    needsQualification: true,
    evidenceClass: "accepted_budget",
    weightMicro: 1n,
    budget: { amountMicro: 1n, kind: "execution", released: false, expiresEpoch: 9 },
    slice: "execution",
    admittedEpoch: 2,
    shareBp: 10000,
    sharesAlreadyDeclaredBp: 0,
    usage: { allOwnAndThisLease: true, anyAttributedElsewhere: true },
  };
  const r = P.receiptRefusals(args);
  return r.length ? `REPRODUCED: ${r.join("; ")}` : "FIXED: admitted; the telemetry link is excluded instead";
});
probe("R04-6 the typed run-policy snapshot and the human-review requirement", () => {
  const shape = P.RunPolicySnapshot?.shape ?? {};
  return "humanReviewRequired" in shape
    ? "FIXED: RunPolicySnapshot carries humanReviewRequired"
    : "REPRODUCED: RunPolicySnapshot has no humanReviewRequired; the rule trusts a caller-supplied boolean";
});
probe(
  "R04-7 run-pinned oracle telemetry admitted to an epoch with another oracle",
  () => "OBSOLETE: receiptRefusals takes no oracle input since D49; telemetry never prices the receipt",
);
probe("R04-4 confiscation with an appeal window ten years long", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const r = P.confiscationNoticeRefusals({
    nowMs: now,
    replyClosesAtMs: now + 100 * 3_600_000,
    appealClosesAtMs: now + 10 * 365 * 86_400_000,
    holdExpiresAtMs: Number.POSITIVE_INFINITY,
  });
  return r.length ? `FIXED: ${r.join("; ")}` : "REPRODUCED: no refusal";
});
probe("R04-9 a reviewer grant approved for low-risk review used to grant protocol review", () => {
  const a = {
    id: "x",
    action: "authorize_reviewer",
    targetKind: "account",
    targetId: "b",
    payload: {},
    requiresCoSigner: false,
    coSignerAccountId: null,
    operationSha256: "s",
  };
  // Pre-fix API: `operation` is optional, so a consumer that binds only kind and target passes. Post-fix: `consumer`
  // names the canonical field list and the grant's scope must be in the approved payload.
  const need = has("canonicalOperationFields")
    ? {
        kinds: ["authorize_reviewer"],
        targetKind: "account",
        targetId: "b",
        consumer: "reviewer_grant",
        operation: { accountId: "b", riskClasses: ["protocol"], domains: ["general"], level: 2, contributionTypes: ["IMPLEMENTATION"] },
      }
    : { kinds: ["authorize_reviewer"], targetKind: "account", targetId: "b" };
  const r = P.adminAuthorizationRefusals({ ...a, payload: { accountId: "b", riskClasses: ["low_risk"] } }, need, {
    approval: null,
    alreadyUsed: false,
  });
  return r.length ? `FIXED: ${r.join("; ")}` : "REPRODUCED: kind and target match; the grant's scope is not part of the checked operation";
});
probe("R04-11 a Genesis manifest with duplicate and test receipts under an asserted hash", () => {
  const rc = {
    exists: true,
    status: "ACTIVE",
    admittedEpoch: 1,
    relatedToGenesisBeneficiary: false,
    mode: "test",
    receiptId: "r1",
    contributionType: "PROPOSAL",
  };
  const r = P.genesisReferenceManifestRefusals({
    receipts: [rc, rc],
    cutoffEpoch: 2,
    approvalRefusals: [],
    manifest: { version: "v", cutoffEpoch: 2, rules: { types: ["PROPOSAL"] }, receiptIds: ["r1", "r1"] },
    manifestSha256: `sha256:${"b".repeat(64)}`,
  });
  return r.length ? `FIXED: ${r.join("; ")}` : "REPRODUCED: no refusal";
});

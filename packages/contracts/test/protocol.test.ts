/**
 * DRAFT Proof of Contribution contracts: policy data parses, the engine conserves the funding equation with
 * non-negative balances, receipt hashes and the allocation Merkle tree are deterministic, the usage adapters dedupe by
 * provider response id and report malformed evidence, and Astra review 02's executed counterexamples (H1 returns and
 * replay, H5 organization cap, H13 application pool, L18 rounding split) now fail closed.
 */
import { describe, expect, it } from "vitest";
import {
  type AnomalyReceipt,
  activationRefusals,
  anomalyMetrics,
  acuMicroFromUsage,
  disputeBounty,
  disputeItemStakes,
  stakeForfeited,
  allocationTree,
  assertConserved,
  budgetToBase,
  openEpoch,
  reservationExpiry,
  governanceWeights,
  capGroupShares,
  CAPABILITY_POLICY_V1,
  contributionWeight,
  GOVERNANCE_POLICY_V1,
  lockedWeight,
  OFFRAMP_DISCLOSURE,
  proposalTier,
  tallyDualMajority,
  COMPLETION_POLICY_V1,
  type ClaimLeaf,
  clipToCap,
  codexUsage,
  computeEpoch,
  type ContributionReceipt,
  contributionReceiptSha256,
  dutyOutstanding,
  EngineError,
  type EngineReceipt,
  type EngineState,
  type TaskAcceptance,
  type TaskIssuance,
  EpochMachine,
  engineParamsFrom,
  GENESIS_POLICY_V1,
  HumanReview,
  initialState,
  largestRemainder,
  MODEL_RATE_ORACLE_V1,
  merkleProof,
  parseClaudeStream,
  parseCodexRollout,
  parseCodexExecStream,
  REVIEW_POLICY_V1,
  REWARD_POLICY_V1,
  PayoutAuditVerdict,
  payoutCanaryCaught,
  RunLog,
  runLogTotals,
  ReceiptStatusMachine,
  rateCeiling,
  receiptCountsIn,
  usageEventIdsSha256,
  usageMismatchBp,
  verifyClaimLeaf,
} from "../src/protocol/index.js";

const params = engineParamsFrom(REWARD_POLICY_V1, COMPLETION_POLICY_V1);
const RESERVE = BigInt(REWARD_POLICY_V1.emission.emissionReserveBase);
const u = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const RATE1 = BigInt(REWARD_POLICY_V1.emission.rateCeiling.initialBasePerAcu); // epoch-1 issuance rate, base per ACU

/** A task issuance with a budget in whole ACU (D49). */
function task(i: number, budgetAcu: number, kind: TaskIssuance["kind"] = "execution"): TaskIssuance {
  return {
    taskId: u(1000 + i),
    kind,
    budgetAcuMicro: BigInt(budgetAcu) * 1_000_000n,
    featurePoolKeys: kind === "execution" ? ["salesforce/contacts"] : [],
    applicationPoolKeys: kind === "execution" ? ["salesforce"] : [],
  };
}
const solo = (i: number, account: number | string): TaskAcceptance => {
  const a = typeof account === "number" ? u(account) : account;
  return { taskId: u(1000 + i), shares: [{ accountId: a, beneficiaryId: a, shareBp: 10_000 }] };
};
function outcome(i: number, account: number, weightAcu: number): EngineReceipt {
  return { receiptId: u(2000 + i), accountId: u(account), slice: "outcomes", weightMicro: BigInt(weightAcu) * 1_000_000n };
}

const fresh = (state: EngineState = initialState(RESERVE), epochNumber = 1) => ({
  epochNumber,
  state,
  consumedIds: new Set<string>() as ReadonlySet<string>,
});
const tranche = (beneficiaryId: string, epochNumber: number, amount: bigint, maturesAtEpoch = epochNumber + 6) => ({
  trancheId: `${epochNumber}:${beneficiaryId}`,
  beneficiaryId,
  epochNumber,
  amount,
  maturesAtEpoch,
  policyVersion: "reward-policy.v1",
});
const net = (r: ReturnType<typeof computeEpoch>, b: string) => {
  const e = r.entitlements.get(b)!;
  return e.releasedNow + e.heldBack;
};
/** Issue then accept in the next epoch (replay state carried). */
function issueAccept(issuances: TaskIssuance[], acceptances: TaskAcceptance[], p = params) {
  const r1 = computeEpoch({ ...fresh(), issuances }, p);
  const r2 = computeEpoch({ ...fresh(r1.state, 2), consumedIds: new Set(r1.consumedIds), acceptances }, p);
  return { r1, r2 };
}
/** A synthetic small state: reserve 900, issued 100 of which 100 held back by "a" (params with a tiny reserve). */
const small = { ...params, emissionReserve: 1000n };
const smallState = (over: Partial<EngineState> = {}): EngineState => {
  const s = {
    remainingReserve: 900n,
    poolBalances: new Map(),
    securityReserve: 0n,
    reserved: new Map(),
    cumulativeIssued: 100n,
    holdback: [tranche("a", 1, 100n)],
    claimable: new Map(),
    offsets: new Map(),
    lossCarry: 0n,
    holds: new Map(),
    lastEpoch: 0,
    ...over,
  } as Omit<EngineState, "delivered"> & { delivered?: bigint };
  // Whatever is issued but neither held back nor claimable was delivered (I = delivered + claimable + holdback).
  const owned = s.holdback.reduce((t, x) => t + x.amount, 0n) + [...s.claimable.values()].reduce((t, x) => t + x, 0n);
  return { ...s, delivered: s.delivered ?? s.cumulativeIssued - owned };
};

describe("policy data (V1 drafts)", () => {
  it("parses every document and keeps the slices at 10000 bp", () => {
    const s = REWARD_POLICY_V1.slicesBp;
    expect(s.execution + s.planning + s.human_review + s.outcomes + s.completion_accrual + s.security_reserve).toBe(10_000);
    const c = COMPLETION_POLICY_V1.feature;
    expect(c.implementersBp + c.contractAuthorsBp + c.roadmapAuthorsBp + c.reviewersBp + c.finderBp).toBe(10_000);
    expect(BigInt(REWARD_POLICY_V1.emission.emissionReserveBase) + BigInt(GENESIS_POLICY_V1.capBase)).toBe(
      BigInt(REWARD_POLICY_V1.emission.maxSupplyBase),
    );
    expect(REWARD_POLICY_V1.holdback.shareBp).toBe(2000); // D49 recommendation (F15): 20% for 6 epochs
    expect(REWARD_POLICY_V1.budgets.funding).toBe("reserve_at_issuance");
    expect(REWARD_POLICY_V1.budgets.qualityFactor).toBe("none");
  });
  it("pays budgets and outcomes only (D49: usage is never an evidence class for pay); mainnet stays closed", () => {
    expect(REWARD_POLICY_V1.eligibility.acceptedEvidenceClasses.mainnet).toEqual([]);
    expect(REWARD_POLICY_V1.eligibility.acceptedEvidenceClasses.devnet).toEqual(["accepted_budget", "outcome"]);
    expect(REWARD_POLICY_V1.acceptance.some((a) => (a.weightBasis as string) === "attested_usage_capped")).toBe(false);
  });
  it("never lets self-review qualify and requires a human for every class but low_risk (D23)", () => {
    expect(REVIEW_POLICY_V1.bootstrap.selfReviewSatisfiesRules).toBe(false);
    for (const r of REVIEW_POLICY_V1.rules) expect(r.humans.count).toBe(r.riskClass === "low_risk" ? 0 : 1);
    expect(REVIEW_POLICY_V1.rules.every((r) => r.agentReviews.length === 2)).toBe(true);
  });
  it("uses capability classes, not brands, and never 'ultra'", () => {
    const text = JSON.stringify(CAPABILITY_POLICY_V1);
    expect(text).not.toContain('"ultra"');
    expect(CAPABILITY_POLICY_V1.classes.map((c) => c.id)).toContain("REVIEW_A");
  });
  it("marks every oracle rate unverified (activation must check the providers' price pages)", () => {
    expect(MODEL_RATE_ORACLE_V1.rates.every((r) => r.verified === false)).toBe(true);
  });
  it("defines one acceptance event per contribution type it rewards", () => {
    const types = REWARD_POLICY_V1.acceptance.map((a) => a.contributionType);
    expect(new Set(types).size).toBe(types.length);
    expect(REWARD_POLICY_V1.acceptance.find((a) => a.contributionType === "HUMAN_REVIEW")?.needsUsageReceipt).toBe(false);
  });
});

describe("engine math", () => {
  it("largestRemainder sums exactly and breaks ties by key", () => {
    const m = largestRemainder(10n, [
      { key: "b", weight: 1n },
      { key: "a", weight: 1n },
      { key: "c", weight: 1n },
    ]);
    expect([...m.values()].reduce((s, v) => s + v, 0n)).toBe(10n);
    expect(m.get("a")).toBe(4n);
    expect(() => largestRemainder(1n, [{ key: "a", weight: 0n }])).toThrow(EngineError);
  });
  it("prices usage in mutually exclusive categories (Opus 5.5 draft rates)", () => {
    const opus = MODEL_RATE_ORACLE_V1.rates.find((r) => r.modelId === "claude-opus-5-5")!;
    expect(
      acuMicroFromUsage({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, cacheWriteInputTokens: 0, outputTokens: 100_000 }, opus),
    ).toBe(6_200_000n);
    expect(clipToCap(9n, 5n)).toBe(5n);
  });
  it("decays the rate ceiling per epoch", () => {
    expect(rateCeiling(100_000_000n, 3327n, 1)).toBe(100_000_000n);
    expect(rateCeiling(100_000_000n, 3327n, 209)).toBeLessThan(50_100_000n);
    expect(rateCeiling(100_000_000n, 3327n, 209)).toBeGreaterThan(49_900_000n);
  });
});

describe("computeEpoch: budget-based rewards (D49)", () => {
  it("an empty epoch issues nothing and keeps the whole budget in the reserve", () => {
    const r = computeEpoch(fresh(), params);
    expect(r.state.cumulativeIssued).toBe(0n);
    expect(r.state.remainingReserve).toBe(RESERVE);
    expect(r.returnedToReserve).toBe(r.budget);
  });
  it("reserves budget x issuance rate at issuance and pays exactly that on acceptance, whatever tokens were used", () => {
    const { r1, r2 } = issueAccept([task(1, 50)], [solo(1, 1)]);
    expect(r1.funded).toEqual([u(1001)]);
    expect(r1.state.reserved.get(u(1001))!.amount).toBe(50n * RATE1);
    expect(net(r2, u(1))).toBe(50n * RATE1);
    // Low participation: the unused capacity simply stays in the reserve (no windfall for contributor zero).
    expect(r1.reservedBySlice.execution).toBeLessThan(r1.taskCapacity.execution);
  });
  it("D49 epoch contract: a task that does not fit the epoch's capacity is NOT issued (never scaled)", () => {
    const c = computeEpoch(fresh(), params).taskCapacity;
    const cap = c.execution + c.planning + c.human_review;
    const perTask = cap / RATE1 / 3n + 1n; // three of these do not fit
    const tasks = [1, 2, 3].map((i) => ({ ...task(i, 0), budgetAcuMicro: perTask * 1_000_000n }));
    const r = computeEpoch({ ...fresh(), issuances: tasks }, params);
    expect(r.funded).toEqual([u(1001), u(1002)]);
    expect(r.unfunded).toEqual([u(1003)]);
    expect(r.reservedBySlice.execution).toBeLessThanOrEqual(cap);
    for (const id of r.funded) expect(r.state.reserved.get(id)!.amount).toBe(perTask * RATE1);
  });
  it("all task kinds draw on one pooled capacity at one rate per ACU (a planning ACU costs what a build ACU costs)", () => {
    const r = computeEpoch({ ...fresh(), issuances: [task(1, 10, "planning"), task(2, 10, "human_review"), task(3, 10)] }, params);
    expect(r.reservedBySlice.planning).toBe(10n * RATE1);
    expect(r.reservedBySlice.human_review).toBe(10n * RATE1);
    expect(r.reservedBySlice.execution).toBe(10n * RATE1);
  });
  it("the issuance rate falls ex ante with the published demand forecast, so capacity is used without scaling later", () => {
    const cap = computeEpoch(fresh(), params);
    const capacity = cap.taskCapacity.execution + cap.taskCapacity.planning + cap.taskCapacity.human_review;
    const demand = (capacity / RATE1) * 4n * 1_000_000n; // four times what the ceiling rate could fund
    const r = computeEpoch({ ...fresh(), demandForecastAcuMicro: demand }, params);
    expect(r.rateCeilingBasePerAcu).toBe((capacity * 1_000_000n) / demand);
    const tasks = [1, 2, 3, 4].map((i) => ({ ...task(i, 0), budgetAcuMicro: demand / 4n }));
    const r2 = computeEpoch({ ...fresh(), demandForecastAcuMicro: demand, issuances: tasks }, params);
    expect(r2.unfunded).toEqual([]);
  });
  it("the issuance rate is fixed at issuance: accepting later pays the same (no timing gain)", () => {
    const r1 = computeEpoch({ ...fresh(), issuances: [task(1, 10)] }, params);
    let st = r1.state;
    let ids = new Set(r1.consumedIds);
    for (let e = 2; e <= 3; e++) {
      const r = computeEpoch({ ...fresh(st, e), consumedIds: ids }, params);
      st = r.state;
      ids = new Set([...ids, ...r.consumedIds]);
    }
    const r4 = computeEpoch({ ...fresh(st, 4), consumedIds: ids, acceptances: [solo(1, 1)] }, params);
    expect(net(r4, u(1))).toBe(10n * RATE1);
    expect(r4.rateCeilingBasePerAcu).toBeLessThan(RATE1);
  });
  it("an unaccepted task expires after the budget expiry and its reservation returns to the reserve", () => {
    const r1 = computeEpoch({ ...fresh(), issuances: [task(1, 10)] }, params);
    let st = r1.state;
    let ids = new Set(r1.consumedIds);
    let expired: string[] = [];
    for (let e = 2; e <= 1 + REWARD_POLICY_V1.budgets.expiryEpochs; e++) {
      const r = computeEpoch({ ...fresh(st, e), consumedIds: ids }, params);
      st = r.state;
      ids = new Set([...ids, ...r.consumedIds]);
      expired = [...expired, ...r.expired];
    }
    expect(expired).toEqual([u(1001)]);
    expect(st.reserved.size).toBe(0);
    expect(() => computeEpoch({ ...fresh(st, 9), consumedIds: ids, acceptances: [solo(1, 1)] }, params)).toThrow(/no reservation/);
  });
  it("a released task returns its reservation; a task is accepted at most once", () => {
    const r1 = computeEpoch({ ...fresh(), issuances: [task(1, 10), task(2, 10)] }, params);
    const r2 = computeEpoch(
      { ...fresh(r1.state, 2), consumedIds: new Set(r1.consumedIds), releases: [{ taskId: u(1001) }], acceptances: [solo(2, 1)] },
      params,
    );
    expect(r2.releasedBase).toBe(10n * RATE1);
    expect(() =>
      computeEpoch(
        { ...fresh(r2.state, 3), consumedIds: new Set([...r1.consumedIds, ...r2.consumedIds]), acceptances: [solo(2, 1)] },
        params,
      ),
    ).toThrow(/consumed twice/);
    expect(() => computeEpoch({ ...fresh(r1.state, 2), consumedIds: new Set(r1.consumedIds), acceptances: [solo(9, 1)] }, params)).toThrow(
      /no reservation/,
    );
  });
  it("collaborators split by declared shares (sum 10000), exactly, with each contributor's sponsorship beneficiary", () => {
    const shares: TaskAcceptance = {
      taskId: u(1001),
      shares: [
        { accountId: u(1), beneficiaryId: u(1), shareBp: 3333 },
        { accountId: u(2), beneficiaryId: "org:acme", shareBp: 3333 },
        { accountId: u(3), beneficiaryId: u(3), shareBp: 3334 },
      ],
    };
    const { r2 } = issueAccept([task(1, 7)], [shares]);
    const lines = r2.allocations.filter((a) => a.receiptId === u(1001));
    expect(lines.reduce((t, l) => t + l.amountBase, 0n)).toBe(7n * RATE1);
    expect(r2.entitlements.has("org:acme")).toBe(true);
    expect(() =>
      issueAccept([task(1, 7)], [{ taskId: u(1001), shares: [{ accountId: u(1), beneficiaryId: u(1), shareBp: 9999 }] }]),
    ).toThrow(/sum to 10000/);
  });
  it("execution, planning and human review are not weights any more: such receipts are refused", () => {
    const bad = { receiptId: "x", accountId: "a", slice: "execution", weightMicro: 1n } as unknown as EngineReceipt;
    expect(() => computeEpoch({ ...fresh(), receipts: [bad] }, params)).toThrow(/budgeted tasks/);
  });
  it("outcomes still compete by weight in their own slice, capped per ACU-equivalent", () => {
    const r = computeEpoch({ ...fresh(), receipts: [outcome(1, 1, 10), outcome(2, 2, 30)] }, params);
    expect(r.outcomesEmitted).toBe(40n * RATE1 < r.slices.outcomes! ? 40n * RATE1 : r.slices.outcomes!);
    expect(net(r, u(2))).toBe(3n * net(r, u(1)));
  });
  it("holds back the policy share of each net allocation and releases the tranche at its pinned epoch (D40, D49 size)", () => {
    const { r2 } = issueAccept([task(1, 10)], [solo(1, 1)]);
    const e = r2.entitlements.get(u(1))!;
    expect(e.heldBack * 10_000n).toBe(10n * RATE1 * BigInt(REWARD_POLICY_V1.holdback.shareBp));
    let st = r2.state;
    const mat = 2 + REWARD_POLICY_V1.holdback.epochs;
    for (let ep = 3; ep <= mat; ep++) {
      const r = computeEpoch({ ...fresh(st, ep) }, params);
      if (ep === mat) expect(r.entitlements.get(u(1))!.maturedHoldback).toBe(e.heldBack);
      st = r.state;
    }
    expect(st.holdback).toEqual([]);
  });
  it("pools accrue only on ACCEPTANCE, in proportion to the task's reservation, to the pools of that task (B5)", () => {
    const { r1, r2 } = issueAccept([task(1, 50)], [solo(1, 1)]);
    expect(r1.accruals.size).toBe(0);
    const accrued = [...r2.accruals.values()].reduce((s, v) => s + v, 0n);
    expect(accrued).toBeGreaterThan(0n);
    expect(accrued).toBeLessThan(r1.slices.completion_accrual!);
    expect(r2.accruals.has("salesforce/contacts")).toBe(true);
  });
  it("feature pools pay by component; a missing finder returns to the reserve", () => {
    const { r2: e1 } = issueAccept([task(1, 100)], [solo(1, 1)]);
    const bal = e1.state.poolBalances.get("salesforce/contacts")!;
    const e2 = computeEpoch(
      {
        ...fresh(e1.state, 3),
        consumedIds: new Set(e1.consumedIds),
        poolPayouts: [
          {
            id: "pay-1",
            poolKey: "salesforce/contacts",
            kind: "feature",
            beneficiaries: [{ beneficiaryId: u(1), component: "implementers", weight: 1n }],
          },
        ],
      },
      params,
    );
    expect(e2.state.poolBalances.get("salesforce/contacts")).toBeUndefined();
    expect(e2.allocations.find((a) => a.slice === "completion_payout")!.amountBase).toBe((bal * 7500n) / 10_000n);
  });
  it("H13: an application pool pays 100% by lifetime weight", () => {
    const st = smallState({ remainingReserve: 800n, poolBalances: new Map([["app", 100n]]) });
    const r = computeEpoch(
      {
        ...fresh(st),
        poolPayouts: [
          { id: "app-1", poolKey: "app", kind: "application", beneficiaries: [{ beneficiaryId: "x", component: "lifetime", weight: 1n }] },
        ],
      },
      small,
    );
    expect(r.allocations.find((a) => a.slice === "completion_payout")!.amountBase).toBe(100n);
  });
  it("conserves R + P + S + Q + I with reservations outstanding", () => {
    const r = computeEpoch({ ...fresh(), issuances: [task(1, 10), task(2, 20, "planning")] }, params);
    expect(() => assertConserved(RESERVE, r.state)).not.toThrow();
    expect(() => assertConserved(RESERVE, { ...r.state, reserved: new Map() })).toThrow(/funding equation/);
  });
  it("is deterministic and refuses a task issued twice", () => {
    const ts = Array.from({ length: 30 }, (_, i) => task(i, 3 + i));
    expect(computeEpoch({ ...fresh(), issuances: ts }, params).state.reserved).toEqual(
      computeEpoch({ ...fresh(), issuances: ts }, params).state.reserved,
    );
    expect(() => computeEpoch({ ...fresh(), issuances: [task(1, 1), task(1, 2)] }, params)).toThrow(/consumed twice/);
  });
  it("H1: a return must name its source and owner", () => {
    const ok = computeEpoch(
      {
        ...fresh(smallState({ holdback: [], claimable: new Map([["a", 100n]]) })),
        returns: [{ id: "ret-1", kind: "unbound_expiry", beneficiaryId: "a", amount: 100n }],
      },
      small,
    );
    expect(ok.state.remainingReserve + ok.state.cumulativeIssued).toBe(1000n);
    expect(() =>
      computeEpoch(
        {
          ...fresh(smallState({ holdback: [], claimable: new Map([["a", 100n]]) })),
          returns: [{ id: "ret-2", kind: "unbound_expiry", beneficiaryId: "a", amount: 101n }],
        },
        small,
      ),
    ).toThrow(/claimable/);
    expect(() => assertConserved(1000n, { ...smallState(), remainingReserve: 1000n })).toThrow(/funding equation/);
  });
  it("H1: the same dispute settlement cannot be consumed twice", () => {
    const d = {
      id: "dispute-1",
      recoveries: [{ beneficiaryId: "a", from: "claimable" as const, amount: 50n }],
      bounties: [{ beneficiaryId: "b", amountBase: 10n }],
    };
    const owned = smallState({ holdback: [], claimable: new Map([["a", 100n]]) });
    expect(() => computeEpoch({ ...fresh(owned), disputeSettlements: [d, { ...d }] }, small)).toThrow(/consumed twice/);
    const first = computeEpoch({ ...fresh(owned), disputeSettlements: [d] }, small);
    expect(() =>
      computeEpoch({ ...fresh(first.state, 2), consumedIds: new Set(first.consumedIds), disputeSettlements: [d] }, small),
    ).toThrow(/consumed twice/);
  });
  it("H1: a security receipt pays once", () => {
    const sp = { id: "sec-1", receiptId: "r1", beneficiaryId: "b", weightMicro: 1_000_000n };
    expect(() => computeEpoch({ ...fresh(smallState({ holdback: [] })), securityPayouts: [sp, { ...sp, id: "sec-2" }] }, small)).toThrow(
      /consumed twice/,
    );
  });
  it("D41: bounties come only from recovered amounts", () => {
    expect(() =>
      computeEpoch(
        {
          ...fresh(smallState({ holdback: [], claimable: new Map([["a", 100n]]) })),
          disputeSettlements: [
            {
              id: "d9",
              recoveries: [{ beneficiaryId: "a", from: "claimable", amount: 100n }],
              bounties: [{ beneficiaryId: "b", amountBase: 21n }],
            },
          ],
        },
        small,
      ),
    ).toThrow(/more bounty/);
  });
  it("D39: confiscation consumes holdback once, pays a recovered-only bounty and offsets the rest", () => {
    const r = computeEpoch(
      {
        ...fresh(smallState()),
        confiscations: [
          {
            id: "conf-1",
            beneficiaryId: "a",
            holdbackBase: 100n,
            unclaimedBase: 0n,
            provenExcessBase: 150n,
            bounties: [{ beneficiaryId: "b", amountBase: 20n }],
          },
        ],
      },
      small,
    );
    expect(r.state.holdback).toEqual([]);
    expect(r.state.offsets.get("a")).toBe(50n);
    expect(() =>
      computeEpoch(
        {
          ...fresh(smallState()),
          confiscations: [
            { id: "conf-2", beneficiaryId: "a", holdbackBase: 101n, unclaimedBase: 0n, provenExcessBase: 101n, bounties: [] },
          ],
        },
        small,
      ),
    ).toThrow(/less holdback/);
  });
  it("D41: written-off losses reduce later budgets, at most 10% per epoch", () => {
    const st = { ...initialState(RESERVE), offsets: new Map([["x", 10n ** 15n]]) };
    const r1 = computeEpoch({ ...fresh(st), writeOffs: [{ id: "w1", beneficiaryId: "x", amount: 10n ** 12n }] }, params);
    expect(r1.absorbedLoss).toBe(0n); // the envelope is frozen when the epoch opens (B3): absorbed from the next one
    const r = computeEpoch({ ...fresh(r1.state, 2), consumedIds: new Set(r1.consumedIds) }, params);
    expect(r.absorbedLoss).toBe(r.budget / 9n);
  });
});

describe("D49: usage is telemetry — fabrication and waste change nothing by construction", () => {
  it("the payout of an accepted task is independent of any usage (no usage input exists in the engine)", () => {
    const honest = issueAccept([task(1, 12)], [solo(1, 1)]).r2;
    const fabricated = issueAccept([task(1, 12)], [solo(1, 1)]).r2; // same task, whatever tokens a client claims
    expect(net(fabricated, u(1))).toBe(net(honest, u(1)));
  });
  it("splitting an objective's work into more tasks cannot raise the total when budgets respect the objective cap", () => {
    const one = issueAccept([task(1, 12)], [solo(1, 1)]).r2;
    const split = issueAccept([task(1, 6), task(2, 6)], [solo(1, 1), solo(2, 1)]).r2;
    expect(net(split, u(1))).toBe(net(one, u(1)));
  });
});

describe("Astra review 03 probes (docs/protocol/reviews/ASTRA-REVIEW-03-probe-results.jsonl) and regressions", () => {
  const tiny = { ...small, budgetPpm: 0n, holdbackBp: 0n };
  it("A3-10 probe return_identified_only_by_event_not_entitlement: a return needs a claimable balance of its owner", () => {
    const st = smallState({ holdback: [] });
    expect(() =>
      computeEpoch(
        {
          ...fresh(st),
          returns: [
            { id: "x1", kind: "unbound_expiry", beneficiaryId: "nobody", amount: 80n },
            { id: "x2", kind: "unbound_expiry", beneficiaryId: "nobody", amount: 20n },
          ],
        },
        tiny,
      ),
    ).toThrow(/claimable/);
    expect(() => assertConserved(1000n, { ...st, claimable: new Map([["a", 101n]]) })).toThrow(/not owned/);
  });
  it("A3-10 probe negative_security_payout: still refused by the funding equation", () => {
    expect(() => assertConserved(1000n, { ...smallState(), securityReserve: 50n })).toThrow(/funding equation broken: 1050 != 1000/);
  });
  it("A3-10/A3-4 probe confiscation_exceeds_proven_excess: recovery is compensatory, capped at the proven excess", () => {
    const st = smallState({ holdback: [], claimable: new Map([["a", 100n]]) });
    expect(() =>
      computeEpoch(
        {
          ...fresh(st),
          confiscations: [{ id: "c", beneficiaryId: "a", holdbackBase: 0n, unclaimedBase: 100n, provenExcessBase: 1n, bounties: [] }],
        },
        tiny,
      ),
    ).toThrow(/compensatory/);
    const ok = computeEpoch(
      {
        ...fresh(st),
        confiscations: [{ id: "c", beneficiaryId: "a", holdbackBase: 0n, unclaimedBase: 1n, provenExcessBase: 1n, bounties: [] }],
      },
      tiny,
    );
    expect(ok.state.claimable.get("a")).toBe(99n);
  });
  it("A3-10 probe holdback_policy_changes_old_tranches: a tranche keeps the maturity pinned when it was created", () => {
    const st = smallState({ remainingReserve: 950n, cumulativeIssued: 50n, holdback: [tranche("a", 1, 50n, 14)] });
    const r = computeEpoch({ ...fresh(st, 2) }, { ...tiny, holdbackEpochs: 1 });
    expect(r.entitlements.get("a")?.maturedHoldback ?? 0n).toBe(0n);
    expect(r.state.holdback).toEqual([tranche("a", 1, 50n, 14)]);
    const later = computeEpoch({ ...fresh(st, 14) }, { ...tiny, holdbackEpochs: 1 });
    expect(later.entitlements.get("a")!.maturedHoldback).toBe(50n);
    expect(later.state.claimable.get("a")).toBe(50n);
    const { r2 } = issueAccept([task(1, 10)], [solo(1, 1)]);
    expect(r2.state.holdback[0]).toMatchObject({
      maturesAtEpoch: 2 + REWARD_POLICY_V1.holdback.epochs,
      policyVersion: REWARD_POLICY_V1.policyVersion,
    });
  });
  it("A3-10: released amounts become claimable; settled claims leave it once; replay state is required", () => {
    const { r1, r2 } = issueAccept([task(1, 10)], [solo(1, 1)]);
    const e = r2.entitlements.get(u(1))!;
    expect(r2.state.claimable.get(u(1))).toBe(e.releasedNow);
    const ids = new Set([...r1.consumedIds, ...r2.consumedIds]);
    const claim = { id: "leaf-1", beneficiaryId: u(1), amount: e.releasedNow };
    const r3 = computeEpoch({ ...fresh(r2.state, 3), consumedIds: ids, claims: [claim] }, params);
    expect(r3.state.claimable.has(u(1))).toBe(false);
    expect(() =>
      computeEpoch({ ...fresh(r3.state, 4), consumedIds: new Set([...ids, ...r3.consumedIds]), claims: [claim] }, params),
    ).toThrow(/consumed twice/);
    expect(() =>
      computeEpoch({ ...fresh(r2.state, 3), consumedIds: ids, claims: [{ ...claim, amount: e.releasedNow + 1n }] }, params),
    ).toThrow(/claimable/);
  });
  it("A3-15: a completion correction after the pool paid becomes beneficiary offsets instead of blocking the epoch", () => {
    const st = smallState({ holdback: [], remainingReserve: 800n, poolBalances: new Map([["pool", 100n]]) });
    const before = computeEpoch({ ...fresh(st), accrualCorrections: [{ id: "k1", poolKey: "pool", amount: 40n }] }, tiny);
    expect(before.state.poolBalances.get("pool")).toBe(60n);
    const paid = smallState({ holdback: [] });
    expect(() => computeEpoch({ ...fresh(paid), accrualCorrections: [{ id: "k2", poolKey: "pool", amount: 5n }] }, tiny)).toThrow(
      /recoverFromPaid/,
    );
    const after = computeEpoch(
      {
        ...fresh(paid),
        accrualCorrections: [
          {
            id: "k3",
            poolKey: "pool",
            amount: 0n,
            recoverFromPaid: [
              { beneficiaryId: "a", amount: 3n },
              { beneficiaryId: "b", amount: 2n },
            ],
          },
        ],
      },
      tiny,
    );
    expect(after.state.offsets.get("a")).toBe(3n);
    expect(after.state.offsets.get("b")).toBe(2n);
  });
  it("A3-16 probe split_sponsored_rounding: splitting a sponsored outcome cannot move units between beneficiaries", () => {
    const one = (id: string, w: bigint): EngineReceipt => ({
      receiptId: id,
      accountId: "a",
      beneficiaries: [
        { beneficiaryId: "a", shareBp: 5000 },
        { beneficiaryId: "b", shareBp: 5000 },
      ],
      slice: "outcomes",
      weightMicro: w,
    });
    const whole = computeEpoch({ ...fresh(), receipts: [one("r", 2n)] }, params);
    const split = computeEpoch({ ...fresh(), receipts: [one("r1", 1n), one("r2", 1n)] }, params);
    expect(net(split, "a")).toBe(net(whole, "a"));
    expect(net(split, "b")).toBe(net(whole, "b"));
  });
  it("A3-14 probe trailing_rate_not_previous_epoch_bound: dissolved by D49 — the rate is fixed at issuance", () => {
    const r = computeEpoch({ ...fresh(initialState(RESERVE), 5), issuances: [task(1, 1)] }, params);
    expect(r.rateCeilingBasePerAcu).toBe(rateCeiling(RATE1, BigInt(REWARD_POLICY_V1.emission.rateCeiling.decayPpmPerEpoch), 5));
    expect(r.state.reserved.get(u(1001))!.amount).toBe(r.rateCeilingBasePerAcu);
  });
});

describe("usage adapters: Astra review 03 probes (A3-11)", () => {
  it("aggregate_usage_overflow: two individually safe counters whose sum is unsafe fail the run", () => {
    const big = Number.MAX_SAFE_INTEGER;
    const r = parseClaudeStream([
      JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: big } } }),
      JSON.stringify({ type: "assistant", message: { id: "m2", usage: { input_tokens: big } } }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/safe-integer/);
  });
  it("missing_rollout_response_id: a usage-bearing record without its id is an error, not zero usage", () => {
    const r = parseCodexRollout([
      JSON.stringify({ type: "token_usage_record", payload: { usage: { input_tokens: 10, output_tokens: 5 } } }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/without response_id/);
  });
  it("empty_adapter: an empty or foreign log is a parse failure, distinct from a legitimate zero-usage session", () => {
    expect(parseClaudeStream([]).ok).toBe(false);
    expect(parseCodexRollout([]).ok).toBe(false);
    expect(parseCodexExecStream([JSON.stringify({ type: "thread.started" })]).ok).toBe(false);
    const zeroButReal = parseClaudeStream([JSON.stringify({ type: "result", usage: { input_tokens: 0, output_tokens: 0 } })]);
    expect(zeroButReal.ok).toBe(true);
  });
});

describe("optimistic payouts, disputes, anomalies, activation (D28–D33, D43)", () => {
  it("allocates per accepted task so any single allocation can be disputed", () => {
    const { r2 } = issueAccept([task(1, 5), task(2, 7)], [solo(1, 1), solo(2, 1)]);
    const lines = r2.allocations.filter((a) => a.slice === "execution");
    expect(lines.map((l) => l.receiptId)).toEqual([u(1001), u(1002)]);
    expect(lines[0]!.amountBase + lines[1]!.amountBase).toBe(net(r2, u(1)));
  });
  it("prices stakes per item with a floor, forfeits only rejected items", () => {
    const p = REWARD_POLICY_V1.challenge;
    expect(disputeItemStakes(1_000_000_000n, 1, p)).toEqual([20_000_000n]);
    expect(disputeItemStakes(1_000_000_000n, 25, p)).toEqual(Array(25).fill(4_000_000n));
    expect(disputeItemStakes(5_000_000n, 2, p)).toEqual([1_000_000n, 1_000_000n]);
    expect(() => disputeItemStakes(1_500_000n, 2, p)).toThrow(/exceed/);
    expect(
      stakeForfeited([
        { stakeBase: 5n, outcome: "UPHELD" },
        { stakeBase: 5n, outcome: "CLIPPED" },
      ]),
    ).toBe(5n);
    expect(disputeBounty(1000n, REWARD_POLICY_V1.losses.bountyBpOfRecovered)).toBe(200n);
  });
  it("ranks consistent 10% budget inflation above an honest spread even though no budget stands out", () => {
    const peer = 10_000_000n;
    const mk = (acct: number, i: number, factorBp: bigint): AnomalyReceipt => ({
      receiptId: u(5000 + acct * 100 + i),
      accountId: u(acct),
      weightMicro: (peer * factorBp) / 10_000n,
      capMicro: peer * 2n,
      peerP50Micro: peer,
      changedLines: null,
      peerP50MicroPerLine: null,
    });
    const honest = Array.from({ length: 40 }, (_, i) => mk(1, i, i % 2 ? 11_000n : 9_000n));
    const skim = Array.from({ length: 40 }, (_, i) => mk(2, i, 11_000n));
    const rows = anomalyMetrics([...honest, ...skim]);
    expect(rows[0]!.accountId).toBe(u(2));
    expect(rows[0]!.consistencyMilli).toBe(6325);
    expect(rows[1]!.consistencyMilli).toBe(0);
  });
  it("activations are forward-only, announced and previewed; emergencies only touch unpublished allocations", () => {
    const start = Date.UTC(2026, 9, 5);
    const ok = { effectiveEpoch: 5, emergency: false, announcedAtMs: start - 4 * 86_400_000, previewSha256: `sha256:${"a".repeat(64)}` };
    expect(activationRefusals(ok, { openEpoch: 4, openEpochState: "OPEN", epochStartsAtMs: start })).toEqual([]);
    expect(activationRefusals({ ...ok, effectiveEpoch: 4 }, { openEpoch: 4, openEpochState: "OPEN", epochStartsAtMs: start })).toHaveLength(
      1,
    );
    expect(
      activationRefusals({ ...ok, previewSha256: null }, { openEpoch: 4, openEpochState: "OPEN", epochStartsAtMs: start }),
    ).toHaveLength(1);
    const em = { ...ok, effectiveEpoch: 4, emergency: true };
    expect(activationRefusals(em, { openEpoch: 4, openEpochState: "CALCULATING", epochStartsAtMs: start })).toEqual([]);
    expect(activationRefusals(em, { openEpoch: 4, openEpochState: "PROPOSED", epochStartsAtMs: start })).toHaveLength(1);
  });
  it("M14: duty is derived from append-only offer/completion events and never gates an expired offer", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();
    const ev = (offerId: string, kind: "offered" | "completed", h: number) => ({
      offerId,
      accountId: u(1),
      epochNumber: 1,
      kind,
      quorumId: null,
      deadlineAt: at(10),
      at: at(h),
    });
    expect(dutyOutstanding([ev("o1", "offered", 1), ev("o2", "offered", 1), ev("o1", "completed", 2)], Date.UTC(2026, 9, 1, 3))).toBe(1);
    expect(dutyOutstanding([ev("o2", "offered", 1)], Date.UTC(2026, 9, 1, 11))).toBe(0);
  });
});

describe("governance and off-ramp (D34, D35)", () => {
  const p = GOVERNANCE_POLICY_V1;
  /** Uncapped weights for threshold tests (caps of 100%): still built by governanceWeights, as the tally requires. */
  const gw = (
    ws: readonly { id: number | string; locked: bigint; contribution: bigint; org?: string }[],
    caps = { person: 10_000, org: 10_000 },
  ) =>
    governanceWeights(
      ws.map((x) => ({
        accountId: typeof x.id === "number" ? u(x.id) : x.id,
        organizationId: x.org ?? null,
        locked: x.locked,
        contribution: x.contribution,
      })),
      { perWalletCapBp: caps.person, orgCapBp: caps.org, lockedVoterMustHaveContributed: p.lockedVoterMustHaveContributed },
    );
  it("needs a majority of BOTH weights and turnout in each", () => {
    const weights = gw([
      { id: 1, locked: 900n, contribution: 10n },
      { id: 2, locked: 50n, contribution: 60n },
      { id: 3, locked: 50n, contribution: 30n },
    ]);
    const whale = tallyDualMajority(
      [
        { accountId: u(1), choice: "yes" },
        { accountId: u(2), choice: "no" },
      ],
      weights,
      p,
    );
    expect(whale.passes).toBe(false);
    expect(whale.reasons).toContain("contribution weight below the routine threshold");
    const both = tallyDualMajority(
      [
        { accountId: u(1), choice: "yes" },
        { accountId: u(2), choice: "yes" },
      ],
      weights,
      p,
    );
    expect(both.passes).toBe(true);
  });
  it("uses tiered supermajorities: 55% passes nothing, 70% passes routine and structural but not governance (D36)", () => {
    const weights = gw([
      { id: 1, locked: 55n, contribution: 55n },
      { id: 2, locked: 45n, contribution: 45n },
      { id: 3, locked: 70n, contribution: 70n },
      { id: 4, locked: 30n, contribution: 30n },
    ]);
    const v = (a: number, b: number) => [
      { accountId: u(a), choice: "yes" as const },
      { accountId: u(b), choice: "no" as const },
    ];
    expect(tallyDualMajority(v(1, 2), weights, p, "routine").passes).toBe(false);
    expect(tallyDualMajority(v(3, 4), weights, p, "routine").passes).toBe(true);
    expect(tallyDualMajority(v(3, 4), weights, p, "structural").passes).toBe(true);
    expect(tallyDualMajority(v(3, 4), weights, p, "governance").passes).toBe(false);
    expect(
      proposalTier("policy_change", "reward", { emissionOrSupply: true, genesisCap: false, newCategory: false, withinLimits: true }),
    ).toBe("structural");
    expect(
      proposalTier("policy_change", "governance", { emissionOrSupply: false, genesisCap: false, newCategory: false, withinLimits: true }),
    ).toBe("governance");
    expect(
      proposalTier("ratify_emergency", null, { emissionOrSupply: false, genesisCap: false, newCategory: false, withinLimits: true }),
    ).toBe("emergency_ratification");
  });
  it("H5: an organization holding 90% ends at <= 10% FINAL share and cannot pass anything alone (old: 50%, passed governance)", () => {
    const ws = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, org: "org", locked: 180n, contribution: 180n })),
      ...Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, locked: 2n, contribution: 2n })),
    ];
    const capped = gw(ws, { person: 500, org: p.orgCapBp });
    const org = capped.weights.slice(0, 5).reduce((t, w) => t + w.contribution, 0n);
    expect(org * 10_000n).toBeLessThanOrEqual(1000n * capped.contributionTotal);
    const t = tallyDualMajority(
      ws.slice(0, 5).map((w) => ({ accountId: w.id, choice: "yes" as const })),
      capped,
      p,
      "governance",
    );
    expect(t.passes).toBe(false);
    // Two 10%-capped groups can never both be under 10%: the tally refuses rather than breaking the promise.
    const two = gw(
      [
        { id: "a", org: "A", locked: 90n, contribution: 90n },
        { id: "b", org: "B", locked: 10n, contribution: 10n },
      ],
      { person: 500, org: 1000 },
    );
    expect(two.feasible).toBe(false);
    const both = [
      { accountId: "a", choice: "yes" as const },
      { accountId: "b", choice: "yes" as const },
    ];
    expect(tallyDualMajority(both, two, p, "routine").passes).toBe(false);
    const many = [
      { groupId: "a", weight: 90n, capBp: 1000 },
      ...Array.from({ length: 20 }, (_, i) => ({ groupId: `g${i}`, weight: 1n, capBp: 1000 })),
    ];
    expect(capGroupShares(many).feasible).toBe(true);
  });
  it("A3-8 probe: caps apply AFTER eligibility, so passive lockers cannot dilute the organization's locked share", () => {
    // Astra's probe: org 900 locked + 900 contribution; 50 active outsiders (0 locked, 2 contribution); 50 passive
    // outsiders (2 locked, 0 contribution). Old: feasible=true, org = 100% of the ELIGIBLE locked denominator.
    const ws = [
      { id: "org", org: "O", locked: 900n, contribution: 900n },
      ...Array.from({ length: 50 }, (_, i) => ({ id: `act${i}`, locked: 0n, contribution: 2n })),
      ...Array.from({ length: 50 }, (_, i) => ({ id: `pas${i}`, locked: 2n, contribution: 0n })),
    ];
    const capped = gw(ws, { person: 500, org: 1000 });
    expect(capped.weights.filter((w) => w.accountId.startsWith("pas")).every((w) => w.locked === 0n)).toBe(true);
    expect(capped.lockedTotal).toBe(capped.weights.find((w) => w.accountId === "org")!.locked);
    expect(capped.feasible).toBe(false); // one eligible locked group cannot be held to 10%: refuse, never exceed
    const t = tallyDualMajority([{ accountId: "org", choice: "yes" }], capped, p);
    expect(t.passes).toBe(false);
    expect(t.reasons.join(" ")).toMatch(/caps infeasible/);
    // With enough eligible independent lockers, the organization's final locked share is <= 10% of the eligible total.
    const ok = gw(
      [
        { id: "org", org: "O", locked: 900n, contribution: 900n },
        ...Array.from({ length: 50 }, (_, i) => ({ id: `both${i}`, locked: 2n, contribution: 2n })),
      ],
      { person: 500, org: 1000 },
    );
    expect(ok.feasible).toBe(true);
    expect(ok.weights.find((w) => w.accountId === "org")!.locked * 10_000n).toBeLessThanOrEqual(1000n * ok.lockedTotal);
  });
  it("A3-8: weights without their validation (a copy, a hand-built array) are refused, never defaulted to feasible", () => {
    const valid = gw([
      { id: 1, locked: 70n, contribution: 70n },
      { id: 2, locked: 30n, contribution: 30n },
    ]);
    const votes = [{ accountId: u(1), choice: "yes" as const }];
    expect(tallyDualMajority(votes, valid, p).passes).toBe(true);
    const lostFlag = { ...valid, feasible: undefined } as unknown as typeof valid;
    expect(tallyDualMajority(votes, lostFlag, p).passes).toBe(false);
    const raw = valid.weights as unknown as typeof valid;
    expect(tallyDualMajority(votes, raw, p).reasons.join(" ")).toMatch(/not produced by governanceWeights/);
    // A serialized round trip keeps the structured flags (bigints as strings, restored by the reader).
    const back = JSON.parse(
      JSON.stringify(valid, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)),
      (_k, v) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v),
    );
    expect(tallyDualMajority(votes, back, p).passes).toBe(true);
  });
  it("A3-8: a zero locked leg passes nothing in dual-majority mode; contribution-only mode skips it (off-ramp)", () => {
    const ws = gw([
      { id: 1, locked: 0n, contribution: 70n },
      { id: 2, locked: 0n, contribution: 30n },
    ]);
    const votes = [
      { accountId: u(1), choice: "yes" as const },
      { accountId: u(2), choice: "no" as const },
    ];
    expect(tallyDualMajority(votes, ws, { ...p, mode: "dual_majority" }).passes).toBe(false);
    expect(tallyDualMajority(votes, ws, { ...p, mode: "contribution_only" }).passes).toBe(true);
  });
  it("ignores locked weight of voters with no recent contribution (recommended rule)", () => {
    const r = tallyDualMajority(
      [
        { accountId: u(1), choice: "yes" },
        { accountId: u(2), choice: "no" },
      ],
      gw([
        { id: 1, locked: 1000n, contribution: 0n },
        { id: 2, locked: 10n, contribution: 100n },
      ]),
      p,
    );
    expect(r.lockedYes).toBe(0n);
    expect(r.passes).toBe(false);
  });
  it("ages contribution out linearly and counts locks only while >= 12 months remain", () => {
    expect(contributionWeight(2600n, 10, 10, 26)).toBe(2600n);
    expect(contributionWeight(2600n, 10, 23, 26)).toBe(1300n);
    expect(contributionWeight(2600n, 10, 36, 26)).toBe(0n);
    expect(lockedWeight(5n, 400 * 86_400_000, 0, 365)).toBe(5n);
    expect(lockedWeight(5n, 300 * 86_400_000, 0, 365)).toBe(0n);
    // Q9: a lock created less than one epoch before the snapshot is not seasoned and counts zero.
    const week = 7 * 86_400_000;
    expect(lockedWeight(5n, 400 * 86_400_000, 0, 365, -week + 1, week)).toBe(0n);
    expect(lockedWeight(5n, 400 * 86_400_000, 0, 365, -week, week)).toBe(5n);
    expect(OFFRAMP_DISCLOSURE).toMatch(/may become worthless/);
  });
});

describe("receipt status and epochs (D23)", () => {
  it("test epochs count provisional receipts; live epochs never do", () => {
    expect(receiptCountsIn("test", "PROVISIONAL")).toBe(true);
    expect(receiptCountsIn("live", "PROVISIONAL")).toBe(false);
    expect(receiptCountsIn("live", "RATIFIED")).toBe(true);
    expect(REVIEW_POLICY_V1.payoutAudit.quorum).toBe(2);
    expect(receiptCountsIn("live", "REVOKED")).toBe(false);
  });
  it("a rejected ratification of founder work returns it to provisional; only RATIFIED counts live (D25)", () => {
    const t = ReceiptStatusMachine.transitions.find((x) => x.event === "ratification_rejected")!;
    expect([t.from, t.to]).toEqual(["PROVISIONAL", "PROVISIONAL"]);
    expect(receiptCountsIn("live", "ACTIVE")).toBe(true);
    expect(ReceiptStatusMachine.transitions.some((x) => x.to === "RATIFIED" && x.from === "PROVISIONAL")).toBe(true);
    expect(EpochMachine.transitions.map((x) => x.to)).toEqual(["CALCULATING", "PROPOSED", "FINALIZED", "DISTRIBUTABLE", "CLOSED"]);
  });
});

describe("hashing and Merkle (P-1..P-4)", () => {
  const base: ContributionReceipt = {
    schema: "wos-contribution-receipt.v1",
    id: u(1),
    contributorAccountId: u(2),
    githubUserId: 1001,
    contributionType: "IMPLEMENTATION",
    slice: "execution",
    target: null,
    feature: "contacts",
    abu: "contacts#04",
    subject: { kind: "attempt", id: u(3) },
    agentRunIds: [u(4)],
    usageReceiptSha256s: [`sha256:${"a".repeat(64)}`],
    contextManifestSha256: `sha256:${"b".repeat(64)}`,
    baseCommit: "1".repeat(40),
    mergeCommit: "2".repeat(40),
    pr: { repo: "waronsaas/product", number: 7 },
    verificationResultSha256: null,
    reviews: {
      astraReviewSha256: null,
      fableReviewSha256: null,
      humanReviewSha256s: [],
      labels: [{ label: "single_lab_review", reason: "fable_unavailable: Fable seat replaced by the required human review (D53)" }],
    },
    weightMicro: "3820000",
    weightBasis: "task_budget",
    taskBudget: { taskId: u(9), budgetAcuMicro: "3820000", issuedEpoch: 1, shareBp: 10_000 },
    evidenceClass: "accepted_budget",
    acceptanceEvent: "pr_merged",
    leaseId: u(5),
    leaseGeneration: 1,
    runPolicySnapshotSha256s: [`sha256:${"c".repeat(64)}`],
    telemetry: { observedAcuMicro: "3820000", lowestVerificationLevel: "ATTESTED" },
    beneficiary: { kind: "person", organizationId: null, sponsorshipId: null, organizationShareBp: 0 },
    independence: "independent",
    initialStatus: "ACTIVE",
    policyVersions: {
      reward: "reward-policy.v1",
      oracle: "oracle.v1",
      review: "review-policy.v1",
      usageProof: "usage-proof-policy.v1",
      agent: "agent-policy.v1",
      capability: "capability-policy.v1",
      risk: "risk-policy.v1",
      merge: "merge-policy.v1",
      completion: "completion-policy.v1",
    },
    epochNumber: 18,
    qualifiedAt: "2026-09-29T12:00:00.000Z",
  };
  it("hashes a receipt canonically: key order does not matter, unknown keys are stripped", () => {
    const h = contributionReceiptSha256(base);
    const shuffled = Object.fromEntries(Object.entries(base).reverse()) as ContributionReceipt;
    expect(contributionReceiptSha256(shuffled)).toBe(h);
    expect(contributionReceiptSha256({ ...base, extra: 1 } as ContributionReceipt)).toBe(h);
    expect(contributionReceiptSha256({ ...base, weightMicro: "3820001" })).not.toBe(h);
  });
  it("D53: the single_lab_review label is part of the receipt (required, and in its hash)", () => {
    expect(base.reviews.labels).toEqual([{ label: "single_lab_review", reason: expect.stringMatching(/fable_unavailable/) }]);
    expect(contributionReceiptSha256({ ...base, reviews: { ...base.reviews, labels: [] } })).not.toBe(contributionReceiptSha256(base));
    const { labels: _l, ...noLabels } = base.reviews;
    expect(() => contributionReceiptSha256({ ...base, reviews: noLabels } as ContributionReceipt)).toThrow();
  });
  it("builds and verifies allocation proofs, including a promoted odd leaf", () => {
    const leaves: ClaimLeaf[] = Array.from({ length: 5 }, (_, i) => ({
      schema: "wos-claim-leaf.v1",
      cluster: "devnet",
      mint: "So11111111111111111111111111111111111111112",
      epochNumber: 1,
      index: i,
      beneficiary: { kind: "person" as const, id: u(10 + i) },
      wallet: "So11111111111111111111111111111111111111112",
      amountBase: String(1000 + i),
    }));
    const tree = allocationTree(leaves);
    for (const l of leaves) expect(verifyClaimLeaf(l, merkleProof(tree, l.index), tree.root)).toBe(true);
    expect(verifyClaimLeaf({ ...leaves[4]!, amountBase: "9" }, merkleProof(tree, 4), tree.root)).toBe(false);
  });
  it("refuses duplicate provider response ids inside one run", () => {
    expect(() => usageEventIdsSha256(["msg_1", "msg_1"])).toThrow();
    expect(usageEventIdsSha256(["b", "a"])).toBe(usageEventIdsSha256(["a", "b"]));
  });
  it("a payout audit verdict needs per-line evidence (a bare 'all plausible' is schema-invalid)", () => {
    const bare = PayoutAuditVerdict.safeParse({
      schema: "payout-audit-verdict.v1",
      packetId: u(1),
      manifestSha256: `sha256:${"d".repeat(64)}`,
      lines: [{ ref: "L1", judgment: "plausible", reason: null, plausibleAcuMicro: null, evidence: [], rationale: "x".repeat(40) }],
      focusAnswers: null,
      summary: "x".repeat(40),
    });
    expect(bare.success).toBe(false);
    const inflatedWithoutEstimate = PayoutAuditVerdict.safeParse({
      schema: "payout-audit-verdict.v1",
      packetId: u(1),
      manifestSha256: `sha256:${"d".repeat(64)}`,
      lines: [
        {
          ref: "L1",
          judgment: "inflated",
          reason: "wrong_split",
          plausibleAcuMicro: null,
          evidence: [{ kind: "acceptance_record", ref: "accept#12", note: "the declared split gives 70% to the reviewer" }],
          rationale: "x".repeat(40),
        },
      ],
      focusAnswers: null,
      summary: "x".repeat(40),
    });
    expect(inflatedWithoutEstimate.success).toBe(false);
  });
  it("a payout canary is caught only when its line is judged with the matching class", () => {
    const c = { lineRef: "L2", perturbation: "budget_mismatch" as const };
    const line = (judgment: "plausible" | "inflated" | "misattributed") => ({
      ref: "L2",
      judgment,
      reason: null as null | "budget_mismatch" | "unmet_acceptance",
      plausibleAcuMicro: null,
      evidence: [],
      rationale: "",
    });
    expect(payoutCanaryCaught(c, { lines: [{ ...line("inflated"), reason: "budget_mismatch" }] })).toBe(true);
    // H11: the right judgment with the wrong reason is not a catch.
    expect(payoutCanaryCaught(c, { lines: [{ ...line("inflated"), reason: "unmet_acceptance" }] })).toBe(false);
    expect(payoutCanaryCaught(c, { lines: [line("misattributed")] })).toBe(false);
    expect(payoutCanaryCaught(c, { lines: [line("plausible")] })).toBe(false);
    expect(payoutCanaryCaught(c, { lines: [] })).toBe(false);
    expect(REVIEW_POLICY_V1.canaries.rateBp).toBeGreaterThan(0);
  });
  it("run log totals must equal the usage receipt", () => {
    const t = (i: number, out: number) => ({
      i,
      startedAt: "2026-09-29T12:00:00.000Z",
      endedAt: "2026-09-29T12:00:01.000Z",
      responseIdSha256: null,
      usage: { inputTokens: 1, cachedInputTokens: 2, cacheWriteInputTokens: 0, outputTokens: out },
      toolCalls: [],
      chunkSha256: `sha256:${"e".repeat(64)}`,
    });
    const log = RunLog.parse({
      schema: "wos-run-log.v1",
      agentRunId: u(1),
      provider: "claude_cli",
      scrubberVersion: "s1",
      turns: [t(0, 5), t(1, 7)],
      repairLoops: [],
    });
    expect(runLogTotals(log)).toEqual({ inputTokens: 2, cachedInputTokens: 4, cacheWriteInputTokens: 0, outputTokens: 12 });
  });
  it("human review verdict must match its findings", () => {
    const ok = HumanReview.safeParse({
      schema: "wos-human-review.v1",
      id: u(1),
      subject: { kind: "attempt", id: u(2) },
      roundId: null,
      headSha: "1".repeat(40),
      submissionSha256: `sha256:${"a".repeat(64)}`,
      contextSha256: `sha256:${"b".repeat(64)}`,
      reviewerAccountId: u(3),
      qualificationId: u(4),
      riskClass: "standard",
      verdict: "PASS",
      findings: [{ localId: "h1", severity: "material", title: "x", detail: "y" }],
      checklist: [],
      rationale: "a".repeat(40),
      reviewPolicyVersion: "review-policy.v1",
      sealedAt: "2026-09-29T12:00:00.000Z",
    });
    expect(ok.success).toBe(false);
  });
});

describe("usage adapters (fixtures shaped like OBSERVED local session files)", () => {
  it("claude: dedupes streamed messages by id and keeps the result totals for cross-checking", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_1",
          model: "claude-opus-5-5",
          usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 10 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_1",
          model: "claude-opus-5-5",
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 50,
            output_tokens: 30,
            output_tokens_details: { thinking_tokens: 12 },
          },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_2",
          model: "claude-opus-5-5",
          usage: { input_tokens: 5, cache_read_input_tokens: 150, cache_creation_input_tokens: 0, output_tokens: 7 },
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 7, cache_read_input_tokens: 250, cache_creation_input_tokens: 50, output_tokens: 37 },
      }),
    ];
    const r = parseClaudeStream(lines);
    expect(r.usage).toEqual({
      inputTokens: 7,
      cachedInputTokens: 250,
      cacheWriteInputTokens: 50,
      outputTokens: 37,
      reasoningOutputTokens: 12,
    });
    expect(r.eventIds).toEqual(["msg_1", "msg_2"]);
    expect(usageMismatchBp(r.usage, r.resultUsage!)).toBe(0);
  });
  it("claude: counts sub-agent events so policy can fail the run", () => {
    const r = parseClaudeStream([
      JSON.stringify({ type: "assistant", parent_tool_use_id: "toolu_1", message: { id: "msg_9", usage: { output_tokens: 1 } } }),
    ]);
    expect(r.subagentEvents).toBe(1);
  });
  it("M15: malformed or impossible evidence is reported, never silently zeroed", () => {
    const r = parseCodexExecStream([
      "{not json",
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 20, output_tokens: -5, reasoning_output_tokens: 100 },
      }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/malformed JSON/);
    expect(r.errors.join(" ")).toMatch(/cached_input_tokens exceeds/);
    expect(r.errors.join(" ")).toMatch(/invalid counter output_tokens/);
    expect(r.errors.join(" ")).toMatch(/reasoning tokens exceed/);
    expect(parseClaudeStream([JSON.stringify({ type: "assistant", message: { usage: { output_tokens: 1 } } })]).ok).toBe(false);
  });
  it("codex: input_tokens includes cached tokens; canonical input is uncached", () => {
    expect(codexUsage({ input_tokens: 15024, cached_input_tokens: 12032, output_tokens: 133, reasoning_output_tokens: 0 })).toEqual({
      inputTokens: 2992,
      cachedInputTokens: 12032,
      cacheWriteInputTokens: 0,
      outputTokens: 133,
      reasoningOutputTokens: 0,
    });
    const exec = parseCodexExecStream([
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 } }),
    ]);
    expect(exec.usage.inputTokens).toBe(6);
  });
  it("codex rollout: dedupes by response_id and ignores cumulative counters", () => {
    const rec = (id: string, input: number) =>
      JSON.stringify({
        type: "token_usage_record",
        payload: { response_id: id, usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 1 } },
      });
    const r = parseCodexRollout([
      rec("resp_1", 10),
      rec("resp_1", 10),
      rec("resp_2", 20),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "token_count", info: { total_token_usage: { input_tokens: 30, output_tokens: 2 } } },
      }),
    ]);
    expect(r.usage.inputTokens).toBe(30);
    expect(r.eventIds).toEqual(["resp_1", "resp_2"]);
    expect(usageMismatchBp(r.usage, r.cumulative!)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ Astra reviews 04 and 05
describe("Astra reviews 04 and 05: engine regressions (docs/protocol/reviews/ASTRA-REVIEW-04-05-repros-prefix.txt)", () => {
  const tiny = { ...small, budgetPpm: 0n, holdbackBp: 0n };
  const alice100 = () => smallState({ holdback: [], claimable: new Map([["alice", 100n]]) });
  const rec = (from: "claimable" | "holdback" | "delivered", amount: bigint) => ({
    id: `d-${from}`,
    recoveries: [{ beneficiaryId: "alice", from, amount }],
    bounties: [],
  });
  it("R04-1a/B7: a dispute over tokens already delivered becomes the owner's offset; nothing fictional returns to R", () => {
    const claimed = computeEpoch({ ...fresh(alice100()), claims: [{ id: "c1", beneficiaryId: "alice", amount: 100n }] }, tiny).state;
    expect(claimed.delivered).toBe(100n);
    const r = computeEpoch({ ...fresh(claimed, 2), disputeSettlements: [rec("delivered", 100n)] }, tiny).state;
    expect(r.remainingReserve).toBe(900n);
    expect(r.cumulativeIssued).toBe(100n);
    expect(r.offsets.get("alice")).toBe(100n);
  });
  it("R04-1b/B7: a dispute over alice's unclaimed 20 debits HER claimable balance (the honest correction works)", () => {
    const r = computeEpoch({ ...fresh(alice100()), disputeSettlements: [rec("claimable", 20n)] }, tiny).state;
    expect(r.claimable.get("alice")).toBe(80n);
    expect(r.cumulativeIssued).toBe(80n);
    expect(r.remainingReserve).toBe(920n);
    expect(() => computeEpoch({ ...fresh(alice100()), disputeSettlements: [rec("claimable", 101n)] }, tiny)).toThrow(
      /only 100 unheld claimable/,
    );
  });
  it("R04-1: issuance is always owned — I = delivered + claimable + holdback", () => {
    expect(() => assertConserved(1000n, { ...alice100(), delivered: 1n })).toThrow(/not owned/);
  });
  it("R04-10: computeEpoch refuses a missing replay state at runtime", () => {
    const untyped = { epochNumber: 1, state: initialState(RESERVE) } as unknown as Parameters<typeof computeEpoch>[0];
    expect(() => computeEpoch(untyped, params)).toThrow(/replay state/);
  });
  const pt = {
    ...params,
    emissionReserve: 1000n,
    budgetPpm: 1_000_000n,
    rateCeilingInitialBasePerAcu: 100n,
    rateCeilingDecayPpm: 0n,
    holdbackBp: 0n,
  };
  const iss = (taskId: string, acu: bigint): TaskIssuance => ({
    taskId,
    kind: "execution",
    budgetAcuMicro: acu * 1_000_000n,
    featurePoolKeys: ["feature"],
    applicationPoolKeys: ["app"],
  });
  const accept = (taskId: string): TaskAcceptance => ({ taskId, shares: [{ accountId: "a", beneficiaryId: "a", shareBp: 10_000 }] });
  const zero = initialState(1000n);
  it("B3a: a task issued and accepted in the same epoch is paid in that epoch", () => {
    const r = computeEpoch({ ...fresh(zero), issuances: [iss("same", 1n)], acceptances: [accept("same")] }, pt);
    expect(r.acceptedBase).toBe(100n);
    expect(r.state.reserved.size).toBe(0);
  });
  it("B3b: one call per epoch — a second call for the same epoch is refused, so capacity is drawn once", () => {
    const first = computeEpoch({ ...fresh(zero), issuances: [iss("first", 7n)] }, pt);
    expect(() => computeEpoch({ ...fresh(first.state, 1), issuances: [iss("second", 1n)] }, pt)).toThrow(/one call per epoch/);
  });
  it("B3: the envelope is frozen from the state the epoch opens on (openEpoch), whatever returns arrive in it", () => {
    const st = alice100();
    const env = openEpoch(st, 1, 0n, small);
    const r = computeEpoch({ ...fresh(st), returns: [{ id: "x", kind: "unbound_expiry", beneficiaryId: "alice", amount: 100n }] }, small);
    expect(r.envelope).toEqual(env);
    expect(r.budget).toBe(env.budget);
  });
  it("B4: one expiry rule — payable while epoch < expiresAtEpoch; at and after it the acceptance is refused", () => {
    const e1 = computeEpoch({ ...fresh(zero), issuances: [iss("t", 1n)] }, pt);
    const res = e1.state.reserved.get("t")!;
    expect(res.expiresAtEpoch).toBe(1 + pt.budgetExpiryEpochs);
    const before = computeEpoch(
      { ...fresh(e1.state, res.expiresAtEpoch - 1), consumedIds: new Set(e1.consumedIds), acceptances: [accept("t")] },
      pt,
    );
    expect(before.acceptedBase).toBe(100n);
    for (const at of [res.expiresAtEpoch, 9])
      expect(() => computeEpoch({ ...fresh(e1.state, at), consumedIds: new Set(e1.consumedIds), acceptances: [accept("t")] }, pt)).toThrow(
        /expired/,
      );
    const swept = computeEpoch({ ...fresh(e1.state, res.expiresAtEpoch), consumedIds: new Set(e1.consumedIds) }, pt);
    expect(swept.expired).toEqual(["t"]);
  });
  it("B4: work submitted on time keeps its reservation through the review grace; a late submission is refused", () => {
    const e1 = computeEpoch({ ...fresh(zero), issuances: [iss("t", 1n)] }, pt);
    const exp = e1.state.reserved.get("t")!.expiresAtEpoch;
    const e2 = computeEpoch({ ...fresh(e1.state, exp - 1), consumedIds: new Set(e1.consumedIds), submissions: [{ taskId: "t" }] }, pt);
    const ids = new Set([...e1.consumedIds, ...e2.consumedIds]);
    const late = computeEpoch({ ...fresh(e2.state, exp + pt.reviewGraceEpochs - 1), consumedIds: ids, acceptances: [accept("t")] }, pt);
    expect(late.acceptedBase).toBe(100n);
    expect(() =>
      computeEpoch({ ...fresh(e1.state, exp), consumedIds: new Set(e1.consumedIds), submissions: [{ taskId: "t" }] }, pt),
    ).toThrow(/submitted too late/);
  });
  it("B5: a released (failed) task funds nothing — its pool and security accrual return with it", () => {
    const e1 = computeEpoch({ ...fresh(zero), issuances: [iss("t", 1n)] }, pt);
    expect(e1.state.poolBalances.size).toBe(0);
    expect(e1.state.securityReserve).toBe(0n);
    const e2 = computeEpoch(
      { ...fresh(e1.state, 2), consumedIds: new Set(e1.consumedIds), releases: [{ taskId: "t" }] },
      { ...pt, budgetPpm: 0n },
    );
    expect(e2.state.poolBalances.size).toBe(0);
    expect(e2.state.securityReserve).toBe(0n);
    expect(e2.state.remainingReserve).toBe(1000n);
  });
  it("B8: a task that did not fit is not consumed and can be issued next epoch under the same id", () => {
    const e1 = computeEpoch({ ...fresh(zero), issuances: [iss("big", 100n)] }, pt);
    expect(e1.unfunded).toEqual(["big"]);
    const e2 = computeEpoch({ ...fresh(e1.state, 2), consumedIds: new Set(e1.consumedIds), issuances: [iss("big", 1n)] }, pt);
    expect(e2.funded).toEqual(["big"]);
  });
  it("B9: reservations floor at every boundary (the database uses the same floor; db-assertions holds the vectors)", () => {
    expect(budgetToBase(1n, 500_000n)).toBe(0n);
    expect(budgetToBase(2n, 500_000n)).toBe(1n);
    expect(budgetToBase(3n, 500_000n)).toBe(1n);
    expect(budgetToBase(999_999n, 1n)).toBe(0n);
    expect(budgetToBase(1_000_000n, 1n)).toBe(1n);
  });
});

// ------------------------------------------------------------------------------------------------ Astra review 06
describe("Astra review 06: engine regressions (docs/protocol/reviews/ASTRA-REVIEW-06-repros-prefix.txt)", () => {
  const pt = {
    ...params,
    emissionReserve: 1000n,
    budgetPpm: 1_000_000n,
    rateCeilingInitialBasePerAcu: 100n,
    rateCeilingDecayPpm: 0n,
    holdbackBp: 0n,
  };
  const iss = (taskId: string, extra: Partial<TaskIssuance> = {}): TaskIssuance => ({
    taskId,
    kind: "execution",
    budgetAcuMicro: 1_000_000n,
    featurePoolKeys: [],
    applicationPoolKeys: [],
    ...extra,
  });
  it("R06-5 repro: review grace is pinned per reservation — a later policy neither shortens nor lengthens it", () => {
    const e1 = computeEpoch({ ...fresh(initialState(1000n)), issuances: [iss("t")], submissions: [{ taskId: "t" }] }, pt);
    const res = e1.state.reserved.get("t")!;
    expect(res).toMatchObject({ reviewGraceEpochs: 2, policyVersion: pt.holdbackPolicyVersion });
    expect(reservationExpiry(res)).toBe(7);
    const shorter = computeEpoch({ ...fresh(e1.state, 6), consumedIds: new Set(e1.consumedIds) }, { ...pt, reviewGraceEpochs: 0 });
    expect(shorter.expired).toEqual([]);
    const longer = computeEpoch({ ...fresh(e1.state, 7), consumedIds: new Set(e1.consumedIds) }, { ...pt, reviewGraceEpochs: 9 });
    expect(longer.expired).toEqual(["t"]);
    const fresh2 = computeEpoch(
      { ...fresh(e1.state, 2), consumedIds: new Set(e1.consumedIds), issuances: [iss("u")] },
      { ...pt, reviewGraceEpochs: 5 },
    );
    expect(fresh2.state.reserved.get("u")!.reviewGraceEpochs).toBe(5); // newly issued work uses the new version
  });
  it("R06-7 repro: a hold keeps its units in the tranche — 90 mature and are claimed, the held 10 wait, then mature once", () => {
    const p7 = { ...pt, holdbackBp: 0n };
    const s0: EngineState = {
      ...initialState(1000n),
      remainingReserve: 900n,
      cumulativeIssued: 100n,
      holdback: [tranche("alice", 1, 100n, 6)],
      lastEpoch: 5,
    };
    const e6 = computeEpoch(
      { ...fresh(s0, 6), holds: [{ id: "h1", beneficiaryId: "alice", source: "tranche", trancheId: "1:alice", amount: 10n }] },
      { ...p7, budgetPpm: 0n },
    );
    expect(e6.entitlements.get("alice")!.maturedHoldback).toBe(90n);
    expect(e6.state.claimable.get("alice")).toBe(90n);
    expect(e6.state.holdback).toEqual([{ ...tranche("alice", 1, 10n, 6) }]);
    const ids = new Set(e6.consumedIds);
    const e7 = computeEpoch(
      { ...fresh(e6.state, 7), consumedIds: ids, claims: [{ id: "c1", beneficiaryId: "alice", amount: 90n }] },
      { ...p7, budgetPpm: 0n },
    );
    expect(e7.state.holdback[0]!.amount).toBe(10n); // still held: does not mature
    for (const x of e7.consumedIds) ids.add(x);
    const e8 = computeEpoch({ ...fresh(e7.state, 8), consumedIds: ids, holdReleases: [{ holdId: "h1" }] }, { ...p7, budgetPpm: 0n });
    expect(e8.entitlements.get("alice")!.maturedHoldback).toBe(10n);
    expect(e8.state.holdback).toEqual([]);
    for (const x of e8.consumedIds) ids.add(x);
    const e9 = computeEpoch(
      { ...fresh(e8.state, 9), consumedIds: ids, claims: [{ id: "c2", beneficiaryId: "alice", amount: 10n }] },
      { ...p7, budgetPpm: 0n },
    );
    expect(e9.state.delivered).toBe(100n);
    expect(() =>
      computeEpoch(
        {
          ...fresh(e9.state, 10),
          consumedIds: new Set([...ids, ...e9.consumedIds]),
          claims: [{ id: "c3", beneficiaryId: "alice", amount: 1n }],
        },
        { ...p7, budgetPpm: 0n },
      ),
    ).toThrow(/unheld claimable/);
  });
  it("R06-7: a hold on a claimable balance blocks only the held part of a claim", () => {
    const s: EngineState = {
      ...initialState(1000n),
      remainingReserve: 900n,
      cumulativeIssued: 100n,
      claimable: new Map([["alice", 100n]]),
      lastEpoch: 1,
    };
    const pz = { ...pt, budgetPpm: 0n };
    expect(() =>
      computeEpoch(
        {
          ...fresh(s, 2),
          holds: [{ id: "h", beneficiaryId: "alice", source: "claimable", amount: 30n }],
          claims: [{ id: "c", beneficiaryId: "alice", amount: 71n }],
        },
        pz,
      ),
    ).toThrow(/only 70 unheld/);
    const ok = computeEpoch(
      {
        ...fresh(s, 2),
        holds: [{ id: "h", beneficiaryId: "alice", source: "claimable", amount: 30n }],
        claims: [{ id: "c", beneficiaryId: "alice", amount: 70n }],
      },
      pz,
    );
    expect(ok.state.claimable.get("alice")).toBe(30n);
    expect(() => assertConserved(1000n, { ...ok.state, claimable: new Map([["alice", 29n]]), delivered: 71n })).toThrow(/held beyond/);
  });
  it("re-issue: the expired task id stays consumed; the re-issue is a new id naming the replaced one", () => {
    const e1 = computeEpoch({ ...fresh(initialState(1000n)), issuances: [iss("t")] }, pt);
    const e5 = computeEpoch({ ...fresh(e1.state, 5), consumedIds: new Set(e1.consumedIds) }, pt);
    const ids = new Set([...e1.consumedIds, ...e5.consumedIds]);
    expect(() => computeEpoch({ ...fresh(e5.state, 6), consumedIds: ids, issuances: [iss("t")] }, pt)).toThrow(
      /new task id with reissueOf/,
    );
    const e6 = computeEpoch({ ...fresh(e5.state, 6), consumedIds: ids, issuances: [iss("t#2", { reissueOf: "t" })] }, pt);
    expect(e6.state.reserved.get("t#2")!.reissueOf).toBe("t");
    expect(() =>
      computeEpoch({ ...fresh(e1.state, 2), consumedIds: new Set(e1.consumedIds), issuances: [iss("t#2", { reissueOf: "t" })] }, pt),
    ).toThrow(/reservation has ended/);
  });
});

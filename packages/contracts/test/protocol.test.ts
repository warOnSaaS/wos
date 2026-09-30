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
  applyWeightCaps,
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

function receipt(i: number, account: number, weightAcu: number, slice: EngineReceipt["slice"] = "execution"): EngineReceipt {
  return {
    receiptId: u(1000 + i),
    accountId: u(account),
    slice,
    weightMicro: BigInt(weightAcu) * 1_000_000n,
    featurePoolKeys: slice === "execution" ? ["salesforce/contacts"] : [],
    applicationPoolKeys: slice === "execution" ? ["salesforce"] : [],
  };
}

const fresh = (state: EngineState = initialState(RESERVE), epochNumber = 1) => ({ epochNumber, state, receipts: [] as EngineReceipt[] });
const net = (r: ReturnType<typeof computeEpoch>, b: string) => {
  const e = r.entitlements.get(b)!;
  return e.releasedNow + e.heldBack;
};
/** A synthetic small state: reserve 900, issued 100 of which 100 held back by "a" (params with a tiny reserve). */
const small = { ...params, emissionReserve: 1000n };
const smallState = (over: Partial<EngineState> = {}): EngineState => ({
  remainingReserve: 900n,
  poolBalances: new Map(),
  securityReserve: 0n,
  cumulativeIssued: 100n,
  holdback: [{ beneficiaryId: "a", epochNumber: 1, amount: 100n }],
  offsets: new Map(),
  lossCarry: 0n,
  ...over,
});

describe("policy data (V1 drafts)", () => {
  it("parses every document and keeps the slices at 10000 bp", () => {
    const s = REWARD_POLICY_V1.slicesBp;
    expect(s.execution + s.planning + s.human_review + s.outcomes + s.completion_accrual + s.security_reserve).toBe(10_000);
    const c = COMPLETION_POLICY_V1.feature;
    expect(c.implementersBp + c.contractAuthorsBp + c.roadmapAuthorsBp + c.reviewersBp + c.finderBp).toBe(10_000);
    expect(BigInt(REWARD_POLICY_V1.emission.emissionReserveBase) + BigInt(GENESIS_POLICY_V1.capBase)).toBe(
      BigInt(REWARD_POLICY_V1.emission.maxSupplyBase),
    );
    expect(REWARD_POLICY_V1.holdback.shareBp).toBe(5000);
  });
  it("fails closed on mainnet: no evidence class or verification level qualifies until the founder decides", () => {
    expect(REWARD_POLICY_V1.eligibility.acceptedVerificationLevels.mainnet).toEqual([]);
    expect(REWARD_POLICY_V1.eligibility.acceptedEvidenceClasses.mainnet).toEqual([]);
    expect(REWARD_POLICY_V1.eligibility.acceptedVerificationLevels.devnet).not.toContain("ESTIMATED");
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

describe("computeEpoch", () => {
  it("an empty epoch emits nothing and returns the whole budget", () => {
    const r = computeEpoch(fresh(), params);
    expect(r.state.cumulativeIssued).toBe(0n);
    expect(r.state.remainingReserve).toBe(RESERVE);
    expect(r.returnedToReserve).toBe(r.budget);
  });
  it("low participation: the rate ceiling binds and the unused slice returns (no windfall for contributor zero)", () => {
    const r = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 50)] }, params);
    expect(net(r, u(1))).toBe(50n * 100_000_000n);
    expect(r.emittedBySlice.execution).toBeLessThan(r.slices.execution!);
  });
  it("holds back 50% of each net allocation and releases a tranche after 13 epochs (D40)", () => {
    const r1 = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 10)] }, params);
    const e = r1.entitlements.get(u(1))!;
    expect(e.heldBack).toBe(e.releasedNow);
    let st = r1.state;
    for (let ep = 2; ep <= 14; ep++) {
      const r = computeEpoch({ ...fresh(st, ep) }, params);
      if (ep === 14) expect(r.entitlements.get(u(1))!.maturedHoldback).toBe(e.heldBack);
      st = r.state;
    }
    expect(st.holdback).toEqual([]);
  });
  it("low participation: pools accrue only in proportion to what was actually emitted", () => {
    const r = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 50)] }, params);
    const accrued = [...r.accruals.values()].reduce((s, v) => s + v, 0n);
    expect(accrued).toBeLessThanOrEqual((r.emittedBySlice.execution * 1500n) / 8000n + 1n);
  });
  it("high participation: the slice binds and is split pro rata, exactly", () => {
    const receipts = Array.from({ length: 200 }, (_, i) => receipt(i, 1 + (i % 50), 1000 + i));
    const r = computeEpoch({ ...fresh(), receipts }, params);
    expect(r.emittedBySlice.execution).toBe(r.slices.execution);
    const sum = r.allocations.filter((a) => a.slice === "execution").reduce((s, a) => s + a.amountBase, 0n);
    expect(sum).toBe(r.slices.execution);
  });
  it("feature pools pay by component; a missing finder returns to the reserve", () => {
    const e1 = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 100)] }, params);
    const bal = e1.state.poolBalances.get("salesforce/contacts")!;
    const e2 = computeEpoch(
      {
        ...fresh(e1.state, 2),
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
  it("H13: an application pool pays 100% by lifetime weight (was 75, returning 25)", () => {
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
    expect(() =>
      computeEpoch(
        {
          ...fresh(st),
          poolPayouts: [
            {
              id: "app-2",
              poolKey: "app",
              kind: "application",
              beneficiaries: [{ beneficiaryId: "x", component: "implementers", weight: 1n }],
            },
          ],
        },
        small,
      ),
    ).toThrow(/does not fit/);
  });
  it("H1: a return must name its source; returning without debiting issuance can no longer create funds", () => {
    // Conserved start: R=900, I=100. The old engine turned a bare 100-unit return into a total of 1,100.
    const ok = computeEpoch(
      { ...fresh(smallState({ holdback: [] })), returns: [{ id: "ret-1", kind: "unbound_expiry", beneficiaryId: "a", amount: 100n }] },
      small,
    );
    expect(ok.state.remainingReserve + ok.state.cumulativeIssued).toBe(1000n);
    expect(() =>
      computeEpoch(
        { ...fresh(smallState({ holdback: [] })), returns: [{ id: "ret-2", kind: "unbound_expiry", beneficiaryId: "a", amount: 101n }] },
        small,
      ),
    ).toThrow(/exceeds issuance/);
    expect(() => assertConserved(1000n, { ...smallState(), remainingReserve: 1000n })).toThrow(/funding equation/);
  });
  it("H1: the same dispute settlement cannot be consumed twice (old result: I = -60 and conservation passed)", () => {
    const d = { id: "dispute-1", excessBase: 100n, bounties: [{ beneficiaryId: "b", amountBase: 20n }] };
    expect(() => computeEpoch({ ...fresh(smallState({ holdback: [] })), disputeSettlements: [d, { ...d }] }, small)).toThrow(
      /consumed twice/,
    );
    const first = computeEpoch({ ...fresh(smallState({ holdback: [] })), disputeSettlements: [d] }, small);
    expect(() =>
      computeEpoch({ ...fresh(first.state, 2), consumedIds: new Set(first.consumedIds), disputeSettlements: [d] }, small),
    ).toThrow(/consumed twice/);
    expect(() => assertConserved(1000n, { ...smallState({ holdback: [] }), remainingReserve: 1060n, cumulativeIssued: -60n })).toThrow(
      /negative issuance/,
    );
  });
  it("H1: a security receipt pays once (old result: four payouts of one receipt)", () => {
    const sp = { id: "sec-1", receiptId: "r1", beneficiaryId: "b", weightMicro: 1_000_000n };
    expect(() => computeEpoch({ ...fresh(smallState({ holdback: [] })), securityPayouts: [sp, { ...sp, id: "sec-2" }] }, small)).toThrow(
      /consumed twice/,
    );
  });
  it("D41: bounties come only from recovered amounts", () => {
    expect(() =>
      computeEpoch(
        {
          ...fresh(smallState({ holdback: [] })),
          disputeSettlements: [{ id: "d9", excessBase: 100n, bounties: [{ beneficiaryId: "b", amountBase: 21n }] }],
        },
        small,
      ),
    ).toThrow(/more bounty/);
  });
  it("D39: confiscation consumes holdback exactly once, pays a recovered-only bounty and offsets the rest", () => {
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
    const r = computeEpoch({ ...fresh(st), writeOffs: [{ id: "w1", beneficiaryId: "x", amount: 10n ** 12n }] }, params);
    expect(r.absorbedLoss).toBe(r.budget / 9n); // budget = full - 10% of full
  });
  it("L18: rounding happens per beneficiary, so splitting receipts cannot win extra base units", () => {
    // Old: A got 1 unit with one receipt of weight 2, and 2 units after splitting into A1 + A2.
    const p2 = {
      ...small,
      budgetPpm: 2223n, // floor(900 x 2223 / 1e6) = 2 base units to split
      rateCeilingInitialBasePerAcu: 10n ** 12n,
      holdbackBp: 0n,
      slicesBp: { execution: 10_000n, planning: 0n, human_review: 0n, outcomes: 0n, completion_accrual: 0n, security_reserve: 0n },
    };
    const line = (receiptId: string, accountId: string, weightMicro: bigint): EngineReceipt => ({
      receiptId,
      accountId,
      slice: "execution",
      weightMicro,
      featurePoolKeys: [],
      applicationPoolKeys: [],
    });
    const rs = (split: boolean): EngineReceipt[] => [
      ...(split ? [line("A1", "A", 1n), line("A2", "A", 1n)] : [line("A", "A", 2n)]),
      line("B", "B", 1n),
      line("C", "C", 1n),
    ];
    const a = computeEpoch({ ...fresh(smallState({ holdback: [] })), receipts: rs(false) }, p2);
    const b = computeEpoch({ ...fresh(smallState({ holdback: [] })), receipts: rs(true) }, p2);
    expect(net(a, "A")).toBe(1n);
    expect(net(b, "A")).toBe(1n);
  });
  it("splits a receipt between a person and an organization beneficiary (D38)", () => {
    const r = computeEpoch(
      { ...fresh(), receipts: [{ ...receipt(1, 1, 10), beneficiaries: [{ beneficiaryId: "org:acme", shareBp: 10_000 }] }] },
      params,
    );
    expect(r.entitlements.has("org:acme")).toBe(true);
    expect(r.entitlements.has(u(1))).toBe(false);
  });
  it("refuses a receipt admitted twice (exactly-once allocation)", () => {
    expect(() => computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 1), receipt(1, 2, 1)] }, params)).toThrow(/consumed twice/);
  });
  it("is deterministic regardless of receipt order", () => {
    const rs = Array.from({ length: 30 }, (_, i) => receipt(i, 1 + (i % 7), 3 + i));
    const a = computeEpoch({ ...fresh(), receipts: rs }, params);
    const b = computeEpoch({ ...fresh(), receipts: [...rs].reverse() }, params);
    expect(a.allocations).toEqual(b.allocations);
  });
  it("Q3: the ceiling is damped to 1.5x the trailing realised rate", () => {
    const r = computeEpoch({ ...fresh(), trailingRateBasePerAcu: 10_000_000n, receipts: [receipt(1, 1, 10)] }, params);
    expect(r.rateCeilingBasePerAcu).toBe(15_000_000n);
  });
});

describe("optimistic payouts, disputes, anomalies, activation (D28–D33, D43)", () => {
  it("allocates per receipt so any single allocation can be disputed", () => {
    const r = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 5), receipt(2, 1, 7)] }, params);
    const lines = r.allocations.filter((a) => a.slice === "execution");
    expect(lines.map((l) => l.receiptId)).toEqual([u(1001), u(1002)]);
    expect(lines[0]!.amountBase + lines[1]!.amountBase).toBe(net(r, u(1)));
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
  it("ranks a consistent 10% skim above an honest spread even though no receipt stands out", () => {
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
  const w = (id: number, locked: bigint, contribution: bigint) => ({ accountId: u(id), locked, contribution });
  const p = GOVERNANCE_POLICY_V1;
  it("needs a majority of BOTH weights and turnout in each", () => {
    const weights = [w(1, 900n, 10n), w(2, 50n, 60n), w(3, 50n, 30n)];
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
    const weights = [w(1, 55n, 55n), w(2, 45n, 45n), w(3, 70n, 70n), w(4, 30n, 30n)];
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
      ...Array.from({ length: 5 }, (_, i) => ({ accountId: `o${i}`, organizationId: "org", locked: 180n, contribution: 180n })),
      ...Array.from({ length: 50 }, (_, i) => ({ accountId: `p${i}`, organizationId: null, locked: 2n, contribution: 2n })),
    ];
    const capped = applyWeightCaps(ws, { perWalletCapBp: 500, orgCapBp: GOVERNANCE_POLICY_V1.orgCapBp });
    const org = capped.slice(0, 5).reduce((t, w) => t + w.contribution, 0n);
    const all = capped.reduce((t, w) => t + w.contribution, 0n);
    expect(org * 10_000n).toBeLessThanOrEqual(1000n * all);
    const t = tallyDualMajority(
      ws.slice(0, 5).map((w) => ({ accountId: w.accountId, choice: "yes" as const })),
      capped,
      GOVERNANCE_POLICY_V1,
      "governance",
    );
    expect(t.passes).toBe(false);
    // Two 10%-capped groups can never both be under 10%: the tally refuses rather than breaking the promise.
    const two = applyWeightCaps(
      [
        { accountId: "a", organizationId: "A", locked: 90n, contribution: 90n },
        { accountId: "b", organizationId: "B", locked: 10n, contribution: 10n },
      ],
      { perWalletCapBp: 500, orgCapBp: 1000 },
    );
    expect(two.feasible).toBe(false);
    const both = [
      { accountId: "a", choice: "yes" as const },
      { accountId: "b", choice: "yes" as const },
    ];
    expect(tallyDualMajority(both, two, GOVERNANCE_POLICY_V1, "routine").passes).toBe(false);
    const many = [
      { groupId: "a", weight: 90n, capBp: 1000 },
      ...Array.from({ length: 20 }, (_, i) => ({ groupId: `g${i}`, weight: 1n, capBp: 1000 })),
    ];
    expect(capGroupShares(many).feasible).toBe(true);
  });
  it("ignores locked weight of voters with no recent contribution (recommended rule)", () => {
    const weights = [w(1, 1000n, 0n), w(2, 10n, 100n)];
    const r = tallyDualMajority(
      [
        { accountId: u(1), choice: "yes" },
        { accountId: u(2), choice: "no" },
      ],
      weights,
      p,
    );
    expect(r.lockedYes).toBe(0n);
    expect(r.passes).toBe(false);
  });
  it("falls back to contribution-only weight when the token adapter is retired", () => {
    const weights = [w(1, 0n, 70n), w(2, 0n, 30n)];
    const r = tallyDualMajority(
      [
        { accountId: u(1), choice: "yes" },
        { accountId: u(2), choice: "no" },
      ],
      weights,
      { ...p, mode: "contribution_only" },
    );
    expect(r.passes).toBe(true);
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
    reviews: { astraReviewSha256: null, fableReviewSha256: null, humanReviewSha256s: [] },
    weightMicro: "3820000",
    weightBasis: "acu",
    evidenceClass: "attested_usage",
    acceptanceEvent: "pr_merged",
    leaseId: u(5),
    leaseGeneration: 1,
    runPolicySnapshotSha256s: [`sha256:${"c".repeat(64)}`],
    attestedAcuMicro: "3820000",
    capAcuMicro: "12000000",
    lowestVerificationLevel: "ATTESTED",
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
          reason: "padded_repairs",
          plausibleAcuMicro: null,
          evidence: [{ kind: "run_log_turn", ref: "run1#12", note: "repair loop with no failing check" }],
          rationale: "x".repeat(40),
        },
      ],
      focusAnswers: null,
      summary: "x".repeat(40),
    });
    expect(inflatedWithoutEstimate.success).toBe(false);
  });
  it("a payout canary is caught only when its line is judged with the matching class", () => {
    const c = { lineRef: "L2", perturbation: "padded_repairs" as const };
    const line = (judgment: "plausible" | "inflated" | "misattributed") => ({
      ref: "L2",
      judgment,
      reason: null as null | "padded_repairs" | "context_inflation",
      plausibleAcuMicro: null,
      evidence: [],
      rationale: "",
    });
    expect(payoutCanaryCaught(c, { lines: [{ ...line("inflated"), reason: "padded_repairs" }] })).toBe(true);
    // H11: the right judgment with the wrong reason is not a catch.
    expect(payoutCanaryCaught(c, { lines: [{ ...line("inflated"), reason: "context_inflation" }] })).toBe(false);
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

/**
 * DRAFT Proof of Contribution contracts: policy data parses, the engine conserves the funding equation, receipt
 * hashes and the allocation Merkle tree are deterministic, and the usage adapters dedupe by provider response id.
 */
import { describe, expect, it } from "vitest";
import {
  type AnomalyReceipt,
  activationRefusals,
  anomalyMetrics,
  acuMicroFromUsage,
  disputeBounty,
  disputeStake,
  allocationTree,
  assertConserved,
  CAPABILITY_POLICY_V1,
  COMPLETION_POLICY_V1,
  type ClaimLeaf,
  clipToCap,
  codexUsage,
  computeEpoch,
  type ContributionReceipt,
  contributionReceiptSha256,
  EngineError,
  type EngineReceipt,
  EpochMachine,
  engineParamsFrom,
  GENESIS_POLICY_V1,
  HumanReview,
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

const fresh = () => ({
  epochNumber: 1,
  remainingReserve: RESERVE,
  poolBalances: new Map<string, bigint>(),
  securityReserve: 0n,
  cumulativeIssued: 0n,
  returnsToReserve: 0n,
  receipts: [] as EngineReceipt[],
  poolPayouts: [],
  securityPayouts: [],
  offsets: new Map<string, bigint>(),
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
    // 1M uncached in ($4) + 1M cache read ($0.20) + 0 write + 100k out ($2) = 6.2 ACU
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
    expect(r.cumulativeIssued).toBe(0n);
    expect(r.remainingReserve).toBe(RESERVE);
    expect(r.returnedToReserve).toBe(r.budget);
    assertConserved(RESERVE, r);
  });
  it("low participation: the rate ceiling binds and the unused slice returns (no windfall for contributor zero)", () => {
    const r = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 50)] }, params);
    expect(r.netByAccount.get(u(1))).toBe(50n * 100_000_000n); // 50 ACU x 100 WOS
    expect(r.emittedBySlice.execution).toBeLessThan(r.slices.execution!);
    assertConserved(RESERVE, r);
  });
  it("high participation: the slice binds and is split pro rata, exactly", () => {
    const receipts = Array.from({ length: 200 }, (_, i) => receipt(i, 1 + (i % 50), 1000 + i));
    const r = computeEpoch({ ...fresh(), receipts }, params);
    expect(r.emittedBySlice.execution).toBe(r.slices.execution);
    const sum = r.allocations.filter((a) => a.slice === "execution").reduce((s, a) => s + a.amountBase, 0n);
    expect(sum).toBe(r.slices.execution);
    assertConserved(RESERVE, r);
  });
  it("accrues completion pools per key and pays them by component; a missing finder returns to the reserve", () => {
    const e1 = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 100)] }, params);
    const bal = e1.poolBalances.get("salesforce/contacts")!;
    expect(bal).toBeGreaterThan(0n);
    const e2 = computeEpoch(
      {
        ...fresh(),
        epochNumber: 2,
        remainingReserve: e1.remainingReserve,
        poolBalances: e1.poolBalances,
        securityReserve: e1.securityReserve,
        cumulativeIssued: e1.cumulativeIssued,
        poolPayouts: [{ poolKey: "salesforce/contacts", beneficiaries: [{ accountId: u(1), component: "implementers", weight: 1n }] }],
      },
      params,
    );
    expect(e2.poolBalances.get("salesforce/contacts")).toBe(0n);
    expect(e2.allocations.find((a) => a.slice === "completion_payout")!.amountBase).toBe((bal * 7500n) / 10_000n + 0n);
    assertConserved(RESERVE, e2);
  });
  it("recovers offsets from gross allocations (capped) and returns them to the reserve", () => {
    const r = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 10)], offsets: new Map([[u(1), 10n ** 12n]]) }, params);
    const gross = r.allocations.filter((a) => a.accountId === u(1)).reduce((s, a) => s + a.amountBase, 0n);
    expect(r.offsetsRecovered.get(u(1))).toBe(gross / 2n);
    expect(r.netByAccount.get(u(1))).toBe(gross - gross / 2n);
    assertConserved(RESERVE, r);
  });
  it("refuses a receipt admitted twice (exactly-once allocation)", () => {
    expect(() => computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 1), receipt(1, 2, 1)] }, params)).toThrow(/admitted twice/);
  });
  it("is deterministic regardless of receipt order", () => {
    const rs = Array.from({ length: 30 }, (_, i) => receipt(i, 1 + (i % 7), 3 + i));
    const a = computeEpoch({ ...fresh(), receipts: rs }, params);
    const b = computeEpoch({ ...fresh(), receipts: [...rs].reverse() }, params);
    expect(a.allocations).toEqual(b.allocations);
  });
});

describe("optimistic payouts, disputes, anomalies, activation (D28–D33)", () => {
  it("allocates per receipt so any single allocation can be disputed", () => {
    const r = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 5), receipt(2, 1, 7)] }, params);
    const lines = r.allocations.filter((a) => a.slice === "execution");
    expect(lines.map((l) => l.receiptId)).toEqual([u(1001), u(1002)]);
    expect(lines[0]!.amountBase + lines[1]!.amountBase).toBe(r.netByAccount.get(u(1)));
  });
  it("settles a dispute conservatively: excess leaves issuance, bounty is paid from it, the rest returns", () => {
    const e1 = computeEpoch({ ...fresh(), receipts: [receipt(1, 1, 50), receipt(2, 2, 50)] }, params);
    const excess = 1_000_000_000n;
    const bounty = disputeBounty(excess, REWARD_POLICY_V1.challenge.bountyBpOfExcess);
    const e2 = computeEpoch(
      {
        ...fresh(),
        epochNumber: 2,
        remainingReserve: e1.remainingReserve,
        poolBalances: e1.poolBalances,
        securityReserve: e1.securityReserve,
        cumulativeIssued: e1.cumulativeIssued,
        disputeSettlements: [{ disputeId: u(77), excessBase: excess, bounties: [{ accountId: u(2), amountBase: bounty }] }],
      },
      params,
    );
    expect(e2.allocations.find((a) => a.slice === "dispute_bounty")!.amountBase).toBe(200_000_000n);
    assertConserved(RESERVE, e2);
  });
  it("prices stakes low, scales them by items and caps them", () => {
    const p = REWARD_POLICY_V1.challenge;
    expect(disputeStake(1_000_000_000n, 1, p)).toBe(20_000_000n);
    expect(disputeStake(1_000_000_000n, 25, p)).toBe(100_000_000n);
    expect(disputeStake(0n, 1, p)).toBe(0n);
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
      accountId: u(10 + i),
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
      reason: null,
      plausibleAcuMicro: null,
      evidence: [],
      rationale: "",
    });
    expect(payoutCanaryCaught(c, { lines: [line("inflated")] })).toBe(true);
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

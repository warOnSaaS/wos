/**
 * Versioned additions after the protocol v1 freeze (D62): D61 bugs and maintenance (economy side), the D60 protocol
 * delta (holds, migration boost, ranking continuity, release labels) and D63 one priority queue with the queue bonus.
 * v1 policy data and v1 rules stay unchanged (asserted first).
 */
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_POLICY_V1,
  BUGS_POLICY_V1,
  type BugSeverity,
  type RedGreenEvidence,
  rankBuildNext,
  type TriageOutcome,
} from "../src/index.js";
import {
  ageingIssueEpoch,
  splitTaskReservation,
  bugFixAccepted,
  claimTermsRefusals,
  fixBudgetIssuanceRefusals,
  fixRevocationDependents,
  taskAllocationRefusals,
  taskClaimOf,
  taskPayableBase,
  assertConserved,
  basePriceAcuMicro,
  budgetModelMicro,
  bugReportOutcome,
  CAPABILITY_POLICY_V1,
  CAPABILITY_POLICY_V2,
  COMPLETION_POLICY_V1,
  type ContributorLimits,
  computeEpoch,
  contributorLimitsRefusals,
  effectiveBugSeverity,
  engineParamsFrom,
  holdReleaseLabelRefusals,
  initialState,
  nextClaimTerms,
  priorityVoteTerm,
  queueBasePrice,
  RunPolicySnapshot,
  rankWorkNext,
  receiptRouteRefusals,
  REVIEW_POLICY_V1,
  REWARD_POLICY_V1,
  REWARD_POLICY_V2,
  acceptanceRequirement,
  triageConfirmationRefusals,
  type WorkCandidate,
  workEligibilityRefusals,
  workNextPolicyRefusals,
} from "../src/protocol/index.js";

const refused = (r: readonly string[], pattern: RegExp) => expect(r.join(" | ")).toMatch(pattern);
const WN = CAPABILITY_POLICY_V2.workNext!;
const BUGS = REWARD_POLICY_V2.bugs!;

describe("versioning: v1 is untouched; v2 carries the additions", () => {
  it("reward-policy.v1 and capability-policy.v1 have no D61/D63 data; v2 does", () => {
    expect(REWARD_POLICY_V1.bugs).toBeUndefined();
    expect(CAPABILITY_POLICY_V1.workNext).toBeUndefined();
    expect(REWARD_POLICY_V1.acceptance.map((a) => a.contributionType)).not.toContain("BUG_FIX");
    expect(CAPABILITY_POLICY_V1.assignment.rankingPolicyVersion).toBe("build-next-ranking.v1");
    expect(CAPABILITY_POLICY_V2.assignment).toEqual(CAPABILITY_POLICY_V1.assignment);
    expect(WN.rankingPolicyVersion).toBe("work-next-ranking.v1");
    expect(BUGS).toMatchObject({ sweepsPaid: false, introducerReportPaid: false, introducerMayFixWithinWindow: false });
  });
  it("the published boosts are copies of the planning side's data (no drift)", () => {
    expect(WN.severityBoost).toEqual(BUGS_POLICY_V1.severityBoost);
    expect(WN.architectureMigration).toBe(ARCHITECTURE_POLICY_V1.migrationBoost);
    expect(workNextPolicyRefusals(WN)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ D61
describe("D61: triage, fixes and reports bind to the planning side's records", () => {
  const rec: {
    bugKey: string;
    outcome: TriageOutcome;
    severity: BugSeverity | null;
    duplicateOfBugKey: string | null;
    reporterAccountId: string;
    introducerAccountId: string | null;
    introducedWithinOffsetWindow: boolean;
  } = {
    bugKey: "BUG-20",
    outcome: "fix",
    severity: "high",
    duplicateOfBugKey: null,
    reporterAccountId: "rep",
    introducerAccountId: "intro",
    introducedWithinOffsetWindow: true,
  };
  type Conf = { kind: "ratified" | "severity_corrected" | "resolved"; correctedSeverity: BugSeverity | null };
  const ratified: Conf[] = [{ kind: "ratified", correctedSeverity: null }];
  it("effective severity: corrected wins; critical only once a maintainer confirmed it; none for non-acting outcomes", () => {
    expect(effectiveBugSeverity(rec, [])).toBe("high");
    expect(effectiveBugSeverity({ ...rec, severity: "critical" }, [])).toBeNull();
    expect(effectiveBugSeverity({ ...rec, severity: "critical" }, ratified)).toBe("critical");
    expect(effectiveBugSeverity({ ...rec, severity: "critical" }, [{ kind: "severity_corrected", correctedSeverity: "medium" }])).toBe(
      "medium",
    );
    expect(effectiveBugSeverity({ ...rec, outcome: "not_a_bug", severity: null }, ratified)).toBeNull();
  });
  it("a triage is paid only once its decision is confirmed, per outcome", () => {
    const c = (
      over: Partial<typeof rec>,
      confirmations: Conf[] = [],
      fixAccepted = false,
      root: { outcome: "fix" | "not_a_bug" } | null = null,
    ) => triageConfirmationRefusals({ record: { ...rec, ...over }, confirmations, fixAccepted, duplicateRoot: root });
    expect(c({}, [], true)).toEqual([]);
    expect(c({}, ratified)).toEqual([]);
    refused(c({}), /red-then-green acceptance or a maintainer/);
    refused(c({ outcome: "contract_revision" }), /revision merges/);
    expect(c({ outcome: "contract_revision" }, [{ kind: "resolved", correctedSeverity: null }])).toEqual([]);
    expect(c({ outcome: "duplicate", severity: null, duplicateOfBugKey: "BUG-7" }, [], false, { outcome: "fix" })).toEqual([]);
    refused(c({ outcome: "duplicate", severity: null, duplicateOfBugKey: "BUG-21" }, [], false, { outcome: "fix" }), /EARLIER report/);
    refused(c({ outcome: "duplicate", severity: null, duplicateOfBugKey: "BUG-7" }, [], false, { outcome: "not_a_bug" }), /acts on it/);
    refused(c({ outcome: "not_reproducible", severity: null }), /ratification/);
    expect(c({ outcome: "not_a_bug", severity: null }, ratified)).toEqual([]);
    refused(c({ outcome: "wont_fix", severity: null }, ratified), /maintainer's decision/);
    refused(c({ severity: "critical" }, [], true), /critical severity is confirmed/);
    expect(c({ severity: "critical" }, [{ kind: "severity_corrected", correctedSeverity: "high" }], true)).toEqual([]);
  });
  const green: RedGreenEvidence = {
    bug: "BUG-20",
    feature: "contacts",
    regressionTest: "features/contacts/acceptance/regressions/BUG-20.spec.ts",
    parent: { sha: "a".repeat(40), conclusion: "failure", failedTests: ["features/contacts/acceptance/regressions/BUG-20.spec.ts"] },
    head: { sha: "b".repeat(40), conclusion: "success", failedTests: [] },
    testSha256: `sha256:${"c".repeat(64)}`,
  };
  const route = {
    acceptance: REWARD_POLICY_V2.acceptance,
    slice: "execution",
    evidenceClass: "accepted_budget" as const,
    taskKind: "execution",
    hasLease: true,
    humanReview: null,
  };
  const triage = {
    ...route,
    contributionType: "BUG_TRIAGE",
    receiptAccountId: "t",
    taskId: "tt",
    commission: { taskKind: "bug_triage", fixBug: null },
    triage: {
      record: { decidedBy: "agent" as const, deciderAccountId: "t", triageTaskId: "tt", decisionSha256: `sha256:${"d".repeat(64)}` },
      receiptDecisionSha256: `sha256:${"d".repeat(64)}`,
      confirmationRefusals: [] as string[],
    },
  };
  it("BUG_TRIAGE: the decider's receipt under the lease, bound to the decision hash, once confirmed", () => {
    expect(receiptRouteRefusals(triage)).toEqual([]);
    refused(receiptRouteRefusals({ ...triage, receiptAccountId: "x" }), /decision this account made/);
    refused(
      receiptRouteRefusals({ ...triage, triage: { ...triage.triage, receiptDecisionSha256: `sha256:${"e".repeat(64)}` } }),
      /canonical hash/,
    );
    refused(receiptRouteRefusals({ ...triage, triage: { ...triage.triage, confirmationRefusals: ["not yet"] } }), /not yet/);
    refused(receiptRouteRefusals({ ...triage, hasLease: false }), /needs the lease/);
    refused(receiptRouteRefusals({ ...triage, acceptance: REWARD_POLICY_V1.acceptance }), /no acceptance route/);
  });
  const fix = {
    ...route,
    contributionType: "BUG_FIX",
    receiptAccountId: "f",
    taskId: "ft",
    commission: { taskKind: "abu_build", fixBug: "BUG-20" },
    bugFix: {
      outcome: "fix" as const,
      severityAtIssuance: "high" as const,
      budgetSeverity: "high" as const,
      redGreen: green,
      expected: {
        bug: green.bug,
        feature: green.feature,
        parentSha: green.parent.sha,
        headSha: green.head.sha,
        regressionTest: green.regressionTest,
        testSha256: green.testSha256,
      },
      fixerTriagedIt: false,
      fixerIsBarredIntroducer: false,
    },
  };
  it("BUG_FIX: outcome fix, priced at the effective severity, red then green, not the triager, not the in-window introducer", () => {
    expect(receiptRouteRefusals(fix)).toEqual([]);
    refused(receiptRouteRefusals({ ...fix, bugFix: { ...fix.bugFix, outcome: "contract_revision" } }), /outcome fix/);
    refused(receiptRouteRefusals({ ...fix, bugFix: { ...fix.bugFix, budgetSeverity: "critical" } }), /priced at critical/);
    refused(receiptRouteRefusals({ ...fix, bugFix: { ...fix.bugFix, severityAtIssuance: null } }), /effective severity/);
    refused(receiptRouteRefusals({ ...fix, bugFix: { ...fix.bugFix, redGreen: null } }), /red-then-green/);
    refused(
      receiptRouteRefusals({
        ...fix,
        bugFix: { ...fix.bugFix, redGreen: { ...green, parent: { ...green.parent, conclusion: "success" } } },
      }),
      /red first/,
    );
    refused(receiptRouteRefusals({ ...fix, bugFix: { ...fix.bugFix, fixerTriagedIt: true } }), /both triages and fixes/);
    refused(receiptRouteRefusals({ ...fix, bugFix: { ...fix.bugFix, fixerIsBarredIntroducer: true } }), /introducer/);
  });
  it("sweeps have no route of their own (paid only through confirmed reports)", () => {
    refused(receiptRouteRefusals({ ...triage, contributionType: "BUG_SWEEP" }), /no acceptance route/);
  });
  it("a fix is an abu_build/abu_revision budget times its bounded severity factor; v1 has none", () => {
    const m = (reward: typeof REWARD_POLICY_V1) => ({
      capabilityBudgets: CAPABILITY_POLICY_V2.budgets,
      model: reward.budgets.model,
      humanReviewWeights: reward.humanReview.weightAcuEqMicro,
      bugs: reward.bugs,
    });
    const basis = { taskKind: "abu_build", sizePoints: 2, difficultyBp: 10_000, importanceBp: 10_000 };
    expect(budgetModelMicro(m(REWARD_POLICY_V2), { ...basis, severity: "low" })).toEqual({ modelMicro: 8_000_000n });
    expect(budgetModelMicro(m(REWARD_POLICY_V2), { ...basis, severity: "high" })).toEqual({ modelMicro: 10_000_000n });
    expect(budgetModelMicro(m(REWARD_POLICY_V2), { ...basis, severity: "critical" })).toEqual({
      modelMicro: 12_000_000n,
    });
    expect(budgetModelMicro(m(REWARD_POLICY_V1), { ...basis, severity: "high" })).toHaveProperty("refusal");
    expect(budgetModelMicro(m(REWARD_POLICY_V2), { ...basis, taskKind: "feature_review", severity: "high" })).toHaveProperty("refusal");
    expect(
      budgetModelMicro(m(REWARD_POLICY_V2), { taskKind: "bug_triage", sizePoints: 0, difficultyBp: 10_000, importanceBp: 10_000 }),
    ).toEqual({
      modelMicro: 2_000_000n,
    });
  });
  const report = {
    record: rec,
    confirmations: [] as Array<{ kind: "ratified" | "severity_corrected" | "resolved"; correctedSeverity: null }>,
    reporterAccountId: "rep",
    reporterRelatedAccountIds: [] as string[],
    fixAccepted: true,
    reportsPaidThisEpoch: 0,
    policy: BUGS,
  };
  it("a report is paid once: the first reporter, acting outcome, resolved, under the cap", () => {
    expect(bugReportOutcome(report)).toEqual({ paid: true, severity: "high", refusals: [], introducerOffset: true });
    refused(bugReportOutcome({ ...report, reporterAccountId: "later" }).refusals, /first reporter/);
    refused(bugReportOutcome({ ...report, fixAccepted: false }).refusals, /resolved/);
    refused(bugReportOutcome({ ...report, record: { ...rec, outcome: "duplicate" } }).refusals, /fix or contract_revision/);
    refused(bugReportOutcome({ ...report, record: { ...rec, severity: "critical" } }).refusals, /effective severity/);
    refused(bugReportOutcome({ ...report, reportsPaidThisEpoch: BUGS.maxBugReportsPaidPerAccountPerEpoch }).refusals, /cap/);
    expect(
      bugReportOutcome({
        ...report,
        record: { ...rec, outcome: "contract_revision" },
        fixAccepted: false,
        confirmations: [{ kind: "resolved", correctedSeverity: null }],
      }).paid,
    ).toBe(true);
  });
  it("self-dealing: the in-window introducer (or a relative) is not paid for its own regression; the offset is a policy switch", () => {
    const own = { ...report, reporterAccountId: "intro", record: { ...rec, reporterAccountId: "intro" } };
    refused(bugReportOutcome(own).refusals, /own regression/);
    refused(bugReportOutcome({ ...report, reporterRelatedAccountIds: ["intro"] }).refusals, /own regression/);
    expect(bugReportOutcome({ ...own, record: { ...own.record, introducedWithinOffsetWindow: false } })).toMatchObject({
      paid: true,
      introducerOffset: false,
    });
    expect(bugReportOutcome({ ...report, policy: { ...BUGS, introducerOffsetEqualsReportPay: false } }).introducerOffset).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ D60 delta
describe("D60 protocol delta: holds, labels, ranking continuity", () => {
  const adr = { kind: "architecture" as const, record: "ADR-007" };
  const bug = { kind: "bug" as const, bug: "BUG-12" };
  it("a hold label goes only on a cancelled release of a unit the named hold holds", () => {
    expect(holdReleaseLabelRefusals({ reason: "cancelled", label: "architecture_hold:ADR-007", activeHolds: [adr] })).toEqual([]);
    expect(holdReleaseLabelRefusals({ reason: "cancelled", label: "bug_hold:BUG-12", activeHolds: [bug] })).toEqual([]);
    expect(holdReleaseLabelRefusals({ reason: "failed", label: null, activeHolds: [] })).toEqual([]);
    refused(holdReleaseLabelRefusals({ reason: "failed", label: "architecture_hold:ADR-007", activeHolds: [adr] }), /cancelled/);
    refused(holdReleaseLabelRefusals({ reason: "cancelled", label: "bug_hold:BUG-13", activeHolds: [bug] }), /no active hold/);
    refused(holdReleaseLabelRefusals({ reason: "cancelled", label: "held", activeHolds: [bug] }), /ADR-nnn or bug_hold/);
  });
  it("ageing counts from the first generation through hold releases only", () => {
    expect(ageingIssueEpoch([{ issuedEpoch: 9, releaseLabel: null }])).toBe(9);
    expect(
      ageingIssueEpoch([
        { issuedEpoch: 9, releaseLabel: null },
        { issuedEpoch: 5, releaseLabel: "architecture_hold:ADR-007" },
        { issuedEpoch: 2, releaseLabel: "bug_hold:BUG-3" },
      ]),
    ).toBe(2);
    expect(
      ageingIssueEpoch([
        { issuedEpoch: 9, releaseLabel: null },
        { issuedEpoch: 5, releaseLabel: null },
      ]),
    ).toBe(9);
    expect(
      ageingIssueEpoch([
        { issuedEpoch: 9, releaseLabel: null },
        { issuedEpoch: 5, releaseLabel: "bug_hold:BUG-3" },
        { issuedEpoch: 2, releaseLabel: null },
      ]),
    ).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------------ D63
const unit = (id: string, over: Partial<WorkCandidate> = {}): WorkCandidate => ({
  unitId: id,
  kind: "abu_build",
  role: "builder",
  target: "x",
  requiredClass: "BUILD_L4",
  targetsServed: 0,
  dependentsWaiting: 0,
  issuedEpoch: 6,
  issuedAtMs: 0,
  budgetAcuMicro: 8_000_000n,
  estimatedMinutes: 60,
  proposerAccountId: "p",
  requiredToolchains: ["node22"],
  budget: { released: false, expiresEpoch: 9 },
  sizePoints: 2,
  surface: "web",
  rewardBearing: true,
  activeHolds: [],
  severity: null,
  migrationOf: null,
  ageingIssuedEpoch: 6,
  barredAccountIds: [],
  review: null,
  ...over,
});

describe("D63: one queue for all work", () => {
  it("cross-kind ranking with fixtures: migration and critical fixes first, documents by measured unlock, reviews by kindBase", () => {
    const ranked = rankWorkNext(
      WN,
      [
        unit("build-plain"),
        unit("fix-critical", { severity: "critical" }),
        unit("fix-medium", { severity: "medium" }),
        unit("migration", { migrationOf: "ADR-007" }),
        unit("roadmap", { kind: "roadmap_author", role: "author", requiredClass: "PLAN_L1", dependentsWaiting: 12 }),
        unit("feature", { kind: "feature_author", role: "author", requiredClass: "PLAN_L1", dependentsWaiting: 5 }),
        unit("review", { kind: "implementation_review", role: "reviewer", requiredClass: "REVIEW_A" }),
        unit("triage", { kind: "bug_triage", role: "builder" }),
        unit("sweep", { kind: "bug_sweep", rewardBearing: false, budget: null }),
        unit("held", { severity: "critical", activeHolds: [{ kind: "architecture", record: "ADR-007" }] }),
      ],
      6,
    );
    expect(ranked.map((r) => r.unitId)).toEqual([
      "fix-critical",
      "migration",
      // documents rank by their measured unlock value (60 x 12 and 60 x 5): above a medium fix (150)
      "roadmap",
      "feature",
      "fix-medium",
      "review",
      "triage",
      "build-plain",
      "sweep",
    ]);
    expect(ranked.find((r) => r.unitId === "roadmap")!.score.unlock).toBe(WN.weights.unlock * 12);
    expect(ranked.find((r) => r.unitId === "review")!.score.kind).toBe(WN.weights.unlock);
    expect(ranked.find((r) => r.unitId === "held")).toBeUndefined();
    // deterministic: input order does not matter
    const shuffled = rankWorkNext(WN, [unit("b"), unit("a"), unit("c", { severity: "high" })], 6).map((r) => r.unitId);
    expect(shuffled).toEqual(["c", "a", "b"]);
  });
  it("the ranking matches the planning side's rankBuildNext for build units (base + migration + severity)", () => {
    const units = [unit("m", { migrationOf: "ADR-1" }), unit("s", { severity: "high" }), unit("z"), unit("c", { severity: "critical" })];
    const ours = rankWorkNext(WN, units, 6).map((r) => ({ unitId: r.unitId, score: r.score.total }));
    const base = (u: WorkCandidate) => rankWorkNext(WN, [{ ...u, severity: null, migrationOf: null }], 6)[0]!.score.total;
    const theirs = rankBuildNext(
      { migrationBoost: ARCHITECTURE_POLICY_V1.migrationBoost, severityBoost: BUGS_POLICY_V1.severityBoost },
      units.map((u) => ({ unitId: u.unitId, baseScore: base(u), migrationOf: u.migrationOf, bugSeverity: u.severity, holds: [] })),
    );
    expect(ours).toEqual(theirs);
  });
  it("kindBase is derived from structural unlock, and votes can never outrank migrations or critical bugs", () => {
    refused(workNextPolicyRefusals({ ...WN, kindBase: { ...WN.kindBase, roadmap_author: 500 } }), /kindBase.roadmap_author/);
    refused(workNextPolicyRefusals({ ...WN, priorityVote: { ...WN.priorityVote, maxBoost: 100_000 } }), /below the architecture-migration/);
    expect(WN.priorityVote.status).toBe("dormant");
    expect(priorityVoteTerm(WN.priorityVote, 10_000_000)).toBe(0);
    const active = { ...WN.priorityVote, status: "active" as const };
    expect(priorityVoteTerm(active, 10_000_000)).toBe(WN.priorityVote.maxBoost);
    expect(priorityVoteTerm(active, WN.priorityVote.saturationWeight / 2)).toBe(WN.priorityVote.maxBoost / 2);
    const voted = rankWorkNext(
      { ...WN, priorityVote: active },
      [unit("voted", { priorityVoteWeight: 1e12 }), unit("crit", { severity: "critical" }), unit("mig", { migrationOf: "ADR-1" })],
      6,
    );
    expect(voted.map((r) => r.unitId)).toEqual(["crit", "mig", "voted"]);
  });
  const me = {
    accountId: "me",
    provider: "claude_cli",
    modelId: "claude-opus-5-5",
    attestedToolchains: ["node22"],
    activeLeasesByProvider: {},
    leaseLimitByProvider: { claude_cli: 1 },
    relatedAccountIds: ["orgmate"],
    remaining: { budgetAcuMicro: null, wallTimeMinutes: null },
    limits: {} as ContributorLimits,
  };
  const ACC = acceptanceRequirement(REVIEW_POLICY_V1, CAPABILITY_POLICY_V2, "standard");
  it("eligibility is one rule for queue, self-pick and continuous: holds, independence, seats, coarse limits", () => {
    const e = (u: WorkCandidate, c = me) => workEligibilityRefusals(CAPABILITY_POLICY_V2, c, u, 6, u.kind === "abu_build" ? ACC : null);
    expect(e(unit("u"))).toEqual([]);
    refused(e(unit("u", { activeHolds: [{ kind: "bug", bug: "BUG-4" }] })), /held by bug BUG-4/);
    refused(e(unit("u", { barredAccountIds: ["orgmate"] })), /independence/);
    refused(
      e(
        unit("r", {
          kind: "implementation_review",
          role: "reviewer",
          requiredClass: "REVIEW_A",
          review: { activeFallback: "none", slot: "fable", builderModelId: "claude-opus-5-5" },
        }),
      ),
      /self-review/,
    );
    refused(e(unit("u", { sizePoints: 8 }), { ...me, limits: { maxSizePoints: 5 } }), /size limit/);
    refused(e(unit("u", { surface: "ios" }), { ...me, limits: { surfaces: ["web"] } }), /does not build ios/);
    refused(e(unit("u"), { ...me, limits: { providers: ["codex_cli"] } }), /exclude claude_cli/);
    expect(e(unit("s", { kind: "bug_sweep", rewardBearing: false, budget: null }))).toEqual([]);
  });
  it("limits stay coarse: no limit may name a feature, target or task", () => {
    expect(
      contributorLimitsRefusals({
        providers: ["claude_cli"],
        maxSizePoints: 5,
        surfaces: ["web"],
        toolchains: ["xcode"],
        wallTimeMinutes: 120,
      }),
    ).toEqual([]);
    refused(contributorLimitsRefusals({ targets: ["salesforce"] }), /may not name a feature, target or task \(targets\)/);
    refused(contributorLimitsRefusals({ onlyFeature: "contacts" }), /onlyFeature/);
    refused(contributorLimitsRefusals({ taskIds: ["t1"] }), /taskIds/);
    refused(contributorLimitsRefusals({ colour: "red" }), /provider, size, surfaces/);
  });
  it("pricing by mode: base price floor(budget / 1.2); the queue pays base + 20%; the mode is pinned in the snapshot", () => {
    expect(REWARD_POLICY_V2.queue?.queueBonusBp).toBe(2000);
    expect(REWARD_POLICY_V1.queue).toBeUndefined();
    expect(basePriceAcuMicro(12_000_000n, 2000)).toBe(10_000_000n);
    expect(basePriceAcuMicro(8_000_000n, 2000)).toBe(6_666_666n);
    expect(queueBasePrice(1001n, 2000)).toBe(834n);
    const snap = {
      schema: "wos-run-policy-snapshot.v1",
      leaseId: "00000000-0000-4000-8000-000000000001",
      leaseGeneration: 1,
      policyVersions: {
        reward: "reward-policy.v2",
        review: "review-policy.v1",
        capability: "capability-policy.v2",
        usageProof: "usage-proof-policy.v1",
        risk: "risk-policy.v1",
        merge: "merge-policy.v1",
        oracle: "model-rate-oracle.v1",
        agent: "agent-policy.v1",
        completion: "completion-policy.v1",
      },
      capabilityClass: "BUILD_L4",
      provider: "claude_cli",
      modelId: "claude-opus-5-5",
      reasoningRequired: "high",
      reservedCapAcuMicro: "8000000",
      humanReviewRequired: false,
      riskClass: "standard",
      issuedAt: "2026-09-30T00:00:00.000Z",
    };
    expect(RunPolicySnapshot.safeParse({ ...snap, claim: { mode: "self_pick", queueBonusBp: 2000, bonusApplies: false } }).success).toBe(
      true,
    );
    expect(RunPolicySnapshot.safeParse({ ...snap, claim: { mode: "self_pick", queueBonusBp: 2000, bonusApplies: true } }).success).toBe(
      false,
    );
  });
  it("declines: releasing an assigned task means the next claim doesn't get the queue bonus; repeated, a cooldown", () => {
    const H = 3_600_000;
    const now = 1_000 * H;
    const base = { mode: "queue" as const, queueBonusBp: 2000, nowMs: now, declines: WN.declines, claimedSinceLastRelease: false };
    expect(nextClaimTerms({ ...base, assignedReleases: [] }).claim).toEqual({ mode: "queue", queueBonusBp: 2000, bonusApplies: true });
    expect(nextClaimTerms({ ...base, assignedReleases: [{ atMs: now - H, cause: "contributor" }] }).claim!.bonusApplies).toBe(false);
    expect(
      nextClaimTerms({ ...base, claimedSinceLastRelease: true, assignedReleases: [{ atMs: now - H, cause: "contributor" }] }).claim!
        .bonusApplies,
    ).toBe(true);
    for (const cause of ["authorized_cancel", "work_hold", "expiry_not_contributor"] as const)
      expect(nextClaimTerms({ ...base, assignedReleases: [{ atMs: now - H, cause }] }).claim!.bonusApplies).toBe(true);
    const three = [1, 2, 3].map((h) => ({ atMs: now - h * H, cause: "contributor" as const }));
    refused(nextClaimTerms({ ...base, assignedReleases: three }).refusals, /cooldown/);
    expect(nextClaimTerms({ ...base, nowMs: now + 24 * H, assignedReleases: three }).claim).not.toBeNull();
    expect(nextClaimTerms({ ...base, mode: "self_pick", assignedReleases: [] }).claim!.bonusApplies).toBe(false);
  });
});

describe("D63 engine: the queue bonus of a self-picked task returns to R at acceptance; conservation holds", () => {
  const params = engineParamsFrom(REWARD_POLICY_V2, COMPLETION_POLICY_V1);
  const RESERVE = BigInt(REWARD_POLICY_V2.emission.emissionReserveBase);
  const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
  const issue = (n: number) => ({
    taskId: id(n),
    kind: "execution" as const,
    budgetAcuMicro: 12_000_000n,
    featurePoolKeys: [],
    applicationPoolKeys: [],
  });
  const accept = (n: number, claim?: { mode: "queue" | "self_pick"; queueBonusBp: number; bonusApplies: boolean }) => ({
    taskId: id(n),
    shares: [{ accountId: id(900), beneficiaryId: id(900), shareBp: 10_000 }],
    ...(claim ? { claim } : {}),
  });
  it("queue pays the whole reservation, self-pick the floored base; the difference returns to R; reservations stay full", () => {
    const r1 = computeEpoch(
      { epochNumber: 1, state: initialState(RESERVE), consumedIds: new Set(), issuances: [issue(1), issue(2), issue(3)] },
      params,
    );
    const res = r1.state.reserved.get(id(1))!.amount;
    expect(r1.state.reserved.get(id(2))!.amount).toBe(res);
    const r2 = computeEpoch(
      {
        epochNumber: 2,
        state: r1.state,
        consumedIds: new Set(r1.consumedIds),
        acceptances: [
          accept(1, { mode: "queue", queueBonusBp: 2000, bonusApplies: true }),
          accept(2, { mode: "self_pick", queueBonusBp: 2000, bonusApplies: false }),
          accept(3, { mode: "queue", queueBonusBp: 2000, bonusApplies: false }),
        ],
      },
      params,
    );
    const paid = (n: number) => r2.allocations.filter((a) => a.receiptId === id(n)).reduce((t, a) => t + a.amountBase, 0n);
    expect(paid(1)).toBe(res);
    // a queue claim whose bonus was withheld (decline rule) is paid the base, like self-pick
    expect(paid(3)).toBe((res * 10_000n) / 12_000n);
    expect(paid(2)).toBe((res * 10_000n) / 12_000n);
    expect(r2.queueBonusReturnedBase).toBe(2n * (res - paid(2)));
    expect(r2.acceptedBase).toBe(res + 2n * paid(2));
    assertConserved(RESERVE, r2.state);
  });
  it("only a queue claim earns the bonus", () => {
    const r1 = computeEpoch({ epochNumber: 1, state: initialState(RESERVE), consumedIds: new Set(), issuances: [issue(1)] }, params);
    expect(() =>
      computeEpoch(
        {
          epochNumber: 2,
          state: r1.state,
          consumedIds: new Set(r1.consumedIds),
          acceptances: [accept(1, { mode: "self_pick", queueBonusBp: 2000, bonusApplies: true })],
        },
        params,
      ),
    ).toThrow(/only a queue claim/);
  });
});

// ------------------------------------------------------------------------------------------------ Astra review 09
describe("Astra review 09: regressions (docs/protocol/reviews/ASTRA-REVIEW-09-repros-prefix.txt)", () => {
  const params2 = engineParamsFrom(REWARD_POLICY_V2, COMPLETION_POLICY_V1);
  const params1 = engineParamsFrom(REWARD_POLICY_V1, COMPLETION_POLICY_V1);
  const RES = BigInt(REWARD_POLICY_V2.emission.emissionReserveBase);
  const issued = (p: typeof params2) =>
    computeEpoch(
      {
        epochNumber: 1,
        state: initialState(RES),
        consumedIds: new Set(),
        issuances: [{ taskId: "t", kind: "execution", budgetAcuMicro: 12_000_000n, featurePoolKeys: [], applicationPoolKeys: [] }],
      },
      p,
    );
  const acceptWith = (p: typeof params2, claim?: { mode: "queue" | "self_pick"; queueBonusBp: number; bonusApplies: boolean }) => {
    const a = issued(p);
    return computeEpoch(
      {
        epochNumber: 2,
        state: a.state,
        consumedIds: new Set(a.consumedIds),
        acceptances: [{ taskId: "t", shares: [{ accountId: "a", beneficiaryId: "a", shareBp: 10_000 }], ...(claim ? { claim } : {}) }],
      },
      p,
    );
  };
  const selfPick = { mode: "self_pick" as const, queueBonusBp: 2000, bonusApplies: false };
  it("R09-1 repro: omitted or tampered claim terms on v2 work are refused by the engine; v1 work takes none", () => {
    expect(() => acceptWith(params2)).toThrow(/needs its claim terms/);
    expect(() => acceptWith(params2, { ...selfPick, queueBonusBp: 0 })).toThrow(/differs from the pinned policy/);
    expect(() => acceptWith(params1, selfPick)).toThrow(/pinned v1 work carries no claim terms/);
    const v1 = acceptWith(params1);
    expect(v1.allocations.reduce((t, a) => t + a.amountBase, 0n)).toBe(issued(params1).state.reserved.get("t")!.amount);
    expect(taskPayableBase(1200n, 2000, selfPick)).toEqual({ payable: 1000n });
    expect(taskPayableBase(1200n, null, undefined)).toEqual({ payable: 1200n });
  });
  it("R09-1: claim terms are complete, carry the pinned coefficient and match the authoritative claim history", () => {
    const derived = { mode: "self_pick" as const, bonusApplies: false };
    expect(claimTermsRefusals({ pinnedQueueBonusBp: 2000, claim: selfPick, derived })).toEqual([]);
    for (const bad of [
      undefined,
      null,
      {},
      { mode: "self_pick" },
      { ...selfPick, bonusApplies: "no" },
      { ...selfPick, queueBonusBp: "2000" },
    ])
      refused(claimTermsRefusals({ pinnedQueueBonusBp: 2000, claim: bad, derived }), /complete, well-formed/);
    refused(claimTermsRefusals({ pinnedQueueBonusBp: 2000, claim: { ...selfPick, queueBonusBp: 0 }, derived }), /differs from the pinned/);
    refused(
      claimTermsRefusals({
        pinnedQueueBonusBp: 2000,
        claim: { mode: "queue", queueBonusBp: 2000, bonusApplies: true },
        derived: { mode: "queue", bonusApplies: false },
      }),
      /authoritative claim history/,
    );
    refused(claimTermsRefusals({ pinnedQueueBonusBp: 2000, claim: selfPick, derived: null }), /authoritative claim history/);
    expect(claimTermsRefusals({ pinnedQueueBonusBp: null, claim: undefined, derived: null })).toEqual([]);
    refused(claimTermsRefusals({ pinnedQueueBonusBp: null, claim: selfPick, derived: null }), /v1/);
  });
  it("R09-1: one task-level entitlement — participating leases carry identical terms or the task is refused", () => {
    expect(taskClaimOf(2000, [selfPick, { ...selfPick }])).toEqual({ claim: selfPick });
    refused(
      [
        "refusal" in taskClaimOf(2000, [selfPick, { mode: "queue", queueBonusBp: 2000, bonusApplies: true }])
          ? (taskClaimOf(2000, [selfPick, { mode: "queue", queueBonusBp: 2000, bonusApplies: true }]) as { refusal: string }).refusal
          : "",
      ],
      /different claim terms/,
    );
    expect(taskClaimOf(2000, [selfPick, undefined])).toHaveProperty("refusal");
    expect(taskClaimOf(null, [undefined, undefined])).toEqual({ claim: undefined });
  });
  it("R09-2 repro: the engine's self-pick payment passes the versioned allocation rule; the full reservation does not", () => {
    const r = acceptWith(params2, selfPick);
    const reserved = issued(params2).state.reserved.get("t")!.amount;
    const paid = r.allocations.reduce((t, a) => t + a.amountBase, 0n);
    const receipts = [{ receiptId: "t", accountId: "a", shareBp: 10_000, orgShareBp: 0 }];
    expect(
      taskAllocationRefusals({
        reservedBase: reserved,
        receipts,
        lines: [{ receiptId: "t", beneficiary: "person", amount: paid }],
        pinnedQueueBonusBp: 2000,
        claim: selfPick,
      }),
    ).toEqual([]);
    refused(
      taskAllocationRefusals({
        reservedBase: reserved,
        receipts,
        lines: [{ receiptId: "t", beneficiary: "person", amount: reserved }],
        pinnedQueueBonusBp: 2000,
        claim: selfPick,
      }),
      /declared shares give/,
    );
    refused(
      taskAllocationRefusals({
        reservedBase: reserved,
        receipts,
        lines: [{ receiptId: "t", beneficiary: "person", amount: paid }],
        pinnedQueueBonusBp: 2000,
      }),
      /claim terms/,
    );
    // frozen v1 path unchanged
    expect(
      taskAllocationRefusals({ reservedBase: reserved, receipts, lines: [{ receiptId: "t", beneficiary: "person", amount: reserved }] }),
    ).toEqual([]);
    // awkward integers, two contributors, one with an organization share: the engine's canonical split of the payable base
    const two = [
      { receiptId: "r1", accountId: "a1", shareBp: 3333, orgShareBp: 2500 },
      { receiptId: "r2", accountId: "a2", shareBp: 6667, orgShareBp: 0 },
    ];
    const base = queueBasePrice(1001n, 2000);
    expect(base).toBe(834n);
    const split = splitTaskReservation(base, two);
    const lines = two.flatMap((c) => {
      const x = split.get(c.accountId)!;
      return [
        { receiptId: c.receiptId, beneficiary: "person" as const, amount: x.person },
        ...(c.orgShareBp > 0 ? [{ receiptId: c.receiptId, beneficiary: "organization" as const, amount: x.organization }] : []),
      ];
    });
    expect(lines.reduce((t, l) => t + l.amount, 0n)).toBe(834n);
    expect(taskAllocationRefusals({ reservedBase: 1001n, receipts: two, lines, pinnedQueueBonusBp: 2000, claim: selfPick })).toEqual([]);
    const full = splitTaskReservation(1001n, two);
    const fullLines = lines.map((l) => ({
      ...l,
      amount: l.beneficiary === "person" ? full.get(l.receiptId === "r1" ? "a1" : "a2")!.person : full.get("a1")!.organization,
    }));
    expect(
      taskAllocationRefusals({ reservedBase: 1001n, receipts: two, lines: fullLines, pinnedQueueBonusBp: 2000, claim: selfPick }).length,
    ).toBeGreaterThan(0);
  });
  const green2: RedGreenEvidence = {
    bug: "BUG-21",
    feature: "unrelated",
    regressionTest: "features/unrelated/acceptance/regressions/BUG-21.spec.ts",
    parent: { sha: "a".repeat(40), conclusion: "failure", failedTests: ["features/unrelated/acceptance/regressions/BUG-21.spec.ts"] },
    head: { sha: "b".repeat(40), conclusion: "success", failedTests: [] },
    testSha256: `sha256:${"c".repeat(64)}`,
  };
  const expected20 = {
    bug: "BUG-20",
    feature: "contacts",
    parentSha: "1".repeat(40),
    headSha: "2".repeat(40),
    regressionTest: "features/contacts/acceptance/regressions/BUG-20.spec.ts",
    testSha256: `sha256:${"3".repeat(64)}`,
  };
  const green20: RedGreenEvidence = {
    bug: "BUG-20",
    feature: "contacts",
    regressionTest: expected20.regressionTest,
    parent: { sha: expected20.parentSha, conclusion: "failure", failedTests: [expected20.regressionTest] },
    head: { sha: expected20.headSha, conclusion: "success", failedTests: [] },
    testSha256: expected20.testSha256,
  };
  const route = {
    acceptance: REWARD_POLICY_V2.acceptance,
    contributionType: "BUG_FIX",
    slice: "execution",
    evidenceClass: "accepted_budget" as const,
    taskKind: "execution",
    hasLease: true,
    receiptAccountId: "fixer",
    taskId: "fix-BUG-20",
    humanReview: null,
    commission: { taskKind: "abu_build", fixBug: "BUG-20" },
    bugFix: {
      outcome: "fix" as const,
      severityAtIssuance: "high" as const,
      budgetSeverity: "high" as const,
      redGreen: green20,
      expected: expected20,
      fixerTriagedIt: false,
      fixerIsBarredIntroducer: false,
    },
  };
  it("R09-3 repro A: red/green evidence of another bug, feature or commits is refused; the bound evidence passes", () => {
    expect(receiptRouteRefusals(route)).toEqual([]);
    refused(receiptRouteRefusals({ ...route, bugFix: { ...route.bugFix, redGreen: green2 } }), /not bound to this fix/);
    refused(
      receiptRouteRefusals({
        ...route,
        bugFix: { ...route.bugFix, redGreen: { ...green20, head: { ...green20.head, sha: "9".repeat(40) } } },
      }),
      /not bound/,
    );
    refused(receiptRouteRefusals({ ...route, bugFix: { ...route.bugFix, expected: { ...expected20, bug: "BUG-21" } } }), /not bound/);
    refused(receiptRouteRefusals({ ...route, bugFix: { ...route.bugFix, expected: null } }), /required to bind the evidence/);
  });
  it("R09-3 repro B: a fix task's receipt classified as IMPLEMENTATION is refused (the route follows the commission)", () => {
    const disguised = {
      ...route,
      contributionType: "IMPLEMENTATION",
      bugFix: { ...route.bugFix, redGreen: null, fixerTriagedIt: true, fixerIsBarredIntroducer: true },
    };
    refused(receiptRouteRefusals(disguised), /a fix task's receipt is BUG_FIX/);
    refused(receiptRouteRefusals({ ...disguised, commission: null }), /commissioning metadata is required/);
    // control: an ordinary implementation task keeps its ordinary route
    expect(receiptRouteRefusals({ ...disguised, commission: { taskKind: "abu_build", fixBug: null }, bugFix: null })).toEqual([]);
    refused(receiptRouteRefusals({ ...route, commission: { taskKind: "abu_build", fixBug: null } }), /only on a commissioned fix task/);
    refused(receiptRouteRefusals({ ...route, commission: { taskKind: "feature_author", fixBug: "BUG-20" } }), /abu_build or abu_revision/);
  });
  it("R09-3 repro C: triage is paid only on a commissioned bug_triage task, and a bug_triage task pays only triage", () => {
    const tr = {
      ...route,
      contributionType: "BUG_TRIAGE",
      receiptAccountId: "t",
      taskId: "tt",
      commission: { taskKind: "bug_triage", fixBug: null },
      bugFix: null,
      triage: {
        record: { decidedBy: "agent" as const, deciderAccountId: "t", triageTaskId: "tt", decisionSha256: "h" },
        receiptDecisionSha256: "h",
        confirmationRefusals: [],
      },
    };
    expect(receiptRouteRefusals(tr)).toEqual([]);
    refused(receiptRouteRefusals({ ...tr, commission: { taskKind: "abu_build", fixBug: null } }), /only on a commissioned bug_triage task/);
    refused(receiptRouteRefusals({ ...tr, contributionType: "IMPLEMENTATION", triage: null }), /bug_triage task's receipt is BUG_TRIAGE/);
  });
  const rc = (
    id: string,
    contributionType: string,
    status: "ACTIVE" | "RATIFIED" | "FINAL_BY_SILENCE" | "PROVISIONAL" | "REVOKED" | null,
  ) => ({
    id,
    contributionType,
    subjectKind: "bug",
    subjectId: "b1",
    status,
  });
  it("R09-4 repro: fix acceptance is a live-countable BUG_FIX of this bug, not row existence; dependents are raised on revocation", () => {
    for (const s of ["ACTIVE", "RATIFIED", "FINAL_BY_SILENCE"] as const) expect(bugFixAccepted("b1", [rc("f", "BUG_FIX", s)])).toBe(true);
    for (const s of ["PROVISIONAL", "REVOKED", null] as const) expect(bugFixAccepted("b1", [rc("f", "BUG_FIX", s)])).toBe(false);
    expect(bugFixAccepted("b2", [rc("f", "BUG_FIX", "ACTIVE")])).toBe(false);
    const after = [rc("f", "BUG_FIX", "REVOKED"), rc("rep", "BUG_REPORT", "ACTIVE"), rc("tri", "BUG_TRIAGE", "ACTIVE")];
    expect(fixRevocationDependents({ bugId: "b1", outcome: "fix", ratified: false, receipts: after })).toEqual(["rep", "tri"]);
    expect(fixRevocationDependents({ bugId: "b1", outcome: "fix", ratified: true, receipts: after })).toEqual(["rep"]);
    expect(
      fixRevocationDependents({ bugId: "b1", outcome: "fix", ratified: false, receipts: [...after, rc("f2", "BUG_FIX", "ACTIVE")] }),
    ).toEqual([]);
  });
  it("R09-5 repro: abu_revision fixes and architecture_author are priced by v2 rows", () => {
    const m = {
      capabilityBudgets: CAPABILITY_POLICY_V2.budgets,
      model: REWARD_POLICY_V2.budgets.model,
      humanReviewWeights: {},
      bugs: REWARD_POLICY_V2.bugs,
    };
    const b = { sizePoints: 2, difficultyBp: 10_000, importanceBp: 10_000 };
    expect(budgetModelMicro(m, { ...b, taskKind: "abu_revision", severity: "high" })).toEqual({ modelMicro: 10_000_000n });
    expect(budgetModelMicro(m, { ...b, taskKind: "abu_revision", severity: "high" })).toEqual(
      budgetModelMicro(m, { ...b, taskKind: "abu_build", severity: "high" }),
    );
    expect(budgetModelMicro(m, { ...b, taskKind: "architecture_author" })).toEqual({ modelMicro: 30_000_000n });
    expect(budgetModelMicro(m, { ...b, taskKind: "bug_sweep" })).toHaveProperty("refusal");
  });
  it("R09-6 repro: the quote is pinned at issuance; corrections before issuance price it, corrections after do not", () => {
    const record = { outcome: "fix" as const, severity: "high" as const };
    const low = { kind: "severity_corrected" as const, correctedSeverity: "low" as const };
    expect(fixBudgetIssuanceRefusals({ record, confirmationsAtIssuance: [], basisSeverity: "high", basisSeverityRevision: 0 })).toEqual([]);
    refused(
      fixBudgetIssuanceRefusals({ record, confirmationsAtIssuance: [low], basisSeverity: "high", basisSeverityRevision: 1 }),
      /effective severity low/,
    );
    expect(fixBudgetIssuanceRefusals({ record, confirmationsAtIssuance: [low], basisSeverity: "low", basisSeverityRevision: 1 })).toEqual(
      [],
    );
    refused(
      fixBudgetIssuanceRefusals({ record, confirmationsAtIssuance: [], basisSeverity: "high", basisSeverityRevision: 1 }),
      /revision/,
    );
    // after lease or after submission, a downgrade to low does not touch the high quote pinned at issuance
    expect(receiptRouteRefusals({ ...route, bugFix: { ...route.bugFix, severityAtIssuance: "high", budgetSeverity: "high" } })).toEqual([]);
    refused(
      receiptRouteRefusals({ ...route, bugFix: { ...route.bugFix, severityAtIssuance: "high", budgetSeverity: "critical" } }),
      /effective at its issuance/,
    );
  });
});

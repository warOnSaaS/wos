/**
 * D51 engine-first enforcement: every Astra review 02/03 repro (and D49 rule) whose SQL guard moved out of migration
 * 0007 is asserted here against the rule the service layer must call before writing. Each test starts from a valid
 * baseline (which must return no refusal) and then applies the repro. Labels match REVIEW-PACKET §3e.
 */
import { describe, expect, it } from "vitest";
import {
  allocationChallengeDecisionRefusals,
  allocationChallengeRefusals,
  challengedAllocationPaymentRefusals,
  rulingLabRecordsFromConfirmedRuling,
  claimEligibilityRefusals,
  computeEpoch,
  acceptanceRequirement,
  builderAcceptanceRefusals,
  boundRunPolicySnapshot,
  challengeAdmissionRefusals,
  challengePublicationRefusals,
  receiptCountsIn,
  reissueRefusals,
  silenceFinalizationRefusals,
  splitTaskReservation,
  crossLabUpholdRates,
  labOfProvider,
  resolverEligibilityRefusals,
  routeDisputedFindings,
  CLAIM_NEXT_BUILD_ROUTE,
  ClaimNextBuildRequest,
  continuousNextStop,
  nextUnitEligibilityRefusals,
  rankNextUnits,
  selfPickRefusals,
  budgetModelMicro,
  budgetReleaseRefusals,
  canonicalOperationFields,
  DORMANT_MODULES,
  epochEnvelopeRefusals,
  genesisReferenceManifestSha256,
  leaseBudgetRefusals,
  moduleRefusals,
  openEpoch,
  initialState,
  engineParamsFrom,
  COMPLETION_POLICY_V1,
  provisionalReceiptOutcome,
  receiptRouteRefusals,
  requiredReviewSeats,
  REVIEW_POLICY_V1,
  REWARD_POLICY_V1,
  REWARD_POLICY_V2,
  reviewPolicySwitchRefusals,
  reviewSeatRefusals,
  settlementObservationRefusals,
  snapshotHumanRequirement,
  taskAllocationRefusals,
  ACTIVATION_RULES,
  activationRefusals,
  CAPABILITY_POLICY_V1,
  modelClaimRefusals,
  adapterEventRefusals,
  allocationLineRefusals,
  auditOutcomePublishRefusals,
  clipRefusals,
  dutyEventRefusals,
  exclusionRefusals,
  genesisDedupRefusals,
  manifestEntryRefusals,
  sponsorshipRefusals,
  usageReceiptRefusals,
  adminAuthorizationRefusals,
  allocationAdjudication,
  appealDecisionRefusals,
  auditAssignmentRefusals,
  auditVerdictRefusals,
  budgetRefusals,
  claimRefusals,
  confiscationAppealRefusals,
  confiscationDecisionRefusals,
  confiscationExecutionRefusals,
  confiscationHoldRefusals,
  confiscationNoticeRefusals,
  disputeAppealRefusals,
  disputeOpenRefusals,
  disputeReplyRefusals,
  disputeRevocationRefusals,
  disputeSettlementDerived,
  entitlementRefusals,
  genesisCommitClaimRefusals,
  genesisContributionRefusals,
  genesisReferenceManifestRefusals,
  humanReviewRefusals,
  poolEventRefusals,
  type QualificationEvidence,
  type RunPolicySnapshot,
  runPolicySnapshotSha256,
  qualificationRefusals,
  quorumRatifyRefusals,
  ReceiptStatusMachine,
  receiptRefusals,
  resolutionRefusals,
  telemetryLinkStatus,
  settlementResumeRefusals,
  voteRefusals,
  walletBindingRefusals,
} from "../src/protocol/index.js";

const H = 3_600_000;
const NOW = 1_800_000_000_000;
const refused = (r: string[], pattern: RegExp) => expect(r.join(" | ")).toMatch(pattern);

// ------------------------------------------------------------------------------------------------ admin actions
describe("admin authorization (H12, A3-7) — moved from 0007 require_admin_action", () => {
  const action = {
    id: "a1",
    action: "record_offset",
    targetKind: "beneficiary",
    targetId: "b",
    payload: { amount_base: 1, receipt_id: null },
    requiresCoSigner: true,
    coSignerAccountId: "alice",
    operationSha256: "sha256:op",
  };
  const need = { kinds: ["record_offset"], targetKind: "beneficiary", targetId: "b", operation: { receipt_id: null, amount_base: 1 } };
  const ctx = { approval: { approverAccountId: "alice", operationSha256: "sha256:op" }, alreadyUsed: false };
  it("baseline: the exact, approved, unused action authorizes", () => expect(adminAuthorizationRefusals(action, need, ctx)).toEqual([]));
  it("A3-7 repro: an old record_offset action reused for a different amount", () =>
    refused(
      adminAuthorizationRefusals(action, { ...need, operation: { amount_base: 999999999, receipt_id: null } }, ctx),
      /another operation/,
    ));
  it("A3-7 repro: an old record_offset action reused for the same amount / one action used for a second mutation", () =>
    refused(adminAuthorizationRefusals(action, need, { ...ctx, alreadyUsed: true }), /already used/));
  it("A3-7: a two-person action without the co-signer's separate approval", () =>
    refused(adminAuthorizationRefusals(action, need, { ...ctx, approval: null }), /co-signer approval/));
  it("A3-7: an approval of a different operation hash / by the actor", () => {
    refused(
      adminAuthorizationRefusals(action, need, { ...ctx, approval: { approverAccountId: "alice", operationSha256: "sha256:x" } }),
      /co-signer/,
    );
    refused(
      adminAuthorizationRefusals(action, need, { ...ctx, approval: { approverAccountId: "carol", operationSha256: "sha256:op" } }),
      /co-signer/,
    );
  });
  it("H12 / A3-7 repro: an unrelated action (revocation, qualification grant, activation, leaf void, confiscation decision)", () => {
    for (const kinds of [
      ["invalidate_receipt"],
      ["authorize_reviewer"],
      ["activate_policy"],
      ["void_leaf"],
      ["decide_confiscation_appeal"],
    ])
      refused(adminAuthorizationRefusals({ ...action, action: "start_test_epochs" }, { ...need, kinds }, ctx), /does not authorize/);
  });
  it("A3-7 repro: revoking with a one-person resolve_dispute action and no resolution", () => {
    refused(
      adminAuthorizationRefusals({ ...action, action: "resolve_dispute" }, { ...need, kinds: ["invalidate_receipt"] }, ctx),
      /does not authorize/,
    );
    refused(disputeRevocationRefusals({ resolutionOutcome: null, allocationOfThisReceipt: true, adjudication: null }), /final REVOKED/);
    expect(
      disputeRevocationRefusals({
        resolutionOutcome: "REVOKED",
        allocationOfThisReceipt: true,
        adjudication: { finalAmount: 0n, isFinal: true },
      }),
    ).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ qualification
/** A stored run-policy snapshot body (the typed shape, review 04 finding 6). */
function snapshot(humanReviewRequired: boolean, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "wos-run-policy-snapshot.v1",
    leaseId: "00000000-0000-4000-8000-000000000c03",
    leaseGeneration: 1,
    policyVersions: {
      reward: "reward-policy.v1",
      oracle: "cost-oracle.v1",
      review: "review-policy.v1",
      usageProof: "usage-proof-policy.v1",
      agent: "agent-policy.v1",
      capability: "capability-policy.v1",
      risk: "risk-policy.v1",
      merge: "merge-policy.v1",
      completion: "completion-policy.v1",
    },
    capabilityClass: "PLAN_L1",
    provider: "claude_cli",
    modelId: "claude-opus-5-5",
    reasoningRequired: "max",
    reservedCapAcuMicro: "60000000",
    humanReviewRequired,
    riskClass: "standard",
    issuedAt: "2026-09-30T00:00:00.000Z",
    ...over,
  };
}
const LEASE_C3 = "00000000-0000-4000-8000-000000000c03";
const LEASE_C5 = "00000000-0000-4000-8000-000000000c05";
/** The stored snapshot of a lease, its row and the hash the qualification binds (review 06 R06-6). */
function bound(leaseId: string, humanReviewRequired = false, over: Record<string, unknown> = {}) {
  const body = snapshot(humanReviewRequired, { leaseId, ...over });
  const sha = runPolicySnapshotSha256(body as RunPolicySnapshot);
  return { snapshotBody: body, snapshotRow: { leaseId, generation: 1, snapshotSha256: sha }, qualificationSnapshotSha256: sha };
}
const SINGLE_LAB = [{ label: "single_lab_review", reason: "fable_unavailable: Fable seat replaced by the required human review (D53)" }];
const ASTRA_PASS = { slot: "astra", verdict: "NO_MATERIAL_GAPS", provider: "codex_cli", modelId: "gpt-6-astra", reasoning: "max" };
const FABLE_PASS = { slot: "fable", verdict: "NO_MATERIAL_GAPS", provider: "claude_cli", modelId: "claude-fable-5-1", reasoning: "max" };
describe("qualification chain (H7, A3-5) — moved from 0007 check_qualification_result", () => {
  const base: QualificationEvidence = {
    subjectKind: "document",
    subjectId: "d1",
    revision: "b".repeat(40),
    lease: {
      id: LEASE_C3,
      generation: 1,
      accountId: "bob",
      taskKind: "roadmap_author",
      taskAttemptId: null,
      taskAbuId: null,
      taskDocumentId: "d1",
      issuedAtMs: NOW - 3 * H,
      expiresAtMs: NOW + 0.5 * H,
      hardDeadlineAtMs: NOW + H,
      endedAtMs: NOW - 0.1 * H,
    },
    citedGeneration: 1,
    changeset: { leaseId: LEASE_C3, ok: true, signatureValid: true, createdAtMs: NOW - 0.5 * H, submissionSha256: "s9" },
    round: {
      state: "revealed",
      outcome: "consensus",
      headSha: "b".repeat(40),
      submissionSha256: "s9",
      attemptId: null,
      documentId: "d1",
      // D53 is active in review-policy.v1: Astra plus the required human, no Fable seat (review 06 R06-1).
      reviewVerdicts: [ASTRA_PASS],
    },
    greenCiAtHead: false,
    ...bound(LEASE_C3),
    pinnedReviewPolicy: REVIEW_POLICY_V1,
    pinnedCapabilityPolicy: CAPABILITY_POLICY_V1,
    humanPreMergePassOnRound: true,
    receiptLabels: SINGLE_LAB,
  };
  const attempt: QualificationEvidence = {
    ...base,
    subjectKind: "attempt",
    subjectId: "at1",
    revision: "c".repeat(40),
    lease: { ...base.lease, id: LEASE_C5, taskKind: "abu_build", taskAbuId: "ab1", taskDocumentId: null },
    changeset: { ...base.changeset!, leaseId: LEASE_C5, submissionSha256: "s8" },
    ...bound(LEASE_C5, false, { capabilityClass: "BUILD_L4" }),
    attempt: { id: "at1", accountId: "bob", abuId: "ab1", maxLifetimeAtMs: NOW + 24 * H },
    round: { ...base.round!, headSha: "c".repeat(40), submissionSha256: "s8", attemptId: "at1", documentId: null },
    greenCiAtHead: true,
  };
  it("baseline: document and attempt qualifications pass", () => {
    expect(qualificationRefusals(base)).toEqual([]);
    expect(qualificationRefusals(attempt)).toEqual([]);
  });
  it("A3-5 repro: a qualification asserting an arbitrary revision", () =>
    refused(qualificationRefusals({ ...base, revision: "c".repeat(40) }), /consensus round/));
  it("A3-5: a qualification citing a round that ended in gaps", () =>
    refused(
      qualificationRefusals({
        ...base,
        round: { ...base.round!, outcome: "gaps", reviewVerdicts: [{ ...ASTRA_PASS, verdict: "MATERIAL_GAPS" }] },
      }),
      /consensus round/,
    ));
  it("A3-5: a qualification citing a changeset of another lease", () =>
    refused(qualificationRefusals({ ...base, changeset: { ...base.changeset!, leaseId: LEASE_C5 } }), /not accepted on this lease/));
  it("A3-5 / H7: a qualification on a stale lease generation", () =>
    refused(qualificationRefusals({ ...base, citedGeneration: 2 }), /stale lease generation/));
  it("A3-5: the pinned snapshot requires a human approval that is missing", () =>
    refused(qualificationRefusals({ ...base, ...bound(LEASE_C3, true), humanPreMergePassOnRound: false }), /human pre-merge/));
  it("A3-5: an implementation qualified without green CI at its head", () =>
    refused(qualificationRefusals({ ...attempt, greenCiAtHead: false }), /green CI/));
  it("A3-5 repro: another attempt's changeset cited for this attempt", () =>
    refused(qualificationRefusals({ ...attempt, lease: { ...attempt.lease, taskAbuId: "ab2" } }), /another attempt/));
  it("A3-5: a submission accepted after the attempt's hard lifetime", () =>
    refused(qualificationRefusals({ ...attempt, attempt: { ...attempt.attempt!, maxLifetimeAtMs: NOW - 2 * H } }), /hard lifetime/));
  it("A3-5: a document qualification from a non-author lease", () =>
    refused(qualificationRefusals({ ...base, lease: { ...base.lease, taskKind: "roadmap_review" } }), /author lease/));
});

// ------------------------------------------------------------------------------------------------ receipts and budgets
describe("receipts and budgets (H7, D47, D49) — moved from 0007 check_contribution_receipt / check_task_budget", () => {
  const ok = {
    consentAccepted: true,
    epochState: "OPEN",
    cluster: "devnet" as const,
    contributionType: "APPLICATION_ROADMAP",
    subjectKind: "document",
    attemptMerged: false,
    qualificationOk: true,
    needsQualification: true,
    evidenceClass: "accepted_budget" as const,
    weightMicro: 3_000_000n,
    budget: { amountMicro: 3_000_000n, kind: "planning", released: false, expiresEpoch: 6, submittedEpoch: null, reviewGraceEpochs: 2 },
    slice: "planning",
    admittedEpoch: 2,
    shareBp: 10_000,
    sharesAlreadyDeclaredBp: 0,
  };
  it("baseline: a budget-paid receipt passes", () => expect(receiptRefusals(ok)).toEqual([]));
  it("D47: a receipt without the publication disclosure", () => refused(receiptRefusals({ ...ok, consentAccepted: false }), /disclosure/));
  it("H7: a leased contribution without a qualification", () =>
    refused(receiptRefusals({ ...ok, qualificationOk: false }), /qualification/));
  it("H7: an IMPLEMENTATION receipt without a merged attempt", () =>
    refused(receiptRefusals({ ...ok, contributionType: "IMPLEMENTATION" }), /merged attempt/));
  it("H6: admission to an epoch that is not OPEN", () => refused(receiptRefusals({ ...ok, epochState: "CALCULATING" }), /OPEN epoch/));
  it("readiness gate: a receipt on a mainnet epoch", () => refused(receiptRefusals({ ...ok, cluster: "mainnet-beta" }), /mainnet/));
  it("D49: a receipt weighted by its usage instead of its task budget", () =>
    refused(receiptRefusals({ ...ok, weightMicro: 12_000n }), /never a usage figure/));
  it("D49: accepting a task whose budget was released or expired", () => {
    refused(receiptRefusals({ ...ok, budget: { ...ok.budget, released: true } }), /released or expired/);
    refused(receiptRefusals({ ...ok, admittedEpoch: 7 }), /released or expired/);
  });
  it("D49: a third share on a fully declared task (reward stacking)", () =>
    refused(receiptRefusals({ ...ok, shareBp: 1, sharesAlreadyDeclaredBp: 10_000 }), /exceed 10000/));
  it("A3-5 (telemetry, B10): usage of another run / reused by a second contribution is excluded, never blocks the receipt", () => {
    expect(telemetryLinkStatus({ ownAndThisLease: false, attributedElsewhere: false })).toBe("excluded_not_this_lease");
    expect(telemetryLinkStatus({ ownAndThisLease: true, attributedElsewhere: true })).toBe("excluded_already_linked");
    expect(telemetryLinkStatus({ ownAndThisLease: true, attributedElsewhere: false })).toBe("valid");
  });
  const b = {
    budgetMicro: 4_000_000n,
    modelMicro: 4_000_000n,
    humanAboveBp: 12_500,
    hardMaxBp: 20_000,
    justification: "",
    approvalRefusals: null as string[] | null,
    objectiveBudgetMicro: 10_000_000n,
    objectiveUsedMicro: 6_000_000n,
    epochOpenWithRate: true,
    cluster: "devnet" as const,
    computedModel: { modelMicro: 4_000_000n } as { modelMicro: bigint } | { refusal: string },
    objectiveConsensus: { revealed: true, outcome: "consensus", coversBudget: true } as {
      revealed: boolean;
      outcome: string | null;
      coversBudget: boolean;
    } | null,
  };
  const m2 = { modelMicro: 2_000_000n, computedModel: { modelMicro: 2_000_000n } };
  it("baseline: a budget at the model passes; above it with justification and approval passes", () => {
    expect(budgetRefusals(b)).toEqual([]);
    expect(budgetRefusals({ ...b, ...m2, budgetMicro: 3_000_000n, justification: "x".repeat(40), approvalRefusals: [] })).toEqual([]);
  });
  it("D49: a budget above the hard maximum of the model", () => refused(budgetRefusals({ ...b, budgetMicro: 9_000_000n }), /hard maximum/));
  it("D49: a budget above the model without a written justification / without a two-person approval", () => {
    refused(budgetRefusals({ ...b, ...m2, budgetMicro: 3_000_000n }), /justification/);
    refused(
      budgetRefusals({
        ...b,
        ...m2,
        budgetMicro: 3_000_000n,
        justification: "x".repeat(40),
        approvalRefusals: ["does not authorize"],
      }),
      /approve_budget/,
    );
  });
  it("D49: task budgets under one objective exceeding it (splitting / stacking)", () =>
    refused(
      budgetRefusals({ ...b, budgetMicro: 5_000_000n, modelMicro: 5_000_000n, computedModel: { modelMicro: 5_000_000n } }),
      /objective/,
    ));
  it("D49: issuing a task on mainnet or outside an OPEN epoch with a pinned rate", () => {
    refused(budgetRefusals({ ...b, cluster: "mainnet-beta" }), /mainnet/);
    refused(budgetRefusals({ ...b, epochOpenWithRate: false }), /pinned issuance rate/);
  });
});

// ------------------------------------------------------------------------------------------------ status, human review, audits
describe("receipt status, human review, audits (D23, H8, H11, A3-6) — moved from 0007 status / human / audit triggers", () => {
  it("D23: ratifying a receipt that is not provisional; restoring to a status it never had", () => {
    const allowed = (from: string, event: string) => ReceiptStatusMachine.transitions.some((t) => t.from === from && t.event === event);
    expect(allowed("ACTIVE", "quorum_ratified")).toBe(false);
    expect(allowed("PROVISIONAL", "quorum_ratified")).toBe(true);
    const restored = ReceiptStatusMachine.transitions.filter((t) => t.event === "restored");
    expect(restored.every((t) => t.from === "REVOKED")).toBe(true);
  });
  it("H8: a human review outside the reviewer's risk classes; a pre-merge approval bound to another subject's round", () => {
    const hr = {
      reviewerGrantedRiskClasses: ["standard"],
      riskClass: "standard",
      purpose: "pre_merge" as const,
      round: { ofThisSubject: true, headSha: "a", submissionSha256: "s" },
      headSha: "a",
      submissionSha256: "s",
    };
    expect(humanReviewRefusals(hr)).toEqual([]);
    refused(humanReviewRefusals({ ...hr, riskClass: "security" }), /risk class/);
    refused(humanReviewRefusals({ ...hr, round: { ...hr.round, ofThisSubject: false } }), /bound to a round of this subject/);
  });
  it("repro B / H7: ratifying a quorum without enough verdicts, or with an open finding", () => {
    expect(quorumRatifyRefusals({ size: 2, plausibleOutsideFeature: 2, openInflationOrAttributionFindings: 0 })).toEqual([]);
    refused(quorumRatifyRefusals({ size: 2, plausibleOutsideFeature: 0, openInflationOrAttributionFindings: 0 }), /lacks/);
    refused(quorumRatifyRefusals({ size: 2, plausibleOutsideFeature: 2, openInflationOrAttributionFindings: 1 }), /open inflation/);
  });
  const assignment = {
    quorumId: "q1",
    slot: 1,
    packetSha256: "pa",
    reviewerAccountId: "dave",
    taskId: "f6",
    leaseId: "c6",
    permittedProvider: "claude_cli",
    leaseGeneration: 1,
  };
  const v = {
    quorumRevealed: false,
    assignment,
    verdict: {
      quorumId: "q1",
      slot: 1,
      packetSha256: "pa",
      reviewerAccountId: "dave",
      taskId: "f6",
      leaseId: "c6",
      provider: "claude_cli",
    },
    lease: { active: true, generation: 1, expiresAtMs: NOW + H, hardDeadlineAtMs: NOW + 3 * H },
    run: { leaseId: "c6", signatureValid: true, provider: "claude_cli", alreadyUsed: false },
    nowMs: NOW,
  };
  it("baseline: a verdict redeeming its assignment passes", () => expect(auditVerdictRefusals(v)).toEqual([]));
  it("A3-6 repro: a claude run declared as the codex seat", () =>
    refused(auditVerdictRefusals({ ...v, verdict: { ...v.verdict, provider: "codex_cli" } }), /redeem its own assignment/));
  it("A3-6 repro: an assignment redeemed on an unrelated quorum; a verdict on another packet", () => {
    refused(auditVerdictRefusals({ ...v, verdict: { ...v.verdict, quorumId: "q2" } }), /redeem its own assignment/);
    refused(auditVerdictRefusals({ ...v, verdict: { ...v.verdict, packetSha256: "pb" } }), /redeem its own assignment/);
  });
  it("A3-6 repro: one run reused for a second verdict; an expired lease", () => {
    refused(auditVerdictRefusals({ ...v, run: { ...v.run, alreadyUsed: true } }), /used once/);
    refused(auditVerdictRefusals({ ...v, lease: { ...v.lease, expiresAtMs: NOW - 1 } }), /still valid/);
  });
  it("H8 / A3-6: an audit seat on someone else's non-audit lease; one task assigned twice; last seat without a second provider; outside-feature seat for an insider", () => {
    const a = {
      quorumRevealed: false,
      slot: 1,
      size: 2,
      ownPayoutAuditLease: true,
      taskAlreadyAssigned: false,
      lastSeatWithoutSecondProvider: false,
      outsideFeature: true,
      reviewerHasReceiptsOnFeature: false,
    };
    expect(auditAssignmentRefusals(a)).toEqual([]);
    refused(auditAssignmentRefusals({ ...a, ownPayoutAuditLease: false }), /own payout_audit/);
    refused(auditAssignmentRefusals({ ...a, taskAlreadyAssigned: true }), /assigned once/);
    refused(auditAssignmentRefusals({ ...a, lastSeatWithoutSecondProvider: true }), /second provider/);
    refused(auditAssignmentRefusals({ ...a, reviewerHasReceiptsOnFeature: true }), /outside-feature/);
  });
});

// ------------------------------------------------------------------------------------------------ disputes
describe("disputes (H10, D43, A3-3, repro E) — moved from 0007 dispute triggers", () => {
  const item = { allocationAccountId: "alice", allocationBeneficiaryId: "alice", allocationEpoch: 3, alreadyResolved: false };
  const open = {
    epochState: "PROPOSED",
    nowMs: NOW,
    proposedAtMs: NOW - H,
    challengeHours: 48,
    disputerPendingBase: 300_000_000n,
    disputerStakesAlreadyBase: 0n,
    disputesAlready: 0,
    maxDisputes: 3,
    items: [item],
    disputerAccountId: "bob",
    epochNumber: 3,
    maxItems: 25,
    stakeBase: 6_000_000n,
    expectedStakeBase: 6_000_000n,
  };
  it("baseline: a valid dispute passes", () => expect(disputeOpenRefusals(open)).toEqual([]));
  it("repro E: a zero-stake dispute; an empty bundle; a non-participant; one's own allocation; joining a resolved allocation", () => {
    refused(disputeOpenRefusals({ ...open, stakeBase: 0n }), /stake must equal/);
    refused(disputeOpenRefusals({ ...open, items: [] }), /1\.\.25 items/);
    refused(disputeOpenRefusals({ ...open, disputerPendingBase: 0n }), /only participants/);
    refused(disputeOpenRefusals({ ...open, items: [{ ...item, allocationAccountId: "bob" }] }), /own allocation/);
    refused(disputeOpenRefusals({ ...open, items: [{ ...item, alreadyResolved: true }] }), /already resolved/);
  });
  it("A3-3 repro: a second dispute staking the same 1 WOS of pending allocation", () =>
    refused(
      disputeOpenRefusals({
        ...open,
        disputerPendingBase: 1_000_000n,
        disputerStakesAlreadyBase: 1_000_000n,
        stakeBase: 1_000_000n,
        expectedStakeBase: 1_000_000n,
      }),
      /exceed your pending/,
    ));
  it("H10: a dispute outside the challenge window", () =>
    refused(disputeOpenRefusals({ ...open, proposedAtMs: NOW - 49 * H }), /window is open/));
  it("replies and appeals: only the accused replies, in the window; only accused or priority disputer appeals, in the window", () => {
    refused(disputeReplyRefusals({ replierIsAccused: false, nowMs: NOW, replyDeadlineAtMs: NOW + H }), /only the accused/);
    refused(disputeReplyRefusals({ replierIsAccused: true, nowMs: NOW + 2 * H, replyDeadlineAtMs: NOW + H }), /window has closed/);
    refused(
      disputeAppealRefusals({ appellantIsAccusedOrPriorityDisputer: false, nowMs: NOW, resolvedAtMs: NOW, appealHours: 72 }),
      /accused or the priority/,
    );
  });
  it("resolution amounts must add up and wait for the reply", () => {
    refused(
      resolutionRefusals({
        resultingAmount: 500n,
        excess: 100n,
        proposedAmount: 900n,
        nowMs: NOW,
        replyDeadlineAtMs: NOW - 1,
        replied: false,
      }),
      /must equal/,
    );
    refused(
      resolutionRefusals({
        resultingAmount: 600n,
        excess: 300n,
        proposedAmount: 900n,
        nowMs: NOW,
        replyDeadlineAtMs: NOW + H,
        replied: false,
      }),
      /after the reply/,
    );
  });
  it("A3-3: a 'confirmed' appeal that changes the amount", () =>
    refused(
      appealDecisionRefusals({ decision: "confirmed", finalAmount: 700n, resultingAmount: 600n, proposedAmount: 900n }),
      /confirmed appeal keeps/,
    ));
  const adj = (o: Partial<Parameters<typeof allocationAdjudication>[0]>) =>
    allocationAdjudication({
      proposedAmount: 100n,
      gated: true,
      resolution: { resultingAmount: 60n, resolvedAtMs: NOW - H },
      appealFiled: false,
      appealDecision: null,
      appealHours: 72,
      nowMs: NOW,
      ...o,
    });
  it("A3-3 repro: settling before the appeal window closed; settling while an appeal is pending", () => {
    const d = disputeSettlementDerived({
      items: [{ proposedAmount: 100n, adjudication: adj({}), stakeBase: 1n, recoveredBase: 40n, heldPriority: true }],
      bountyBpOfRecovered: 2000,
    });
    refused(d.refusals, /finally adjudicated/);
    refused(
      disputeSettlementDerived({
        items: [
          {
            proposedAmount: 100n,
            adjudication: adj({ appealFiled: true, nowMs: NOW + 100 * H }),
            stakeBase: 1n,
            recoveredBase: 40n,
            heldPriority: true,
          },
        ],
        bountyBpOfRecovered: 2000,
      }).refusals,
      /finally adjudicated/,
    );
  });
  it("A3-3 repro: a settlement paying a bounty on excess the appeal reversed (derived: 0 excess, stake forfeited)", () => {
    const d = disputeSettlementDerived({
      items: [
        {
          proposedAmount: 100n,
          adjudication: adj({ appealFiled: true, appealDecision: { finalAmount: 100n } }),
          stakeBase: 1_000_000n,
          recoveredBase: 40n,
          heldPriority: true,
        },
      ],
      bountyBpOfRecovered: 2000,
    });
    expect(d).toMatchObject({ refusals: [], excess: 0n, recovered: 0n, forfeited: 1_000_000n, maxBounty: 0n });
  });
  it("D41: a bounty above 20% of what was recovered; excess the dispute does not hold priority on", () => {
    const final = adj({ nowMs: NOW + 100 * H });
    const d = disputeSettlementDerived({
      items: [{ proposedAmount: 100n, adjudication: final, stakeBase: 1n, recoveredBase: 40n, heldPriority: true }],
      bountyBpOfRecovered: 2000,
    });
    expect(d.maxBounty).toBe(8n);
    expect(
      disputeSettlementDerived({
        items: [{ proposedAmount: 100n, adjudication: final, stakeBase: 1n, recoveredBase: 40n, heldPriority: false }],
        bountyBpOfRecovered: 2000,
      }).excess,
    ).toBe(0n);
  });
});

// ------------------------------------------------------------------------------------------------ entitlements, claims
describe("entitlements and claims (H2, A3-1, A3-2) — moved from 0007 check_entitlement / check_entitlement_claim", () => {
  const e = {
    epochState: "FINALIZED",
    kind: "release_now",
    sourceKind: "allocation",
    sameEpochModeBeneficiary: true,
    adjudication: { finalAmount: 300n, isFinal: true },
    heldOnSource: 0n,
    entitledFromSource: 0n,
    releaseFromSource: 0n,
    amount: 150n,
    holdbackBp: 2000,
    epochNumber: 3,
    reservedStakeBase: 0n,
    contributorAvailableBase: 300n,
    contributorEntitledBase: 0n,
  };
  it("baseline: a release within the holdback share passes", () => expect(entitlementRefusals(e)).toEqual([]));
  it("H2: an entitlement before FINALIZED", () => refused(entitlementRefusals({ ...e, epochState: "PROPOSED" }), /FINALIZED/));
  it("A3-1: a release that dips into the holdback share; entitling more than the allocation holds", () => {
    refused(entitlementRefusals({ ...e, amount: 241n }), /holdback/);
    refused(entitlementRefusals({ ...e, entitledFromSource: 300n, amount: 1n }), /remaining balance/);
  });
  it("A3-1: an entitlement naming someone else's allocation; a non-final allocation", () => {
    refused(entitlementRefusals({ ...e, sameEpochModeBeneficiary: false }), /own epoch/);
    refused(entitlementRefusals({ ...e, adjudication: { finalAmount: null, isFinal: false } }), /not final/);
  });
  it("A3-1 repro: a tranche matured in its own epoch; A3-4 repro: maturing the full tranche although part is held", () => {
    refused(
      entitlementRefusals({ ...e, kind: "holdback_matured", sourceKind: "tranche", tranche: { maturesEpoch: 9, remaining: 150n } }),
      /matures in epoch 9/,
    );
    refused(
      entitlementRefusals({
        ...e,
        kind: "holdback_matured",
        sourceKind: "tranche",
        epochNumber: 9,
        amount: 300n,
        tranche: { maturesEpoch: 9, remaining: 290n },
      }),
      /remaining unheld balance/,
    );
  });
  it("A3-1: a bounty entitlement to someone other than the disputer; Genesis vesting outside Genesis finalization", () => {
    refused(
      entitlementRefusals({
        ...e,
        kind: "bounty",
        sourceKind: "dispute_settlement",
        bounty: { toDisputer: false, bountyBase: 60n, alreadyBase: 0n },
      }),
      /to its disputer/,
    );
    refused(entitlementRefusals({ ...e, kind: "genesis_vesting", sourceKind: "genesis" }), /Genesis/);
  });
  it("A3-3: entitling the part of an allocation reserved as dispute stake", () =>
    refused(
      entitlementRefusals({ ...e, reservedStakeBase: 2n, contributorAvailableBase: 50n, contributorEntitledBase: 25n, amount: 25n }),
      /reserved as dispute stake/,
    ));
  const c = {
    entitlementKind: "release_now",
    sameBeneficiary: true,
    entitlementCluster: "devnet",
    leafCluster: "devnet",
    leafFrozen: false,
    remaining: 150n,
    amount: 150n,
  };
  it("baseline: a claim of the whole remaining balance passes", () => expect(claimRefusals(c)).toEqual([]));
  it("D40 / A3-1 / A3-2: claiming a tranche; a mainnet leaf; another domain; a frozen leaf; less than the remaining", () => {
    refused(claimRefusals({ ...c, entitlementKind: "holdback_tranche" }), /matured release/);
    refused(claimRefusals({ ...c, leafCluster: "mainnet-beta" }), /mainnet/);
    refused(claimRefusals({ ...c, entitlementCluster: "mainnet-beta" }), /settlement domains/);
    refused(claimRefusals({ ...c, leafFrozen: true }), /frozen/);
    refused(claimRefusals({ ...c, amount: 149n }), /whole remaining/);
  });
});

// ------------------------------------------------------------------------------------------------ confiscation
describe("confiscation due process (D39, A3-4) — moved from 0007 confiscation triggers", () => {
  it("D39: confiscation without the reply and appeal windows", () => {
    refused(
      confiscationNoticeRefusals({ nowMs: NOW, replyClosesAtMs: NOW + H, appealClosesAtMs: NOW + 2 * H, holdExpiresAtMs: NOW + 3 * H }),
      /72 h reply/,
    );
    expect(
      confiscationNoticeRefusals({
        nowMs: NOW,
        replyClosesAtMs: NOW + 73 * H,
        appealClosesAtMs: NOW + 242 * H,
        holdExpiresAtMs: NOW + 256 * H,
      }),
    ).toEqual([]);
  });
  it("A3-4 repro: an immediate 'upheld' decision with no appeal filed; an unrelated action; before the reply window", () => {
    refused(
      confiscationDecisionRefusals({ appealFiled: false, nowMs: NOW + 100 * H, replyClosesAtMs: NOW, authorizationRefusals: [] }),
      /no appeal was filed/,
    );
    refused(
      confiscationDecisionRefusals({
        appealFiled: true,
        nowMs: NOW + 100 * H,
        replyClosesAtMs: NOW,
        authorizationRefusals: ["admin action does not authorize"],
      }),
      /does not authorize/,
    );
    refused(
      confiscationDecisionRefusals({ appealFiled: true, nowMs: NOW, replyClosesAtMs: NOW + H, authorizationRefusals: [] }),
      /after the reply window/,
    );
  });
  it("A3-4: an appeal by someone else / after its window", () => {
    refused(
      confiscationAppealRefusals({ appellantIsAffectedBeneficiary: false, nowMs: NOW, appealClosesAtMs: NOW + H }),
      /affected beneficiary/,
    );
    refused(
      confiscationAppealRefusals({ appellantIsAffectedBeneficiary: true, nowMs: NOW + 2 * H, appealClosesAtMs: NOW + H }),
      /window has closed/,
    );
  });
  it("A3-4: executing while the appeal is open; after the hold lapsed; when overturned", () => {
    const x = { nowMs: NOW, appealClosesAtMs: NOW + H, holdExpiresAtMs: NOW + 400 * H, appealFiled: false, decision: null };
    refused(confiscationExecutionRefusals(x), /executes only after/);
    expect(confiscationExecutionRefusals({ ...x, nowMs: NOW + 2 * H })).toEqual([]);
    refused(confiscationExecutionRefusals({ ...x, nowMs: NOW + 500 * H }), /executes only after/);
    refused(confiscationExecutionRefusals({ ...x, decision: "overturned", appealFiled: true, nowMs: NOW + 2 * H }), /executes only after/);
  });
  it("A3-4: holding a released or claimed source, the wrong kind, or beyond remaining; an overturned confiscation", () => {
    const h = {
      holdActive: true,
      executed: false,
      alreadyHeldBase: 0n,
      amount: 10n,
      provenExcessBase: 200n,
      sourceBeneficiaryMatches: true,
      sourceRemaining: 150n,
      sourceKindFits: true,
    };
    expect(confiscationHoldRefusals(h)).toEqual([]);
    refused(confiscationHoldRefusals({ ...h, sourceRemaining: 0n }), /enough remaining/);
    refused(confiscationHoldRefusals({ ...h, holdActive: false }), /overturned, lapsed/);
  });
});

// ------------------------------------------------------------------------------------------------ policy, votes, wallets, pools, Genesis, off-ramp
describe("policy, governance, wallets, pools, Genesis, off-ramp — moved from 0007", () => {
  it("repro F / H6: an ordinary policy change on a published epoch with a backdated announcement; an emergency change on published allocations", () => {
    refused(
      activationRefusals(
        { effectiveEpoch: 3, emergency: false, announcedAtMs: NOW, previewSha256: "p" },
        { openEpoch: 3, openEpochState: "PROPOSED", epochStartsAtMs: NOW + ACTIVATION_RULES.minNoticeHours * H },
      ),
      /next epoch/,
    );
    refused(
      activationRefusals(
        { effectiveEpoch: 3, emergency: true, announcedAtMs: NOW, previewSha256: null },
        { openEpoch: 3, openEpochState: "PROPOSED", epochStartsAtMs: NOW },
      ),
      /unpublished/,
    );
  });
  it("H6: a vote in a closed window (times are server-stamped by the DB); a vote without snapshot weight", () => {
    refused(voteRefusals({ nowMs: NOW, opensAtMs: NOW - 9 * 24 * H, closesAtMs: NOW - 2 * 24 * H, hasSnapshotWeight: true }), /closed/);
    refused(voteRefusals({ nowMs: NOW, opensAtMs: NOW - H, closesAtMs: NOW + H, hasSnapshotWeight: false }), /no weight/);
  });
  it("review-02 M17: a wallet bound before the disclosure; H9: an organization wallet bound by a non-admin", () => {
    refused(walletBindingRefusals({ consentAccepted: false, messageNamesAll: true, orgBindingByOwnerOrAdmin: null }), /disclosure/);
    refused(walletBindingRefusals({ consentAccepted: true, messageNamesAll: true, orgBindingByOwnerOrAdmin: false }), /owner or admin/);
  });
  it("H13: paying a pool that never became payable", () => refused(poolEventRefusals({ event: "paid", alreadyPayable: false }), /payable/));
  it("A3-12 repro: a reference-population member added later as a Genesis beneficiary; commit evidence without its mapping; live work claimed as Genesis", () => {
    refused(
      genesisContributionRefusals({
        relatedToReferencePopulation: true,
        commitShasInEvidence: [],
        claimedCommitShas: [],
        evidenceKind: "retro_abu",
      }),
      /reference population/,
    );
    refused(
      genesisContributionRefusals({
        relatedToReferencePopulation: false,
        commitShasInEvidence: ["2".repeat(40)],
        claimedCommitShas: [],
        evidenceKind: "git_commit",
      }),
      /canonical commit mapping/,
    );
    refused(genesisCommitClaimRefusals({ isMergedLiveAttempt: true }), /live work/);
  });
  it("M16 / A3-12: a related party or an unadmitted receipt in the reference manifest", () => {
    const rec = { exists: true, status: "ACTIVE", admittedEpoch: 2, relatedToGenesisBeneficiary: false };
    expect(genesisReferenceManifestRefusals({ receipts: [rec], cutoffEpoch: 2, approvalRefusals: [] })).toEqual([]);
    refused(
      genesisReferenceManifestRefusals({ receipts: [{ ...rec, relatedToGenesisBeneficiary: true }], cutoffEpoch: 2, approvalRefusals: [] }),
      /reference population/,
    );
    refused(genesisReferenceManifestRefusals({ receipts: [{ ...rec, admittedEpoch: 3 }], cutoffEpoch: 2, approvalRefusals: [] }), /cutoff/);
  });
  it("D46: resuming settlement without a safety confirmation (also a CHECK in 0007)", () =>
    refused(settlementResumeRefusals({ safetyConfirmation: null }), /safety confirmation/));
});

describe("further write rules moved from 0007 v4 (no guarantee silently dropped)", () => {
  it("repro C / H2: allocating a receipt to someone else's beneficiary, twice, outside the manifest", () => {
    const x = {
      receiptSlice: "planning",
      receiptAccountId: "bob",
      allowedBeneficiaries: ["bob"],
      line: { slice: "planning", accountId: "bob", beneficiaryId: "bob" },
      manifestIncluded: true,
      modeMatchesEpoch: true,
    };
    expect(allocationLineRefusals(x)).toEqual([]);
    refused(
      allocationLineRefusals({ ...x, line: { slice: "execution", accountId: "alice", beneficiaryId: "alice" } }),
      /slice, contributor and beneficiary/,
    );
    refused(allocationLineRefusals({ ...x, manifestIncluded: false }), /manifest/);
  });
  it("H2 / A3-1: manifest admission of a revoked, provisional-in-live, or other-domain receipt", () => {
    const m = { status: "ACTIVE", epochMode: "live" as const, entryMode: "live", sameCluster: true, mainnet: false };
    expect(manifestEntryRefusals(m)).toEqual([]);
    refused(manifestEntryRefusals({ ...m, status: "PROVISIONAL" }), /cannot be included/);
    refused(manifestEntryRefusals({ ...m, sameCluster: false }), /settlement domain/);
  });
  it("H8 / D44: a sponsorship approved by a non-admin, by a personal org, or a second active link", () => {
    expect(sponsorshipRefusals({ approverIsOwnerOrAdmin: true, organizationIsPersonal: false, contributorHasActiveLink: false })).toEqual(
      [],
    );
    refused(
      sponsorshipRefusals({ approverIsOwnerOrAdmin: false, organizationIsPersonal: false, contributorHasActiveLink: false }),
      /owner or admin/,
    );
    refused(
      sponsorshipRefusals({ approverIsOwnerOrAdmin: true, organizationIsPersonal: false, contributorHasActiveLink: true }),
      /one active/,
    );
  });
  it("H7 telemetry: a usage receipt from a stale lease generation, another lease's run, without its snapshot, or a replayed response id", () => {
    const u = {
      leaseGenerationMatches: true,
      leaseAccountMatches: true,
      signedRunOfLease: true,
      citesLeaseSnapshot: true,
      responseIdSeenBefore: false,
    };
    expect(usageReceiptRefusals(u)).toEqual([]);
    refused(usageReceiptRefusals({ ...u, leaseGenerationMatches: false }), /generation/);
    refused(usageReceiptRefusals({ ...u, responseIdSeenBefore: true }), /replayed/);
  });
  it("D27 / H11 / M14 / D39 / D35 / M16: clips, audit outcomes, duty, permanent exclusion, adapter switches, Genesis keys", () => {
    refused(clipRefusals({ newWeightMicro: 2n, currentWeightMicro: 1n, authorizationRefusals: [] }), /never raises/);
    refused(auditOutcomePublishRefusals({ quorumRevealed: true, isCanary: true, sameReceiptAndOutcome: true }), /real quorum/);
    refused(dutyEventRefusals({ seq: 2, offeredToSameAccount: false, kind: "completed", hasDeadline: false }), /offered to/);
    refused(
      exclusionRefusals({ permanent: true, governanceDecision: false, bootstrapMode: false, authorizationRefusals: [] }),
      /governance decision/,
    );
    refused(
      adapterEventRefusals({ action: "activate", firstEvent: false, governanceDecision: false, authorizationRefusals: [] }),
      /governance decision/,
    );
    refused(genesisDedupRefusals({ dedupSource: "receipt", authorizationRefusals: [] }), /genesis dedup key/);
  });
});

describe("candidate models (D52: GLM via Z.ai)", () => {
  it("a candidate model is refused at claim until qualified; qualified models pass; GLM has no role and targets BUILD_L1-L2", () => {
    const glm = CAPABILITY_POLICY_V1.candidates.find((c) => c.key === "glm")!;
    expect(glm).toMatchObject({ provider: "zai", status: "candidate", allowedRoles: [] });
    expect(glm.targetClasses).toEqual(["BUILD_L1", "BUILD_L2"]);
    expect(glm.launchPaths.every((l) => l.identity === "self_reported")).toBe(true);
    refused(
      modelClaimRefusals(CAPABILITY_POLICY_V1, { provider: "claude_cli", modelId: "glm-5.1", requiredClass: "BUILD_L3", role: "builder" }),
      /candidate model/,
    );
    refused(
      modelClaimRefusals(CAPABILITY_POLICY_V1, {
        provider: "zai",
        modelId: "glm-5.1",
        requiredClass: "REVIEW_A",
        role: "implementation_reviewer_astra",
      }),
      /candidate model/,
    );
    expect(
      modelClaimRefusals(CAPABILITY_POLICY_V1, { provider: "codex_cli", modelId: "gpt-6-sol", requiredClass: "BUILD_L3", role: "builder" }),
    ).toEqual([]);
    const suite = CAPABILITY_POLICY_V1.qualificationSuites.find(
      (s) => s.suiteVersion === glm.qualificationSuite && s.targetClass === "BUILD_L1",
    )!;
    expect(suite).toMatchObject({ mode: "devnet_shadow", recordedPer: "model_version", affectsBudgets: false, unitsManifestSha256: null });
  });
});

// ------------------------------------------------------------------------------------------------ Astra reviews 04 and 05
describe("Astra reviews 04 and 05: rule regressions (docs/protocol/reviews/ASTRA-REVIEW-04-05-repros-prefix.txt)", () => {
  const modelPolicy = {
    capabilityBudgets: CAPABILITY_POLICY_V1.budgets,
    model: REWARD_POLICY_V1.budgets.model,
    humanReviewWeights: REWARD_POLICY_V1.humanReview.weightAcuEqMicro,
  };
  const basis = { taskKind: "abu_build", sizePoints: 2, difficultyBp: 10_000, importanceBp: 10_000 };
  it("B1: the budget model is computed from pinned data and the basis (2-point build = 8 ACU), bounds enforced", () => {
    expect(budgetModelMicro(modelPolicy, basis)).toEqual({ modelMicro: 8_000_000n });
    expect(budgetModelMicro(modelPolicy, { ...basis, difficultyBp: 20_000, importanceBp: 15_000 })).toEqual({ modelMicro: 24_000_000n });
    expect(budgetModelMicro(modelPolicy, { ...basis, difficultyBp: 40_000 })).toHaveProperty("refusal");
    expect(
      budgetModelMicro(modelPolicy, {
        taskKind: "human_review",
        sizePoints: 0,
        difficultyBp: 10_000,
        importanceBp: 10_000,
        riskClass: "security",
      }),
    ).toEqual({
      modelMicro: 2_000_000n,
    });
    expect(budgetModelMicro(modelPolicy, { ...basis, taskKind: "unknown" })).toHaveProperty("refusal");
  });
  const b = {
    budgetMicro: 800_000_000n,
    modelMicro: 800_000_000n,
    computedModel: budgetModelMicro(modelPolicy, basis),
    objectiveConsensus: { revealed: true, outcome: "consensus", coversBudget: true },
    humanAboveBp: 12_500,
    hardMaxBp: 20_000,
    justification: "",
    approvalRefusals: null,
    objectiveBudgetMicro: 10_000_000_000n,
    objectiveUsedMicro: 0n,
    epochOpenWithRate: true,
    cluster: "devnet" as const,
  };
  it("B1 repro: a budget bounded against a caller-supplied model 100x the policy model is refused", () =>
    refused(budgetRefusals(b), /differs from the model computed/));
  it("B1: an objective without its revealed consensus round over scope and total budget is refused", () =>
    refused(budgetRefusals({ ...b, budgetMicro: 8_000_000n, modelMicro: 8_000_000n, objectiveConsensus: null }), /consensus round/));
  it("B2 repro: a 50/50 task allocated 100/0 is refused; the derived split passes, sponsorship split included", () => {
    const receipts = [
      { receiptId: "a", accountId: "alice", shareBp: 5000, orgShareBp: 0 },
      { receiptId: "b", accountId: "bob", shareBp: 5000, orgShareBp: 8000 },
    ];
    refused(
      taskAllocationRefusals({
        reservedBase: 100n,
        receipts,
        lines: [
          { receiptId: "a", beneficiary: "person", amount: 100n },
          { receiptId: "b", beneficiary: "person", amount: 0n },
        ],
      }),
      /declared shares give 50/,
    );
    expect(
      taskAllocationRefusals({
        reservedBase: 100n,
        receipts,
        lines: [
          { receiptId: "a", beneficiary: "person", amount: 50n },
          { receiptId: "b", beneficiary: "person", amount: 10n },
          { receiptId: "b", beneficiary: "organization", amount: 40n },
        ],
      }),
    ).toEqual([]);
    refused(
      taskAllocationRefusals({
        reservedBase: 100n,
        receipts,
        lines: [
          { receiptId: "a", beneficiary: "person", amount: 50n },
          { receiptId: "b", beneficiary: "person", amount: 50n },
        ],
      }),
      /b\/person/,
    );
  });
  it("B4: one expiry rule in the receipt rule — admitted at expiresEpoch - 1, refused AT it; grace after an on-time submission", () => {
    const ok = {
      consentAccepted: true,
      epochState: "OPEN",
      cluster: "devnet" as const,
      contributionType: "APPLICATION_ROADMAP",
      subjectKind: "document",
      attemptMerged: false,
      qualificationOk: true,
      needsQualification: true,
      evidenceClass: "accepted_budget" as const,
      weightMicro: 3_000_000n,
      budget: {
        amountMicro: 3_000_000n,
        kind: "planning",
        released: false,
        expiresEpoch: 6,
        submittedEpoch: null as number | null,
        reviewGraceEpochs: 2,
      },
      slice: "planning",
      admittedEpoch: 5,
      shareBp: 10_000,
      sharesAlreadyDeclaredBp: 0,
    };
    expect(receiptRefusals(ok)).toEqual([]);
    refused(receiptRefusals({ ...ok, admittedEpoch: 6 }), /released or expired/);
    expect(receiptRefusals({ ...ok, admittedEpoch: 7, budget: { ...ok.budget, submittedEpoch: 5 } })).toEqual([]);
    refused(receiptRefusals({ ...ok, admittedEpoch: 8, budget: { ...ok.budget, submittedEpoch: 5 } }), /released or expired/);
  });
  it("B4 repro: releasing as expired before expiry, cancelling active work without authority, releasing accepted work", () => {
    const r = {
      reason: "expired" as const,
      epochNumber: 2,
      expiresEpoch: 6,
      submittedEpoch: null,
      reviewGraceEpochs: 2,
      accepted: false,
      activeLease: false,
      authorizationRefusals: null,
      taskTerminal: true,
      finalRejectionOfSubmission: false,
    };
    refused(budgetReleaseRefusals(r), /live until epoch 6/);
    expect(budgetReleaseRefusals({ ...r, epochNumber: 6 })).toEqual([]);
    refused(budgetReleaseRefusals({ ...r, reason: "cancelled", activeLease: true }), /authorized admin action/);
    expect(budgetReleaseRefusals({ ...r, reason: "cancelled", activeLease: true, authorizationRefusals: [] })).toEqual([]);
    refused(budgetReleaseRefusals({ ...r, reason: "failed", activeLease: true }), /active lease/);
    refused(budgetReleaseRefusals({ ...r, epochNumber: 9, accepted: true }), /never released/);
    refused(leaseBudgetRefusals({ rewardBearing: true, budget: null, epochNumber: 2 }), /funded task budget/);
    refused(leaseBudgetRefusals({ rewardBearing: true, budget: { released: false, expiresEpoch: 6 }, epochNumber: 6 }), /expired/);
  });
  it("B3: the epoch row must pin the envelope the engine computes from the persisted snapshot and forecast", () => {
    const params = engineParamsFrom(REWARD_POLICY_V1, COMPLETION_POLICY_V1);
    const env = openEpoch(initialState(params.emissionReserve), 1, 5_000_000_000n, params);
    const pinned = {
      rateBasePerAcu: env.rate,
      taskCapacityBase: env.taskCapacity,
      reserveSnapshot: env.reserveSnapshot,
      demandForecastAcuMicro: 5_000_000_000n,
    };
    expect(epochEnvelopeRefusals(pinned, env)).toEqual([]);
    refused(epochEnvelopeRefusals({ ...pinned, taskCapacityBase: env.taskCapacity + 1n }, env), /differ from the engine/);
    refused(epochEnvelopeRefusals({ ...pinned, demandForecastAcuMicro: 1n }, env), /demand forecast/);
  });
  const acceptance = REWARD_POLICY_V1.acceptance;
  const hr = { reviewerAccountId: "d", assignmentTaskId: "t6", assignmentReviewerAccountId: "d", sealed: true };
  const route = {
    acceptance,
    contributionType: "HUMAN_REVIEW",
    slice: "human_review",
    evidenceClass: "accepted_budget" as const,
    taskKind: "human_review",
    hasLease: false,
    receiptAccountId: "d",
    taskId: "t6",
    humanReview: hr as typeof hr | null,
  };
  it("B6 repro: a HUMAN_REVIEW receipt with no human review under its assignment is refused; with one it passes", () => {
    expect(receiptRouteRefusals(route)).toEqual([]);
    refused(receiptRouteRefusals({ ...route, humanReview: null }), /sealed human review/);
    refused(receiptRouteRefusals({ ...route, humanReview: { ...hr, assignmentTaskId: "other" } }), /assignment/);
  });
  it("B6: a type without an acceptance route, an outcome paid from a budget, a commissioned type without its lease", () => {
    refused(receiptRouteRefusals({ ...route, contributionType: "DOCUMENTATION", humanReview: null }), /no acceptance route/);
    refused(
      receiptRouteRefusals({ ...route, contributionType: "PROPOSAL", slice: "outcomes", humanReview: null }),
      /never paid from a task budget/,
    );
    refused(
      receiptRouteRefusals({ ...route, contributionType: "IMPLEMENTATION", slice: "execution", taskKind: "execution", humanReview: null }),
      /needs the lease/,
    );
  });
  it("R04-6: a stored snapshot without humanReviewRequired fails closed; the typed field decides", () => {
    expect(snapshotHumanRequirement(snapshot(true))).toEqual({ required: true, riskClass: "standard" });
    const { humanReviewRequired: _drop, ...missing } = snapshot(false);
    expect(snapshotHumanRequirement(missing)).toBeNull();
  });
  it("R04-2: a tranche matures in parts around a lifted hold — the unheld part now, the restored part later", () => {
    const e = {
      epochState: "FINALIZED",
      kind: "holdback_matured",
      sourceKind: "tranche",
      sameEpochModeBeneficiary: true,
      adjudication: null,
      entitledFromSource: 0n,
      releaseFromSource: 0n,
      holdbackBp: 2000,
      epochNumber: 9,
      reservedStakeBase: 0n,
      contributorAvailableBase: 0n,
      contributorEntitledBase: 0n,
    };
    expect(entitlementRefusals({ ...e, heldOnSource: 10n, amount: 90n, tranche: { maturesEpoch: 9, remaining: 100n } })).toEqual([]);
    refused(entitlementRefusals({ ...e, heldOnSource: 10n, amount: 100n, tranche: { maturesEpoch: 9, remaining: 100n } }), /unheld/);
    expect(entitlementRefusals({ ...e, heldOnSource: 0n, amount: 10n, tranche: { maturesEpoch: 9, remaining: 10n } })).toEqual([]);
  });
  it("R04-4: a hold is bounded from notice (ten-year appeal, infinite hold, lapse before the appeal closes)", () => {
    const n = { nowMs: NOW, replyClosesAtMs: NOW + 73 * H, appealClosesAtMs: NOW + 242 * H, holdExpiresAtMs: NOW + 256 * H };
    refused(
      confiscationNoticeRefusals({ ...n, appealClosesAtMs: NOW + 10 * 365 * 24 * H, holdExpiresAtMs: NOW + 10 * 365 * 24 * H + H }),
      /bounded/,
    );
    refused(confiscationNoticeRefusals({ ...n, holdExpiresAtMs: Number.POSITIVE_INFINITY }), /bounded/);
    refused(confiscationNoticeRefusals({ ...n, holdExpiresAtMs: NOW + 100 * H }), /bounded/);
  });
  it("R04-8 repro: expiry over an observation of a finalized transaction, or over {}, is refused; the typed forms pass", () => {
    const attempt = { signature: "sig", cluster: "devnet", lastValidBlockHeight: 100 };
    const notFound = { signature: "sig", cluster: "devnet", searchTransactionHistory: true, observedBlockHeight: 101, value: [null] };
    expect(settlementObservationRefusals({ outcome: "expired_not_landed", attempt, observation: notFound })).toEqual([]);
    refused(
      settlementObservationRefusals({
        outcome: "expired_not_landed",
        attempt,
        observation: { ...notFound, value: [{ confirmationStatus: "finalized", err: null, slot: 5 }] },
      }),
      /it landed/,
    );
    refused(settlementObservationRefusals({ outcome: "expired_not_landed", attempt, observation: {} }), /not a status response/);
    refused(
      settlementObservationRefusals({ outcome: "expired_not_landed", attempt, observation: { ...notFound, signature: "other" } }),
      /another signature/,
    );
    const fin = { ...notFound, value: [{ confirmationStatus: "finalized", err: null, slot: 5 }] };
    expect(settlementObservationRefusals({ outcome: "confirmed", attempt, observation: fin })).toEqual([]);
    refused(
      settlementObservationRefusals({
        outcome: "confirmed",
        attempt,
        observation: { ...fin, value: [{ confirmationStatus: "finalized", err: { InstructionError: [0, "x"] }, slot: 5 }] },
      }),
      /without error/,
    );
  });
  it("R04-9 repro: a grant approved for low-risk review cannot grant protocol review; every consumer has its canonical fields", () => {
    const a = {
      id: "g",
      action: "authorize_reviewer",
      targetKind: "account",
      targetId: "b",
      payload: { accountId: "b", riskClasses: ["low_risk"] } as Record<string, unknown>,
      requiresCoSigner: false,
      coSignerAccountId: null,
      operationSha256: "s",
    };
    const op = {
      accountId: "b",
      action: "grant",
      domains: ["general"],
      level: 2,
      contributionTypes: ["IMPLEMENTATION"],
      riskClasses: ["protocol"],
    };
    const need = {
      kinds: ["authorize_reviewer"],
      targetKind: "account",
      targetId: "b",
      consumer: "reviewer_grant" as const,
      operation: op,
    };
    const ctx = { approval: null, alreadyUsed: false };
    refused(adminAuthorizationRefusals(a, need, ctx), /omits/);
    refused(adminAuthorizationRefusals({ ...a, payload: { ...op, riskClasses: ["low_risk"] } }, need, ctx), /another operation/);
    expect(adminAuthorizationRefusals({ ...a, payload: op }, need, ctx)).toEqual([]);
    refused(adminAuthorizationRefusals({ ...a, payload: op }, { ...need, operation: { accountId: "b" } }, ctx), /must name/);
    expect(canonicalOperationFields("epoch_transition")).toContain("toState");
    expect(canonicalOperationFields("confiscation")).toEqual(expect.arrayContaining(["holdExpiresAt", "beneficiaryKind"]));
    expect(canonicalOperationFields("dispute_resolution")).toContain("recoveredBase");
    expect(canonicalOperationFields("adapter_event")).toEqual(expect.arrayContaining(["expiresAt", "config"]));
  });
  it("R04-11 repro: an asserted hash, a duplicate id or a test receipt in a Genesis manifest is refused", () => {
    const manifest = { version: "reference.v2", cutoffEpoch: 2, rules: { types: ["PROPOSAL"] }, receiptIds: ["r1"] };
    const rc = {
      exists: true,
      status: "ACTIVE",
      admittedEpoch: 1,
      relatedToGenesisBeneficiary: false,
      mode: "live" as const,
      contributionType: "PROPOSAL",
    };
    const ok = { receipts: [rc], cutoffEpoch: 2, approvalRefusals: [], manifest, manifestSha256: genesisReferenceManifestSha256(manifest) };
    expect(genesisReferenceManifestRefusals(ok)).toEqual([]);
    refused(genesisReferenceManifestRefusals({ ...ok, manifestSha256: `sha256:${"b".repeat(64)}` }), /canonical contents/);
    refused(genesisReferenceManifestRefusals({ ...ok, manifest: { ...manifest, receiptIds: ["r1", "r1"] } }), /listed twice/);
    refused(genesisReferenceManifestRefusals({ ...ok, receipts: [{ ...rc, mode: "test" as const }] }), /live receipts only/);
  });
  it("R04-7 (obsolete under D49): receipt admission takes no oracle input — telemetry under a run-pinned oracle never blocks it", () => {
    // The rule's whole input is shown in the baseline above; no field names an oracle (SQL: no oracle comparison either).
    expect(receiptRefusals.toString()).not.toMatch(/oracle/i);
  });
});

describe("D53: Fable unavailable — ReviewPolicy fallback fable_unavailable", () => {
  it("the fallback is policy DATA: Astra plus the required human review; outputs are labelled single_lab_review", () => {
    const fb = REVIEW_POLICY_V1.fallbacks.find((f) => f.key === "fable_unavailable")!;
    expect(fb).toMatchObject({
      replacesSlot: "fable",
      replacementSeat: "human",
      label: "single_lab_review",
      laterFablePass: "optional_never_blocking",
    });
    expect(requiredReviewSeats("fable_unavailable")).toEqual({
      seats: ["astra", "human"],
      labels: [{ label: "single_lab_review", reason: expect.stringMatching(/fable_unavailable/) }],
    });
    expect(requiredReviewSeats("none").seats).toEqual(["astra", "fable"]);
  });
  it("the Fable seat is refused while the fallback is active (an optional later pass is allowed, never counted)", () => {
    refused(
      reviewSeatRefusals({
        activeFallback: "fable_unavailable",
        slot: "fable",
        reviewerModelId: "claude-fable-5-1",
        builderModelId: "claude-opus-5-5",
      }),
      /replaced by the required human review/,
    );
    expect(
      reviewSeatRefusals({
        activeFallback: "fable_unavailable",
        slot: "fable",
        reviewerModelId: "claude-fable-5-1",
        builderModelId: "claude-opus-5-5",
        optionalLaterPass: true,
      }),
    ).toEqual([]);
    expect(
      reviewSeatRefusals({
        activeFallback: "fable_unavailable",
        slot: "astra",
        reviewerModelId: "gpt-6-astra",
        builderModelId: "claude-opus-5-5",
      }),
    ).toEqual([]);
  });
  it("Opus never reviews Opus-built work (same-model self-review), fallback or not", () => {
    for (const activeFallback of ["none", "fable_unavailable"] as const)
      refused(
        reviewSeatRefusals({ activeFallback, slot: "astra", reviewerModelId: "claude-opus-5-5", builderModelId: "claude-opus-5-5" }),
        /same-model self-review/,
      );
  });
  it("switching the review policy is forward-only, AdminAction-bound and public", () => {
    const x = {
      fromVersion: "review-policy.v1",
      toVersion: "review-policy.v2",
      versionsInOrder: ["review-policy.v1", "review-policy.v2"],
      authorizationRefusals: [],
      published: true,
    };
    expect(reviewPolicySwitchRefusals(x)).toEqual([]);
    refused(reviewPolicySwitchRefusals({ ...x, fromVersion: "review-policy.v2", toVersion: "review-policy.v1" }), /forward-only/);
    refused(reviewPolicySwitchRefusals({ ...x, published: false }), /publicly/);
    refused(reviewPolicySwitchRefusals({ ...x, authorizationRefusals: ["no admin action cited"] }), /admin action/);
  });
});

describe("D54: provisional receipts finalize optimistically (review 06 R06-2: from a persisted publication)", () => {
  const pub = { receiptSha256: "sha256:r", bootstrapEndedAtMs: NOW - H, publishedAtMs: NOW, closesAtMs: NOW + 48 * H, notified: true };
  const x = { receiptSha256: "sha256:r", publication: pub, challenged: false, decision: null, nowMs: NOW + 49 * H };
  it("silence after the persisted window finalizes; a challenge goes to the review gate and waits for its one decision", () => {
    expect(provisionalReceiptOutcome(x)).toBe("final_by_silence");
    expect(provisionalReceiptOutcome({ ...x, nowMs: NOW + 47 * H })).toBe("in_challenge_window");
    expect(provisionalReceiptOutcome({ ...x, challenged: true })).toBe("to_review_gate");
    expect(provisionalReceiptOutcome({ ...x, challenged: true, decision: "accepted" })).toBe("ratified");
    expect(provisionalReceiptOutcome({ ...x, challenged: true, decision: "rejected" })).toBe("rejected");
  });
  it("R06-2 repro: a pre-bootstrap or foreign publication cannot start the window; nothing waits before bootstrap ends", () => {
    expect(provisionalReceiptOutcome({ ...x, publication: null })).toBe("provisional");
    expect(provisionalReceiptOutcome({ ...x, publication: { ...pub, publishedAtMs: NOW - 100 * H, closesAtMs: NOW - 52 * H } })).toBe(
      "provisional",
    );
    expect(provisionalReceiptOutcome({ ...x, publication: { ...pub, receiptSha256: "sha256:other" } })).toBe("provisional");
    expect(provisionalReceiptOutcome({ ...x, publication: { ...pub, notified: false } })).toBe("provisional");
    expect(REVIEW_POLICY_V1.ratification).toMatchObject({
      mode: "optimistic_challenge",
      recruitedReviewerPool: false,
      challengeWindowHours: REWARD_POLICY_V1.challenge.windowHours,
      challengeGoesTo: "review_gate",
    });
  });
  it("R06-2: publication after bootstrap with a pinned window; admission and finalization exclude each other", () => {
    const pubOk = {
      status: "PROVISIONAL",
      bootstrapOn: false,
      nowMs: NOW,
      bootstrapEndedAtMs: NOW - H,
      closesAtMs: NOW + 48 * H,
      windowHours: 48,
      notified: true,
      alreadyPublished: false,
    };
    expect(challengePublicationRefusals(pubOk)).toEqual([]);
    refused(challengePublicationRefusals({ ...pubOk, bootstrapOn: true }), /after bootstrap ended/);
    refused(challengePublicationRefusals({ ...pubOk, closesAtMs: NOW + H }), /pinned hours/);
    expect(challengeAdmissionRefusals({ publication: pub, nowMs: NOW + H, finalized: false })).toEqual([]);
    refused(challengeAdmissionRefusals({ publication: pub, nowMs: NOW + 48 * H, finalized: false }), /closed/);
    refused(challengeAdmissionRefusals({ publication: pub, nowMs: NOW + H, finalized: true }), /already final/);
    expect(silenceFinalizationRefusals({ publication: pub, nowMs: NOW + 48 * H, challenged: false, status: "PROVISIONAL" })).toEqual([]);
    refused(
      silenceFinalizationRefusals({ publication: pub, nowMs: NOW + 48 * H, challenged: true, status: "PROVISIONAL" }),
      /review-gate decision/,
    );
    refused(silenceFinalizationRefusals({ publication: pub, nowMs: NOW + H, challenged: false, status: "PROVISIONAL" }), /still open/);
  });
  it("R06-2: the status machine has a real final_by_silence transition, its own evidence class (not a ratification)", () => {
    const t = ReceiptStatusMachine.transitions.find((x) => x.event === "final_by_silence")!;
    expect(t).toMatchObject({ from: "PROVISIONAL", to: "FINAL_BY_SILENCE" });
    expect(receiptCountsIn("live", "FINAL_BY_SILENCE")).toBe(true);
    expect(ReceiptStatusMachine.transitions.some((x) => x.to === "RATIFIED" && x.event === "final_by_silence")).toBe(false);
  });
});

describe("D55: V1-active and dormant modules", () => {
  it("every dormant module has an activation trigger in the reward policy and is refused until activated", () => {
    const listed = REWARD_POLICY_V2.modules.dormant.map((m) => m.module).sort();
    expect(listed).toEqual([...DORMANT_MODULES].sort());
    // v1 (frozen) lists every module but D63's priority_vote, which arrived as a versioned addition.
    expect(REWARD_POLICY_V1.modules.dormant.map((m) => m.module).sort()).toEqual(
      DORMANT_MODULES.filter((m) => m !== "priority_vote").sort(),
    );
    for (const m of REWARD_POLICY_V2.modules.dormant) expect(m.activationTrigger.length).toBeGreaterThan(10);
    refused(moduleRefusals({ module: "dispute_stakes_and_bounties", activated: [] }), /dormant in V1/);
    expect(moduleRefusals({ module: "dispute_stakes_and_bounties", activated: ["dispute_stakes_and_bounties"] })).toEqual([]);
  });
});

describe("D56: build next — assigned mode", () => {
  const cap = CAPABILITY_POLICY_V1;
  const unit = (id: string, over: Partial<Parameters<typeof nextUnitEligibilityRefusals>[2]> = {}) => ({
    unitId: id,
    target: "salesforce",
    requiredClass: "BUILD_L4",
    targetsServed: 1,
    dependentsWaiting: 0,
    issuedEpoch: 5,
    issuedAtMs: NOW,
    budgetAcuMicro: 8_000_000n,
    estimatedMinutes: 60,
    proposerAccountId: "p",
    requiredToolchains: ["node22"],
    budget: { released: false, expiresEpoch: 9 },
    ...over,
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
  };
  const ACC = acceptanceRequirement(REVIEW_POLICY_V1, CAPABILITY_POLICY_V1, "standard");
  it("eligibility is the claim's: qualified model, toolchain, lease slot, not own/related proposal, live budget, limits", () => {
    expect(nextUnitEligibilityRefusals(cap, me, unit("u1"), 6, ACC)).toEqual([]);
    refused(nextUnitEligibilityRefusals(cap, { ...me, modelId: "glm-5.1" }, unit("u1"), 6, ACC), /candidate model/);
    refused(nextUnitEligibilityRefusals(cap, me, unit("u1", { requiredToolchains: ["rust"] }), 6, ACC), /toolchains/);
    refused(nextUnitEligibilityRefusals(cap, { ...me, activeLeasesByProvider: { claude_cli: 1 } }, unit("u1"), 6, ACC), /lease slot/);
    refused(nextUnitEligibilityRefusals(cap, me, unit("u1", { proposerAccountId: "me" }), 6, ACC), /proposed this unit's budget/);
    refused(nextUnitEligibilityRefusals(cap, me, unit("u1", { proposerAccountId: "orgmate" }), 6, ACC), /proposed this unit's budget/);
    refused(nextUnitEligibilityRefusals(cap, me, unit("u1"), 9, ACC), /expired/);
    refused(
      nextUnitEligibilityRefusals(cap, { ...me, remaining: { budgetAcuMicro: 1n, wallTimeMinutes: null } }, unit("u1"), 6, ACC),
      /ACU limit/,
    );
  });
  it("the ranking is deterministic: reuse, unlock, focus and ageing; ties by unit id", () => {
    const p = cap.assignment;
    const ranked = rankNextUnits(
      p,
      [
        unit("b", { targetsServed: 1 }),
        unit("a", { targetsServed: 1 }),
        unit("c", { targetsServed: 3 }),
        unit("d", { dependentsWaiting: 4, target: "hubspot" }),
        unit("e", { issuedEpoch: 1, target: "hubspot" }),
      ],
      6,
    );
    expect(ranked.map((r) => r.unitId)).toEqual(["c", "d", "a", "b", "e"]);
    expect(ranked[0]!.score).toEqual({ reuse: 300, unlock: 0, focus: 200, ageing: 25, total: 525 });
    expect(rankNextUnits(p, [unit("l3", { requiredClass: "BUILD_L3" })], 6)[0]!.score.focus).toBe(250);
    expect(rankNextUnits(p, [unit("e", { issuedEpoch: -100, target: "x" })], 6)[0]!.score.ageing).toBe(
      p.weights.ageingPerEpoch * p.ageingCapEpochs,
    );
    expect(rankNextUnits(p, [unit("b"), unit("a")], 6)).toEqual(rankNextUnits(p, [unit("a"), unit("b")], 6));
  });
  it("the assigned-only window is off by default; continuous mode stops on request or at any limit", () => {
    expect(cap.assignment.assignedOnlyWindowMinutes).toBe(0);
    expect(selfPickRefusals({ issuedAtMs: NOW, nowMs: NOW, assignedOnlyWindowMinutes: 0 })).toEqual([]);
    refused(selfPickRefusals({ issuedAtMs: NOW, nowMs: NOW + 60_000, assignedOnlyWindowMinutes: 10 }), /assigned mode only/);
    const used = { units: 2, wallTimeMinutes: 90, budgetAcuMicro: 16_000_000n, unitsByProvider: { claude_cli: 2 } };
    expect(continuousNextStop({ stopRequested: false, limits: {}, used, provider: "claude_cli" })).toBeNull();
    expect(continuousNextStop({ stopRequested: true, limits: {}, used, provider: "claude_cli" })).toMatch(/stopped/);
    expect(continuousNextStop({ stopRequested: false, limits: { units: 2 }, used, provider: "claude_cli" })).toMatch(/unit limit/);
    expect(continuousNextStop({ stopRequested: false, limits: { budgetAcuMicro: 10_000_000n }, used, provider: "claude_cli" })).toMatch(
      /ACU/,
    );
    expect(
      continuousNextStop({ stopRequested: false, limits: { perProviderUnits: { claude_cli: 2 } }, used, provider: "claude_cli" }),
    ).toMatch(/claude_cli/);
  });
  it("the claim-next route is a contract: POST /v1/builds/next, same errors as claimBuild, budgets unchanged", () => {
    expect(CLAIM_NEXT_BUILD_ROUTE).toMatchObject({ method: "POST", path: "/v1/builds/next", auth: "contributor", idempotent: true });
    expect(ClaimNextBuildRequest.parse({ deviceId: "00000000-0000-4000-8000-000000000001" })).toMatchObject({
      continuous: false,
      limits: {},
    });
  });
});

describe("D58: a disputed finding is resolved by another lab than the one that raised it", () => {
  const f = (findingId: string, ...raisedByLabs: ("anthropic" | "openai")[]) => ({ findingId, raisedByLabs });
  const both = ["anthropic", "openai"] as const;
  it("Fable-raised findings go to an Astra (openai) resolver, Astra-raised to a Fable (anthropic) resolver; a mixed set is split", () => {
    expect(
      routeDisputedFindings({
        fallbackActive: false,
        findings: [f("a1", "anthropic"), f("o1", "openai"), f("a2", "anthropic")],
        labsWithEligibleResolver: both,
      }),
    ).toEqual([
      { resolver: "anthropic", raisedByLab: "openai", findingIds: ["o1"] },
      { resolver: "openai", raisedByLab: "anthropic", findingIds: ["a1", "a2"] },
    ]);
  });
  it("a finding raised by both reviewers, or with no eligible other-lab resolver, goes to the human", () => {
    expect(
      routeDisputedFindings({ fallbackActive: false, findings: [f("x", "anthropic", "openai")], labsWithEligibleResolver: both }),
    ).toEqual([{ resolver: "human", raisedByLab: "both", findingIds: ["x"] }]);
    expect(
      routeDisputedFindings({ fallbackActive: false, findings: [f("a", "anthropic")], labsWithEligibleResolver: ["anthropic"] }),
    ).toEqual([{ resolver: "human", raisedByLab: "anthropic", findingIds: ["a"] }]);
  });
  it("while the D53 fallback is active every conflict goes to the human (unchanged)", () => {
    expect(routeDisputedFindings({ fallbackActive: true, findings: [f("o", "openai")], labsWithEligibleResolver: both })[0]!.resolver).toBe(
      "human",
    );
  });
  it("resolver eligibility: other lab, not an author, not a reviewer of the disputed rounds", () => {
    const x = {
      resolverAccountId: "r",
      resolverLab: "openai" as const,
      raisedByLab: "anthropic" as const,
      authorAccountIds: ["au"],
      reviewerAccountIds: ["rv"],
    };
    expect(resolverEligibilityRefusals(x)).toEqual([]);
    refused(resolverEligibilityRefusals({ ...x, resolverLab: "anthropic" }), /another lab/);
    refused(resolverEligibilityRefusals({ ...x, resolverAccountId: "au" }), /author/);
    refused(resolverEligibilityRefusals({ ...x, resolverAccountId: "rv" }), /reviewer/);
    expect(resolverEligibilityRefusals({ ...x, resolverLab: "human" })).toEqual([]);
    expect(labOfProvider("claude_cli")).toBe("anthropic");
    expect(labOfProvider("codex_cli")).toBe("openai");
  });
  it("ruling records are queryable: uphold rate per (raising lab, resolving lab)", () => {
    const rec = (
      raisedByLab: "anthropic" | "openai",
      resolvedByLab: "anthropic" | "openai" | "human",
      outcome: "upheld" | "overruled",
    ) => ({
      rulingId: "r",
      findingId: `${raisedByLab}${resolvedByLab}${outcome}${Math.random()}`,
      raisedByLab,
      resolvedByLab,
      outcome,
    });
    expect(
      crossLabUpholdRates([
        rec("anthropic", "openai", "upheld"),
        rec("anthropic", "openai", "overruled"),
        rec("openai", "anthropic", "upheld"),
      ]),
    ).toEqual([
      { raisedByLab: "anthropic", resolvedByLab: "openai", rulings: 2, upheld: 1 },
      { raisedByLab: "openai", resolvedByLab: "anthropic", rulings: 1, upheld: 1 },
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ Astra review 06
describe("Astra review 06: rule regressions (docs/protocol/reviews/ASTRA-REVIEW-06-repros-prefix.txt)", () => {
  const NO_FALLBACK = {
    ...REVIEW_POLICY_V1,
    fallbacks: REVIEW_POLICY_V1.fallbacks.map((f) => ({ ...f, active: false })),
  };
  const q: QualificationEvidence = {
    subjectKind: "attempt",
    subjectId: "at1",
    revision: "c".repeat(40),
    lease: {
      id: LEASE_C5,
      generation: 1,
      accountId: "bob",
      taskKind: "abu_build",
      taskAttemptId: null,
      taskAbuId: "ab1",
      taskDocumentId: null,
      issuedAtMs: NOW - 3 * H,
      expiresAtMs: NOW + 0.5 * H,
      hardDeadlineAtMs: NOW + H,
      endedAtMs: NOW - 0.1 * H,
    },
    citedGeneration: 1,
    changeset: { leaseId: LEASE_C5, ok: true, signatureValid: true, createdAtMs: NOW - 0.5 * H, submissionSha256: "s8" },
    attempt: { id: "at1", accountId: "bob", abuId: "ab1", maxLifetimeAtMs: NOW + 24 * H },
    round: {
      state: "revealed",
      outcome: "consensus",
      headSha: "c".repeat(40),
      submissionSha256: "s8",
      attemptId: "at1",
      documentId: null,
      reviewVerdicts: [ASTRA_PASS],
    },
    greenCiAtHead: true,
    ...bound(LEASE_C5, false, { capabilityClass: "BUILD_L4" }),
    pinnedReviewPolicy: REVIEW_POLICY_V1,
    pinnedCapabilityPolicy: CAPABILITY_POLICY_V1,
    humanPreMergePassOnRound: true,
    receiptLabels: SINGLE_LAB,
  };
  it("R06-1 repro: under the D53 fallback an Opus build + Astra PASS + independent human PASS qualifies, without Fable", () =>
    expect(qualificationRefusals(q)).toEqual([]));
  it("R06-1: the missing human, a missing label, a Fable seat while the fallback is active, a verdict below max are refused", () => {
    refused(qualificationRefusals({ ...q, humanPreMergePassOnRound: false }), /human pre-merge/);
    refused(qualificationRefusals({ ...q, receiptLabels: [] }), /single_lab_review label/);
    refused(qualificationRefusals({ ...q, round: { ...q.round!, reviewVerdicts: [ASTRA_PASS, FABLE_PASS] } }), /fable is not a seat/);
    refused(qualificationRefusals({ ...q, round: { ...q.round!, reviewVerdicts: [{ ...ASTRA_PASS, reasoning: "high" }] } }), /not max/);
    refused(qualificationRefusals({ ...q, round: { ...q.round!, reviewVerdicts: [] } }), /astra seat needs exactly one/);
  });
  it("R06-1: without the fallback both agent seats (and the risk class's human) are required, from the pinned policy", () => {
    const nf = { ...q, pinnedReviewPolicy: NO_FALLBACK, receiptLabels: [] };
    expect(qualificationRefusals({ ...nf, round: { ...q.round!, reviewVerdicts: [ASTRA_PASS, FABLE_PASS] } })).toEqual([]);
    refused(qualificationRefusals(nf), /fable seat needs exactly one/);
  });
  it("R06-1 repro: work that cannot follow the acceptance path is refused before reservation (self-pick and build-next)", () => {
    const fb = acceptanceRequirement(REVIEW_POLICY_V1, CAPABILITY_POLICY_V1, "standard");
    const nf = acceptanceRequirement(NO_FALLBACK, CAPABILITY_POLICY_V1, "standard");
    expect(fb).toMatchObject({
      fallback: "fable_unavailable",
      agentSeats: ["astra"],
      humanRequired: true,
      authoringModel: "claude-opus-5-5",
    });
    refused(builderAcceptanceRefusals(fb, "gpt-6-astra"), /only claude-opus-5-5 builds/);
    refused(builderAcceptanceRefusals(nf, "gpt-6-astra"), /no legal astra reviewer/);
    expect(builderAcceptanceRefusals(fb, "claude-opus-5-5")).toEqual([]);
    const me = {
      accountId: "me",
      provider: "codex_cli",
      modelId: "gpt-6-astra",
      attestedToolchains: [],
      activeLeasesByProvider: {},
      leaseLimitByProvider: { codex_cli: 1 },
      relatedAccountIds: [],
      remaining: { budgetAcuMicro: null, wallTimeMinutes: null },
    };
    const unit = {
      unitId: "u1",
      target: "salesforce",
      requiredClass: "BUILD_L4",
      targetsServed: 1,
      dependentsWaiting: 0,
      issuedEpoch: 1,
      issuedAtMs: 0,
      budgetAcuMicro: 8_000_000n,
      estimatedMinutes: 60,
      proposerAccountId: "someone_else",
      requiredToolchains: [],
      budget: { released: false, expiresEpoch: 5 },
    };
    refused(nextUnitEligibilityRefusals(CAPABILITY_POLICY_V1, me, unit, 2, fb), /only claude-opus-5-5 builds/);
    refused(claimEligibilityRefusals(CAPABILITY_POLICY_V1, me, unit, 2, nf), /no legal astra reviewer/);
  });
  it("R06-6 repro: a schema-valid snapshot of another lease or generation fails even when it would relax the human rule", () => {
    const foreign = bound("00000000-0000-4000-8000-000000000099", false, { leaseGeneration: 99, capabilityClass: "BUILD_L4" });
    const correct = bound(LEASE_C5, true, { capabilityClass: "BUILD_L4" });
    refused(qualificationRefusals({ ...q, ...correct, humanPreMergePassOnRound: false }), /human pre-merge/);
    refused(qualificationRefusals({ ...q, ...foreign, humanPreMergePassOnRound: false }), /another lease or generation/);
    refused(qualificationRefusals({ ...q, ...correct, qualificationSnapshotSha256: `sha256:${"0".repeat(64)}` }), /hash differs/);
    refused(
      qualificationRefusals({ ...q, pinnedReviewPolicy: { ...REVIEW_POLICY_V1, policyVersion: "review-policy.v2" } }),
      /not the one the snapshot pinned/,
    );
    expect(
      boundRunPolicySnapshot(
        { id: LEASE_C5, generation: 1 },
        correct.snapshotRow,
        correct.snapshotBody,
        correct.qualificationSnapshotSha256,
      ).refusals,
    ).toEqual([]);
  });
  const rel = {
    reason: "abandoned" as const,
    epochNumber: 3,
    expiresEpoch: 5,
    submittedEpoch: 2 as number | null,
    reviewGraceEpochs: 2,
    accepted: false,
    activeLease: false,
    authorizationRefusals: null as string[] | null,
    taskTerminal: true,
    finalRejectionOfSubmission: false,
  };
  it("R06-4 repro: submitted work whose lease ended while review is pending cannot be released as abandoned or failed", () => {
    refused(budgetReleaseRefusals(rel), /final rejection or an authorized cancellation/);
    refused(budgetReleaseRefusals({ ...rel, reason: "failed" }), /final rejection or an authorized cancellation/);
    expect(budgetReleaseRefusals({ ...rel, finalRejectionOfSubmission: true })).toEqual([]);
    expect(budgetReleaseRefusals({ ...rel, authorizationRefusals: [] })).toEqual([]);
    expect(budgetReleaseRefusals({ ...rel, submittedEpoch: null })).toEqual([]);
    refused(budgetReleaseRefusals({ ...rel, submittedEpoch: null, taskTerminal: false }), /terminal state/);
  });
  it("R06-3 repro: one split for engine and rule — odd reserves, swapped receipt ids, several contributors, zero lines", () => {
    const params = {
      ...engineParamsFrom(REWARD_POLICY_V1, COMPLETION_POLICY_V1),
      emissionReserve: 1000n,
      budgetPpm: 1_000_000n,
      rateCeilingInitialBasePerAcu: 100n,
      rateCeilingDecayPpm: 0n,
      holdbackBp: 0n,
    };
    const cases: Array<{ micro: bigint; people: Array<[string, string, number]> }> = [
      {
        micro: 10_000n,
        people: [
          ["alice", "z", 5000],
          ["bob", "a", 5000],
        ],
      },
      {
        micro: 30_000n,
        people: [
          ["alice", "a", 5000],
          ["bob", "z", 5000],
        ],
      },
      {
        micro: 70_000n,
        people: [
          ["carol", "m", 3333],
          ["alice", "z", 3333],
          ["bob", "a", 3334],
        ],
      },
      {
        micro: 10_000n,
        people: [
          ["bob", "b", 9000],
          ["alice", "a", 1000],
        ],
      },
    ];
    for (const c of cases) {
      const r = computeEpochFor(params, c.micro, c.people);
      const lines = r.allocations.map((l) => ({
        receiptId: c.people.find((p) => p[0] === l.accountId)![1],
        beneficiary: "person" as const,
        amount: l.amountBase,
      }));
      const receipts = c.people.map(([accountId, receiptId, shareBp]) => ({ receiptId, accountId, shareBp, orgShareBp: 0 }));
      expect(taskAllocationRefusals({ reservedBase: r.acceptedBase, receipts, lines })).toEqual([]);
    }
    // Dormant sponsorship split vectors (checked now, used when organization splits activate).
    expect(
      splitTaskReservation(7n, [
        { accountId: "a", shareBp: 5000, orgShareBp: 8000 },
        { accountId: "b", shareBp: 5000 },
      ]).get("a"),
    ).toEqual({
      total: 4n,
      person: 1n,
      organization: 3n,
    });
  });
  it("re-issue is a new task generation linked to the replaced one (same objective, ended, unaccepted, once)", () => {
    const ok = {
      newTaskId: "t2",
      replaced: { taskId: "t1", objectiveId: "o", released: true, accepted: false },
      objectiveId: "o",
      alreadyReissued: false,
    };
    expect(reissueRefusals(ok)).toEqual([]);
    refused(reissueRefusals({ ...ok, newTaskId: "t1" }), /new task id/);
    refused(reissueRefusals({ ...ok, replaced: { ...ok.replaced, released: false } }), /released or expired/);
    refused(reissueRefusals({ ...ok, objectiveId: "other" }), /objective/);
    refused(reissueRefusals({ ...ok, alreadyReissued: true }), /once/);
  });
});

function computeEpochFor(params: ReturnType<typeof engineParamsFrom>, budgetMicro: bigint, people: Array<[string, string, number]>) {
  return computeEpoch(
    {
      epochNumber: 1,
      state: initialState(params.emissionReserve),
      consumedIds: new Set(),
      issuances: [{ taskId: "t", kind: "execution", budgetAcuMicro: budgetMicro, featurePoolKeys: [], applicationPoolKeys: [] }],
      acceptances: [{ taskId: "t", shares: people.map(([a, , bp]) => ({ accountId: a, beneficiaryId: a, shareBp: bp })) }],
    },
    params,
  );
}

// ------------------------------------------------------------------------------------------------ Astra review 07
describe("Astra review 07: rule regressions (docs/protocol/reviews/ASTRA-REVIEW-07-repros-prefix.txt)", () => {
  const q7: QualificationEvidence = {
    subjectKind: "document",
    subjectId: "d1",
    revision: "b".repeat(40),
    lease: {
      id: LEASE_C3,
      generation: 1,
      accountId: "bob",
      taskKind: "roadmap_author",
      taskAttemptId: null,
      taskAbuId: null,
      taskDocumentId: "d1",
      issuedAtMs: NOW - 3 * H,
      expiresAtMs: NOW + 0.5 * H,
      hardDeadlineAtMs: NOW + H,
      endedAtMs: NOW - 0.1 * H,
    },
    citedGeneration: 1,
    changeset: { leaseId: LEASE_C3, ok: true, signatureValid: true, createdAtMs: NOW - 0.5 * H, submissionSha256: "s9" },
    round: {
      state: "revealed",
      outcome: "consensus",
      headSha: "b".repeat(40),
      submissionSha256: "s9",
      attemptId: null,
      documentId: "d1",
      reviewVerdicts: [ASTRA_PASS],
    },
    greenCiAtHead: false,
    ...bound(LEASE_C3),
    pinnedReviewPolicy: REVIEW_POLICY_V1,
    pinnedCapabilityPolicy: CAPABILITY_POLICY_V1,
    humanPreMergePassOnRound: true,
    receiptLabels: SINGLE_LAB,
  };
  it("baseline (fallback): Opus + Astra max + human qualifies", () => expect(qualificationRefusals(q7)).toEqual([]));
  it("R07-1 repro: a correctly bound snapshot with an unknown risk class cannot qualify (no fewer reviews, fail closed)", () => {
    refused(
      qualificationRefusals({
        ...q7,
        ...bound(LEASE_C3, false, { riskClass: "unknown-risk" }),
        round: { ...q7.round!, reviewVerdicts: [] },
      }),
      /0 rules for risk class unknown-risk/,
    );
    const dup = {
      ...REVIEW_POLICY_V1,
      rules: [...REVIEW_POLICY_V1.rules, REVIEW_POLICY_V1.rules.find((r) => r.riskClass === "standard")!],
    };
    refused(qualificationRefusals({ ...q7, pinnedReviewPolicy: dup }), /2 rules for risk class standard/);
    const unknownCap = {
      ...REVIEW_POLICY_V1,
      rules: REVIEW_POLICY_V1.rules.map((r) =>
        r.riskClass === "standard" ? { ...r, agentReviews: [{ capability: "REVIEW_Z", reasoning: "max" as const }] } : r,
      ),
    };
    refused(qualificationRefusals({ ...q7, pinnedReviewPolicy: unknownCap }), /unknown review capability REVIEW_Z/);
  });
  it("R07-1 repro: a capability policy other than the pinned version fails even when it is valid", () => {
    const v2 = {
      ...CAPABILITY_POLICY_V1,
      policyVersion: "capability-policy.v2",
      classes: CAPABILITY_POLICY_V1.classes.map((c) =>
        c.id === "REVIEW_A" ? { ...c, qualified: [{ ...c.qualified[0]!, modelId: "unqualified-in-v1" }] } : c,
      ),
    };
    refused(
      qualificationRefusals({
        ...q7,
        pinnedCapabilityPolicy: v2,
        round: { ...q7.round!, reviewVerdicts: [{ ...ASTRA_PASS, modelId: "unqualified-in-v1" }] },
      }),
      /capability policy used is not the one the snapshot pinned/,
    );
  });
  it("R07-1: the reviewer (provider, model) tuple must be a qualified one", () =>
    refused(
      qualificationRefusals({ ...q7, round: { ...q7.round!, reviewVerdicts: [{ ...ASTRA_PASS, provider: "claude_cli" }] } }),
      /claude_cli\/gpt-6-astra is not a qualified/,
    ));
  it("R07-1: an unknown risk class also refuses the builder before any reservation", () =>
    refused(
      builderAcceptanceRefusals(acceptanceRequirement(REVIEW_POLICY_V1, CAPABILITY_POLICY_V1, "unknown-risk"), "claude-opus-5-5"),
      /0 rules/,
    ));
  it("R07-2 repro: an ACTIVE allocation can be challenged freely in its window, bound to the frozen receipt and root", () => {
    const c = {
      epochState: "PROPOSED",
      nowMs: NOW,
      windowClosesAtMs: NOW + H,
      receiptStatus: "ACTIVE",
      frozenReceiptSha256: "sha256:r",
      currentReceiptSha256: "sha256:r",
      publishedAllocationsRoot: "sha256:root",
      citedAllocationsRoot: "sha256:root",
      allocationOfReceiptInEpoch: true,
      challengerIsAccusedOrRelated: false,
      alreadyChallengedUndecided: false,
    };
    expect(allocationChallengeRefusals(c)).toEqual([]);
    refused(allocationChallengeRefusals({ ...c, nowMs: NOW + H }), /window is not open/);
    refused(allocationChallengeRefusals({ ...c, citedAllocationsRoot: "sha256:other" }), /allocations root/);
    refused(allocationChallengeRefusals({ ...c, currentReceiptSha256: "sha256:changed" }), /frozen receipt revision/);
    refused(allocationChallengeRefusals({ ...c, challengerIsAccusedOrRelated: true }), /own/);
    // Review 08 R08-1: every live-countable receipt, not only ACTIVE.
    expect(allocationChallengeRefusals({ ...c, receiptStatus: "RATIFIED" })).toEqual([]);
    expect(allocationChallengeRefusals({ ...c, receiptStatus: "FINAL_BY_SILENCE" })).toEqual([]);
    refused(allocationChallengeRefusals({ ...c, receiptStatus: "PROVISIONAL" }), /live-countable/);
    refused(allocationChallengeRefusals({ ...c, receiptStatus: "REVOKED" }), /live-countable/);
    refused(
      challengedAllocationPaymentRefusals({ challenged: true, decision: null, entitledSoFar: 0n, amount: 1n }),
      /undecided challenge/,
    );
    expect(
      challengedAllocationPaymentRefusals({
        challenged: true,
        decision: { outcome: "changed", resultingAmount: 60n },
        entitledSoFar: 0n,
        amount: 60n,
      }),
    ).toEqual([]);
    refused(
      challengedAllocationPaymentRefusals({
        challenged: true,
        decision: { outcome: "changed", resultingAmount: 60n },
        entitledSoFar: 0n,
        amount: 61n,
      }),
      /decided amount/,
    );
    const d = {
      outcome: "changed" as const,
      resultingAmount: 60n,
      allocationAmount: 100n,
      replied: true,
      nowMs: NOW,
      replyDeadlineAtMs: NOW + H,
      alreadyDecided: false,
      authorizationRefusals: [],
    };
    expect(allocationChallengeDecisionRefusals(d)).toEqual([]);
    refused(allocationChallengeDecisionRefusals({ ...d, resultingAmount: 120n }), /lowered/);
    refused(allocationChallengeDecisionRefusals({ ...d, replied: false }), /replied/);
    refused(allocationChallengeDecisionRefusals({ ...d, alreadyDecided: true }), /one decision/);
  });
  it("R07-5: every transition endpoint of the receipt machine is a declared state", () => {
    for (const t of ReceiptStatusMachine.transitions) {
      expect(ReceiptStatusMachine.states).toContain(t.from);
      expect(ReceiptStatusMachine.states).toContain(t.to);
    }
  });
  it("R07-7 repro: D58 records derive from a CONFIRMED ruling's decisions and the resolver's run; unknown labs fail closed", () => {
    const ruling = { id: "r1", state: "confirmed", rulings: [{ findingId: "f1", decision: "upheld" as const }] };
    expect(
      rulingLabRecordsFromConfirmedRuling(ruling, { kind: "agent", provider: "codex_cli" }, [
        { findingId: "f1", raisedByProvider: "claude_cli" },
      ]),
    ).toEqual([{ rulingId: "r1", findingId: "f1", raisedByLab: "anthropic", resolvedByLab: "openai", outcome: "upheld" }]);
    expect(() =>
      rulingLabRecordsFromConfirmedRuling({ ...ruling, state: "awaiting_maintainer" }, { kind: "human" }, [
        { findingId: "f1", raisedByProvider: "claude_cli" },
      ]),
    ).toThrow(/not confirmed/);
    expect(() =>
      rulingLabRecordsFromConfirmedRuling(ruling, { kind: "agent", provider: "mystery" }, [
        { findingId: "f1", raisedByProvider: "claude_cli" },
      ]),
    ).toThrow(/resolver's lab is unknown/);
    expect(() => rulingLabRecordsFromConfirmedRuling(ruling, { kind: "agent", provider: "codex_cli" }, [])).toThrow(/raised it is unknown/);
    expect(() =>
      rulingLabRecordsFromConfirmedRuling(ruling, { kind: "agent", provider: "claude_cli" }, [
        { findingId: "f1", raisedByProvider: "claude_cli" },
      ]),
    ).toThrow(/its own lab/);
    expect(() =>
      routeDisputedFindings({
        fallbackActive: false,
        findings: [{ findingId: "x", raisedByLabs: [] }],
        labsWithEligibleResolver: ["openai"],
      }),
    ).toThrow(/unknown/);
  });
});

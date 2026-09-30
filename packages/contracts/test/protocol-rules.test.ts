/**
 * D51 engine-first enforcement: every Astra review 02/03 repro (and D49 rule) whose SQL guard moved out of migration
 * 0007 is asserted here against the rule the service layer must call before writing. Each test starts from a valid
 * baseline (which must return no refusal) and then applies the repro. Labels match REVIEW-PACKET §3e.
 */
import { describe, expect, it } from "vitest";
import {
  ACTIVATION_RULES,
  activationRefusals,
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
  qualificationRefusals,
  quorumRatifyRefusals,
  ReceiptStatusMachine,
  receiptRefusals,
  resolutionRefusals,
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
describe("qualification chain (H7, A3-5) — moved from 0007 check_qualification_result", () => {
  const base: QualificationEvidence = {
    subjectKind: "document",
    subjectId: "d1",
    revision: "b".repeat(40),
    lease: {
      id: "c3",
      generation: 1,
      accountId: "bob",
      taskKind: "roadmap_author",
      taskAttemptId: null,
      taskAbuId: null,
      taskDocumentId: "d1",
      issuedAtMs: NOW - 3 * H,
      hardDeadlineAtMs: NOW + H,
      endedAtMs: NOW - 0.1 * H,
    },
    citedGeneration: 1,
    changeset: { leaseId: "c3", ok: true, signatureValid: true, createdAtMs: NOW - 0.5 * H, submissionSha256: "s9" },
    round: {
      state: "revealed",
      outcome: "consensus",
      headSha: "b".repeat(40),
      submissionSha256: "s9",
      attemptId: null,
      documentId: "d1",
      reviewVerdicts: [
        { slot: "astra", verdict: "NO_MATERIAL_GAPS" },
        { slot: "fable", verdict: "NO_MATERIAL_GAPS" },
      ],
    },
    greenCiAtHead: false,
    snapshotRequiresHuman: false,
    humanPreMergePassOnRound: false,
  };
  const attempt: QualificationEvidence = {
    ...base,
    subjectKind: "attempt",
    subjectId: "at1",
    revision: "c".repeat(40),
    lease: { ...base.lease, id: "c5", taskKind: "abu_build", taskAbuId: "ab1", taskDocumentId: null },
    changeset: { ...base.changeset!, leaseId: "c5", submissionSha256: "s8" },
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
        round: { ...base.round!, outcome: "gaps", reviewVerdicts: [{ slot: "fable", verdict: "MATERIAL_GAPS" }] },
      }),
      /consensus round/,
    ));
  it("A3-5: a qualification citing a changeset of another lease", () =>
    refused(qualificationRefusals({ ...base, changeset: { ...base.changeset!, leaseId: "c1" } }), /not accepted on this lease/));
  it("A3-5 / H7: a qualification on a stale lease generation", () =>
    refused(qualificationRefusals({ ...base, citedGeneration: 2 }), /stale lease generation/));
  it("A3-5: the pinned snapshot requires a human approval that is missing", () =>
    refused(qualificationRefusals({ ...base, snapshotRequiresHuman: true }), /human pre-merge/));
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
    budget: { amountMicro: 3_000_000n, kind: "planning", released: false, expiresEpoch: 6 },
    slice: "planning",
    admittedEpoch: 2,
    shareBp: 10_000,
    sharesAlreadyDeclaredBp: 0,
    usage: { allOwnAndThisLease: true, anyAttributedElsewhere: false },
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
  it("A3-5 (telemetry): usage of another run attached / reused by a second contribution", () => {
    refused(receiptRefusals({ ...ok, usage: { allOwnAndThisLease: false, anyAttributedElsewhere: false } }), /of this lease/);
    refused(receiptRefusals({ ...ok, usage: { allOwnAndThisLease: true, anyAttributedElsewhere: true } }), /another contribution/);
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
  };
  it("baseline: a budget at the model passes; above it with justification and approval passes", () => {
    expect(budgetRefusals(b)).toEqual([]);
    expect(
      budgetRefusals({ ...b, budgetMicro: 3_000_000n, modelMicro: 2_000_000n, justification: "x".repeat(40), approvalRefusals: [] }),
    ).toEqual([]);
  });
  it("D49: a budget above the hard maximum of the model", () =>
    refused(budgetRefusals({ ...b, budgetMicro: 9_000_000n, modelMicro: 4_000_000n }), /hard maximum/));
  it("D49: a budget above the model without a written justification / without a two-person approval", () => {
    refused(budgetRefusals({ ...b, budgetMicro: 3_000_000n, modelMicro: 2_000_000n }), /justification/);
    refused(
      budgetRefusals({
        ...b,
        budgetMicro: 3_000_000n,
        modelMicro: 2_000_000n,
        justification: "x".repeat(40),
        approvalRefusals: ["does not authorize"],
      }),
      /approve_budget/,
    );
  });
  it("D49: task budgets under one objective exceeding it (splitting / stacking)", () =>
    refused(budgetRefusals({ ...b, budgetMicro: 5_000_000n, modelMicro: 5_000_000n }), /objective/));
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
      /remaining balance/,
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
    refused(confiscationNoticeRefusals({ nowMs: NOW, replyClosesAtMs: NOW + H, appealClosesAtMs: NOW + 2 * H }), /72 h reply/);
    expect(confiscationNoticeRefusals({ nowMs: NOW, replyClosesAtMs: NOW + 73 * H, appealClosesAtMs: NOW + 242 * H })).toEqual([]);
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

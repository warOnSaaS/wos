/**
 * DRAFT — the versioned policy documents of Proof of Contribution (docs/protocol/POLICIES.md). Every receipt and
 * allocation records the versions in force; a new version never rewrites history. V1 values live in
 * ./data/*.json and are parsed by ./data.ts.
 */
import { z } from "zod";
import { ProviderId, ReasoningLevel } from "../agent-policy.js";
import { TaskKind } from "../agent-io.js";
import { BugTaskKind } from "../bugs.js";

/** D63: every kind of claimable work (TaskKind, plus the D60/D61 kinds that join TaskKind when served). */
export const WorkKind = z.union([TaskKind, BugTaskKind, z.literal("architecture_author")]);
export type WorkKind = z.infer<typeof WorkKind>;
import {
  AcceptanceEvent,
  CapabilityClass,
  ContributionType,
  PerturbationClass,
  EvidenceClass,
  ReviewDomain,
  RiskClassId,
  U64String,
} from "./entities.js";

const Bp = z.number().int().min(0).max(10_000);
const Ppm = z.number().int().min(0).max(1_000_000);
const Status = z.enum(["draft", "active", "retired"]);

// ------------------------------------------------------------------------------------------------ ModelRateOracle

/** Rates in micro-ACU per MILLION provider tokens (integers). acuMicro = floor(sum(tokens x rate) / 1e6). */
export const ModelRate = z.object({
  provider: ProviderId,
  modelId: z.string().min(1),
  inputPerM: z.number().int().nonnegative(),
  cachedInputPerM: z.number().int().nonnegative(),
  cacheWritePerM: z.number().int().nonnegative(),
  outputPerM: z.number().int().nonnegative(),
  /** Where the reference number came from; "UNVERIFIED" sources block activation. */
  source: z.string().min(1),
  verified: z.boolean(),
});
export type ModelRate = z.infer<typeof ModelRate>;

export const ModelRateOracle = z.object({
  oracleVersion: z.string().regex(/^oracle\.v\d+$/),
  status: Status,
  /** First epoch this version applies to; oracle changes take effect only at epoch boundaries. */
  effectiveEpoch: z.number().int().positive(),
  calibration: z.string().min(10),
  /** Max relative change of any rate vs the previous version, in bp, unless the founder waives it by AdminAction. */
  maxChangePerVersionBp: Bp,
  rates: z.array(ModelRate).min(1),
});
export type ModelRateOracle = z.infer<typeof ModelRateOracle>;

// ------------------------------------------------------------------------------------------------ RewardPolicy

/** D61: a severity multiplier of a fix budget, in bp: 1x..2x. */
const FixBp = z.number().int().min(10_000).max(20_000);

export const RewardPolicy = z.object({
  policyVersion: z.string().regex(/^reward-policy\.v\d+$/),
  status: Status,
  units: z.object({ decimals: z.literal(6), acuMicroPerAcu: z.literal(1_000_000) }),
  epoch: z.object({
    lengthDays: z.number().int().positive(),
    /** Bounded pre-finalization window: admins may hold or invalidate receipts only inside it. */
    riskReviewHours: z.number().int().positive(),
    /** After FINALIZED, the root is public this long before the distributor is funded. */
    challengeHours: z.number().int().nonnegative(),
    /** A held receipt moves to the next epoch at most this many times, then must be included or invalidated. */
    maxDeferrals: z.number().int().nonnegative(),
    /** A merged change reverted as defective within this many days of merge becomes an offset (never a confiscation). */
    revertOffsetDays: z.number().int().nonnegative(),
  }),
  emission: z.object({
    maxSupplyBase: U64String,
    /** The share of max supply that can ever be emitted to contributors and pools through epochs. */
    emissionReserveBase: U64String,
    /** Budget(e) = floor(remainingReserve x decayPpm / 1e6). */
    budgetPpmOfRemaining: Ppm,
    /**
     * D49 issuance rate: base units per ACU of task budget for tasks issued in epoch e (initial x (1 - decay)^(e-1)),
     * fixed for a task at issuance, so the price of a task never depends on when it is accepted (no timing gain).
     * Also the ceiling per ACU-equivalent in the outcomes slice and the rate of security payouts.
     */
    rateCeiling: z.object({
      initialBasePerAcu: U64String,
      decayPpmPerEpoch: Ppm,
    }),
  }),
  /** Epoch budget split; must sum to 10000. */
  slicesBp: z.object({
    execution: Bp,
    planning: Bp,
    human_review: Bp,
    outcomes: Bp,
    completion_accrual: Bp,
    security_reserve: Bp,
  }),
  eligibility: z.object({
    /**
     * Which evidence classes may enter live epochs, per cluster. D49: payouts rest on accepted task budgets and
     * outcomes; usage is telemetry and never an evidence class for pay. Mainnet stays empty until the readiness gate.
     */
    acceptedEvidenceClasses: z.object({ devnet: z.array(EvidenceClass), mainnet: z.array(EvidenceClass) }),
    requireReviewPolicySatisfied: z.literal(true),
    requireWalletForClaim: z.boolean(),
  }),
  /** Per-type acceptance (Astra-01 item 10): the event that accepts it, and which checks apply to it. */
  acceptance: z.array(
    z.object({
      contributionType: ContributionType,
      event: AcceptanceEvent,
      acceptedBy: z.string().min(3),
      slice: z.enum(["execution", "planning", "human_review", "outcomes", "security_reserve", "none"]),
      /** D49: commissioned tasks are paid their budget; outcomes compete by ACU-equivalent weight. */
      weightBasis: z.enum(["task_budget", "acu_equivalent", "none"]),
      needsLease: z.boolean(),
      /** Usage TELEMETRY is recorded (cap enforcement, calibration, signals); it never changes the payout. */
      needsUsageReceipt: z.boolean(),
    }),
  ),
  settlement: z.object({
    /** Allocations to accounts without a bound wallet carry forward; after this many epochs they return to the reserve. */
    unboundCarryEpochs: z.number().int().positive(),
    /** Devnet push transfers never expire; mainnet claim windows are decided at the readiness gate. */
    mechanism: z.object({ devnet: z.literal("push_transfer"), mainnet: z.enum(["undecided", "push_transfer", "merkle_claim"]) }),
    /** Offsets (post-finalization reversals) are recovered from future allocations, at most this share of each. */
    maxOffsetRecoveryBp: Bp,
  }),
  /**
   * D40 holdback: each finalized allocation releases (1 - shareBp) now and holds shareBp for `epochs` epochs (the
   * pattern-lookback window). Findings recover from the holdback first. Leaving or abandoning forfeits unreleased
   * holdback only as RiskPolicy says (exclusion after proven cheating), never for an ordinary pause in contributing.
   */
  holdback: z.object({ shareBp: Bp, epochs: z.number().int().positive(), forfeitOnExclusion: z.literal(true) }),
  /**
   * D49 budget-based rewards. A task's budget (ACU) is fixed before work starts, from the budget model, reviewed in
   * consensus (an unjustified budget is a material finding) and compared with peers; acceptance pays it in full.
   */
  budgets: z.object({
    denomination: z.literal("acu"),
    /** Epoch contract: budgets are reserved at issuance from the task slices; a task that does not fit is not issued. */
    funding: z.literal("reserve_at_issuance"),
    /** V1: binary acceptance, no quality factor q (founder decision F22 confirms). */
    acceptance: z.literal("binary"),
    qualityFactor: z.literal("none"),
    /** Collaborators' declared shares sum to 10000 bp; rounding by largest remainder per task (exact). */
    sharesSumBp: z.literal(10_000),
    model: z.object({
      /** budget = baseMicro + perSizePointMicro x size, x difficulty x importance (bounded multipliers), per task kind. */
      difficultyBp: z.object({ min: Bp, max: z.number().int().positive() }),
      importanceBp: z.object({ min: Bp, max: z.number().int().positive() }),
      /** A budget above model x this needs a written justification AND a human approval in consensus. */
      maxWithoutHumanBp: z.number().int().positive(),
      /** Hard ceiling vs the model, whatever the approvals. */
      hardMaxBp: z.number().int().positive(),
      /** Budgets of all units under one acceptance objective never exceed the objective's budget (anti-splitting). */
      objectiveCap: z.literal(true),
      /** The proposer of a budget (or a related account) may not build that unit. */
      proposerMayNotBuild: z.literal(true),
    }),
    /** An issued task not accepted within this many epochs is released and re-priced before re-issue. */
    expiryEpochs: z.number().int().positive(),
    /**
     * Review 05 B4: work submitted while its reservation is live keeps it this many further epochs while the protocol's
     * reviews finish. Accepted by D57 (F28); PINNED on each reservation at issuance (review 06 R06-5).
     */
    reviewGraceEpochs: z.number().int().nonnegative(),
    /** The budget model is recalibrated from telemetry of ACCEPTED units at most this often, moving at most maxChangeBp. */
    recalibration: z.object({ everyEpochs: z.number().int().positive(), maxChangeBp: Bp, minSamples: z.number().int().positive() }),
  }),
  /** D41: bounties are paid only from amounts actually recovered; unrecovered losses reduce later budgets, bounded. */
  losses: z.object({ bountyBpOfRecovered: Bp, absorptionMaxBp: Bp, publish: z.literal(true) }),
  /**
   * D39 confiscation after PROVEN cheating: unreleased holdback, pending allocations, unclaimed entitlements and
   * unreleased Genesis vesting; then offsets on future earnings until the proven excess is repaid; revocation of the
   * receipts; zero governance weight; exclusion. Never on-chain seizure of released tokens (no freeze, no delegate).
   * Due process: evidence, notice, reply, one appeal, action-bound two-person AdminAction; permanent exclusion by a
   * structural governance vote (founder AdminAction in founder mode). Confiscated amounts return to the reserve.
   */
  confiscation: z.object({
    replyHours: z.number().int().positive(),
    appealHours: z.number().int().positive(),
    /**
     * Review 04 finding 4: FINITE maxima, measured from notice, so a hold is bounded whatever the writer sets: reply
     * closes within maxReplyHours of notice, the appeal within maxAppealHours after the reply, and the hold lapses within
     * maxHoldAfterAppealHours after the appeal closes. Accepted by D57 (F17).
     */
    maxReplyHours: z.number().int().positive(),
    maxAppealHours: z.number().int().positive(),
    maxHoldAfterAppealHours: z.number().int().positive(),
    maxTimeBoxedExclusionEpochs: z.number().int().positive(),
    permanentExclusionTier: z.literal("structural"),
  }),
  /**
   * D55: modules that are V1-ACTIVE and modules that are designed but DORMANT (kept, tested, not built in V1 waves),
   * each dormant one activated later by a forward-only policy switch (AdminAction) once its trigger is met.
   */
  modules: z.object({
    active: z.array(z.string().min(1)).min(1),
    dormant: z.array(
      z.object({
        module: z.enum([
          "dispute_stakes_and_bounties",
          "multi_allocation_disputes_and_appeals",
          "payout_canaries",
          "organization_caps_and_beneficiary_splits",
          "governance_voting",
          "collusion_and_sybil_detection_beyond_basics",
          "confiscation_beyond_simple_hold",
          "genesis_calibration_population",
          "priority_vote",
        ]),
        activationTrigger: z.string().min(10),
        v1Stub: z.string().min(5),
      }),
    ),
  }),
  /** D42: when no eligible auditor exists by the deadline, the claim releases on schedule, flagged "unaudited". */
  auditCapacity: z.object({ unauditedRelease: z.literal(true), penalizeContributor: z.literal(false) }),
  /**
   * D28–D31 optimistic payouts: every allocation is published with an explanation and anomaly metrics; silence
   * accepts; disputes (any set of allocations, by any epoch participant) go to an audit gate.
   */
  challenge: z.object({
    windowHours: z.number().int().positive(),
    /** The accused's right of reply inside the gate. */
    replyHours: z.number().int().positive(),
    /** After this long without a gate outcome, a maintainer must decide (AdminAction) — deadlock escalation. */
    gateEscalateAfterHours: z.number().int().positive(),
    standing: z.literal("epoch_participants"),
    /** Stake per ITEM = max(minStakeBase, stakePerItemBp x pending); forfeited per rejected item (D43). */
    stakePerItemBp: Bp,
    /** Cap on the bp part only (large earners); the floor always applies. Total stake <= the disputer's pending. */
    maxStakeBp: Bp,
    minStakeBase: U64String,
    /** One appeal per resolved item, by either party, within this window (D43). */
    appealHours: z.number().int().positive(),
    /** Joining an existing gate on the same allocation costs only the minimum stake; bounty priority stays with the first disputer. */
    joinerStake: z.literal("min"),
    maxItemsPerDispute: z.number().int().positive(),
    maxDisputesPerAccountPerEpoch: z.number().int().positive(),
    /** Related parties of the accused never hold bounty priority (D43). */
    relatedPartyBountyPriority: z.literal(false),
    /** Mandatory sampled payout audits run every epoch whether or not anyone disputes. */
    sampledAuditRateBp: Bp,
    /** Rejected disputes in 30 days before rejected_disputes is raised and the account's dispute rate limit halves. */
    rejectedDisputesSignalAfter: z.number().int().positive(),
    /** Allocations are public (pseudonym + wallet + explanation) to everyone; the leaderboard stays opt-in. */
    publicAllocations: z.literal(true),
  }),
  execution: z.object({
    /** The execution cap (AgentCapabilityPolicy) stops a run; it includes repairs. It is not a payout (D49). */
    capIncludesRepairs: z.literal(true),
    /**
     * Agent reviewer bonus per upheld/resolved material finding, as bp of the review task's budget. 0 in V1 (review 05
     * obsolete item 3): the engine never pays above a reserved quote; a finding bounty needs its own reservation (F27).
     */
    upheldFindingBonusBp: Bp,
    maxPaidFindingsPerReview: z.number().int().nonnegative(),
    /** Reviews of an attempt that never merged are paid only if they raised a material finding that was upheld. */
    payReviewsOfFailedAttemptsWithUpheldFindings: z.boolean(),
  }),
  humanReview: z.object({
    /**
     * D49: the BUDGET of a commissioned human review, by risk class (ACU-equivalent), independent of the builder's
     * budget and of any usage. Reserved at issuance from the human_review slice like every other task.
     */
    weightAcuEqMicro: z.record(RiskClassId, U64String),
    /** Per material finding the reviewer raised that was upheld or fixed. "0" in V1: never paid above the quote (F27). */
    upheldFindingBonusMicro: U64String,
    maxPaidFindings: z.number().int().nonnegative(),
    /** Ratification reviews of PROVISIONAL founder receipts are paid like any human review. */
    payRatificationReviews: z.literal(true),
  }),
  outcomes: z.object({
    /**
     * RELATIVE weights (ACU-equivalents) competing inside a funded slice, never fixed payouts (Astra-01 item 4: the
     * old 25/100/300/1000 credit ladder is removed as an executable default).
     */
    proposalIncorporatedAcuEq: z.number().int().nonnegative(),
    bugAcuEq: z.object({ low: z.number().int(), medium: z.number().int(), high: z.number().int(), critical: z.number().int() }),
    maxProposalsPaidPerAccountPerEpoch: z.number().int().positive(),
  }),
  /**
   * D61 bugs and maintenance (versioned addition to frozen protocol v1: present from reward-policy.v2; absent in v1, so v1 fails closed). A fix is an ordinary budgeted abu_build task
   * whose model is multiplied by the confirmed severity (bounded; pinned at issuance with the budget); triage is a
   * commissioned low-risk human-review task; a bug REPORT is the existing outcome weight (bugAcuEq), paid only for the
   * first valid report of a confirmed bug whose fix merged, never to (a relative of) the introducer within the
   * revert-offset window; sweeps are never paid by themselves.
   */
  bugs: z
    .object({
      /** Multipliers in bp (10000 = 1x), never below 1x, never above 2x (the budget's own hard maximum). */
      severityFixBp: z.object({ low: FixBp, medium: FixBp, high: FixBp, critical: FixBp }),
      /** Hard ceiling of the severity multiplier (the budget's 2x hard maximum still applies on top). */
      maxSeverityFixBp: FixBp,
      maxBugReportsPaidPerAccountPerEpoch: z.number().int().positive(),
      /** Rejected or duplicate reports by one account in 30 days before a signal. */
      rejectedReportsSignalAfter: z.number().int().positive(),
      /** A bug blamed on a receipt accepted within this many days is a partial revert (the epoch's revertOffsetDays). */
      introducerWindowDays: z.number().int().positive(),
      /** Within the window the introducer carries an offset equal to what an unrelated reporter's report was paid. */
      introducerOffsetEqualsReportPay: z.boolean(),
      /** The introducer (or a related account) is never paid for reporting, and never takes the fix lease, within the window. */
      introducerReportPaid: z.literal(false),
      introducerMayFixWithinWindow: z.literal(false),
      /** A reporter who is not the introducer may also fix; the report and the fix budget are both paid. */
      reporterMayFix: z.literal(true),
      /** Bug-bash sweeps earn nothing by themselves; only confirmed, fixed bugs are paid (as reports and fixes). */
      sweepsPaid: z.literal(false),
    })
    .optional(),
  security: z.object({
    /** Security payouts debit the security reserve balance: weight x the epoch's issuance rate, at most maxShareBp of the balance. */
    severityAcuEq: z.object({ low: z.number().int(), medium: z.number().int(), high: z.number().int(), critical: z.number().int() }),
    maxShareOfReserveBp: Bp,
  }),
  completion: z.object({ featurePoolsBp: Bp, applicationPoolsBp: Bp }),
});
export type RewardPolicy = z.infer<typeof RewardPolicy>;

// ------------------------------------------------------------------------------------------------ ReviewPolicy

/** Deterministic risk classification: the first class (by priority) whose matcher matches. */
export const RiskMatcher = z.object({
  anyPathGlobs: z.array(z.string()).default([]),
  contributionTypes: z.array(ContributionType).default([]),
  labels: z.array(z.string()).default([]),
});

export const HumanRequirement = z.object({
  count: z.number().int().nonnegative(),
  /** Every human must hold one of these domains (empty = any domain). */
  domains: z.array(ReviewDomain).default([]),
  /** When > 1 humans: how many distinct domains must be represented. */
  distinctDomains: z.number().int().nonnegative().default(0),
  minLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const ReviewRule = z.object({
  riskClass: RiskClassId,
  deterministicVerification: z.literal(true),
  agentReviews: z.array(z.object({ capability: CapabilityClass, reasoning: z.union([ReasoningLevel, z.literal("max")]) })),
  humans: HumanRequirement,
  /** Maintainer quorum on top of humans (e.g. protocol changes). 0 = none. */
  adminQuorum: z.number().int().nonnegative(),
});

export const ReviewPolicy = z.object({
  policyVersion: z.string().regex(/^review-policy\.v\d+$/),
  status: Status,
  riskClasses: z.array(z.object({ id: RiskClassId, priority: z.number().int(), description: z.string(), match: RiskMatcher })).min(1),
  defaultRiskClass: RiskClassId,
  rules: z.array(ReviewRule).min(1),
  independence: z.object({
    humanMayBeSubjectAuthor: z.literal(false),
    humanMayHoldAgentSlotOfSameRound: z.boolean(),
    maxHumanReviewsOfSameAuthorPer7d: z.number().int().nonnegative(),
    assignment: z.enum(["admin_assigned", "random_among_qualified"]),
  }),
  humanReviewSlaHours: z.number().int().positive(),
  /**
   * D24: every audit runs on a contributor's own subscription (wOS pays for no model usage). An audit is a leased
   * review task given to a randomly selected third contributor (never the author, never an original reviewer of the
   * round). A material disagreement upheld by a ruling revokes the original reviewer's receipts (append-only) and
   * raises an AbuseSignal. Audits are themselves rewarded review contributions (AUDIT_RERUN).
   */
  audits: z.object({
    baseRateBp: Bp,
    newAccountRateBp: Bp,
    /** An account is "new" until it has this many qualifying receipts. */
    newAccountReceipts: z.number().int().nonnegative(),
    flaggedAccountRateBp: Bp,
    disagreementRevokesOriginal: z.literal(true),
  }),
  /**
   * D25 + D27 + D28 payout audits (DORMANT in V1, D55). NOT a code review (the code passed the acceptance review + CI
   * before merge). When active, audit quorums run in two places: dispute gates and the mandatory sampled audits. They do
   * NOT ratify PROVISIONAL founder receipts any more: D54 finalizes those by silence after a post-bootstrap challenge
   * publication, or through the review gate's one decision when challenged. Since D49 auditors' agents judge attribution, declared splits, the frozen budget record against
   * its acceptance, duplicate or stacked units under one objective, and budget outliers vs peers — not token usage; the
   * arithmetic is the engine's and anyone can recompute it.
   * Audit tasks are offered to claimants' clients at claim time and run on the claimant's own subscription (duty).
   */
  payoutAudit: z.object({
    quorum: z.number().int().positive(),
    /** Every counting auditor has no receipt on the audited feature. One own-feature slot may be added (signal only). */
    requireOutsideFeature: z.literal(true),
    ownFeatureSlot: z.boolean(),
    /** When fewer eligible active auditors exist, the non-author authorized human sign-off ratifies instead. */
    smallPoolThreshold: z.number().int().positive(),
    /** Duty is owed only when audit tasks are offered at claim time, at most this many per claim. */
    maxDutyTasksPerClaim: z.number().int().positive(),
    dutyReasoning: z.union([ReasoningLevel, z.literal("max")]),
    requireProviderDiversity: z.boolean(),
    sealedUntilAllSubmit: z.literal(true),
    unmetDutyCarryEpochs: z.number().int().positive(),
    /** An auditor whose "plausible" is contradicted by an upheld finding or a later revocation loses that duty credit. */
    contradictedJudgmentRevokesCredit: z.literal(true),
    /** Bonus per upheld inflation finding as a share of the clip. 0 in V1: no weight bonus above a quote (F27; dormant with disputes). */
    upheldInflationBonusBp: Bp,
    /** Inflation findings overruled this many times in 30 days raise false_inflation_findings. */
    falseFindingsSignalAfter: z.number().int().positive(),
    /** Per-run usage and run logs are published when the epoch finalizes, not before (keeps canaries unmatchable). */
    publishUsageAfterFinalization: z.literal(true),
  }),
  /**
   * D27 payout canaries: deterministic, model-free perturbations of real payout lines, indistinguishable in format.
   * Approving one costs the duty credit, revokes the auditor's unfinalized receipts (append-only) and raises
   * payout_canary_passed. Code-defect canaries are not used in V1 (ADR-001 section 3.9).
   */
  canaries: z.object({
    rateBp: Bp,
    newAccountRateBp: Bp,
    flaggedAccountRateBp: Bp,
    perturbations: z.array(PerturbationClass).min(1),
    minMagnitudeBp: z.number().int().positive(),
    maxUsesPerSource: z.number().int().positive(),
    passEffect: z.enum(["revoke_unfinalized_and_flag", "revoke_unfinalized_and_suspend"]),
  }),
  /** Reviewers are assigned by the control plane at random among eligible accounts; never chosen by the author. */
  agentReviewerAssignment: z.literal("random_among_eligible"),
  /**
   * D23: merge authority is separate from qualification. In bootstrap mode the founder may merge anything (an AdminAction
   * `bootstrap_merge`, labelled publicly); the founder's own work so merged gets a PROVISIONAL receipt. Author
   * self-review never satisfies a rule. After bootstrap ends the founder is an ordinary maintainer.
   */
  bootstrap: z.object({
    founderMergeAuthority: z.boolean(),
    founderOwnWorkReceipt: z.literal("PROVISIONAL"),
    selfReviewSatisfiesRules: z.literal(false),
    publicLabel: z.string().min(10),
  }),
  /**
   * D54: PROVISIONAL (founder bootstrap) receipts finalize OPTIMISTICALLY once bootstrap ends: each is published with a
   * challenge window (default = the payout challenge window) and all participants are notified; silence accepts it
   * (qualifying, Genesis-eligible, original timestamp); a challenge sends that receipt to the normal review gate. No
   * recruited reviewer pool or ratification queue; nothing waits on an independent human before bootstrap ends.
   */
  ratification: z.object({
    mode: z.literal("optimistic_challenge"),
    recruitedReviewerPool: z.literal(false),
    /** Bootstrap ends when this many outside contributors (unrelated to the founder) have an accepted receipt. Accepted by D57 (F31). */
    bootstrapEndsAtOutsideContributors: z.number().int().positive(),
    challengeWindowHours: z.number().int().positive(),
    notifyAllParticipants: z.literal(true),
    challengeGoesTo: z.literal("review_gate"),
    finalKeepsOriginalTimestamp: z.literal(true),
  }),
  /**
   * D53: versioned fallbacks. `fable_unavailable`: the Fable seat is replaced by the required human review (founder or
   * authorized reviewers) as the second independent check; Astra remains the agent reviewer (another lab than the Opus
   * builder); a model never reviews work built by the same model; every round and receipt reviewed under it carries
   * the `single_lab_review` label with the reason and is eligible for devnet/shadow accounting only; a later Fable pass
   * is optional and never blocking. Switching is a forward-only, public AdminAction (`switch_review_policy`).
   */
  fallbacks: z.array(
    z.object({
      key: z.literal("fable_unavailable"),
      active: z.boolean(),
      replacesSlot: z.literal("fable"),
      replacementSeat: z.literal("human"),
      agentReviewer: z.literal("astra"),
      authoringModel: z.string().min(1),
      label: z.literal("single_lab_review"),
      laterFablePass: z.literal("optional_never_blocking"),
      sameModelSelfReview: z.literal(false),
      eligibleFor: z.array(z.enum(["devnet", "shadow"])).min(1),
      switchedBy: z.literal("admin_action_forward_only"),
      public: z.literal(true),
    }),
  ),
  /** A human approval is bound to (head sha, submission sha256, context sha256, review policy version); any new revision voids it. */
  approvalBinding: z.literal("head_submission_context_policy"),
  recordDisagreementsAsEvalCases: z.literal(true),
});
export type ReviewPolicy = z.infer<typeof ReviewPolicy>;

// ------------------------------------------------------------------------------------------------ AgentCapabilityPolicy

export const AgentCapabilityPolicy = z.object({
  policyVersion: z.string().regex(/^capability-policy\.v\d+$/),
  status: Status,
  classes: z
    .array(
      z.object({
        id: CapabilityClass,
        description: z.string(),
        qualified: z.array(
          z.object({
            provider: ProviderId,
            modelId: z.string(),
            minReasoning: z.union([ReasoningLevel, z.literal("max")]),
            qualifiedBy: z.enum(["founder_bootstrap", "eval_suite"]),
            evalSuiteVersion: z.string().nullable(),
          }),
        ),
      }),
    )
    .min(1),
  /** Which class a task needs; ABU size can raise it. */
  taskRequirements: z.array(
    z.object({ taskKind: TaskKind, capability: CapabilityClass, minSizePointsForL4: z.number().int().positive().nullable() }),
  ),
  /**
   * Execution caps per task, in micro-ACU: the point where a run is STOPPED (telemetry), not what it is paid (D49).
   * Also the default budget-model inputs: budget = base + perSizePoint x size before multipliers.
   */
  /**
   * D52: CANDIDATE models — listed so they can be tested, eligible for NOTHING until the qualification suite passes for
   * a class (and then only via an entry in `classes[].qualified` with `qualifiedBy: "eval_suite"`). Reviewer and
   * resolver roles need their own, separate qualification.
   */
  candidates: z.array(
    z.object({
      key: z.string().min(1),
      provider: z.enum(["zai"]),
      modelIdPattern: z.string().min(1),
      status: z.literal("candidate"),
      allowedRoles: z.array(z.string()).max(0),
      targetClasses: z.array(CapabilityClass).min(1),
      reviewerOrResolverRequiresSeparateQualification: z.literal(true),
      launchPaths: z.array(
        z.object({
          kind: z.enum(["claude_cli_anthropic_compatible", "zcode_cli"]),
          status: z.enum(["documented", "later"]),
          /** Variables the orchestrator sets or detects; values are the contributor's (wOS never reads credentials). */
          env: z.record(z.string(), z.string()),
          /** A CLI pointed at another endpoint only self-reports its model: attestation records base URL and provider as DECLARED. */
          identity: z.literal("self_reported"),
          notes: z.string(),
        }),
      ),
      qualificationSuite: z.string().min(1),
    }),
  ),
  /**
   * D56: "build next" — versioned, published ranking of the units a contributor is eligible for. Score (integers):
   * reuseWeight x targets served by the unit's catalog feature + unlockWeight x dependent units waiting + focus
   * priority of the unit's target/capability + ageingPerEpoch x epochs since issue (capped); ties by unit id ascending.
   * The contributor's limits are an eligibility filter, never a score. Budgets are identical in both modes.
   */
  assignment: z.object({
    rankingPolicyVersion: z.string().regex(/^build-next-ranking\.v\d+$/),
    modes: z.array(z.enum(["self_pick", "assigned_next"])).length(2),
    weights: z.object({
      reuse: z.number().int().nonnegative(),
      unlock: z.number().int().nonnegative(),
      ageingPerEpoch: z.number().int().nonnegative(),
    }),
    ageingCapEpochs: z.number().int().positive(),
    focus: z.array(
      z.object({ target: z.string().min(1), capabilityClass: CapabilityClass.nullable(), priority: z.number().int().nonnegative() }),
    ),
    tieBreak: z.literal("unit_id_ascending"),
    /** Optional lever (default 0 = off): freshly issued units are offered only to assigned mode for this long. */
    assignedOnlyWindowMinutes: z.number().int().nonnegative(),
  }),
  /**
   * D63 (versioned addition, capability-policy.v2): ONE priority queue for all work ("work next"; supersedes D56's
   * build-only ranking and "budgets identical in both modes"). Deterministic integer score, ties by unit id:
   *   reuse x targets served + unlock x dependents waiting + kindBase[kind] + focus + ageing (from the first
   *   generation's issue epoch when a work hold caused the re-issue, D60 delta) + severityBoost[effective severity]
   *   (D61, the values of bugs-policy.v1) + architectureMigration (D60, architecture-policy.v1 migrationBoost)
   *   + priorityVote (DORMANT; capped at maxBoost, below the migration and critical boosts).
   * kindBase is DERIVED, never set by hand: kindBase[k] = weights.unlock x structuralUnlock[k], where structuralUnlock
   * is the number of merges a task of that kind unblocks by construction (a review unblocks its subject's merge, a
   * triage unblocks its fix); documents rank high through their measured unlock value (dependents waiting).
   * Held units are never offered. Pay: every task has a published BASE price; the queue pays base + queueBonusBp
   * (the "+20% queue bonus"); the reservation at issuance is the queue price, and a claim without the bonus returns
   * the bonus portion to R at acceptance. The v1 assignedOnlyWindow is not carried over (the bonus replaces it).
   */
  workNext: z
    .object({
      rankingPolicyVersion: z.string().regex(/^work-next-ranking\.v\d+$/),
      weights: z.object({
        reuse: z.number().int().nonnegative(),
        unlock: z.number().int().nonnegative(),
        ageingPerEpoch: z.number().int().nonnegative(),
      }),
      ageingCapEpochs: z.number().int().positive(),
      focus: z.array(
        z.object({ target: z.string().min(1), capabilityClass: CapabilityClass.nullable(), priority: z.number().int().nonnegative() }),
      ),
      tieBreak: z.literal("unit_id_ascending"),
      structuralUnlock: z.record(WorkKind, z.number().int().nonnegative()),
      kindBase: z.record(WorkKind, z.number().int().nonnegative()),
      severityBoost: z.object({
        low: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        high: z.number().int().nonnegative(),
        critical: z.number().int().nonnegative(),
      }),
      architectureMigration: z.number().int().nonnegative(),
      /** Provisional 2000 bp (+20%); tunable by public AdminAction, pinned per lease. */
      queueBonusBp: z.number().int().min(0).max(10_000),
      /** Releasing an assigned task before submission: the next claim gets no queue bonus; repeated, a cooldown. */
      declines: z.object({
        windowHours: z.number().int().positive(),
        cooldownAfter: z.number().int().positive(),
        cooldownHours: z.number().int().positive(),
      }),
      /** DORMANT module priority_vote (POLICIES §0 trigger, G-98 preconditions). */
      priorityVote: z.object({
        status: z.enum(["dormant", "active"]),
        subjects: z.array(z.enum(["target", "feature", "bug"])).min(1),
        eligibility: z.literal("governance_seasoning"),
        maxBoost: z.number().int().nonnegative(),
        /** Seasoned vote weight at which the term reaches maxBoost (linear below, capped). */
        saturationWeight: z.number().int().positive(),
      }),
    })
    .optional(),
  /** D52: ModelQualificationSuite — fixed units with known acceptance outcomes, run in devnet shadow mode. */
  qualificationSuites: z.array(
    z.object({
      suiteVersion: z.string().min(1),
      targetClass: CapabilityClass,
      mode: z.literal("devnet_shadow"),
      /** The frozen list of historical/benchmark units and their known outcomes; null until frozen (never invented). */
      unitsManifestSha256: z.string().nullable(),
      passThresholds: z.object({
        minUnits: z.number().int().positive(),
        minAcceptedOfAcceptableBp: z.number().int().min(0).max(10_000),
        maxAcceptedOfRejectedBp: z.number().int().min(0).max(10_000),
      }),
      recordedPer: z.literal("model_version"),
      /** Budget-based pay (D49): qualification never changes budgets; shadow runs earn nothing. */
      affectsBudgets: z.literal(false),
    }),
  ),
  budgets: z.array(
    z.object({
      /** D61: bug_triage joins from capability-policy.v2 (bug_sweep has no budget: sweeps are paid only through confirmed bugs). */
      taskKind: z.union([TaskKind, BugTaskKind.extract(["bug_triage"])]),
      baseMicro: U64String,
      perSizePointMicro: U64String,
      /** Once >= minSamples merged peers exist, cap = P75(peer eligible ACU per size point) x size x headroomBp/1e4. */
      peerBaseline: z.object({ minSamples: z.number().int().positive(), headroomBp: z.number().int().min(10_000).max(30_000) }),
    }),
  ),
});
export type AgentCapabilityPolicy = z.infer<typeof AgentCapabilityPolicy>;

// ------------------------------------------------------------------------------------------------ UsageProofPolicy

export const UsageProofPolicy = z.object({
  policyVersion: z.string().regex(/^usage-proof-policy\.v\d+$/),
  status: Status,
  providers: z.array(
    z.object({
      provider: ProviderId,
      minCliVersion: z.string(),
      primarySource: z.enum(["cli_result_event", "cli_stream_sum", "transcript"]),
      crossCheckSource: z.enum(["cli_stream_sum", "transcript", "none"]),
      notes: z.string(),
    }),
  ),
  plausibility: z.object({
    maxOutputTokensPerSecond: z.number().int().positive(),
    maxTotalTokensPerSecond: z.number().int().positive(),
    /** Result totals vs sum of per-response usage: tolerated relative difference. */
    maxSourceMismatchBp: Bp,
    requireProviderIdsHash: z.boolean(),
    requireTranscriptHash: z.literal(true),
    requireModelMatch: z.boolean(),
  }),
  /**
   * D27 run logs — OPTIONAL evidence since D49 (usage no longer pays): a contributor may attach one to answer an
   * attribution or quality dispute; when attached, per-turn sums must equal the usage telemetry exactly.
   */
  logs: z.object({
    required: z.literal(false),
    maxBytes: z.number().int().positive(),
    maxTurns: z.number().int().positive(),
    retentionDays: z.number().int().positive(),
    requireExactTotals: z.literal(true),
  }),
  audit: z.object({
    /**
     * Extra usage-plausibility re-runs of BUILD work from the same manifest (0 in V1: review audits live in
     * ReviewPolicy.audits; a re-run can judge output and plausibility, never prove historical consumption).
     */
    randomRerunBp: Bp,
    /** Transcript production requests (contributor uploads the transcript matching the hash). */
    transcriptRequestBp: Bp,
    transcriptRetentionDays: z.number().int().positive(),
    divergenceFactorBp: z.number().int().positive(),
  }),
});
export type UsageProofPolicy = z.infer<typeof UsageProofPolicy>;

// ------------------------------------------------------------------------------------------------ RiskPolicy

export const RiskPolicy = z.object({
  policyVersion: z.string().regex(/^risk-policy\.v\d+$/),
  status: Status,
  detectors: z.array(
    z.object({
      id: z.string().min(1),
      signal: z.string().min(1),
      params: z.record(z.string(), z.number()),
      severity: z.enum(["info", "low", "medium", "high"]),
    }),
  ),
  /** What a flag does to a receipt, by the highest signal severity on it. */
  effects: z.object({
    info: z.literal("none"),
    low: z.enum(["none", "hold"]),
    medium: z.enum(["none", "hold", "exclude_pending_review"]),
    high: z.enum(["hold", "exclude_pending_review"]),
  }),
  twoPersonActions: z.array(z.string()),
  walletRebindCooldownDays: z.number().int().nonnegative(),
});
export type RiskPolicy = z.infer<typeof RiskPolicy>;

// ------------------------------------------------------------------------------------------------ MergePolicy

export const MergePolicy = z.object({
  policyVersion: z.string().regex(/^merge-policy\.v\d+$/),
  status: Status,
  requireQualified: z.literal(true),
  requireReviewPolicySatisfied: z.literal(true),
  mergeMethod: z.enum(["merge_queue", "maintainer"]),
  /** Paths whose PRs also need a maintainer approval (CODEOWNERS), e.g. toolchain and protocol paths. */
  maintainerApprovalPathGlobs: z.array(z.string()),
});
export type MergePolicy = z.infer<typeof MergePolicy>;

// ------------------------------------------------------------------------------------------------ CompletionRewardPolicy

export const CompletionRewardPolicy = z.object({
  policyVersion: z.string().regex(/^completion-policy\.v\d+$/),
  status: Status,
  feature: z.object({
    implementersBp: Bp,
    contractAuthorsBp: Bp,
    roadmapAuthorsBp: Bp,
    reviewersBp: Bp,
    finderBp: Bp,
  }),
  application: z.object({ basis: z.literal("lifetime_weight_on_target") }),
  completeness: z.object({
    requireEverySurfaceInProfile: z.literal(true),
    requireAcceptanceSuite: z.literal(true),
    requireSecurityReview: z.boolean(),
    /** D50: exit rights (standard Postgres, settings/env configuration, full data export, no platform-only dependency), not a first-class self-host check. */
    requireExitRightsCheck: z.boolean(),
  }),
  /** Frozen definition per pool; a scope change (new merged roadmap/contract version) appends definitionVersion + 1. */
  definitionChange: z.literal("append_new_version"),
  /** A shared feature's accrual is split equally across the targets whose profiles reference it (D10). */
  sharedFeatureAccrual: z.literal("equal_split_across_referencing_targets"),
  /** Pools of features that are aliased or removed from every profile return to the reserve after this many epochs. */
  returnAfterEpochs: z.number().int().positive(),
});
export type CompletionRewardPolicy = z.infer<typeof CompletionRewardPolicy>;

// ------------------------------------------------------------------------------------------------ GenesisAllocationPolicy

export const GenesisAllocationPolicy = z.object({
  policyVersion: z.string().regex(/^genesis-policy\.v\d+$/),
  status: Status,
  /** Hard cap in base units (never exceeded whatever the evidence says). */
  capBase: U64String,
  cutoff: z.object({ description: z.string(), lastPreProtocolCommit: z.string().nullable() }),
  valuation: z.object({
    /**
     * Accepted output only (Astra-01 item 9): Genesis weight = sum(retro size points) x median eligible ACU per size
     * point of merged IMPLEMENTATION receipts in the reference epochs; WOS = weight x mean realised execution rate over
     * the same live epochs; then capped. Token usage is never reconstructed from commits.
     */
    method: z.literal("accepted_output_reference"),
    referenceEpochs: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }),
    /** Minimum merged IMPLEMENTATION receipts in the reference population before a valuation may be computed. */
    minReferenceReceipts: z.number().int().positive(),
    /**
     * M16 / D48: the reference population is a FROZEN list of receipts, reviewed independently, that excludes every
     * Genesis beneficiary and their related parties; the statistic is computed over exactly the stated epochs.
     */
    referencePopulation: z.literal("frozen_list_reviewed_independently_excluding_genesis_beneficiaries_and_related_parties"),
    /** Published fallback when the population is insufficient: base units per retro size point (400 WOS, provisional). */
    fallbackBasePerSizePoint: U64String,
  }),
  vesting: z.object({
    startsAt: z.literal("mainnet_launch"),
    durationDays: z.number().int().positive(),
    cliffDays: z.number().int().nonnegative(),
  }),
  review: z.object({ riskClass: RiskClassId, founderMayReview: z.literal(false), minIndependentHumans: z.number().int().positive() }),
  /** Genesis never counts PROVISIONAL receipts and never counts test-epoch allocations. */
  excludes: z.object({ provisionalReceipts: z.literal(true), testEpochs: z.literal(true) }),
  mintOnDevnet: z.boolean(),
});
export type GenesisAllocationPolicy = z.infer<typeof GenesisAllocationPolicy>;

// ------------------------------------------------------------------------------------------------ Activation (D33)

export const PolicyKind = z.enum([
  "reward",
  "oracle",
  "review",
  "capability",
  "usage_proof",
  "risk",
  "merge",
  "completion",
  "genesis",
  "governance",
]);
export type PolicyKind = z.infer<typeof PolicyKind>;

/**
 * Every economic number is policy DATA (D33). V1 values are provisional and expected to change. A new version takes
 * effect from a future epoch only (forward-only, never retroactive to published or finalized allocations), is announced
 * publicly at least `minNoticeHours` before that epoch starts, and carries the sha256 of a what-if preview (the engine
 * re-run on recent real epochs under the new version). An emergency activation may target the current epoch only while
 * its allocations are unpublished (OPEN or CALCULATING), only for safety, and is recorded as such.
 */
export const PolicyActivation = z.object({
  kind: PolicyKind,
  version: z.string().min(3),
  effectiveEpoch: z.number().int().positive(),
  announcedAt: z.string(),
  emergency: z.boolean(),
  previewSha256: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .nullable(),
  adminActionId: z.string().uuid(),
});
export type PolicyActivation = z.infer<typeof PolicyActivation>;

export const ACTIVATION_RULES = { minNoticeHours: 72 } as const;

/** Forward-only check; `epochStartsAtMs` is the effective epoch's start. Returns the reasons it is refused. */
export function activationRefusals(
  a: { effectiveEpoch: number; emergency: boolean; announcedAtMs: number; previewSha256: string | null },
  now: {
    openEpoch: number;
    openEpochState: "OPEN" | "CALCULATING" | "PROPOSED" | "FINALIZED" | "DISTRIBUTABLE" | "CLOSED";
    epochStartsAtMs: number;
  },
): string[] {
  const reasons: string[] = [];
  if (a.emergency) {
    if (a.effectiveEpoch < now.openEpoch) reasons.push("an emergency change never applies to a past epoch");
    if (a.effectiveEpoch === now.openEpoch && !(now.openEpochState === "OPEN" || now.openEpochState === "CALCULATING"))
      reasons.push("an emergency change applies only to unpublished allocations");
  } else {
    if (a.effectiveEpoch <= now.openEpoch) reasons.push("a policy change takes effect from the next epoch at the earliest");
    if (now.epochStartsAtMs - a.announcedAtMs < ACTIVATION_RULES.minNoticeHours * 3_600_000)
      reasons.push(`announce at least ${ACTIVATION_RULES.minNoticeHours} h before the effective epoch starts`);
    if (a.previewSha256 === null) reasons.push("attach the what-if preview of the change on recent epochs");
  }
  return reasons;
}

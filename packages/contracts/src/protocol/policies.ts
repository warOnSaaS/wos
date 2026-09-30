/**
 * DRAFT — the versioned policy documents of Proof of Contribution (docs/protocol/POLICIES.md). Every receipt and
 * allocation records the versions in force; a new version never rewrites history. V1 values live in
 * ./data/*.json and are parsed by ./data.ts.
 */
import { z } from "zod";
import { ProviderId, ReasoningLevel } from "../agent-policy.js";
import { TaskKind } from "../agent-io.js";
import {
  AcceptanceEvent,
  CapabilityClass,
  ContributionType,
  DefectClass,
  EvidenceClass,
  ReviewDomain,
  RiskClassId,
  U64String,
  VerificationLevel,
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
    /** Rate ceiling: at most this many base units per ACU of weight in a distributing slice, decaying per epoch. */
    rateCeiling: z.object({ initialBasePerAcu: U64String, decayPpmPerEpoch: Ppm }),
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
    /** Which usage evidence may carry weight, per cluster. Fails closed: an empty list means nothing qualifies. */
    acceptedVerificationLevels: z.object({ devnet: z.array(VerificationLevel), mainnet: z.array(VerificationLevel) }),
    /** Which evidence classes may enter live epochs, per cluster (Astra-01 item 1). */
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
      weightBasis: z.enum(["attested_usage_capped", "acu_equivalent", "none"]),
      needsLease: z.boolean(),
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
  execution: z.object({
    /** Cap = budget from AgentCapabilityPolicy; eligible = min(attested, cap). */
    capIncludesRepairs: z.literal(true),
    /** Agent reviewer bonus per upheld/resolved material finding, as bp of the reviewer's own eligible ACU. */
    upheldFindingBonusBp: Bp,
    maxPaidFindingsPerReview: z.number().int().nonnegative(),
    /** Reviews of an attempt that never merged are paid only if they raised a material finding that was upheld. */
    payReviewsOfFailedAttemptsWithUpheldFindings: z.boolean(),
  }),
  humanReview: z.object({
    /**
     * Fixed ACU-equivalent weight per accepted human review, by risk class, DECOUPLED from the builder's usage
     * (Astra-01 item 5): a reviewer gains nothing from inflated builder compute. Paid in its own capped slice.
     */
    weightAcuEqMicro: z.record(RiskClassId, U64String),
    /** Per material finding the reviewer raised that was upheld or fixed. */
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
  security: z.object({
    /** Security payouts debit the security reserve balance: weight x current execution rate, at most maxShareBp of the balance. */
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
   * D25 review duty and peer ratification. Post-merge, pre-finalization: a receipt becomes RATIFIED after `quorum`
   * sealed RATIFY verdicts from randomly assigned, distinct contributors. Duty reviews are AGENT runs the claimant's
   * wOS client executes automatically at claim time on the claimant's own subscription.
   */
  ratification: z.object({
    quorum: z.number().int().positive(),
    /** When fewer eligible active ratifiers exist, the non-author authorized human sign-off ratifies instead. */
    smallPoolThreshold: z.number().int().positive(),
    /** Duty tasks owed per execution/planning receipt being claimed. Aggregate supply needs >= quorum (see ADR). */
    dutyPerReceipt: z.number().int().nonnegative(),
    maxDutyTasksPerClaim: z.number().int().positive(),
    /** Duty runs use this reasoning (a floor), or "max" = the pinned AgentPolicy maximum. */
    dutyReasoning: z.union([ReasoningLevel, z.literal("max")]),
    /** With quorum >= 2 the ratifiers must include both providers (uncorrelated model errors). */
    requireProviderDiversity: z.boolean(),
    sealedUntilAllSubmit: z.literal(true),
    /** Allocations of an account with unmet duty are withheld (not forfeited) for this many epochs, then return to R. */
    unmetDutyCarryEpochs: z.number().int().positive(),
    /** A ratifier whose RATIFY is later contradicted (receipt revoked for a defect) loses that duty credit. */
    contradictedRatificationRevokesCredit: z.literal(true),
  }),
  /**
   * D26 canary (honeypot) ratification packets, indistinguishable in format from real ones. A PASS on a canary revokes
   * the reviewer's not-yet-finalized receipts (append-only), raises canary_passed, removes the duty credit, and flags
   * or suspends per RiskPolicy. Canaries catch lazy or scripted clients; they cannot stop a client that cross-checks
   * every packet against the public repository (ABUSE-MODEL.md section 5).
   */
  canaries: z.object({
    rateBp: Bp,
    newAccountRateBp: Bp,
    flaggedAccountRateBp: Bp,
    mutationClasses: z.array(DefectClass).min(1),
    /** A canary source is used at most this many times, then retired (pool rotation, leakage control). */
    maxUsesPerCase: z.number().int().positive(),
    catchToleranceLines: z.number().int().nonnegative(),
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
    ratificationQueueFirst: z.literal(true),
  }),
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
  /** Compute caps (authorised budget) per task, in micro-ACU. Implementation: perSizePoint x size. */
  budgets: z.array(
    z.object({
      taskKind: TaskKind,
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
      primarySource: z.enum(["cli_result_event", "cli_stream_sum"]),
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
    requireSelfHostCheck: z.boolean(),
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
    /** Minimum merged IMPLEMENTATION receipts in the reference window before a valuation may be computed. */
    minReferenceReceipts: z.number().int().positive(),
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

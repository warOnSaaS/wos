/**
 * DRAFT — Proof of Contribution entities (Amendment 02, docs/protocol/PROTOCOL.md). Pending the Astra review
 * (docs/protocol/REVIEW-PACKET.md). Nothing in services imports this yet; do not wire it before the review.
 *
 * Units (docs/protocol/REWARD-PROTOCOL.md section 2):
 *   provider tokens   integers as reported by the CLI (never mapped to WOS directly)
 *   micro-ACU         normalised agent compute, 1 ACU = 1_000_000 micro-ACU, decimal string (U64String)
 *   base units        WOS base units, 1 WOS = 10^6 base units (the SPL mint has 6 decimals), decimal string
 * Large integers are decimal strings so canonical JSON (canonical.ts C-1, which refuses bigint) can hash them.
 */
import { z } from "zod";
import { ProviderId, ReasoningLevel } from "../agent-policy.js";
import { BugId, BugSeverity, TriageOutcome } from "../bugs.js";
import { AbuKey, FeatureKey, GitSha, RepoFullName, Sha256, TargetSlug, Timestamp, Uuid } from "../primitives.js";

export const PROTOCOL_DRAFT_VERSION = "poc-draft.1" as const;

const U64_MAX = 18_446_744_073_709_551_615n;
/** Unsigned 64-bit integer as a decimal string without leading zeros (fits a Solana u64). */
export const U64String = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/, "decimal u64 string")
  .refine((s) => BigInt(s) <= U64_MAX, "exceeds u64");
export type U64String = z.infer<typeof U64String>;

/** Signed 64-bit integer as a decimal string (offsets and adjustments). */
export const I64String = z.string().regex(/^(0|-?[1-9][0-9]{0,18})$/, "decimal i64 string");
export type I64String = z.infer<typeof I64String>;

/** Solana address: base58 of 32 bytes (32–44 chars). Format check only; on-curve checks happen in the wallet binder. */
export const SolanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "base58 Solana address");
export type SolanaAddress = z.infer<typeof SolanaAddress>;

export const SolanaCluster = z.enum(["devnet", "mainnet-beta"]);
export type SolanaCluster = z.infer<typeof SolanaCluster>;

// ------------------------------------------------------------------------------------------------ vocabulary

/** How much of a usage figure wOS can stand behind (USAGE-PROOF.md section 3). Never upgrade a level in UI copy. */
export const VerificationLevel = z.enum([
  /** Provider-signed or provider-queried by wOS. Not achievable for subscription CLIs in V1. */
  "VERIFIED",
  /** Reported by the official client from the CLI's own usage fields, device-signed, passed plausibility checks. */
  "ATTESTED",
  /** Computed by the server from what it can see (manifest size, output size, turns). */
  "ESTIMATED",
  /** Missing, malformed or failed plausibility. */
  "UNVERIFIED",
]);
export type VerificationLevel = z.infer<typeof VerificationLevel>;

export const ContributionType = z.enum([
  "APPLICATION_ROADMAP",
  "FEATURE_SPECIFICATION",
  "ARCHITECTURE_RESOLUTION",
  "IMPLEMENTATION",
  "AGENT_REVIEW",
  "HUMAN_REVIEW",
  "SECURITY",
  "INTEGRATION",
  "DOCUMENTATION",
  "OTHER_PROTOCOL_APPROVED",
  // Added by the architect (ADR-001 section 4): outcome-rewarded and audit work.
  "PROPOSAL",
  "BUG_REPORT",
  "AUDIT_RERUN",
  "GENESIS",
  // D61 (bugs and maintenance, a versioned addition to frozen protocol v1): the triage decision and the fix of a bug.
  "BUG_TRIAGE",
  "BUG_FIX",
]);
export type ContributionType = z.infer<typeof ContributionType>;

/** Where a receipt's weight competes for WOS inside an epoch (REWARD-PROTOCOL.md section 5). */
export const RewardSlice = z.enum(["execution", "planning", "human_review", "outcomes", "completion_accrual", "security_reserve"]);
export type RewardSlice = z.infer<typeof RewardSlice>;

/** Slices that pay contributors directly each epoch; the other two accrue to rules-bound pools (Astra-01 item 4). */
export const DISTRIBUTING_SLICES = ["execution", "planning", "human_review", "outcomes"] as const;
export type DistributingSlice = (typeof DISTRIBUTING_SLICES)[number];

/**
 * What a receipt's payout rests on. Stored permanently; UI and allocations never upgrade it. D49 removed usage as a
 * basis for pay: provider usage is TELEMETRY (cap enforcement, budget calibration, signals).
 *   accepted_budget  the task's reward budget, fixed before work started, paid on acceptance (build units, planning,
 *                    commissioned reviews, audits and resolutions)
 *   outcome          ACU-equivalent weight for an outcome (proposal incorporated, bug fixed) in the outcomes slice
 *   historical       Genesis historical credit (never mixed into epoch slices)
 */
export const EvidenceClass = z.enum(["accepted_budget", "outcome", "historical"]);
export type EvidenceClass = z.infer<typeof EvidenceClass>;

/** The event that makes each contribution type accepted, and who causes it (Astra-01 item 10). */
export const AcceptanceEvent = z.enum([
  "pr_merged",
  "document_merged",
  "subject_merged_or_finding_upheld",
  "ruling_confirmed_by_maintainer",
  "security_confirmed_and_fix_merged",
  "proposal_incorporated",
  "bug_fix_merged",
  "triage_decision_confirmed",
  "audit_report_accepted",
  "genesis_approved",
]);
export type AcceptanceEvent = z.infer<typeof AcceptanceEvent>;

/** Capability classes replace model brands in policy (POLICIES.md section 4). */
export const CapabilityClass = z.enum([
  "BUILD_L1",
  "BUILD_L2",
  "BUILD_L3",
  "BUILD_L4",
  "PLAN_L1",
  "REVIEW_A",
  "REVIEW_B",
  "ARCHITECT_L1",
  "SECURITY_REVIEW_L1",
]);
export type CapabilityClass = z.infer<typeof CapabilityClass>;

/** Canonical provider usage. `inputTokens` is UNCACHED input; `outputTokens` INCLUDES reasoning (USAGE-PROOF.md 2.3). */
export const ProviderUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Informational subset of outputTokens; never priced separately (no double counting). */
  reasoningOutputTokens: z.number().int().nonnegative(),
});
export type ProviderUsage = z.infer<typeof ProviderUsage>;

export const UsageSource = z.enum(["cli_result_event", "cli_stream_sum", "transcript", "provider_api", "server_estimate"]);
export type UsageSource = z.infer<typeof UsageSource>;

export const CheckResult = z.object({
  id: z.string().min(1),
  result: z.enum(["pass", "fail", "skip"]),
  detail: z.string().max(1000),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const PolicyVersions = z.object({
  reward: z.string(),
  oracle: z.string(),
  review: z.string(),
  usageProof: z.string(),
  /** agent-policy.v<n> (argv, roles) */
  agent: z.string(),
  /** capability-policy.v<n> (classes, caps) */
  capability: z.string(),
  risk: z.string(),
  merge: z.string(),
  completion: z.string(),
});

/**
 * Frozen at lease issue (Astra-01 item 8): the versions a run executes under, its capability class, its reasoning
 * requirement and its compute cap. The run's ACU is computed with THIS oracle whatever epoch it lands in.
 */
export const RunPolicySnapshot = z.object({
  schema: z.literal("wos-run-policy-snapshot.v1"),
  leaseId: Uuid,
  leaseGeneration: z.number().int().positive(),
  policyVersions: PolicyVersions,
  capabilityClass: z.string(),
  provider: ProviderId,
  modelId: z.string(),
  /** Always the pinned AgentPolicy maximum for review roles ("max", never "ultra"); a floor for builders. */
  reasoningRequired: ReasoningLevel,
  /** Remaining compute budget of the attempt/subject when this lease was issued (reservation, Astra-01 item 6). */
  reservedCapAcuMicro: U64String,
  /**
   * Review 04 finding 6: the policy-derived human-review requirement and risk class, pinned at lease issue. REQUIRED:
   * the qualification rule parses the stored snapshot with this schema and fails closed when either is missing.
   */
  humanReviewRequired: z.boolean(),
  riskClass: z.string().min(1),
  /**
   * D63 (versioned addition): how the task was claimed — from the work-next queue or self-picked — the queue bonus,
   * and whether it applies (a queue claim, unless the contributor's last assigned task was released by them), all
   * PINNED at lease. The base price is always paid; the "+20% queue bonus" only when it applies. Absent in v1 = full.
   */
  claim: z
    .object({ mode: z.enum(["queue", "self_pick"]), queueBonusBp: z.number().int().min(0).max(10_000), bonusApplies: z.boolean() })
    .refine((c) => !c.bonusApplies || c.mode === "queue", "only a queue claim earns the queue bonus")
    .optional(),
  issuedAt: Timestamp,
});
export type RunPolicySnapshot = z.infer<typeof RunPolicySnapshot>;
export type PolicyVersions = z.infer<typeof PolicyVersions>;

// ------------------------------------------------------------------------------------------------ UsageReceipt

/** One per agent run. Immutable; canonical hash = usageReceiptSha256 (protocol/receipts.ts). */
export const UsageReceipt = z.object({
  schema: z.literal("wos-usage-receipt.v1"),
  id: Uuid,
  agentRunId: Uuid,
  leaseId: Uuid,
  accountId: Uuid,
  provider: ProviderId,
  cliVersion: z.string(),
  modelIdRequested: z.string(),
  modelIdReported: z.string().nullable(),
  reasoningRequested: ReasoningLevel,
  /** What the CLI's own records say ran (claude transcripts carry `effort`); null when the CLI does not say. */
  reasoningObserved: ReasoningLevel.nullable(),
  /** Lease fencing token (Astra-01 item 7) and the run-policy snapshot pinned at lease issue (item 8). */
  leaseGeneration: z.number().int().positive(),
  runPolicySnapshotSha256: Sha256,
  usage: ProviderUsage,
  usageSource: UsageSource,
  /**
   * Usage events are deduplicated by provider response id (msg_… / resp_…); the receipt stores their count and the
   * sha256 of the sorted id list, never the ids. Unique per id across all receipts (migration 0007).
   */
  usageEventCount: z.number().int().nonnegative(),
  usageEventIdsSha256: Sha256.nullable(),
  transcriptSha256: Sha256,
  verificationLevel: VerificationLevel,
  oracleVersion: z.string(),
  /** Normalised compute of this run at the oracle version above. */
  acuMicro: U64String,
  plausibility: z.array(CheckResult),
  usageProofPolicyVersion: z.string(),
  issuedAt: Timestamp,
});
export type UsageReceipt = z.infer<typeof UsageReceipt>;

// ------------------------------------------------------------------------------------------------ AgentRun view

/** Part B's first-class AgentRun, assembled from agent_runs + leases + usage_receipts + review/merge state. */
export const AgentRunView = z.object({
  id: Uuid,
  contributorAccountId: Uuid,
  wallet: SolanaAddress.nullable(),
  abu: AbuKey.nullable(),
  leaseId: Uuid,
  taskKind: z.string(),
  provider: ProviderId,
  modelIdRequested: z.string(),
  modelIdReported: z.string().nullable(),
  capabilityClass: CapabilityClass,
  contextManifestSha256: Sha256,
  baseCommit: GitSha.nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  usage: ProviderUsage.nullable(),
  verificationLevel: VerificationLevel,
  capAcuMicro: U64String,
  acuMicro: U64String,
  status: z.object({
    verification: z.enum(["pending", "passed", "failed", "n/a"]),
    astra: z.enum(["pending", "passed", "gaps", "n/a"]),
    fable: z.enum(["pending", "passed", "gaps", "n/a"]),
    human: z.enum(["pending", "passed", "failed", "n/a"]),
    contribution: z.enum(["running", "pending_merge", "pending_reward", "finalized", "excluded", "failed"]),
  }),
  pr: z.object({ repo: RepoFullName, number: z.number().int().positive() }).nullable(),
  mergeCommit: GitSha.nullable(),
  rewardPolicyVersion: z.string(),
  oracleVersion: z.string(),
});
export type AgentRunView = z.infer<typeof AgentRunView>;

// ------------------------------------------------------------------------------------------------ ContributionReceipt

export const SubjectRef = z.object({
  kind: z.enum(["attempt", "document", "review", "human_review", "proposal", "security_report", "genesis", "audit", "payout_audit"]),
  id: Uuid,
});
export type SubjectRef = z.infer<typeof SubjectRef>;

/**
 * The immutable record that a contribution qualified. Canonical hash = contributionReceiptSha256. Its `weightMicro`
 * is what competes in the epoch slice; the WOS amount is NOT in the receipt (it is decided at epoch finalization).
 */
export const ContributionReceipt = z.object({
  schema: z.literal("wos-contribution-receipt.v1"),
  id: Uuid,
  contributorAccountId: Uuid,
  /** GitHub identity that did the work (D8 provenance), null for non-GitHub work (human review, genesis). */
  githubUserId: z.number().int().positive().nullable(),
  contributionType: ContributionType,
  slice: RewardSlice,
  target: TargetSlug.nullable(),
  feature: FeatureKey.nullable(),
  abu: AbuKey.nullable(),
  subject: SubjectRef,
  agentRunIds: z.array(Uuid),
  usageReceiptSha256s: z.array(Sha256),
  contextManifestSha256: Sha256.nullable(),
  baseCommit: GitSha.nullable(),
  mergeCommit: GitSha.nullable(),
  pr: z.object({ repo: RepoFullName, number: z.number().int().positive() }).nullable(),
  verificationResultSha256: Sha256.nullable(),
  reviews: z.object({
    astraReviewSha256: Sha256.nullable(),
    fableReviewSha256: Sha256.nullable(),
    humanReviewSha256s: z.array(Sha256),
    /**
     * D53: labels the review policy put on this receipt. Under the `fable_unavailable` fallback every receipt carries
     * `single_lab_review` with the reason; it is eligible for devnet/shadow accounting only.
     */
    labels: z.array(z.object({ label: z.literal("single_lab_review"), reason: z.string().min(5) })),
  }),
  /** D49: the task budget (micro-ACU) for commissioned work, or the ACU-equivalent weight of an outcome. */
  weightMicro: U64String,
  weightBasis: z.enum(["task_budget", "acu_equivalent"]),
  /** D49: the task whose budget this receipt is paid from, and this contributor's declared share of it. */
  taskBudget: z
    .object({
      taskId: Uuid,
      budgetAcuMicro: U64String,
      issuedEpoch: z.number().int().positive(),
      shareBp: z.number().int().min(1).max(10_000),
    })
    .nullable(),
  evidenceClass: EvidenceClass,
  acceptanceEvent: AcceptanceEvent,
  leaseId: Uuid.nullable(),
  leaseGeneration: z.number().int().positive().nullable(),
  runPolicySnapshotSha256s: z.array(Sha256),
  /** TELEMETRY only (D49): observed ACU and its lowest verification level; never part of the payout. */
  telemetry: z.object({ observedAcuMicro: U64String, lowestVerificationLevel: VerificationLevel }).nullable(),
  /**
   * D38: the Contributor (the natural person above, accountable) and the Beneficiary (who receives the allocation), as
   * of qualification time. Default beneficiary is the contributor; with an active sponsorship link it is the
   * organization, with the link's split. Past receipts never change when a link ends.
   */
  beneficiary: z.object({
    kind: z.enum(["person", "organization"]),
    organizationId: Uuid.nullable(),
    sponsorshipId: Uuid.nullable(),
    /** Share to the organization in bp; the rest to the contributor. 10000 = all to the organization. */
    organizationShareBp: z.number().int().min(0).max(10_000),
  }),
  /**
   * D23 (founder, resolving Astra-01 item 2): merge authority is separate from reward qualification.
   *   independent        the review policy was satisfied by non-authors; born ACTIVE
   *   founder_bootstrap  the founder's own work merged under bootstrap authority; the receipt is born PROVISIONAL
   */
  independence: z.enum(["independent", "founder_bootstrap"]),
  /** Born ACTIVE (independent work) or PROVISIONAL (founder bootstrap work); see ReceiptStatus. */
  initialStatus: z.enum(["ACTIVE", "PROVISIONAL"]),
  policyVersions: PolicyVersions,
  epochNumber: z.number().int().positive(),
  qualifiedAt: Timestamp,
});
export type ContributionReceipt = z.infer<typeof ContributionReceipt>;

/**
 * Receipt qualification status (D23, D28). Receipts are immutable; status is the latest ReceiptStatusEvent.
 *   ACTIVE       independent merged work: counts in live epochs (payouts are verified optimistically, D28)
 *   PROVISIONAL  the founder's own work merged under bootstrap authority (D23): public, test epochs only, until it
 *                finalizes (D54: silence after its post-bootstrap challenge publication) or a challenge is decided
 *   RATIFIED     a PROVISIONAL receipt accepted by an independent human (or, when active, an audit quorum) — e.g. after a
 *                challenge sent it to the review gate; counts live, original qualifiedAt kept
 *   FINAL_BY_SILENCE  D54 (review 06 R06-2): a PROVISIONAL receipt whose persisted, post-bootstrap challenge publication
 *                closed with no challenge. Its own evidence class — never an independent ratification; counts live,
 *                original qualifiedAt kept; devnet/shadow labels and Genesis/mainnet gates still apply
 *   REVOKED      invalidated by an AdminAction or a dispute gate outcome; never deleted
 * A rejected ratification keeps PROVISIONAL (rejection recorded). Clips are separate records (ReceiptClip).
 */
export const ReceiptStatus = z.enum(["ACTIVE", "PROVISIONAL", "RATIFIED", "FINAL_BY_SILENCE", "REVOKED"]);
export type ReceiptStatus = z.infer<typeof ReceiptStatus>;

export const ReceiptStatusEventKind = z.enum([
  "issued",
  "quorum_ratified",
  "human_signoff",
  "ratification_rejected",
  /** D54: the challenge publication closed with no challenge (server time, under the subject lock). */
  "final_by_silence",
  "revoked",
  "restored",
]);

/**
 * D54 (review 06 R06-2): the persisted, server-stamped challenge publication of a PROVISIONAL receipt after bootstrap
 * ended. `closesAt` is fixed at publication; the receipt's own `qualifiedAt` is a separate, older clock.
 */
export const ProvisionalChallengePublication = z.object({
  receiptId: Uuid,
  receiptSha256: Sha256,
  reviewPolicyVersion: z.string(),
  bootstrapEndedAt: Timestamp,
  publishedAt: Timestamp,
  closesAt: Timestamp,
  /** Where it was published and who was notified (public evidence). */
  notification: z.object({ publicUrl: z.string().min(1), notifiedParticipants: z.number().int().nonnegative() }),
});
export type ProvisionalChallengePublication = z.infer<typeof ProvisionalChallengePublication>;
export type ReceiptStatusEventKind = z.infer<typeof ReceiptStatusEventKind>;

export const ReceiptStatusEvent = z.object({
  receiptId: Uuid,
  from: ReceiptStatus.nullable(),
  to: ReceiptStatus,
  kind: ReceiptStatusEventKind,
  /** The audit quorum (quorum_ratified / ratification_rejected), the human review (human_signoff) or the admin action. */
  quorumId: Uuid.nullable(),
  humanReviewId: Uuid.nullable(),
  adminActionId: Uuid.nullable(),
  at: Timestamp,
});
export type ReceiptStatusEvent = z.infer<typeof ReceiptStatusEvent>;

// ------------------------------------------------------------------------------------------------ Optimistic payouts (D28, D29)

/**
 * The human-readable explanation published with every proposed allocation line, to every participant of the epoch
 * (D28, D29). Pseudonymous: handle or a stable pseudonym plus wallet; never e-mail.
 */
export const AllocationExplanation = z.object({
  schema: z.literal("wos-allocation-explanation.v1"),
  epochNumber: z.number().int().positive(),
  pseudonym: z.string().min(3).max(60),
  wallet: SolanaAddress.nullable(),
  slice: z.string().min(1),
  amountBase: I64String,
  /** e.g. "14,023 WOS = 312,004 attested tokens on claude-opus-5-5 -> 4.1 ACU x 3,420 WOS/ACU (epoch rate)". */
  sentence: z.string().min(10).max(1000),
  receipts: z.array(
    z.object({
      receiptId: Uuid,
      contributionType: ContributionType,
      model: z.string().nullable(),
      usage: ProviderUsage.nullable(),
      weightMicro: U64String,
      runLogSummary: z.object({ turns: z.number().int(), repairLoops: z.number().int(), toolCalls: z.number().int() }).nullable(),
      attribution: z.array(z.string().max(200)),
    }),
  ),
  policyVersions: PolicyVersions,
});
export type AllocationExplanation = z.infer<typeof AllocationExplanation>;

/**
 * Deterministic anomaly metrics (engine output, reproducible, D29). The challenge UI ranks allocations by these.
 * Ratios are in basis points of the peer P50 for a comparable key (task kind, capability class, model, size points).
 */
export const AnomalyMetrics = z.object({
  accountId: Uuid,
  epochNumber: z.number().int().positive(),
  receipts: z.number().int().nonnegative(),
  /** Median over the account's receipts of weight / peer P50 (bp). 10000 = exactly typical. */
  medianPeerRatioBp: z.number().int().nonnegative(),
  /** Share of receipts at >= 95% of their cap (bp). */
  capSaturationBp: z.number().int().min(0).max(10_000),
  /** Share of receipts above peer P50 (bp); a skim shows as ~10000 with a modest median ratio. */
  aboveP50ShareBp: z.number().int().min(0).max(10_000),
  /**
   * Consistency statistic x 1000: sum over receipts of sign(log ratio) / sqrt(n) (a sign test). Small but consistent
   * inflation across many receipts grows like sqrt(n) even when each receipt is only slightly high.
   */
  consistencyMilli: z.number().int(),
  /** Weight per changed line relative to peers (bp), when the receipts carry diffs. */
  perLinePeerRatioBp: z.number().int().nonnegative().nullable(),
  /** Deterministic rank score used to order the challenge list (higher = look first). */
  rankScore: z.number().int(),
});
export type AnomalyMetrics = z.infer<typeof AnomalyMetrics>;

/** D49: disputes are about attribution, splits, acceptance, budgets and defects — never about token usage. */
export const DisputeReason = z.enum([
  "budget_mismatch",
  "unmet_acceptance",
  "defective_work",
  "misattribution",
  "duplicate_work",
  "split_gaming",
  "other",
]);
export type DisputeReason = z.infer<typeof DisputeReason>;

export const DisputeEvidence = z.object({
  kind: z.enum(["run_log_turn", "diff", "peer_baseline", "anomaly_metric", "cluster", "other"]),
  ref: z.string().min(1).max(300),
  note: z.string().min(10).max(2000),
});

/**
 * One dispute over ANY set of proposed allocations of the epoch (D28–D31): a single allocation, several receipts of
 * one person, a whole "pattern", or a suspected cluster across contributors and features. Standing: any account with an
 * allocation in the same epoch. The disputer escrows a stake (scaled by the number of items, capped) from their own
 * pending allocation; each item is resolved independently. The note is UNTRUSTED text: auditors see it delimited.
 */
export const AllocationDispute = z.object({
  schema: z.literal("wos-allocation-dispute.v1"),
  id: Uuid,
  epochNumber: z.number().int().positive(),
  disputerAccountId: Uuid,
  items: z
    .array(
      z.object({
        allocationId: Uuid,
        reason: DisputeReason,
        evidence: z.array(DisputeEvidence).min(1).max(20),
        proposedAmountBase: U64String.nullable(),
      }),
    )
    .min(1)
    .max(100),
  /** Evidence shared across items (e.g. cluster linkage), shown to every item's auditors. */
  sharedEvidence: z.array(DisputeEvidence).max(20),
  note: z.string().max(4000),
  stakeBase: U64String,
  openedAt: Timestamp,
});
export type AllocationDispute = z.infer<typeof AllocationDispute>;

/** Per-allocation outcome of a dispute gate, from the allocation's point of view. */
export const DisputeItemResolution = z.object({
  disputeId: Uuid,
  allocationId: Uuid,
  outcome: z.enum(["UPHELD", "CLIPPED", "REVOKED"]),
  quorumId: Uuid.nullable(),
  adminActionId: Uuid.nullable(),
  /** Amount that stands after the gate. */
  resultingAmountBase: U64String,
  excessBase: U64String,
  resolvedAt: Timestamp,
});
export type DisputeItemResolution = z.infer<typeof DisputeItemResolution>;

/**
 * Settlement of a whole dispute, DERIVED from the gate resolutions it holds bounty priority on (H10): the recovered
 * excess of those items, the bounty (bountyBp of recovered only, D41), and the stakes of its REJECTED items (per item,
 * D43). The database recomputes all three and refuses anything else.
 */
export const DisputeSettlement = z.object({
  disputeId: Uuid,
  totalExcessBase: U64String,
  recoveredBase: U64String,
  bountyBase: U64String,
  stakeForfeitedBase: U64String,
  settledAt: Timestamp,
});
export type DisputeSettlement = z.infer<typeof DisputeSettlement>;

/** Bounty = bountyBp of what was actually RECOVERED (D41); never of an uncollected excess. */
export function disputeBounty(recoveredBase: bigint, bountyBp: number): bigint {
  return (recoveredBase * BigInt(bountyBp)) / 10_000n;
}

/**
 * Per-item stakes (D43): each item costs max(minStakeBase, stakePerItemBp x pending), where the bp part across the
 * bundle is capped at maxStakeBp x pending (large earners); the floor always applies (small earners pay a real,
 * small amount). The total can never exceed the disputer's pending allocation: too many items is refused.
 */
export function disputeItemStakes(
  pendingBase: bigint,
  items: number,
  p: { stakePerItemBp: number; maxStakeBp: number; minStakeBase: string },
): bigint[] {
  if (!Number.isInteger(items) || items < 1) throw new Error("a dispute has at least one item");
  const perItemBp = (pendingBase * BigInt(p.stakePerItemBp)) / 10_000n;
  const capPerItem = (pendingBase * BigInt(p.maxStakeBp)) / 10_000n / BigInt(items);
  const floor = BigInt(p.minStakeBase);
  const bpPart = perItemBp < capPerItem ? perItemBp : capPerItem;
  const each = bpPart > floor ? bpPart : floor;
  if (each * BigInt(items) > pendingBase) throw new Error("the stakes of this many items exceed your pending allocation");
  return Array.from({ length: items }, () => each);
}

/** Forfeited stake = the stakes of the items the gate rejected (UPHELD); valid items refund their own stake. */
export function stakeForfeited(items: ReadonlyArray<{ stakeBase: bigint; outcome: "UPHELD" | "CLIPPED" | "REVOKED" }>): bigint {
  return items.reduce((t, i) => t + (i.outcome === "UPHELD" ? i.stakeBase : 0n), 0n);
}

// ------------------------------------------------------------------------------------------------ Confiscation (D39)

/**
 * After a finding with recorded evidence, the NOTICE places holds on identified protocol-held sources (A3-4: holds apply
 * at notice and reduce each source's remaining balance, possibly partially): pending allocations, unreleased holdback,
 * unclaimed entitlements. The holds EXECUTE only after the reply and appeal windows (no appeal) or an upheld appeal
 * decided after the reply window by its own two-person action; an overturned appeal or a lapsed hold releases them.
 * Compensatory only: holds never exceed the proven excess; any proven excess still unrecovered becomes an offset.
 * Punitive forfeiture is not implemented (founder decision F17). Never on-chain seizure of released tokens.
 */
export const ConfiscationSource = z.enum(["pending_allocation", "holdback", "unclaimed_entitlement", "genesis_unvested"]);
export type ConfiscationSource = z.infer<typeof ConfiscationSource>;

export const Confiscation = z.object({
  id: Uuid,
  beneficiaryId: z.string().min(1),
  provenExcessBase: U64String,
  findingRef: z.string().min(1),
  sources: z.array(z.object({ kind: ConfiscationSource, sourceId: z.string().min(1), amountBase: U64String })).min(1),
  /** Two-person AdminAction bound to this confiscation's id (H12). */
  adminActionId: Uuid,
  noticeAt: Timestamp,
  replyClosesAt: Timestamp,
  appealClosesAt: Timestamp,
  /** A3-4: holds lapse (release) at this time unless executed; server-set to appeal close + 14 days (F17). */
  holdExpiresAt: Timestamp,
  appeal: z.object({ appellantAccountId: Uuid, filedAt: Timestamp }).nullable(),
  decision: z.object({ decision: z.enum(["upheld", "overturned"]), adminActionId: Uuid, decidedAt: Timestamp }).nullable(),
  executedAt: Timestamp.nullable(),
});
export type Confiscation = z.infer<typeof Confiscation>;

export const Exclusion = z.object({
  id: Uuid,
  accountId: Uuid,
  scope: z.array(z.enum(["rewards", "voting", "review", "duty"])).min(1),
  /** null = permanent (needs a structural governance vote; founder AdminAction in founder mode). */
  untilEpoch: z.number().int().positive().nullable(),
  governanceProposalId: Uuid.nullable(),
  adminActionId: Uuid,
});
export type Exclusion = z.infer<typeof Exclusion>;

/** Allocation lifecycle per (epoch, account): derived from the epoch state and disputes (PROTOCOL.md section 4.4). */
export const AllocationState = z.enum([
  "PROPOSED",
  "CHALLENGE_OPEN",
  "FINALIZED",
  "DISPUTED",
  "UNDER_REVIEW",
  "UPHELD",
  "CLIPPED",
  "REVOKED",
  "FINAL",
]);
export type AllocationState = z.infer<typeof AllocationState>;

// ------------------------------------------------------------------------------------------------ Payout audit duty (D25, D27)

/**
 * Scrubbed, structured run log submitted with every AgentRun (D27). It never contains prompt or response text, tool
 * arguments, environment values or paths outside the worktree; chunk hashes let an audit ask for the matching raw
 * transcript chunk later. Evidence stays ATTESTED; a log that is consistent with the usage receipt and the diff ranks
 * above bare numbers (UsageProofPolicy.logs).
 */
export const RunLog = z.object({
  schema: z.literal("wos-run-log.v1"),
  agentRunId: Uuid,
  provider: ProviderId,
  scrubberVersion: z.string().min(1),
  turns: z
    .array(
      z.object({
        i: z.number().int().nonnegative(),
        startedAt: Timestamp,
        endedAt: Timestamp,
        /** Provider response id, hashed (P-2 dedup uses the raw ids client-side; the log carries only hashes). */
        responseIdSha256: Sha256.nullable(),
        usage: z.object({
          inputTokens: z.number().int().nonnegative(),
          cachedInputTokens: z.number().int().nonnegative(),
          cacheWriteInputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
        }),
        toolCalls: z
          .array(
            z.object({
              tool: z.string().min(1).max(40),
              /** Repo-relative path when the call touched one, else null; never a path outside the worktree. */
              path: z.string().max(400).nullable(),
              argsSha256: Sha256,
              exitCode: z.number().int().nullable(),
            }),
          )
          .max(200),
        chunkSha256: Sha256,
      }),
    )
    .max(2000),
  repairLoops: z.array(
    z.object({
      i: z.number().int().nonnegative(),
      reason: z.enum(["verify_failed_locally", "review_findings", "rebase"]),
      firstTurn: z.number().int().nonnegative(),
      lastTurn: z.number().int().nonnegative(),
    }),
  ),
});
export type RunLog = z.infer<typeof RunLog>;

/** Sum of a run log's per-turn usage; must equal the usage receipt (else the run is UNVERIFIED, fail closed). */
export function runLogTotals(log: RunLog): {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
} {
  return log.turns.reduce(
    (s, t) => ({
      inputTokens: s.inputTokens + t.usage.inputTokens,
      cachedInputTokens: s.cachedInputTokens + t.usage.cachedInputTokens,
      cacheWriteInputTokens: s.cacheWriteInputTokens + t.usage.cacheWriteInputTokens,
      outputTokens: s.outputTokens + t.usage.outputTokens,
    }),
    { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0 },
  );
}

/**
 * What an auditing client receives: an opaque packet (D27). It holds the payout lines of one feature slice in an
 * epoch (receipts referenced by packet-local refs, not ids), their run logs, the diff and contract excerpts, the
 * attribution (authors, reviewers, proposer, planning shares) and peer baselines for comparable units. The
 * deterministic numbers (ACU normalisation, splits, rounding) are shown for context only: anyone can recompute them.
 * Per-run usage and logs are published only after the epoch finalizes, so a packet cannot be matched against public
 * records during the audit window.
 */
export const PayoutAuditPacket = z.object({
  schema: z.literal("wos-payout-audit-packet.v1"),
  packetId: Uuid,
  lines: z
    .array(
      z.object({
        ref: z.string().regex(/^L\d{1,3}$/),
        contributionType: ContributionType,
        role: z.string().min(1),
        model: z.string().min(1),
        reasoning: ReasoningLevel,
        sizePoints: z.number().int().positive().nullable(),
        usage: ProviderUsage,
        /** D49: the frozen budget and its basis are what the line is paid; usage below is telemetry context. */
        budgetAcuMicro: U64String,
        budgetBasis: z.string().min(1),
        acceptanceObjectiveRef: z.string().min(1),
        acuMicro: U64String,
        capAcuMicro: U64String,
        repairLoops: z.number().int().nonnegative(),
        runLogRefs: z.array(z.string().min(1)),
        attribution: z.array(z.object({ party: z.string().min(1), share: z.string().min(1) })),
      }),
    )
    .min(1),
  diff: z.object({
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    excerptRef: z.string().min(1),
  }),
  contractExcerpts: z.array(z.object({ ref: z.string().min(1), text: z.string() })),
  peerBaselines: z.array(
    z.object({
      key: z.string().min(1),
      p25AcuMicro: U64String,
      p50AcuMicro: U64String,
      p75AcuMicro: U64String,
      samples: z.number().int().nonnegative(),
    }),
  ),
  /**
   * D32: a dispute FOCUSES the audit. Present for dispute gates (null for sampled audits and ratifications). The
   * auditor answers each concern first, then checks the line generally. Disputer and reply text is UNTRUSTED: the
   * context engine renders it inside delimited untrusted-content blocks, after the role obligations.
   */
  focus: z
    .object({
      /** Opaque per-packet reference, never the public dispute id (H11). */
      focusRef: Uuid,
      concerns: z
        .array(
          z.object({
            lineRef: z.string().regex(/^L\d{1,3}$/),
            reason: DisputeReason,
            evidence: z.array(DisputeEvidence).max(20),
            proposedAmountBase: U64String.nullable(),
          }),
        )
        .min(1),
      sharedEvidence: z.array(DisputeEvidence).max(20),
      disputerNoteUntrusted: z.string().max(4000),
      accusedReplyUntrusted: z.string().max(4000).nullable(),
    })
    .nullable(),
  manifestSha256: Sha256,
});
export type PayoutAuditPacket = z.infer<typeof PayoutAuditPacket>;

export const PayoutJudgment = z.enum(["plausible", "inflated", "misattributed", "insufficient_evidence"]);
export type PayoutJudgment = z.infer<typeof PayoutJudgment>;

/** Per-concern answer when the packet has a focus (D32): the verdict must answer every concern it was given. */
export const FocusAnswer = z.object({
  lineRef: z.string().regex(/^L\d{1,3}$/),
  concernHolds: z.boolean(),
  answer: z.string().min(40).max(4000),
});

/** Perturbations a payout canary applies; an auditor's finding "names" one by its judgment + reason. */
export const PerturbationClass = z.enum(["budget_mismatch", "unmet_acceptance", "split_stacking", "duplicated_attribution", "wrong_split"]);
export type PerturbationClass = z.infer<typeof PerturbationClass>;

/**
 * A sealed payout audit verdict, produced by the claimant's own client on their own subscription (D24, D25, D27).
 * Minimum substance: every line judged, each with cited evidence (run-log turns, diff paths) and a rationale. A bare
 * "all plausible" with no citations is schema-invalid and earns nothing.
 */
export const PayoutAuditVerdict = z.object({
  schema: z.literal("payout-audit-verdict.v1"),
  packetId: Uuid,
  manifestSha256: Sha256,
  lines: z
    .array(
      z
        .object({
          ref: z.string().regex(/^L\d{1,3}$/),
          judgment: PayoutJudgment,
          reason: PerturbationClass.nullable(),
          /** For "inflated": the budget (micro-ACU) the auditor finds supported by the frozen budget record and acceptance. */
          plausibleAcuMicro: U64String.nullable(),
          evidence: z
            .array(
              z.object({
                kind: z.enum(["budget_record", "acceptance_record", "run_log_turn", "diff_path", "baseline", "contract"]),
                ref: z.string().min(1),
                note: z.string().min(10).max(2000),
              }),
            )
            .min(1)
            .max(20),
          rationale: z.string().min(40).max(4000),
        })
        .refine((l) => (l.judgment === "inflated") === (l.plausibleAcuMicro !== null), { message: "plausibleAcuMicro iff inflated" })
        .refine((l) => (l.judgment === "inflated" || l.judgment === "misattributed") === (l.reason !== null), {
          message: "inflated/misattributed lines must name a reason",
        }),
    )
    .min(1),
  /** Required iff the packet had a focus: one answer per concern. */
  focusAnswers: z.array(FocusAnswer).nullable(),
  summary: z.string().min(40).max(4000),
});
export type PayoutAuditVerdict = z.infer<typeof PayoutAuditVerdict>;

/**
 * A payout canary (D27): a deterministic, model-free perturbation of a real receipt's payout line (zero wOS model
 * compute). Private; never allocated, never public, never mixed with the source receipt's own audits.
 */
export const PayoutCanary = z.object({
  schema: z.literal("wos-payout-canary.v1"),
  id: Uuid,
  packetId: Uuid,
  lineRef: z.string().regex(/^L\d{1,3}$/),
  sourceReceiptId: Uuid,
  perturbatorVersion: z.string().min(1),
  seedSha256: Sha256,
  perturbation: PerturbationClass,
  /** e.g. the line's budget raised above its frozen record, a share moved, an attribution duplicated. Enough to be detectable. */
  magnitudeBp: z.number().int().positive(),
  retiredAfterEpoch: z.number().int().positive(),
});
export type PayoutCanary = z.infer<typeof PayoutCanary>;

const PERTURBATION_JUDGMENT: Record<PerturbationClass, PayoutJudgment> = {
  budget_mismatch: "inflated",
  unmet_acceptance: "inflated",
  split_stacking: "inflated",
  duplicated_attribution: "misattributed",
  wrong_split: "misattributed",
};

/**
 * Caught iff the canary line is judged with the matching judgment AND names the planted perturbation as its reason
 * (H11). Canaries are BEHAVIOURAL checks of an auditor client; they never attest that a model ran.
 */
export function payoutCanaryCaught(c: Pick<PayoutCanary, "lineRef" | "perturbation">, v: Pick<PayoutAuditVerdict, "lines">): boolean {
  const line = v.lines.find((l) => l.ref === c.lineRef);
  return line !== undefined && line.judgment === PERTURBATION_JUDGMENT[c.perturbation] && line.reason === c.perturbation;
}

/**
 * One audit quorum per receipt (D25/D27): `size` randomly assigned auditors from OUTSIDE the feature, sealed and
 * revealed together, plus an optional own-feature auditor slot whose findings count but whose "plausible" never
 * counts toward ratification.
 */
export const PayoutAuditQuorum = z.object({
  id: Uuid,
  receiptId: Uuid,
  size: z.number().int().positive(),
  state: z.enum(["assigning", "sealed", "revealed_ratified", "revealed_findings", "expired"]),
  slots: z.array(
    z.object({
      slot: z.number().int().positive(),
      accountId: Uuid.nullable(),
      provider: ProviderId.nullable(),
      outsideFeature: z.boolean(),
    }),
  ),
  reviewPolicyVersion: z.string(),
});
export type PayoutAuditQuorum = z.infer<typeof PayoutAuditQuorum>;

/** An upheld inflation finding clips a receipt's weight (append-only; at most once, never above the original). */
export const ReceiptClip = z.object({
  receiptId: Uuid,
  newWeightMicro: U64String,
  quorumId: Uuid.nullable(),
  adminActionId: Uuid,
  auditorAccountIds: z.array(Uuid).min(1),
  at: Timestamp,
});
export type ReceiptClip = z.infer<typeof ReceiptClip>;

/**
 * Duty (M14) is derived from append-only events, never a mutable statement: an offer, then a completion or an
 * expiry. Owed = offered and not yet completed/expired; a claim is gated only by outstanding offers that are still
 * within their deadline. When no eligible audit could be offered, nothing is owed and the claim releases on schedule,
 * flagged "unaudited" (D42).
 */
export const DutyEvent = z.object({
  offerId: Uuid,
  accountId: Uuid,
  epochNumber: z.number().int().positive(),
  kind: z.enum(["offered", "completed", "expired_no_fault", "declined"]),
  quorumId: Uuid.nullable(),
  deadlineAt: Timestamp.nullable(),
  at: Timestamp,
});
export type DutyEvent = z.infer<typeof DutyEvent>;

export function dutyOutstanding(events: readonly DutyEvent[], nowMs: number): number {
  const last = new Map<string, DutyEvent>();
  for (const e of events) {
    const prev = last.get(e.offerId);
    if (!prev || Date.parse(e.at) >= Date.parse(prev.at)) last.set(e.offerId, e);
  }
  let n = 0;
  for (const e of last.values()) if (e.kind === "offered" && e.deadlineAt && Date.parse(e.deadlineAt) > nowMs) n++;
  return n;
}

/** Receipts whose status lets them into an epoch of the given mode. */
export function receiptCountsIn(mode: "live" | "test", status: ReceiptStatus): boolean {
  if (status === "REVOKED") return false;
  if (mode === "test") return true;
  return status === "ACTIVE" || status === "RATIFIED" || status === "FINAL_BY_SILENCE";
}

// ------------------------------------------------------------------------------------------------ Epochs

/** D28 adds PROPOSED (allocations published, challenge window open) between CALCULATING and FINALIZED. */
export const EpochState = z.enum(["OPEN", "CALCULATING", "PROPOSED", "FINALIZED", "DISTRIBUTABLE", "CLOSED"]);
export type EpochState = z.infer<typeof EpochState>;

export const Epoch = z.object({
  epochNumber: z.number().int().positive(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  policyVersions: PolicyVersions,
  cluster: SolanaCluster,
  /**
   * test: a devnet rehearsal while the founder is the only participant (D23). Allocates devnet WOS explicitly marked
   * non-Genesis, counts PROVISIONAL receipts, and its allocations never enter any mainnet computation.
   * live: ACTIVE receipts, and PROVISIONAL ones only once RATIFIED or FINAL_BY_SILENCE (D54).
   */
  mode: z.enum(["test", "live"]),
  state: EpochState,
});
export type Epoch = z.infer<typeof Epoch>;

/** Append-only transition row; the epoch's state is its latest transition (migration 0007). */
export const EpochTransition = z.object({
  epochNumber: z.number().int().positive(),
  from: EpochState.nullable(),
  to: EpochState,
  actor: z.enum(["system", "maintainer"]),
  adminActionId: Uuid.nullable(),
  /** Set on FINALIZED: the engine's output hashes. Set on DISTRIBUTABLE: the on-chain references. */
  receiptsRoot: Sha256.nullable(),
  allocationsRoot: Sha256.nullable(),
  resultSha256: Sha256.nullable(),
  distributorAddress: SolanaAddress.nullable(),
  fundingSignature: z.string().nullable(),
  at: Timestamp,
});
export type EpochTransition = z.infer<typeof EpochTransition>;

/** Frozen at CALCULATING: exactly which receipts an epoch considers (Astra-01 item 8). Append-only. */
export const EpochManifestEntry = z.object({
  epochNumber: z.number().int().positive(),
  receiptId: Uuid,
  receiptSha256: Sha256,
  disposition: z.enum(["included", "deferred", "revoked"]),
  deferralCount: z.number().int().nonnegative(),
});
export type EpochManifestEntry = z.infer<typeof EpochManifestEntry>;

/** Receipts are never mutated; invalidation appends one of these, backed by an AdminAction. */
export const ReceiptRevocation = z.object({
  receiptId: Uuid,
  adminActionId: Uuid,
  reason: z.string().min(20),
  /** Before finalization the receipt is dropped; after it, an offset is recorded instead (no on-chain reversal). */
  mode: z.enum(["exclude_before_finalization", "offset_after_finalization"]),
  at: Timestamp,
});
export type ReceiptRevocation = z.infer<typeof ReceiptRevocation>;

/** One devnet transfer per (epoch, wallet); retry-safe by blockhash expiry (SOLANA-ARCHITECTURE.md section 5). */
export const SettlementRecord = z.object({
  epochNumber: z.number().int().positive(),
  leafIndex: z.number().int().nonnegative(),
  wallet: SolanaAddress,
  amountBase: U64String,
  attempt: z.number().int().positive(),
  signature: z.string().min(32).max(100),
  lastValidBlockHeight: z.number().int().nonnegative(),
  outcome: z.enum(["pending", "confirmed", "expired_not_landed", "failed"]),
  at: Timestamp,
});
export type SettlementRecord = z.infer<typeof SettlementRecord>;

/**
 * Deterministic engine output. One line per receipt in distributing slices (so any single allocation can be disputed,
 * D30) and one line per (pool, account, component) for payouts. `id` is stable: deterministicUuid(epoch, key).
 */
export const Allocation = z.object({
  id: Uuid,
  epochNumber: z.number().int().positive(),
  accountId: Uuid,
  receiptId: Uuid.nullable(),
  slice: z.enum(["execution", "planning", "human_review", "outcomes", "completion_payout", "security_payout", "dispute_bounty", "offset"]),
  weightMicro: U64String,
  amountBase: I64String,
});
export type Allocation = z.infer<typeof Allocation>;

/**
 * M17/D45: before the first contribution or wallet binding, a contributor accepts the publication disclosure (what
 * becomes public, when, for how long, who is responsible). Receipts cannot be issued without it.
 */
export const PublicationConsent = z.object({
  accountId: Uuid,
  disclosureVersion: z.string().min(1),
  disclosureSha256: Sha256,
  at: Timestamp,
});
export type PublicationConsent = z.infer<typeof PublicationConsent>;

/** M17: the immutable commitment kept forever; the log BODY is stored separately and deleted after retention. */
export const RunLogCommitment = z.object({
  agentRunId: Uuid,
  logSha256: Sha256,
  turns: z.number().int().nonnegative(),
  repairLoops: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  totalsMatch: z.boolean(),
  bodyExpiresAt: Timestamp,
});
export type RunLogCommitment = z.infer<typeof RunLogCommitment>;

/**
 * H2 / A3-1: final entitlements are separate from proposed allocations. Each names its SOURCE and consumes that
 * source's remaining balance once per (source, kind): an allocation (at its effective final adjudication, A3-3) for
 * release_now / withheld_release / holdback_tranche; a tranche for holdback_matured (only from its pinned maturity
 * epoch); a dispute settlement for a bounty. The server copies the settlement domain (cluster, mode) and reward policy
 * from the epoch. A claim later takes an entitlement's whole remaining balance into one settlement leaf.
 */
export const BeneficiaryRef = z.object({ kind: z.enum(["person", "organization"]), id: Uuid });
export type BeneficiaryRef = z.infer<typeof BeneficiaryRef>;

export const EntitlementRecord = z.object({
  id: Uuid,
  epochNumber: z.number().int().positive(),
  cluster: SolanaCluster,
  mode: z.enum(["test", "live"]),
  beneficiary: BeneficiaryRef,
  kind: z.enum(["release_now", "withheld_release", "holdback_tranche", "holdback_matured", "bounty", "genesis_vesting"]),
  source: z.object({ kind: z.enum(["allocation", "tranche", "dispute_settlement", "genesis"]), id: Uuid }),
  amountBase: U64String,
  /** Tranches only: epoch + the holdback epochs pinned by `policyVersion` when the tranche was created (A3-10). */
  maturesEpoch: z.number().int().positive().nullable(),
  policyVersion: z.string().nullable(),
  /** Withheld epochs recorded when a disputed amount is released late (D43: released with the delay recorded). */
  withheldEpochs: z.number().int().nonnegative(),
  flags: z.array(z.enum(["unaudited", "released_after_dispute"])),
});
export type EntitlementRecord = z.infer<typeof EntitlementRecord>;

/** H3: one immutable signed transaction per attempt, persisted BEFORE broadcast; one active attempt per leaf. */
export const SettlementAttempt = z.object({
  leafId: Uuid,
  attempt: z.number().int().positive(),
  adapterGeneration: z.number().int().positive(),
  signedTxSha256: Sha256,
  signature: z.string().min(32).max(100),
  lastValidBlockHeight: z.number().int().nonnegative(),
  persistedAt: Timestamp,
});
export type SettlementAttempt = z.infer<typeof SettlementAttempt>;

/**
 * A3-9: every signed attempt is ambiguous until one of these. Confirmed needs finalized commitment and a slot; expiry
 * needs an observed block height past the attempt's last valid block height and the verbatim historical status lookup.
 * There is no "failed before broadcast" for signed bytes. A leaf is voided only when every attempt is proven expired.
 */
export const SettlementOutcome = z.discriminatedUnion("outcome", [
  z.object({
    leafId: Uuid,
    attempt: z.number().int().positive(),
    outcome: z.literal("confirmed"),
    commitment: z.literal("finalized"),
    slot: z.number().int().positive(),
  }),
  z.object({
    leafId: Uuid,
    attempt: z.number().int().positive(),
    outcome: z.literal("expired_not_landed"),
    observedBlockHeight: z.number().int().positive(),
    statusObservation: z.record(z.string(), z.unknown()),
  }),
]);
export type SettlementOutcome = z.infer<typeof SettlementOutcome>;

/** One claim leaf per (epoch, wallet): the sum of that account's non-negative allocations after offsets. */
export const ClaimLeaf = z.object({
  schema: z.literal("wos-claim-leaf.v1"),
  cluster: SolanaCluster,
  mint: SolanaAddress,
  epochNumber: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  /** H9: the beneficiary (person or organization), not merely an account. */
  beneficiary: BeneficiaryRef,
  wallet: SolanaAddress,
  amountBase: U64String,
});
export type ClaimLeaf = z.infer<typeof ClaimLeaf>;

// ------------------------------------------------------------------------------------------------ Pools

export const CompletionPoolKind = z.enum(["feature", "application"]);
export const CompletionPoolState = z.enum(["accruing", "payable", "paid", "returned"]);

export const CompletionPool = z.object({
  id: Uuid,
  kind: CompletionPoolKind,
  /** feature: "<target>/<featureKey>" per app profile (D10); application: the target slug. */
  key: z.string().min(3).max(120),
  accruedBase: U64String,
  state: CompletionPoolState,
});
export type CompletionPool = z.infer<typeof CompletionPool>;

/** Frozen, versioned definition of "complete" for a pool (Astra-01 item 10). A scope change appends a new version. */
export const CompletionDefinition = z.object({
  schema: z.literal("wos-completion-definition.v1"),
  poolKey: z.string().min(3).max(120),
  definitionVersion: z.number().int().positive(),
  /** The roadmap / contract versions whose requirements define completeness. */
  sourceDocuments: z.array(z.object({ documentId: Uuid, version: z.number().int().positive(), sha256: Sha256 })),
  requiredSurfaces: z.array(z.string()),
  acceptanceChecks: z.array(z.string()),
  requireSecurityReview: z.boolean(),
  /** D50: exit-rights check, not a first-class self-host check. */
  requireExitRightsCheck: z.boolean(),
  frozenAt: Timestamp,
});
export type CompletionDefinition = z.infer<typeof CompletionDefinition>;

export const PoolAccrual = z.object({
  poolId: Uuid,
  epochNumber: z.number().int().positive(),
  amountBase: U64String,
  basis: z.string().max(500),
});
export type PoolAccrual = z.infer<typeof PoolAccrual>;

// ------------------------------------------------------------------------------------------------ Genesis (historical credit)

export const GenesisEvidenceKind = z.enum(["git_commit", "wave_report", "retro_abu"]);

/**
 * Historical credit for pre-protocol work (A6, Astra-01 item 9). A DISTINCT category: it rests on accepted output
 * (merged commits mapped to retro ABUs with size points), never on reconstructed token usage. Deduplicated against
 * later receipts by `dedupKey` (unique across genesis_contributions and contribution_receipts). Issued only at
 * mainnet launch, into a vesting position, inside the published cap (GENESIS-POLICY.md).
 */
export const GenesisContribution = z.object({
  schema: z.literal("wos-genesis-contribution.v1"),
  id: Uuid,
  contributorAccountId: Uuid,
  evidenceKind: GenesisEvidenceKind,
  /** e.g. "waronsaas/wos@<sha>", "docs/architecture/WAVE-1-REPORT.md@<sha>". */
  evidenceRefs: z.array(z.string().min(3).max(300)).min(1),
  evidenceSha256: Sha256,
  /** "retro:<repo>:<feature>#<nn>" — the retro ABU this evidence is mapped to; unique forever. */
  dedupKey: z.string().min(8).max(200),
  sizePoints: z.number().int().positive(),
  genesisPolicyVersion: z.string(),
  recordedAt: Timestamp,
});
export type GenesisContribution = z.infer<typeof GenesisContribution>;

// ------------------------------------------------------------------------------------------------ Abuse and admin

export const AbuseSignalKind = z.enum([
  "usage_outlier_vs_peers",
  "cap_saturation_pattern",
  "impossible_throughput",
  "usage_fields_inconsistent",
  "model_mismatch",
  "duplicate_provider_ids",
  "transcript_missing_on_audit",
  "audit_divergence",
  "repeated_failures",
  "collusive_review_pattern",
  "rubber_stamp_pattern",
  "sybil_cluster",
  "context_inflation",
  "intentional_looping",
  "duplicate_attempt",
  "compromised_account_suspected",
  "wallet_rebind_after_signal",
  "human_review_disagreement",
  "payout_canary_passed",
  "inflation_finding_upheld",
  "false_inflation_findings",
  "run_log_inconsistent",
  "consistent_skim_pattern",
  "rejected_disputes",
]);
export type AbuseSignalKind = z.infer<typeof AbuseSignalKind>;

export const AbuseSignal = z.object({
  id: Uuid,
  kind: AbuseSignalKind,
  severity: z.enum(["info", "low", "medium", "high"]),
  subject: z.object({
    kind: z.enum(["agent_run", "receipt", "account", "review", "human_review", "wallet", "payout_audit", "canary"]),
    id: z.string().min(1),
  }),
  accountId: Uuid.nullable(),
  detector: z.string().min(1),
  detectorVersion: z.string().min(1),
  /** Numbers the detector saw (z-score, ratios, counts). Evidence, not accusation. */
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  raisedAt: Timestamp,
});
export type AbuseSignal = z.infer<typeof AbuseSignal>;

/** A flag on one receipt. Its effect is set by RiskPolicy; only an AdminAction resolves it. */
export const ContributionRiskFlag = z.object({
  id: Uuid,
  receiptId: Uuid,
  signalIds: z.array(Uuid).min(1),
  effect: z.enum(["none", "hold", "exclude_pending_review"]),
  riskPolicyVersion: z.string(),
  raisedAt: Timestamp,
});
export type ContributionRiskFlag = z.infer<typeof ContributionRiskFlag>;

export const AdminActionKind = z.enum([
  "authorize_reviewer",
  "revoke_reviewer",
  "suspend_reward_eligibility",
  "restore_reward_eligibility",
  "suspend_reviewer_privileges",
  "restore_reviewer_privileges",
  "suspend_account",
  "restore_account",
  "invalidate_receipt",
  "restore_receipt",
  "hold_receipt",
  "clear_risk_flag",
  "uphold_risk_flag",
  "record_offset",
  "activate_policy",
  "activate_oracle",
  "set_model_eligibility",
  "open_epoch",
  "finalize_epoch",
  "mark_epoch_distributable",
  "close_epoch",
  "record_genesis",
  "award_security",
  // D23: founder bootstrap authority and its ratification queue.
  "bootstrap_merge",
  "ratify_receipt",
  "reject_ratification",
  "resolve_ratification_dispute",
  "clip_receipt",
  "end_bootstrap",
  "start_test_epochs",
  "end_test_epochs",
]);
export type AdminActionKind = z.infer<typeof AdminActionKind>;

/** Immutable, hash-chained (migration 0007 wos.admin_actions). No silent confiscation: every effect has one of these. */
export const AdminAction = z.object({
  id: Uuid,
  actorAccountId: Uuid,
  action: AdminActionKind,
  target: z.object({ kind: z.string().min(1), id: z.string().min(1) }),
  reason: z.string().min(20).max(4000),
  affectedReceiptIds: z.array(Uuid),
  affectedEpochNumbers: z.array(z.number().int().positive()),
  previousState: z.record(z.string(), z.unknown()),
  resultingState: z.record(z.string(), z.unknown()),
  /** The exact mutation this action authorizes; consumers compare it field for field (A3-7). */
  payload: z.record(z.string(), z.unknown()),
  /** Named second maintainer for two-person kinds; they approve `operationSha256` separately, from their own session. */
  coSignerAccountId: Uuid.nullable(),
  /** sha256 over kind, target, payload and prior state; each action is consumed by exactly one mutation (A3-7). */
  operationSha256: Sha256,
  createdAt: Timestamp,
});
export type AdminAction = z.infer<typeof AdminAction>;

/** A3-7: the co-signer's separate approval of one operation hash (migration 0007 wos.admin_action_approvals). */
export const AdminActionApproval = z.object({
  adminActionId: Uuid,
  approverAccountId: Uuid,
  operationSha256: Sha256,
  approvedAt: Timestamp,
});
export type AdminActionApproval = z.infer<typeof AdminActionApproval>;

/**
 * A3-6: the server's seat assignment for a payout audit. A verdict must redeem exactly one assignment, with matching
 * quorum, slot, packet hash, reviewer, task, lease and a signed run of that lease by the permitted provider.
 */
export const PayoutAuditAssignment = z.object({
  id: Uuid,
  quorumId: Uuid,
  slot: z.number().int().positive(),
  outsideFeature: z.boolean(),
  packetSha256: Sha256,
  reviewerAccountId: Uuid,
  taskId: Uuid,
  leaseId: Uuid,
  leaseGeneration: z.number().int().positive(),
  permittedProvider: ProviderId,
  reviewPolicyVersion: z.string().min(1),
});
export type PayoutAuditAssignment = z.infer<typeof PayoutAuditAssignment>;

/**
 * A3-5: the qualification evaluator's typed result, as relationships: the accepted changeset on the lease generation,
 * the revealed consensus round at the qualified revision and diff hash, green CI (implementations), the pinned
 * run-policy snapshot and, when that snapshot requires it, the human pre-merge PASS on the same round.
 */
export const QualificationResult = z.object({
  id: Uuid,
  subjectKind: z.enum(["attempt", "document"]),
  subjectId: Uuid,
  subjectRevision: z.string().regex(/^[0-9a-f]{40}$/),
  leaseId: Uuid,
  leaseGeneration: z.number().int().positive(),
  changesetId: Uuid,
  roundId: Uuid,
  verificationRunId: Uuid.nullable(),
  humanReviewId: Uuid.nullable(),
  policySnapshotSha256: Sha256,
  evidenceSha256: Sha256,
});
export type QualificationResult = z.infer<typeof QualificationResult>;

/** A3-12: the frozen, content-addressed Genesis reference population, approved by two maintainers over its hash. */
export const GenesisReferenceManifest = z.object({
  version: z.string().min(1),
  cutoffEpoch: z.number().int().positive(),
  rules: z.record(z.string(), z.unknown()),
  receiptIds: z.array(Uuid).min(1),
  manifestSha256: Sha256,
  adminActionId: Uuid,
});
export type GenesisReferenceManifest = z.infer<typeof GenesisReferenceManifest>;

// ------------------------------------------------------------------------------------------------ Human review

export const RiskClassId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
export type RiskClassId = z.infer<typeof RiskClassId>;

export const ReviewDomain = z.enum([
  "general",
  "frontend",
  "backend",
  "mobile",
  "security",
  "accounting",
  "protocol",
  "data",
  "infra",
  "docs",
]);
export type ReviewDomain = z.infer<typeof ReviewDomain>;

export const DocRef = z.object({ ref: z.string().min(1), sha256: Sha256 });

/** Everything the human reviewer sees; its hash is bound into the HumanReview (HUMAN-REVIEW.md section 3). */
export const HumanReviewContext = z.object({
  schema: z.literal("wos-human-review-context.v1"),
  subject: SubjectRef,
  riskClass: RiskClassId,
  riskReasons: z.array(z.string().max(300)),
  taskContract: DocRef.nullable(),
  featureContract: DocRef.nullable(),
  architecture: z.array(DocRef),
  invariants: z.array(z.string().max(2000)),
  diff: z.object({ headSha: GitSha, baseSha: GitSha, submissionSha256: Sha256, compareUrl: z.url() }).nullable(),
  verification: z.array(z.object({ check: z.string(), conclusion: z.string(), url: z.url().nullable() })),
  agentReviews: z.array(
    z.object({ slot: z.enum(["astra", "fable"]), verdict: z.enum(["NO_MATERIAL_GAPS", "MATERIAL_GAPS"]), reviewSha256: Sha256 }),
  ),
  affectedInterfaces: z.array(z.string().max(300)),
  checklist: z.array(z.object({ itemId: z.string().min(1), question: z.string().min(5) })),
});
export type HumanReviewContext = z.infer<typeof HumanReviewContext>;

export const HumanReviewVerdict = z.enum(["PASS", "FAIL"]);

export const HumanReview = z
  .object({
    schema: z.literal("wos-human-review.v1"),
    id: Uuid,
    subject: SubjectRef,
    roundId: Uuid.nullable(),
    headSha: GitSha.nullable(),
    submissionSha256: Sha256.nullable(),
    contextSha256: Sha256,
    reviewerAccountId: Uuid,
    qualificationId: Uuid,
    riskClass: RiskClassId,
    verdict: HumanReviewVerdict,
    findings: z
      .array(
        z.object({
          localId: z.string().regex(/^h\d{1,3}$/),
          severity: z.enum(["material", "minor"]),
          title: z.string().min(1).max(200),
          detail: z.string().min(1).max(8000),
        }),
      )
      .max(50),
    checklist: z.array(z.object({ itemId: z.string().min(1), answer: z.enum(["yes", "no", "na"]), note: z.string().max(2000) })),
    rationale: z.string().min(40).max(8000),
    reviewPolicyVersion: z.string(),
    sealedAt: Timestamp,
  })
  .refine((h) => (h.verdict === "PASS") === !h.findings.some((f) => f.severity === "material"), {
    message: "verdict must be PASS iff there are no material findings",
  });
export type HumanReview = z.infer<typeof HumanReview>;

export const ReviewerQualification = z.object({
  id: Uuid,
  accountId: Uuid,
  domains: z.array(ReviewDomain).min(1),
  /** 1 = may review standard risk; 2 = elevated classes; 3 = protocol/accounting. Simple on purpose. */
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  contributionTypes: z.array(ContributionType).min(1),
  riskClasses: z.array(RiskClassId).min(1),
  grantedByAdminActionId: Uuid,
  state: z.enum(["active", "suspended", "revoked"]),
  grantedAt: Timestamp,
});
export type ReviewerQualification = z.infer<typeof ReviewerQualification>;

/** Agent-vs-human disagreement recorded as a permanent eval case (HUMAN-REVIEW.md section 6). */
export const ReviewEvalCase = z.object({
  id: Uuid,
  subject: SubjectRef,
  roundId: Uuid.nullable(),
  pattern: z.enum(["agents_pass_human_fail", "agents_fail_human_pass", "agents_split", "post_merge_defect_missed_by_all"]),
  astraVerdict: z.enum(["NO_MATERIAL_GAPS", "MATERIAL_GAPS"]).nullable(),
  fableVerdict: z.enum(["NO_MATERIAL_GAPS", "MATERIAL_GAPS"]).nullable(),
  humanVerdict: HumanReviewVerdict.nullable(),
  outcome: z.enum(["pending", "human_upheld", "agents_upheld", "both_wrong"]),
  contextSha256: Sha256,
  createdAt: Timestamp,
});
export type ReviewEvalCase = z.infer<typeof ReviewEvalCase>;

// ------------------------------------------------------------------------------------------------ Organizations (D38)

/**
 * A contributor contributes on behalf of an organization (Amendment 01's Organization). Requested by the contributor,
 * approved by an org admin; effective from approval until ended (forward only). While active, the contributor and every
 * other member with an active link to the same organization are RELATED ACCOUNTS for all independence rules.
 */
export const SponsorshipLink = z.object({
  id: Uuid,
  organizationId: Uuid,
  contributorAccountId: Uuid,
  organizationShareBp: z.number().int().min(0).max(10_000),
  requestedAt: Timestamp,
  approvedByAccountId: Uuid,
  effectiveFrom: Timestamp,
  endedAt: Timestamp.nullable(),
});
export type SponsorshipLink = z.infer<typeof SponsorshipLink>;

export const DEFAULT_ORGANIZATION_SHARE_BP = 10_000 as const;

// ------------------------------------------------------------------------------------------------ Wallet

/** The exact message a wallet signs to bind itself to an account (SOLANA-ARCHITECTURE.md section 7). */
export function walletBindingMessage(input: {
  accountId: string;
  /** Present when binding an organization's beneficiary wallet (H9). */
  organizationId?: string | null;
  wallet: string;
  cluster: SolanaCluster;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    "wOS wallet binding",
    `account: ${input.accountId}`,
    ...(input.organizationId ? [`organization: ${input.organizationId}`] : []),
    `wallet: ${input.wallet}`,
    `cluster: ${input.cluster}`,
    `nonce: ${input.nonce}`,
    `issued: ${input.issuedAt}`,
    "This signature proves control of the wallet. It moves no funds and grants no authority.",
  ].join("\n");
}

export const WalletBinding = z.object({
  /** A person's wallet, or an organization's (recommended: a multisig) as its beneficiary wallet (D38). */
  accountId: Uuid.nullable(),
  organizationId: Uuid.nullable(),
  cluster: SolanaCluster,
  wallet: SolanaAddress,
  /** multisig_pda: a Squads vault (a PDA has no private key) proves control by executing an approved on-chain
   * multisig transaction that posts the binding message as a Memo; `multisigTxSignature` names it (H9). */
  kind: z.enum(["external", "cli_keypair", "multisig_pda"]),
  message: z.string().min(1),
  /** ed25519 signature over the UTF-8 message (external, cli_keypair); null for multisig_pda. */
  signature: z.string().min(64).max(128).nullable(),
  multisigTxSignature: z.string().min(32).max(100).nullable(),
  /** Authorized controllers recorded for organization wallets (D45). */
  controllers: z.array(Uuid),
  action: z.enum(["bind", "unbind"]),
  at: Timestamp,
});
export type WalletBinding = z.infer<typeof WalletBinding>;

// ------------------------------------------------------------------------------------------------ D49 task budgets

/**
 * D49: an acceptance objective (a feature contract criterion or a planning deliverable) with its own budget, fixed at
 * roadmap/contract consensus. The budgets of all tasks under one objective never exceed it, so splitting a unit into
 * more units cannot raise the total paid for the same acceptance (anti-stacking).
 */
export const AcceptanceObjective = z.object({
  id: Uuid,
  kind: z.enum(["feature_criterion", "planning_deliverable", "review_round", "audit", "resolution"]),
  ref: z.string().min(1),
  budgetAcuMicro: U64String,
  consensusRoundId: Uuid.nullable(),
  budgetModelVersion: z.string().min(1),
});
export type AcceptanceObjective = z.infer<typeof AcceptanceObjective>;

/**
 * D49: a task's reward budget, fixed BEFORE work starts (decomposition / contract consensus) and reviewed there (an
 * unjustified budget is a material finding). `modelAcuMicro` is what the budget model gives; the budget may differ
 * only within the policy's bounds and with a written justification (and a human approval above maxWithoutHumanBp).
 * At issuance, budget x the epoch's issuance rate is reserved; acceptance pays exactly that, split by declared shares.
 */
export const TaskBudget = z.object({
  taskId: Uuid,
  objectiveId: Uuid,
  kind: z.enum(["execution", "planning", "human_review"]),
  budgetAcuMicro: U64String,
  modelAcuMicro: U64String,
  basis: z.object({
    expectedComputeAcuMicro: U64String,
    sizePoints: z.number().int().positive().nullable(),
    difficultyBp: z.number().int().positive(),
    importanceBp: z.number().int().positive(),
    sharedDependency: z.boolean(),
    justification: z.string().max(4000),
  }),
  budgetModelVersion: z.string().min(1),
  proposerAccountId: Uuid,
  issuedEpoch: z.number().int().positive(),
  issuanceRateBasePerAcu: U64String,
  reservedBase: U64String,
  expiresEpoch: z.number().int().positive(),
});
export type TaskBudget = z.infer<typeof TaskBudget>;

// ------------------------------------------------------------------------------------------------ D61 bugs and maintenance

/**
 * D61 (economy side; versioned addition after the v1 freeze). The protocol binds to the planning side's records
 * (contracts 5.7.0 `bugs.ts`: `BugId`, `BugSeverity`, `TriageOutcome`, `TriageDecision`, `RedGreenEvidence`), never to
 * their prose. `BugTriageRecord` is what the database stores per bug (0010 `bug_triage_decisions`): the decision's
 * canonical hash (the triage reward binds to it), its outcome and severity, the reporter the intake authenticated, and
 * — when the mapping blames a merged receipt — the introducing receipt. The introducer and whether its receipt was
 * accepted inside the pinned revert-offset window are DERIVED by the database, never supplied.
 */
export const BugTriageRecord = z.object({
  bugId: Uuid,
  bugKey: BugId,
  decisionSha256: Sha256,
  outcome: TriageOutcome,
  severity: BugSeverity.nullable(),
  duplicateOfBugKey: BugId.nullable(),
  decidedBy: z.enum(["agent", "maintainer"]),
  /** Agent triage is a commissioned bug_triage task under a lease (TriageDecision.decidedBy.taskId / leaseId). */
  triageTaskId: Uuid.nullable(),
  deciderAccountId: Uuid,
  reporterAccountId: Uuid,
  introducingReceiptId: Uuid.nullable(),
  introducerAccountId: Uuid.nullable(),
  introducedWithinOffsetWindow: z.boolean(),
  decidedAt: Timestamp,
});
export type BugTriageRecord = z.infer<typeof BugTriageRecord>;

/**
 * D61: a maintainer's confirmation of a triage decision (0010 `bug_triage_confirmations`, at most one of each kind per
 * bug): `ratified` (confirms a not_reproducible / not_a_bug decision, or any decision early; the only way a critical
 * severity becomes effective), `severity_corrected` (penalty-free: the triage is still paid, the corrected severity
 * prices and ranks the fix), `resolved` (a contract_revision's revision merged).
 */
export const BugTriageConfirmation = z.object({
  bugId: Uuid,
  kind: z.enum(["ratified", "severity_corrected", "resolved"]),
  correctedSeverity: BugSeverity.nullable(),
  maintainerAccountId: Uuid,
  at: Timestamp,
});
export type BugTriageConfirmation = z.infer<typeof BugTriageConfirmation>;

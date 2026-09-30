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
]);
export type ContributionType = z.infer<typeof ContributionType>;

/** Where a receipt's weight competes for WOS inside an epoch (REWARD-PROTOCOL.md section 5). */
export const RewardSlice = z.enum(["execution", "planning", "human_review", "outcomes", "completion_accrual", "security_reserve"]);
export type RewardSlice = z.infer<typeof RewardSlice>;

/** Slices that pay contributors directly each epoch; the other two accrue to rules-bound pools (Astra-01 item 4). */
export const DISTRIBUTING_SLICES = ["execution", "planning", "human_review", "outcomes"] as const;
export type DistributingSlice = (typeof DISTRIBUTING_SLICES)[number];

/**
 * What a receipt's weight rests on (Astra-01 items 1 and 9). Stored permanently; UI and allocations never upgrade it.
 *   attested_usage   provider usage reported by the official client (ATTESTED at best for subscription CLIs)
 *   accepted_output  weight derived from accepted output size (reference ACU), not from claimed tokens
 *   outcome          fixed ACU-equivalent weight for an outcome (proposal incorporated, bug fixed, human review)
 *   historical       Genesis historical credit (never mixed into epoch slices)
 */
export const EvidenceClass = z.enum(["attested_usage", "accepted_output", "outcome", "historical"]);
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
  kind: z.enum(["attempt", "document", "review", "human_review", "proposal", "security_report", "genesis", "audit", "ratification"]),
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
  }),
  /** Sum of eligible usage (min(attested, cap)) or the ACU-equivalent/points for outcome work. */
  weightMicro: U64String,
  weightBasis: z.enum(["acu", "acu_equivalent"]),
  evidenceClass: EvidenceClass,
  acceptanceEvent: AcceptanceEvent,
  leaseId: Uuid.nullable(),
  leaseGeneration: z.number().int().positive().nullable(),
  runPolicySnapshotSha256s: z.array(Sha256),
  /** Attested ACU before the cap, kept so over-cap behaviour is auditable. */
  attestedAcuMicro: U64String,
  capAcuMicro: U64String,
  lowestVerificationLevel: VerificationLevel,
  /**
   * D23 (founder, resolving Astra-01 item 2): merge authority is separate from reward qualification.
   *   independent        the review policy was satisfied by non-authors; born PENDING_RATIFICATION (D25)
   *   founder_bootstrap  the founder's own work merged under bootstrap authority; the receipt is born PROVISIONAL
   */
  independence: z.enum(["independent", "founder_bootstrap"]),
  /** Born PENDING_RATIFICATION (independent work) or PROVISIONAL (founder bootstrap work); see ReceiptStatus. */
  initialStatus: z.enum(["PENDING_RATIFICATION", "PROVISIONAL"]),
  policyVersions: PolicyVersions,
  epochNumber: z.number().int().positive(),
  qualifiedAt: Timestamp,
});
export type ContributionReceipt = z.infer<typeof ContributionReceipt>;

/**
 * Receipt qualification status (D23 + D25). Receipts are immutable; status is the latest ReceiptStatusEvent.
 *   PENDING_RATIFICATION  merged independent work, waiting for its peer ratification quorum (D25)
 *   PROVISIONAL           the founder's own work merged under bootstrap authority (D23); public, test epochs only
 *   DISPUTED              a sealed peer ratification review rejected it with substance; a ruling decides
 *   RATIFIED              quorum of independent peer ratifications PASSed (or the small-pool human sign-off);
 *                         the only status that counts in live epochs; original qualifiedAt kept
 *   REVOKED               invalidated by an AdminAction; never deleted
 */
export const ReceiptStatus = z.enum(["PENDING_RATIFICATION", "PROVISIONAL", "DISPUTED", "RATIFIED", "REVOKED"]);
export type ReceiptStatus = z.infer<typeof ReceiptStatus>;

export const ReceiptStatusEventKind = z.enum([
  "issued",
  "quorum_ratified",
  "human_signoff",
  "ratification_failed",
  "dispute_resolved_ratify",
  "dispute_resolved_revoke",
  "ratification_rejected",
  "revoked",
  "restored",
]);
export type ReceiptStatusEventKind = z.infer<typeof ReceiptStatusEventKind>;

export const ReceiptStatusEvent = z.object({
  receiptId: Uuid,
  from: ReceiptStatus.nullable(),
  to: ReceiptStatus,
  kind: ReceiptStatusEventKind,
  /** The ratification quorum (quorum_ratified), the human review (human_signoff), the ruling or admin action. */
  quorumId: Uuid.nullable(),
  humanReviewId: Uuid.nullable(),
  adminActionId: Uuid.nullable(),
  at: Timestamp,
});
export type ReceiptStatusEvent = z.infer<typeof ReceiptStatusEvent>;

// ------------------------------------------------------------------------------------------------ Review duty (D25)

/** Defect classes a ratification finding can name; canaries are generated in the same classes (D26). */
export const DefectClass = z.enum([
  "authorization",
  "inverted_condition",
  "off_by_one",
  "missing_validation",
  "secret_leak",
  "scope_violation",
  "requirement_not_met",
  "other",
]);
export type DefectClass = z.infer<typeof DefectClass>;

/**
 * What a duty client receives: an opaque packet (D26). It carries the diff hunks, the requirements and the relevant
 * contract excerpts, but no receipt id, merge sha or attempt id, so a real packet and a canary look the same. Quotes in
 * the verdict are hashed over the packet's own file content, which the server knows for both kinds.
 */
export const RatificationPacket = z.object({
  schema: z.literal("wos-ratification-packet.v1"),
  packetId: Uuid,
  repo: RepoFullName,
  requirements: z.array(z.object({ key: z.string().regex(/^R-\d{3}$/), text: z.string().min(1) })).min(1),
  contractExcerpts: z.array(z.object({ ref: z.string().min(1), text: z.string() })),
  files: z
    .array(z.object({ path: z.string().min(1), content: z.string(), changedLines: z.array(z.tuple([z.number().int(), z.number().int()])) }))
    .min(1),
  manifestSha256: Sha256,
});
export type RatificationPacket = z.infer<typeof RatificationPacket>;

/**
 * A sealed peer ratification verdict, run by the claimant's own client on their own subscription (D24, D25).
 * Minimum substance: named requirements and at least two evidence quotes whose sha256 the server recomputes over the
 * packet's lines. A bare PASS is schema-invalid and earns nothing.
 */
export const RatificationVerdict = z
  .object({
    schema: z.literal("ratification-verdict.v1"),
    packetId: Uuid,
    manifestSha256: Sha256,
    verdict: z.enum(["RATIFY", "REJECT"]),
    requirementsChecked: z.array(z.string().regex(/^R-\d{3}$/)).min(1),
    evidence: z
      .array(
        z.object({
          path: z.string().min(1),
          lineStart: z.number().int().positive(),
          lineEnd: z.number().int().positive(),
          quoteSha256: Sha256,
          note: z.string().min(10).max(2000),
        }),
      )
      .min(2)
      .max(30),
    findings: z
      .array(
        z.object({
          severity: z.enum(["material", "minor"]),
          defectClass: DefectClass,
          path: z.string().min(1),
          lineStart: z.number().int().positive(),
          lineEnd: z.number().int().positive(),
          title: z.string().min(1).max(200),
          detail: z.string().min(20).max(8000),
        }),
      )
      .max(30),
    summary: z.string().min(40).max(4000),
  })
  .refine((v) => (v.verdict === "RATIFY") === !v.findings.some((f) => f.severity === "material"), {
    message: "verdict must be RATIFY iff there are no material findings",
  });
export type RatificationVerdict = z.infer<typeof RatificationVerdict>;

/**
 * A canary (honeypot) ratification case (D26): a real merged change with ONE deterministically injected defect, made
 * by a rule-based mutator (no model, zero wOS model compute). Private: never public, never mergeable, never rewarded.
 */
export const CanaryCase = z.object({
  schema: z.literal("wos-canary-case.v1"),
  id: Uuid,
  packetId: Uuid,
  sourceReceiptId: Uuid,
  mutatorVersion: z.string().min(1),
  /** sha256 of (sourceReceiptId, mutationClass, seed): the same inputs always give the same mutation. */
  seedSha256: Sha256,
  mutationClass: DefectClass,
  planted: z.object({ path: z.string().min(1), lineStart: z.number().int().positive(), lineEnd: z.number().int().positive() }),
  /** The mutation is inside a changed hunk and visible within this many lines of context (fairness rule). */
  visibleWithinLines: z.number().int().positive(),
  /** Typecheck of the mutated file passed in CI (a syntax error would be a giveaway). */
  typechecks: z.boolean(),
  retiredAfterEpoch: z.number().int().positive(),
});
export type CanaryCase = z.infer<typeof CanaryCase>;

/** A verdict catches a canary iff it REJECTs with a material finding overlapping the planted lines (+-3) or naming its class in that file. */
export function canaryCaught(
  c: Pick<CanaryCase, "planted" | "mutationClass">,
  v: Pick<RatificationVerdict, "verdict" | "findings">,
): boolean {
  if (v.verdict !== "REJECT") return false;
  return v.findings.some(
    (f) =>
      f.severity === "material" &&
      f.path === c.planted.path &&
      (f.defectClass === c.mutationClass || (f.lineStart <= c.planted.lineEnd + 3 && f.lineEnd >= c.planted.lineStart - 3)),
  );
}

/** One quorum per receipt: X sealed slots, randomly assigned, revealed together. */
export const RatificationQuorum = z.object({
  id: Uuid,
  receiptId: Uuid,
  size: z.number().int().positive(),
  state: z.enum(["assigning", "sealed", "revealed_ratified", "revealed_rejected", "expired"]),
  /** Account + provider per slot; distinct accounts, never the author, never a pre-merge reviewer of the subject. */
  slots: z.array(z.object({ slot: z.number().int().positive(), accountId: Uuid.nullable(), provider: ProviderId.nullable() })),
  reviewPolicyVersion: z.string(),
});
export type RatificationQuorum = z.infer<typeof RatificationQuorum>;

/** Review duty per account per epoch: owed from the account's own execution/planning receipts, done by duty reviews. */
export const DutyStatement = z.object({
  accountId: Uuid,
  epochNumber: z.number().int().positive(),
  owed: z.number().int().nonnegative(),
  /** Duty tasks actually offered to this account (duty is never owed beyond what was offered). */
  offered: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** Allocation withheld until duty is met, carried at most unmetDutyCarryEpochs. */
  claimGated: z.boolean(),
});
export type DutyStatement = z.infer<typeof DutyStatement>;

/** Receipts whose status lets them into an epoch of the given mode. */
export function receiptCountsIn(mode: "live" | "test", status: ReceiptStatus): boolean {
  if (status === "REVOKED") return false;
  if (mode === "test") return true;
  return status === "RATIFIED";
}

// ------------------------------------------------------------------------------------------------ Epochs

export const EpochState = z.enum(["OPEN", "CALCULATING", "FINALIZED", "DISTRIBUTABLE", "CLOSED"]);
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
   * live: only RATIFIED receipts.
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

/** Deterministic engine output per (epoch, account, slice). */
export const Allocation = z.object({
  epochNumber: z.number().int().positive(),
  accountId: Uuid,
  slice: z.enum(["execution", "planning", "human_review", "outcomes", "completion_payout", "security_payout", "offset"]),
  weightMicro: U64String,
  amountBase: I64String,
});
export type Allocation = z.infer<typeof Allocation>;

/** One claim leaf per (epoch, wallet): the sum of that account's non-negative allocations after offsets. */
export const ClaimLeaf = z.object({
  schema: z.literal("wos-claim-leaf.v1"),
  cluster: SolanaCluster,
  mint: SolanaAddress,
  epochNumber: z.number().int().positive(),
  index: z.number().int().nonnegative(),
  accountId: Uuid,
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
  requireSelfHostCheck: z.boolean(),
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
  "canary_passed",
]);
export type AbuseSignalKind = z.infer<typeof AbuseSignalKind>;

export const AbuseSignal = z.object({
  id: Uuid,
  kind: AbuseSignalKind,
  severity: z.enum(["info", "low", "medium", "high"]),
  subject: z.object({
    kind: z.enum(["agent_run", "receipt", "account", "review", "human_review", "wallet", "ratification", "canary"]),
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
  /** Second maintainer's approval for actions RiskPolicy marks as two-person (e.g. invalidate_receipt of another maintainer). */
  coSignerAccountId: Uuid.nullable(),
  createdAt: Timestamp,
});
export type AdminAction = z.infer<typeof AdminAction>;

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

// ------------------------------------------------------------------------------------------------ Wallet

/** The exact message a wallet signs to bind itself to an account (SOLANA-ARCHITECTURE.md section 7). */
export function walletBindingMessage(input: {
  accountId: string;
  wallet: string;
  cluster: SolanaCluster;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    "wOS wallet binding",
    `account: ${input.accountId}`,
    `wallet: ${input.wallet}`,
    `cluster: ${input.cluster}`,
    `nonce: ${input.nonce}`,
    `issued: ${input.issuedAt}`,
    "This signature proves control of the wallet. It moves no funds and grants no authority.",
  ].join("\n");
}

export const WalletBinding = z.object({
  accountId: Uuid,
  cluster: SolanaCluster,
  wallet: SolanaAddress,
  kind: z.enum(["external", "cli_keypair"]),
  message: z.string().min(1),
  /** base58 or base64 ed25519 signature over the UTF-8 message; verified server-side before insert. */
  signature: z.string().min(64).max(128),
  action: z.enum(["bind", "unbind"]),
  at: Timestamp,
});
export type WalletBinding = z.infer<typeof WalletBinding>;

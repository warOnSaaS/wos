import { z } from "zod";
import { TokenAmount, Timestamp, Uuid } from "./primitives.js";

/**
 * WOS token ledger (D3): one unit, one append-only ledger, balances derived.
 * "WOS tokens are in-app credits with no cash value."
 *
 * Buckets: every entry moves tokens into or out of exactly one bucket of one contributor.
 *   held       accrued but inside the hold window (or awaiting independent re-review)
 *   available  released; spendable once spending exists (V1: nothing to spend on)
 *
 * Entry kinds and sign rules (enforced by a CHECK constraint in packages/db):
 *   award      +amount into held         (accepted contribution)
 *   release    -amount from held AND a paired +amount into available (two rows, same pair_id)
 *   void       -amount from held         (reversed before release; references the award)
 *   clawback   -amount from available    (reversed after release; references the award)
 *   debit      -amount from available    (future spending; D3 requires support without schema change)
 *   adjustment +/- either bucket, maintainer only, public memo mandatory
 *
 * Score (leaderboard) = lifetime earned = sum(award) - sum(void) - sum(clawback), over both buckets.
 * Spending (debit) never lowers the score. See REWARD-PROTOCOL.md.
 */

export const LedgerBucket = z.enum(["held", "available"]);
export type LedgerBucket = z.infer<typeof LedgerBucket>;

export const LedgerEntryKind = z.enum(["award", "release", "void", "clawback", "debit", "adjustment"]);
export type LedgerEntryKind = z.infer<typeof LedgerEntryKind>;

export const RewardCategory = z.enum([
  "roadmap_work",
  "feature_contract_work",
  "architecture_resolution",
  "implementation",
  "review",
  "review_finding",
  "security",
  "feature_completion_pool",
  "application_completion_pool",
]);
export type RewardCategory = z.infer<typeof RewardCategory>;

export const LedgerEntryDraft = z.object({
  accountId: Uuid,
  kind: LedgerEntryKind,
  bucket: LedgerBucket,
  /** Signed; sign must match kind/bucket rules above. */
  amount: TokenAmount.refine((n) => n !== 0, "zero entries are not written"),
  category: RewardCategory.nullable(),
  contributionId: Uuid.nullable(),
  poolId: Uuid.nullable(),
  /** The award this entry releases, voids or claws back. */
  relatedEntryId: Uuid.nullable(),
  /** Pairs the two rows of a release. */
  pairId: Uuid.nullable(),
  /** Deterministic: "<rule>:<subject id>:<contributor id>[:<n>]". Unique in the ledger. */
  idempotencyKey: z.string().min(8).max(300),
  scheduleVersion: z.string(),
  memo: z.string().max(1000),
  /** When a held award may be released (null for non-award kinds). */
  releaseAfter: Timestamp.nullable(),
});
export type LedgerEntryDraft = z.infer<typeof LedgerEntryDraft>;

export const LedgerEntry = LedgerEntryDraft.extend({
  id: Uuid,
  entryNo: z.number().int().positive(),
  prevHash: z.string(),
  entryHash: z.string(),
  createdAt: Timestamp,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const Balance = z.object({
  accountId: Uuid,
  held: TokenAmount,
  available: TokenAmount,
  score: TokenAmount,
});
export type Balance = z.infer<typeof Balance>;

/** Reward schedule: amounts are data, versioned, and a FOUNDER DECISION (GAPS.md G-12). */
export const RewardSchedule = z.object({
  scheduleVersion: z.string().regex(/^rewards\.v\d+$/),
  status: z.enum(["proposal", "active", "retired"]),
  holdDays: z.number().int().nonnegative(),
  implementation: z.object({ tokensPerSizePoint: z.number().int().positive() }),
  review: z.object({
    roadmapReview: z.number().int().nonnegative(),
    featureContractReview: z.number().int().nonnegative(),
    implementationReviewPerSizePoint: z.number().int().nonnegative(),
    /** Per material finding later upheld (fixed by the author or upheld by a ruling). */
    upheldFindingBonus: z.number().int().nonnegative(),
    maxUpheldFindingsPaidPerReview: z.number().int().nonnegative(),
  }),
  roadmap: z.object({ mergedRoadmapPool: z.number().int().nonnegative() }),
  featureContract: z.object({ mergedContractPool: z.number().int().nonnegative() }),
  architectureResolution: z.object({ perAcceptedRuling: z.number().int().nonnegative() }),
  security: z.object({
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }),
  pools: z.object({
    /** Feature completion pool = this percent of all implementation tokens awarded on the feature. */
    featureCompletionPercentOfImplementation: z.number().int().min(0).max(100),
    /** Fixed pool per target when BUILT reaches 10000 bp on a frozen inventory. */
    applicationCompletionPool: z.number().int().nonnegative(),
  }),
});
export type RewardSchedule = z.infer<typeof RewardSchedule>;

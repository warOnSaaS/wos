/**
 * RewardFacts: everything a reward rule reads that is not in the event itself. The control plane loads
 * these in the consumer's transaction and passes them in; the rules never read the database.
 *
 * `now` and `bootstrapSelfReviewed` are the Wave 0 fields. Every other field is optional and read only
 * by the rule named on it. A rule whose facts are missing produces no drafts (fail closed: nothing is
 * paid without the evidence the protocol requires). The control plane's loading of these facts is
 * requested in blockers/B-0001-rewards.md.
 */
import type { DocumentKind, ReviewIndependence, RewardCategory } from "@waronsaas/contracts";

/** An award already in the ledger (for reversals, releases and pool bases). */
export interface AwardFact {
  /** Ledger entry id of the award. */
  id: string;
  accountId: string;
  /** Positive award amount. */
  amount: number;
  category: RewardCategory;
  contributionId: string | null;
  poolId: string | null;
  scheduleVersion: string;
  releaseAfter: string;
  /** A release pair referencing this award exists. */
  released: boolean;
  /** A void or clawback referencing this award exists. */
  reversed: boolean;
  /**
   * The acceptance relied on a `bootstrap_self` review and no independent re-review has passed yet
   * (REVIEW-PROTOCOL.md section 9). Such awards are never released.
   */
  blockedByBootstrap: boolean;
}

export type ReviewSubjectKind = "roadmap" | "feature_contract" | "implementation";
export type FindingState = "open" | "disputed" | "resolved" | "upheld" | "overruled";
export type SecuritySeverity = "low" | "medium" | "high" | "critical";

/** The contribution named by a `contribution.accepted` / `contribution.reversed` event, with its basis. */
export interface ContributionFact {
  id: string;
  accountId: string;
  category: RewardCategory;
  state: "pending" | "accepted" | "rejected" | "reversed";
  independence: ReviewIndependence;
  /** category implementation. */
  implementation?: { attemptId: string; abuId: string; abuKey: string; sizePoints: number; merged: boolean };
  /** category review (one review of one round). */
  review?: {
    reviewId: string;
    subjectKind: ReviewSubjectKind;
    /** ABU size points; required for implementation reviews, null otherwise. */
    sizePoints: number | null;
    /** The reviewed subject was accepted (PR merged or document merged). */
    subjectAccepted: boolean;
    /** The verdict parsed against its schema. */
    schemaValid: boolean;
    /** Submitted before the review lease expired. */
    onTime: boolean;
    /** Invalidated (audit re-review, fraud, reverted subject). */
    invalidated: boolean;
  };
  /** category review_finding (one material finding). */
  finding?: {
    findingId: string;
    reviewId: string;
    material: boolean;
    state: FindingState;
    /**
     * 0-based position of this finding among the review's material findings that reached `resolved` or
     * `upheld`, ordered by (settled at, finding id). Only positions below the per-review cap are paid.
     */
    paidRank: number;
  };
  /** category architecture_resolution. */
  resolution?: { rulingId: string; confirmedByMaintainer: boolean };
  /** category security. */
  security?: { severity: SecuritySeverity; reference: string };
}

/** Pool split for a merged roadmap or feature contract version (`document.merged`). */
export interface DocumentPoolFact {
  documentId: string;
  kind: DocumentKind;
  /** Accepted `roadmap_work` / `feature_contract_work` contributions of this version, one per author. */
  authors: ReadonlyArray<{ contributionId: string; accountId: string; acceptedRevisions: number }>;
}

/** Feature completion pool of one app's profile (`app_feature.state_changed` to `built`). */
export interface FeaturePoolFact {
  /** The `reward_pools` row (kind feature_completion) for this app feature. */
  poolId: string;
  target: string;
  feature: string;
  appFeatureId: string;
  /**
   * Implementation awards on the ABUs relevant to THIS app's profile. A shared ABU appears in the facts
   * of every app whose profile references it (D10): paid once, counted in each pool.
   */
  implementationAwards: ReadonlyArray<AwardFact & { abuId: string }>;
}

/** Application completion pool of one target (`progress.recomputed` with built 10000). */
export interface ApplicationPoolFact {
  poolId: string;
  target: string;
  /** Lifetime tokens each account earned on this app's features, reviews and roadmap (net of reversals). */
  earnedByAccount: ReadonlyArray<{ accountId: string; tokens: number }>;
}

/** An independent re-review round of a merged subject that had a bootstrap_self round. */
export interface ReReviewFact {
  roundId: string;
  /** Awards whose acceptance relied on the bootstrap_self review of that subject. */
  awards: readonly AwardFact[];
}

export interface RewardFacts {
  now: string;
  bootstrapSelfReviewed: boolean;
  contribution?: ContributionFact;
  /** Awards of `contribution` (for `contribution.reversed`). */
  awards?: readonly AwardFact[];
  documentPool?: DocumentPoolFact;
  featurePool?: FeaturePoolFact;
  applicationPool?: ApplicationPoolFact;
  reReview?: ReReviewFact;
  [key: string]: unknown;
}

/** Inconsistent facts (they name a different subject than the event). A loader bug; never paid around. */
export class RewardFactsError extends Error {
  override name = "RewardFactsError";
}

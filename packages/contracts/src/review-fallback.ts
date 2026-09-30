/**
 * D53 in the V1 control plane (contracts 5.15.0): the ReviewPolicy fallback `fable_unavailable`.
 *
 * While it is active every round opens with the Astra agent seat and the REQUIRED HUMAN REVIEW in place of the Fable
 * seat; consensus is both NO_MATERIAL_GAPS on the same head sha and submission hash; the round (and every output of it)
 * is labelled `single_lab_review` with the reason; a Fable verdict is refused as a seat; a model never reviews work built
 * by the same model; every conflict goes to the human. Switching is a public, forward-only maintainer action
 * (`switch_review_policy`). A round pins its seats when it opens; the switch waits until no round is awaiting reviews.
 *
 * The human seat (REVIEW-PROTOCOL "D53"): ReviewPolicy `independence.humanMayBeSubjectAuthor = false`,
 * `humanMayHoldAgentSlotOfSameRound = false`, `bootstrap.selfReviewSatisfiesRules = false`. V1 authorized reviewers are
 * maintainers (`independence.assignment = admin_assigned`). There is no bootstrap self-review exception for this seat.
 */
import { z } from "zod";
import { ReviewVerdict, Ruling } from "./agent-io.js";
import { FeatureKey, GitSha, Sha256, TargetSlug, Timestamp, Uuid } from "./primitives.js";

export const ReviewFallback = z.enum(["none", "fable_unavailable"]);
export type ReviewFallback = z.infer<typeof ReviewFallback>;

export const SINGLE_LAB_REVIEW_LABEL = "single_lab_review" as const;
export const SINGLE_LAB_REVIEW_REASON = "fable_unavailable: Fable seat replaced by the required human review (D53)" as const;

/** The second seat of a round: Fable (normal), or the human review under `fable_unavailable`. */
export const SecondSeat = z.enum(["fable", "human"]);
export type SecondSeat = z.infer<typeof SecondSeat>;

/** The review policy in force (public). `switchSeq` null: no switch was ever made (fallback none). */
export const ReviewPolicyState = z.object({
  fallback: ReviewFallback,
  switchSeq: z.number().int().positive().nullable(),
  since: Timestamp.nullable(),
  reason: z.string().nullable(),
});
export type ReviewPolicyState = z.infer<typeof ReviewPolicyState>;

/** A round's seats and label, fixed when it opened. */
export const RoundSeats = z.object({
  secondSeat: SecondSeat,
  label: z.literal(SINGLE_LAB_REVIEW_LABEL).nullable(),
  labelReason: z.string().nullable(),
});
export type RoundSeats = z.infer<typeof RoundSeats>;

const SubjectKind = z.enum(["roadmap", "feature_contract", "implementation"]);

/** Why the caller may or may not hold the human seat of a round (reasons are plain words, stable prefixes). */
export const HumanSeatEligibility = z.object({ eligible: z.boolean(), reasons: z.array(z.string()) });
export type HumanSeatEligibility = z.infer<typeof HumanSeatEligibility>;

/** One round waiting for its human review. */
export const HumanReviewQueueItem = z.object({
  roundId: Uuid,
  roundNumber: z.number().int().positive(),
  subjectKind: SubjectKind,
  subjectId: Uuid,
  target: TargetSlug.nullable(),
  feature: FeatureKey.nullable(),
  headSha: GitSha,
  submissionSha256: Sha256,
  openedAt: Timestamp,
  /** True once the Astra verdict is sealed: the human seat opens after it (the human reads the agent's findings). */
  agentVerdictSealed: z.boolean(),
  label: z.literal(SINGLE_LAB_REVIEW_LABEL),
  eligibility: HumanSeatEligibility,
});
export type HumanReviewQueueItem = z.infer<typeof HumanReviewQueueItem>;

export const HumanReviewFinding = z.object({
  id: Uuid,
  roundNumber: z.number().int().positive(),
  source: z.enum(["astra", "fable", "human"]),
  severity: z.enum(["material", "minor"]),
  category: z.string(),
  title: z.string(),
  detail: z.string(),
  state: z.enum(["open", "resolved", "disputed", "upheld", "overruled"]),
});
export type HumanReviewFinding = z.infer<typeof HumanReviewFinding>;

/** What `wos review --human` shows before the human records a verdict. */
export const HumanReviewSubject = z.object({
  round: HumanReviewQueueItem,
  subject: z.object({
    repo: z.string(),
    branch: z.string().nullable(),
    title: z.string(),
    prNumber: z.number().int().nullable(),
    prUrl: z.url().nullable(),
    /** The document's canonical files plus every file the revision changed, at the round's head (GitHub links at that commit). */
    files: z.array(z.object({ path: z.string(), url: z.url() })),
    /** The author's summary of the revision (AuthorSummary / BuildSummary), verbatim. */
    authorSummary: z.unknown().nullable(),
  }),
  /** The sealed Astra verdict of this round, shown to the human seat only. Null until it is sealed. */
  agentReview: z
    .object({
      slot: z.literal("astra"),
      reviewerHandle: z.string(),
      model: z.string(),
      reasoning: z.string(),
      verdict: ReviewVerdict,
    })
    .nullable(),
  /** Revealed findings of earlier rounds with their state, so fixes can be checked. */
  priorFindings: z.array(HumanReviewFinding),
});
export type HumanReviewSubject = z.infer<typeof HumanReviewSubject>;

export const SubmitHumanReviewBody = z.object({
  verdict: ReviewVerdict,
  /** Binds the verdict to exactly what was reviewed. Must equal the round's head sha and submission hash. */
  headSha: GitSha,
  submissionSha256: Sha256,
});
export type SubmitHumanReviewBody = z.infer<typeof SubmitHumanReviewBody>;

export const SubmitHumanReviewResponse = z.object({
  sealed: z.literal(true),
  humanReviewId: Uuid,
  /** True when this verdict completed the round (the Astra verdict was already sealed). */
  revealed: z.boolean(),
  outcome: z.enum(["consensus", "gaps"]).nullable(),
});
export type SubmitHumanReviewResponse = z.infer<typeof SubmitHumanReviewResponse>;

/** Under the fallback every conflict goes to the human (D53, D58): the human rules directly; the ruling is final. */
export const HumanRulingBody = z.object({ ruling: Ruling, note: z.string().min(5).max(4000) });
export type HumanRulingBody = z.infer<typeof HumanRulingBody>;

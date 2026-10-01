/**
 * P1 shadow accounting, first slice (AGENTS.md "Next" 1): the PUBLIC shadow receipt of a real agent
 * contribution — everything the control plane already stores (agent runs with their usage and hashes,
 * the task's document/ABU, the review rounds and verdicts with their labels, the outcome), plus what
 * the task WOULD pay under the frozen protocol (D62), computed with the existing pure functions in
 * ./protocol (budgetModelMicro with the pinned policy; the D63 published base price). Nothing moves:
 * every budget carries the label "shadow — no value" and nothing is ever written to a protocol table.
 *
 *  S-1 A receipt is public: handle only, no emails, no account ids, no device ids, no signatures.
 *  S-2 A receipt is verifiable: receiptSha256 = canonicalSha256 (C-1/C-2) of the zod-parsed receipt
 *      with receiptSha256 removed (the C-4 pattern); anyone can recompute it from the served JSON.
 *  S-3 The shadow budget is honest about its basis: production stores no per-task difficulty or
 *      importance (task budgets are protocol tables, not applied), so the pinned STANDARD basis
 *      (10 000 bp x 10 000 bp) is stated in the receipt, never implied.
 *  S-4 Sealed reviews never appear: the control plane serves receipts as the anonymous actor, so RLS
 *      hides every review of a round that is not revealed yet (the round is listed with its state).
 */
import { z } from "zod";
import { canonicalSha256 } from "./canonical.js";
import { ReasoningLevel } from "./agent-policy.js";
import { Sha256, Timestamp, Uuid } from "./primitives.js";
import { CAPABILITY_POLICY_V2, REWARD_POLICY_V2 } from "./protocol/data.js";
import { basePriceAcuMicro, budgetModelMicro } from "./protocol/rules.js";

/** Decimal string of a non-negative micro value (the U64String convention of the protocol policies). */
const MicroString = z.string().regex(/^[0-9]+$/, "decimal micro string");

/** The task kinds a receipt covers: builders/revisers of an ABU, authors of a roadmap or feature contract. */
export const ShadowReceiptKind = z.enum(["abu_build", "abu_revision", "roadmap_author", "feature_author"]);
export type ShadowReceiptKind = z.infer<typeof ShadowReceiptKind>;

/** Subject states the control plane can serve (the attempt and document state machines). */
export const ShadowSubjectState = z.enum([
  // attempt states past submission
  "submitted",
  "candidate_pushed",
  "in_review",
  "changes_requested",
  "qualified",
  "pr_open",
  "merged",
  "expired",
  "abandoned",
  "failed",
  "closed_unmerged",
  "superseded",
  // document states past drafting
  "in_review",
  "revising",
  "escalated",
  "consensus",
  "merged",
  "abandoned",
]);
export type ShadowSubjectState = z.infer<typeof ShadowSubjectState>;

export const ShadowReviewVerdict = z.enum(["NO_MATERIAL_GAPS", "MATERIAL_GAPS"]);
export type ShadowReviewVerdict = z.infer<typeof ShadowReviewVerdict>;

export const ShadowReviewIndependence = z.enum(["independent", "bootstrap_maintainer", "bootstrap_self"]);

/** One review verdict of a round: an agent seat (astra/fable) or the D53/D67 human seat. */
export const ShadowReceiptReview = z.object({
  slot: z.enum(["astra", "fable", "human"]),
  handle: z.string().nullable(),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  reasoning: ReasoningLevel.nullable(),
  verdict: ShadowReviewVerdict,
  independence: ShadowReviewIndependence.nullable(),
  /** "single_lab_review" when the round ran Astra + the human seat (D53; bootstrap_self rounds, D67). */
  reviewLabel: z.string().nullable(),
  bootstrapSelf: z.boolean().nullable(),
  sealedAt: Timestamp.nullable(),
});
export type ShadowReceiptReview = z.infer<typeof ShadowReceiptReview>;

/** One review round of the subject, with its labels and its (revealed) verdicts. */
export const ShadowReceiptRound = z.object({
  id: Uuid,
  number: z.number().int().positive(),
  state: z.enum(["awaiting_reviews", "revealed", "cancelled"]),
  outcome: z.enum(["consensus", "gaps"]).nullable(),
  independence: ShadowReviewIndependence.nullable(),
  /** "single_lab_review" (D53): the round's second seat was the required human review, not Fable. */
  reviewLabel: z.string().nullable(),
  /** "candidate_trial:<candidate>" (D69): the round was claimed by a designated candidate. */
  trialLabel: z.string().nullable(),
  secondSeat: z.enum(["fable", "human"]).nullable(),
  headSha: z.string(),
  submissionSha256: Sha256,
  openedAt: Timestamp,
  revealedAt: Timestamp.nullable(),
  reviews: z.array(ShadowReceiptReview),
});
export type ShadowReceiptRound = z.infer<typeof ShadowReceiptRound>;

/** One agent run behind the contribution, as the control plane already stores it. */
export const ShadowReceiptRun = z.object({
  id: Uuid,
  provider: z.string(),
  /** D70: the launch as declared (e.g. the claude CLI pointed at Z.ai); null on the default endpoint. */
  launchProvider: z.string().nullable(),
  modelIdRequested: z.string(),
  /** As reported by the CLI's own event stream; null if the CLI did not report it. */
  modelIdReported: z.string().nullable(),
  reasoning: ReasoningLevel,
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  /** The CLI's own cost figure as reported (usageDetail.costUsd); null = not reported. */
  costUsd: z.number().nullable(),
  steps: z.number().int().nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  durationSeconds: z.number().nonnegative(),
  exitCode: z.number().int().nullable(),
  /** "shadow" for a run archived locally and never submitted (contracts 5.19.0). */
  mode: z.enum(["shadow"]).nullable(),
  manifestSha256: Sha256,
  transcriptSha256: Sha256.nullable(),
  outputSha256: Sha256.nullable(),
});
export type ShadowReceiptRun = z.infer<typeof ShadowReceiptRun>;

/** What the task WOULD pay under the frozen protocol — labelled, and moving no value. */
export const ShadowBudget = z.object({
  label: z.literal("shadow — no value"),
  policy: z.object({ capability: z.literal("capability-policy.v2"), reward: z.literal("reward-policy.v2") }),
  taskKind: z.string(),
  sizePoints: z.number().int().nonnegative(),
  /** The pinned STANDARD basis (S-3): production stores no per-task difficulty or importance. */
  difficultyBp: z.number().int(),
  importanceBp: z.number().int(),
  /** The budget model (D49) in micro-ACU: (base + per-size-point x size) x difficulty x importance. */
  budgetAcuMicro: MicroString,
  /** The D63 published BASE price: floor(budget / (1 + queue bonus)). The queue pays base + the bonus. */
  basePriceAcuMicro: MicroString,
  queueBonusBp: z.number().int(),
});
export type ShadowBudget = z.infer<typeof ShadowBudget>;

/** List shape (newest first, cursor-paginated): enough to read the receipt without the detail. */
export const ShadowReceiptSummary = z.object({
  id: Uuid,
  kind: ShadowReceiptKind,
  handle: z.string().nullable(),
  target: z.string().nullable(),
  feature: z.string().nullable(),
  abu: z.string().nullable(),
  abuTitle: z.string().nullable(),
  documentKind: z.enum(["roadmap", "feature_contract"]).nullable(),
  documentVersion: z.number().int().nullable(),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
  reasoning: ReasoningLevel.nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  runCount: z.number().int().nonnegative(),
  roundCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  trialLabel: z.string().nullable(),
  outcome: z.object({
    state: ShadowSubjectState,
    merged: z.boolean(),
    pr: z.object({ number: z.number().int().positive(), url: z.string() }).nullable(),
    /** wos.contributions state for this contribution; null = no contribution row yet. */
    contribution: z.enum(["pending", "accepted", "rejected", "reversed"]).nullable(),
  }),
  shadowBudget: ShadowBudget.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type ShadowReceiptSummary = z.infer<typeof ShadowReceiptSummary>;

/** Detail shape: the summary plus the full evidence (runs, rounds, verdicts) and the receipt hash. */
export const ShadowReceipt = ShadowReceiptSummary.extend({
  runs: z.array(ShadowReceiptRun),
  rounds: z.array(ShadowReceiptRound),
  /** S-2: canonicalSha256 of the parsed receipt with this field removed. */
  receiptSha256: Sha256,
});
export type ShadowReceipt = z.infer<typeof ShadowReceipt>;

/** S-2: the receipt hash, recomputable by anyone from the served JSON (zod-parsed, hash removed). */
export function shadowReceiptSha256(receipt: ShadowReceipt | Omit<ShadowReceipt, "receiptSha256">): Sha256 {
  return canonicalSha256(ShadowReceipt.omit({ receiptSha256: true }).parse(receipt));
}

// ---------------------------------------------------------------------------------------------- shadow budget

/** The pinned composite policy budgetModelMicro reads (the assembly the protocol tests pin). */
const SHADOW_MODEL_POLICY = {
  capabilityBudgets: CAPABILITY_POLICY_V2.budgets,
  model: REWARD_POLICY_V2.budgets.model,
  humanReviewWeights: REWARD_POLICY_V2.humanReview.weightAcuEqMicro,
  bugs: REWARD_POLICY_V2.bugs,
} as const;

/** S-3: the standard basis — the protocol's own midpoint (10 000 bp x 10 000 bp), stated in every budget. */
export const SHADOW_STANDARD_BASIS = { difficultyBp: 10_000, importanceBp: 10_000 } as const;

/**
 * What a task of this kind and size WOULD pay under the frozen protocol: the D49 budget model from the
 * pinned v2 policies, and the D63 published base price at the pinned queue bonus. Null when the pinned
 * policy has no budget row for the task kind (unknown-safe: the receipt then shows no budget). Never
 * writes anything, never moves value.
 */
export function shadowBudget(taskKind: string, sizePoints: number): ShadowBudget | null {
  const model = budgetModelMicro(SHADOW_MODEL_POLICY, { taskKind, sizePoints, ...SHADOW_STANDARD_BASIS });
  if ("refusal" in model) return null;
  const queueBonusBp = REWARD_POLICY_V2.queue?.queueBonusBp;
  if (queueBonusBp === undefined) return null;
  return {
    label: "shadow — no value",
    policy: { capability: "capability-policy.v2", reward: "reward-policy.v2" },
    taskKind,
    sizePoints,
    difficultyBp: SHADOW_STANDARD_BASIS.difficultyBp,
    importanceBp: SHADOW_STANDARD_BASIS.importanceBp,
    budgetAcuMicro: String(model.modelMicro),
    basePriceAcuMicro: String(basePriceAcuMicro(model.modelMicro, queueBonusBp)),
    queueBonusBp,
  };
}

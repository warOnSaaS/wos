import { z } from "zod";
import { ReviewerSlot } from "./agent-policy.js";
import { ReviewIndependence, TaskKind } from "./agent-io.js";
import { DocumentKind } from "./domain.js";
import { AbuKey, FeatureKey, GitSha, Sha256, TargetSlug, Uuid, BasisPoints } from "./primitives.js";
import { RewardCategory } from "./rewards.js";

/**
 * Domain events. Every state transition writes exactly one event row in the same transaction
 * (packages/db table wos.events, append-only). Events are the activity feed, the input to the
 * progress and reward consumers, and the audit trail.
 *
 * Envelope rules:
 *  - `type` is "<aggregate>.<past-tense verb>"; payloads are versioned by `v`.
 *  - `visibility: "public"` events appear in the public activity feed; "private" never leave the API.
 *  - Consumers are idempotent on `id` (wos.event_consumptions has PK (event_id, consumer)).
 *  - Adding an event type is a MINOR contract change; changing a payload is MAJOR (add a v2 instead).
 */

const e = <T extends string, P extends z.ZodRawShape>(type: T, visibility: "public" | "private", payload: P) =>
  z.object({ type: z.literal(type), v: z.literal(1), visibility: z.literal(visibility), payload: z.object(payload) });

export const DomainEventBody = z.discriminatedUnion("type", [
  e("target.listed", "public", { target: TargetSlug }),
  e("target.repo_linked", "public", { target: TargetSlug, repo: z.string() }),
  e("target.hosting_changed", "public", { target: TargetSlug, hosted: z.boolean(), selfHostable: z.boolean() }),

  e("document.opened", "public", {
    documentId: Uuid,
    kind: DocumentKind,
    /** Roadmaps: the app. Feature contracts: null (contracts 3.1.0, B-0005-control-plane). */
    target: TargetSlug.nullable(),
    feature: FeatureKey.nullable(),
    /** Apps the document serves: [target] for a roadmap, every referencing app for a contract. */
    relevantTo: z.array(TargetSlug).default([]),
    version: z.number().int(),
  }),
  e("document.revision_submitted", "public", { documentId: Uuid, taskId: Uuid, headSha: GitSha }),
  e("document.validation_failed", "public", { documentId: Uuid, headSha: GitSha, errorCount: z.number().int() }),
  e("document.round_opened", "public", { documentId: Uuid, roundId: Uuid, roundNumber: z.number().int(), headSha: GitSha }),
  e("document.escalated", "public", { documentId: Uuid, roundId: Uuid }),
  e("document.consensus_reached", "public", { documentId: Uuid, roundId: Uuid, headSha: GitSha }),
  e("document.merged", "public", { documentId: Uuid, kind: DocumentKind, mergeSha: GitSha, prNumber: z.number().int() }),
  e("document.abandoned", "public", { documentId: Uuid, reason: z.string() }),

  e("round.verdict_sealed", "private", { roundId: Uuid, slot: ReviewerSlot, reviewId: Uuid }),
  e("round.revealed", "public", {
    roundId: Uuid,
    subjectKind: z.enum(["roadmap", "feature_contract", "implementation"]),
    subjectId: Uuid,
    outcome: z.enum(["consensus", "gaps"]),
    materialFindings: z.number().int(),
    independence: ReviewIndependence,
  }),
  e("finding.ruled", "public", { findingId: Uuid, decision: z.enum(["upheld", "overruled"]), confirmedBy: Uuid }),

  e("catalog.feature_added", "public", { feature: FeatureKey, proposedBy: TargetSlug }),
  e("catalog.feature_aliased", "public", { feature: FeatureKey, aliasOf: FeatureKey }),
  e("app_feature.tracked", "public", {
    target: TargetSlug,
    feature: FeatureKey,
    capability: z.string(),
    roadmapVersion: z.number().int(),
    weightBp: z.number().int(),
  }),
  e("app_feature.state_changed", "public", { target: TargetSlug, feature: FeatureKey, from: z.string(), to: z.string() }),
  e("abu.created", "public", { abuId: Uuid, abu: AbuKey, feature: FeatureKey }),
  e("abu.state_changed", "public", { abuId: Uuid, abu: AbuKey, from: z.string(), to: z.string() }),

  e("task.created", "private", { taskId: Uuid, kind: TaskKind }),
  e("task.state_changed", "private", { taskId: Uuid, from: z.string(), to: z.string() }),
  e("lease.issued", "private", { leaseId: Uuid, taskId: Uuid, accountId: Uuid }),
  e("lease.ended", "private", { leaseId: Uuid, taskId: Uuid, to: z.enum(["completed", "released", "expired", "revoked"]) }),

  /** Creating an aggregate in its initial state writes `<aggregate>.created`, never a state_changed from "none". */
  e("attempt.created", "public", { attemptId: Uuid, abu: AbuKey, state: z.literal("leased") }),
  e("attempt.state_changed", "public", { attemptId: Uuid, abu: AbuKey, from: z.string(), to: z.string() }),
  // contracts 3.0.0 (B-0002-control-plane): one event type for every transition that had none.
  e("document.state_changed", "public", { documentId: Uuid, event: z.string(), from: z.string(), to: z.string() }),
  e("round.cancelled", "public", { roundId: Uuid, reason: z.string() }),
  e("contribution.state_changed", "public", { contributionId: Uuid, from: z.string(), to: z.string(), reason: z.string().nullable() }),
  e("proposal.state_changed", "public", { proposalId: Uuid, from: z.string(), to: z.string() }),
  e("blocker.state_changed", "public", { blockerId: Uuid, from: z.string(), to: z.string() }),
  e("inventory_version.state_changed", "public", { id: Uuid, event: z.string(), from: z.string(), to: z.string() }),
  e("verification.recorded", "public", {
    subject: z.enum(["attempt", "document", "profile_acceptance"]),
    subjectId: z.string(),
    headSha: GitSha,
    conclusion: z.string(),
    /** Set for profile_acceptance (per-surface checks, D13). */
    surface: z.string().nullable(),
  }),
  e("attempt.manifest_recorded", "private", { attemptId: Uuid, manifestSha256: Sha256 }),
  e("attempt.pr_opened", "public", { attemptId: Uuid, abu: AbuKey, prNumber: z.number().int(), prUrl: z.string() }),
  e("attempt.merged", "public", { attemptId: Uuid, abu: AbuKey, mergeSha: GitSha, prNumber: z.number().int() }),

  e("progress.recomputed", "public", {
    target: TargetSlug,
    mappedBp: BasisPoints,
    specifiedBp: BasisPoints,
    builtBp: BasisPoints,
    roadmapVersion: z.number().int().nullable(),
    /** sha256 of the ProgressInput the numbers were computed from (traceability, D11). */
    inputSha256: z.string(),
  }),

  e("contribution.accepted", "public", { contributionId: Uuid, accountId: Uuid, category: RewardCategory }),
  e("contribution.reversed", "public", { contributionId: Uuid, reason: z.string() }),
  e("ledger.entry_written", "public", { entryNo: z.number().int(), accountId: Uuid, amount: z.number().int(), kind: z.string() }),

  e("proposal.opened", "public", { proposalId: Uuid, target: TargetSlug, issueNumber: z.number().int() }),
  e("blocker.opened", "public", { blockerId: Uuid, target: TargetSlug.nullable(), issueNumber: z.number().int() }),

  e("platform.bootstrap_ended", "public", { reason: z.string() }),
  e("account.created", "private", { accountId: Uuid }),
  e("account.github_linked", "public", { accountId: Uuid, handle: z.string(), githubUserId: z.number().int() }),
  e("account.github_unlinked", "private", { accountId: Uuid, githubUserId: z.number().int() }),
  e("account.suspended", "private", { accountId: Uuid, reason: z.string() }),
]);
export type DomainEventBody = z.infer<typeof DomainEventBody>;
export type DomainEventType = DomainEventBody["type"];

export const DomainEvent = z.intersection(
  z.object({
    id: z.number().int().positive(),
    occurredAt: z.iso.datetime({ offset: true }),
    actorAccountId: Uuid.nullable(),
    actorKind: z.enum(["contributor", "maintainer", "system", "github"]),
    aggregateKind: z.string(),
    aggregateId: z.string(),
    contractsVersion: z.string(),
  }),
  DomainEventBody,
);
export type DomainEvent = z.infer<typeof DomainEvent>;

/** Consumers registered in V1. Each processes every event at-least-once, idempotently. */
export const EventConsumer = z.enum(["progress", "rewards", "task_unlocker", "github_sync", "public_feed"]);
export type EventConsumer = z.infer<typeof EventConsumer>;

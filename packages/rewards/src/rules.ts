/**
 * The reward rules (REWARD-PROTOCOL.md). Pure: one domain event plus loaded facts in, ledger entry drafts
 * out. Deterministic: the same event and facts always give the same drafts, sorted by idempotency key, and
 * every key is derived from subject ids only, so replaying an event never writes anything new.
 *
 * Which event pays what (one source per category, so nothing is paid twice):
 *
 *   contribution.accepted   implementation, review, review_finding, architecture_resolution, security
 *   document.merged         roadmap_work / feature_contract_work pool, split by accepted revisions
 *   app_feature.state_changed (to built)   feature_completion_pool of that app's profile (D10)
 *   progress.recomputed (built 10000)      application_completion_pool
 *   contribution.reversed   void (held) or clawback (released) of each live award of the contribution
 *   round.revealed          an independent re-review of a bootstrap_self subject that found gaps voids
 *                           the held awards it was guarding (REVIEW-PROTOCOL.md section 9)
 *   everything else         nothing — in particular attempt.pr_opened, attempt.merged (the contribution's
 *                           acceptance pays), finding.ruled (the finding contribution's acceptance pays),
 *                           round.verdict_sealed and lease events.
 *
 * Releases are not event-driven; the sweeper calls `computeReleaseDrafts` (release.ts).
 */
import { type DomainEvent, LedgerEntryDraft, type LedgerEntryKind, type RewardCategory, type RewardSchedule } from "@waronsaas/contracts";
import { allocatePool, compareKeys } from "./allocate.js";
import {
  type AwardFact,
  type ContributionFact,
  type DocumentPoolFact,
  type FeaturePoolFact,
  type ApplicationPoolFact,
  type RewardFacts,
  RewardFactsError,
} from "./facts.js";

const DAY_MS = 86_400_000;
const BUILT_COMPLETE_BP = 10_000;

export function computeLedgerDrafts(event: DomainEvent, facts: RewardFacts, schedule: RewardSchedule): LedgerEntryDraft[] {
  let drafts: LedgerEntryDraft[];
  switch (event.type) {
    case "contribution.accepted":
      drafts = acceptedContribution(event, facts, schedule);
      break;
    case "contribution.reversed":
      drafts = reversedContribution(event.payload.contributionId, facts, event.payload.reason);
      break;
    case "document.merged":
      drafts = documentPool(event, facts.documentPool, schedule);
      break;
    case "app_feature.state_changed":
      drafts = event.payload.to === "built" ? featurePool(event, facts.featurePool, schedule) : [];
      break;
    case "progress.recomputed":
      drafts = event.payload.builtBp === BUILT_COMPLETE_BP ? applicationPool(event, facts.applicationPool, schedule) : [];
      break;
    case "round.revealed":
      drafts =
        event.payload.independence === "independent" && event.payload.outcome === "gaps" && facts.reReview ? failedReReview(facts) : [];
      break;
    default:
      // attempt.pr_opened, attempt.merged, finding.ruled and every other event: never paid directly.
      drafts = [];
  }
  return finish(drafts);
}

// ------------------------------------------------------------------------------------ contribution.accepted

type AcceptedEvent = Extract<DomainEvent, { type: "contribution.accepted" }>;

function acceptedContribution(event: AcceptedEvent, facts: RewardFacts, schedule: RewardSchedule): LedgerEntryDraft[] {
  const c = facts.contribution;
  if (!c) return [];
  const p = event.payload;
  if (c.id !== p.contributionId || c.accountId !== p.accountId || c.category !== p.category) {
    throw new RewardFactsError(
      `contribution facts ${c.id}/${c.accountId}/${c.category} do not match event ${p.contributionId}/${p.accountId}/${p.category}`,
    );
  }
  // Only an accepted contribution earns. A contribution already reversed has nothing left to pay.
  if (c.state !== "accepted") return [];
  const held = heldNote(c, facts);
  const award = (subjectId: string, amount: number, memo: string) =>
    awardDraft(event, schedule, {
      accountId: c.accountId,
      category: c.category,
      contributionId: c.id,
      subjectId,
      amount,
      memo: memo + held,
    });

  switch (c.category) {
    case "implementation": {
      const i = c.implementation;
      if (!i?.merged) return [];
      positiveInt(i.sizePoints, "implementation.sizePoints");
      const per = schedule.implementation.tokensPerSizePoint;
      return award(i.attemptId, per * i.sizePoints, `implementation of ${i.abuKey}: ${i.sizePoints} size points x ${per}`);
    }
    case "review": {
      const r = c.review;
      if (!r?.subjectAccepted || !r.schemaValid || !r.onTime || r.invalidated) return [];
      let amount: number;
      let basis: string;
      if (r.subjectKind === "roadmap") {
        amount = schedule.review.roadmapReview;
        basis = "roadmap review";
      } else if (r.subjectKind === "feature_contract") {
        amount = schedule.review.featureContractReview;
        basis = "feature contract review";
      } else {
        if (r.sizePoints === null) throw new RewardFactsError(`implementation review ${r.reviewId} has no size points`);
        positiveInt(r.sizePoints, "review.sizePoints");
        amount = schedule.review.implementationReviewPerSizePoint * r.sizePoints;
        basis = `implementation review: ${r.sizePoints} size points x ${schedule.review.implementationReviewPerSizePoint}`;
      }
      // G-13: flat per valid, on-time review of an accepted subject, whatever the verdict.
      return award(r.reviewId, amount, basis);
    }
    case "review_finding": {
      const f = c.finding;
      if (!f?.material) return [];
      if (f.state !== "resolved" && f.state !== "upheld") return [];
      if (f.paidRank < 0 || f.paidRank >= schedule.review.maxUpheldFindingsPaidPerReview) return [];
      return award(f.findingId, schedule.review.upheldFindingBonus, `material finding ${f.state} (review ${f.reviewId})`);
    }
    case "architecture_resolution": {
      const r = c.resolution;
      if (!r?.confirmedByMaintainer) return [];
      return award(r.rulingId, schedule.architectureResolution.perAcceptedRuling, "architecture ruling confirmed by a maintainer");
    }
    case "security": {
      const s = c.security;
      if (!s) return [];
      return award(c.id, schedule.security[s.severity], `security report (${s.severity}) ${s.reference}`);
    }
    default:
      // roadmap_work, feature_contract_work and the pools are paid by their pool events, never per contribution.
      return [];
  }
}

function heldNote(c: ContributionFact, facts: RewardFacts): string {
  return c.independence === "bootstrap_self" || facts.bootstrapSelfReviewed
    ? " (bootstrap review: held until an independent re-review passes)"
    : "";
}

// ------------------------------------------------------------------------------------ reversals

function reversedContribution(contributionId: string, facts: RewardFacts, reason: string): LedgerEntryDraft[] {
  const awards = facts.awards ?? [];
  for (const a of awards) {
    if (a.contributionId !== contributionId) throw new RewardFactsError(`award ${a.id} does not belong to contribution ${contributionId}`);
  }
  return awards.filter((a) => !a.reversed).map((a) => reversal(a, `reversed: ${reason}`));
}

function failedReReview(facts: RewardFacts): LedgerEntryDraft[] {
  const r = facts.reReview!;
  // Held awards for the failed work are voided; released ones cannot exist (they were blocked).
  return r.awards.filter((a) => !a.reversed && !a.released).map((a) => reversal(a, `independent re-review ${r.roundId} found gaps`));
}

function reversal(a: AwardFact, memo: string): LedgerEntryDraft {
  const kind: LedgerEntryKind = a.released ? "clawback" : "void";
  return {
    accountId: a.accountId,
    kind,
    bucket: a.released ? "available" : "held",
    amount: -a.amount,
    category: null,
    contributionId: a.contributionId,
    poolId: a.poolId,
    relatedEntryId: a.id,
    pairId: null,
    idempotencyKey: `${kind}:${a.id}`,
    // A reversal undoes an entry; it records the schedule that entry was computed under.
    scheduleVersion: a.scheduleVersion,
    memo: memo.slice(0, 1000),
    releaseAfter: null,
  };
}

// ------------------------------------------------------------------------------------ pools

type MergedEvent = Extract<DomainEvent, { type: "document.merged" }>;

function documentPool(event: MergedEvent, f: DocumentPoolFact | undefined, schedule: RewardSchedule): LedgerEntryDraft[] {
  if (!f) return [];
  if (f.documentId !== event.payload.documentId || f.kind !== event.payload.kind) {
    throw new RewardFactsError(
      `document pool facts ${f.documentId}/${f.kind} do not match event ${event.payload.documentId}/${event.payload.kind}`,
    );
  }
  const category: RewardCategory = f.kind === "roadmap" ? "roadmap_work" : "feature_contract_work";
  const total = f.kind === "roadmap" ? schedule.roadmap.mergedRoadmapPool : schedule.featureContract.mergedContractPool;
  // One share per author, weighted by accepted revisions; the draft names the author's first contribution.
  const byAccount = new Map<string, { weight: number; contributionId: string }>();
  for (const a of f.authors) {
    if (!Number.isSafeInteger(a.acceptedRevisions) || a.acceptedRevisions < 0)
      throw new RewardFactsError(`bad acceptedRevisions for ${a.accountId}`);
    const cur = byAccount.get(a.accountId);
    if (!cur) byAccount.set(a.accountId, { weight: a.acceptedRevisions, contributionId: a.contributionId });
    else {
      cur.weight += a.acceptedRevisions;
      if (compareKeys(a.contributionId, cur.contributionId) < 0) cur.contributionId = a.contributionId;
    }
  }
  const weights = [...byAccount].map(([key, v]) => ({ key, weight: v.weight })).filter((w) => w.weight > 0);
  if (weights.length === 0) return [];
  const shares = allocatePool(total, weights);
  const label = f.kind === "roadmap" ? "roadmap" : "feature contract";
  return [...shares]
    .filter(([, amount]) => amount > 0)
    .flatMap(([accountId, amount]) =>
      awardDraft(event, schedule, {
        accountId,
        category,
        contributionId: byAccount.get(accountId)!.contributionId,
        subjectId: f.documentId,
        amount,
        memo: `merged ${label} version pool of ${total}: ${byAccount.get(accountId)!.weight} accepted revisions`,
      }),
    );
}

type AppFeatureEvent = Extract<DomainEvent, { type: "app_feature.state_changed" }>;

/** 10% (schedule) of the implementation tokens awarded on ABUs relevant to the app's profile, rounded down. */
export function featureCompletionPoolTotal(
  implementationAwards: ReadonlyArray<Pick<AwardFact, "amount" | "reversed">>,
  schedule: RewardSchedule,
): number {
  const base = implementationAwards.filter((a) => !a.reversed).reduce((s, a) => s + a.amount, 0);
  return Math.floor((base * schedule.pools.featureCompletionPercentOfImplementation) / 100);
}

function featurePool(event: AppFeatureEvent, f: FeaturePoolFact | undefined, schedule: RewardSchedule): LedgerEntryDraft[] {
  if (!f) return [];
  if (f.target !== event.payload.target || f.feature !== event.payload.feature) {
    throw new RewardFactsError(
      `feature pool facts ${f.target}/${f.feature} do not match event ${event.payload.target}/${event.payload.feature}`,
    );
  }
  const seenAward = new Set<string>();
  const live = f.implementationAwards.filter((a) => {
    if (a.category !== "implementation") throw new RewardFactsError(`award ${a.id} in a feature pool basis is ${a.category}`);
    if (seenAward.has(a.id)) throw new RewardFactsError(`award ${a.id} listed twice in the pool basis`);
    seenAward.add(a.id);
    return !a.reversed;
  });
  const total = featureCompletionPoolTotal(live, schedule);
  const weightBy = new Map<string, number>();
  for (const a of live) weightBy.set(a.accountId, (weightBy.get(a.accountId) ?? 0) + a.amount);
  return poolAwards(event, schedule, "feature_completion_pool", f.poolId, total, weightBy, `${f.target} profile of ${f.feature} complete`);
}

type ProgressEvent = Extract<DomainEvent, { type: "progress.recomputed" }>;

function applicationPool(event: ProgressEvent, f: ApplicationPoolFact | undefined, schedule: RewardSchedule): LedgerEntryDraft[] {
  if (!f) return [];
  if (f.target !== event.payload.target)
    throw new RewardFactsError(`application pool facts ${f.target} do not match event ${event.payload.target}`);
  const weightBy = new Map<string, number>();
  for (const e of f.earnedByAccount) if (e.tokens > 0) weightBy.set(e.accountId, (weightBy.get(e.accountId) ?? 0) + e.tokens);
  return poolAwards(
    event,
    schedule,
    "application_completion_pool",
    f.poolId,
    schedule.pools.applicationCompletionPool,
    weightBy,
    `${f.target} BUILT reached 100%`,
  );
}

function poolAwards(
  event: DomainEvent,
  schedule: RewardSchedule,
  category: "feature_completion_pool" | "application_completion_pool",
  poolId: string,
  total: number,
  weightBy: Map<string, number>,
  memo: string,
): LedgerEntryDraft[] {
  if (total === 0 || weightBy.size === 0) return [];
  const shares = allocatePool(
    total,
    [...weightBy].map(([key, weight]) => ({ key, weight })),
  );
  return [...shares]
    .filter(([, amount]) => amount > 0)
    .flatMap(([accountId, amount]) =>
      awardDraft(event, schedule, {
        accountId,
        category,
        contributionId: null,
        poolId,
        subjectId: poolId,
        amount,
        memo: `${memo}: pool of ${total}`,
      }),
    );
}

// ------------------------------------------------------------------------------------ drafts

function awardDraft(
  event: DomainEvent,
  schedule: RewardSchedule,
  a: {
    accountId: string;
    category: RewardCategory;
    contributionId: string | null;
    poolId?: string;
    subjectId: string;
    amount: number;
    memo: string;
  },
): LedgerEntryDraft[] {
  if (a.amount === 0) return [];
  return [
    {
      accountId: a.accountId,
      kind: "award",
      bucket: "held",
      amount: a.amount,
      category: a.category,
      contributionId: a.contributionId,
      poolId: a.poolId ?? null,
      relatedEntryId: null,
      pairId: null,
      idempotencyKey: `award:${a.category}:${a.subjectId}:${a.accountId}`,
      scheduleVersion: schedule.scheduleVersion,
      memo: a.memo.slice(0, 1000),
      releaseAfter: holdUntil(event.occurredAt, schedule),
    },
  ];
}

/** Hold window from the event time, so replays compute the same instant. */
function holdUntil(occurredAt: string, schedule: RewardSchedule): string {
  const t = Date.parse(occurredAt);
  if (Number.isNaN(t)) throw new RewardFactsError(`bad occurredAt ${occurredAt}`);
  return new Date(t + schedule.holdDays * DAY_MS).toISOString();
}

function positiveInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RewardFactsError(`${what} must be a positive integer, got ${n}`);
}

/** Validates every draft against the contract and the ledger sign rules, then sorts by key. */
export function finish(drafts: LedgerEntryDraft[]): LedgerEntryDraft[] {
  const keys = new Set<string>();
  for (const d of drafts) {
    LedgerEntryDraft.parse(d);
    assertSignRules(d);
    if (keys.has(d.idempotencyKey)) throw new Error(`duplicate idempotency key ${d.idempotencyKey}`);
    keys.add(d.idempotencyKey);
  }
  return [...drafts].sort((a, b) => compareKeys(a.idempotencyKey, b.idempotencyKey));
}

/**
 * The `ledger_sign_rules` CHECK of packages/db for system-written entries (adjustments are
 * maintainer-only and never drafted here).
 */
export function assertSignRules(d: LedgerEntryDraft): void {
  const ok =
    (d.kind === "award" && d.bucket === "held" && d.amount > 0 && d.category !== null && d.releaseAfter !== null) ||
    (d.kind === "release" &&
      ((d.bucket === "held" && d.amount < 0) || (d.bucket === "available" && d.amount > 0)) &&
      d.pairId !== null &&
      d.relatedEntryId !== null) ||
    (d.kind === "void" && d.bucket === "held" && d.amount < 0 && d.relatedEntryId !== null) ||
    (d.kind === "clawback" && d.bucket === "available" && d.amount < 0 && d.relatedEntryId !== null) ||
    (d.kind === "debit" && d.bucket === "available" && d.amount < 0);
  if (!ok) throw new Error(`draft ${d.idempotencyKey} breaks the ledger sign rules (${d.kind}/${d.bucket}/${d.amount})`);
}

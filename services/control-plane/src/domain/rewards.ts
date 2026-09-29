/**
 * The rewards loader (REWARD-PROTOCOL.md section 8, B-0001-rewards): loads the typed `RewardFacts` for one
 * event in the consumer's transaction, creates `reward_pools` rows before the rules run, and persists the
 * drafts the pure rules return. Contribution state transitions stay here; the rules return drafts only.
 */
import type { DomainEvent, ReviewIndependence, RewardCategory } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { AwardFact, ContributionFact, RewardFacts } from "@waronsaas/rewards";
import { featureCompletionPoolTotal } from "@waronsaas/rewards";
import type { Deps } from "../deps.js";
import { uuidv7 } from "../util/crypto.js";
import { insertLedgerEntry } from "./ledger.js";

interface AwardRow {
  id: string;
  account_id: string;
  amount: string;
  category: RewardCategory;
  contribution_id: string | null;
  pool_id: string | null;
  schedule_version: string;
  release_after: Date;
  released: boolean;
  reversed: boolean;
  independence: ReviewIndependence | null;
}

const AWARD_SELECT = `
  select l.id, l.account_id, l.amount, l.category, l.contribution_id, l.pool_id, l.schedule_version, l.release_after,
         exists (select 1 from wos.ledger_entries r where r.related_entry_id = l.id and r.kind = 'release') as released,
         exists (select 1 from wos.ledger_entries r where r.related_entry_id = l.id and r.kind in ('void', 'clawback')) as reversed,
         c.independence
    from wos.ledger_entries l left join wos.contributions c on c.id = l.contribution_id
   where l.kind = 'award'`;

const toAward = (r: AwardRow): AwardFact => ({
  id: r.id,
  accountId: r.account_id,
  amount: Number(r.amount),
  category: r.category,
  contributionId: r.contribution_id,
  poolId: r.pool_id,
  scheduleVersion: r.schedule_version,
  releaseAfter: new Date(r.release_after).toISOString(),
  released: r.released,
  reversed: r.reversed,
  // No independent re-review of a bootstrap_self subject exists in V1 yet, so such awards stay held.
  blockedByBootstrap: r.independence === "bootstrap_self",
});

/** Awards matching a SQL condition on alias l (ledger entry) and c (contribution). */
export async function loadAwards(tx: Tx, where: string, params: unknown[]): Promise<AwardFact[]> {
  const rows = await tx.unsafe<AwardRow[]>(`${AWARD_SELECT} and ${where} order by l.entry_no`, params as never[]);
  return rows.map(toAward);
}

async function contributionFact(tx: Tx, contributionId: string): Promise<ContributionFact | undefined> {
  const [c] = await tx<
    {
      id: string;
      account_id: string;
      category: RewardCategory;
      state: ContributionFact["state"];
      independence: ReviewIndependence;
      attempt_id: string | null;
      abu_id: string | null;
      review_id: string | null;
      document_id: string | null;
      idempotency_key: string;
    }[]
  >`select id, account_id, category, state, independence, attempt_id, abu_id, review_id, document_id, idempotency_key
      from wos.contributions where id = ${contributionId}`;
  if (!c) return undefined;
  const fact: ContributionFact = { id: c.id, accountId: c.account_id, category: c.category, state: c.state, independence: c.independence };
  switch (c.category) {
    case "implementation": {
      const [a] = await tx<{ abu_id: string; key: string; size_points: number; state: string }[]>`
        select at.abu_id, ab.key, ab.size_points, at.state from wos.attempts at join wos.abus ab on ab.id = at.abu_id where at.id = ${c.attempt_id}`;
      if (a)
        fact.implementation = {
          attemptId: c.attempt_id!,
          abuId: a.abu_id,
          abuKey: a.key,
          sizePoints: a.size_points,
          merged: a.state === "merged",
        };
      break;
    }
    case "review": {
      const [r] = await tx<
        {
          subject_kind: "roadmap" | "feature_contract" | "implementation";
          size_points: number | null;
          accepted: boolean;
          on_time: boolean;
        }[]
      >`
        select rd.subject_kind,
               (select ab.size_points from wos.attempts at join wos.abus ab on ab.id = at.abu_id where at.id = rd.attempt_id) as size_points,
               coalesce((select at.state = 'merged' from wos.attempts at where at.id = rd.attempt_id),
                        (select d.state = 'merged' from wos.documents d where d.id = rd.document_id), false) as accepted,
               v.sealed_at <= l.expires_at as on_time
          from wos.reviews v join wos.rounds rd on rd.id = v.round_id join wos.leases l on l.id = v.lease_id
         where v.id = ${c.review_id}`;
      if (r) {
        fact.review = {
          reviewId: c.review_id!,
          subjectKind: r.subject_kind,
          sizePoints: r.subject_kind === "implementation" ? r.size_points : null,
          subjectAccepted: r.accepted,
          schemaValid: true, // a sealed reviews row exists only for a verdict that parsed against ReviewVerdict
          onTime: r.on_time,
          invalidated: false,
        };
      }
      break;
    }
    case "review_finding": {
      const findingId = c.idempotency_key.split(":")[1] ?? "";
      const [f] = await tx<{ id: string; review_id: string; severity: string; state: "open"; updated_at: Date }[]>`
        select id, review_id, severity, state, updated_at from wos.findings where id::text = ${findingId}`;
      if (f) {
        const settled = await tx<{ id: string }[]>`
          select id from wos.findings where review_id = ${f.review_id} and severity = 'material' and state in ('resolved', 'upheld')
           order by updated_at, id`;
        fact.finding = {
          findingId: f.id,
          reviewId: f.review_id,
          material: f.severity === "material",
          state: f.state,
          paidRank: settled.findIndex((s) => s.id === f.id),
        };
      }
      break;
    }
    case "architecture_resolution": {
      const rulingId = c.idempotency_key.split(":")[1] ?? "";
      const [r] = await tx<{ state: string }[]>`select state from wos.rulings where id::text = ${rulingId}`;
      if (r) fact.resolution = { rulingId, confirmedByMaintainer: r.state === "confirmed" };
      break;
    }
    case "security": {
      // Key format written by the award_security action: security:<severity>:<reference hash>:<account>.
      const [, severity, ref] = c.idempotency_key.split(":");
      if (severity === "low" || severity === "medium" || severity === "high" || severity === "critical") {
        fact.security = { severity, reference: ref ?? "" };
      }
      break;
    }
  }
  return fact;
}

/** Creates (once) a reward_pools row and returns its id. */
async function ensurePool(
  tx: Tx,
  deps: Deps,
  input: { kind: "feature_completion" | "application_completion"; targetId: string; appFeatureId: string | null; amount: number },
): Promise<{ id: string; state: string }> {
  const existing =
    input.kind === "feature_completion"
      ? await tx<
          { id: string; state: string }[]
        >`select id, state from wos.reward_pools where kind = 'feature_completion' and app_feature_id = ${input.appFeatureId}`
      : await tx<
          { id: string; state: string }[]
        >`select id, state from wos.reward_pools where kind = 'application_completion' and target_id = ${input.targetId}`;
  if (existing[0]) return existing[0];
  const id = uuidv7();
  await tx`insert into wos.reward_pools (id, kind, target_id, app_feature_id, amount, schedule_version, state)
           values (${id}, ${input.kind}, ${input.targetId}, ${input.appFeatureId}, ${input.amount}, ${deps.schedule.scheduleVersion}, 'open')`;
  return { id, state: "open" };
}

/**
 * Loads the facts for one event (the normative loader mapping of B-0001-rewards). Returns the facts and,
 * when a pool was created for this event, its id (marked distributed after the drafts are written).
 */
export async function loadRewardFacts(tx: Tx, deps: Deps, event: DomainEvent): Promise<{ facts: RewardFacts; poolId: string | null }> {
  const [clock] = await tx<{ now: Date }[]>`select now() as now`;
  const facts: RewardFacts = { now: clock!.now.toISOString(), bootstrapSelfReviewed: false };
  let poolId: string | null = null;
  switch (event.type) {
    case "contribution.accepted": {
      facts.contribution = await contributionFact(tx, event.payload.contributionId);
      facts.bootstrapSelfReviewed = facts.contribution?.independence === "bootstrap_self";
      break;
    }
    case "contribution.reversed": {
      facts.contribution = await contributionFact(tx, event.payload.contributionId);
      facts.awards = await loadAwards(tx, "l.contribution_id = $1", [event.payload.contributionId]);
      break;
    }
    case "document.merged": {
      const authors = await tx<{ id: string; account_id: string; weight: number }[]>`
        select id, account_id, weight from wos.contributions
         where document_id = ${event.payload.documentId} and state = 'accepted'
           and category in ('roadmap_work', 'feature_contract_work') order by id`;
      facts.documentPool = {
        documentId: event.payload.documentId,
        kind: event.payload.kind,
        authors: authors.map((a) => ({ contributionId: a.id, accountId: a.account_id, acceptedRevisions: a.weight })),
      };
      break;
    }
    case "app_feature.state_changed": {
      if (event.payload.to !== "built") break;
      const [af] = await tx<{ id: string; target_id: string }[]>`
        select af.id, af.target_id from wos.app_features af join wos.targets t on t.id = af.target_id
          join wos.catalog_features f on f.id = af.catalog_feature_id where t.slug = ${event.payload.target} and f.key = ${event.payload.feature}`;
      if (!af) break;
      // Implementation awards on the ABUs relevant to THIS app's profile (a shared ABU counts in each app's pool, D10).
      const rows = await tx.unsafe<(AwardRow & { abu_id: string })[]>(
        `${AWARD_SELECT.replace("c.independence", "c.independence, c.abu_id")}
           and l.category = 'implementation' and c.abu_id in (
             select distinct ar.abu_id from wos.abu_requirements ar join wos.requirement_profiles rp on rp.requirement_id = ar.requirement_id
               join wos.abus ab on ab.id = ar.abu_id join wos.app_features x on x.catalog_feature_id = ab.catalog_feature_id
              where rp.target_id = $1 and x.id = $2)
         order by l.entry_no`,
        [af.target_id, af.id],
      );
      const implementationAwards = rows.map((r) => ({ ...toAward(r), abuId: r.abu_id }));
      const pool = await ensurePool(tx, deps, {
        kind: "feature_completion",
        targetId: af.target_id,
        appFeatureId: af.id,
        amount: featureCompletionPoolTotal(implementationAwards, deps.schedule),
      });
      if (pool.state !== "open") break;
      poolId = pool.id;
      facts.featurePool = {
        poolId: pool.id,
        target: event.payload.target,
        feature: event.payload.feature,
        appFeatureId: af.id,
        implementationAwards,
      };
      break;
    }
    case "progress.recomputed": {
      if (event.payload.builtBp !== 10_000) break;
      const [t] = await tx<{ id: string }[]>`select id from wos.targets where slug = ${event.payload.target}`;
      if (!t) break;
      const earned = await tx<{ account_id: string; tokens: string }[]>`
        select l.account_id, sum(l.amount)::bigint as tokens from wos.ledger_entries l
          left join wos.contributions c on c.id = l.contribution_id
         where l.kind in ('award', 'void', 'clawback') and l.category is distinct from 'application_completion_pool'
           and (c.target_id = ${t.id}
                or c.catalog_feature_id in (select catalog_feature_id from wos.app_features where target_id = ${t.id})
                or c.document_id in (select id from wos.documents where target_id = ${t.id}))
         group by l.account_id order by l.account_id`;
      const pool = await ensurePool(tx, deps, {
        kind: "application_completion",
        targetId: t.id,
        appFeatureId: null,
        amount: deps.schedule.pools.applicationCompletionPool,
      });
      if (pool.state !== "open") break;
      poolId = pool.id;
      facts.applicationPool = {
        poolId: pool.id,
        target: event.payload.target,
        earnedByAccount: earned.map((e) => ({ accountId: e.account_id, tokens: Number(e.tokens) })),
      };
      break;
    }
    default:
      break;
  }
  return { facts, poolId };
}

/** Runs the rules for one event and persists the drafts (idempotent by key). */
export async function applyRewards(tx: Tx, deps: Deps, event: DomainEvent): Promise<number> {
  const { facts, poolId } = await loadRewardFacts(tx, deps, event);
  const drafts = deps.logic.computeLedgerDrafts(event, facts, deps.schedule);
  let written = 0;
  for (const d of drafts) if (await insertLedgerEntry(tx, d, { kind: "system", accountId: null })) written++;
  if (poolId) await tx`update wos.reward_pools set state = 'distributed', distributed_at = now() where id = ${poolId} and state = 'open'`;
  return written;
}

/** The sweeper's release step: awards past their hold, then computeReleaseDrafts (REWARD-PROTOCOL.md section 8). */
export async function releaseDueAwards(tx: Tx, deps: Deps): Promise<number> {
  const [clock] = await tx<{ now: Date }[]>`select now() as now`;
  const due = await loadAwards(
    tx,
    "l.release_after <= now() and not exists (select 1 from wos.ledger_entries x where x.related_entry_id = l.id and x.kind in ('release', 'void', 'clawback'))",
    [],
  );
  const drafts = deps.logic.computeReleaseDrafts(due, clock!.now.toISOString());
  let pairs = 0;
  for (const d of drafts) if ((await insertLedgerEntry(tx, d, { kind: "system", accountId: null })) && d.bucket === "available") pairs++;
  return pairs;
}

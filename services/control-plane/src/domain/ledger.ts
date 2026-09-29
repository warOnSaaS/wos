/**
 * Persistence of the WOS token ledger and contributions (REWARD-PROTOCOL.md). The amounts come from the
 * rewards workstream's pure `computeLedgerDrafts`; this module only writes what it is given, idempotently.
 */
import { ContributionMachine, type LedgerEntryDraft, type ReviewIndependence, type RewardCategory } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import { insertEvent } from "../db/events.js";
import { transition } from "../db/transition.js";
import { uuidv7 } from "../util/crypto.js";

/** Inserts one ledger entry unless its idempotency key exists (replays write nothing). Returns the new entry id or null. */
export async function insertLedgerEntry(
  tx: Tx,
  draft: LedgerEntryDraft,
  createdBy: { kind: "system" | "maintainer"; accountId: string | null },
): Promise<string | null> {
  const id = uuidv7();
  const rows = await tx<{ id: string; entry_no: string }[]>`
    insert into wos.ledger_entries (id, account_id, kind, bucket, amount, category, contribution_id, pool_id, related_entry_id, pair_id,
                                    idempotency_key, schedule_version, memo, release_after, created_by_kind, created_by_account)
    values (${id}, ${draft.accountId}, ${draft.kind}, ${draft.bucket}, ${draft.amount}, ${draft.category}, ${draft.contributionId}, ${draft.poolId},
            ${draft.relatedEntryId}, ${draft.pairId}, ${draft.idempotencyKey}, ${draft.scheduleVersion}, ${draft.memo}, ${draft.releaseAfter},
            ${createdBy.kind}, ${createdBy.accountId})
    on conflict (idempotency_key) do nothing
    returning id, entry_no`;
  const row = rows[0];
  if (!row) return null;
  await insertEvent(
    tx,
    {
      type: "ledger.entry_written",
      v: 1,
      visibility: "public",
      payload: { entryNo: Number(row.entry_no), accountId: draft.accountId, amount: draft.amount, kind: draft.kind },
    },
    { aggregateKind: "ledger_entry", aggregateId: row.id, actor: createdBy.kind, actorAccountId: createdBy.accountId },
  );
  return row.id;
}

export interface NewContribution {
  accountId: string;
  githubUserId: number | string;
  category: RewardCategory;
  targetId?: string | null;
  catalogFeatureId?: string | null;
  abuId?: string | null;
  attemptId?: string | null;
  documentId?: string | null;
  reviewId?: string | null;
  pullRequestId?: string | null;
  independence: ReviewIndependence;
  weight?: number;
  idempotencyKey: string;
}

/** Creates a pending contribution once (unique idempotency key). */
export async function createContribution(tx: Tx, c: NewContribution): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    insert into wos.contributions (id, account_id, github_user_id, category, state, target_id, catalog_feature_id, abu_id, attempt_id, document_id,
                                   review_id, pull_request_id, independence, weight, idempotency_key)
    values (${uuidv7()}, ${c.accountId}, ${c.githubUserId}, ${c.category}, 'pending', ${c.targetId ?? null}, ${c.catalogFeatureId ?? null},
            ${c.abuId ?? null}, ${c.attemptId ?? null}, ${c.documentId ?? null}, ${c.reviewId ?? null}, ${c.pullRequestId ?? null}, ${c.independence},
            ${c.weight ?? 1}, ${c.idempotencyKey})
    on conflict (idempotency_key) do nothing returning id`;
  return rows[0]?.id ?? null;
}

export async function contributionTransition(
  tx: Tx,
  c: { id: string; state: "pending" | "accepted" | "rejected" | "reversed"; account_id: string; category: RewardCategory },
  event: "accept" | "reject" | "reverse",
  actor: "system" | "github" | "maintainer",
  actorAccountId: string | null,
  reason: string,
): Promise<void> {
  const t = ContributionMachine.transitions.find((x) => x.from === c.state && x.event === event);
  if (!t) return;
  await transition(tx, {
    machine: ContributionMachine,
    table: "contributions",
    id: c.id,
    from: c.state,
    event,
    actor,
    actorAccountId,
    set: event === "accept" ? { accepted_at: new Date() } : { ended_reason: reason },
    aggregateKind: "contribution",
    emit:
      event === "accept"
        ? {
            type: "contribution.accepted",
            v: 1,
            visibility: "public",
            payload: { contributionId: c.id, accountId: c.account_id, category: c.category },
          }
        : event === "reverse"
          ? { type: "contribution.reversed", v: 1, visibility: "public", payload: { contributionId: c.id, reason } }
          : {
              type: "contribution.state_changed",
              v: 1,
              visibility: "public",
              payload: { contributionId: c.id, from: c.state, to: t.to, reason },
            },
  });
}

/** Accepts (or rejects) every pending contribution matching the subject. */
export async function settleContributions(
  tx: Tx,
  where: { attemptId?: string; documentId?: string },
  event: "accept" | "reject",
  actor: "system" | "github",
  reason: string,
): Promise<void> {
  const rows = where.attemptId
    ? await tx<{ id: string; state: "pending"; account_id: string; category: RewardCategory }[]>`
        select c.id, c.state, c.account_id, c.category from wos.contributions c left join wos.reviews v on v.id = c.review_id
          left join wos.rounds r on r.id = v.round_id
         where c.state = 'pending' and (c.attempt_id = ${where.attemptId} or r.attempt_id = ${where.attemptId}) order by c.id`
    : await tx<{ id: string; state: "pending"; account_id: string; category: RewardCategory }[]>`
        select c.id, c.state, c.account_id, c.category from wos.contributions c left join wos.reviews v on v.id = c.review_id
          left join wos.rounds r on r.id = v.round_id
         where c.state = 'pending' and (c.document_id = ${where.documentId!} or r.document_id = ${where.documentId!}) order by c.id`;
  for (const c of rows) await contributionTransition(tx, c, event, actor, null, reason);
}

/** Accepts or rejects the pending contribution whose idempotency key starts with `<prefix>:` (findings, rulings). */
export async function settleKeyedContribution(
  tx: Tx,
  prefix: string,
  event: "accept" | "reject",
  actor: "system" | "github" | "maintainer",
  actorAccountId: string | null,
  reason: string,
): Promise<void> {
  const rows = await tx<{ id: string; state: "pending"; account_id: string; category: RewardCategory }[]>`
    select id, state, account_id, category from wos.contributions where state = 'pending' and idempotency_key like ${`${prefix}:%`} order by id`;
  // ContributionMachine: accept is a system/github step (the acceptance condition holds); a maintainer may reject.
  const by = event === "accept" ? "system" : actor === "maintainer" ? "maintainer" : "system";
  for (const c of rows) await contributionTransition(tx, c, event, by, actorAccountId, reason);
}

/** Authors of accepted revisions of a merged document: one work contribution each, weight = accepted revisions. */
export async function createDocumentWorkContributions(tx: Tx, documentId: string, kind: "roadmap" | "feature_contract"): Promise<void> {
  const authors = await tx<{ account_id: string; github_user_id: string; n: number }[]>`
    select c.account_id, a.github_user_id, count(*)::int as n
      from wos.changesets c join wos.tasks t on t.id = c.task_id join wos.accounts a on a.id = c.account_id
     where t.document_id = ${documentId} and c.ok and a.github_user_id is not null
     group by c.account_id, a.github_user_id order by c.account_id`;
  const category = kind === "roadmap" ? "roadmap_work" : "feature_contract_work";
  for (const a of authors) {
    await createContribution(tx, {
      accountId: a.account_id,
      githubUserId: a.github_user_id,
      category,
      documentId,
      independence: "independent",
      weight: a.n,
      idempotencyKey: `${category}:${documentId}:${a.account_id}`,
    });
  }
}

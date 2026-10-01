/**
 * P1 shadow accounting, first slice: the shadow receipt read model (contracts 5.20.0, packages/contracts/src/shadow.ts).
 * Built ONLY from tables the control plane already stores in production (never the devnet protocol tables 0007/0010;
 * nothing is ever written). Served as the anonymous actor, so RLS hides sealed reviews and every private row (leases,
 * devices, emails): a round that is not revealed lists with its state and no verdicts.
 *
 * Read tolerance, exactly like the D53/D69 handlers: the rounds columns added by migrations 0013/0015 are read through
 * to_jsonb, and wos.round_human_reviews (0013) is gated on to_regclass, so this serves a database without them.
 */
import {
  AgentRunRecord,
  type ShadowReceipt,
  type ShadowReceiptKind,
  type ShadowReceiptRound,
  type ShadowReceiptRun,
  type ShadowReceiptSummary,
  shadowBudget,
  shadowReceiptSha256,
} from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import { iso, isoReq } from "../views.js";

/** Newest first, like every public feed. The cursor is "<updatedAt ISO>|<id>", opaque to clients. */
export const RECEIPTS_PAGE = 50;

export interface ReceiptCursor {
  at: string;
  id: string;
}

export function parseReceiptCursor(c: string | undefined): ReceiptCursor | null {
  if (!c) return null;
  const i = c.indexOf("|");
  if (i <= 0) return null;
  const at = c.slice(0, i);
  const id = c.slice(i + 1);
  return Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id) ? null : { at, id };
}

const keysetAfter = (tx: Tx, alias: string, before: ReceiptCursor | null) =>
  before
    ? tx`and (${tx(alias)}.updated_at < ${before.at}::timestamptz or (${tx(alias)}.updated_at = ${before.at}::timestamptz and ${tx(alias)}.id < ${before.id}))`
    : tx``;

// ---------------------------------------------------------------------------------------------- receipt subjects

/** A receipt subject: one submitted attempt (ABU build/revision) or one reviewed document version (author work). */
interface Subject {
  id: string;
  kind: ShadowReceiptKind;
  handle: string | null;
  target: string | null;
  feature: string | null;
  abu: string | null;
  abuTitle: string | null;
  abuId: string | null;
  sizePoints: number;
  documentKind: "roadmap" | "feature_contract" | null;
  documentVersion: number | null;
  state: string;
  merged: boolean;
  pr: { number: number; url: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AttemptRow {
  id: string;
  state: string;
  merged: boolean;
  abu_id: string;
  abu_key: string;
  abu_title: string;
  size_points: number;
  handle: string | null;
  target_slug: string | null;
  feature_key: string | null;
  task_kind: ShadowReceiptKind;
  pr_number: number | null;
  pr_url: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Attempts that submitted a changeset: the join loadAttempt's built_with uses (task attempt or build task of the ABU). */
export async function attemptSubjects(tx: Tx, before: ReceiptCursor | null, limit: number): Promise<Subject[]> {
  const rows = await tx<AttemptRow[]>`
    select a.id, a.state, a.merged_sha is not null as merged, a.abu_id, ab.key as abu_key, ab.title as abu_title,
           ab.size_points, ac.handle, a.created_at, a.updated_at, tgt.slug as target_slug, cf.key as feature_key,
           coalesce((select tk.kind from wos.tasks tk where tk.attempt_id = a.id and tk.kind in ('abu_build', 'abu_revision')
                      order by tk.created_at limit 1),
                    (select tk.kind from wos.tasks tk where tk.kind = 'abu_build' and tk.abu_id = a.abu_id
                      order by tk.created_at desc limit 1), 'abu_build') as task_kind,
           pr.number as pr_number, pr.url as pr_url
      from wos.attempts a
      join wos.abus ab on ab.id = a.abu_id
      join wos.accounts ac on ac.id = a.account_id
      left join wos.catalog_features cf on cf.id = ab.catalog_feature_id
      left join lateral (select rt.slug from wos.abu_requirements ar
                           join wos.requirement_profiles rp on rp.requirement_id = ar.requirement_id
                           join wos.targets rt on rt.id = rp.target_id
                          where ar.abu_id = a.abu_id order by rt.slug limit 1) tgt on true
      left join lateral (select p.number, p.url from wos.pull_requests p where p.attempt_id = a.id
                          order by p.opened_at desc limit 1) pr on true
     where exists (select 1 from wos.changesets c join wos.tasks tk on tk.id = c.task_id
                    where c.account_id = a.account_id
                      and (tk.attempt_id = a.id or (tk.kind in ('abu_build', 'abu_revision') and tk.abu_id = a.abu_id)))
       ${keysetAfter(tx, "a", before)}
     order by a.updated_at desc, a.id desc limit ${limit}`;
  return rows.map(attemptToSubject);
}

interface DocumentRow {
  id: string;
  doc_kind: "roadmap" | "feature_contract";
  version: number;
  state: string;
  merged: boolean;
  handle: string | null;
  target_slug: string | null;
  feature_key: string | null;
  task_kind: ShadowReceiptKind;
  pr_number: number | null;
  pr_url: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Document versions that reached review (round_number >= 1): roadmap and feature-contract author work. */
export async function documentSubjects(tx: Tx, before: ReceiptCursor | null, limit: number): Promise<Subject[]> {
  const rows = await tx<DocumentRow[]>`
    select d.id, d.kind as doc_kind, d.version, d.state, d.merged_sha is not null as merged,
           t.slug as target_slug, cf.key as feature_key, d.pr_number, d.created_at, d.updated_at,
           (select p.url from wos.pull_requests p where p.document_id = d.id order by p.opened_at desc limit 1) as pr_url,
           coalesce((select tk.kind from wos.tasks tk where tk.document_id = d.id and tk.kind in ('roadmap_author', 'feature_author')
                      order by tk.created_at desc limit 1), 'roadmap_author') as task_kind,
           auth.handle
      from wos.documents d
      left join wos.targets t on t.id = d.target_id
      left join wos.catalog_features cf on cf.id = d.catalog_feature_id
      left join lateral (select ac.handle from wos.context_manifests m join wos.tasks tk on tk.id = m.task_id
                          join wos.accounts ac on ac.id = m.account_id
                          where tk.document_id = d.id and tk.kind in ('roadmap_author', 'feature_author')
                          order by m.created_at desc limit 1) auth on true
     where d.round_number >= 1
       ${keysetAfter(tx, "d", before)}
     order by d.updated_at desc, d.id desc limit ${limit}`;
  return rows.map(documentToSubject);
}

export async function subjectById(tx: Tx, id: string): Promise<Subject | null> {
  // The id is an attempt id or a document id (distinct uuid spaces); a scan of the two subject tables.
  const [a] = await tx<AttemptRow[]>`
    select a.id, a.state, a.merged_sha is not null as merged, a.abu_id, ab.key as abu_key, ab.title as abu_title,
           ab.size_points, ac.handle, tgt.slug as target_slug, cf.key as feature_key,
           coalesce((select tk.kind from wos.tasks tk where tk.attempt_id = a.id and tk.kind in ('abu_build', 'abu_revision')
                      order by tk.created_at limit 1),
                    (select tk.kind from wos.tasks tk where tk.kind = 'abu_build' and tk.abu_id = a.abu_id
                      order by tk.created_at desc limit 1), 'abu_build') as task_kind,
           pr.number as pr_number, pr.url as pr_url, a.created_at, a.updated_at
      from wos.attempts a
      join wos.abus ab on ab.id = a.abu_id
      join wos.accounts ac on ac.id = a.account_id
      left join wos.catalog_features cf on cf.id = ab.catalog_feature_id
      left join lateral (select rt.slug from wos.abu_requirements ar
                           join wos.requirement_profiles rp on rp.requirement_id = ar.requirement_id
                           join wos.targets rt on rt.id = rp.target_id
                          where ar.abu_id = a.abu_id order by rt.slug limit 1) tgt on true
      left join lateral (select p.number, p.url from wos.pull_requests p where p.attempt_id = a.id
                          order by p.opened_at desc limit 1) pr on true
     where a.id = ${id}`;
  if (a) return attemptToSubject(a);
  const [d] = await tx<DocumentRow[]>`
    select d.id, d.kind as doc_kind, d.version, d.state, d.merged_sha is not null as merged,
           t.slug as target_slug, cf.key as feature_key, d.pr_number, d.created_at, d.updated_at,
           (select p.url from wos.pull_requests p where p.document_id = d.id order by p.opened_at desc limit 1) as pr_url,
           coalesce((select tk.kind from wos.tasks tk where tk.document_id = d.id and tk.kind in ('roadmap_author', 'feature_author')
                      order by tk.created_at desc limit 1), 'roadmap_author') as task_kind,
           auth.handle, d.created_at, d.updated_at
      from wos.documents d
      left join wos.targets t on t.id = d.target_id
      left join wos.catalog_features cf on cf.id = d.catalog_feature_id
      left join lateral (select ac.handle from wos.context_manifests m join wos.tasks tk on tk.id = m.task_id
                          join wos.accounts ac on ac.id = m.account_id
                          where tk.document_id = d.id and tk.kind in ('roadmap_author', 'feature_author')
                          order by m.created_at desc limit 1) auth on true
     where d.id = ${id} and d.round_number >= 1`;
  return d ? documentToSubject(d) : null;
}

const attemptToSubject = (r: AttemptRow): Subject => ({
  id: r.id,
  kind: r.task_kind,
  handle: r.handle,
  target: r.target_slug,
  feature: r.feature_key,
  abu: r.abu_key,
  abuTitle: r.abu_title,
  abuId: r.abu_id,
  sizePoints: r.size_points,
  documentKind: null,
  documentVersion: null,
  state: r.state,
  merged: r.merged,
  pr: r.pr_number !== null && r.pr_url ? { number: r.pr_number, url: r.pr_url } : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const documentToSubject = (r: DocumentRow): Subject => ({
  id: r.id,
  kind: r.task_kind,
  handle: r.handle,
  target: r.target_slug,
  feature: r.feature_key,
  abu: null,
  abuTitle: null,
  abuId: null,
  sizePoints: 0,
  documentKind: r.doc_kind,
  documentVersion: r.version,
  state: r.state,
  merged: r.merged,
  pr: r.pr_number !== null && r.pr_url ? { number: r.pr_number, url: r.pr_url } : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---------------------------------------------------------------------------------------------- receipt detail

/** The subject's agent runs. Attempt runs are windowed to the attempt's own lifetime (runs of other attempts of the
 *  same ABU belong to those attempts' receipts). */
async function subjectRuns(tx: Tx, s: Subject): Promise<ShadowReceiptRun[]> {
  const rows = await tx<
    {
      id: string;
      created_at: Date;
      record: unknown;
      model_id: string;
      manifest_reasoning: string;
      manifest_provider: string;
      manifest_sha256: string;
    }[]
  >`
    select ar.id, ar.created_at, ar.record, m.model_id, m.reasoning as manifest_reasoning,
           m.manifest->>'provider' as manifest_provider, m.manifest_sha256
      from wos.agent_runs ar
      join wos.context_manifests m on m.id = ar.manifest_id
      join wos.tasks tk on tk.id = m.task_id
     where ${
       s.abuId
         ? tx`(tk.attempt_id = ${s.id} or tk.abu_id = ${s.abuId}) and tk.kind in ('abu_build', 'abu_revision')
                and ar.created_at >= ${isoReq(s.createdAt)}::timestamptz and ar.created_at <= ${isoReq(s.updatedAt)}::timestamptz`
         : tx`tk.document_id = ${s.id} and tk.kind in ('roadmap_author', 'feature_author')`
     }
     order by ar.created_at`;
  return rows.map((r) => runView(r));
}

function runView(r: {
  id: string;
  created_at: Date;
  record: unknown;
  model_id: string;
  manifest_reasoning: string;
  manifest_provider: string;
  manifest_sha256: string;
}): ShadowReceiptRun {
  const parsed = AgentRunRecord.safeParse(r.record);
  const rec: Record<string, unknown> = parsed.success
    ? (parsed.data as unknown as Record<string, unknown>)
    : ((r.record as Record<string, unknown>) ?? {});
  const str = (k: string): string | null => {
    const v = rec[k];
    return typeof v === "string" ? v : null;
  };
  const int = (k: string): number | null => {
    const v = rec[k];
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
  };
  const startedAt = str("startedAt") ?? isoReq(r.created_at);
  const endedAt = str("endedAt") ?? isoReq(r.created_at);
  const usage = (rec.usage ?? {}) as Record<string, unknown>;
  const usageDetail = (rec.usageDetail ?? {}) as Record<string, unknown>;
  const token = (k: string, from: Record<string, unknown>): number | null => {
    const v = from[k];
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
  };
  const cost = usageDetail.costUsd;
  const steps = usageDetail.steps;
  const launch = (rec.launch ?? null) as Record<string, unknown> | null;
  return {
    id: r.id,
    provider: str("provider") ?? r.manifest_provider,
    launchProvider: launch && typeof launch.provider === "string" ? launch.provider : null,
    modelIdRequested: str("modelIdRequested") ?? r.model_id,
    modelIdReported: str("modelIdReported"),
    reasoning: (str("reasoningRequested") ?? r.manifest_reasoning) as ShadowReceiptRun["reasoning"],
    inputTokens: token("inputTokens", usageDetail) ?? token("inputTokens", usage),
    outputTokens: token("outputTokens", usageDetail) ?? token("outputTokens", usage),
    costUsd: typeof cost === "number" && cost >= 0 ? cost : null,
    steps: typeof steps === "number" && Number.isInteger(steps) && steps >= 0 ? steps : null,
    startedAt,
    endedAt,
    durationSeconds: Math.max(0, (Date.parse(endedAt) - Date.parse(startedAt)) / 1000),
    exitCode: int("exitCode"),
    mode: str("mode") === "shadow" ? "shadow" : null,
    manifestSha256: (str("manifestSha256") ?? r.manifest_sha256) as ShadowReceiptRun["manifestSha256"],
    transcriptSha256: str("transcriptSha256"),
    outputSha256: str("outputSha256"),
  };
}

interface RoundRow {
  id: string;
  round_number: number;
  state: "awaiting_reviews" | "revealed" | "cancelled";
  outcome: "consensus" | "gaps" | null;
  independence: "independent" | "bootstrap_maintainer" | "bootstrap_self" | null;
  head_sha: string;
  submission_sha256: string;
  opened_at: Date;
  revealed_at: Date | null;
  j: Record<string, unknown>;
}

async function subjectRounds(tx: Tx, s: Subject): Promise<ShadowReceiptRound[]> {
  const rounds = await tx<RoundRow[]>`
    select r.id, r.round_number, r.state, r.outcome, r.independence, r.head_sha, r.submission_sha256, r.opened_at,
           r.revealed_at, to_jsonb(r) as j
      from wos.rounds r
     where ${s.abuId ? tx`r.attempt_id = ${s.id}` : tx`r.document_id = ${s.id}`}
     order by r.round_number`;
  if (rounds.length === 0) return [];
  const ids = rounds.map((r) => r.id);
  // Agent-seat verdicts. RLS hides every review of a round that is not revealed yet (0001, sealed_until_revealed).
  const reviews = await tx<
    {
      round_id: string;
      slot: "astra" | "fable";
      handle: string | null;
      provider: string;
      model_id: string;
      reasoning: string;
      verdict: "NO_MATERIAL_GAPS" | "MATERIAL_GAPS";
      independence: "independent" | "bootstrap_maintainer" | "bootstrap_self";
      sealed_at: Date;
    }[]
  >`
    select v.round_id, v.slot, ac.handle, v.provider, v.model_id, v.reasoning, v.verdict, v.independence, v.sealed_at
      from wos.reviews v join wos.accounts ac on ac.id = v.account_id
     where v.round_id in ${tx(ids)} order by v.round_id, v.slot`;
  // The D53 human seat (0013): absent until migration 0013 runs, so gate on to_regclass; RLS hides it until revealed.
  const [hasHuman] = await tx<{ ok: boolean }[]>`select to_regclass('wos.round_human_reviews') is not null as ok`;
  const human = hasHuman?.ok
    ? await tx<
        {
          round_id: string;
          handle: string | null;
          verdict: "NO_MATERIAL_GAPS" | "MATERIAL_GAPS";
          bootstrap_self: boolean;
          sealed_at: Date;
        }[]
      >`
        select hr.round_id, ac.handle, hr.verdict, hr.bootstrap_self, hr.sealed_at
          from wos.round_human_reviews hr join wos.accounts ac on ac.id = hr.account_id
         where hr.round_id in ${tx(ids)} order by hr.sealed_at`
    : [];
  return rounds.map((r) => {
    const label = (k: string): string | null => {
      const v = r.j[k];
      return typeof v === "string" ? v : null;
    };
    const secondSeat = label("second_seat");
    return {
      id: r.id,
      number: r.round_number,
      state: r.state,
      outcome: r.outcome,
      independence: r.independence,
      reviewLabel: label("review_label"),
      trialLabel: label("trial_label"),
      secondSeat: secondSeat === "fable" || secondSeat === "human" ? secondSeat : null,
      headSha: r.head_sha,
      submissionSha256: r.submission_sha256,
      openedAt: isoReq(r.opened_at),
      revealedAt: iso(r.revealed_at),
      reviews: [
        ...reviews
          .filter((v) => v.round_id === r.id)
          .map((v) => ({
            slot: v.slot,
            handle: v.handle,
            provider: v.provider,
            modelId: v.model_id,
            reasoning: v.reasoning as ShadowReceiptRound["reviews"][number]["reasoning"],
            verdict: v.verdict,
            independence: v.independence,
            reviewLabel: null,
            bootstrapSelf: v.independence === "bootstrap_self",
            sealedAt: isoReq(v.sealed_at),
          })),
        ...human
          .filter((hr) => hr.round_id === r.id)
          .map((hr) => ({
            slot: "human" as const,
            handle: hr.handle,
            provider: null,
            modelId: null,
            reasoning: null,
            verdict: hr.verdict,
            independence: (hr.bootstrap_self ? "bootstrap_self" : "independent") as "bootstrap_self" | "independent",
            reviewLabel: "single_lab_review",
            bootstrapSelf: hr.bootstrap_self,
            sealedAt: isoReq(hr.sealed_at),
          })),
      ],
    };
  });
}

/** The contribution row (outcome as accepted/rejected), if the pipeline has written one yet. */
async function subjectContribution(tx: Tx, s: Subject): Promise<"pending" | "accepted" | "rejected" | "reversed" | null> {
  const [c] = await tx<{ state: "pending" | "accepted" | "rejected" | "reversed" }[]>`
    select c.state from wos.contributions c
     where ${
       s.abuId
         ? tx`c.abu_id = ${s.abuId} and c.category = 'implementation'`
         : tx`c.document_id = ${s.id} and c.category in ('roadmap_work', 'feature_contract_work')`
     }
     order by c.created_at desc limit 1`;
  return c?.state ?? null;
}

/** The full shadow receipt of one subject: evidence, verdicts, outcome, shadow budget, receipt hash. */
export async function buildReceipt(tx: Tx, s: Subject): Promise<ShadowReceipt> {
  const [runs, rounds, contribution] = await Promise.all([subjectRuns(tx, s), subjectRounds(tx, s), subjectContribution(tx, s)]);
  const lastRun = runs.at(-1) ?? null;
  const tokens = (k: "inputTokens" | "outputTokens") =>
    runs.reduce<number | null>((acc, r) => (r[k] === null ? acc : (acc ?? 0) + (r[k] as number)), null);
  const costUsd = runs.reduce<number | null>((acc, r) => (r.costUsd === null ? acc : (acc ?? 0) + r.costUsd), null);
  const receipt: Omit<ShadowReceipt, "receiptSha256"> = {
    id: s.id,
    kind: s.kind,
    handle: s.handle,
    target: s.target,
    feature: s.feature,
    abu: s.abu,
    abuTitle: s.abuTitle,
    documentKind: s.documentKind,
    documentVersion: s.documentVersion,
    provider: lastRun?.provider ?? null,
    modelId: lastRun?.modelIdReported ?? lastRun?.modelIdRequested ?? null,
    reasoning: lastRun?.reasoning ?? null,
    inputTokens: tokens("inputTokens"),
    outputTokens: tokens("outputTokens"),
    costUsd,
    runCount: runs.length,
    roundCount: rounds.length,
    reviewCount: rounds.reduce((n, r) => n + r.reviews.length, 0),
    trialLabel: rounds.at(-1)?.trialLabel ?? null,
    outcome: { state: s.state as ShadowReceipt["outcome"]["state"], merged: s.merged, pr: s.pr, contribution },
    shadowBudget: shadowBudget(s.kind, s.sizePoints),
    createdAt: isoReq(s.createdAt),
    updatedAt: isoReq(s.updatedAt),
    runs,
    rounds,
  };
  return { ...receipt, receiptSha256: shadowReceiptSha256(receipt) };
}

/** The list shape: the receipt without the evidence arrays, with their counts. */
export function receiptSummary(r: ShadowReceipt): ShadowReceiptSummary {
  const { runs: _runs, rounds: _rounds, receiptSha256: _hash, ...summary } = r;
  return summary;
}

/** The newest-first page of receipt summaries. */
export async function listReceipts(
  tx: Tx,
  before: ReceiptCursor | null,
): Promise<{ items: ShadowReceiptSummary[]; nextCursor: string | null }> {
  // PAGE+1 from each subject table, merged and sliced: anything dropped is retrievable after the returned cursor.
  const [attempts, documents] = await Promise.all([
    attemptSubjects(tx, before, RECEIPTS_PAGE + 1),
    documentSubjects(tx, before, RECEIPTS_PAGE + 1),
  ]);
  const subjects = [...attempts, ...documents].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  const page = subjects.slice(0, RECEIPTS_PAGE);
  const receipts = [];
  for (const s of page) receipts.push(receiptSummary(await buildReceipt(tx, s)));
  const last = page.at(-1) ?? null;
  return {
    items: receipts,
    nextCursor: subjects.length > RECEIPTS_PAGE && last ? `${isoReq(last.updatedAt)}|${last.id}` : null,
  };
}

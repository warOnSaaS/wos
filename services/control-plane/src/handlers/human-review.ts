/**
 * D53 human review seat (contracts 5.15.0): the queue, the subject view, the sealed human verdict and the human's own
 * ruling on escalated documents under the `fable_unavailable` fallback. Eligibility: domain/human-review.ts.
 */
import { ARTIFACT_PATHS, type HumanReviewFinding, type HumanReviewQueueItem, type ReviewVerdict } from "@waronsaas/contracts";
import { inTransaction, type Tx } from "@waronsaas/db";
import { insertEvent } from "../db/events.js";
import { loadDocument } from "../domain/documents.js";
import { HUMAN_SEAT_REASONS, humanSeatCheck } from "../domain/human-review.js";
import { revealRound, roundComplete, subjectAuthors } from "../domain/review.js";
import { ApiFailure } from "../errors.js";
import type { Caller, Handlers } from "../http/router.js";
import { uuidv7 } from "../util/crypto.js";
import { applyConfirmedRuling } from "./admin.js";
import { unruledDecisions } from "../domain/decisions.js";

const SYSTEM_TX = { kind: "system" as const, accountId: null };

interface RoundRow {
  id: string;
  subject_kind: "roadmap" | "feature_contract" | "implementation";
  document_id: string | null;
  attempt_id: string | null;
  round_number: number;
  head_sha: string;
  submission_sha256: string;
  state: string;
  second_seat: "fable" | "human";
  review_policy_seq: number | null;
  opened_at: Date;
  target: string | null;
  feature: string | null;
}

const ROUND_SELECT = `
  select r.id, r.subject_kind, r.document_id, r.attempt_id, r.round_number, r.head_sha, r.submission_sha256, r.state, r.second_seat, r.review_policy_seq,
         r.opened_at, coalesce(t.slug, null) as target, coalesce(f.key, af.key) as feature
    from wos.rounds r
    left join wos.documents d on d.id = r.document_id
    left join wos.targets t on t.id = d.target_id
    left join wos.catalog_features f on f.id = d.catalog_feature_id
    left join wos.attempts at on at.id = r.attempt_id
    left join wos.abus ab on ab.id = at.abu_id
    left join wos.catalog_features af on af.id = ab.catalog_feature_id`;

async function loadRound(tx: Tx, id: string): Promise<RoundRow | null> {
  const [r] = await tx.unsafe<RoundRow[]>(`${ROUND_SELECT} where r.id = $1`, [id]);
  return r ?? null;
}

async function queueItem(tx: Tx, r: RoundRow, accountId: string): Promise<HumanReviewQueueItem> {
  const [sealed] = await tx`select 1 as x from wos.reviews where round_id = ${r.id} and slot = 'astra'`;
  const { reasons, bootstrapSelf } = await humanSeatCheck(tx, r, accountId);
  return {
    roundId: r.id,
    roundNumber: r.round_number,
    subjectKind: r.subject_kind,
    subjectId: (r.document_id ?? r.attempt_id)!,
    target: r.target,
    feature: r.feature,
    headSha: r.head_sha,
    submissionSha256: r.submission_sha256,
    openedAt: new Date(r.opened_at).toISOString(),
    agentVerdictSealed: !!sealed,
    label: "single_lab_review",
    eligibility: { eligible: reasons.length === 0, reasons },
    bootstrapSelf,
  };
}

const humanRoundOr409 = async (tx: Tx, id: string): Promise<RoundRow> => {
  const r = await loadRound(tx, id);
  if (!r) throw new ApiFailure("NOT_FOUND", "round not found");
  if (r.second_seat !== "human") throw new ApiFailure("CONFLICT", HUMAN_SEAT_REASONS.noHumanSeat);
  return r;
};

async function priorFindings(tx: Tx, r: RoundRow): Promise<HumanReviewFinding[]> {
  const subject = r.document_id ?? r.attempt_id;
  const rows = await tx<
    {
      id: string;
      round_number: number;
      slot: "astra" | "fable" | null;
      severity: "material" | "minor";
      category: string;
      title: string;
      detail: string;
      state: HumanReviewFinding["state"];
    }[]
  >`
    select f.id, rd.round_number, v.slot, f.severity, f.category, f.title, f.detail, f.state
      from wos.findings f join wos.rounds rd on rd.id = f.round_id left join wos.reviews v on v.id = f.review_id
     where (f.document_id = ${subject} or f.attempt_id = ${subject}) and rd.state = 'revealed' and rd.round_number < ${r.round_number}
     order by rd.round_number, f.id`;
  return rows.map((f) => ({
    id: f.id,
    roundNumber: f.round_number,
    source: f.slot ?? "human",
    severity: f.severity,
    category: f.category,
    title: f.title,
    detail: f.detail,
    state: f.state,
  }));
}

export const humanReviewHandlers: Pick<Handlers, "listHumanReviews" | "getHumanReview" | "submitHumanReview" | "submitHumanRuling"> = {
  async listHumanReviews(ctx) {
    const caller = ctx.caller!;
    return inTransaction(ctx.deps.sql, SYSTEM_TX, async (tx) => {
      const rounds = await tx.unsafe<RoundRow[]>(
        `${ROUND_SELECT} where r.state = 'awaiting_reviews' and r.second_seat = 'human'
            and not exists (select 1 from wos.round_human_reviews h where h.round_id = r.id)
          order by r.opened_at, r.id limit 100`,
      );
      const items = [];
      for (const r of rounds) items.push(await queueItem(tx, r, caller.accountId));
      return { items };
    });
  },

  async getHumanReview(ctx) {
    const caller = ctx.caller!;
    return inTransaction(ctx.deps.sql, SYSTEM_TX, async (tx) => {
      const r = await humanRoundOr409(tx, ctx.params.id);
      const round = await queueItem(tx, r, caller.accountId);
      const [cs] = await tx<{ file_manifest: Array<{ path: string }>; summary: unknown }[]>`
        select c.file_manifest, c.summary from wos.candidate_commits cc join wos.changesets c on c.id = cc.changeset_id
         where cc.commit_sha = ${r.head_sha} order by c.created_at desc limit 1`;
      const [pr] = r.document_id
        ? await tx<{ repo: string; branch: string | null; number: number | null; url: string | null; title: string }[]>`
            select d.repo_full_name as repo, d.branch, d.pr_number as number, p.url,
                   case when d.kind = 'roadmap' then coalesce(t.product_name, t.slug) || ' Replacement Roadmap' else f.key || ' Feature Contract' end as title
              from wos.documents d left join wos.targets t on t.id = d.target_id left join wos.catalog_features f on f.id = d.catalog_feature_id
              left join wos.pull_requests p on p.document_id = d.id and p.number = d.pr_number
             where d.id = ${r.document_id}`
        : await tx<{ repo: string; branch: string | null; number: number | null; url: string | null; title: string }[]>`
            select ab.repo_full_name as repo, at.candidate_branch as branch, at.pr_number as number, at.pr_url as url,
                   ab.key || ': ' || (ab.spec->>'title') as title
              from wos.attempts at join wos.abus ab on ab.id = at.abu_id where at.id = ${r.attempt_id}`;
      const canonical =
        r.subject_kind === "roadmap" && r.target
          ? [ARTIFACT_PATHS.roadmap(r.target), ARTIFACT_PATHS.inventory(r.target)]
          : r.subject_kind === "feature_contract" && r.feature
            ? [ARTIFACT_PATHS.featureContract(r.feature), ARTIFACT_PATHS.buildGraph(r.feature)]
            : [];
      const files = [...new Set([...canonical, ...(cs?.file_manifest ?? []).map((f) => f.path)])].sort().map((path) => ({
        path,
        url: `https://github.com/${pr!.repo}/blob/${r.head_sha}/${path.split("/").map(encodeURIComponent).join("/")}`,
      }));
      // The sealed Astra verdict is shown to an eligible human seat only (never to the author or anyone else).
      let agentReview = null;
      if (round.eligibility.eligible) {
        const [v] = await tx<{ handle: string; model_id: string; reasoning: string; body: ReviewVerdict }[]>`
          select coalesce(a.github_login, a.handle) as handle, v.model_id, v.reasoning, v.body
            from wos.reviews v join wos.accounts a on a.id = v.account_id where v.round_id = ${r.id} and v.slot = 'astra'`;
        if (v)
          agentReview = { slot: "astra" as const, reviewerHandle: v.handle, model: v.model_id, reasoning: v.reasoning, verdict: v.body };
      }
      return {
        round,
        subject: {
          repo: pr!.repo,
          branch: pr!.branch,
          title: pr!.title,
          prNumber: pr!.number,
          prUrl: pr!.url,
          files,
          authorSummary: cs?.summary ?? null,
        },
        agentReview,
        priorFindings: await priorFindings(tx, r),
      };
    });
  },

  async submitHumanReview(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const b = ctx.body;
    return inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      // Serialise with the Astra verdict of the same round (row lock), then check the seat and the binding.
      const [locked] = await tx<{ id: string }[]>`
        update wos.rounds set row_version = row_version + 1 where id = ${ctx.params.id} and state = 'awaiting_reviews' returning id`;
      const r = await humanRoundOr409(tx, ctx.params.id);
      if (!locked) throw new ApiFailure("CONFLICT", HUMAN_SEAT_REASONS.notOpen);
      const { reasons } = await humanSeatCheck(tx, r, caller.accountId);
      if (reasons.length > 0) throw new ApiFailure("NOT_ELIGIBLE", "you may not hold the human seat of this round", { reasons });
      if (b.headSha !== r.head_sha || b.submissionSha256 !== r.submission_sha256)
        throw new ApiFailure("VALIDATION_FAILED", "the verdict must be bound to the round's head sha and submission hash");
      // D73: the human seat rules on every decision too.
      const unruled = await unruledDecisions(tx, deps, { document_id: r.document_id, head_sha: r.head_sha }, b.verdict);
      if (unruled.length > 0)
        throw new ApiFailure("VALIDATION_FAILED", "rule on every decision of the roadmap (decisionRulings)", { unruled });
      const id = uuidv7();
      try {
        await tx`
          insert into wos.round_human_reviews (id, round_id, account_id, head_sha, submission_sha256, verdict, body, review_label, review_label_reason)
          values (${id}, ${r.id}, ${caller.accountId}, ${b.headSha}, ${b.submissionSha256}, ${b.verdict.verdict}, ${tx.json(b.verdict as never)},
                  'single_lab_review', 'set by the database')`;
      } catch (err) {
        if ((err as { code?: string }).code === "23514")
          throw new ApiFailure("NOT_ELIGIBLE", "the database refused the human seat", {
            reasons: [(err as Error).message.replace(/^wos: /, "")],
          });
        throw err;
      }
      await insertEvent(
        tx,
        { type: "round.human_review_sealed", v: 1, visibility: "private", payload: { roundId: r.id, humanReviewId: id } },
        { aggregateKind: "round", aggregateId: r.id, actor: "maintainer", actorAccountId: caller.accountId },
      );
      let outcome: "consensus" | "gaps" | null = null;
      if (await roundComplete(tx, r.id)) outcome = await revealRound(tx, deps, r.id);
      return { sealed: true as const, humanReviewId: id, revealed: outcome !== null, outcome };
    });
  },

  async submitHumanRuling(ctx) {
    const caller = ctx.caller!;
    const { ruling, note } = ctx.body;
    await inTransaction(ctx.deps.sql, SYSTEM_TX, async (tx) => {
      const doc = await loadDocument(tx, ctx.params.id);
      if (!doc) throw new ApiFailure("NOT_FOUND", "document not found");
      if (doc.state !== "escalated") throw new ApiFailure("CONFLICT", `document is ${doc.state}, not escalated`);
      const [last] = await tx<{ id: string; second_seat: string }[]>`
        select id, second_seat from wos.rounds where document_id = ${doc.id} order by round_number desc limit 1`;
      if (last?.second_seat !== "human")
        throw new ApiFailure(
          "CONFLICT",
          "this escalation goes to a resolver task (confirm its ruling); the human rules under fable_unavailable only",
        );
      // REVIEW-PROTOCOL section 8 / D58: the resolver is never an author nor a reviewer of the subject; the human too.
      const reasons: string[] = [];
      if ((await subjectAuthors(tx, { attempt_id: null, document_id: doc.id })).includes(caller.accountId))
        reasons.push("you authored this subject: a ruling is never made by an author (REVIEW-PROTOCOL section 8)");
      const [reviewed] = await tx`
        select 1 as x from wos.reviews v join wos.rounds r on r.id = v.round_id where r.document_id = ${doc.id} and v.account_id = ${caller.accountId}
        union all select 1 from wos.round_human_reviews h join wos.rounds r on r.id = h.round_id
         where r.document_id = ${doc.id} and h.account_id = ${caller.accountId}`;
      if (reviewed)
        reasons.push("you reviewed this subject: a ruling is never made by one of its reviewers (REVIEW-PROTOCOL section 8, D58)");
      if (reasons.length > 0) throw new ApiFailure("NOT_ELIGIBLE", "you may not rule on this dispute", { reasons });
      const open = await tx<{ id: string }[]>`
        select id from wos.findings where document_id = ${doc.id} and state in ('open', 'disputed') and severity = 'material' order by id`;
      const ruled = new Set(ruling.rulings.map((x) => x.findingId));
      for (const x of ruling.rulings)
        if (!open.some((f) => f.id === x.findingId))
          throw new ApiFailure("VALIDATION_FAILED", `finding ${x.findingId} is not an open material finding of this document`);
      const missing = open.filter((f) => !ruled.has(f.id)).map((f) => f.id);
      if (missing.length > 0) throw new ApiFailure("VALIDATION_FAILED", `rule every open material finding; missing ${missing.join(", ")}`);
      const rulingId = uuidv7();
      await tx`insert into wos.rulings (id, task_id, lease_id, account_id, body, state, decided_by, decided_at, note, resolver, document_id)
               values (${rulingId}, null, null, ${caller.accountId}, ${tx.json(ruling as never)}, 'confirmed', ${caller.accountId}, now(), ${note},
                       'human', ${doc.id})`;
      await applyConfirmedRuling(tx, caller as Caller, ruling.rulings, note, doc.id, rulingId);
    });
    return { ok: true as const };
  },
};

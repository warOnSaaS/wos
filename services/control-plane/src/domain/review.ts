/**
 * Review rounds (REVIEW-PROTOCOL.md): opening a round with one task per slot, sealing verdicts,
 * revealing both atomically with the outcome, and driving the subject; plus implementation
 * qualification (BUILD-PROTOCOL.md section 9).
 */
import { type ReviewIndependence, type ReviewVerdict, RoundMachine } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { transition } from "../db/transition.js";
import { uuidv7 } from "../util/crypto.js";
import { loadAttempt, type AttemptRow } from "../views.js";
import { createContribution, settleKeyedContribution } from "./ledger.js";
import { documentAfterReveal } from "./documents.js";
import { type ActorRef, attemptTransition, createTask, endAttempt, requestChanges, SYSTEM } from "./work.js";

export type RoundSubject =
  | { kind: "implementation"; attemptId: string; catalogFeatureId: string | null }
  | { kind: "roadmap"; documentId: string; targetId: string }
  | { kind: "feature_contract"; documentId: string; catalogFeatureId: string };

const REVIEW_KIND = { implementation: "implementation_review", roadmap: "roadmap_review", feature_contract: "feature_review" } as const;

/** Opens a round on (headSha, submissionSha256) with exactly one review task per slot. */
export async function openRound(
  tx: Tx,
  subject: RoundSubject,
  headSha: string,
  submissionSha256: string,
  excludedAccountIds: string[],
  by: ActorRef,
): Promise<{ roundId: string; roundNumber: number }> {
  const subjectId = subject.kind === "implementation" ? subject.attemptId : subject.documentId;
  const [n] = await tx<{ n: number }[]>`
    select coalesce(max(round_number), 0)::int + 1 as n from wos.rounds
     where ${subject.kind === "implementation" ? tx`attempt_id = ${subjectId}` : tx`document_id = ${subjectId}`}`;
  const roundId = uuidv7();
  await tx`
    insert into wos.rounds (id, subject_kind, document_id, attempt_id, round_number, head_sha, submission_sha256, state)
    values (${roundId}, ${subject.kind}, ${subject.kind === "implementation" ? null : subjectId},
            ${subject.kind === "implementation" ? subjectId : null}, ${n!.n}, ${headSha}, ${submissionSha256}, 'awaiting_reviews')`;
  for (const slot of ["astra", "fable"] as const) {
    await createTask(
      tx,
      {
        kind: REVIEW_KIND[subject.kind],
        state: "open",
        reviewerSlot: slot,
        roundId,
        attemptId: subject.kind === "implementation" ? subject.attemptId : null,
        documentId: subject.kind === "implementation" ? null : subject.documentId,
        targetId: subject.kind === "roadmap" ? subject.targetId : null,
        catalogFeatureId: subject.kind === "roadmap" ? null : subject.catalogFeatureId,
        excludedAccountIds: [...new Set(excludedAccountIds)],
      },
      by,
    );
  }
  return { roundId, roundNumber: n!.n };
}

/** Accounts that authored the subject: the builder, or every author of an accepted revision of the document. */
export async function subjectAuthors(tx: Tx, round: { attempt_id: string | null; document_id: string | null }): Promise<string[]> {
  if (round.attempt_id) {
    const [a] = await tx<{ account_id: string }[]>`select account_id from wos.attempts where id = ${round.attempt_id}`;
    return a ? [a.account_id] : [];
  }
  const rows = await tx<{ account_id: string }[]>`
    select distinct c.account_id from wos.changesets c join wos.tasks t on t.id = c.task_id
     where t.document_id = ${round.document_id} and c.ok`;
  return rows.map((r) => r.account_id);
}

const WEAKNESS: Record<ReviewIndependence, number> = { independent: 0, bootstrap_maintainer: 1, bootstrap_self: 2 };

interface RoundRow {
  id: string;
  subject_kind: "roadmap" | "feature_contract" | "implementation";
  document_id: string | null;
  attempt_id: string | null;
  round_number: number;
  head_sha: string;
  submission_sha256: string;
  state: "awaiting_reviews" | "revealed" | "cancelled";
}

/**
 * Called in the verdict transaction once both slots have a sealed review: reveal atomically, compute the
 * outcome with planning.computeRoundOutcome, write findings, then drive the subject's machine.
 */
export async function revealRound(tx: Tx, deps: Deps, roundId: string): Promise<"consensus" | "gaps"> {
  const [round] = await tx<RoundRow[]>`select * from wos.rounds where id = ${roundId}`;
  if (round?.state !== "awaiting_reviews") throw new Error(`round ${roundId} is not awaiting reviews`);
  const reviews = await tx<
    {
      id: string;
      account_id: string;
      github_user_id: string;
      slot: "astra" | "fable";
      body: ReviewVerdict;
      independence: ReviewIndependence;
    }[]
  >`
    select id, account_id, github_user_id, slot, body, independence from wos.reviews where round_id = ${roundId}`;
  const astra = reviews.find((r) => r.slot === "astra");
  const fable = reviews.find((r) => r.slot === "fable");
  if (!astra || !fable) throw new Error(`round ${roundId} needs both slots before reveal`);
  const subjectId = (round.attempt_id ?? round.document_id)!;
  const subjectCol = round.attempt_id ? tx`attempt_id = ${subjectId}` : tx`document_id = ${subjectId}`;

  // Prior findings: every reviewer re-checks them; resolved only when every re-checker says resolved.
  // B-0002-planning (integration glue): only MATERIAL prior findings gate the round; minor ones never block.
  const prior = await tx<{ id: string }[]>`
    select id from wos.findings where ${subjectCol} and state in ('open', 'disputed') and round_id <> ${roundId}
       and severity = 'material'`;
  const priorIds = new Set(prior.map((p) => p.id));
  const verdictsOn = new Map<string, Array<"resolved" | "still_open">>();
  for (const r of [astra, fable]) {
    for (const p of r.body.priorFindings) {
      if (!priorIds.has(p.findingId)) continue;
      await tx`insert into wos.finding_responses (id, finding_id, round_id, account_id, source, action, note)
               values (${uuidv7()}, ${p.findingId}, ${roundId}, ${r.account_id}, 'reviewer', ${p.status}, ${p.note})`;
      verdictsOn.set(p.findingId, [...(verdictsOn.get(p.findingId) ?? []), p.status]);
    }
  }
  const stillOpen: string[] = [];
  for (const id of priorIds) {
    const v = verdictsOn.get(id) ?? [];
    if (v.length > 0 && v.every((s) => s === "resolved")) {
      await tx`update wos.findings set state = 'resolved', row_version = row_version + 1 where id = ${id} and state in ('open', 'disputed')`;
      await settleKeyedContribution(tx, `review_finding:${id}`, "accept", "system", null, "finding resolved");
    } else stillOpen.push(id);
  }
  const overruled = await tx<{ id: string }[]>`select id from wos.findings where ${subjectCol} and state = 'overruled'`;
  const outcome = deps.logic.computeRoundOutcome({
    astra: astra.body,
    fable: fable.body,
    priorOpenFindingIds: stillOpen.sort(),
    overruledFindingIds: overruled.map((o) => o.id).sort(),
  });

  let material = 0;
  for (const r of [astra, fable]) {
    for (const f of r.body.findings) {
      const findingId = uuidv7();
      await tx`
        insert into wos.findings (id, review_id, round_id, document_id, attempt_id, local_id, severity, category, title, detail, evidence,
                                  suggested_resolution, state)
        values (${findingId}, ${r.id}, ${roundId}, ${round.document_id}, ${round.attempt_id}, ${f.localId}, ${f.severity}, ${f.category},
                ${f.title}, ${f.detail}, ${tx.json(f.evidence as never)}, ${f.suggestedResolution}, 'open')`;
      if (f.severity === "material") {
        material++;
        // A material finding is a contribution; accepted when it becomes resolved or upheld (REWARD-PROTOCOL.md section 3).
        await createContribution(tx, {
          accountId: r.account_id,
          githubUserId: r.github_user_id,
          category: "review_finding",
          attemptId: round.attempt_id,
          documentId: round.document_id,
          reviewId: r.id,
          independence: r.independence,
          idempotencyKey: `review_finding:${findingId}:${r.account_id}`,
        });
      }
    }
  }
  const independence = [astra.independence, fable.independence].sort((a, b) => WEAKNESS[b] - WEAKNESS[a])[0]!;
  await transition(tx, {
    machine: RoundMachine,
    table: "rounds",
    id: roundId,
    from: "awaiting_reviews",
    event: "second_verdict_sealed",
    actor: "system",
    actorAccountId: null,
    set: { outcome: outcome.outcome, independence, revealed_at: new Date() },
    aggregateKind: "round",
    emit: {
      type: "round.revealed",
      v: 1,
      visibility: "public",
      payload: { roundId, subjectKind: round.subject_kind, subjectId, outcome: outcome.outcome, materialFindings: material, independence },
    },
  });

  if (round.attempt_id) {
    const attempt = await loadAttempt(tx, round.attempt_id);
    if (attempt && attempt.state === "in_review") await attemptAfterReveal(tx, deps, attempt, round, outcome.outcome);
  } else {
    await documentAfterReveal(tx, deps, round.document_id!, round, outcome.outcome, [astra.account_id, fable.account_id]);
  }
  return outcome.outcome;
}

async function attemptAfterReveal(tx: Tx, deps: Deps, attempt: AttemptRow, round: RoundRow, outcome: "consensus" | "gaps"): Promise<void> {
  if (outcome === "gaps") {
    await requestChanges(tx, deps, attempt, "round_gaps", SYSTEM);
    return;
  }
  const q = await qualify(tx, attempt, round);
  if (q.ok) {
    await attemptTransition(tx, attempt, "round_passed_and_qualified", SYSTEM);
  } else if (q.tampering) {
    await endAttempt(tx, deps, attempt, "fail", SYSTEM, `qualification failed: ${q.failed.join("; ")}`);
  } else {
    await requestChanges(tx, deps, attempt, "round_gaps", SYSTEM);
  }
}

export interface Qualification {
  ok: boolean;
  /** A failure of checks 1-7 indicates tampering and fails the attempt. */
  tampering: boolean;
  failed: string[];
  checks: Array<{ n: number; check: string; pass: boolean; evidence: string | null }>;
}

/** The nine machine checks of BUILD-PROTOCOL.md section 9, each with its evidence id. */
export async function qualify(
  tx: Tx,
  attempt: AttemptRow,
  round: { id: string; head_sha: string; submission_sha256: string },
): Promise<Qualification> {
  const [cs] = await tx<
    {
      id: string;
      lease_id: string;
      parent_sha: string;
      submission_sha256: string;
      manifest_sha256: string;
      ok: boolean;
      lease_account: string;
      lease_state: string;
    }[]
  >`
    select c.id, c.lease_id, c.parent_sha, c.submission_sha256, c.manifest_sha256, c.ok, l.account_id as lease_account, l.state as lease_state
      from wos.candidate_commits cc join wos.changesets c on c.id = cc.changeset_id join wos.leases l on l.id = c.lease_id
     where cc.commit_sha = ${attempt.head_sha} order by c.created_at desc limit 1`;
  const [acct] = await tx<
    { github_user_id: string | null; status: string }[]
  >`select github_user_id, status from wos.accounts where id = ${attempt.account_id}`;
  const priorHeads = await tx<{ commit_sha: string }[]>`
    select cc.commit_sha from wos.candidate_commits cc join wos.changesets c on c.id = cc.changeset_id join wos.tasks t on t.id = c.task_id
     where (t.attempt_id = ${attempt.id} or (t.kind = 'abu_build' and t.abu_id = ${attempt.abu_id})) and cc.commit_sha <> ${attempt.head_sha}`;
  const [manifest] = cs
    ? await tx<
        { id: string }[]
      >`select id from wos.context_manifests where manifest_sha256 = ${cs.manifest_sha256} and lease_id = ${cs.lease_id}`
    : [];
  const reviews = await tx<
    {
      id: string;
      account_id: string;
      verdict: string;
      lease_id: string;
      independence: string;
      head_sha: string;
      submission_sha256: string;
      run_signed: boolean;
    }[]
  >`
    select v.id, v.account_id, v.verdict, v.lease_id, v.independence, v.head_sha, v.submission_sha256,
           coalesce(r.signature_valid and r.lease_id = v.lease_id and r.manifest_id = v.manifest_id, false) as run_signed
      from wos.reviews v left join wos.agent_runs r on r.id = v.agent_run_id where v.round_id = ${round.id}`;
  // Check 7 uses exactly the runs named by the evidence: the run whose manifest the changeset cites, and each review's agent_run_id.
  const [builderRun] = cs
    ? await tx<{ id: string }[]>`
        select r.id from wos.agent_runs r join wos.context_manifests m on m.id = r.manifest_id
         where r.lease_id = ${cs.lease_id} and m.manifest_sha256 = ${cs.manifest_sha256} and r.signature_valid
         order by r.created_at desc limit 1`
    : [];
  const [ci] = await tx<{ id: string }[]>`
    select id from wos.verification_runs where attempt_id = ${attempt.id} and source = 'ci' and conclusion = 'success' and head_sha = ${attempt.head_sha}
     order by created_at desc limit 1`;
  const checks: Qualification["checks"] = [
    {
      n: 1,
      check: "build lease held by the builder at submission",
      pass: !!cs && cs.lease_account === attempt.account_id && cs.lease_state === "completed",
      evidence: cs?.lease_id ?? null,
    },
    {
      n: 2,
      check: "linked GitHub identity, account active",
      pass: acct?.github_user_id != null && acct.status === "active",
      evidence: attempt.github_user_id,
    },
    {
      n: 3,
      check: "submission parent is the base or the previous candidate head",
      pass: !!cs && (cs.parent_sha === attempt.base_sha || priorHeads.some((h) => h.commit_sha === cs.parent_sha)),
      evidence: cs?.parent_sha ?? null,
    },
    {
      n: 4,
      check: "diff hash reviewed = submitted = candidate head",
      pass:
        !!cs &&
        cs.submission_sha256 === round.submission_sha256 &&
        round.head_sha === attempt.head_sha &&
        reviews.every((r) => r.head_sha === round.head_sha && r.submission_sha256 === round.submission_sha256),
      evidence: round.submission_sha256,
    },
    { n: 5, check: "scope validation passed", pass: !!cs?.ok, evidence: cs?.id ?? null },
    { n: 6, check: "context manifest accepted for the lease", pass: !!manifest, evidence: manifest?.id ?? null },
    {
      n: 7,
      check: "signed agent runs for builder and both reviewers",
      pass: !!builderRun && reviews.length === 2 && reviews.every((r) => r.run_signed),
      evidence: builderRun?.id ?? null,
    },
    {
      n: 8,
      check: "Astra and Fable NO_MATERIAL_GAPS by accounts other than the builder",
      pass:
        reviews.length === 2 &&
        reviews.every(
          (r) => r.verdict === "NO_MATERIAL_GAPS" && (r.account_id !== attempt.account_id || r.independence === "bootstrap_self"),
        ),
      evidence: reviews.map((r) => r.id).join(","),
    },
    { n: 9, check: "wos-verify succeeded on the head sha", pass: !!ci, evidence: ci?.id ?? null },
  ];
  const failed = checks.filter((c) => !c.pass);
  return { ok: failed.length === 0, tampering: failed.some((c) => c.n <= 7), failed: failed.map((c) => `${c.n} ${c.check}`), checks };
}

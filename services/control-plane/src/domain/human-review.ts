/**
 * D53 in the V1 control plane: the review policy fallback `fable_unavailable` and the required human review seat
 * (REVIEW-PROTOCOL "D53", review-policy.v1 `independence` and `bootstrap`, migration 0013).
 *
 * Who may hold the human seat of a round (all must hold; the database re-checks each one):
 *  - an authorized human reviewer: a maintainer in V1 (`independence.assignment = admin_assigned`);
 *  - never an author of the subject (`humanMayBeSubjectAuthor = false`), with ONE exception (D67, review-policy.v2):
 *    while bootstrap is on, the bootstrap founder named by v2 may hold it on the founder's own work, labelled
 *    `bootstrap_self` (the work stays PROVISIONAL, D23, and gets its independent re-review after bootstrap ends). The
 *    agent seats' 24-hour self-review rule (agent-policy `bootstrap.selfReviewAfterHours`) does not apply to this seat;
 *  - never the account holding the Astra seat of the same round (`humanMayHoldAgentSlotOfSameRound = false`);
 *  - only after the Astra verdict is sealed: the human is the final check and reads the agent's findings (D21).
 */
import type { ReviewFallback, ReviewPolicyState } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";

export interface HumanSeatRound {
  id: string;
  state: string;
  second_seat: "fable" | "human";
  attempt_id: string | null;
  document_id: string | null;
  /** The review policy switch in force when the round opened (null: none ever made, review-policy.v1). */
  review_policy_seq: number | null;
}

export const HUMAN_SEAT_REASONS = {
  notOpen: "the round is not awaiting reviews",
  noHumanSeat: "the round has no human seat: it opened while the fable_unavailable fallback was not active",
  notAuthorized: "only an authorized human reviewer holds the human seat (a maintainer in V1: ReviewPolicy assignment admin_assigned)",
  author:
    "you authored this subject: the human seat is never the author (review-policy.v1 humanMayBeSubjectAuthor false; bootstrap selfReviewSatisfiesRules false; D23 keeps the founder's own work PROVISIONAL). Under review-policy.v2 (D67) only the bootstrap founder it names may, while bootstrap is on",
  agentSeat: "you hold the Astra seat of this round (review-policy.v1 humanMayHoldAgentSlotOfSameRound false)",
  agentPending: "the Astra verdict is not sealed yet: the human seat opens after it",
  alreadySealed: "the human review of this round is already sealed",
} as const;

/** The switch row a round pinned, read through to_jsonb so a database without migration 0014 answers v1. */
async function pinnedPolicy(tx: Tx, seq: number | null): Promise<{ version: string; founderId: string | null }> {
  if (seq === null) return { version: "review-policy.v1", founderId: null };
  const [row] = await tx<{ j: { policy_version?: string; bootstrap_founder_id?: string | null } }[]>`
    select to_jsonb(s) as j from wos.review_policy_switches s where s.seq = ${seq}`;
  return { version: row?.j.policy_version ?? "review-policy.v1", founderId: row?.j.bootstrap_founder_id ?? null };
}

/**
 * Whether `accountId` may hold the human seat of `round` now: the refusals (empty = eligible) and whether the seat would
 * be the founder's own work under D67 (labelled bootstrap_self). Migration 0014 re-checks all of it.
 */
export async function humanSeatCheck(
  tx: Tx,
  round: HumanSeatRound,
  accountId: string,
): Promise<{ reasons: string[]; bootstrapSelf: boolean }> {
  const r: string[] = [];
  let bootstrapSelf = false;
  if (round.state !== "awaiting_reviews") r.push(HUMAN_SEAT_REASONS.notOpen);
  if (round.second_seat !== "human") r.push(HUMAN_SEAT_REASONS.noHumanSeat);
  const [m] = await tx`select 1 as x from wos.account_roles where account_id = ${accountId} and role = 'maintainer'`;
  if (!m) r.push(HUMAN_SEAT_REASONS.notAuthorized);
  const [author] = round.attempt_id
    ? await tx`select 1 as x from wos.attempts where id = ${round.attempt_id} and account_id = ${accountId}`
    : await tx`select 1 as x from wos.changesets c join wos.tasks t on t.id = c.task_id
                where t.document_id = ${round.document_id} and c.account_id = ${accountId} and c.ok`;
  if (author) {
    // D67 (review-policy.v2): the bootstrap founder it names, on the policy the round pinned, while bootstrap is on.
    const pinned = await pinnedPolicy(tx, round.review_policy_seq);
    const [b] = await tx<{ on: boolean }[]>`
      select coalesce((value ->> 'enabled')::boolean, false) as on from wos.platform_settings where key = 'bootstrap_mode'`;
    if (pinned.version === "review-policy.v2" && pinned.founderId === accountId && b?.on) bootstrapSelf = true;
    else r.push(HUMAN_SEAT_REASONS.author);
  }
  const [agent] = await tx`
    select 1 as x from wos.reviews where round_id = ${round.id} and account_id = ${accountId}
    union all select 1 from wos.tasks t join wos.leases l on l.task_id = t.id
     where t.round_id = ${round.id} and l.account_id = ${accountId} and l.state = 'active'`;
  if (agent) r.push(HUMAN_SEAT_REASONS.agentSeat);
  const [sealed] = await tx`select 1 as x from wos.reviews where round_id = ${round.id} and slot = 'astra'`;
  if (!sealed) r.push(HUMAN_SEAT_REASONS.agentPending);
  const [done] = await tx`select 1 as x from wos.round_human_reviews where round_id = ${round.id}`;
  if (done) r.push(HUMAN_SEAT_REASONS.alreadySealed);
  return { reasons: r, bootstrapSelf };
}

/** Why `accountId` may not hold the human seat of `round` now (empty = eligible). */
export async function humanSeatRefusals(tx: Tx, round: HumanSeatRound, accountId: string): Promise<string[]> {
  return (await humanSeatCheck(tx, round, accountId)).reasons;
}

/** The review policy in force (public). Tolerates a database without migration 0013 or 0014 (the API deploys first). */
export async function reviewPolicyState(tx: Tx): Promise<ReviewPolicyState> {
  const none: ReviewPolicyState = {
    fallback: "none",
    switchSeq: null,
    since: null,
    reason: null,
    policyVersion: "review-policy.v1",
    bootstrapFounder: null,
  };
  const [t] = await tx<{ ok: boolean }[]>`select to_regclass('wos.review_policy_switches') is not null as ok`;
  if (!t?.ok) return none;
  const [last] = await tx<{ seq: number; fallback: ReviewFallback; reason: string; switched_at: Date; j: Record<string, unknown> }[]>`
    select seq, fallback, reason, switched_at, to_jsonb(s) as j from wos.review_policy_switches s order by seq desc limit 1`;
  if (!last) return none;
  const founderId = (last.j.bootstrap_founder_id as string | null | undefined) ?? null;
  const [f] = founderId ? await tx<{ handle: string | null }[]>`select handle from wos.accounts where id = ${founderId}` : [];
  return {
    fallback: last.fallback,
    switchSeq: last.seq,
    since: new Date(last.switched_at).toISOString(),
    reason: last.reason,
    policyVersion: ((last.j.policy_version as string | undefined) ?? "review-policy.v1") as ReviewPolicyState["policyVersion"],
    bootstrapFounder: f?.handle ?? null,
  };
}

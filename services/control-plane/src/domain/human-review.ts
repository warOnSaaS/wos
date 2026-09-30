/**
 * D53 in the V1 control plane: the review policy fallback `fable_unavailable` and the required human review seat
 * (REVIEW-PROTOCOL "D53", review-policy.v1 `independence` and `bootstrap`, migration 0013).
 *
 * Who may hold the human seat of a round (all must hold; the database re-checks each one):
 *  - an authorized human reviewer: a maintainer in V1 (`independence.assignment = admin_assigned`);
 *  - never an author of the subject (`humanMayBeSubjectAuthor = false`). There is NO bootstrap exception:
 *    `bootstrap.selfReviewSatisfiesRules = false` and D23 keeps the founder's own work PROVISIONAL. The agent seats'
 *    24-hour bootstrap self-review rule (agent-policy `bootstrap.selfReviewAfterHours`) does not apply to this seat;
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
}

export const HUMAN_SEAT_REASONS = {
  notOpen: "the round is not awaiting reviews",
  noHumanSeat: "the round has no human seat: it opened while the fable_unavailable fallback was not active",
  notAuthorized: "only an authorized human reviewer holds the human seat (a maintainer in V1: ReviewPolicy assignment admin_assigned)",
  author:
    "you authored this subject: the human seat is never the author (review-policy.v1 humanMayBeSubjectAuthor false; bootstrap selfReviewSatisfiesRules false; D23 keeps the founder's own work PROVISIONAL)",
  agentSeat: "you hold the Astra seat of this round (review-policy.v1 humanMayHoldAgentSlotOfSameRound false)",
  agentPending: "the Astra verdict is not sealed yet: the human seat opens after it",
  alreadySealed: "the human review of this round is already sealed",
} as const;

/** Why `accountId` may not hold the human seat of `round` now (empty = eligible). */
export async function humanSeatRefusals(tx: Tx, round: HumanSeatRound, accountId: string): Promise<string[]> {
  const r: string[] = [];
  if (round.state !== "awaiting_reviews") r.push(HUMAN_SEAT_REASONS.notOpen);
  if (round.second_seat !== "human") r.push(HUMAN_SEAT_REASONS.noHumanSeat);
  const [m] = await tx`select 1 as x from wos.account_roles where account_id = ${accountId} and role = 'maintainer'`;
  if (!m) r.push(HUMAN_SEAT_REASONS.notAuthorized);
  const [author] = round.attempt_id
    ? await tx`select 1 as x from wos.attempts where id = ${round.attempt_id} and account_id = ${accountId}`
    : await tx`select 1 as x from wos.changesets c join wos.tasks t on t.id = c.task_id
                where t.document_id = ${round.document_id} and c.account_id = ${accountId} and c.ok`;
  if (author) r.push(HUMAN_SEAT_REASONS.author);
  const [agent] = await tx`
    select 1 as x from wos.reviews where round_id = ${round.id} and account_id = ${accountId}
    union all select 1 from wos.tasks t join wos.leases l on l.task_id = t.id
     where t.round_id = ${round.id} and l.account_id = ${accountId} and l.state = 'active'`;
  if (agent) r.push(HUMAN_SEAT_REASONS.agentSeat);
  const [sealed] = await tx`select 1 as x from wos.reviews where round_id = ${round.id} and slot = 'astra'`;
  if (!sealed) r.push(HUMAN_SEAT_REASONS.agentPending);
  const [done] = await tx`select 1 as x from wos.round_human_reviews where round_id = ${round.id}`;
  if (done) r.push(HUMAN_SEAT_REASONS.alreadySealed);
  return r;
}

/** The review policy in force (public). */
export async function reviewPolicyState(tx: Tx): Promise<ReviewPolicyState> {
  const [last] = await tx<{ seq: number; fallback: ReviewFallback; reason: string; switched_at: Date }[]>`
    select seq, fallback, reason, switched_at from wos.review_policy_switches order by seq desc limit 1`;
  return last
    ? { fallback: last.fallback, switchSeq: last.seq, since: new Date(last.switched_at).toISOString(), reason: last.reason }
    : { fallback: "none", switchSeq: null, since: null, reason: null };
}

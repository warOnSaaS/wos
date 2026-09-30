/**
 * DRAFT v4 (budget-based execution rewards, D49; after Astra review 03) — the deterministic reward engine
 * (docs/protocol/REWARD-PROTOCOL.md). Pure, integer-only (bigint), no clock, no I/O. Same inputs, byte-identical outputs.
 *
 * D49: every commissioned task (build unit, planning, human review, audit, resolution) carries a reward BUDGET in ACU
 * fixed before work starts. When the task is issued, budget x the epoch's issuance rate (WOS per ACU, decaying) is
 * RESERVED from that epoch's task capacity; a task that does not fit is not issued (reservation at issuance — never
 * proportional scaling). Acceptance pays exactly the reserved amount, split by the declared shares; token usage is
 * telemetry and never changes a payout. Outcome contributions (proposals, bugs) keep weights in their own slice.
 *
 * Conserved funding equation, every balance non-negative:
 *
 *     R + ΣP + S + ΣQ + I = emissionReserve,   Σ claimable + Σ holdback <= I
 *
 * R remaining reserve, P completion pools, S security reserve, Q budgets reserved for issued tasks, I issued to
 * beneficiaries. Every movement names its source:
 *   issuance         R -> Q (task budget x issuance rate, within the epoch's capacity for that task kind)
 *   acceptance       Q -> I (the whole reservation, split by declared shares; holdback applies)
 *   release/expiry   Q -> R (failed, abandoned or expired tasks; a re-issued task is re-priced)
 *   returns          identified transfers back to R: an expired unbound entitlement (from the owner's claimable
 *                    balance), a cancelled pool (from P), a forfeited holdback (from the owner's tranches)
 *   corrections      completion accrual attributed to work later clipped or revoked: pool part from P, the already
 *                    paid part as beneficiary offsets
 *   disputes         escrowed excess of a clipped/revoked allocation (from I, never released); bounty <= bountyBp x recovered
 *   confiscations    COMPENSATORY only: holdback + unclaimed recovered never exceed the proven excess
 *   claims           settled leaves leave the claimable balance (I unchanged)
 *   write-offs       an uncollectable offset becomes a loss absorbed by later budgets (bounded per epoch)
 * Every event id may be consumed once: duplicates inside an input, or ids in `consumedIds` (REQUIRED replay state), are refused.
 */

export const MICRO = 1_000_000n;
export const BP = 10_000n;
/** lcm(1..16): lets a receipt's weight be split exactly across up to 16 targets of a shared feature. */
export const SHARE_SCALE = 720_720n;

export class EngineError extends Error {
  override name = "EngineError";
}

// ------------------------------------------------------------------------------------------------ primitives

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Largest-remainder split of `total` over integer weights: floor shares, then one unit each to the largest
 * remainders, ties by key ascending (UTF-16 code units). Always sums to `total` when the weight sum is positive.
 */
export function largestRemainder(total: bigint, weights: ReadonlyArray<{ key: string; weight: bigint }>): Map<string, bigint> {
  if (total < 0n) throw new EngineError("negative total");
  const seen = new Set<string>();
  for (const w of weights) {
    if (seen.has(w.key)) throw new EngineError(`duplicate key ${w.key}`);
    if (w.weight < 0n) throw new EngineError(`negative weight for ${w.key}`);
    seen.add(w.key);
  }
  const sorted = [...weights].sort((a, b) => cmp(a.key, b.key));
  const out = new Map<string, bigint>(sorted.map((w) => [w.key, 0n]));
  const sum = sorted.reduce((s, w) => s + w.weight, 0n);
  if (total === 0n) return out;
  if (sum === 0n) throw new EngineError(`cannot split ${total} over zero weight`);
  const parts = sorted.map((w) => ({ key: w.key, base: (total * w.weight) / sum, rem: (total * w.weight) % sum }));
  let left = total - parts.reduce((s, p) => s + p.base, 0n);
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? cmp(a.key, b.key) : a.rem > b.rem ? -1 : 1));
  for (const p of order) {
    if (left === 0n) break;
    p.base += 1n;
    left -= 1n;
  }
  for (const p of parts) out.set(p.key, p.base);
  return out;
}

/**
 * Review 06 R06-3: THE split of a task's reservation over its contributors, used by the engine (acceptance) and by the
 * allocation rule (`taskAllocationRefusals`) alike. Canonical key: the contributor's account id (one receipt per
 * account and task in the database); largest remainder, ties by account id ascending — receipt ids never influence an
 * amount. Each contributor's amount is then split person/organization by the sponsorship share (organization =
 * floor(amount x orgShareBp / 10000), the person keeps the rest; organization splits are dormant, D55).
 */
export function splitTaskReservation(
  reservedBase: bigint,
  contributors: ReadonlyArray<{ accountId: string; shareBp: number; orgShareBp?: number }>,
): Map<string, { total: bigint; person: bigint; organization: bigint }> {
  const sum = contributors.reduce((t, c) => t + c.shareBp, 0);
  if (sum !== 10_000 || contributors.some((c) => !Number.isInteger(c.shareBp) || c.shareBp <= 0))
    throw new EngineError("declared shares must be positive and sum to 10000");
  const byAccount = largestRemainder(
    reservedBase,
    contributors.map((c) => ({ key: c.accountId, weight: BigInt(c.shareBp) })),
  );
  const out = new Map<string, { total: bigint; person: bigint; organization: bigint }>();
  for (const c of contributors) {
    const total = byAccount.get(c.accountId) ?? 0n;
    const organization = (total * BigInt(c.orgShareBp ?? 0)) / BP;
    out.set(c.accountId, { total, person: total - organization, organization });
  }
  return out;
}

/** micro-ACU of a run: floor(sum(tokens x micro-ACU-per-million) / 1e6). TELEMETRY since D49 (cap enforcement, budget calibration). */
export function acuMicroFromUsage(
  usage: { inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number },
  rate: { inputPerM: number; cachedInputPerM: number; cacheWritePerM: number; outputPerM: number },
): bigint {
  const t =
    BigInt(usage.inputTokens) * BigInt(rate.inputPerM) +
    BigInt(usage.cachedInputTokens) * BigInt(rate.cachedInputPerM) +
    BigInt(usage.cacheWriteInputTokens) * BigInt(rate.cacheWritePerM) +
    BigInt(usage.outputTokens) * BigInt(rate.outputPerM);
  return t / MICRO;
}

/**
 * min(observed, cap): the execution-stop check on telemetry. An execution-cap and telemetry control only (D49; review 05
 * obsolete item 4): never part of a payout or a qualification.
 */
export function clipToCap(attestedMicro: bigint, capMicro: bigint): bigint {
  return attestedMicro < capMicro ? attestedMicro : capMicro;
}

/** Rate ceiling (base units per ACU) for epoch n >= 1: initial x (1 - decayPpm/1e6)^(n-1), floored every step. */
export function rateCeiling(initialBasePerAcu: bigint, decayPpm: bigint, epochNumber: number): bigint {
  if (!Number.isInteger(epochNumber) || epochNumber < 1) throw new EngineError("epochNumber must be >= 1");
  let r = initialBasePerAcu;
  for (let i = 1; i < epochNumber; i++) r = (r * (MICRO - decayPpm)) / MICRO;
  return r;
}

export function epochBudget(remainingReserve: bigint, budgetPpm: bigint): bigint {
  return (remainingReserve * budgetPpm) / MICRO;
}

// ------------------------------------------------------------------------------------------------ types

export type CompletionComponent = "implementers" | "contractAuthors" | "roadmapAuthors" | "reviewers" | "finder";

/** D49: the task kinds that are commissioned with a budget; their slices form one pooled task capacity per epoch. */
export const TASK_SLICES = ["execution", "planning", "human_review"] as const;
export type TaskSlice = (typeof TASK_SLICES)[number];

export interface EngineParams {
  emissionReserve: bigint;
  budgetPpm: bigint;
  /** D49: the issuance rate (base units per ACU of budget) of epoch 1, decaying; fixed for a task at its issuance. */
  rateCeilingInitialBasePerAcu: bigint;
  rateCeilingDecayPpm: bigint;
  slicesBp: Record<TaskSlice | "outcomes" | "completion_accrual" | "security_reserve", bigint>;
  featurePoolsBp: bigint;
  applicationPoolsBp: bigint;
  completionComponentsBp: Record<CompletionComponent, bigint>;
  securityMaxShareOfReserveBp: bigint;
  maxOffsetRecoveryBp: bigint;
  /** Holdback: this share of each net allocation is held for `holdbackEpochs` epochs (D40, re-sized by D49). */
  holdbackBp: bigint;
  holdbackEpochs: number;
  /** The reward policy version pinned on every new tranche (its maturity never follows a later policy). */
  holdbackPolicyVersion: string;
  /**
   * D49: an issued task not accepted within this many epochs is released (Q -> R) and must be re-priced to re-issue.
   * One rule in both layers (review 05 B4): a reservation is live while `epoch < expiresAtEpoch`; it expires AT
   * `expiresAtEpoch` (acceptance refused, the sweep returns it).
   */
  budgetExpiryEpochs: number;
  /**
   * Review 05 B4: work SUBMITTED while its reservation was live keeps it for this many further epochs while the
   * protocol's own reviews finish (the contributor is not penalised for review delay). Accepted by D57 (F28).
   */
  reviewGraceEpochs: number;
  /** Bounties are this share of amounts actually RECOVERED (D41). */
  bountyBpOfRecovered: bigint;
  /** At most this share of an epoch's budget absorbs unrecovered losses (D41); the rest carries forward. */
  lossAbsorptionMaxBp: bigint;
}

export interface HoldbackTranche {
  /** Review 06 R06-7: a stable identity (`<epoch>:<beneficiary>`, one tranche per beneficiary per epoch) holds can name. */
  trancheId: string;
  beneficiaryId: string;
  epochNumber: number;
  amount: bigint;
  /** Fixed when the tranche is created (epoch + the holdback epochs of the policy then in force). */
  maturesAtEpoch: number;
  policyVersion: string;
}

/** D49: a budget reserved for an issued task. */
export interface Reservation {
  kind: TaskSlice;
  budgetAcuMicro: bigint;
  amount: bigint;
  issuedEpoch: number;
  expiresAtEpoch: number;
  /**
   * Review 05 B5: the completion-pool and security-reserve accrual this task would fund, reserved WITH it (part of Q).
   * Acceptance moves it into the pools and S; release or expiry returns it to R. Failed work funds nothing.
   */
  ancillary: { pools: ReadonlyArray<{ poolKey: string; amount: bigint }>; security: bigint };
  /** Review 05 B4: the epoch the work was submitted in while the reservation was live (null until then). */
  submittedEpoch: number | null;
  /**
   * Review 06 R06-5: the review grace and reward-policy version PINNED at issuance. A later policy never shortens or
   * lengthens an outstanding reservation (forward-only, like the quote itself).
   */
  reviewGraceEpochs: number;
  policyVersion: string;
  /** Review 06: a re-issue is a NEW task/reservation generation linked to the one it replaces (null for a first issue). */
  reissueOf: string | null;
}

/** The whole amount a reservation holds in Q: the budget plus its provisional ancillary accrual. */
export function reservationTotal(r: Reservation): bigint {
  return r.amount + r.ancillary.security + r.ancillary.pools.reduce((t, x) => t + x.amount, 0n);
}

/** Review 05 B4: the first epoch in which a reservation is no longer live (acceptance refused, the sweep returns it). */
export function reservationExpiry(r: Reservation): number {
  return r.submittedEpoch === null ? r.expiresAtEpoch : r.expiresAtEpoch + r.reviewGraceEpochs;
}

/**
 * Review 06 R06-7: a SIMPLE HOLD (V1-active) on a named source: part of a holdback tranche, or part of a beneficiary's
 * claimable balance. Held units stay owned and counted where they are (never double-counted); they neither mature nor
 * can be claimed until the hold is released. Execution of a hold (confiscation) is dormant (D55).
 */
export interface Hold {
  beneficiaryId: string;
  source: "tranche" | "claimable";
  /** For `tranche`: the tranche's `trancheId`. */
  trancheId: string | null;
  amount: bigint;
}

export interface EngineState {
  remainingReserve: bigint;
  poolBalances: ReadonlyMap<string, bigint>;
  securityReserve: bigint;
  /** D49: Q — budgets reserved for issued, not yet accepted or released tasks. */
  reserved: ReadonlyMap<string, Reservation>;
  cumulativeIssued: bigint;
  holdback: readonly HoldbackTranche[];
  /** Released (or matured, or bounty) but not yet claimed, per beneficiary: the only source of unclaimed returns. */
  claimable: ReadonlyMap<string, bigint>;
  /** Outstanding offsets per beneficiary (proven excess not yet recovered). */
  offsets: ReadonlyMap<string, bigint>;
  /** Unrecovered losses (written-off offsets) not yet absorbed by a budget. Bookkeeping, not a balance. */
  lossCarry: bigint;
  /**
   * Review 04 finding 1 / review 05 B7: issued tokens already settled to wallets. I = delivered + claimable + holdback,
   * exactly: every unit of I is owned by someone or already delivered, so nothing can leave I without its owner.
   */
  delivered: bigint;
  /** Review 06 R06-7: active simple holds by id. */
  holds: ReadonlyMap<string, Hold>;
  /**
   * Review 05 B3: the last epoch computed. One call per epoch: the engine replays that epoch's events against the one
   * envelope frozen at its opening (`openEpoch`); a second call for the same (or an earlier) epoch is refused.
   */
  lastEpoch: number;
}

/** An OUTCOME contribution (proposal incorporated, bug fixed): weight competes in the outcomes slice. */
export interface EngineReceipt {
  receiptId: string;
  /** The contributor (the accountable person). */
  accountId: string;
  /** D38: who receives it. Shares in bp summing to 10000; default [{ beneficiaryId: accountId, shareBp: 10000 }]. */
  beneficiaries?: ReadonlyArray<{ beneficiaryId: string; shareBp: number }>;
  slice: "outcomes";
  weightMicro: bigint;
}

/** D49: a task issued this epoch, in the scheduler's priority order. Pool keys are known at issuance. */
export interface TaskIssuance {
  taskId: string;
  /**
   * Review 06: re-issuing expired or released work creates a NEW task id (a new reservation generation) that names the
   * one it replaces; the replaced id stays consumed. The database links them (`task_budgets.reissue_of`).
   */
  reissueOf?: string;
  kind: TaskSlice;
  budgetAcuMicro: bigint;
  featurePoolKeys: readonly string[];
  applicationPoolKeys: readonly string[];
}

/**
 * D49: acceptance of an issued task. R_ij = B_i x a_i x s_ij with a_i = 1 (binary acceptance; no quality factor in
 * V1). Shares are declared by the collaborators and sum to 10000 bp; beneficiaries follow each contributor's
 * sponsorship split. The whole reservation is paid, whatever tokens were used.
 */
export interface TaskAcceptance {
  taskId: string;
  shares: ReadonlyArray<{ accountId: string; beneficiaryId: string; shareBp: number }>;
  /**
   * D63 (versioned addition): how the task was claimed, pinned in the lease's RunPolicySnapshot. The reservation is
   * always the QUEUE price (the budget-model output: base price + the queue bonus). When the bonus applies (a queue
   * claim) the whole reservation is paid; otherwise (a self-picked claim, or a queue claim right after the
   * contributor released an assigned task) the BASE price, queueBasePrice(reservation), is paid and the queue-bonus
   * portion returns to R at acceptance. Absent = the frozen v1 behaviour (the whole reservation).
   */
  claim?: { mode: "queue" | "self_pick"; queueBonusBp: number; bonusApplies: boolean };
}

/**
 * D63: the BASE price of a task whose queue price (reservation) is `queuePrice`: floor(queuePrice x 10000 / (10000 +
 * queueBonusBp)). Rounding rule: the base is floored in base units, so the queue bonus returned to R on a self-picked
 * acceptance is queuePrice - base (never negative, at most one unit above the exact bonus share).
 */
export function queueBasePrice(queuePrice: bigint, queueBonusBp: number): bigint {
  if (!Number.isInteger(queueBonusBp) || queueBonusBp < 0 || queueBonusBp > 10_000)
    throw new EngineError(`queue bonus ${queueBonusBp} bp is outside 0..10000`);
  return (queuePrice * BP) / (BP + BigInt(queueBonusBp));
}

export interface PoolPayout {
  id: string;
  poolKey: string;
  /** Feature pools split by components; application pools pay 100% by lifetime weight. */
  kind: "feature" | "application";
  beneficiaries: ReadonlyArray<{ beneficiaryId: string; component: CompletionComponent | "lifetime"; weight: bigint }>;
}

export type EngineReturn =
  | { id: string; kind: "unbound_expiry"; beneficiaryId: string; amount: bigint }
  | { id: string; kind: "pool_cancel"; poolKey: string; amount: bigint }
  | { id: string; kind: "holdback_forfeit"; beneficiaryId: string; amount: bigint };

export interface Bounty {
  beneficiaryId: string;
  amountBase: bigint;
}

export interface DisputeRecovery {
  beneficiaryId: string;
  from: "claimable" | "holdback" | "delivered";
  amount: bigint;
}

/** Review 05 B3: the envelope of an epoch, frozen when it opens (from the state it opens on and the published forecast). */
export interface EpochEnvelope {
  epochNumber: number;
  /** The remaining reserve the envelope was computed from (persisted with the epoch). */
  reserveSnapshot: bigint;
  demandForecastAcuMicro: bigint;
  budget: bigint;
  absorbedLoss: bigint;
  slices: Record<string, bigint>;
  /** Base units per ACU of budget for every task issued in the epoch, and for outcomes and security payouts. */
  rate: bigint;
  /** The pooled task capacity (execution + planning + human review slices). */
  taskCapacity: bigint;
}

export interface EpochInput {
  epochNumber: number;
  state: EngineState;
  /**
   * Ids consumed by earlier epochs (replay state, REQUIRED and checked at runtime: review 04 finding 10); the database
   * enforces the same with unique keys.
   */
  consumedIds: ReadonlySet<string>;
  /**
   * D49: the published demand forecast (micro-ACU of task budgets requested last epoch). The issuance rate is
   * min(rate ceiling, task capacity / forecast), announced before issuance and fixed per task: it falls ex ante with
   * participation, so the capacity is used without ever scaling an accepted budget afterwards.
   */
  demandForecastAcuMicro?: bigint;
  /**
   * D49: tasks to issue this epoch, in priority order; those that do not fit the pooled task capacity are returned as
   * unfunded and are NOT consumed (review 05 B8): the same task id can be issued in a later epoch.
   */
  issuances?: readonly TaskIssuance[];
  /** Review 06 R06-7: simple holds placed this epoch and holds released this epoch (applied first). */
  holds?: ReadonlyArray<{ id: string; beneficiaryId: string; source: "tranche" | "claimable"; trancheId?: string; amount: bigint }>;
  holdReleases?: ReadonlyArray<{ holdId: string }>;
  /** Review 05 B4: tasks whose work was submitted this epoch (only while live); protects them from expiry during review. */
  submissions?: ReadonlyArray<{ taskId: string }>;
  /** Applied AFTER this epoch's issuances (review 05 B3): a task can be issued and accepted in the same epoch. */
  acceptances?: readonly TaskAcceptance[];
  /** D49: failed, abandoned or cancelled tasks: their reservation returns to R. */
  releases?: ReadonlyArray<{ taskId: string }>;
  /** Outcome contributions only. */
  receipts?: readonly EngineReceipt[];
  returns?: readonly EngineReturn[];
  /** `amount` is still in the pool (returned to R); `recoverFromPaid` was already paid and becomes offsets. */
  accrualCorrections?: ReadonlyArray<{
    id: string;
    poolKey: string;
    amount: bigint;
    recoverFromPaid?: ReadonlyArray<{ beneficiaryId: string; amount: bigint }>;
  }>;
  /** Settled claim leaves: they leave the beneficiary's claimable balance. */
  claims?: ReadonlyArray<{ id: string; beneficiaryId: string; amount: bigint }>;
  poolPayouts?: readonly PoolPayout[];
  securityPayouts?: ReadonlyArray<{ id: string; receiptId: string; beneficiaryId: string; weightMicro: bigint }>;
  /**
   * Review 04 finding 1 / review 05 B7: a finally adjudicated excess is recovered from NAMED sources of the beneficiary
   * who received it: `claimable` (debited from their unclaimed balance), `holdback` (from their tranches) or `delivered`
   * (already in their wallet: becomes an offset against their future allocations, never returned to R as if it existed).
   * Bounties come only from what was actually recovered now (claimable + holdback).
   */
  disputeSettlements?: ReadonlyArray<{ id: string; recoveries: readonly DisputeRecovery[]; bounties: readonly Bounty[] }>;
  /** D39 confiscation after proven cheating (compensatory): holdback + unclaimed <= proven excess; the rest becomes an offset. */
  confiscations?: ReadonlyArray<{
    id: string;
    beneficiaryId: string;
    holdbackBase: bigint;
    unclaimedBase: bigint;
    provenExcessBase: bigint;
    bounties: readonly Bounty[];
  }>;
  /** Offsets that can no longer be collected (excluded or exited beneficiary): become absorbed losses. */
  writeOffs?: ReadonlyArray<{ id: string; beneficiaryId: string; amount: bigint }>;
}

export interface AllocationLine {
  beneficiaryId: string;
  /** The contributor (null for pool, security and bounty lines). */
  accountId: string | null;
  /** The accepted task (task slices) or the outcome receipt. */
  receiptId: string | null;
  slice: TaskSlice | "outcomes" | "completion_payout" | "security_payout" | "dispute_bounty" | "recovery_bounty";
  poolKey: string | null;
  component: string | null;
  /** Task slices: the task budget in micro-ACU (display); outcomes: the weight. */
  weightMicro: bigint;
  amountBase: bigint;
}

export interface Entitlement {
  beneficiaryId: string;
  gross: bigint;
  offsetRecovered: bigint;
  releasedNow: bigint;
  heldBack: bigint;
  maturedHoldback: bigint;
}

export interface EpochResult {
  epochNumber: number;
  /** Review 05 B3: the envelope frozen when the epoch opened (the database pins the same rate and capacity). */
  envelope: EpochEnvelope;
  budget: bigint;
  absorbedLoss: bigint;
  /** D49: the issuance rate (base units per ACU of budget) for tasks issued this epoch. */
  rateCeilingBasePerAcu: bigint;
  slices: Record<string, bigint>;
  /** Capacity per task slice, what was reserved from it, and the tasks that did not fit (not issued). */
  taskCapacity: Record<TaskSlice, bigint>;
  reservedBySlice: Record<TaskSlice, bigint>;
  funded: string[];
  unfunded: string[];
  /** Paid on acceptance this epoch (Q -> I), and released or expired (Q -> R). */
  acceptedBase: bigint;
  /** D63: the queue-bonus portion of self-picked acceptances, returned to R (included in returnedToReserve). */
  queueBonusReturnedBase: bigint;
  releasedBase: bigint;
  expired: string[];
  outcomesEmitted: bigint;
  returnedToReserve: bigint;
  accruals: Map<string, bigint>;
  securityAccrual: bigint;
  allocations: AllocationLine[];
  entitlements: Map<string, Entitlement>;
  consumedIds: string[];
  state: EngineState;
}

function sumMap(m: ReadonlyMap<string, bigint>): bigint {
  let s = 0n;
  for (const v of m.values()) s += v;
  return s;
}

function reservedTotal(m: ReadonlyMap<string, Reservation>): bigint {
  let s = 0n;
  for (const v of m.values()) s += reservationTotal(v);
  return s;
}

/**
 * Equality AND non-negative balances AND ownership: I = delivered + claimable + holdback exactly (review 04 finding 1),
 * so no unit of issuance exists without an owner or a delivery. Throws on any violation.
 */
export function assertConserved(emissionReserve: bigint, s: EngineState): void {
  if (s.remainingReserve < 0n) throw new EngineError(`negative reserve ${s.remainingReserve}`);
  if (s.securityReserve < 0n) throw new EngineError(`negative security reserve ${s.securityReserve}`);
  if (s.cumulativeIssued < 0n) throw new EngineError(`negative issuance ${s.cumulativeIssued}`);
  if (s.delivered < 0n) throw new EngineError(`negative delivered ${s.delivered}`);
  if (s.lossCarry < 0n) throw new EngineError("negative loss carry");
  for (const [k, v] of s.poolBalances) if (v < 0n) throw new EngineError(`negative pool ${k}`);
  for (const [k, v] of s.offsets) if (v < 0n) throw new EngineError(`negative offset ${k}`);
  for (const [k, v] of s.reserved) {
    if (v.amount < 0n || v.ancillary.security < 0n || v.ancillary.pools.some((x) => x.amount < 0n))
      throw new EngineError(`negative reservation ${k}`);
  }
  for (const [k, v] of s.claimable) if (v < 0n) throw new EngineError(`negative claimable balance ${k}`);
  let held = 0n;
  for (const t of s.holdback) {
    if (t.amount < 0n) throw new EngineError(`negative holdback for ${t.beneficiaryId}`);
    held += t.amount;
  }
  for (const [id, h] of s.holds) {
    if (h.amount <= 0n) throw new EngineError(`hold ${id} must be positive`);
    if (h.source === "tranche" && !s.holdback.some((t) => t.trancheId === h.trancheId && t.beneficiaryId === h.beneficiaryId))
      throw new EngineError(`hold ${id} names no tranche of ${h.beneficiaryId}`);
  }
  for (const t of s.holdback)
    if (heldOnTranche(s.holds, t.trancheId) > t.amount) throw new EngineError(`tranche ${t.trancheId} is held beyond its amount`);
  for (const [b, v] of s.claimable)
    if (heldOnClaimable(s.holds, b) > v) throw new EngineError(`claimable of ${b} is held beyond its amount`);
  for (const [, h] of s.holds)
    if (h.source === "claimable" && !s.claimable.has(h.beneficiaryId))
      throw new EngineError(`claimable of ${h.beneficiaryId} is held but empty`);
  if (held + sumMap(s.claimable) + s.delivered !== s.cumulativeIssued)
    throw new EngineError(
      `issuance ${s.cumulativeIssued} is not owned: delivered ${s.delivered} + claimable ${sumMap(s.claimable)} + holdback ${held}`,
    );
  const total = s.remainingReserve + sumMap(s.poolBalances) + s.securityReserve + reservedTotal(s.reserved) + s.cumulativeIssued;
  if (total !== emissionReserve) throw new EngineError(`funding equation broken: ${total} != ${emissionReserve}`);
}

function heldOnTranche(holds: ReadonlyMap<string, Hold>, trancheId: string): bigint {
  let s = 0n;
  for (const h of holds.values()) if (h.source === "tranche" && h.trancheId === trancheId) s += h.amount;
  return s;
}
function heldOnClaimable(holds: ReadonlyMap<string, Hold>, beneficiaryId: string): bigint {
  let s = 0n;
  for (const h of holds.values()) if (h.source === "claimable" && h.beneficiaryId === beneficiaryId) s += h.amount;
  return s;
}

/** An empty starting state holding the whole emission reserve. */
export function initialState(emissionReserve: bigint): EngineState {
  return {
    remainingReserve: emissionReserve,
    poolBalances: new Map(),
    securityReserve: 0n,
    reserved: new Map(),
    cumulativeIssued: 0n,
    holdback: [],
    claimable: new Map(),
    offsets: new Map(),
    lossCarry: 0n,
    delivered: 0n,
    holds: new Map(),
    lastEpoch: 0,
  };
}

/**
 * D49: the base units a budget reserves at issuance: floor(budget micro-ACU x rate / 1e6). The database computes the
 * same with an explicit floor (review 05 B9); `tests` hold cross-language vectors.
 */
export function budgetToBase(budgetAcuMicro: bigint, ratePerAcu: bigint): bigint {
  return (budgetAcuMicro * ratePerAcu) / MICRO;
}

function checkParams(p: EngineParams): void {
  const sliceBpSum = Object.values(p.slicesBp).reduce((s, v) => s + v, 0n);
  if (sliceBpSum !== BP) throw new EngineError(`slices must sum to 10000 bp, got ${sliceBpSum}`);
  if (p.featurePoolsBp + p.applicationPoolsBp !== BP) throw new EngineError("completion split must sum to 10000 bp");
  const compSum = Object.values(p.completionComponentsBp).reduce((s, v) => s + v, 0n);
  if (compSum !== BP) throw new EngineError("completion components must sum to 10000 bp");
}

/**
 * Review 05 B3: open an epoch ONCE. The budget, the slices, the pooled task capacity and the issuance rate are computed
 * from the state the epoch opens on and the published demand forecast, and frozen: every task event of the epoch is
 * applied against this envelope (the database pins the same rate and capacity on the epoch row; rule
 * `epochEnvelopeRefusals` compares them).
 */
export function openEpoch(state: EngineState, epochNumber: number, demandForecastAcuMicro: bigint, p: EngineParams): EpochEnvelope {
  checkParams(p);
  if (demandForecastAcuMicro < 0n) throw new EngineError("negative demand forecast");
  const fullBudget = epochBudget(state.remainingReserve, p.budgetPpm);
  const absorbCap = (fullBudget * p.lossAbsorptionMaxBp) / BP;
  const absorbedLoss = state.lossCarry < absorbCap ? state.lossCarry : absorbCap;
  const budget = fullBudget - absorbedLoss;
  const slices = Object.fromEntries(
    largestRemainder(
      budget,
      Object.entries(p.slicesBp).map(([key, weight]) => ({ key, weight })),
    ),
  ) as Record<string, bigint>;
  const ceiling = rateCeiling(p.rateCeilingInitialBasePerAcu, p.rateCeilingDecayPpm, epochNumber);
  const taskCapacity = TASK_SLICES.reduce((t, k) => t + (slices[k] ?? 0n), 0n);
  const byDemand = demandForecastAcuMicro > 0n ? (taskCapacity * MICRO) / demandForecastAcuMicro : ceiling;
  const rate = byDemand < ceiling ? byDemand : ceiling;
  return {
    epochNumber,
    reserveSnapshot: state.remainingReserve,
    demandForecastAcuMicro,
    budget,
    absorbedLoss,
    slices,
    rate,
    taskCapacity,
  };
}

// ------------------------------------------------------------------------------------------------ epoch

function beneficiariesOf(r: EngineReceipt): ReadonlyArray<{ beneficiaryId: string; shareBp: number }> {
  const b = r.beneficiaries ?? [{ beneficiaryId: r.accountId, shareBp: 10_000 }];
  const sum = b.reduce((t, x) => t + x.shareBp, 0);
  if (sum !== 10_000 || b.some((x) => !Number.isInteger(x.shareBp) || x.shareBp < 0))
    throw new EngineError(`beneficiary shares of ${r.receiptId} must sum to 10000`);
  return b;
}

export function computeEpoch(input: EpochInput, p: EngineParams): EpochResult {
  checkParams(p);
  // Review 04 finding 10: replay state is validated at runtime, not only by the type.
  if (!(input.consumedIds instanceof Set)) throw new EngineError("replay state (consumedIds) is required");
  if (!Number.isInteger(input.state.lastEpoch) || typeof input.state.delivered !== "bigint")
    throw new EngineError("engine state lacks its epoch checkpoint (lastEpoch) or delivered balance");
  // Review 05 B3: one call per epoch, in order.
  if (!Number.isInteger(input.epochNumber) || input.epochNumber <= input.state.lastEpoch)
    throw new EngineError(`epoch ${input.epochNumber} is not after the last computed epoch ${input.state.lastEpoch} (one call per epoch)`);
  assertConserved(p.emissionReserve, input.state);
  const env = openEpoch(input.state, input.epochNumber, input.demandForecastAcuMicro ?? 0n, p);

  const consumed: string[] = [];
  const seen = new Set<string>();
  const isConsumed = (id: string) => seen.has(id) || input.consumedIds.has(id);
  const consume = (id: string, what: string) => {
    if (isConsumed(id)) throw new EngineError(`${what} ${id} consumed twice`);
    seen.add(id);
    consumed.push(id);
  };
  const receipts = input.receipts ?? [];
  for (const r of receipts) {
    if (r.slice !== "outcomes")
      throw new EngineError(`${r.receiptId}: execution, planning and human review are budgeted tasks (issuances/acceptances), not weights`);
    consume(`receipt:${r.receiptId}`, "receipt");
    if (r.weightMicro < 0n) throw new EngineError(`negative weight on ${r.receiptId}`);
  }

  let R = input.state.remainingReserve;
  const pools = new Map(input.state.poolBalances);
  let S = input.state.securityReserve;
  const reserved = new Map(input.state.reserved);
  let I = input.state.cumulativeIssued;
  let delivered = input.state.delivered;
  let tranches = input.state.holdback.map((t) => ({ ...t }));
  const claimable = new Map(input.state.claimable);
  const holds = new Map(input.state.holds);
  const offsets = new Map(input.state.offsets);
  let lossCarry = input.state.lossCarry - env.absorbedLoss;
  let returned = 0n;
  const gross = new Map<string, bigint>();
  const bountyGross = new Map<string, bigint>();
  const allocations: AllocationLine[] = [];
  const addGross = (m: Map<string, bigint>, b: string, a: bigint) => m.set(b, (m.get(b) ?? 0n) + a);
  const addOffset = (b: string, a: bigint) => offsets.set(b, (offsets.get(b) ?? 0n) + a);
  // R06-7: only UNHELD units can leave a claimable balance or a tranche (held units stay until their hold is released).
  const debitClaimable = (beneficiaryId: string, amount: bigint, why: string) => {
    const have = (claimable.get(beneficiaryId) ?? 0n) - heldOnClaimable(holds, beneficiaryId);
    if (amount > have) throw new EngineError(`${why}: ${beneficiaryId} has only ${have} unheld claimable, not ${amount}`);
    claimable.set(beneficiaryId, (claimable.get(beneficiaryId) ?? 0n) - amount);
  };
  const takeHoldback = (beneficiaryId: string, amount: bigint, why: string) => {
    let need = amount;
    const mine = tranches.filter((t) => t.beneficiaryId === beneficiaryId).sort((a, b) => a.epochNumber - b.epochNumber);
    for (const t of mine) {
      const free = t.amount - heldOnTranche(holds, t.trancheId);
      const take = free < need ? free : need;
      t.amount -= take;
      need -= take;
      if (need === 0n) break;
    }
    if (need > 0n) throw new EngineError(`${why}: ${beneficiaryId} has less holdback than ${amount}`);
    tranches = tranches.filter((t) => t.amount > 0n);
  };
  const payBounties = (id: string, bounties: readonly Bounty[], recovered: bigint, slice: "dispute_bounty" | "recovery_bounty") => {
    const paid = bounties.reduce((t, b) => t + b.amountBase, 0n);
    if (bounties.some((b) => b.amountBase < 0n)) throw new EngineError(`negative bounty in ${id}`);
    if (paid * BP > recovered * p.bountyBpOfRecovered)
      throw new EngineError(`${id} pays more bounty than ${p.bountyBpOfRecovered} bp of what it recovered`);
    for (const b of bounties) {
      if (b.amountBase === 0n) continue;
      allocations.push({
        beneficiaryId: b.beneficiaryId,
        accountId: null,
        receiptId: null,
        slice,
        poolKey: null,
        component: null,
        weightMicro: 0n,
        amountBase: b.amountBase,
      });
      addGross(bountyGross, b.beneficiaryId, b.amountBase);
    }
    return paid;
  };

  // 0. Simple holds (R06-7, R07-6), folded in a fixed order before claims: (a) releases of holds placed in EARLIER
  //    epochs free their units, (b) this epoch's new holds are placed (unheld units only), (c) releases of holds placed
  //    in THIS epoch. So a hold placed and lifted within one epoch replays; every event id is consumed once.
  const newHoldIds = new Set((input.holds ?? []).map((h) => h.id));
  const releaseHold = (holdId: string) => {
    consume(`hold-release:${holdId}`, "hold release");
    if (!holds.delete(holdId)) throw new EngineError(`hold ${holdId} is not active`);
  };
  for (const r of input.holdReleases ?? []) if (!newHoldIds.has(r.holdId)) releaseHold(r.holdId);
  for (const h of input.holds ?? []) {
    consume(`hold:${h.id}`, "hold");
    if (h.amount <= 0n) throw new EngineError(`hold ${h.id} must be positive`);
    if (h.source === "tranche") {
      const t = tranches.find((x) => x.trancheId === h.trancheId && x.beneficiaryId === h.beneficiaryId);
      if (!t) throw new EngineError(`hold ${h.id} names no tranche ${h.trancheId} of ${h.beneficiaryId}`);
      if (heldOnTranche(holds, t.trancheId) + h.amount > t.amount)
        throw new EngineError(`hold ${h.id} exceeds the unheld part of ${t.trancheId}`);
    } else if (heldOnClaimable(holds, h.beneficiaryId) + h.amount > (claimable.get(h.beneficiaryId) ?? 0n))
      throw new EngineError(`hold ${h.id} exceeds the unheld claimable balance of ${h.beneficiaryId}`);
    holds.set(h.id, {
      beneficiaryId: h.beneficiaryId,
      source: h.source,
      trancheId: h.source === "tranche" ? h.trancheId! : null,
      amount: h.amount,
    });
  }
  for (const r of input.holdReleases ?? []) if (newHoldIds.has(r.holdId)) releaseHold(r.holdId);

  // 1. Identified returns, accrual corrections and claims.
  for (const r of input.returns ?? []) {
    consume(r.id, "return");
    if (r.amount <= 0n) throw new EngineError(`return ${r.id} must be positive`);
    if (r.kind === "pool_cancel") {
      const bal = pools.get(r.poolKey) ?? 0n;
      if (r.amount > bal) throw new EngineError(`return ${r.id} exceeds pool ${r.poolKey}`);
      pools.set(r.poolKey, bal - r.amount);
    } else {
      if (r.kind === "holdback_forfeit") takeHoldback(r.beneficiaryId, r.amount, `return ${r.id}`);
      else debitClaimable(r.beneficiaryId, r.amount, `return ${r.id}`);
      I -= r.amount;
    }
    R += r.amount;
    returned += r.amount;
  }
  for (const c of input.accrualCorrections ?? []) {
    consume(c.id, "accrual correction");
    const bal = pools.get(c.poolKey) ?? 0n;
    const paid = c.recoverFromPaid ?? [];
    if (c.amount < 0n || paid.some((x) => x.amount <= 0n) || c.amount + paid.reduce((t, x) => t + x.amount, 0n) === 0n)
      throw new EngineError(`correction ${c.id} must be positive`);
    if (c.amount > bal)
      throw new EngineError(
        `correction ${c.id}: only ${bal} is still in pool ${c.poolKey}; attribute the already-paid part with recoverFromPaid`,
      );
    pools.set(c.poolKey, bal - c.amount);
    R += c.amount;
    returned += c.amount;
    for (const x of paid) addOffset(x.beneficiaryId, x.amount);
  }
  for (const c of input.claims ?? []) {
    consume(c.id, "claim");
    if (c.amount <= 0n) throw new EngineError(`claim ${c.id} must be positive`);
    debitClaimable(c.beneficiaryId, c.amount, `claim ${c.id}`);
    delivered += c.amount;
  }

  // 2. Confiscations (D39): compensatory; bounty from recovered only.
  for (const c of [...(input.confiscations ?? [])].sort((a, b) => cmp(a.id, b.id))) {
    consume(c.id, "confiscation");
    if (c.holdbackBase < 0n || c.unclaimedBase < 0n || c.provenExcessBase < 0n) throw new EngineError(`negative amounts in ${c.id}`);
    if (c.holdbackBase + c.unclaimedBase > c.provenExcessBase)
      throw new EngineError(
        `confiscation ${c.id} recovers more than the proven excess (compensatory only; punitive forfeiture is a separate holdback_forfeit)`,
      );
    if (c.holdbackBase > 0n) takeHoldback(c.beneficiaryId, c.holdbackBase, `confiscation ${c.id}`);
    if (c.unclaimedBase > 0n) debitClaimable(c.beneficiaryId, c.unclaimedBase, `confiscation ${c.id}`);
    const recovered = c.holdbackBase + c.unclaimedBase;
    I -= recovered;
    const paid = payBounties(c.id, c.bounties, recovered, "recovery_bounty");
    R += recovered - paid;
    returned += recovered - paid;
    I += paid;
    if (c.provenExcessBase > recovered) addOffset(c.beneficiaryId, c.provenExcessBase - recovered);
  }

  // 3. Dispute settlements (review 04 finding 1 / review 05 B7): the excess is recovered from the named owner's
  //    claimable balance or holdback (leaves I, returns to R) or, if already delivered, becomes their offset.
  for (const d of [...(input.disputeSettlements ?? [])].sort((a, b) => cmp(a.id, b.id))) {
    consume(d.id, "dispute settlement");
    let recovered = 0n;
    for (const x of d.recoveries) {
      if (x.amount <= 0n) throw new EngineError(`dispute ${d.id}: a recovery is positive`);
      if (x.from === "claimable") debitClaimable(x.beneficiaryId, x.amount, `dispute ${d.id}`);
      else if (x.from === "holdback") takeHoldback(x.beneficiaryId, x.amount, `dispute ${d.id}`);
      else if (x.from === "delivered") {
        addOffset(x.beneficiaryId, x.amount);
        continue;
      } else throw new EngineError(`dispute ${d.id}: unknown recovery source`);
      recovered += x.amount;
    }
    I -= recovered;
    const paid = payBounties(d.id, d.bounties, recovered, "dispute_bounty");
    R += recovered - paid;
    returned += recovered - paid;
    I += paid;
  }

  // 4. Write-offs: uncollectable offsets become losses absorbed by budgets.
  for (const w of input.writeOffs ?? []) {
    consume(w.id, "write-off");
    const owed = offsets.get(w.beneficiaryId) ?? 0n;
    if (w.amount <= 0n || w.amount > owed) throw new EngineError(`write-off ${w.id} exceeds the outstanding offset`);
    offsets.set(w.beneficiaryId, owed - w.amount);
    lossCarry += w.amount;
  }

  // 5. Issuance (D49): reservation at issuance, in priority order, within the epoch's frozen TASK CAPACITY at its frozen
  //    rate. A task that does not fit is NOT issued (never scaled) and NOT consumed (B8). Each funded task also reserves
  //    its share of the completion and security accrual (B5), released with it if it fails.
  const rate = env.rate;
  const outcomes$ = env.slices.outcomes ?? 0n;
  const completionSlice = env.slices.completion_accrual ?? 0n;
  const securitySlice = env.slices.security_reserve ?? 0n;
  const fundable = env.taskCapacity + outcomes$;
  const ancillaryOf = (iss: TaskIssuance, amount: bigint): Reservation["ancillary"] => {
    if (fundable === 0n) return { pools: [], security: 0n };
    const security = (securitySlice * amount) / fundable;
    const completion = (completionSlice * amount) / fundable;
    const poolLines: { poolKey: string; amount: bigint }[] = [];
    if (iss.kind === "execution" && completion > 0n) {
      const feature = (completion * p.featurePoolsBp) / BP;
      const split = (total: bigint, keys: readonly string[]) => {
        const ks = [...new Set(keys)].sort(cmp);
        if (ks.length === 0 || total === 0n) return;
        for (const [poolKey, a] of largestRemainder(
          total,
          ks.map((key) => ({ key, weight: 1n })),
        ))
          if (a > 0n) poolLines.push({ poolKey, amount: a });
      };
      split(feature, iss.featurePoolKeys);
      split(completion - feature, iss.applicationPoolKeys);
    }
    return { pools: poolLines, security };
  };
  const reservedBySlice = Object.fromEntries(TASK_SLICES.map((k) => [k, 0n])) as Record<TaskSlice, bigint>;
  const funded: string[] = [];
  const unfunded: string[] = [];
  let reservedNow = 0n;
  let drawn = 0n; // what this epoch's budget actually took from R (reservations with ancillary, outcomes, their security)
  const seenTask = new Set<string>();
  for (const iss of input.issuances ?? []) {
    if (!TASK_SLICES.includes(iss.kind)) throw new EngineError(`task ${iss.taskId}: unknown kind ${iss.kind}`);
    if (iss.budgetAcuMicro <= 0n) throw new EngineError(`task ${iss.taskId} needs a positive budget`);
    if (seenTask.has(iss.taskId) || reserved.has(iss.taskId) || isConsumed(`task:${iss.taskId}`))
      throw new EngineError(`task issuance task:${iss.taskId} consumed twice (already issued; a re-issue is a new task id with reissueOf)`);
    if (iss.reissueOf !== undefined) {
      const prev = iss.reissueOf;
      if (prev === iss.taskId || !isConsumed(`task:${prev}`) || reserved.has(prev) || isConsumed(`accept:${prev}`))
        throw new EngineError(`task ${iss.taskId} re-issues ${prev}, which is not an issued, unaccepted task whose reservation has ended`);
      // Review 07: one successor per replaced task (the database's unique reissue_of), also in the engine.
      if (isConsumed(`reissue:${prev}`)) throw new EngineError(`task ${prev} was already re-issued (re-issue the latest generation)`);
    }
    seenTask.add(iss.taskId);
    const amount = budgetToBase(iss.budgetAcuMicro, rate);
    if (amount === 0n || reservedNow + amount > env.taskCapacity) {
      unfunded.push(iss.taskId);
      continue;
    }
    consume(`task:${iss.taskId}`, "task issuance");
    if (iss.reissueOf !== undefined) consume(`reissue:${iss.reissueOf}`, "re-issue");
    const res: Reservation = {
      kind: iss.kind,
      budgetAcuMicro: iss.budgetAcuMicro,
      amount,
      issuedEpoch: input.epochNumber,
      expiresAtEpoch: input.epochNumber + p.budgetExpiryEpochs,
      ancillary: ancillaryOf(iss, amount),
      submittedEpoch: null,
      reviewGraceEpochs: p.reviewGraceEpochs,
      policyVersion: p.holdbackPolicyVersion,
      reissueOf: iss.reissueOf ?? null,
    };
    reservedBySlice[iss.kind] += amount;
    reservedNow += amount;
    R -= reservationTotal(res);
    drawn += reservationTotal(res);
    reserved.set(iss.taskId, res);
    funded.push(iss.taskId);
  }
  const taskCapacity = Object.fromEntries(TASK_SLICES.map((k) => [k, env.slices[k] ?? 0n])) as Record<TaskSlice, bigint>;

  // 6. Submissions (B4): work submitted while its reservation is live keeps it through the review grace.
  for (const s of input.submissions ?? []) {
    consume(`submit:${s.taskId}`, "submission");
    const res = reserved.get(s.taskId);
    if (!res) throw new EngineError(`task ${s.taskId} has no reservation to submit against`);
    if (input.epochNumber >= res.expiresAtEpoch)
      throw new EngineError(`task ${s.taskId} expired at epoch ${res.expiresAtEpoch}; submitted too late`);
    reserved.set(s.taskId, { ...res, submittedEpoch: input.epochNumber });
  }

  // 7. Acceptances (D49): Q -> gross, split by declared shares (largest remainder per task, exact); the task's
  //    ancillary reservation moves into its pools and the security reserve (B5). Only a LIVE reservation is paid (B4).
  let acceptedBase = 0n;
  let queueBonusReturned = 0n;
  const accruals = new Map<string, bigint>();
  let securityAccrual = 0n;
  for (const a of input.acceptances ?? []) {
    consume(`accept:${a.taskId}`, "acceptance");
    const res = reserved.get(a.taskId);
    if (!res) throw new EngineError(`task ${a.taskId} has no reservation (not issued, already accepted, released or expired)`);
    if (input.epochNumber >= reservationExpiry(res))
      throw new EngineError(`task ${a.taskId} expired at epoch ${reservationExpiry(res)}; its reservation is no longer payable`);
    const shareSum = a.shares.reduce((t, x) => t + x.shareBp, 0);
    if (shareSum !== 10_000 || a.shares.some((x) => !Number.isInteger(x.shareBp) || x.shareBp <= 0))
      throw new EngineError(`declared shares of ${a.taskId} must be positive and sum to 10000`);
    const accounts = a.shares.map((x) => x.accountId);
    if (new Set(accounts).size !== accounts.length) throw new EngineError(`duplicate share line in ${a.taskId} (one line per contributor)`);
    reserved.delete(a.taskId);
    // D63: without the queue bonus a task is paid its base price; the bonus portion of the reservation returns to R.
    if (a.claim?.bonusApplies && a.claim.mode !== "queue") throw new EngineError(`${a.taskId}: only a queue claim earns the queue bonus`);
    const paid = a.claim && !a.claim.bonusApplies ? queueBasePrice(res.amount, a.claim.queueBonusBp) : res.amount;
    R += res.amount - paid;
    returned += res.amount - paid;
    queueBonusReturned += res.amount - paid;
    acceptedBase += paid;
    for (const x of res.ancillary.pools) {
      pools.set(x.poolKey, (pools.get(x.poolKey) ?? 0n) + x.amount);
      accruals.set(x.poolKey, (accruals.get(x.poolKey) ?? 0n) + x.amount);
    }
    S += res.ancillary.security;
    securityAccrual += res.ancillary.security;
    // R06-3: the one shared split (canonical key: the contributor's account id), as the allocation rule.
    const split = splitTaskReservation(
      paid,
      a.shares.map((x) => ({ accountId: x.accountId, shareBp: x.shareBp })),
    );
    a.shares.forEach((x) => {
      const amount = split.get(x.accountId)?.total ?? 0n;
      allocations.push({
        beneficiaryId: x.beneficiaryId,
        accountId: x.accountId,
        receiptId: a.taskId,
        slice: res.kind,
        poolKey: null,
        component: null,
        weightMicro: (res.budgetAcuMicro * BigInt(x.shareBp)) / BP,
        amountBase: amount,
      });
      addGross(gross, x.beneficiaryId, amount);
    });
  }

  // 8. Releases and expiry (D49): Q -> R, the ancillary reservation included (B5).
  let releasedBase = 0n;
  const expired: string[] = [];
  const giveBack = (res: Reservation) => {
    const t = reservationTotal(res);
    R += t;
    returned += t;
    releasedBase += res.amount;
  };
  for (const r of input.releases ?? []) {
    consume(`release:${r.taskId}`, "release");
    const res = reserved.get(r.taskId);
    if (!res) throw new EngineError(`task ${r.taskId} has no reservation to release`);
    reserved.delete(r.taskId);
    giveBack(res);
  }
  for (const [taskId, res] of [...reserved].sort((a, b) => cmp(a[0], b[0]))) {
    if (input.epochNumber >= reservationExpiry(res)) {
      reserved.delete(taskId);
      giveBack(res);
      expired.push(taskId);
    }
  }

  // 9. Outcomes slice: weights compete, at most `rate` per ACU-equivalent; exact share numerators per beneficiary.
  //    Accepted outcomes fund their share of the security reserve directly (they are already accepted).
  const outW = receipts.reduce((t, r) => t + r.weightMicro, 0n);
  const outCap = (outW * rate) / MICRO;
  const outcomesEmitted = outW === 0n ? 0n : outcomes$ < outCap ? outcomes$ : outCap;
  R -= outcomesEmitted;
  drawn += outcomesEmitted;
  if (outcomesEmitted > 0n && fundable > 0n) {
    const sec = (securitySlice * outcomesEmitted) / fundable;
    R -= sec;
    drawn += sec;
    S += sec;
    securityAccrual += sec;
  }
  if (outcomesEmitted > 0n) {
    const lines = new Map<string, { receipt: EngineReceipt; num: bigint }[]>();
    for (const r of receipts)
      for (const x of beneficiariesOf(r))
        lines.set(x.beneficiaryId, [...(lines.get(x.beneficiaryId) ?? []), { receipt: r, num: r.weightMicro * BigInt(x.shareBp) }]);
    const byBeneficiary = largestRemainder(
      outcomesEmitted,
      [...lines].map(([key, ls]) => ({ key, weight: ls.reduce((t, l) => t + l.num, 0n) })),
    );
    for (const [b, amount] of byBeneficiary) {
      const ls = lines.get(b)!;
      const perLine =
        ls.reduce((t, l) => t + l.num, 0n) === 0n
          ? new Map(ls.map((l) => [l.receipt.receiptId, 0n]))
          : largestRemainder(
              amount,
              ls.map((l) => ({ key: l.receipt.receiptId, weight: l.num })),
            );
      for (const l of ls)
        allocations.push({
          beneficiaryId: b,
          accountId: l.receipt.accountId,
          receiptId: l.receipt.receiptId,
          slice: "outcomes",
          poolKey: null,
          component: null,
          weightMicro: l.num / BP,
          amountBase: perLine.get(l.receipt.receiptId) ?? 0n,
        });
      addGross(gross, b, amount);
    }
  }
  // The part of the epoch's budget nothing drew stays in R (reported as returned, for comparability).
  returned += env.budget - drawn;

  // 10. Completion pool payouts (application pools pay 100% by lifetime weight).
  for (const payout of [...(input.poolPayouts ?? [])].sort((a, b) => cmp(a.poolKey, b.poolKey))) {
    consume(payout.id, "pool payout");
    const bal = pools.get(payout.poolKey) ?? 0n;
    if (bal === 0n) continue;
    pools.set(payout.poolKey, 0n);
    const components: [string, bigint][] =
      payout.kind === "application"
        ? [["lifetime", bal]]
        : [
            ...largestRemainder(
              bal,
              Object.entries(p.completionComponentsBp).map(([key, weight]) => ({ key, weight })),
            ),
          ];
    for (const b of payout.beneficiaries) {
      if ((payout.kind === "application") !== (b.component === "lifetime"))
        throw new EngineError(`pool ${payout.poolKey}: component ${b.component} does not fit a ${payout.kind} pool`);
    }
    for (const [component, amount] of components) {
      if (amount === 0n) continue;
      const bw = new Map<string, bigint>();
      for (const b of payout.beneficiaries)
        if (b.component === component) bw.set(b.beneficiaryId, (bw.get(b.beneficiaryId) ?? 0n) + b.weight);
      if (bw.size === 0 || sumMap(bw) === 0n) {
        R += amount;
        returned += amount;
        continue;
      }
      for (const [b, a] of largestRemainder(
        amount,
        [...bw].map(([key, weight]) => ({ key, weight })),
      )) {
        if (a === 0n) continue;
        allocations.push({
          beneficiaryId: b,
          accountId: null,
          receiptId: null,
          slice: "completion_payout",
          poolKey: payout.poolKey,
          component,
          weightMicro: bw.get(b)!,
          amountBase: a,
        });
        addGross(gross, b, a);
      }
    }
  }

  // 11. Security payouts: weight x the issuance rate, each capped at a share of the security reserve.
  for (const sp of [...(input.securityPayouts ?? [])].sort((a, b) => cmp(a.id, b.id))) {
    consume(sp.id, "security payout");
    consume(`security-receipt:${sp.receiptId}`, "security receipt");
    const want = (sp.weightMicro * rate) / MICRO;
    const maxNow = (S * p.securityMaxShareOfReserveBp) / BP;
    const pay = want < maxNow ? want : maxNow;
    if (pay === 0n) continue;
    S -= pay;
    allocations.push({
      beneficiaryId: sp.beneficiaryId,
      accountId: null,
      receiptId: sp.receiptId,
      slice: "security_payout",
      poolKey: null,
      component: null,
      weightMicro: sp.weightMicro,
      amountBase: pay,
    });
    addGross(gross, sp.beneficiaryId, pay);
  }

  // 12. Offsets recovered from this epoch's gross; holdback split; mature tranches released.
  const entitlements = new Map<string, Entitlement>();
  const keys = [...new Set([...gross.keys(), ...bountyGross.keys(), ...tranches.map((t) => t.beneficiaryId)])].sort(cmp);
  const matured = new Map<string, bigint>();
  // R06-7: a mature tranche releases only its UNHELD units; the held remainder stays (same tranche id) until its hold is
  // released, then matures in a later epoch — the database's numbered partial releases (R04-2).
  tranches = tranches.filter((t) => {
    if (t.maturesAtEpoch <= input.epochNumber) {
      const heldPart = heldOnTranche(holds, t.trancheId);
      const free = t.amount - heldPart;
      if (free > 0n) addGross(matured, t.beneficiaryId, free);
      t.amount = heldPart;
      return heldPart > 0n;
    }
    return true;
  });
  for (const b of keys) {
    const g = gross.get(b) ?? 0n;
    const owed = offsets.get(b) ?? 0n;
    const limit = (g * p.maxOffsetRecoveryBp) / BP;
    const rec = owed < limit ? owed : limit;
    if (rec > 0n) {
      offsets.set(b, owed - rec);
      R += rec;
      returned += rec;
    }
    const net = g - rec;
    const held = (net * p.holdbackBp) / BP;
    if (held > 0n)
      tranches.push({
        trancheId: `${input.epochNumber}:${b}`,
        beneficiaryId: b,
        epochNumber: input.epochNumber,
        amount: held,
        maturesAtEpoch: input.epochNumber + p.holdbackEpochs,
        policyVersion: p.holdbackPolicyVersion,
      });
    I += net;
    const bounty = bountyGross.get(b) ?? 0n;
    const nowClaimable = net - held + bounty + (matured.get(b) ?? 0n);
    if (nowClaimable > 0n) claimable.set(b, (claimable.get(b) ?? 0n) + nowClaimable);
    entitlements.set(b, {
      beneficiaryId: b,
      gross: g + bounty,
      offsetRecovered: rec,
      releasedNow: net - held + bounty,
      heldBack: held,
      maturedHoldback: matured.get(b) ?? 0n,
    });
  }
  for (const [k, v] of [...offsets]) if (v === 0n) offsets.delete(k);
  for (const [k, v] of [...claimable]) if (v === 0n) claimable.delete(k);
  for (const [k, v] of [...pools]) if (v === 0n) pools.delete(k);

  allocations.sort(
    (a, b) =>
      cmp(a.beneficiaryId, b.beneficiaryId) ||
      cmp(a.slice, b.slice) ||
      cmp(a.receiptId ?? "", b.receiptId ?? "") ||
      cmp(a.accountId ?? "", b.accountId ?? "") ||
      cmp(a.poolKey ?? "", b.poolKey ?? ""),
  );
  const state: EngineState = {
    remainingReserve: R,
    poolBalances: pools,
    securityReserve: S,
    reserved,
    cumulativeIssued: I,
    holdback: tranches,
    claimable,
    offsets,
    lossCarry,
    delivered,
    holds,
    lastEpoch: input.epochNumber,
  };
  assertConserved(p.emissionReserve, state);
  return {
    epochNumber: input.epochNumber,
    envelope: env,
    budget: env.budget,
    absorbedLoss: env.absorbedLoss,
    rateCeilingBasePerAcu: rate,
    slices: env.slices,
    taskCapacity,
    reservedBySlice,
    funded,
    unfunded,
    acceptedBase,
    queueBonusReturnedBase: queueBonusReturned,
    releasedBase,
    expired,
    outcomesEmitted,
    returnedToReserve: returned,
    accruals,
    securityAccrual,
    allocations,
    entitlements,
    consumedIds: consumed,
    state,
  };
}

/** Builds engine parameters from the V1 policy documents' numbers. */
export function engineParamsFrom(
  reward: {
    policyVersion: string;
    emission: {
      emissionReserveBase: string;
      budgetPpmOfRemaining: number;
      rateCeiling: { initialBasePerAcu: string; decayPpmPerEpoch: number };
    };
    slicesBp: Record<TaskSlice | "outcomes" | "completion_accrual" | "security_reserve", number>;
    completion: { featurePoolsBp: number; applicationPoolsBp: number };
    security: { maxShareOfReserveBp: number };
    settlement: { maxOffsetRecoveryBp: number };
    holdback: { shareBp: number; epochs: number };
    budgets: { expiryEpochs: number; reviewGraceEpochs: number };
    losses: { bountyBpOfRecovered: number; absorptionMaxBp: number };
  },
  completion: { feature: Record<"implementersBp" | "contractAuthorsBp" | "roadmapAuthorsBp" | "reviewersBp" | "finderBp", number> },
): EngineParams {
  return {
    emissionReserve: BigInt(reward.emission.emissionReserveBase),
    budgetPpm: BigInt(reward.emission.budgetPpmOfRemaining),
    rateCeilingInitialBasePerAcu: BigInt(reward.emission.rateCeiling.initialBasePerAcu),
    rateCeilingDecayPpm: BigInt(reward.emission.rateCeiling.decayPpmPerEpoch),
    slicesBp: {
      execution: BigInt(reward.slicesBp.execution),
      planning: BigInt(reward.slicesBp.planning),
      human_review: BigInt(reward.slicesBp.human_review),
      outcomes: BigInt(reward.slicesBp.outcomes),
      completion_accrual: BigInt(reward.slicesBp.completion_accrual),
      security_reserve: BigInt(reward.slicesBp.security_reserve),
    },
    featurePoolsBp: BigInt(reward.completion.featurePoolsBp),
    applicationPoolsBp: BigInt(reward.completion.applicationPoolsBp),
    completionComponentsBp: {
      implementers: BigInt(completion.feature.implementersBp),
      contractAuthors: BigInt(completion.feature.contractAuthorsBp),
      roadmapAuthors: BigInt(completion.feature.roadmapAuthorsBp),
      reviewers: BigInt(completion.feature.reviewersBp),
      finder: BigInt(completion.feature.finderBp),
    },
    securityMaxShareOfReserveBp: BigInt(reward.security.maxShareOfReserveBp),
    maxOffsetRecoveryBp: BigInt(reward.settlement.maxOffsetRecoveryBp),
    holdbackBp: BigInt(reward.holdback.shareBp),
    holdbackEpochs: reward.holdback.epochs,
    holdbackPolicyVersion: reward.policyVersion,
    budgetExpiryEpochs: reward.budgets.expiryEpochs,
    reviewGraceEpochs: reward.budgets.reviewGraceEpochs,
    bountyBpOfRecovered: BigInt(reward.losses.bountyBpOfRecovered),
    lossAbsorptionMaxBp: BigInt(reward.losses.absorptionMaxBp),
  };
}

// ------------------------------------------------------------------------------------------------ anomaly metrics (D29)

/**
 * D49: anomaly metrics now compare each accepted task's BUDGET with the peer budgets of comparable tasks (same task
 * kind, class and size points) — the budget-inflation signal — and, where available, with the task's observed usage
 * telemetry. `weightMicro` is the task budget; `capMicro` the model budget (deviation cap); `peerP50Micro` the peer median.
 */
export interface AnomalyReceipt {
  receiptId: string;
  accountId: string;
  weightMicro: bigint;
  capMicro: bigint;
  /** Peer P50 of budgets for the task's comparable key (task kind, class, size points). */
  peerP50Micro: bigint;
  changedLines: number | null;
  peerP50MicroPerLine: bigint | null;
}

export interface AnomalyRow {
  accountId: string;
  receipts: number;
  medianPeerRatioBp: number;
  capSaturationBp: number;
  aboveP50ShareBp: number;
  consistencyMilli: number;
  perLinePeerRatioBp: number | null;
  rankScore: number;
}

function ratioBp(num: bigint, den: bigint): number {
  if (den <= 0n) return 0;
  return Number((num * BP) / den);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.floor((s[m - 1]! + s[m]!) / 2);
}

/** Integer square root (floor) for the sign-test statistic, so every output is an exact integer. */
function isqrt(n: number): number {
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/**
 * Deterministic anomaly metrics per account (integers only, reproducible). rankScore puts the strongest evidence of
 * consistent budget inflation first (D49): budgets +10% above peers on 40 tasks give consistency ~ +6.3 (sign test)
 * even though no single budget stands out; a single 3x budget stands out on medianPeerRatioBp and capSaturationBp.
 */
export function anomalyMetrics(receipts: readonly AnomalyReceipt[]): AnomalyRow[] {
  const by = new Map<string, AnomalyReceipt[]>();
  for (const r of receipts) by.set(r.accountId, [...(by.get(r.accountId) ?? []), r]);
  const rows: AnomalyRow[] = [];
  for (const [accountId, rs] of [...by].sort((a, b) => cmp(a[0], b[0]))) {
    const ratios = rs.map((r) => ratioBp(r.weightMicro, r.peerP50Micro));
    const n = rs.length;
    const saturated = rs.filter((r) => r.capMicro > 0n && r.weightMicro * 100n >= r.capMicro * 95n).length;
    const above = ratios.filter((x) => x > 10_000).length;
    const below = ratios.filter((x) => x < 10_000).length;
    // Sign test: (above - below) / sqrt(n), x1000, integer.
    const consistencyMilli = n === 0 ? 0 : Math.trunc(((above - below) * 1000 * 1000) / (isqrt(n * 1_000_000) || 1));
    const perLine = rs.filter((r) => r.changedLines && r.changedLines > 0 && r.peerP50MicroPerLine && r.peerP50MicroPerLine > 0n);
    const perLineRatio =
      perLine.length === 0 ? null : median(perLine.map((r) => ratioBp(r.weightMicro / BigInt(r.changedLines!), r.peerP50MicroPerLine!)));
    const med = median(ratios);
    const capSaturationBp = n === 0 ? 0 : Math.floor((saturated * 10_000) / n);
    const aboveP50ShareBp = n === 0 ? 0 : Math.floor((above * 10_000) / n);
    // Rank: consistency dominates (skims), then how far above typical the median is, then cap saturation.
    const rankScore = Math.max(0, consistencyMilli) * 10 + Math.max(0, med - 10_000) + Math.floor(capSaturationBp / 2);
    rows.push({
      accountId,
      receipts: n,
      medianPeerRatioBp: med,
      capSaturationBp,
      aboveP50ShareBp,
      consistencyMilli,
      perLinePeerRatioBp: perLineRatio,
      rankScore,
    });
  }
  return rows.sort((a, b) => b.rankScore - a.rankScore || cmp(a.accountId, b.accountId));
}

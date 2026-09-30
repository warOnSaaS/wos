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

/** min(observed, cap): the execution-stop check on telemetry (D49: usage never sets a payout). */
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
  /** D49: an issued task not accepted within this many epochs is released (Q -> R) and must be re-priced to re-issue. */
  budgetExpiryEpochs: number;
  /** Bounties are this share of amounts actually RECOVERED (D41). */
  bountyBpOfRecovered: bigint;
  /** At most this share of an epoch's budget absorbs unrecovered losses (D41); the rest carries forward. */
  lossAbsorptionMaxBp: bigint;
}

export interface HoldbackTranche {
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

export interface EpochInput {
  epochNumber: number;
  state: EngineState;
  /** Ids consumed by earlier epochs (replay state, REQUIRED); the database enforces the same with unique keys. */
  consumedIds: ReadonlySet<string>;
  /**
   * D49: the published demand forecast (micro-ACU of task budgets requested last epoch). The issuance rate is
   * min(rate ceiling, task capacity / forecast), announced before issuance and fixed per task: it falls ex ante with
   * participation, so the capacity is used without ever scaling an accepted budget afterwards.
   */
  demandForecastAcuMicro?: bigint;
  /** D49: tasks to issue this epoch, in priority order; those that do not fit the pooled task capacity are returned as unfunded. */
  issuances?: readonly TaskIssuance[];
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
  /** Clipped/revoked allocations whose excess was escrowed (never released): recovered in full. */
  disputeSettlements?: ReadonlyArray<{ id: string; excessBase: bigint; bounties: readonly Bounty[] }>;
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
  for (const v of m.values()) s += v.amount;
  return s;
}

/** Equality AND non-negative balances AND claimable + holdback within issuance. Throws on any violation. */
export function assertConserved(emissionReserve: bigint, s: EngineState): void {
  if (s.remainingReserve < 0n) throw new EngineError(`negative reserve ${s.remainingReserve}`);
  if (s.securityReserve < 0n) throw new EngineError(`negative security reserve ${s.securityReserve}`);
  if (s.cumulativeIssued < 0n) throw new EngineError(`negative issuance ${s.cumulativeIssued}`);
  if (s.lossCarry < 0n) throw new EngineError("negative loss carry");
  for (const [k, v] of s.poolBalances) if (v < 0n) throw new EngineError(`negative pool ${k}`);
  for (const [k, v] of s.offsets) if (v < 0n) throw new EngineError(`negative offset ${k}`);
  for (const [k, v] of s.reserved) if (v.amount < 0n) throw new EngineError(`negative reservation ${k}`);
  for (const [k, v] of s.claimable) if (v < 0n) throw new EngineError(`negative claimable balance ${k}`);
  let held = 0n;
  for (const t of s.holdback) {
    if (t.amount < 0n) throw new EngineError(`negative holdback for ${t.beneficiaryId}`);
    held += t.amount;
  }
  if (held + sumMap(s.claimable) > s.cumulativeIssued) throw new EngineError("holdback and claimable balances exceed issuance");
  const total = s.remainingReserve + sumMap(s.poolBalances) + s.securityReserve + reservedTotal(s.reserved) + s.cumulativeIssued;
  if (total !== emissionReserve) throw new EngineError(`funding equation broken: ${total} != ${emissionReserve}`);
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
  };
}

/** D49: the base units a budget reserves at issuance: floor(budget micro-ACU x rate / 1e6). */
export function budgetToBase(budgetAcuMicro: bigint, ratePerAcu: bigint): bigint {
  return (budgetAcuMicro * ratePerAcu) / MICRO;
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
  const sliceBpSum = Object.values(p.slicesBp).reduce((s, v) => s + v, 0n);
  if (sliceBpSum !== BP) throw new EngineError(`slices must sum to 10000 bp, got ${sliceBpSum}`);
  if (p.featurePoolsBp + p.applicationPoolsBp !== BP) throw new EngineError("completion split must sum to 10000 bp");
  const compSum = Object.values(p.completionComponentsBp).reduce((s, v) => s + v, 0n);
  if (compSum !== BP) throw new EngineError("completion components must sum to 10000 bp");
  assertConserved(p.emissionReserve, input.state);

  const consumed: string[] = [];
  const seen = new Set<string>();
  const consume = (id: string, what: string) => {
    if (seen.has(id) || input.consumedIds.has(id)) throw new EngineError(`${what} ${id} consumed twice`);
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
  let tranches = input.state.holdback.map((t) => ({ ...t }));
  const claimable = new Map(input.state.claimable);
  const offsets = new Map(input.state.offsets);
  let lossCarry = input.state.lossCarry;
  let returned = 0n;
  const gross = new Map<string, bigint>();
  const bountyGross = new Map<string, bigint>();
  const allocations: AllocationLine[] = [];
  const addGross = (m: Map<string, bigint>, b: string, a: bigint) => m.set(b, (m.get(b) ?? 0n) + a);
  const debitClaimable = (beneficiaryId: string, amount: bigint, why: string) => {
    const have = claimable.get(beneficiaryId) ?? 0n;
    if (amount > have) throw new EngineError(`${why}: ${beneficiaryId} has only ${have} claimable, not ${amount}`);
    claimable.set(beneficiaryId, have - amount);
  };
  const takeHoldback = (beneficiaryId: string, amount: bigint, why: string) => {
    let need = amount;
    const mine = tranches.filter((t) => t.beneficiaryId === beneficiaryId).sort((a, b) => a.epochNumber - b.epochNumber);
    for (const t of mine) {
      const take = t.amount < need ? t.amount : need;
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
      if (r.amount > I) throw new EngineError(`return ${r.id} exceeds issuance`);
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
    for (const x of paid) offsets.set(x.beneficiaryId, (offsets.get(x.beneficiaryId) ?? 0n) + x.amount);
  }
  for (const c of input.claims ?? []) {
    consume(c.id, "claim");
    if (c.amount <= 0n) throw new EngineError(`claim ${c.id} must be positive`);
    debitClaimable(c.beneficiaryId, c.amount, `claim ${c.id}`);
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
    if (recovered > I) throw new EngineError(`confiscation ${c.id} exceeds issuance`);
    I -= recovered;
    const paid = payBounties(c.id, c.bounties, recovered, "recovery_bounty");
    R += recovered - paid;
    returned += recovered - paid;
    I += paid;
    if (c.provenExcessBase > recovered)
      offsets.set(c.beneficiaryId, (offsets.get(c.beneficiaryId) ?? 0n) + (c.provenExcessBase - recovered));
  }

  // 3. Dispute settlements: escrowed excess leaves I; bounty from it; the rest returns to R.
  for (const d of [...(input.disputeSettlements ?? [])].sort((a, b) => cmp(a.id, b.id))) {
    consume(d.id, "dispute settlement");
    if (d.excessBase < 0n || d.excessBase > I) throw new EngineError(`dispute ${d.id} excess out of range`);
    I -= d.excessBase;
    const paid = payBounties(d.id, d.bounties, d.excessBase, "dispute_bounty");
    R += d.excessBase - paid;
    returned += d.excessBase - paid;
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

  // 5. Acceptances (D49): Q -> gross, split by declared shares (largest remainder per task, exact).
  let acceptedBase = 0n;
  for (const a of input.acceptances ?? []) {
    consume(`accept:${a.taskId}`, "acceptance");
    const res = reserved.get(a.taskId);
    if (!res) throw new EngineError(`task ${a.taskId} has no reservation (not issued, already accepted, released or expired)`);
    const shareSum = a.shares.reduce((t, x) => t + x.shareBp, 0);
    if (shareSum !== 10_000 || a.shares.some((x) => !Number.isInteger(x.shareBp) || x.shareBp <= 0))
      throw new EngineError(`declared shares of ${a.taskId} must be positive and sum to 10000`);
    const keys = a.shares.map((x) => `${x.beneficiaryId}\u0000${x.accountId}`);
    if (new Set(keys).size !== keys.length) throw new EngineError(`duplicate share line in ${a.taskId}`);
    reserved.delete(a.taskId);
    acceptedBase += res.amount;
    const split = largestRemainder(
      res.amount,
      a.shares.map((x, i) => ({ key: keys[i]!, weight: BigInt(x.shareBp) })),
    );
    a.shares.forEach((x, i) => {
      const amount = split.get(keys[i]!) ?? 0n;
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

  // 6. Releases and expiry (D49): Q -> R.
  let releasedBase = 0n;
  const expired: string[] = [];
  for (const r of input.releases ?? []) {
    consume(`release:${r.taskId}`, "release");
    const res = reserved.get(r.taskId);
    if (!res) throw new EngineError(`task ${r.taskId} has no reservation to release`);
    reserved.delete(r.taskId);
    R += res.amount;
    returned += res.amount;
    releasedBase += res.amount;
  }
  for (const [taskId, res] of [...reserved].sort((a, b) => cmp(a[0], b[0]))) {
    if (res.expiresAtEpoch <= input.epochNumber) {
      reserved.delete(taskId);
      R += res.amount;
      returned += res.amount;
      releasedBase += res.amount;
      expired.push(taskId);
    }
  }

  // 7. Budget, minus the bounded loss absorption (D41).
  const fullBudget = epochBudget(R, p.budgetPpm);
  const absorbCap = (fullBudget * p.lossAbsorptionMaxBp) / BP;
  const absorbedLoss = lossCarry < absorbCap ? lossCarry : absorbCap;
  lossCarry -= absorbedLoss;
  const budget = fullBudget - absorbedLoss;
  const slices = Object.fromEntries(
    largestRemainder(
      budget,
      Object.entries(p.slicesBp).map(([key, weight]) => ({ key, weight })),
    ),
  ) as Record<string, bigint>;
  const ceiling = rateCeiling(p.rateCeilingInitialBasePerAcu, p.rateCeilingDecayPpm, input.epochNumber);
  const capacityAll = TASK_SLICES.reduce((t, k) => t + (slices[k] ?? 0n), 0n);
  const forecast = input.demandForecastAcuMicro ?? 0n;
  if (forecast < 0n) throw new EngineError("negative demand forecast");
  const byDemand = forecast > 0n ? (capacityAll * MICRO) / forecast : ceiling;
  const rate = byDemand < ceiling ? byDemand : ceiling;

  // 8. Issuance (D49): reservation at issuance, in priority order, within the epoch's TASK CAPACITY (the execution,
  //    planning and human-review slices pooled, so one ACU of budget costs the same whatever the task kind). A task
  //    that does not fit is NOT issued (never scaled). Unused capacity simply stays in R.
  const taskCapacity = Object.fromEntries(TASK_SLICES.map((k) => [k, slices[k] ?? 0n])) as Record<TaskSlice, bigint>;
  const reservedBySlice = Object.fromEntries(TASK_SLICES.map((k) => [k, 0n])) as Record<TaskSlice, bigint>;
  const funded: string[] = [];
  const unfunded: string[] = [];
  let reservedTotal$ = 0n;
  const fundedIssuances: { iss: TaskIssuance; amount: bigint }[] = [];
  for (const iss of input.issuances ?? []) {
    consume(`task:${iss.taskId}`, "task issuance");
    if (!TASK_SLICES.includes(iss.kind)) throw new EngineError(`task ${iss.taskId}: unknown kind ${iss.kind}`);
    if (iss.budgetAcuMicro <= 0n) throw new EngineError(`task ${iss.taskId} needs a positive budget`);
    const amount = budgetToBase(iss.budgetAcuMicro, rate);
    if (amount === 0n || reservedTotal$ + amount > capacityAll) {
      unfunded.push(iss.taskId);
      continue;
    }
    reservedBySlice[iss.kind] += amount;
    reservedTotal$ += amount;
    R -= amount;
    reserved.set(iss.taskId, {
      kind: iss.kind,
      budgetAcuMicro: iss.budgetAcuMicro,
      amount,
      issuedEpoch: input.epochNumber,
      expiresAtEpoch: input.epochNumber + p.budgetExpiryEpochs,
    });
    funded.push(iss.taskId);
    fundedIssuances.push({ iss, amount });
  }
  const capacityTotal = TASK_SLICES.reduce((t, k) => t + taskCapacity[k], 0n);
  const reservedNow = TASK_SLICES.reduce((t, k) => t + reservedBySlice[k], 0n);
  returned += capacityTotal - reservedNow; // not taken from R: reported as returned for comparability

  // 9. Outcomes slice: weights compete, at most `rate` per ACU-equivalent; exact share numerators per beneficiary.
  const outcomes$ = slices.outcomes ?? 0n;
  R -= outcomes$;
  const outW = receipts.reduce((t, r) => t + r.weightMicro, 0n);
  const outCap = (outW * rate) / MICRO;
  const outcomesEmitted = outW === 0n ? 0n : outcomes$ < outCap ? outcomes$ : outCap;
  R += outcomes$ - outcomesEmitted;
  returned += outcomes$ - outcomesEmitted;
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

  // 10. Accrual slices scale with utilisation of the funded slices; attributed to the pools of tasks issued now.
  const accruals = new Map<string, bigint>();
  const fundable = capacityTotal + outcomes$;
  const used = reservedNow + outcomesEmitted;
  const scale = (x: bigint) => (fundable === 0n ? 0n : (x * used) / fundable);
  const completionSlice = slices.completion_accrual ?? 0n;
  const securitySlice = slices.security_reserve ?? 0n;
  const completion$ = scale(completionSlice);
  const security$ = scale(securitySlice);
  R -= completion$ + security$;
  returned += completionSlice - completion$ + (securitySlice - security$);
  let securityAccrual = 0n;
  if (used > 0n) {
    const feature$ = (completion$ * p.featurePoolsBp) / BP;
    const accrue = (amount: bigint, keysOf: (i: TaskIssuance) => readonly string[]) => {
      const kw = new Map<string, bigint>();
      for (const { iss, amount: a } of fundedIssuances) {
        if (iss.kind !== "execution") continue;
        const keys = [...new Set(keysOf(iss))];
        if (keys.length === 0) continue;
        const each = (a * SHARE_SCALE) / BigInt(keys.length);
        for (const k of keys) kw.set(k, (kw.get(k) ?? 0n) + each);
      }
      if (kw.size === 0 || sumMap(kw) === 0n) {
        R += amount;
        returned += amount;
        return;
      }
      for (const [k, v] of largestRemainder(
        amount,
        [...kw].map(([key, weight]) => ({ key, weight })),
      )) {
        accruals.set(k, (accruals.get(k) ?? 0n) + v);
        pools.set(k, (pools.get(k) ?? 0n) + v);
      }
    };
    accrue(feature$, (i) => i.featurePoolKeys);
    accrue(completion$ - feature$, (i) => i.applicationPoolKeys);
    S += security$;
    securityAccrual = security$;
  } else {
    R += completion$ + security$;
  }

  // 11. Completion pool payouts (application pools pay 100% by lifetime weight).
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

  // 12. Security payouts: weight x the issuance rate, each capped at a share of the security reserve.
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

  // 13. Offsets recovered from this epoch's gross; holdback split; mature tranches released.
  const entitlements = new Map<string, Entitlement>();
  const keys = [...new Set([...gross.keys(), ...bountyGross.keys(), ...tranches.map((t) => t.beneficiaryId)])].sort(cmp);
  const matured = new Map<string, bigint>();
  tranches = tranches.filter((t) => {
    if (t.maturesAtEpoch <= input.epochNumber) {
      addGross(matured, t.beneficiaryId, t.amount);
      return false;
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
  };
  assertConserved(p.emissionReserve, state);
  return {
    epochNumber: input.epochNumber,
    budget,
    absorbedLoss,
    rateCeilingBasePerAcu: rate,
    slices,
    taskCapacity,
    reservedBySlice,
    funded,
    unfunded,
    acceptedBase,
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
    budgets: { expiryEpochs: number };
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

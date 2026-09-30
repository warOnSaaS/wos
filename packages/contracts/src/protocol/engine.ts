/**
 * DRAFT — the deterministic reward engine reference (docs/protocol/REWARD-PROTOCOL.md sections 5–8).
 *
 * Pure, integer-only (bigint), no clock, no I/O. Given the same inputs it returns byte-identical outputs, so anyone
 * can reproduce an epoch from the published receipts, pools and policy. The rewards package will call this code
 * (it must not carry its own copy of the math), and tools/tokenomics-sim uses it for every simulated epoch.
 *
 * The conserved funding equation (Astra-01 item 4). With R = remaining emission reserve, P = sum of completion pool
 * balances, S = security reserve balance, I = cumulative net issuance to accounts:
 *
 *     R + P + S + I = emissionReserve              (holds after every epoch; checked by `assertConserved`)
 *
 * Each epoch: B = floor(R x budgetPpm / 1e6) is split into slices by basis points (largest remainder). Distributing
 * slices emit min(slice, rateCeiling x weight) and RETURN the rest to R. Accrual slices move into P and S (or return
 * to R when there is nothing to accrue to). Pool and security payouts debit P and S. Offsets recovered from an
 * account's gross allocation return to R. Returned unclaimed or cancelled amounts are credited to R by the caller.
 */
import type { DistributingSlice } from "./entities.js";

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
 * Same semantics as @waronsaas/rewards allocatePool, in bigint.
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

/** micro-ACU of a run: floor(sum(tokens x micro-ACU-per-million) / 1e6). Categories are mutually exclusive. */
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

/** Eligible weight of an execution contribution: min(attested, cap). Reward clipping, enforceable server-side. */
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

// ------------------------------------------------------------------------------------------------ epoch

export interface EngineParams {
  budgetPpm: bigint;
  rateCeilingInitialBasePerAcu: bigint;
  rateCeilingDecayPpm: bigint;
  slicesBp: Record<DistributingSlice | "completion_accrual" | "security_reserve", bigint>;
  featurePoolsBp: bigint;
  applicationPoolsBp: bigint;
  completionComponentsBp: Record<"implementers" | "contractAuthors" | "roadmapAuthors" | "reviewers" | "finder", bigint>;
  securityMaxShareOfReserveBp: bigint;
  maxOffsetRecoveryBp: bigint;
}

export interface EngineReceipt {
  receiptId: string;
  accountId: string;
  slice: DistributingSlice;
  weightMicro: bigint;
  /** Completion accrual keys (execution receipts only): per-(target, feature) pools and per-target pools. */
  featurePoolKeys: readonly string[];
  applicationPoolKeys: readonly string[];
}

export interface PoolPayout {
  poolKey: string;
  beneficiaries: ReadonlyArray<{ accountId: string; component: keyof EngineParams["completionComponentsBp"]; weight: bigint }>;
}

export interface EpochInput {
  epochNumber: number;
  remainingReserve: bigint;
  poolBalances: ReadonlyMap<string, bigint>;
  securityReserve: bigint;
  cumulativeIssued: bigint;
  /** Unclaimed (unbound-wallet expiry) and cancelled-pool amounts returned to R at the start of this epoch. */
  returnsToReserve: bigint;
  receipts: readonly EngineReceipt[];
  poolPayouts: readonly PoolPayout[];
  securityPayouts: ReadonlyArray<{ receiptId: string; accountId: string; weightMicro: bigint }>;
  /** Outstanding offsets (post-finalization reversals) per account, recovered from gross allocations. */
  offsets: ReadonlyMap<string, bigint>;
  /**
   * Dispute settlements resolved since the last epoch (D28–D30). `excessBase` was escrowed (counted in I but never
   * paid): it leaves I; the bounty goes to the disputer as a `dispute_bounty` line; the rest returns to R.
   */
  disputeSettlements?: ReadonlyArray<{
    disputeId: string;
    excessBase: bigint;
    bounties: ReadonlyArray<{ accountId: string; amountBase: bigint }>;
  }>;
}

export interface AllocationLine {
  accountId: string;
  /** Distributing-slice lines are per receipt (disputable one by one); payout lines have none. */
  receiptId: string | null;
  slice: DistributingSlice | "completion_payout" | "security_payout" | "dispute_bounty";
  weightMicro: bigint;
  amountBase: bigint;
}

export interface EpochResult {
  epochNumber: number;
  budget: bigint;
  rateCeilingBasePerAcu: bigint;
  slices: Record<string, bigint>;
  emittedBySlice: Record<DistributingSlice, bigint>;
  weightBySlice: Record<DistributingSlice, bigint>;
  returnedToReserve: bigint;
  accruals: Map<string, bigint>;
  securityAccrual: bigint;
  allocations: AllocationLine[];
  /** Net amount per account after offset recovery (what the settlement pays). */
  netByAccount: Map<string, bigint>;
  offsetsRecovered: Map<string, bigint>;
  offsetsOutstanding: Map<string, bigint>;
  remainingReserve: bigint;
  poolBalances: Map<string, bigint>;
  securityReserve: bigint;
  cumulativeIssued: bigint;
}

const DIST: readonly DistributingSlice[] = ["execution", "planning", "human_review", "outcomes"];

function sumMap(m: ReadonlyMap<string, bigint>): bigint {
  let s = 0n;
  for (const v of m.values()) s += v;
  return s;
}

export function assertConserved(
  emissionReserve: bigint,
  s: { remainingReserve: bigint; poolBalances: ReadonlyMap<string, bigint>; securityReserve: bigint; cumulativeIssued: bigint },
): void {
  const total = s.remainingReserve + sumMap(s.poolBalances) + s.securityReserve + s.cumulativeIssued;
  if (total !== emissionReserve) throw new EngineError(`funding equation broken: ${total} != ${emissionReserve}`);
}

export function computeEpoch(input: EpochInput, p: EngineParams): EpochResult {
  const sliceBpSum = Object.values(p.slicesBp).reduce((s, v) => s + v, 0n);
  if (sliceBpSum !== BP) throw new EngineError(`slices must sum to 10000 bp, got ${sliceBpSum}`);
  if (p.featurePoolsBp + p.applicationPoolsBp !== BP) throw new EngineError("completion split must sum to 10000 bp");
  const compSum = Object.values(p.completionComponentsBp).reduce((s, v) => s + v, 0n);
  if (compSum !== BP) throw new EngineError("completion components must sum to 10000 bp");
  const ids = new Set<string>();
  for (const r of input.receipts) {
    if (ids.has(r.receiptId)) throw new EngineError(`receipt ${r.receiptId} admitted twice (exactly-once allocation)`);
    ids.add(r.receiptId);
    if (r.weightMicro < 0n) throw new EngineError(`negative weight on ${r.receiptId}`);
  }

  let R = input.remainingReserve + input.returnsToReserve;
  const pools = new Map(input.poolBalances);
  let S = input.securityReserve;
  let I = input.cumulativeIssued;
  let returned = input.returnsToReserve;

  const budget = epochBudget(R, p.budgetPpm);
  const ceiling = rateCeiling(p.rateCeilingInitialBasePerAcu, p.rateCeilingDecayPpm, input.epochNumber);
  const sliceMap = largestRemainder(
    budget,
    Object.entries(p.slicesBp).map(([key, weight]) => ({ key, weight })),
  );
  const slices = Object.fromEntries(sliceMap) as Record<string, bigint>;
  R -= budget;

  const weightBySlice = Object.fromEntries(DIST.map((s) => [s, 0n])) as Record<DistributingSlice, bigint>;
  for (const r of input.receipts) weightBySlice[r.slice] += r.weightMicro;
  const totalWeight = DIST.reduce((s, k) => s + weightBySlice[k], 0n);

  // 1. Distributing slices: emit min(slice, ceiling x weight), pro rata by account weight; the rest returns to R.
  const emittedBySlice = Object.fromEntries(DIST.map((s) => [s, 0n])) as Record<DistributingSlice, bigint>;
  const gross = new Map<string, bigint>();
  const allocations: AllocationLine[] = [];
  for (const slice of DIST) {
    const slice$ = slices[slice] ?? 0n;
    const w = weightBySlice[slice];
    const cap = (w * ceiling) / MICRO;
    const emit = w === 0n ? 0n : slice$ < cap ? slice$ : cap;
    emittedBySlice[slice] = emit;
    R += slice$ - emit;
    returned += slice$ - emit;
    if (emit === 0n) continue;
    const inSlice = input.receipts.filter((r) => r.slice === slice);
    const split = largestRemainder(
      emit,
      inSlice.map((r) => ({ key: r.receiptId, weight: r.weightMicro })),
    );
    for (const r of inSlice) {
      const amount = split.get(r.receiptId) ?? 0n;
      allocations.push({ accountId: r.accountId, receiptId: r.receiptId, slice, weightMicro: r.weightMicro, amountBase: amount });
      gross.set(r.accountId, (gross.get(r.accountId) ?? 0n) + amount);
    }
  }

  // 2. Accrual slices. An empty epoch (no qualified weight) accrues nothing: everything returns to R.
  const accruals = new Map<string, bigint>();
  const completion$ = slices.completion_accrual ?? 0n;
  const security$ = slices.security_reserve ?? 0n;
  let securityAccrual = 0n;
  if (totalWeight === 0n) {
    R += completion$ + security$;
    returned += completion$ + security$;
  } else {
    const feature$ = (completion$ * p.featurePoolsBp) / BP;
    const appPart = completion$ - feature$;
    const accrue = (amount: bigint, keysOf: (r: EngineReceipt) => readonly string[]) => {
      const kw = new Map<string, bigint>();
      for (const r of input.receipts) {
        if (r.slice !== "execution") continue;
        const keys = [...new Set(keysOf(r))];
        if (keys.length === 0) continue;
        const each = (r.weightMicro * SHARE_SCALE) / BigInt(keys.length);
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
    accrue(feature$, (r) => r.featurePoolKeys);
    accrue(appPart, (r) => r.applicationPoolKeys);
    S += security$;
    securityAccrual = security$;
  }

  // 3. Completion pool payouts (pools completed this epoch): whole balance, by component, then by weight.
  for (const payout of [...input.poolPayouts].sort((a, b) => cmp(a.poolKey, b.poolKey))) {
    const bal = pools.get(payout.poolKey) ?? 0n;
    if (bal === 0n) continue;
    pools.set(payout.poolKey, 0n);
    const comps = largestRemainder(
      bal,
      Object.entries(p.completionComponentsBp).map(([key, weight]) => ({ key, weight })),
    );
    for (const [component, amount] of comps) {
      if (amount === 0n) continue;
      const bw = new Map<string, bigint>();
      for (const b of payout.beneficiaries) if (b.component === component) bw.set(b.accountId, (bw.get(b.accountId) ?? 0n) + b.weight);
      if (bw.size === 0 || sumMap(bw) === 0n) {
        R += amount; // a component with nobody to pay (e.g. no finder) returns to the reserve
        returned += amount;
        continue;
      }
      for (const [accountId, a] of largestRemainder(
        amount,
        [...bw].map(([key, weight]) => ({ key, weight })),
      )) {
        if (a === 0n) continue;
        allocations.push({ accountId, receiptId: null, slice: "completion_payout", weightMicro: bw.get(accountId)!, amountBase: a });
        gross.set(accountId, (gross.get(accountId) ?? 0n) + a);
      }
    }
  }

  // 4. Security payouts: weight x realised execution rate, each capped at a share of the remaining reserve balance.
  const execW = weightBySlice.execution;
  const rate = execW > 0n ? (emittedBySlice.execution * MICRO) / execW : ceiling;
  for (const sp of [...input.securityPayouts].sort((a, b) => cmp(a.receiptId, b.receiptId))) {
    const want = (sp.weightMicro * rate) / MICRO;
    const maxNow = (S * p.securityMaxShareOfReserveBp) / BP;
    const pay = want < maxNow ? want : maxNow;
    if (pay === 0n) continue;
    S -= pay;
    allocations.push({
      accountId: sp.accountId,
      receiptId: sp.receiptId,
      slice: "security_payout",
      weightMicro: sp.weightMicro,
      amountBase: pay,
    });
    gross.set(sp.accountId, (gross.get(sp.accountId) ?? 0n) + pay);
  }

  // 5. Dispute settlements: escrowed excess leaves I; bounties are paid from it; the rest returns to R.
  for (const d of [...(input.disputeSettlements ?? [])].sort((a, b) => cmp(a.disputeId, b.disputeId))) {
    const paid = d.bounties.reduce((t, b) => t + b.amountBase, 0n);
    if (paid > d.excessBase) throw new EngineError(`dispute ${d.disputeId} pays more bounty than its excess`);
    I -= d.excessBase;
    R += d.excessBase - paid;
    returned += d.excessBase - paid;
    for (const b of d.bounties) {
      if (b.amountBase === 0n) continue;
      allocations.push({ accountId: b.accountId, receiptId: null, slice: "dispute_bounty", weightMicro: 0n, amountBase: b.amountBase });
      gross.set(b.accountId, (gross.get(b.accountId) ?? 0n) + b.amountBase);
    }
  }

  // 6. Offsets: recover up to maxOffsetRecoveryBp of each account's gross; recovered amounts return to R.
  const netByAccount = new Map<string, bigint>();
  const offsetsRecovered = new Map<string, bigint>();
  const offsetsOutstanding = new Map(input.offsets);
  for (const [accountId, g] of [...gross].sort((a, b) => cmp(a[0], b[0]))) {
    const owed = offsetsOutstanding.get(accountId) ?? 0n;
    const limit = (g * p.maxOffsetRecoveryBp) / BP;
    const rec = owed < limit ? owed : limit;
    if (rec > 0n) {
      offsetsRecovered.set(accountId, rec);
      offsetsOutstanding.set(accountId, owed - rec);
      R += rec;
      returned += rec;
    }
    netByAccount.set(accountId, g - rec);
    I += g - rec;
  }
  for (const [k, v] of [...offsetsOutstanding]) if (v === 0n) offsetsOutstanding.delete(k);

  allocations.sort((a, b) => cmp(a.accountId, b.accountId) || cmp(a.slice, b.slice) || cmp(a.receiptId ?? "", b.receiptId ?? ""));
  return {
    epochNumber: input.epochNumber,
    budget,
    rateCeilingBasePerAcu: ceiling,
    slices,
    emittedBySlice,
    weightBySlice,
    returnedToReserve: returned,
    accruals,
    securityAccrual,
    allocations,
    netByAccount,
    offsetsRecovered,
    offsetsOutstanding,
    remainingReserve: R,
    poolBalances: pools,
    securityReserve: S,
    cumulativeIssued: I,
  };
}

/** Builds engine parameters from the V1 policy documents' numbers. */
export function engineParamsFrom(
  reward: {
    emission: { budgetPpmOfRemaining: number; rateCeiling: { initialBasePerAcu: string; decayPpmPerEpoch: number } };
    slicesBp: Record<DistributingSlice | "completion_accrual" | "security_reserve", number>;
    completion: { featurePoolsBp: number; applicationPoolsBp: number };
    security: { maxShareOfReserveBp: number };
    settlement: { maxOffsetRecoveryBp: number };
  },
  completion: { feature: Record<"implementersBp" | "contractAuthorsBp" | "roadmapAuthorsBp" | "reviewersBp" | "finderBp", number> },
): EngineParams {
  return {
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
  };
}

// ------------------------------------------------------------------------------------------------ anomaly metrics (D29)

export interface AnomalyReceipt {
  receiptId: string;
  accountId: string;
  weightMicro: bigint;
  capMicro: bigint;
  /** Peer P50 of eligible weight for the receipt's comparable key (task kind, class, model, size points). */
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
 * consistent over-claiming first: a skim of +10% on 40 receipts gives consistency ~ +6.3 (sign test) even though no
 * single receipt stands out; a single 3x receipt stands out on medianPeerRatioBp and capSaturationBp.
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

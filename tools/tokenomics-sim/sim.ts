/**
 * Tokenomics and abuse simulation for the DRAFT Proof of Contribution protocol (docs/protocol/TOKENOMICS-SIMULATION.md).
 *
 * Deterministic: a seeded PRNG (mulberry32, SEED below) and the protocol's own reward engine
 * (@waronsaas/contracts/protocol computeEpoch, bigint, conserved funding equation) for every simulated epoch. The same
 * inputs always produce byte-identical markdown. Every parameter below is an ASSUMPTION for exploration, not data about
 * real contributors (there are none yet) and not the founder's figures.
 */
import {
  COMPLETION_POLICY_V1,
  computeEpoch,
  tallyDualMajority,
  type EngineParams,
  type EngineReceipt,
  type EngineState,
  engineParamsFrom,
  governanceWeights,
  initialState,
  GENESIS_POLICY_V1,
  GOVERNANCE_POLICY_V1,
  USAGE_PROOF_POLICY_V1,
  type PoolPayout,
  REVIEW_POLICY_V1,
  REWARD_POLICY_V1,
  type RewardPolicy,
} from "@waronsaas/contracts/protocol";

export const SEED = 20260929;
const WOS = 1_000_000n; // base units per WOS
const MICRO = 1_000_000n; // micro-ACU per ACU
const MAX_SUPPLY = BigInt(REWARD_POLICY_V1.emission.maxSupplyBase);

// ------------------------------------------------------------------------------------------------ helpers

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const wos = (b: bigint) => Number(b / WOS);
const pct = (num: bigint, den: bigint, d = 2) => (den === 0n ? "0" : fmt(Number((num * 1_000_000n) / den) / 10_000, d));

function table(head: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.map(String).join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26), deterministic. */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function binomTail(n: number, p: number, kMin: number): number {
  // P(K >= kMin), K ~ Bin(n, p), exact by summation in log space.
  let total = 0;
  let logC = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    if (k >= kMin) total += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return Math.min(1, total);
}

function hyperAll(N: number, m: number, x: number): number {
  // P(all x draws without replacement from N come from the m colluders).
  if (x > m) return 0;
  let p = 1;
  for (let i = 0; i < x; i++) p *= (m - i) / (N - i);
  return p;
}

// ------------------------------------------------------------------------------------------------ assumptions

export const ASSUMPTIONS = {
  meanAcuPerActivePerWeek: 20,
  lognormalSigma: 0.8,
  acuPerMergedUnit: 12,
  planningShareOfExecution: 0.1,
  humanReviewAcuEqPerUnit: 1,
  founderAcuPerWeek: 30,
  codexShare: 0.4,
  cohorts: 20,
  epochs: 520,
  featureEpochs: 12,
  applicationCompletesAtEpoch: 260,
};

const MEDIAN_ACU = ASSUMPTIONS.meanAcuPerActivePerWeek / Math.exp(ASSUMPTIONS.lognormalSigma ** 2 / 2);

/** Deterministic cohort weights: the population split into equal-count quantile cohorts of a lognormal. */
function cohortShares(k: number, sigma: number): number[] {
  // Mean of each quantile slice, via midpoint quantiles; normalised to mean 1.
  const zs = Array.from({ length: k }, (_, i) => {
    const q = (i + 0.5) / k;
    // inverse normal by bisection on phi
    let lo = -8;
    let hi = 8;
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      if (phi(mid) < q) lo = mid;
      else hi = mid;
    }
    return Math.exp(sigma * lo - (sigma * sigma) / 2);
  });
  const mean = zs.reduce((s, z) => s + z, 0) / k;
  return zs.map((z) => z / mean);
}

// ------------------------------------------------------------------------------------------------ epoch scenarios

interface Scenario {
  id: string;
  title: string;
  active: (e: number) => number;
  /** Multiplier on ACU per unit of work at epoch e (oracle tracking price declines, provider price changes). */
  acuFactor?: (e: number, provider: "claude" | "codex") => number;
  founderAlone?: boolean;
  noCeiling?: boolean;
}

const cohorts = cohortShares(ASSUMPTIONS.cohorts, ASSUMPTIONS.lognormalSigma);
const acct = (tag: string) => {
  // stable pseudo-uuid per tag (only used as a sort key and map key inside the engine)
  let h = 2166136261;
  for (const ch of tag) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hex = h.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-${tag.length.toString(16).padStart(4, "0")}${hex}`.slice(0, 36);
};

export interface ScenarioRow {
  epoch: number;
  active: number;
  budgetWos: number;
  execEmittedWos: number;
  ratePerAcu: number;
  medianWeeklyWos: number;
  founderWeeklyWos: number;
  returnedPct: string;
  issuedPctOfMax: string;
  poolsWos: number;
  codexExecSharePct: string;
}

export function runScenario(s: Scenario, params: EngineParams, rng: () => number, checkpoints: number[]): ScenarioRow[] {
  let state: EngineState = initialState(BigInt(REWARD_POLICY_V1.emission.emissionReserveBase));
  const consumedIds = new Set<string>();
  const trailing: bigint[] = [];
  const out: ScenarioRow[] = [];
  const p = s.noCeiling ? { ...params, rateCeilingInitialBasePerAcu: 10n ** 15n, rateCeilingDecayPpm: 0n } : params;
  for (let e = 1; e <= ASSUMPTIONS.epochs; e++) {
    const active = s.founderAlone ? 0 : Math.max(0, Math.round(s.active(e)));
    const receipts: EngineReceipt[] = [];
    const featureKey = `f${Math.floor((e - 1) / ASSUMPTIONS.featureEpochs)}`;
    let codexW = 0n;
    let execW = 0n;
    const perCohort = active / ASSUMPTIONS.cohorts;
    for (let c = 0; c < ASSUMPTIONS.cohorts && perCohort > 0; c++) {
      for (const provider of ["claude", "codex"] as const) {
        const share = provider === "codex" ? ASSUMPTIONS.codexShare : 1 - ASSUMPTIONS.codexShare;
        const noise = 0.95 + 0.1 * rng();
        const f = s.acuFactor ? s.acuFactor(e, provider) : 1;
        const acu = perCohort * share * cohorts[c]! * ASSUMPTIONS.meanAcuPerActivePerWeek * noise * f;
        const w = BigInt(Math.round(acu * 1_000_000));
        if (w === 0n) continue;
        execW += w;
        if (provider === "codex") codexW += w;
        receipts.push({
          receiptId: `x-${e}-${c}-${provider}`,
          accountId: acct(`c${c}${provider}`),
          slice: "execution",
          weightMicro: w,
          featurePoolKeys: [featureKey],
          applicationPoolKeys: ["tgt"],
        });
      }
    }
    // Contributor zero, same rules as everyone.
    const fw = BigInt(ASSUMPTIONS.founderAcuPerWeek) * MICRO;
    receipts.push({
      receiptId: `x-${e}-founder`,
      accountId: acct("founder"),
      slice: "execution",
      weightMicro: fw,
      featurePoolKeys: [featureKey],
      applicationPoolKeys: ["tgt"],
    });
    execW += fw;
    const units = Number(execW / MICRO) / ASSUMPTIONS.acuPerMergedUnit;
    receipts.push({
      receiptId: `p-${e}`,
      accountId: acct("planners"),
      slice: "planning",
      weightMicro: BigInt(Math.round(Number(execW) * ASSUMPTIONS.planningShareOfExecution)),
      featurePoolKeys: [],
      applicationPoolKeys: [],
    });
    receipts.push({
      receiptId: `h-${e}`,
      accountId: acct("humans"),
      slice: "human_review",
      weightMicro: BigInt(Math.round(units * ASSUMPTIONS.humanReviewAcuEqPerUnit * 1_000_000)),
      featurePoolKeys: [],
      applicationPoolKeys: [],
    });
    receipts.push({
      receiptId: `o-${e}`,
      accountId: acct("proposers"),
      slice: "outcomes",
      weightMicro: BigInt(Math.round((units / 50) * 10 * 1_000_000)),
      featurePoolKeys: [],
      applicationPoolKeys: [],
    });
    const payouts: PoolPayout[] = [];
    if (e % ASSUMPTIONS.featureEpochs === 0) {
      payouts.push({
        id: `pool-${featureKey}`,
        poolKey: featureKey,
        kind: "feature",
        beneficiaries: [
          ...receipts
            .filter((r) => r.slice === "execution")
            .map((r) => ({ beneficiaryId: r.accountId, component: "implementers" as const, weight: r.weightMicro })),
          { beneficiaryId: acct("planners"), component: "contractAuthors" as const, weight: 1n },
          { beneficiaryId: acct("planners"), component: "roadmapAuthors" as const, weight: 1n },
          { beneficiaryId: acct("humans"), component: "reviewers" as const, weight: 1n },
          { beneficiaryId: acct("proposers"), component: "finder" as const, weight: 1n },
        ],
      });
    }
    if (e === ASSUMPTIONS.applicationCompletesAtEpoch) {
      payouts.push({
        id: "pool-tgt",
        poolKey: "tgt",
        kind: "application",
        beneficiaries: receipts
          .filter((r) => r.slice === "execution")
          .map((r) => ({ beneficiaryId: r.accountId, component: "lifetime" as const, weight: r.weightMicro })),
      });
    }
    const trailingRate = trailing.length === 0 ? undefined : trailing.reduce((t, v) => t + v, 0n) / BigInt(trailing.length);
    const res = computeEpoch(
      {
        epochNumber: e,
        state,
        consumedIds,
        trailingRateBasePerAcu: trailingRate,
        receipts,
        poolPayouts: payouts,
        securityPayouts:
          e % 13 === 0 && active > 0
            ? [{ id: `sec-${e}`, receiptId: `sec-${e}`, beneficiaryId: acct("security"), weightMicro: 100n * MICRO }]
            : [],
      },
      p,
    );
    state = res.state;
    for (const id of res.consumedIds) consumedIds.add(id);
    if (res.weightBySlice.execution > 0n) {
      trailing.push((res.emittedBySlice.execution * MICRO) / res.weightBySlice.execution);
      if (trailing.length > 4) trailing.shift();
    }
    const I = state.cumulativeIssued;
    const pools = state.poolBalances;
    const S = state.securityReserve;
    if (checkpoints.includes(e)) {
      const rate =
        res.weightBySlice.execution === 0n ? 0 : Number((res.emittedBySlice.execution * MICRO) / res.weightBySlice.execution) / 1e6;
      const founderE = res.entitlements.get(acct("founder"));
      const codexEmitted = execW === 0n ? 0n : (res.emittedBySlice.execution * codexW) / execW;
      out.push({
        epoch: e,
        active: active + 1,
        budgetWos: wos(res.budget),
        execEmittedWos: wos(res.emittedBySlice.execution),
        ratePerAcu: rate,
        medianWeeklyWos: rate * MEDIAN_ACU,
        founderWeeklyWos: founderE ? wos(founderE.releasedNow + founderE.heldBack) : 0,
        returnedPct: pct(res.returnedToReserve, res.budget, 1),
        issuedPctOfMax: pct(I, MAX_SUPPLY, 2),
        poolsWos: wos([...pools.values()].reduce((t, v) => t + v, 0n) + S),
        codexExecSharePct: pct(codexEmitted, res.emittedBySlice.execution === 0n ? 1n : res.emittedBySlice.execution, 1),
      });
    }
  }
  return out;
}

const logistic = (lo: number, hi: number, mid: number, k: number) => (e: number) => lo + (hi - lo) / (1 + Math.exp(-k * (e - mid)));

export const SCENARIOS: Scenario[] = [
  { id: "S1", title: "1,000 active contributors, flat", active: () => 1_000 },
  { id: "S2", title: "10,000 active, flat", active: () => 10_000 },
  { id: "S3", title: "100,000 active, flat", active: () => 100_000 },
  { id: "S4", title: "1,000,000 active, flat", active: () => 1_000_000 },
  { id: "S5", title: "Extreme growth: 10 to 1,000,000 over ~2 years (logistic)", active: logistic(10, 1_000_000, 60, 0.12) },
  { id: "S6", title: "Low participation: contributor zero + 5 for two years, then 50", active: (e) => (e <= 104 ? 5 : 50) },
  {
    id: "S7",
    title: "Inference cost decline: 10,000 active, oracle follows a 40%/year price fall",
    active: () => 10_000,
    acuFactor: (e) => 0.6 ** Math.floor((e - 1) / 52),
  },
  {
    id: "S8",
    title: "Provider price change: 10,000 active, Codex rates -50% from epoch 53",
    active: () => 10_000,
    acuFactor: (e, p) => (p === "codex" && e >= 53 ? 0.5 : 1),
  },
  { id: "S9", title: "Contributor zero alone for a year (founder test mode), rate ceiling ON", active: () => 0, founderAlone: true },
  {
    id: "S10",
    title: "Contributor zero alone, rate ceiling OFF (why the ceiling exists)",
    active: () => 0,
    founderAlone: true,
    noCeiling: true,
  },
];

// ------------------------------------------------------------------------------------------------ abuse and gaming models

/** Astra-01 item 5: waste behaviours. Gain vs an honest median contributor, before and after detection. */
export function wasteTable(): string {
  const sigma = 0.5; // spread of honest ACU per size point around the peer median (assumption)
  const capMultiple = Math.exp(0.6745 * sigma) * 1.25; // P75 x headroom 1.25
  const q = REVIEW_POLICY_V1.payoutAudit.quorum;
  const sampled = REWARD_POLICY_V1.challenge.sampledAuditRateBp / 10_000;
  const rows: (string | number)[][] = [];
  const strategies: { name: string; multiple: number; logBacked: boolean; judgeAccuracy: number }[] = [
    { name: "cap saturation (report every unit at the cap)", multiple: capMultiple, logBacked: false, judgeAccuracy: 0.8 },
    { name: "cap saturation with fabricated but consistent run logs", multiple: capMultiple, logBacked: true, judgeAccuracy: 0.5 },
    { name: "context inflation (+50% input, real)", multiple: 1.3, logBacked: true, judgeAccuracy: 0.5 },
    { name: "expensive model for easy units (Fable-class rates vs Sol-class)", multiple: 1.75, logBacked: true, judgeAccuracy: 0.6 },
    { name: "one unnecessary repair loop per unit (real)", multiple: 1.4, logBacked: true, judgeAccuracy: 0.6 },
    { name: "task splitting (author splits a contract into more ABUs)", multiple: 1.1, logBacked: true, judgeAccuracy: 0.3 },
    {
      name: "builder + friendly reviewer (human-review weight is fixed, not builder ACU)",
      multiple: 1.0,
      logBacked: true,
      judgeAccuracy: 0,
    },
  ];
  const bare = USAGE_PROOF_POLICY_V1.logs.bareAttestedWeightBp / 10_000;
  for (const st of strategies) {
    const clipped = Math.min(st.multiple, capMultiple);
    const naive = clipped * (st.logBacked ? 1 : bare);
    // Detection per receipt: sampled audit, or a dispute prompted by the anomaly ranking (propensity 0.3 when the
    // claim is >= 1.3x typical), judged by `q` auditors each finding it with judgeAccuracy.
    const flagged = clipped >= 1.3 ? 0.3 : 0.05;
    const gateCatches = 1 - (1 - st.judgeAccuracy) ** q;
    const pDetect = (sampled + (1 - sampled) * flagged) * gateCatches;
    const expected = (1 - pDetect) * naive + pDetect * 1; // caught: that receipt clipped to plausible
    rows.push([st.name, fmt(clipped, 2), fmt(naive, 2), `${fmt(pDetect * 100, 1)}%`, `${fmt((expected - 1) * 100, 0)}%`]);
  }
  return table(
    ["strategy", "claimed / honest", "paid if never caught", "P(caught per receipt)", "expected gain, receipt by receipt"],
    rows,
  );
}

/**
 * D29 skim attack: inflate every receipt a little. Detection power of the engine's sign-test consistency metric
 * (exact binomial, Z >= 3) per epoch and over the rolling 13-epoch window, vs sampled audits alone. Honest receipts
 * spread lognormally around the peer median (sigma 0.5); an honest account is flagged at Z >= 3 about 0.1% of the time.
 */
export function skimTable(): string {
  const sigma = 0.5;
  const rows: (string | number)[][] = [];
  const signPower = (n: number, pAbove: number) => binomTail(n, pAbove, Math.ceil((3 * Math.sqrt(n) + n) / 2));
  for (const s of [0.05, 0.1, 0.2, 0.5]) {
    for (const perEpoch of [3, 10, 30]) {
      const pAbove = phi(Math.log(1 + s) / sigma);
      const one = signPower(perEpoch, pAbove);
      const rolling = signPower(perEpoch * 13, pAbove);
      let epochsTo50 = "> 52";
      for (let e = 1; e <= 52; e++) {
        if (signPower(perEpoch * e, pAbove) >= 0.5) {
          epochsTo50 = String(e);
          break;
        }
      }
      const sampledPerEpoch = 1 - (1 - (REWARD_POLICY_V1.challenge.sampledAuditRateBp / 10_000) * 0.2) ** perEpoch;
      rows.push([
        `${s * 100}%`,
        perEpoch,
        `${fmt(one * 100, 1)}%`,
        `${fmt(rolling * 100, 1)}%`,
        epochsTo50,
        `${fmt(sampledPerEpoch * 100, 1)}%`,
      ]);
    }
  }
  const honest = signPower(130, 0.5);
  return `${table(["skim per receipt", "receipts per epoch", "ranked (Z >= 3) within one epoch", "ranked over the rolling 13 epochs", "epochs until 50% likely ranked", "sampled audits catch it in an epoch"], rows)}

An honest account with 130 receipts in the window is ranked at Z >= 3 with probability ${fmt(honest * 100, 2)}%.`;
}

export function skimBountyTable(ratePerAcu: number): string {
  const rows: (string | number)[][] = [];
  const bountyBp = REWARD_POLICY_V1.losses.bountyBpOfRecovered / 10_000;
  const stakeBp = REWARD_POLICY_V1.challenge.stakePerItemBp / 10_000;
  const floor = Number(BigInt(REWARD_POLICY_V1.challenge.minStakeBase) / WOS);
  for (const pool of [100, 1_000, 10_000]) {
    for (const s of [0.1, 0.2]) {
      const n = 40;
      const skimmerAcu = n * 3; // 40 receipts of 3 ACU
      const excessWos = skimmerAcu * (s / (1 + s)) * ratePerAcu;
      const victimLoss = excessWos / pool; // dilution spread over the pool
      // Recovered from the holdback first (D40): half of the skimmer's last 13 epochs is held, more than the excess.
      const bounty = excessWos * bountyBp;
      const disputerPending = MEDIAN_ACU * ratePerAcu;
      const stake = Math.max(floor, disputerPending * stakeBp);
      const pUphold = 0.6;
      const ev = pUphold * bounty - (1 - pUphold) * stake;
      rows.push([pool, `${s * 100}%`, fmt(excessWos, 0), fmt(victimLoss, 2), fmt(bounty, 0), fmt(stake, 0), fmt(ev, 0)]);
    }
  }
  return table(
    [
      "contributors in epoch",
      "skim",
      "total excess (WOS)",
      "loss per honest contributor (WOS)",
      "pattern-dispute bounty (WOS)",
      "disputer stake (WOS)",
      "disputer EV at P(uphold)=0.6",
    ],
    rows,
  );
}

/** D24/D25: capture probability for a ring of m accounts among N eligible, both agent slots and the X auditors. */
export function collusionTable(): string {
  const rows: (string | number)[][] = [];
  const x = REVIEW_POLICY_V1.payoutAudit.quorum;
  for (const N of [5, 10, 20, 50, 200, 1000]) {
    for (const m of [2, 3, 5]) {
      if (m >= N) continue;
      // The author is one of the ring's m accounts; the other m - 1 are eligible for the author's slots and audits.
      const slots = hyperAll(N - 1, m - 1, 2);
      const auditors = hyperAll(N - 1, m - 1, x);
      const audit = REVIEW_POLICY_V1.audits.baseRateBp / 10_000;
      const pHonestAuditor = 1 - (m - 1) / (N - 1);
      const residual = slots * (1 - audit * pHonestAuditor);
      rows.push([
        N,
        m,
        `${fmt(slots * 100, 2)}%`,
        `${fmt(auditors * 100, 2)}%`,
        `${fmt(residual * 100, 2)}%`,
        N < REVIEW_POLICY_V1.payoutAudit.smallPoolThreshold ? "human sign-off decides" : "random gates + human",
      ]);
    }
  }
  return table(
    [
      "eligible reviewers N",
      "ring accounts m (incl. the author)",
      "P(both agent slots in ring)",
      `P(all ${x} payout auditors in ring)`,
      "P(slots captured, not caught by the 10% audit)",
      "backstop (the human reviewer is admin-authorized, outside the ring by assumption)",
    ],
    rows,
  );
}

/** D26/D27: canary detection time for an always-"plausible" client. */
export function canaryTable(): string {
  const rows: (string | number)[][] = [];
  for (const rate of [
    REVIEW_POLICY_V1.canaries.rateBp,
    REVIEW_POLICY_V1.canaries.newAccountRateBp,
    REVIEW_POLICY_V1.canaries.flaggedAccountRateBp,
  ]) {
    for (const perEpoch of [1, 3, 10]) {
      const c = rate / 10_000;
      const pEpoch = 1 - (1 - c) ** perEpoch;
      rows.push([
        `${rate / 100}%`,
        perEpoch,
        `${fmt(pEpoch * 100, 1)}%`,
        fmt(1 / pEpoch, 1),
        fmt(Math.log(0.05) / Math.log(1 - pEpoch), 0),
      ]);
    }
  }
  return table(
    ["canary rate", "audits per epoch", "P(caught in an epoch)", "expected epochs to first catch", "epochs until 95% caught"],
    rows,
  );
}

/** D28: optimistic verification. Detection and audit compute vs dispute propensity, sampled audit rate, collusion fraction. */
export function optimisticTable(): string {
  const rows: (string | number)[][] = [];
  const x = REVIEW_POLICY_V1.payoutAudit.quorum;
  for (const propensity of [0, 0.1, 0.3]) {
    for (const sampled of [0.02, 0.05, 0.1]) {
      for (const f of [0.05, 0.2]) {
        // An inflated allocation (2x) is caught if disputed or sampled, AND the gate has at least one honest accurate auditor.
        const pExamined = 1 - (1 - propensity) * (1 - sampled);
        const pGate = 1 - (f + (1 - f) * 0.2) ** x;
        const pCaught = pExamined * pGate;
        // Audit compute per 1,000 honest receipts: sampled + false disputes (5% of propensity), x audits each.
        const audits = 1000 * (sampled + propensity * 0.05) * x;
        rows.push([`${propensity * 100}%`, `${sampled * 100}%`, `${f * 100}%`, `${fmt(pCaught * 100, 1)}%`, fmt(audits, 0)]);
      }
    }
  }
  return table(
    [
      "dispute propensity on a 2x-inflated allocation",
      "sampled audit rate",
      "colluding auditor fraction",
      "P(inflation caught)",
      "audit runs per 1,000 honest receipts",
    ],
    rows,
  );
}

export function griefingTable(ratePerAcu: number): string {
  const rows: (string | number)[][] = [];
  const pending = MEDIAN_ACU * ratePerAcu;
  const p = REWARD_POLICY_V1.challenge;
  for (const items of [1, 5, 25]) {
    // D43: per-item stake = max(floor, min(2% of pending, 10% of pending / items)); forfeited only for rejected items.
    const each = Math.max(
      Number(BigInt(p.minStakeBase) / WOS),
      Math.min((pending * p.stakePerItemBp) / 10_000, (pending * p.maxStakeBp) / 10_000 / items),
    );
    const stake = each * items;
    const perEpochMaxLoss = stake * p.maxDisputesPerAccountPerEpoch;
    const auditorCost = items * REVIEW_POLICY_V1.payoutAudit.quorum;
    rows.push([items, fmt(stake, 0), fmt((stake / pending) * 100, 1) + "%", fmt(perEpochMaxLoss, 0), auditorCost]);
  }
  return table(
    [
      "allocations in one false dispute (all rejected)",
      "stake forfeited (WOS)",
      "share of disputer's pending",
      "max loss per epoch at the rate limit (WOS)",
      "audit runs it costs other contributors",
    ],
    rows,
  );
}

/** Genesis (A6, D23): ratified vs never-ratified founder bootstrap work, and the historical credit under the cap. */
export function genesisTable(earlyRatePerAcu: number): string {
  const rows: (string | number)[][] = [];
  const cap = Number(BigInt(GENESIS_CAP()) / WOS);
  const fallback = Number(BigInt(GENESIS_POLICY_V1.valuation.fallbackBasePerSizePoint) / WOS);
  for (const retroSizePoints of [100, 300, 600, 2000]) {
    const genesisAcu = retroSizePoints * 4; // reference 4 ACU per size point (capability-policy v1 default; the real value is the frozen population's median)
    const value = Math.min(genesisAcu * earlyRatePerAcu, cap);
    rows.push([
      retroSizePoints,
      fmt(genesisAcu, 0),
      fmt(genesisAcu * earlyRatePerAcu, 0),
      fmt(value, 0),
      fmt(Math.min(retroSizePoints * fallback, cap), 0),
      value >= cap ? "yes" : "no",
    ]);
  }
  const t1 = table(
    [
      "retro size points (illustrative)",
      "reference ACU",
      "value at the reference rate (WOS)",
      "Genesis credit after cap (WOS)",
      "published fallback if evidence is insufficient (WOS)",
      "cap binds",
    ],
    rows,
  );
  const rows2: (string | number)[][] = [];
  const weeks = 26;
  for (const ratified of [0, 0.5, 1]) {
    const acu = ASSUMPTIONS.founderAcuPerWeek * weeks;
    rows2.push([`${ratified * 100}%`, fmt(acu, 0), fmt(acu * ratified * earlyRatePerAcu, 0), fmt(acu * (1 - ratified), 0), "0"]);
  }
  const t2 = table(
    [
      "share of 26 weeks of provisional founder work later ratified",
      "provisional ACU",
      "live WOS once ratified",
      "ACU that stays provisional (test WOS only)",
      "counts toward Genesis",
    ],
    rows2,
  );
  return `${t1}\n\n${t2}`;
}

const GENESIS_CAP = () => GENESIS_POLICY_V1.capBase;

/** Audit duty supply vs demand under optimistic verification. */
export function dutyTable(): string {
  const rows: (string | number)[][] = [];
  const x = REVIEW_POLICY_V1.payoutAudit.quorum;
  const perClaim = REVIEW_POLICY_V1.payoutAudit.maxDutyTasksPerClaim;
  for (const receiptsPerClaimant of [1, 3, 10]) {
    for (const disputed of [0.01, 0.05]) {
      const demand = receiptsPerClaimant * (REWARD_POLICY_V1.challenge.sampledAuditRateBp / 10_000 + disputed) * x;
      const supply = perClaim;
      rows.push([receiptsPerClaimant, `${disputed * 100}%`, fmt(demand, 2), supply, demand <= supply ? "covered" : "backlog"]);
    }
  }
  return table(
    [
      "receipts per claimant per epoch",
      "share of allocations disputed",
      "audit runs needed per claimant",
      "max duty runs per claim",
      "result",
    ],
    rows,
  );
}

/**
 * H4 / D39 / D40 / A3-13: fabrication economics under the ledger's own recovery rules. A cheater claims `k` x honest
 * weight on every receipt (n receipts/epoch) for a planned X epochs and then exits. Each epoch it is caught with
 * probability 1 - (1 - pd)^n (pd is the unmeasured detection rate per receipt, an explicit axis). On detection the
 * notice places HOLDS at once on the pending allocation and all unreleased holdback (migration 0007 v3: holds apply at
 * notice, so nothing leaves during the reply and appeal windows), then the account is excluded. Two recovery rules:
 *   compensatory (what 0007 v3 implements): recovery = min(proven excess, held); the proven excess is the fabricated
 *     part of every epoch still inside the holdback window (a pattern finding); the rest of the held amount is the
 *     cheater's honest share and is released to them;
 *   punitive (D39/D40 wording, founder decision F17): every held unit is forfeited.
 * Identity churn restarts the cheater after D epochs. Payout is compared with honest work over the same X epochs.
 * Monte Carlo, seeded. Wrongful findings are not modelled: under compensatory recovery a wrongful finding costs an
 * honest contributor at most the (wrongly) proven excess; under punitive forfeiture, all unreleased holdback.
 */
export function fabricationTable(): string {
  const rng = mulberry32(SEED + 7);
  const rows: (string | number)[][] = [];
  const hold = REWARD_POLICY_V1.holdback.shareBp / 10_000;
  const L = REWARD_POLICY_V1.holdback.epochs;
  const n = 10;
  const trials = 4000;
  const cases: { name: string; k: number; pd: number; X: number; churn: number }[] = [];
  for (const [name, k] of [
    ["cap saturation, fabricated consistent logs", 1.75],
    ["same, baselines contaminated (cap drifts +20%)", 2.1],
    ["10% skim on every receipt", 1.1],
  ] as const) {
    for (const pd of [0.001, 0.005, 0.02]) cases.push({ name, k, pd, X: 52, churn: 0 });
    cases.push({ name, k, pd: 0.005, X: 13, churn: 0 });
    cases.push({ name, k, pd: 0.005, X: 52, churn: 4 });
  }
  for (const c of cases) {
    const pEpoch = 1 - (1 - c.pd) ** n;
    const run = (h: number, rule: "compensatory" | "punitive") => {
      let total = 0;
      let caughtAny = 0;
      for (let t = 0; t < trials; t++) {
        let paid = 0;
        let tranches: number[] = [];
        let caught = false;
        for (let e = 0; e < c.X; e++) {
          const alloc = c.k * n;
          if (rng() < pEpoch) {
            caught = true;
            const held = tranches.reduce((x, y) => x + y, 0) + alloc; // holds at notice: tranches + pending allocation
            const proven = (c.k - 1) * n * (tranches.length + 1); // pattern finding over the held window
            if (rule === "compensatory") paid += held - Math.min(proven, held);
            tranches = [];
            if (c.churn === 0) break;
            e += c.churn; // a fresh identity after `churn` epochs
            continue;
          }
          paid += alloc * (1 - h);
          tranches.push(alloc * h);
          if (tranches.length > L) paid += tranches.shift()!;
        }
        paid += tranches.reduce((x, y) => x + y, 0); // undetected holdback matures after exit
        total += paid;
        if (caught) caughtAny++;
      }
      return { gain: total / trials / (c.X * n) - 1, caught: caughtAny / trials };
    };
    const without = run(0, "punitive");
    const comp = run(hold, "compensatory");
    const puni = run(hold, "punitive");
    rows.push([
      c.name,
      `${fmt(c.pd * 100, 1)}%`,
      c.X,
      c.churn === 0 ? "no" : `after ${c.churn} epochs`,
      `${fmt(puni.caught * 100, 0)}%`,
      `${fmt(without.gain * 100, 0)}%`,
      `${fmt(comp.gain * 100, 0)}%`,
      `${fmt(puni.gain * 100, 0)}%`,
    ]);
  }
  return table(
    [
      "strategy",
      "P(caught per receipt)",
      "planned epochs before exit",
      "identity churn",
      "P(caught before exit)",
      "gain vs honest: no holdback, exclusion only",
      `gain: ${hold * 100}% holdback, COMPENSATORY recovery (0007 v3)`,
      `gain: ${hold * 100}% holdback, PUNITIVE forfeiture (F17)`,
    ],
    rows,
  );
}

// ------------------------------------------------------------------------------------------------ governance (D34, D36, D37)

/** Minimum coalition share (of a weight) that passes a tier against opponents voting at turnout tau. */
export function captureTable(): string {
  const rows: (string | number)[][] = [];
  for (const [tier, t] of Object.entries(GOVERNANCE_POLICY_V1.tiers)) {
    const T = t.thresholdBp / 10_000;
    const cells: string[] = [];
    for (const tau of [0.2, 0.5, 1]) {
      const c = (T * tau) / (1 - T + T * tau);
      cells.push(`${fmt(c * 100, 1)}%`);
    }
    rows.push([tier, `${t.thresholdBp / 100}%`, `${t.turnoutLockedBp / 100}% / ${t.turnoutContributionBp / 100}%`, ...cells]);
  }
  return table(
    [
      "tier",
      "threshold (each weight)",
      "turnout (locked / contribution)",
      "coalition share needed if opponents turn out 20%",
      "... 50%",
      "... 100%",
    ],
    rows,
  );
}

/**
 * Concentration over time: contributor zero's share of each governance weight. Contribution weight = trailing 26
 * epochs with linear age-out; locked weight = contributor zero locks everything received (earned + vested Genesis
 * from "mainnet" at epoch 1, 104-epoch vesting), others lock 25% of what they receive. Uses the engine per epoch.
 */
export function concentrationTable(params: EngineParams): string {
  const rows: (string | number)[][] = [];
  const genesisTotal = 8000 * 42; // illustrative: 2000 retro size points x 4 ACU at ~42 WOS/ACU (table H), far under the cap
  for (const sc of [SCENARIOS[5]!, SCENARIOS[0]!, SCENARIOS[4]!]) {
    const rng = mulberry32(SEED + 1);
    let state: EngineState = initialState(BigInt(REWARD_POLICY_V1.emission.emissionReserveBase));
    const consumedIds = new Set<string>();
    const window: { founder: number; all: number }[] = [];
    let founderLocked = 0;
    let othersLocked = 0;
    for (let e = 1; e <= 208; e++) {
      const active = Math.round(sc.active(e));
      const receipts: EngineReceipt[] = [];
      for (let c = 0; c < ASSUMPTIONS.cohorts && active > 0; c++) {
        const w = BigInt(
          Math.round((active / ASSUMPTIONS.cohorts) * cohorts[c]! * ASSUMPTIONS.meanAcuPerActivePerWeek * (0.95 + 0.1 * rng()) * 1e6),
        );
        if (w > 0n)
          receipts.push({
            receiptId: `c${e}-${c}`,
            accountId: acct(`c${c}`),
            slice: "execution",
            weightMicro: w,
            featurePoolKeys: [],
            applicationPoolKeys: [],
          });
      }
      receipts.push({
        receiptId: `f${e}`,
        accountId: acct("founder"),
        slice: "execution",
        weightMicro: BigInt(ASSUMPTIONS.founderAcuPerWeek) * MICRO,
        featurePoolKeys: [],
        applicationPoolKeys: [],
      });
      const res = computeEpoch({ epochNumber: e, state, consumedIds, receipts }, params);
      state = res.state;
      for (const id of res.consumedIds) consumedIds.add(id);
      const netOf = (b: string) => {
        const x = res.entitlements.get(b);
        return x ? wos(x.releasedNow + x.heldBack) : 0;
      };
      const founderNet = netOf(acct("founder"));
      const allNet = [...res.entitlements.keys()].reduce((t, b) => t + netOf(b), 0);
      founderLocked += founderNet + (e <= 104 ? genesisTotal / 104 : 0);
      othersLocked += (allNet - founderNet) * 0.25;
      const totalW = receipts.reduce((t, r) => t + Number(r.weightMicro), 0);
      window.push({ founder: ASSUMPTIONS.founderAcuPerWeek * 1e6, all: totalW });
      if ([13, 26, 52, 104, 208].includes(e)) {
        let fw = 0;
        let aw = 0;
        for (let i = Math.max(0, window.length - 26); i < window.length; i++) {
          const age = window.length - 1 - i;
          const k = (26 - age) / 26;
          fw += window[i]!.founder * k;
          aw += window[i]!.all * k;
        }
        const cShare = fw / aw;
        const lShare = founderLocked / (founderLocked + othersLocked);
        const passes = (tier: keyof typeof GOVERNANCE_POLICY_V1.tiers) => {
          const t = GOVERNANCE_POLICY_V1.tiers[tier];
          const T = t.thresholdBp / 10_000;
          // Founder alone vs everyone else voting no at 50% turnout.
          const ok = (share: number) => share / (share + (1 - share) * 0.5) >= T && share >= t.turnoutContributionBp / 10_000;
          return ok(cShare) && ok(lShare) ? "yes" : "no";
        };
        const unopposed =
          cShare >= GOVERNANCE_POLICY_V1.tiers.routine.turnoutContributionBp / 10_000 &&
          lShare >= GOVERNANCE_POLICY_V1.tiers.routine.turnoutLockedBp / 10_000
            ? "yes"
            : "no";
        rows.push([
          sc.id,
          e,
          `${fmt(cShare * 100, 1)}%`,
          `${fmt(lShare * 100, 1)}%`,
          unopposed,
          passes("routine"),
          passes("structural"),
          passes("governance"),
        ]);
      }
    }
  }
  return table(
    [
      "scenario",
      "epoch",
      "contributor zero: contribution weight share",
      "contributor zero: locked weight share",
      "alone passes routine if nobody else votes",
      "alone passes routine (others 50% turnout, all no)",
      "structural",
      "governance",
    ],
    rows,
  );
}

/** D38: an organization's share of each governance weight, with and without the per-organization cap. */
export function orgConcentrationTable(): string {
  const rows: (string | number)[][] = [];
  const T = GOVERNANCE_POLICY_V1.tiers.routine.thresholdBp / 10_000;
  for (const [orgShare, others] of [
    [0.05, 50],
    [0.25, 50],
    [0.5, 50],
    [0.9, 50],
    [0.9, 5],
  ] as const) {
    // One organization of 5 accounts holds `orgShare`; `others` independent people share the rest equally.
    const orgEach = BigInt(Math.round((orgShare * 1e6) / 5));
    const otherEach = BigInt(Math.round(((1 - orgShare) * 1e6) / others));
    const ws = [
      ...Array.from({ length: 5 }, (_, i) => ({ accountId: `o${i}`, organizationId: "org", locked: orgEach, contribution: orgEach })),
      ...Array.from({ length: others }, (_, i) => ({
        accountId: `p${i}`,
        organizationId: null,
        locked: otherEach,
        contribution: otherEach,
      })),
    ];
    const capped = governanceWeights(ws, {
      perWalletCapBp: GOVERNANCE_POLICY_V1.lock.perWalletCapBp,
      orgCapBp: GOVERNANCE_POLICY_V1.orgCapBp,
      lockedVoterMustHaveContributed: GOVERNANCE_POLICY_V1.lockedVoterMustHaveContributed,
    });
    const org = capped.weights.slice(0, 5).reduce((t, w) => t + w.contribution, 0n);
    const all = capped.contributionTotal;
    const share = all === 0n ? 0 : Number((org * 1_000_000n) / all) / 1e6;
    const alone = tallyDualMajority(
      ws.slice(0, 5).map((w) => ({ accountId: w.accountId, choice: "yes" as const })),
      capped,
      GOVERNANCE_POLICY_V1,
      "routine",
    );
    rows.push([
      `${orgShare * 100}%`,
      others,
      `${fmt(share * 100, 1)}%`,
      capped.feasible ? "yes" : "no (tally refuses)",
      alone.passes ? "yes" : "no",
      share >= T ? "yes" : "no",
    ]);
  }
  return table(
    [
      "organization's raw share",
      "independent voters",
      "FINAL effective share (water-filling, H5)",
      "caps feasible",
      "org alone passes routine",
      "share >= routine threshold",
    ],
    rows,
  );
}

// ------------------------------------------------------------------------------------------------ timing (A3-14)

/**
 * A3-14: the Q3 ceiling is min(absolute ceiling, 1.5 x the mean realised rate of the last four epochs). It smooths; it
 * does not bound a quiet epoch against the immediately preceding one. One ACU submitted into an otherwise empty epoch 5
 * earns the ceiling; the table compares that with the previous epoch's realised rate.
 */
export function timingTable(params: EngineParams): string {
  const rows: (string | number)[][] = [];
  const W = 1_000_000n;
  for (const [name, prior] of [
    ["steady (100, 100, 100, 100)", [100, 100, 100, 100]],
    ["crowded then one very low epoch (100, 100, 100, 1)", [100, 100, 100, 1]],
    ["alternating (100, 1, 100, 1)", [100, 1, 100, 1]],
    ["recovering after two low epochs (1, 1, 100, 100)", [1, 1, 100, 100]],
  ] as const) {
    const trailing = BigInt(Math.round((prior.reduce((t, x) => t + x, 0) / prior.length) * 1e6));
    const res = computeEpoch(
      {
        epochNumber: 5,
        state: initialState(BigInt(REWARD_POLICY_V1.emission.emissionReserveBase)),
        consumedIds: new Set(),
        trailingRateBasePerAcu: trailing,
        receipts: [
          { receiptId: "quiet", accountId: "q", slice: "execution", weightMicro: W, featurePoolKeys: [], applicationPoolKeys: [] },
        ],
      },
      params,
    );
    const quiet = Number(res.rateCeilingBasePerAcu) / 1e6;
    const prev = prior[prior.length - 1]!;
    rows.push([name, fmt(prev, 2), fmt(Number(trailing) / 1e6, 2), fmt(quiet, 2), `${fmt(quiet / prev, 1)}x`]);
  }
  return table(
    ["prior realised WOS/ACU (epochs 1-4)", "epoch 4 rate", "trailing mean", "quiet epoch 5 pays (WOS/ACU)", "vs epoch 4"],
    rows,
  );
}

// ------------------------------------------------------------------------------------------------ report

export function report(policy: RewardPolicy = REWARD_POLICY_V1): string {
  const params = engineParamsFrom(policy, COMPLETION_POLICY_V1);
  const rng = mulberry32(SEED);
  const checkpoints = [1, 13, 52, 104, 208, 520];
  const parts: string[] = [];
  parts.push(
    `Seed ${SEED}. Policies: ${policy.policyVersion}, ${REVIEW_POLICY_V1.policyVersion}, ${COMPLETION_POLICY_V1.policyVersion}. Assumptions: ${Object.entries(
      ASSUMPTIONS,
    )
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}. Median contributor ACU/week = ${fmt(MEDIAN_ACU, 1)}.`,
  );
  let rate52 = 0;
  let earlyRate = 0;
  for (const s of SCENARIOS) {
    const rows = runScenario(s, params, rng, checkpoints);
    if (s.id === "S2") rate52 = rows.find((r) => r.epoch === 52)!.ratePerAcu;
    if (s.id === "S1") {
      // M16: the stated statistic — mean realised execution rate over live epochs 1–12 (here S1, 1,000 contributors).
      const first12 = runScenario(
        s,
        params,
        mulberry32(SEED + 3),
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
      earlyRate = first12.reduce((t, r) => t + r.ratePerAcu, 0) / first12.length;
    }
    parts.push(
      `### ${s.id}. ${s.title}\n\n${table(
        [
          "epoch",
          "active",
          "epoch budget (WOS)",
          "execution emitted (WOS)",
          "WOS per ACU",
          "median contributor WOS/week",
          "contributor zero WOS/week",
          "returned to reserve",
          "issued, % of max supply",
          "pools + security reserve (WOS)",
          "Codex share of execution",
        ],
        rows.map((r) => [
          r.epoch,
          fmt(r.active),
          fmt(r.budgetWos),
          fmt(r.execEmittedWos),
          fmt(r.ratePerAcu, 2),
          fmt(r.medianWeeklyWos, 0),
          fmt(r.founderWeeklyWos),
          `${r.returnedPct}%`,
          `${r.issuedPctOfMax}%`,
          fmt(r.poolsWos),
          `${r.codexExecSharePct}%`,
        ]),
      )}`,
    );
  }
  parts.push(`### A. Waste behaviours, receipt by receipt (Astra-01 item 5)\n\n${wasteTable()}`);
  parts.push(
    `### A2. Fabrication with real recovery: holdback, confiscation, exclusion, exit, churn, collusion, contaminated baselines (H4, D39, D40)\n\n${fabricationTable()}`,
  );
  parts.push(`### B. Skim attack: detection (D29)\n\n${skimTable()}`);
  parts.push(
    `### C. Skim attack: pattern-dispute economics at the S2 epoch-52 rate (${fmt(rate52, 2)} WOS/ACU)\n\n${skimBountyTable(rate52)}`,
  );
  parts.push(`### D. Collusion vs pool size (D24)\n\n${collusionTable()}`);
  parts.push(`### E. Payout canaries: time to catch an always-"plausible" client (D27)\n\n${canaryTable()}`);
  parts.push(`### F. Optimistic verification: detection vs cost (D28)\n\n${optimisticTable()}`);
  parts.push(`### G. Griefing economics at the S2 epoch-52 rate (D28, D31)\n\n${griefingTable(rate52)}`);
  parts.push(
    `### H. Genesis (reference: mean S1 rate over epochs 1–12) and provisional founder work (${fmt(earlyRate, 2)} WOS/ACU)\n\n${genesisTable(earlyRate)}`,
  );
  parts.push(`### I. Audit duty supply vs demand (D25, D28)\n\n${dutyTable()}`);
  parts.push(`### J. Governance capture vs threshold (D36)\n\n${captureTable()}`);
  parts.push(`### K. Governance concentration over time: contributor zero (D34, D37)\n\n${concentrationTable(params)}`);
  parts.push(`### L. Organization concentration and the per-organization cap (D38)\n\n${orgConcentrationTable()}`);
  parts.push(`### M. Quiet-epoch timing under the trailing-average ceiling (Q3, A3-14)\n\n${timingTable(params)}`);
  return parts.join("\n\n");
}

export const BEGIN = "<!-- SIM:BEGIN (generated by tools/tokenomics-sim; do not edit by hand) -->";
export const END = "<!-- SIM:END -->";

export function spliceInto(doc: string, generated: string): string {
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error("TOKENOMICS-SIMULATION.md is missing the SIM markers");
  return `${doc.slice(0, a + BEGIN.length)}\n\n${generated}\n\n${doc.slice(b)}`;
}

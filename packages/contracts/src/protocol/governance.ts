/**
 * DRAFT — policy governance (docs/protocol/GOVERNANCE.md, D34) and the settlement off-ramp (docs/protocol/OFF-RAMP.md,
 * D35). Pure definitions: votes are counted by deterministic functions so anyone can recount from the signed votes.
 */
import { z } from "zod";
import { Sha256, Timestamp, Uuid } from "../primitives.js";
import { SolanaAddress, U64String } from "./entities.js";
import { PolicyKind } from "./policies.js";

// ------------------------------------------------------------------------------------------------ governance (D34)

export const GovernancePolicy = z.object({
  policyVersion: z.string().regex(/^governance-policy\.v\d+$/),
  status: z.enum(["draft", "active", "retired"]),
  /** Who sets policy now. "founder" until the activation threshold is met (AdminAction); then "dual_majority". */
  mode: z.enum(["founder", "dual_majority", "contribution_only"]),
  activation: z.object({
    minEligibleVoters: z.number().int().positive(),
    /** Mainnet only: minimum WOS locked >= 12 months, in base units. */
    minLockedBase: U64String,
    /** No single voter may hold more than this share of either weight when governance activates. */
    maxSingleVoterShareBp: z.number().int().min(0).max(10_000),
  }),
  lock: z.object({
    minRemainingDays: z.number().int().positive(),
    /** Weight = amount while the remaining lock is >= minRemainingDays; 0 otherwise (re-locking restores it). */
    weightRule: z.literal("full_while_remaining_at_least_min"),
    /** Q9: a lock counts only if it existed at least this many full epochs before the snapshot. */
    seasoningEpochs: z.number().int().positive(),
    perWalletCapBp: z.number().int().min(0).max(10_000),
  }),
  contribution: z.object({
    windowEpochs: z.number().int().positive(),
    /** Linear age-out: a receipt's weight counts (window - age) / window. */
    decay: z.literal("linear_age_out"),
  }),
  /** Recommended (ADR-001): locked-token votes count only for voters with contribution weight > 0 in the window. */
  lockedVoterMustHaveContributed: z.boolean(),
  /** D44: groups are beneficial owners — an organization, or a person with every account and wallet they control. */
  beneficialOwner: z.literal("organization_or_person_with_all_controlled_accounts_and_wallets"),
  /** D38/D44: no organization's FINAL effective share of EITHER weight exceeds this (water-filling, capGroupShares). */
  orgCapBp: z.number().int().min(0).max(10_000),
  /**
   * Tiered supermajorities (D36), required in BOTH weights, each with its own turnout. Threshold = yes / (yes + no) of
   * the weight cast; turnout = weight cast (yes + no + abstain) / the eligible denominator at the snapshot. Denominators
   * are DISTRIBUTED, never max supply (D37): token side = WOS in contributor wallets locked >= 12 months at the
   * snapshot slot (unemitted supply, the protocol pool, multisig and wOS-controlled wallets never count; unclaimed
   * allocations cannot be locked, so they neither vote nor count); contribution side = the total contribution weight
   * of accounts with a live receipt in the trailing window. Changing these numbers is itself a `governance` tier change.
   */
  tiers: z.object({
    routine: z.object({
      thresholdBp: z.number().int().min(5001).max(10_000),
      turnoutLockedBp: z.number().int(),
      turnoutContributionBp: z.number().int(),
    }),
    structural: z.object({
      thresholdBp: z.number().int().min(5001).max(10_000),
      turnoutLockedBp: z.number().int(),
      turnoutContributionBp: z.number().int(),
    }),
    governance: z.object({
      thresholdBp: z.number().int().min(5001).max(10_000),
      turnoutLockedBp: z.number().int(),
      turnoutContributionBp: z.number().int(),
    }),
    emergency_ratification: z.object({
      thresholdBp: z.number().int().min(5001).max(10_000),
      turnoutLockedBp: z.number().int(),
      turnoutContributionBp: z.number().int(),
    }),
  }),
  votingHours: z.number().int().positive(),
  timelockEpochs: z.number().int().positive(),
  /** Per-change limits: a slice may move at most this many bp per activation; oracle rates at most maxOracleChangeBp. */
  limits: z.object({ maxSliceChangeBp: z.number().int().nonnegative(), maxOracleChangeBp: z.number().int().nonnegative() }),
  emergency: z.object({ multisigThreshold: z.string().regex(/^\d+-of-\d+$/), pauseMaxHours: z.number().int().positive() }),
});
export type GovernancePolicy = z.infer<typeof GovernancePolicy>;

export const GovernanceProposal = z.object({
  schema: z.literal("wos-governance-proposal.v1"),
  id: Uuid,
  kind: z.enum(["policy_change", "adapter_switch", "migration", "ratify_emergency", "governance_change"]),
  tier: z.enum(["routine", "structural", "governance", "emergency_ratification"]),
  policyKind: PolicyKind.nullable(),
  toVersion: z.string().nullable(),
  /** The policy PR in waronsaas/wos, with the what-if preview and the Astra + Fable exploit reviews attached. */
  prRef: z.string().regex(/^waronsaas\/wos#\d+$/),
  previewSha256: Sha256,
  exploitReviews: z.object({ astra: Sha256, fable: Sha256 }),
  snapshotEpoch: z.number().int().positive(),
  votingOpensAt: Timestamp,
  votingClosesAt: Timestamp,
  effectiveEpoch: z.number().int().positive(),
});
export type GovernanceProposal = z.infer<typeof GovernanceProposal>;

/** Off-chain signed vote (V1): signed by the voter's device key or bound wallet over JCS of the vote without signature. */
export const GovernanceVote = z.object({
  schema: z.literal("wos-governance-vote.v1"),
  proposalId: Uuid,
  accountId: Uuid,
  wallet: SolanaAddress.nullable(),
  choice: z.enum(["yes", "no", "abstain"]),
  signature: z.string().min(64),
});
export type GovernanceVote = z.infer<typeof GovernanceVote>;

export interface VoterWeights {
  accountId: string;
  /** Locked weight at the snapshot (already filtered by the lock rule and capped per wallet). */
  locked: bigint;
  /** Contribution weight at the snapshot (trailing window, linear age-out). */
  contribution: bigint;
}

/** Contribution weight of one receipt at `snapshotEpoch` (linear age-out over `windowEpochs`). */
export function contributionWeight(weightMicro: bigint, receiptEpoch: number, snapshotEpoch: number, windowEpochs: number): bigint {
  const age = snapshotEpoch - receiptEpoch;
  if (age < 0 || age >= windowEpochs) return 0n;
  return (weightMicro * BigInt(windowEpochs - age)) / BigInt(windowEpochs);
}

/**
 * Locked weight of one lock at the snapshot: full while the remaining lock is at least `minRemainingDays` AND the lock
 * is SEASONED — it existed at least `seasoningMs` (one full epoch) before the snapshot (Q9: a lock created just before
 * a predictable snapshot proves future illiquidity, not past commitment).
 */
export function lockedWeight(
  amountBase: bigint,
  lockEndsAtMs: number,
  snapshotAtMs: number,
  minRemainingDays: number,
  lockCreatedAtMs = Number.NEGATIVE_INFINITY,
  seasoningMs = 0,
): bigint {
  if (snapshotAtMs - lockCreatedAtMs < seasoningMs) return 0n;
  return lockEndsAtMs - snapshotAtMs >= minRemainingDays * 86_400_000 ? amountBase : 0n;
}

export type GovernanceTier = keyof GovernancePolicy["tiers"];

/**
 * Which tier a proposal needs (D36). Routine = a policy change of kind reward/review/risk/usage_proof/completion/
 * capability/merge whose every change is within the per-change limits. Structural = emission curve, supply, Genesis
 * cap, oracle beyond limits, new contribution categories, settlement adapter switches and migrations. Governance =
 * anything in the governance policy. Emergency ratification = ratifying a pause.
 */
export function proposalTier(
  kind: GovernanceProposal["kind"],
  policyKind: PolicyKind | null,
  touches: { emissionOrSupply: boolean; genesisCap: boolean; newCategory: boolean; withinLimits: boolean },
): GovernanceTier {
  if (kind === "ratify_emergency") return "emergency_ratification";
  if (kind === "governance_change" || policyKind === "governance") return "governance";
  if (kind === "adapter_switch" || kind === "migration") return "structural";
  if (touches.emissionOrSupply || touches.genesisCap || touches.newCategory || !touches.withinLimits || policyKind === "genesis")
    return "structural";
  return "routine";
}

export interface TallyResult {
  passes: boolean;
  tier: GovernanceTier;
  lockedYes: bigint;
  lockedNo: bigint;
  contributionYes: bigint;
  contributionNo: bigint;
  lockedTurnoutBp: number;
  contributionTurnoutBp: number;
  reasons: string[];
}

/**
 * A3-8: the ONLY input a tally accepts. Built by `governanceWeights`: eligibility is frozen FIRST (locked weight of a
 * voter without contribution in the window is zero when the policy says so), then each eligible leg is capped per
 * beneficial owner, and the totals are exactly those capped eligible legs. A plain structured object, so it survives
 * serialization; a missing or false `feasible` / `eligibilityApplied` is refused, never defaulted to success.
 */
export interface GovernanceWeights {
  schema: "wos-governance-weights.v1";
  weights: VoterWeights[];
  lockedTotal: bigint;
  contributionTotal: bigint;
  feasible: boolean;
  eligibilityApplied: boolean;
}

/**
 * Tiered dual supermajority (D34, D36, D37). Each weight must reach the tier's threshold of yes / (yes + no) and the
 * tier's turnout against its eligible, capped denominator. In contribution_only mode (off-ramp, D35) the locked leg is
 * skipped. Weights must come from `governanceWeights` (A3-8).
 */
export function tallyDualMajority(
  votes: ReadonlyArray<{ accountId: string; choice: "yes" | "no" | "abstain" }>,
  gw: GovernanceWeights,
  p: Pick<GovernancePolicy, "tiers" | "mode">,
  tier: GovernanceTier = "routine",
): TallyResult {
  const t = p.tiers[tier];
  const reasons: string[] = [];
  const valid = gw?.schema === "wos-governance-weights.v1" && gw.eligibilityApplied === true && Array.isArray(gw.weights);
  if (!valid) reasons.push("weights were not produced by governanceWeights (eligibility and caps must be applied first)");
  else if (gw.feasible !== true) reasons.push("caps infeasible: too few independent groups for every group to stay under its cap");
  const weights = valid ? gw.weights : [];
  const w = new Map(weights.map((x) => [x.accountId, x]));
  const seen = new Set<string>();
  let [ly, ln, cy, cn, lt, ct] = [0n, 0n, 0n, 0n, 0n, 0n];
  for (const v of votes) {
    if (seen.has(v.accountId)) continue; // one vote per account (the first counted; the signed log shows all)
    seen.add(v.accountId);
    const x = w.get(v.accountId);
    if (!x) continue;
    lt += x.locked;
    ct += x.contribution;
    if (v.choice === "yes") {
      ly += x.locked;
      cy += x.contribution;
    } else if (v.choice === "no") {
      ln += x.locked;
      cn += x.contribution;
    }
  }
  const totalLocked = valid ? gw.lockedTotal : 0n;
  const totalContribution = valid ? gw.contributionTotal : 0n;
  const bp = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 10_000n) / b));
  const meets = (yes: bigint, no: bigint) => yes + no > 0n && yes * 10_000n >= BigInt(t.thresholdBp) * (yes + no);
  const lockedLeg = p.mode !== "contribution_only";
  if (lockedLeg && !meets(ly, ln)) reasons.push(`locked weight below the ${tier} threshold`);
  if (!meets(cy, cn)) reasons.push(`contribution weight below the ${tier} threshold`);
  if (lockedLeg && bp(lt, totalLocked) < t.turnoutLockedBp) reasons.push("locked turnout below minimum");
  if (bp(ct, totalContribution) < t.turnoutContributionBp) reasons.push("contribution turnout below minimum");
  return {
    passes: reasons.length === 0,
    tier,
    lockedYes: ly,
    lockedNo: ln,
    contributionYes: cy,
    contributionNo: cn,
    lockedTurnoutBp: bp(lt, totalLocked),
    contributionTurnoutBp: bp(ct, totalContribution),
    reasons,
  };
}

// ------------------------------------------------------------------------------------------------ off-ramp (D35)

/**
 * The canonical record is the off-chain receipt/allocation ledger. Settlement is an adapter. Price is never a trigger.
 *   solana_wos        V1 devnet: SPL Token-2022 WOS, claim-triggered push transfers
 *   in_app_credits    non-transferable credits (the D3 model), balances derived from the same allocations
 *   paused_accrual    nothing is distributed; allocations keep accruing as claimable entitlements
 *   successor         a future token or chain, defined by a migration
 */
export const SettlementAdapterKind = z.enum(["solana_wos", "in_app_credits", "paused_accrual", "successor"]);
export type SettlementAdapterKind = z.infer<typeof SettlementAdapterKind>;

export const OffRampTrigger = z.enum(["security_incident", "chain_failure", "legal_order", "program_bug", "governance_decision"]);
export type OffRampTrigger = z.infer<typeof OffRampTrigger>;

export const SettlementAdapterEvent = z.object({
  seq: z.number().int().positive(),
  action: z.enum(["activate", "pause", "resume", "retire"]),
  adapter: SettlementAdapterKind,
  trigger: OffRampTrigger,
  /** Emergency pauses auto-expire; governance must ratify before this or distribution resumes. */
  expiresAt: Timestamp.nullable(),
  adminActionId: Uuid.nullable(),
  governanceProposalId: Uuid.nullable(),
  at: Timestamp,
});
export type SettlementAdapterEvent = z.infer<typeof SettlementAdapterEvent>;

/** What every settlement adapter implements. Idempotent by (epoch, leaf index); never the source of truth. */
export interface SettlementAdapter {
  readonly kind: SettlementAdapterKind;
  /** Pays one final claim leaf; returns an external reference (tx signature, credit entry id) or null when paused. */
  settle(leaf: {
    epochNumber: number;
    leafIndex: number;
    accountId: string;
    wallet: string | null;
    amountBase: bigint;
  }): Promise<string | null>;
  /** Reads back whether a leaf was settled (for retries after uncertain outcomes). */
  status(epochNumber: number, leafIndex: number): Promise<"settled" | "not_settled" | "unknown">;
  /** Proves the adapter's view of totals matches the ledger (reconciliation). */
  reconcile(epochNumber: number): Promise<{ settledBase: bigint; leaves: number }>;
}

/** A frozen snapshot for migration: anyone can recompute it from receipts and allocations. */
export const MigrationSnapshot = z.object({
  schema: z.literal("wos-migration-snapshot.v1"),
  id: Uuid,
  atEpoch: z.number().int().positive(),
  fromAdapter: SettlementAdapterKind,
  toAdapter: SettlementAdapterKind,
  adminActionsHead: Sha256,
  allocationsRoots: z.array(z.object({ epochNumber: z.number().int().positive(), root: Sha256 })),
  /** Per account: settled so far and final-but-unclaimed; the mapping pays exactly the unclaimed amounts. */
  balancesRoot: Sha256,
  unclaimedTotalBase: U64String,
  /** Deterministic mapping: "1:1 base units" unless governance publishes another rule before the snapshot. */
  mappingRule: z.string().min(3),
  claimWindowDays: z.number().int().positive(),
});
export type MigrationSnapshot = z.infer<typeof MigrationSnapshot>;

export const OFFRAMP_DISCLOSURE =
  "WOS may become worthless or be replaced. Your verified contribution records are permanent, and they are what any future settlement is based on." as const;

/**
 * H5 / D44: caps on FINAL effective share. Each beneficial-owner group (an organization, or a person with every wallet
 * and account they control) may hold at most its cap of the FINAL capped total of a weight — enforced mathematically by
 * water-filling: capped groups are scaled to exactly cap x T where T = rest / (1 - Σ caps of capped groups), iterated
 * until no uncapped group exceeds its cap. If the caps of all groups sum to <= 1 with nothing else, groups keep
 * proportional-to-cap weight. Turnout and thresholds then use the SAME capped total (consistent denominator). Integer
 * arithmetic: weights are scaled so shares hold to the unit.
 */
export function capGroupShares(groups: ReadonlyArray<{ groupId: string; weight: bigint; capBp: number }>): {
  shares: Map<string, bigint>;
  feasible: boolean;
} {
  const shares = new Map<string, bigint>();
  const live = groups.filter((g) => g.weight > 0n); // A3-8: a zero-weight group holds no share and caps nothing
  let capped = new Set<string>();
  for (let iter = 0; iter <= live.length; iter++) {
    const rest = live.filter((g) => !capped.has(g.groupId)).reduce((t, g) => t + g.weight, 0n);
    const capSum = live.filter((g) => capped.has(g.groupId)).reduce((t, g) => t + BigInt(g.capBp), 0n);
    if (capSum >= 10_000n || (rest === 0n && capped.size > 0)) {
      // Infeasible: too few independent groups for every cap to hold (e.g. two groups with 10% caps). Shares fall back
      // to proportional-to-cap and the tally refuses to pass anything (H5: the promise is never silently broken).
      for (const g of groups) shares.set(g.groupId, capped.has(g.groupId) ? BigInt(g.capBp) * 1_000_000n : 0n);
      return { shares, feasible: false };
    }
    // T = rest / (1 - capSum); a capped group gets cap x T. Scale by 1e6 to keep precision in integers.
    const T = (rest * 10_000n * 1_000_000n) / (10_000n - capSum);
    const next = new Set(capped);
    for (const g of live) {
      if (!capped.has(g.groupId) && g.weight * 1_000_000n * 10_000n > BigInt(g.capBp) * T) next.add(g.groupId);
    }
    if (next.size === capped.size) {
      for (const g of groups) shares.set(g.groupId, capped.has(g.groupId) ? (BigInt(g.capBp) * T) / 10_000n : g.weight * 1_000_000n);
      return { shares, feasible: true };
    }
    capped = next;
  }
  throw new Error("capGroupShares did not converge");
}

/**
 * A3-8: builds the tally's weights. (1) Eligibility first: with `lockedVoterMustHaveContributed`, a voter without
 * contribution weight has zero locked weight. (2) Group by beneficial owner (organization, else the declared owner or the
 * account). (3) Cap each ELIGIBLE leg by water-filling: people at `perWalletCapBp`, organizations at `orgCapBp`, so no
 * group's final share of the eligible capped total exceeds its cap. (4) The totals are exactly those capped legs.
 * Voters in a group share its capped weight in proportion to their eligible raw weight; units are x1e6.
 */
export function governanceWeights(
  raw: readonly (VoterWeights & { organizationId: string | null; ownerId?: string })[],
  p: { perWalletCapBp: number; orgCapBp: number; lockedVoterMustHaveContributed: boolean },
): GovernanceWeights {
  const eligible = raw.map((w) => ({ ...w, locked: p.lockedVoterMustHaveContributed && w.contribution === 0n ? 0n : w.locked }));
  let feasible = true;
  const groupOf = (w: (typeof eligible)[number]) => (w.organizationId ? `org:${w.organizationId}` : `owner:${w.ownerId ?? w.accountId}`);
  const capOf = (g: string) => (g.startsWith("org:") ? p.orgCapBp : p.perWalletCapBp);
  const leg = (pick: (w: VoterWeights) => bigint) => {
    const rawG = new Map<string, bigint>();
    for (const w of eligible) rawG.set(groupOf(w), (rawG.get(groupOf(w)) ?? 0n) + pick(w));
    const cg = capGroupShares([...rawG].map(([groupId, weight]) => ({ groupId, weight, capBp: capOf(groupId) })));
    if (!cg.feasible && [...rawG.values()].some((v) => v > 0n)) feasible = false;
    return (w: (typeof eligible)[number]) => {
      const g = groupOf(w);
      const total = rawG.get(g) ?? 0n;
      return total === 0n ? 0n : ((cg.shares.get(g) ?? 0n) * pick(w)) / total;
    };
  };
  const L = leg((w) => w.locked);
  const C = leg((w) => w.contribution);
  const weights = eligible.map((w) => ({ accountId: w.accountId, locked: L(w), contribution: C(w) }));
  return {
    schema: "wos-governance-weights.v1",
    weights,
    lockedTotal: weights.reduce((t, x) => t + x.locked, 0n),
    contributionTotal: weights.reduce((t, x) => t + x.contribution, 0n),
    feasible,
    eligibilityApplied: true,
  };
}

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
    perWalletCapBp: z.number().int().min(0).max(10_000),
  }),
  contribution: z.object({
    windowEpochs: z.number().int().positive(),
    /** Linear age-out: a receipt's weight counts (window - age) / window. */
    decay: z.literal("linear_age_out"),
  }),
  /** Recommended (ADR-001): locked-token votes count only for voters with contribution weight > 0 in the window. */
  lockedVoterMustHaveContributed: z.boolean(),
  /** D38: an organization's share of EACH weight is capped at the snapshot (applied after per-wallet caps). */
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

/** Locked weight of one lock at the snapshot: full while the remaining lock is at least `minRemainingDays`. */
export function lockedWeight(amountBase: bigint, lockEndsAtMs: number, snapshotAtMs: number, minRemainingDays: number): bigint {
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
 * Tiered dual supermajority (D34, D36, D37). Each weight must reach the tier's threshold of yes / (yes + no) and the
 * tier's turnout against its eligible denominator. In contribution_only mode (off-ramp, D35) the locked leg is skipped.
 */
export function tallyDualMajority(
  votes: ReadonlyArray<{ accountId: string; choice: "yes" | "no" | "abstain" }>,
  weights: readonly VoterWeights[],
  p: Pick<GovernancePolicy, "tiers" | "lockedVoterMustHaveContributed" | "mode">,
  tier: GovernanceTier = "routine",
): TallyResult {
  const t = p.tiers[tier];
  const w = new Map(weights.map((x) => [x.accountId, x]));
  const seen = new Set<string>();
  let [ly, ln, cy, cn, lt, ct] = [0n, 0n, 0n, 0n, 0n, 0n];
  const lockedOf = (x: VoterWeights) => (p.lockedVoterMustHaveContributed && x.contribution === 0n ? 0n : x.locked);
  for (const v of votes) {
    if (seen.has(v.accountId)) continue; // one vote per account (the first counted; the signed log shows all)
    seen.add(v.accountId);
    const x = w.get(v.accountId);
    if (!x) continue;
    const locked = lockedOf(x);
    lt += locked;
    ct += x.contribution;
    if (v.choice === "yes") {
      ly += locked;
      cy += x.contribution;
    } else if (v.choice === "no") {
      ln += locked;
      cn += x.contribution;
    }
  }
  const totalLocked = weights.reduce((s, x) => s + lockedOf(x), 0n);
  const totalContribution = weights.reduce((s, x) => s + x.contribution, 0n);
  const bp = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 10_000n) / b));
  const meets = (yes: bigint, no: bigint) => yes + no > 0n && yes * 10_000n >= BigInt(t.thresholdBp) * (yes + no);
  const reasons: string[] = [];
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
 * Applies the per-wallet cap, then the per-organization cap (D38), to each weight at the snapshot. Caps are shares of
 * the UNCAPPED eligible total of that weight; the capped excess simply does not vote (it is not redistributed).
 */
export function applyWeightCaps(
  weights: readonly (VoterWeights & { organizationId: string | null })[],
  p: { perWalletCapBp: number; orgCapBp: number },
): VoterWeights[] {
  const totalL = weights.reduce((t, w) => t + w.locked, 0n);
  const totalC = weights.reduce((t, w) => t + w.contribution, 0n);
  const walletCapL = (totalL * BigInt(p.perWalletCapBp)) / 10_000n;
  const capped = weights.map((w) => ({ ...w, locked: w.locked < walletCapL ? w.locked : walletCapL }));
  const orgCapL = (totalL * BigInt(p.orgCapBp)) / 10_000n;
  const orgCapC = (totalC * BigInt(p.orgCapBp)) / 10_000n;
  const byOrg = new Map<string, { l: bigint; c: bigint }>();
  for (const w of capped) {
    if (!w.organizationId) continue;
    const o = byOrg.get(w.organizationId) ?? { l: 0n, c: 0n };
    byOrg.set(w.organizationId, { l: o.l + w.locked, c: o.c + w.contribution });
  }
  return capped.map((w) => {
    if (!w.organizationId) return { accountId: w.accountId, locked: w.locked, contribution: w.contribution };
    const o = byOrg.get(w.organizationId)!;
    const scale = (x: bigint, total: bigint, cap: bigint) => (total <= cap || total === 0n ? x : (x * cap) / total);
    return { accountId: w.accountId, locked: scale(w.locked, o.l, orgCapL), contribution: scale(w.contribution, o.c, orgCapC) };
  });
}

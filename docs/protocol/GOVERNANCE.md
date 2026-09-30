# GOVERNANCE (DRAFT) — who sets the policy numbers

Decisions: D33 (numbers are policy data), D34 (locked tokens + contribution), D36 (tiered supermajorities), D37 (distributed denominators), D38 (organization caps), D35 (off-ramp fallback). Contracts: `GovernancePolicy`, `GovernanceProposal`, `GovernanceVote`, `tallyDualMajority`, `applyWeightCaps`, `proposalTier`, `contributionWeight`, `lockedWeight` (`protocol/governance.ts`; data `governance-policy.v1.json`). DB: `governance_proposals`, `governance_weight_snapshots`, `governance_votes`.

## 1. Two weights, both required

- **Locked-token weight.** Only WOS in contributor wallets (person or organization beneficiaries) locked with at least **365 days remaining** at the snapshot counts, at full weight; below 365 days it counts zero; re-locking restores it. **Seasoning (Q9, D44):** a lock counts only if it existed at least one full epoch before the snapshot — a lock created just before a predictable snapshot proves future illiquidity, not past commitment. We chose "full while ≥ 12 months remain" over vote-escrow decay because it is simpler to verify and matches the founder's rule; decay can be added later at the governance tier.
- **Contribution weight.** The effective weight (micro-ACU and ACU-equivalents, all contribution types, from the reward engine) of receipts in live epochs over the trailing **26 epochs**, aging out linearly (a receipt 13 epochs old counts half). Earned and non-transferable.
- **Recommended eligibility rule (adopted in the draft):** locked tokens vote only if the voter also has contribution weight > 0 in the window. Argument: WOS is a contribution token, not an investment; this blocks pure capital from buying policy while still giving holders who contribute a voice. Cost: passive holders cannot vote; acceptable.
- **Caps at the snapshot (H5, D44):** each beneficial-owner group — an organization, or a person with every account and wallet they control — may hold at most its cap (people 5%, organizations 10%) of the FINAL capped total of EACH weight. Enforced mathematically by water-filling (`capGroupShares`): capped groups get exactly cap × T with T = uncapped weight / (1 − Σ caps), iterated to a fixed point. If there are too few independent groups for every cap to hold (e.g. two organizations), the tally refuses to pass anything. Astra-02's counterexample (one organization with 90% of the weight and 50 outsiders) now ends at 10.0% and cannot pass anything alone (tests; TOKENOMICS-SIMULATION L). The organization votes with its own capped weight (D45); an excluded account has zero weight.

## 2. Denominators (D37)

- **Consistent denominators (H5):** thresholds and turnout both use the FINAL capped totals.
- **Token side:** the eligible (seasoned) locked weight in contributor wallets at the snapshot, after caps. Never max supply. Never unemitted supply, the pools or security reserve, the emission escrow, multisig holdings or any wOS-controlled wallet. **Claimable-but-unclaimed allocations do not count**: they cannot be locked until claimed, and counting weight that cannot vote would make turnout unreachable.
- **Contribution side:** the total contribution weight of accounts with a live receipt in the trailing 26 epochs.
- **Snapshot:** the end of the most recent FINALIZED epoch before the proposal opens (UTC); on-chain locks are read at the first slot after that instant (published with the proposal). Borrowed or flash-locked tokens after the snapshot do not count.

## 3. Tiers (D36)

A proposal passes only if, in **both** weights, yes / (yes + no) reaches the tier threshold **and** turnout (yes + no + abstain over the denominator) reaches the tier minimum.

| Tier | What | Threshold | Turnout (locked / contribution) |
|---|---|---|---|
| routine | parameter changes within per-change limits: audit/canary rates, challenge window, stakes, bounties, epoch slices within ±5 pp, completion splits, oracle within ±30% | 60% | 20% / 20% |
| structural | emission curve, supply, Genesis cap, the ceiling, new contribution categories, settlement adapter switch, migration, authorities, anything beyond per-change limits | **70%** (recommended within the founder's 66–75% range: two-thirds plus a margin against a single large bloc) | 30% / 30% |
| governance | thresholds, turnout, lock length, contribution window, caps, emergency powers, this table | 75% | 40% / 40% |
| emergency ratification | ratifying an emergency pause (it auto-expires regardless) | simple majority (> 50%) | 10% / 10% |

All thresholds are themselves policy data changeable only at the governance tier. Capture analysis (TOKENOMICS-SIMULATION J): against full opposition a bloc needs the threshold itself in both weights; against apathetic opponents (20% turnout) a bloc of 23% can pass routine changes, 32% structural, 38% governance.

## 4. Guardrails

1. A proposal is a **policy PR** in `waronsaas/wos` containing the new policy file, the what-if preview (`tools/tokenomics-sim/preview.ts`, sha256 recorded) and Astra + Fable exploit reviews (both sealed, max permitted effort, attached by hash).
2. Voting lasts 7 days; votes are signed (device key or bound wallet) and counted off chain by the deterministic tally, publicly recountable.
3. **Timelock:** at least one epoch between passing and effect; effect is forward-only from a future epoch (D33, DB `check_policy_activation`).
4. **Per-change limits:** ≤ 5 percentage points per slice per activation, oracle ≤ 30% per version; larger moves are structural.
5. **Emergency:** a Squads 3-of-5 may pause the settlement adapter for ≤ 14 days (auto-expiring, DB-enforced), must seek ratification, and has no power over policy, supply or balances.

## 5. Bootstrap: founder mode until activation

Until mainnet there are no real locked tokens. V1 therefore:
- runs **founder mode**: the founder sets policy by AdminAction (reason, announced ≥ 72 h ahead, preview attached, forward-only);
- rehearses governance **off chain** with devnet locks and real contribution weight, with results published but non-binding;
- activates governance when all hold (policy data, F10): ≥ 50 eligible voters, ≥ 10,000,000 WOS locked ≥ 12 months (mainnet), and no single voter (after caps) above 20% of either weight.

**Honest concentration statement.** Early weight concentrates with contributor zero: in a network of the founder plus 5 contributors, the founder holds about 23% of contribution weight and 72% of locked weight (including vested Genesis) and would meet routine turnout alone if nobody else voted (TOKENOMICS-SIMULATION K). With 1,000 or more contributors the founder's share is below 2% of contribution weight and about 1% of locked weight. That is why founder mode is explicit rather than disguised as a vote, and why activation requires breadth.

## 6. Off-ramp fallback (D35)

If the token adapter is paused or retired, or locked weight becomes meaningless, governance switches to **contribution-only** mode (the locked leg is skipped; tiers and turnout apply to contribution weight). Switching is a governance-tier decision, except that an emergency pause of more than 14 days switches automatically until the pause is lifted.

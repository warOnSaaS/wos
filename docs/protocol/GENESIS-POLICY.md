# GENESIS-POLICY (DRAFT) — historical credit for pre-protocol work

Contracts: `GenesisAllocationPolicy` (`genesis-policy.v1.json`), `GenesisContribution`. DB: `genesis_contributions`, `work_dedup_keys`. Decisions: A6, D23; Astra-01 item 9.

## 1. What Genesis is and is not

A6 option 2: a one-time, transparent, **capped** credit for work done before the protocol existed (building V1 itself), computed from recorded evidence by this published rule. It is not a premine and not discretionary: the rule, the evidence, the computation and the approval are public, the cap is published in advance, and the credit is issued only under the conditions below. It is a **distinct category** ("historical credit"), never mixed into epoch slices and never presented as verified compute.

## 2. Evidence (accepted output only)

- **Eligible:** commits merged to `waronsaas/wos` main before the first ContributionReceipt of live epoch 1 (the cutoff), grouped into **retro ABUs**: the already-built features of the TGT-00 roadmap mapped to size points (1, 2, 3, 5, 8) exactly as a feature contract would, in a **retro roadmap PR** that goes through the normal Astra + Fable review (a protocol-class change).
- **Supporting:** the wave reports (`docs/architecture/WAVE-*-REPORT.md`) and dogfood notes, hashed.
- **Not eligible:** token usage reconstructed from commits or local transcripts (commits prove authorship and accepted output, not consumption), test-epoch allocations, PROVISIONAL receipts, anything after the cutoff (that work gets ordinary receipts).
- Each retro ABU is one `GenesisContribution` with a dedup key `work:waronsaas/wos:<feature>#<nn>` in the **shared** `work_dedup_keys` namespace, so no work is credited both as Genesis and by a receipt (DB-enforced).
- Contributors: whoever authored the merged work (V1: the founder, as contributor zero). Anyone else with pre-protocol merged work is eligible under the same rule.

## 3. Valuation (D48)

```
genesisWeight            = Σ retro size points × referenceAcuPerSizePoint
referenceAcuPerSizePoint = median eligible ACU per size point of the FROZEN reference population
                           (merged IMPLEMENTATION receipts of live epochs 1–12, >= 30 receipts)
genesisWOS               = min(cap, genesisWeight × mean issuance rate (WOS per ACU of budget) over live epochs 1–12)   (D49)
fallback                 = min(cap, retro size points × 400 WOS)   if the population is insufficient
cap                      = 5,000,000 WOS (0.5% of max supply)
```

- **Frozen reference population** (M16, v3 Astra-03 M12): ONE content-addressed manifest per version (`genesis_reference_manifests`: cutoff epoch, selection rules, the complete receipt list, and a two-person approval bound to the manifest hash). Nothing can be added after it is written. Every listed receipt must exist, be ACTIVE or RATIFIED and admitted by the cutoff. It excludes every Genesis beneficiary and their related parties, checked in BOTH insertion orders (a later Genesis contribution by a related party is refused). Commit-derived evidence must be fully covered by canonical commit-to-unit mappings (checked at commit), and a commit that is a merged live attempt is never Genesis. Who the independent approvers are (this document says ≥ 2 non-founder humans; the DB checks two maintainers) is founder decision F21.
- **The stated statistic, exactly:** epochs 1–12, not checkpoints; the simulation now computes it that way (table H: ~98 WOS/ACU in a 1,000-contributor network).
- **Canonical work mapping:** each merged pre-protocol commit maps to exactly one retro unit (`genesis_commit_claims` primary key on the commit sha), so overlapping work cannot be credited under two keys; retro units also share the dedup namespace with receipts.

Illustration (table H, assumptions, not the founder's figures): 2,000 retro size points ≈ 780,000 WOS at the reference rate, 800,000 by fallback — both well under the cap.

## 4. Approval

A protocol-class review of the retro roadmap PR and of the computation by **at least two independent authorized humans, never the founder**, plus Astra and Fable. The computation is recomputable from the listed evidence hashes and the reference epochs' public receipts. `record_genesis` is a two-person AdminAction.

## 5. Issuance and vesting

- **Never on devnet** (`mintOnDevnet: false`); devnet shows the computed figure labelled "not issued; mainnet only".
- **Mainnet only**, after the legal checkpoint, vesting linearly over **2 years** from launch with no cliff, released by the protocol as scheduled entitlements each epoch (SOLANA-ARCHITECTURE §5b) — so unreleased Genesis remains confiscatable after proven cheating (D39). The unused part of the cap is never minted.
- Unvested Genesis does not vote; vested Genesis can be locked like any WOS (GOVERNANCE.md).
- 1 devnet WOS ≠ 1 mainnet WOS; no conversion ratio is promised for anything.

## 6. The founder's post-cutoff work

Merged under bootstrap authority → PROVISIONAL receipts (D23). They are counted in test epochs only. **D54:** when bootstrap ends each is published with a challenge window; silence finalizes it — it becomes qualifying and Genesis-eligible with its original timestamp and enters the live epoch then OPEN, like anyone's work; a challenge sends it to the review gate. (Before D54 they needed an independent ratification and never counted toward Genesis — table H, second part, models that older rule.)

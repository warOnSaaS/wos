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

## 3. Valuation

```
genesisWeight  = Σ retro size points × referenceAcuPerSizePoint
referenceAcuPerSizePoint = median eligible ACU per size point of merged IMPLEMENTATION receipts in live epochs 1–12 (≥ 30 receipts)
genesisWOS     = min(cap, genesisWeight × mean realised execution rate (WOS/ACU) over live epochs 1–12)
cap            = 5,000,000 WOS (0.5% of max supply)
```

Illustration (TOKENOMICS-SIMULATION table H, assumptions, not the founder's figures): 2,000 retro size points at 4 ACU per point and ~42 WOS/ACU ≈ 340,000 WOS, well under the cap. The cap is a guarantee, not an expectation.

## 4. Approval

A protocol-class review of the retro roadmap PR and of the computation by **at least two independent authorized humans, never the founder**, plus Astra and Fable. The computation is recomputable from the listed evidence hashes and the reference epochs' public receipts. `record_genesis` is a two-person AdminAction.

## 5. Issuance and vesting

- **Never on devnet** (`mintOnDevnet: false`); devnet shows the computed figure labelled "not issued; mainnet only".
- **Mainnet only**, at launch, after the legal checkpoint, into a linear **2-year vesting** position with no cliff, through an audited vesting mechanism (SOLANA-ARCHITECTURE §5b). The unused part of the cap is never minted.
- Unvested Genesis does not vote; vested Genesis can be locked like any WOS (GOVERNANCE.md).
- 1 devnet WOS ≠ 1 mainnet WOS; no conversion ratio is promised for anything.

## 6. The founder's post-cutoff work

Merged under bootstrap authority → PROVISIONAL receipts (D23). They are counted in test epochs only; when an independent auditor quorum or non-founder human ratifies them they enter the live epoch then OPEN, with their original timestamps, like anyone's work. They never count toward Genesis (table H, second part).

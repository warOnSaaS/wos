# REWARD-PROTOCOL v4 (DRAFT, budget-based rewards D49; after Astra review 03) — how contribution becomes WOS

Version: `reward-protocol.v2-draft` (supersedes `docs/architecture/REWARD-PROTOCOL.md` v1 when activated; SUPERSESSION.md says which v1 rules survive). Normative code: `packages/contracts/src/protocol/engine.ts` (the only implementation of the math; the rewards package will call it). Normative data: `packages/contracts/src/protocol/data/*.v1.json` (all `status: draft`). **Every number here is provisional policy data, expected to change (D33).**

## 1. Principles

1. Proof of Contribution: the protocol records verified contribution and allocates by published rules. No payments, no promises of amounts before finalization.
2. Provider tokens ≠ ACU ≠ WOS. Provider tokens are never mapped to a fixed WOS amount.
3. **D49 (supersedes A2): commissioned work is paid its BUDGET.** Every build unit and every commissioned review, audit, resolution and planning task carries a reward budget in ACU fixed before work starts; acceptance pays exactly that budget, split by the collaborators' declared shares. Token usage is telemetry and never a payout input.
4. Planning, ideas, bugs and security are weighted by **outcome** (A3).
5. One conserved funding equation; every WOS allocated debits an identified budget.
6. Deterministic and reproducible from public data; integer arithmetic only.
7. Forward-only: a policy change never touches a published or finalized allocation.

## 2. Units

| Unit | Definition | Representation |
|---|---|---|
| provider token | as the CLI reports it, in five mutually exclusive categories: uncached input, cache read, cache write, output (reasoning included), and reasoning (informational subset) | integers |
| ACU | normalised agent compute; 1 ACU = 1,000,000 micro-ACU | micro-ACU as decimal strings (u64) |
| ACU-equivalent | a fixed weight for outcome work, in the same micro-ACU scale | same |
| WOS | the Solana token, 6 decimals; 1 WOS = 1,000,000 base units | base units as decimal strings (u64) |

## 3. ACU and the ModelRateOracle

`acuMicro = floor(Σ tokens_c × rate_c / 1,000,000)` over the four priced categories, with rates in micro-ACU per million tokens from the oracle version **pinned at lease issue** (run-policy snapshot). Oracle v1 calibration: 1 ACU = the provider's published standard API list price of USD 1 for the same tokens at the time of the version. ACU is never shown as money.

**Draft oracle v1** (every rate `verified: false` until checked on the providers' own price pages; `model-rate-oracle.v1.json`):

| Model | input | cache read | cache write | output | source |
|---|---|---|---|---|---|
| claude-opus-5-5 | 4.0 | 0.20 | 5.0 | 20.0 | Anthropic model table (claude-api reference, cached 2026-09-25) |
| claude-fable-5-1 | 10.0 | 0.25 (suspect) | 12.5 | 50.0 | same; the cache-read figure looks wrong and must be checked |
| gpt-6-astra | 10.0 | 1.0 | 12.5 | 50.0 | third-party summaries (web search, 2026-09-29) |
| gpt-6-sol | 2.0 | 0.20 | 2.5 | 10.0 | third-party summaries |

(ACU per million tokens.) Since D49 the oracle prices TELEMETRY (cap enforcement, budget calibration, model comparisons) and the budget model's expected compute; it never converts a contributor's tokens into pay. A provider price change therefore moves nobody's share (S8).

### Is list-price normalisation right? Alternatives evaluated

| Option | For | Against | Verdict |
|---|---|---|---|
| **API list price (chosen)** | public, comparable across vendors and token types, prices cached vs output correctly | commercial not physical; subscription users pay flat; provider price changes move shares (S8: Codex 40% → 25% of execution after a 50% cut) | keep, with damping |
| raw tokens | trivial | tokenizers differ; an output token and a cache-read token differ ~100× in cost | reject |
| output tokens only | resists context inflation | ignores real input work; rewards verbose output | reject |
| FLOP / energy estimates | "physical" | unknowable for closed models | reject |
| reference-model equivalents (tokens × quality) | rewards capability | needs a benchmark we do not have; circular | later, via ModelQualificationSuite |
| task standard (size points × reference ACU) | removes the inflation incentive | needs a calibrated model | **adopted by D49** as the budget model's basis (ACU stays the unit of account; usage calibrates it) |

**Oracle rules:** a new version takes effect only at an epoch boundary, announced ≥ 72 h before (D33); no rate moves more than 30% per version (`maxChangePerVersionBp`) unless a structural-tier decision allows it (founder AdminAction in founder mode, a structural vote later); when an oracle version changes, the rate ceiling is re-based in the same activation so a price fall does not silently cut emission (S7).

## 4. Budgets (D49), execution caps and telemetry

- **Budget model.** `model = base + perSizePoint × size` per task kind (`capability-policy.v1.json` `budgets`: build 4 ACU per size point; reviews 3 ACU + 1 per size point; roadmap 60, contract 30, …), × difficulty (0.5–2.0) × importance/shared-dependency (1.0–1.5), versioned (`budget_model_version`). The proposer (the decomposer or contract author) proposes each task's budget with its basis; Astra and Fable review it in consensus (**an unjustified budget is a material finding**) against peer budgets of comparable tasks; a budget above 1.25× the model needs a written justification and a two-person `approve_budget` action bound to the amount; above 2× it is refused. The proposer and related accounts may not take the task's lease.
- **Acceptance objectives.** Each contract criterion / planning deliverable / review round / audit / resolution has an objective budget fixed at consensus; the budgets of all tasks under it never exceed it, so splitting one unit into several cannot raise what the objective pays (DB `acceptance_objectives`).
- **Reservation at issuance (the epoch contract).** When a task is issued, `budget × issuance rate` is reserved from the epoch's task capacity (the execution, planning and human-review slices, pooled). A task that does not fit is not issued; it waits for the next epoch. Nothing accepted is ever scaled down. The issuance rate is announced before issuance: `min(ceiling_e, capacity / queued demand)` — it falls ex ante with participation instead of ex post. An issued task not accepted within 4 epochs expires and returns its reservation; re-issuing re-prices it at the current rate and model.
- **Acceptance.** Binary in V1 (`R_ij = B_i × a_i × s_ij`, a_i ∈ {0, 1}; no quality factor — founder decision F22). Declared shares sum to exactly 10,000 bp (DB, at commit); the engine splits each reservation by largest remainder, exactly; each contributor's share goes to their sponsorship beneficiary.
- **Execution cap (telemetry).** The client still stops the agent at the lease's execution cap (usage telemetry); overshoot earns nothing and costs the contributor. Usage receipts, run logs (now optional evidence) and verification levels feed calibration, anomaly signals and model comparisons only.
- **Calibration.** Every 13 epochs the budget model is re-fitted from the telemetry of ACCEPTED tasks (≥ 20 samples per key), moving at most 20% per step, so overpriced "easy" tasks and prices falling over time are corrected (TOKENOMICS-SIMULATION P).
- **Agent reviewers** are paid their review task's budget; +10% of it per material finding later resolved or upheld (max 5). Failed, abandoned or rejected work earns nothing and releases its reservation.

## 5. The conserved funding equation (Astra-01 item 4, Astra-02 H1)

State after every epoch: R = remaining emission reserve, P = Σ completion pool balances, S = security reserve, Q = Σ budgets reserved for issued tasks (D49), I = cumulative issuance to beneficiaries (released, held back, or final but unclaimed); holdback tranches are part of I.

```
R + ΣP + S + ΣQ + I = emissionReserve (995,000,000 WOS),   R, P_k, S, Q_t, I >= 0,   Σ holdback + Σ claimable <= I
maxSupply = emissionReserve + GenesisCap = 1,000,000,000 WOS
```

`computeEpoch` asserts this — equality AND non-negative balances AND Σ claimable + Σ holdback ≤ I — on its input and on its output. v3 (Astra-03 M10): the state also records who owns the claimable part of I (`claimable`, per beneficiary) and each holdback tranche with the maturity epoch and policy version fixed when it was created, so a return, a confiscation or a claim must name an owner with a balance; `consumedIds` (replay state) is required. Every movement names its source and every event id is consumed once (inside an input and against `consumedIds`; the DB enforces the same with source balances and unique keys, migration 0007 §10b and §10d):

1. **Returns** (identified): `unbound_expiry` (an entitlement unclaimed for 52 epochs: I → R), `pool_cancel` (a removed or aliased feature's pool: P → R), `holdback_forfeit` (exclusion: tranches and I → R). **Accrual corrections**: completion accrual attributed to work later clipped or revoked (P → R).
2. **Confiscations** (D39): identified holdback tranches and unclaimed entitlements (I → R); bounty ≤ 20% of what was recovered; any proven excess not recovered becomes an offset.
3. **Dispute settlements**: escrowed excess of clipped/revoked lines (I → R); bounty ≤ 20% of recovered (all of it, since it was escrowed).
4. **Write-offs** (D41): offsets that can no longer be collected (excluded or exited beneficiary) become a loss carried forward.
5. **Budget**: `B = floor(R × 3,327 / 1,000,000) − absorbed`, where `absorbed = min(loss carry, 10% of the full budget)` — unrecovered fraud reduces the next pools, bounded and published; `R -= B`.
6. **Slices** (largest remainder, exact): execution 6000, planning 1000, human_review 500 (together: the pooled **task capacity**), outcomes 500, completion_accrual 1500, security_reserve 500 bp.
7. **Acceptances, releases, expiry, issuance (D49).** Accepted tasks move their reservation Q → I, split by declared shares; released or expired tasks move Q → R; new tasks are issued in priority order, R → Q, while they fit the capacity. **Outcomes** (proposals, bugs) still emit `min(slice, rate × weight)` with exact per-beneficiary rounding (L16).
8. **Accrual slices** accrue `slice × (reserved + outcomes emitted) / (task capacity + outcomes slice)`; nothing in an empty epoch; completion accrual to feature pools (2/3) and application pools (1/3) pro rata to the execution budgets issued per key; security accrual to S.
9. **Pool payouts** (H13): feature pools by components (75/10/5/8/2); **application pools 100% by lifetime weight**; a component with nobody returns to R; one terminal disposition per pool (DB).
10. **Security payouts**: `min(weight × issuance rate, 25% of S)`, once per security receipt.
11. **Offsets** recovered from each beneficiary's gross, ≤ 50% of it; recovered amounts return to R.
12. **Holdback** (D40 as re-sized by D49): each beneficiary's net is split into `releasedNow` and a new tranche; recommended 20% held for 6 epochs (founder decision F15) — it now protects against defective work and misattribution surfacing after acceptance, not usage fraud. Tranches mature at the epoch pinned when they were created. Bounties are released in full.

**Unclaimed:** a final entitlement stays claimable while the beneficiary has a bound wallet; unbound, it carries 52 epochs, then returns (step 1). **Supply:** WOS is minted only when a leaf is settled on devnet, or into the emission escrow on mainnet; nothing above `maxSupply`; the unused Genesis cap is never minted.

## 6. The issuance rate (was: the rate ceiling)

`ceiling_e = floor(100 WOS/ACU × (1 − 3,327/1,000,000)^(e−1))`, floored every epoch; the issuance rate of epoch e is `min(ceiling_e, task capacity / queued demand)`, announced before issuance and **fixed for each task when it is issued**. It binds when participation is low (S1, S6, S9): contributor zero alone receives at most 100 WOS per ACU of budget early, less later, and the unused capacity stays in the reserve. Without the ceiling (S10) the rate would be whatever the capacity divided by one person's demand gives — about 2,000,000 WOS a week to contributor zero. Because the price is fixed at issuance, **when a task is accepted cannot change what it pays**: the v3 trailing-rate damping (Q3) and its residual timing gain (Astra-03 M14, F19) are gone.

## 7. Planning, outcomes, human review, completion

- **Planning** (A3, D49): roadmap and feature-contract authoring and review tasks are budgeted like build units (planning kind), paid when their revision is in the merged version; plus shares of feature pools (below).
- **Proposals:** 10 ACU-equivalents when incorporated into a merged roadmap/contract version (first valid proposal wins; duplicates are linked, not paid; at most 5 per account per epoch) and the 2% finder share of that feature's pool at completion. Triage is agent + human per ReviewPolicy.
- **Bugs:** 2 / 6 / 20 / 50 ACU-eq (low/medium/high/critical) when the fix merges and a maintainer confirms severity.
- **Security:** severity weight × issuance rate from the security reserve, ≤ 25% of the reserve per payout; the old fixed 25/100/300/1000 credit ladder is removed.
- **Human review** (D49): a commissioned task whose budget is fixed by risk class (low_risk 0.5, standard 1.0, security/accounting/protocol 2.0 ACU) + 0.5 ACU per upheld material finding (max 3), reserved from the task capacity like any other task; independent of the builder's budget and of any usage.
- **Completion pools:** a pool opens with a frozen `CompletionDefinition` (source documents, every in-scope surface, acceptance checks, security review, exit-rights check — D50). A scope change appends a new definition version; the pool completes when the latest version is satisfied. Feature pool payout: implementers 75% (by accepted budgets on the feature's ABUs), contract authors 10%, roadmap authors 5%, reviewers (agent and human) 8%, finder 2%. **Application pool: 100% pro rata to lifetime accepted budgets on that target** (H13; the first engine wrongly applied the feature components). When scope shrinks under a newer definition, accrued funding stays with the pool; funding attributed to clipped or revoked work is corrected back to the reserve. Features shared by several apps accrue per (target, feature) and pay per app profile, while the ABU itself is paid once.

## 8. Optimistic payouts, disputes and offsets (D28–D32)

At CALCULATING → PROPOSED the engine writes one allocation line per accepted task and contributor (and per payout), an explanation for each, and anomaly metrics per account. The 48 h challenge window runs from the public publication time. Silence accepts. Disputes, stakes, gates and bounties: PROTOCOL.md §4.4. A clipped line pays `effective weight × the epoch's per-slice rate` (the rate is not re-derived, so other contributors' amounts never change); the excess leaves issuance as in step 3 above; bounties are paid only from recovered amounts (D41).

**After finalization** a proven defect or fraud is recovered in this order: the beneficiary's unreleased holdback (recommended 20% for 6 epochs, F15), unclaimed entitlements, pending allocations, unreleased Genesis vesting (confiscation, D39), then an **offset** on future earnings (AdminAction `record_offset`, two-person). An offset that cannot be collected is written off and absorbed by later budgets (step 5). Tokens already released are never reversed on chain.

## 9. Anomaly metrics (D29), deterministic

Per account per epoch, integers only (`anomalyMetrics` in `engine.ts`); since D49 they compare BUDGETS: `medianPeerRatioBp` (budget / peer P50 budget for the comparable key: task kind, capability class, size points), `capSaturationBp` (share of receipts ≥ 95% of cap), `aboveP50ShareBp`, `consistencyMilli` (sign test: (above − below)/√n × 1000; budgets 10% above peers on every task show here although no single budget stands out — the budget-inflation signal), `perLinePeerRatioBp` (weight per changed line vs peers), and `rankScore` = 10 × max(0, consistency) + max(0, median − 10000) + capSaturation/2. The challenge UI sorts by `rankScore`; the same metrics over the rolling 13-epoch window feed sampled-audit selection and pattern disputes, which may reach back 13 epochs (finalized excess is recovered by offsets).

## 10. Reproducibility

Given the epoch's frozen manifest (receipt ids and hashes), the receipts, the issued budgets and reservations, the demand forecast, the pool balances and security reserve before the epoch, the outstanding offsets, the dispute settlements and the policy versions, `computeEpoch` reproduces every allocation line, the allocations root and the result hash published at PROPOSED. The simulation (`tools/tokenomics-sim`) uses the same function. The site explains each allocation with its `AllocationExplanation` sentence.

## 11. Versioning

Policy documents are immutable versions (`policy_documents`); activation is an AdminAction (founder mode) or a governance proposal, effective from a future epoch, announced ≥ 72 h ahead, with a what-if preview attached (`tools/tokenomics-sim/preview.ts`; DB trigger `check_policy_activation`). Emergency changes apply only to unpublished allocations and are labelled.

## 12. v3 additions (Astra review 03)

- **Source-backed entitlements (H1, H2).** In the database every entitlement names its source — an allocation at its effective final amount, a tranche, or a dispute settlement — and consumes that source's remaining balance once per (source, kind) under the source's lock; releases never exceed the available amount minus its holdback share; a matured release is exactly the tranche's remainder, from the tranche's pinned epoch on; a claim takes an entitlement's whole remaining balance into one leaf. Offsets recovered by the engine appear in the database as the unentitled remainder of an allocation (G-83); completeness of finalization is not enforced yet (G-90).
- **Effective final adjudication (H3).** A gated allocation is final only when its appeal is decided, or its appeal window has closed with no appeal; settlements, bounties, forfeited stakes, entitlements and dispute-driven revocations all read that one amount. Stakes of all of a contributor's disputes in an epoch are reserved against that contributor's allocations.
- **Compensatory confiscation (H4).** Holds apply at notice, total at most the proven excess, and execute only after the windows or an upheld appeal; the engine refuses recovery above the proven excess. Punitive forfeiture is founder decision F17.
- **Late completion corrections (M15).** A correction's pool part returns to the reserve; the part the pool already paid is attributed to the beneficiaries who received it (`recoverFromPaid`) and becomes their offsets, so a historical correction never blocks later epochs.
- **Sponsored rounding (L16).** Lines carry exact share numerators (weight × share bp); beneficiary totals are formed before any rounding.


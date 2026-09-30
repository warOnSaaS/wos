# REWARD-PROTOCOL v2 (DRAFT, revised after Astra review 02) — how contribution becomes WOS

Version: `reward-protocol.v2-draft` (supersedes `docs/architecture/REWARD-PROTOCOL.md` v1 when activated; SUPERSESSION.md says which v1 rules survive). Normative code: `packages/contracts/src/protocol/engine.ts` (the only implementation of the math; the rewards package will call it). Normative data: `packages/contracts/src/protocol/data/*.v1.json` (all `status: draft`). **Every number here is provisional policy data, expected to change (D33).**

## 1. Principles

1. Proof of Contribution: the protocol records verified contribution and allocates by published rules. No payments, no promises of amounts before finalization.
2. Provider tokens ≠ ACU ≠ WOS. Provider tokens are never mapped to a fixed WOS amount.
3. Execution work (builders, agent reviewers, resolvers, auditors) is weighted by normalised usage, **only when accepted**, **clipped at the authorised cap** (A2).
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

(ACU per million tokens.)

### Is list-price normalisation right? Alternatives evaluated

| Option | For | Against | Verdict |
|---|---|---|---|
| **API list price (chosen)** | public, comparable across vendors and token types, prices cached vs output correctly | commercial not physical; subscription users pay flat; provider price changes move shares (S8: Codex 40% → 25% of execution after a 50% cut) | keep, with damping |
| raw tokens | trivial | tokenizers differ; an output token and a cache-read token differ ~100× in cost | reject |
| output tokens only | resists context inflation | ignores real input work; rewards verbose output | reject |
| FLOP / energy estimates | "physical" | unknowable for closed models | reject |
| reference-model equivalents (tokens × quality) | rewards capability | needs a benchmark we do not have; circular | later, via ModelQualificationSuite |
| task standard (size points × reference ACU) | removes the inflation incentive | not "usage based" (A2) | recommended for **mainnet** weight (ADR 3.4, founder decision F1) |

**Oracle rules:** a new version takes effect only at an epoch boundary, announced ≥ 72 h before (D33); no rate moves more than 30% per version (`maxChangePerVersionBp`) unless a structural-tier decision allows it (founder AdminAction in founder mode, a structural vote later); when an oracle version changes, the rate ceiling is re-based in the same activation so a price fall does not silently cut emission (S7).

## 4. Execution weight and caps

- The **authorised budget (cap)** of a subject is fixed when the first lease is issued and reserved per lease: implementation = 4 ACU per size point (bootstrap default) until ≥ 30 merged peers of the same (task kind, capability class, size) exist, then peer P75 × 1.25. Other task kinds: `capability-policy.v1.json` `budgets`.
- **Execution stopping vs reward clipping.** The client stops the agent when cumulative ACU reaches the lease's reserved cap (best effort: claude `--max-budget-usd` where applicable, otherwise the orchestrator kills the process after the response that crosses it; in-flight overshoot is not eligible). The server clips the receipt weight to `min(Σ eligible attested ACU of the subject's runs, cap)`. Clipping is enforceable even against a modified client.
- **Repairs** (local loops, review revisions, rebases) count inside the same cap.
- **Evidence** (M15 clarified): a run's usage counts only at a verification level the cluster accepts (devnet: VERIFIED, ATTESTED; mainnet: none until F1). A run with a run log whose per-turn totals equal the receipt counts in full; a run with **no** log counts at 50% (bare numbers); a run whose log is **present but inconsistent**, or whose adapter reported any parse error, is UNVERIFIED and counts nothing. The DB sums the attested ACU from the contributor's own usage receipts; a receipt cannot supply its own number.
- **Agent reviewers**: their own capped ACU; +10% of it per material finding later resolved or upheld (max 5); a review of an attempt that never merges is paid only if it raised an upheld material finding.
- Failed, abandoned or rejected attempts earn nothing.

## 5. The conserved funding equation (Astra-01 item 4, Astra-02 H1)

State after every epoch: R = remaining emission reserve, P = Σ completion pool balances, S = security reserve, I = cumulative issuance to beneficiaries (released, held back, or final but unclaimed); holdback tranches are part of I.

```
R + ΣP + S + I = emissionReserve (995,000,000 WOS),   R, P_k, S, I >= 0,   Σ holdback <= I
maxSupply = emissionReserve + GenesisCap = 1,000,000,000 WOS
```

`computeEpoch` asserts this — equality AND non-negative balances — on its input and on its output. Every movement names its source and every event id is consumed once (inside an input and against `consumedIds`; the DB enforces the same with unique keys):

1. **Returns** (identified): `unbound_expiry` (an entitlement unclaimed for 52 epochs: I → R), `pool_cancel` (a removed or aliased feature's pool: P → R), `holdback_forfeit` (exclusion: tranches and I → R). **Accrual corrections**: completion accrual attributed to work later clipped or revoked (P → R).
2. **Confiscations** (D39): identified holdback tranches and unclaimed entitlements (I → R); bounty ≤ 20% of what was recovered; any proven excess not recovered becomes an offset.
3. **Dispute settlements**: escrowed excess of clipped/revoked lines (I → R); bounty ≤ 20% of recovered (all of it, since it was escrowed).
4. **Write-offs** (D41): offsets that can no longer be collected (excluded or exited beneficiary) become a loss carried forward.
5. **Budget**: `B = floor(R × 3,327 / 1,000,000) − absorbed`, where `absorbed = min(loss carry, 10% of the full budget)` — unrecovered fraud reduces the next pools, bounded and published; `R -= B`.
6. **Slices** (largest remainder, exact): execution 6000, planning 1000, human_review 500, outcomes 500, completion_accrual 1500, security_reserve 500 bp.
7. **Distributing slices** emit `min(slice, ceiling_e × weight)`; the rest returns to R. **Rounding is per beneficiary** (L18): the slice is split across beneficiaries (receipt weights split person/organization by the sponsorship share, exactly), then each beneficiary's fixed total is apportioned across its receipt lines — splitting receipts cannot win base units.
8. **Accrual slices** accrue `slice × (emitted distributing / distributing slices)`; nothing in an empty epoch; completion accrual to feature pools (2/3) and application pools (1/3) pro rata to execution weight per key; security accrual to S.
9. **Pool payouts** (H13): feature pools by components (75/10/5/8/2); **application pools 100% by lifetime weight**; a component with nobody returns to R; one terminal disposition per pool (DB).
10. **Security payouts**: `min(weight × realised execution rate, 25% of S)`, once per security receipt.
11. **Offsets** recovered from each beneficiary's gross, ≤ 50% of it; recovered amounts return to R.
12. **Holdback** (D40): each beneficiary's net is split into `releasedNow` (50%) and a new tranche (50%); tranches older than 13 epochs mature and are released. Bounties are released in full.

**Unclaimed:** a final entitlement stays claimable while the beneficiary has a bound wallet; unbound, it carries 52 epochs, then returns (step 1). **Supply:** WOS is minted only when a leaf is settled on devnet, or into the emission escrow on mainnet; nothing above `maxSupply`; the unused Genesis cap is never minted.

## 6. The rate ceiling

`ceiling_e = floor(100 WOS/ACU × (1 − 3,327/1,000,000)^(e−1))`, floored every epoch. It binds when participation is low (S1, S6, S9) and makes the effective rule "at most 100 WOS per ACU early, less later". **Q3 timing damping:** an epoch's ceiling is also at most 1.5× the published trailing 4-epoch realised execution rate, so moving acceptance from a congested epoch to a quiet one gains at most 50% (it returns about 5.5% of budgets in steady state). Merge timing is also not fully in a contributor's control (review and merge queue). Without it contributor zero alone would take 1,986,219 WOS/week (S10). It applies to every distributing slice (human review and outcomes weights are ACU-equivalents).

## 7. Planning, outcomes, human review, completion

- **Planning** (A3): runs of roadmap and feature-contract authors and reviewers count only if their revision is in the merged version (attested usage, capped per document kind), in the planning slice; plus shares of feature pools (below).
- **Proposals:** 10 ACU-equivalents when incorporated into a merged roadmap/contract version (first valid proposal wins; duplicates are linked, not paid; at most 5 per account per epoch) and the 2% finder share of that feature's pool at completion. Triage is agent + human per ReviewPolicy.
- **Bugs:** 2 / 6 / 20 / 50 ACU-eq (low/medium/high/critical) when the fix merges and a maintainer confirms severity.
- **Security:** severity weight × realised execution rate from the security reserve, ≤ 25% of the reserve per payout; the old fixed 25/100/300/1000 credit ladder is removed.
- **Human review:** fixed weight by risk class (low_risk 0.5, standard 1.0, security/accounting/protocol 2.0 ACU-eq) + 0.5 ACU-eq per upheld material finding (max 3), in the human_review slice; independent of the builder's usage.
- **Completion pools:** a pool opens with a frozen `CompletionDefinition` (source documents, every in-scope surface, acceptance checks, security review, self-host check). A scope change appends a new definition version; the pool completes when the latest version is satisfied. Feature pool payout: implementers 75% (by effective weight on the feature's ABUs), contract authors 10%, roadmap authors 5%, reviewers (agent and human) 8%, finder 2%. **Application pool: 100% pro rata to lifetime effective weight on that target** (H13; the first engine wrongly applied the feature components). When scope shrinks under a newer definition, accrued funding stays with the pool; funding attributed to clipped or revoked work is corrected back to the reserve. Features shared by several apps accrue per (target, feature) and pay per app profile, while the ABU itself is paid once.

## 8. Optimistic payouts, disputes and offsets (D28–D32)

At CALCULATING → PROPOSED the engine writes one allocation line per receipt (and per payout), an explanation for each, and anomaly metrics per account. The 48 h challenge window runs from the public publication time. Silence accepts. Disputes, stakes, gates and bounties: PROTOCOL.md §4.4. A clipped line pays `effective weight × the epoch's per-slice rate` (the rate is not re-derived, so other contributors' amounts never change); the excess leaves issuance as in step 3 above; bounties are paid only from recovered amounts (D41).

**After finalization** a proven defect or fraud is recovered in this order: the beneficiary's unreleased holdback (13 epochs, 50%), unclaimed entitlements, pending allocations, unreleased Genesis vesting (confiscation, D39), then an **offset** on future earnings (AdminAction `record_offset`, two-person). An offset that cannot be collected is written off and absorbed by later budgets (step 5). Tokens already released are never reversed on chain.

## 9. Anomaly metrics (D29), deterministic

Per account per epoch, integers only (`anomalyMetrics` in `engine.ts`): `medianPeerRatioBp` (weight / peer P50 for the comparable key: task kind, capability class, model, size points), `capSaturationBp` (share of receipts ≥ 95% of cap), `aboveP50ShareBp`, `consistencyMilli` (sign test: (above − below)/√n × 1000; a skim of +10% on every receipt shows here although no single receipt stands out), `perLinePeerRatioBp` (weight per changed line vs peers), and `rankScore` = 10 × max(0, consistency) + max(0, median − 10000) + capSaturation/2. The challenge UI sorts by `rankScore`; the same metrics over the rolling 13-epoch window feed sampled-audit selection and pattern disputes, which may reach back 13 epochs (finalized excess is recovered by offsets).

## 10. Reproducibility

Given the epoch's frozen manifest (receipt ids and hashes), the receipts, the pool balances and security reserve before the epoch, the outstanding offsets, the dispute settlements and the policy versions, `computeEpoch` reproduces every allocation line, the allocations root and the result hash published at PROPOSED. The simulation (`tools/tokenomics-sim`) uses the same function. The site explains each allocation with its `AllocationExplanation` sentence.

## 11. Versioning

Policy documents are immutable versions (`policy_documents`); activation is an AdminAction (founder mode) or a governance proposal, effective from a future epoch, announced ≥ 72 h ahead, with a what-if preview attached (`tools/tokenomics-sim/preview.ts`; DB trigger `check_policy_activation`). Emergency changes apply only to unpublished allocations and are labelled.

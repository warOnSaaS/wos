# ADR-001: Proof of Contribution — implement as written, or modified?

Status: **PROPOSED (DRAFT v4 — budget-based rewards, D49)** — Astra reviews 02 and 03 returned DO NOT IMPLEMENT (yet); v2 resolved review 02 (section 7), v3 addresses review 03 (section 8); v4 adopts the founder's D49 (section 9) and awaits Astra review 05 (`REVIEW-PACKET.md` §3c, §3d); review 04 was never run. Not wired into authoritative reward accounting; devnet-first; mainnet prohibited. Dates: 2026-09-29, v3 2026-09-30. Author: Protocol Architect (Claude Opus 5.5), on `ws/protocol`.
Inputs: Amendment 02 (Part A binding, Part B proposal, Part C draft), Astra review 01 (`reviews/ASTRA-REVIEW-01-amendment-02.md`), and the founder decisions received during this design pass, recorded as D18–D38 in `docs/DECISIONS.md`.

## 1. Decision in one paragraph

Build Part B **modified**. Keep its spine (Proof of Contribution language, ACU normalisation through a versioned oracle, usage-weighted execution rewards only for merged work under a cap, bounded epoch emissions split proportionally, independent agent review plus required human review, immutable receipts, devnet first, no presale) and the already-built machinery (leases, locks, decomposition, blockers, reviewer isolation, append-only hash-chained ledger, deterministic rewards package). Change eleven things, each argued in section 3: a **rate ceiling** on every epoch, **utilisation-scaled pool accruals**, **decoupled human-review weight**, **optimistic payouts with a public challenge window** instead of a universal payout review, **payout audits not code re-review**, **Genesis valued by accepted output only** with a lower cap, **claim-triggered push transfers on devnet** instead of a Merkle distributor, **Token-2022 with metadata only and no freeze or delegate powers**, **fail-closed mainnet eligibility** for attested usage, **forward-only policy data** with previews, and **a settlement-adapter off-ramp** that keeps the off-chain ledger canonical.

## 2. What already exists vs what is new

| Part B asks for | Already built (file) | New in this design |
|---|---|---|
| Exclusive leases, heartbeats, expiry | `wos.leases` one active per task, TTL/heartbeat/hard deadline (0001), BUILD-PROTOCOL §3 | Lease **generation** fencing (0007 `leases.generation`), attempt `max_lifetime_at` |
| Logical locks, feature concurrency | `wos.resource_locks`, scope algebra, BUILD-PROTOCOL §12 | none |
| Decomposition, blockers | `needs_decomposition`, `maxFailedAttemptsPerAbu`, `blockers/` | "consistently exceeds cap" feeds decomposition (RiskPolicy) |
| Reviewer isolation, sealed verdicts, independence | `check_review_independence`, RLS `sealed_until_revealed`, agent-run binding (0002–0003) | Related-account (organization) checks, human review binding, payout-audit quorums |
| Append-only hash-chained ledger | `wos.ledger_entries` + `ledger_chain()` | Kept as the legacy credits ledger (never activated, SUPERSESSION.md); new append-only receipts/allocations + hash-chained `admin_actions` |
| Deterministic reward rules | `packages/rewards` (`computeLedgerDrafts`, `allocatePool`) | `@waronsaas/contracts/protocol` engine: epochs, ceiling, conserved funding equation, per-receipt lines, disputes, anomaly metrics |
| 14-day holds, void/clawback | `holdDays`, sweeper, void/clawback kinds | Replaced by epoch windows + challenge window + **offsets** (no on-chain reversal) |
| Signed agent-run attestation | `AgentRunRecord` (input/output tokens only) | UsageReceipt (5 exclusive categories, event-id dedup), RunLog, run-policy snapshot |
| Context manifests | `ContextManifest` | Payout-auditor context with a **focus** section (D32) |
| Agent policy | `agent-policy.v1.json` (model brands) | Capability classes (BUILD_L1–L4, PLAN_L1, REVIEW_A/B, ARCHITECT_L1…) |
| Organizations | `wos.organizations`, memberships (0006) | Sponsorship links; beneficiary on receipts; related accounts (D38) |

## 3. Deviations, each argued

### 3.1 Rate ceiling on emissions (new; supports A6 "no premine")
Part B splits a fixed epoch emission pro rata. With few participants that hands the whole budget to whoever is there. Contributor zero alone would receive **1,986,219 WOS/week** (TOKENOMICS-SIMULATION S10): a premine by another name. The engine emits `min(slice, ceiling × weight)` per distributing slice and returns the rest to the reserve, where the budget formula (a fraction of the *remaining* reserve) re-offers it later. With the ceiling, contributor zero alone receives 3,000 WOS/week (S9). The ceiling decays per epoch (early contributors still earn more per ACU) and must be re-based whenever an oracle version changes (S7).

### 3.2 Pool accruals scale with utilisation (found by the simulation)
The first engine accrued the completion (15%) and security (5%) slices in full whenever any weight existed. In a low-participation world that moved 20% of every budget into pools that a handful of people would later collect (S6: 104M WOS in pools). Accrual slices now accrue only the fraction of their slice that the distributing slices actually emitted. This is a real design bug that the proposal would have shipped.

### 3.3 Human-review weight decoupled from builder compute (Astra-01 item 5)
Part C paid human reviewers ~10% of the unit's ACU, giving them an interest in inflated builder usage. Human reviews now carry a fixed ACU-equivalent by risk class (0.5 low-risk, 1.0 standard, 2.0 security/accounting/protocol) plus a bonus per upheld finding, paid from their own capped `human_review` slice (5%).

### 3.4 Usage rewards kept (A2), with honest limits and fail-closed mainnet — SUPERSEDED by D49 (section 9); kept for the record
Subscription CLIs report usage client-side. Signing preserves a claim; it does not prove it (USAGE-PROOF.md). Marginal cost of usage on a flat subscription is near zero, and a modified client can fabricate consistent logs. The simulation shows cap saturation with fabricated, consistent run logs earns about +56% receipt by receipt; only the 13-epoch pattern lookback removes the expected gain (A). So:
- caps are tight (peer P75 × 1.25), repairs count inside the cap, run logs are required and bare numbers get a 50% haircut;
- evidence class and verification level are stored on every receipt and never upgraded in UI;
- **mainnet eligibility fails closed**: `acceptedVerificationLevels.mainnet = []` and `acceptedEvidenceClasses.mainnet = []`. Nothing counts toward value-bearing WOS until the founder decides, at the legal checkpoint, whether ATTESTED usage may carry value.
- **Flagged recommendation for the founder (does not change A2 now):** before mainnet, consider weighting mainnet execution by `accepted_output` (reference ACU of the merged unit's size, measured from peer baselines) with attested usage as an eligibility check. It removes the inflation incentive entirely and keeps the "compute contributed" story at population level.

### 3.5 Optimistic verification replaces a universal payout review (D28)
The founder's review-duty proposal (every receipt ratified by X peers) costs X extra agent runs per receipt and, as Astra-01 item 5 notes, cannot prove historical consumption anyway. Decided instead (D28–D32): every allocation is published with a plain explanation and deterministic anomaly metrics; a 48-hour challenge window; silence accepts; any epoch participant may dispute any set of allocations; a dispute focuses a payout audit gate; 5% sampled audits and payout canaries run regardless. Honest limits (S-F, S-B): detection depends on dispute propensity; small consistent skims surface slowly (a 10% skim on 10 receipts/epoch reaches a 50% chance of being ranked only after ~39 epochs); the pattern lookback and total-excess bounty exist for that reason.

### 3.6 Payout audits, not code re-review (D27); code-defect canaries dropped
The code was already reviewed by Astra, Fable, a human and CI before merge. Duty auditors judge payout plausibility only. Code-defect canaries (D26) are **dropped for V1**: every merged commit and attempt is public, so a modified client can distinguish a mutated commit from a real one by checking the repository. Payout canaries survive because per-run usage and run logs are published only after the epoch finalizes, so a packet cannot be matched against public records during the audit window. They still only catch lazy or scripted clients (ABUSE-MODEL §5).

### 3.7 Bootstrap: merge authority separated from qualification (D23; Astra-01 item 2)
REVIEW-PROTOCOL §9 let the author review their own work in bootstrap. That no longer qualifies anything. The founder keeps **merge** authority in bootstrap (AdminAction `bootstrap_merge`, public label), and the founder's own work so merged gets a **PROVISIONAL** receipt: public, counted only in devnet **test epochs**, never Genesis-qualifying, until an independent reviewer ratifies it. Consequence stated plainly: while the founder is the only participant, **no live receipt exists**; test epochs rehearse the full pipeline with devnet WOS explicitly marked non-Genesis. Low-risk classes (docs, tests, copy) may need 0 humans when Astra and Fable both pass (D23; amends A4 by founder decision).

### 3.8 Genesis valued by accepted output only; cap lowered to 0.5% (A6; Astra-01 item 9)
Git history proves authorship and accepted output, not token consumption. Genesis weight = retro size points × the median eligible ACU per size point measured in live epochs 1–12 (at least 30 receipts), valued at the mean realised execution rate of those epochs, capped. The simulation values even 2,000 retro size points at about 340,000 WOS (H), far below Part B's implied 7.5% or the first draft's 2%. The cap is set to **5,000,000 WOS (0.5% of max supply)**; the unused cap is never minted. Genesis is issued only at mainnet launch, into a 2-year linear vesting position, after protocol-class review by at least two independent humans (never the founder), with a shared dedup namespace so no work is credited twice.

### 3.9 Devnet settlement: claim-triggered push transfers, not a Merkle distributor
Astra-01 called Merkle distribution "an option, not a V1 requirement". With tens or hundreds of contributors, a devnet distribution wallet pushing SPL transfers when a contributor claims is simpler, needs no third-party program, and is retry-safe by blockhash expiry. wOS still computes a Merkle root of allocations and anchors it with an SPL Memo, so anyone can verify. The mainnet mechanism (push vs an audited Merkle distributor) is decided at the readiness gate with real numbers (SOLANA-ARCHITECTURE §5).

### 3.10 Token-2022, metadata only, no on-chain seizure powers
No freeze authority, no permanent delegate, no transfer hook, no transfer fee, no default-frozen state. Only MetadataPointer + TokenMetadata. A non-transferable extension would be permanent and would force a new mint if WOS ever becomes tradeable (A5). Devnet WOS is transferable and worthless, and the UI says so.

### 3.11 Mint authority and the off-ramp (D35)
Two options to keep migration possible without an unlimited mint: (a) keep mint authority in a timelocked governance multisig bounded by an emission controller; (b) **revoke** mint authority once the emission escrow is funded and migrate, if ever needed, to a *new* mint from a public snapshot. Recommendation for mainnet: (b). A retained authority to "mint for migrations" is exactly the unilateral-unlimited-mint risk Part B forbids, while a new-mint migration from a verifiable snapshot needs no retained power (TOKEN-AUTHORITIES §4).

### 3.12 Smaller changes
- **Epoch split** (provisional, D33): execution 60%, planning 10%, human review 5%, outcomes (proposals + bugs) 5%, completion accrual 15%, security reserve 5%.
- **Fixed bounty ladder removed** as an executable default (Astra-01 item 4): bugs, proposals and security carry ACU-equivalent weights inside funded slices; security payouts are capped at 25% of the security reserve per payout.
- **Receipts per epoch admission rule**: a receipt enters the epoch that is OPEN when it becomes countable (merge for ACTIVE, ratification for PROVISIONAL); its run's ACU uses the oracle pinned at lease issue.
- **Human review binds** to (head sha, submission hash, context hash, review policy version); any new revision voids it.
- **"Maximum reasoning"** means the maximum permitted by the pinned AgentPolicy (`max`, never Astra's `ultra`), a deliberate exception to the conversation's wording; requested and observed effort are recorded; unsupported settings block the run (Astra-01 item 3).
- **Sybil posture changes**: SECURITY S-24 assumed tokens have no cash value. That is no longer true (A5). Controls now rely on the human gate, caps, related-account rules, random assignment, audits and, at mainnet, KYC at the legal checkpoint.
- **D3 superseded** (D18). Every statement that must change is listed in SUPERSESSION.md §3.

### 3.13 Confiscation after proven cheating, from protocol-held amounts only (D39, D40)
The founder replaced "no confiscation" with "no SILENT or ARBITRARY confiscation". This design implements it without any on-chain power: 50% of every allocation is held back for 13 epochs, and after proven cheating (evidence, notice, reply, one appeal, a two-person action bound to the confiscation) the protocol recovers from pending allocations, unreleased holdback and unclaimed entitlements — v3 (Astra-03 H4): the notice HOLDS those balances at once (partially if needed), the holds execute only after the windows or an upheld appeal and are released if overturned or lapsed, never more than the proven excess in total — then offsets, revocation, zero governance weight and exclusion. v3 implements this as COMPENSATORY recovery; the D39/D40 wording also reads as PUNITIVE forfeiture of all unreleased holdback on exclusion, which the draft does not execute until the founder decides (F17). Genesis vesting is not yet confiscable because no Genesis entitlements exist before mainnet. Released tokens are never seized; there is no freeze or permanent-delegate authority. Genesis vesting is released by the protocol (not an on-chain vesting program) so it stays in reach.

## 4. Critique of the founder proposals received during this pass

- **Review duty at claim (D25):** sound as a *supply* mechanism for audits, weak as a universal gate. Every receipt ratified by X peers means X more max-effort agent runs per receipt on contributors' quotas, and aggregate duty supply must be at least X per receipt or a backlog forms. It also cannot prove consumption. Kept only for dispute gates, sampled audits and provisional ratification (table I shows supply covers demand with up to 3 duty runs per claim).
- **Canaries (D26 → D27):** worth having against scripted clients; not proof. Code-defect canaries are dropped for the reason in 3.6.
- **Optimistic payouts (D28):** the right default. The risk is apathy: if nobody disputes, only sampled audits and canaries act. The anomaly ranking and total-excess bounty are what make disputing rational (C).
- **Governance with tiered dual supermajorities (D34, D36, D37):** good defence against pure capital capture. Early concentration is real (K: contributor zero could meet routine turnout alone in a 6-person network), so governance stays in founder mode until the activation threshold.
- **Organizations as beneficiaries (D38):** necessary for companies; creates correlated accounts, handled by the related-account rules in the DB and a 10% per-organization governance cap (L).

## 7. Astra review 02 — what changed (full table: REVIEW-PACKET.md §3b)

Every finding was accepted; three were accepted in a modified form, none rejected:
- **H4 modified by founder decision (D40, D41):** usage rewards stay; instead of a loss budget or external collateral, a 50% holdback is the collateral, bounties come only from recovered amounts, and unrecovered losses reduce later budgets (≤ 10%). The simulation now models real recovery with exit, churn, collusion and contaminated baselines (A2); the result — positive expected gains at very low detection — keeps attested usage mainnet-ineligible until F1.
- **H8 modified:** relatedness is evaluated live by a privileged function (memberships, and sponsorships including ended ones) under per-round/per-quorum locks, rather than a frozen per-round relationship snapshot. Sponsorship history is never deleted, so the live view only grows; the residual is team-membership removal just before an assignment (GAPS G-80).
- **M14 partly deferred:** duty is now append-only events with a non-punitive `unaudited` release when capacity is missing (D42); a deadline-specific capacity model by provider and independence constraint is deferred to devnet measurement (GAPS G-81).
- **Q3 (rate-ceiling timing):** answered with damping (ceiling ≤ 1.5× the trailing realised rate), not by switching value-bearing rewards to accepted output — that remains the flagged recommendation for mainnet (3.4, F1).
- **Q9 (lock before snapshot):** answered with lock seasoning (≥ one full epoch).
- The executed counterexamples (H1 returns and replay, H5 organization cap, H13 application pool, L18 rounding) and SQL repros A–G were confirmed against the old code, then turned into tests that now reject them.

## 8. Astra review 03 — what changed (full table with tests: REVIEW-PACKET.md §3c)

Every finding was reproduced on the pre-fix code before any change (`reviews/ASTRA-REVIEW-03-repros-prefix.txt`: 21 SQL sequences, 4 two-session races, 12 TypeScript probes), then fixed and turned into a regression test. Statuses: resolved H2, H3, H8, M10, M11, M12, L16 and the two review-02 residuals; resolved in the database with chain behaviour unexercised H9; resolved for the cited sequences with residuals H1; partially resolved H4, H5, H6, H7, M13, M15; M14 resolved as documentation with the rule left to the founder. The common fix is structural, as Astra recommended: **one source-balance ledger** (0007 §10d) that every consumer of an asset uses under the same per-source lock, **one effective final adjudication** per allocation (`allocation_adjudication`) from which all money is derived, **evidence as relationships** (qualification results, audit assignments) rather than asserted flags, and **one approved operation per admin action**, consumed once. The engine now tracks who owns the claimable part of issuance, pins each tranche's maturity and policy, requires replay state, caps confiscation at the proven excess, converts late completion corrections into offsets and aggregates sponsored splits exactly. Governance applies eligibility before caps and refuses unvalidated weights. Where the architect chose differently from Astra's suggested fix is listed in REVIEW-PACKET §3c with reasons.

## 9. D49 — budget-based execution rewards (founder decision, supersedes A2)

**What changed.** Every commissioned task — build unit, agent or human review, audit, resolution, planning — carries a budget in ACU fixed before work starts, from a versioned budget model (expected compute × difficulty × importance/shared dependency), reviewed in consensus (an unjustified budget is a material finding) and compared with peer budgets. Issuing a task reserves `budget × issuance rate` from the epoch's pooled task capacity; a task that does not fit is not issued; acceptance pays the reservation, split by declared shares; unaccepted tasks expire and are re-priced. Usage is telemetry (cap enforcement, calibration, signals, model comparisons).

**Why.** Usage on contributor-controlled machines cannot be verified (Astra reviews 02 H4 and 03 M13): fabricated but consistent usage gained +29–30% at 0.1% detection per receipt even with a 50% holdback, and every safeguard (caps, mandatory logs, haircuts, a large holdback, F1) was a patch on an unverifiable input. Usage pay also penalised efficient contributors. The white paper already argued for paying accepted output. Budget-based pay removes the usage-fraud surface by construction and pays efficiency.

**What was removed or simplified.** The bare-log haircut; mandatory run logs (now optional evidence); attested-ACU sums, cap clipping of pay and verification-level eligibility in the receipt rules; the Q3 trailing-rate damping and its residual (F19); usage-based dispute reasons and canary perturbations; the "usage plausibility" focus of payout audits (now attribution, splits, budgets, acceptance); F1 and F16 largely dissolve; the holdback shrinks from 50%/13 to a recommended 20%/6.

**What is new and must be designed against.** Budget inflation (bounded multipliers, human approval above 1.25×, hard maximum 2×, peer ranking, proposer may not build), task splitting / reward stacking (per-objective budget cap), cherry-picking easy budgets and stale budgets (recalibration from telemetry of accepted tasks, expiry and re-pricing), low-effort acceptance (full qualification chain, audits, holdback), calibration poisoning by fabricated telemetry (G-91). Simulation tables N, O, P quantify them.

## 5. Open questions

1. Is ATTESTED usage acceptable as the basis of value-bearing WOS at all (3.4)? The contracts say no until decided.
2. Are 48 h risk review + 48 h challenge acceptable latency for weekly epochs (payout about 4–5 days after epoch end)?
3. Should the rate ceiling be expressed per ACU (current) or per merged size point (more robust to oracle changes, less "usage based")?
4. Which Solana lock/vote-escrow program for governance locks (TOKENOMICS-REVIEW §6); none has been audited by us.
5. Does any audited Merkle distributor support Token-2022 with the needed vesting (Jito's distributor and the Solana Foundation rewards program are candidates; UNVERIFIED)?
6. Unclaimed allocations of unbound wallets carry 52 epochs then return to the reserve: acceptable, or carry forever?
7. The anomaly consistency metric is a sign test (robust, weak). Add a mean-log-ratio test (stronger, less robust)?

## 6. Founder decisions required

| # | Decision | Default in the draft |
|---|---|---|
| F1 | ~~Mainnet eligibility of ATTESTED usage (3.4)~~ — **largely dissolved by D49**: usage no longer pays, so there is nothing to make eligible. What remains is the mainnet readiness gate itself and the calibration-poisoning residual (G-91) | mainnet closed |
| F2 | Emission curve and ceiling (budget 3,327 ppm of remaining per week ≈ 4-year half-life; ceiling 100 WOS/ACU decaying) | as drafted, provisional |
| F3 | Epoch split (3.12) | 60/10/5/5/15/5 |
| F4 | Genesis cap and the retro size-point mapping of V1 | 0.5%; mapping to be proposed as a TGT-00 roadmap PR |
| F5 | Merge authority after bootstrap (G-04) | App auto-merge after qualification + CI; maintainer approval on protocol paths |
| F6 | Mainnet authorities: revoke mint + new-mint migration (recommended) or retained timelocked authority | revoke |
| F7 | Mainnet settlement: push or audited Merkle distributor | decide at the gate |
| F8 | Transferability of mainnet WOS (A5 "may become tradeable") | decide at the legal checkpoint |
| F9 | KYC at the mainnet gate for claimants above a threshold | recommended |
| F10 | Governance activation threshold (50 eligible voters, 10M WOS locked ≥ 12 months, no voter > 20%) | as drafted |
| F11 | Seed reviewers: who the founder authorizes as human reviewers in V1 | none yet |
| F12 | Unclaimed/unbound carry period (52 epochs) | as drafted |
| F13 | The token name casing (G-31: "WOS" vs "wOS") now that WOS is a token ticker | keep "WOS" as the ticker |
| F14 | Name the responsible legal entity for publication and retention (D47) | the founder until named |
| F15 | Holdback size now that it protects against defective work and misattribution, not usage fraud (D49) | **recommendation: 20% for 6 epochs** (covers the 14-day revert window, review audits and one dispute cycle; the v3 50%/13 existed only to collateralise unverifiable usage) |
| F16 | ~~Minimum measured detection rate that makes F1 acceptable~~ — dissolved by D49 | — |

### Founder decisions raised by Astra review 03 (not chosen by the architect; the draft's default is the safe one)

| # | Decision | Default in the draft (v3) |
|---|---|---|
| F17 | The boundary between COMPENSATORY recovery of proven excess and PUNITIVE forfeiture on exclusion (D39/D40 wording vs the 0007 cap): reservation at notice, maximum hold duration, appeal effects, beneficiary liability including sponsorship changes. Simulation A2 compares both | compensatory only (holds ≤ proven excess); punitive not executable; holds lapse 14 days after the appeal window unless executed |
| F18 | Who bears a dispute stake when the disputer's allocations go (partly) to a sponsoring organization | reserved against all of the accountable contributor's lines in the epoch, whatever the beneficiary |
| F19 | ~~Residual quiet-epoch timing gain~~ — dissolved by D49 (the price is fixed at issuance) | — |
| F20 | The bounded fallback when owner/organization caps are infeasible or ownership cannot be established | the tally refuses to pass anything; founder mode stays until the activation criteria are actually met |
| F21 | The finalized Genesis reference population and its independent approvers (GENESIS-POLICY says ≥ 2 non-founder humans; the DB checks two maintainers over the manifest hash) | no manifest approved; Genesis stays mainnet-only |
| F1 (restated) | Answered by D49: value-bearing rewards follow accepted budgets, not usage | — |

### Founder decisions raised by D49 (the architect recommends; the founder decides)

| # | Decision | Recommendation (draft default) |
|---|---|---|
| F22 | Quality factor q in R_ij = B_i × a_i × q_i × s_ij, or acceptance only | **acceptance only in V1** (binary a_i; no q): a quality score is a new judgement surface to game and dispute; defects are handled by the holdback and review audits |
| F23 | The epoch contract: reservation at issuance (a task that does not fit is not issued) vs proportional scaling of accepted budgets | **reservation at issuance**, with the issuance rate set ex ante from queued demand (implemented; never mix the two) |
| F24 | Budget-model bounds: difficulty 0.5–2.0, importance/shared-dependency 1.0–1.5, human approval above 1.25× the model, hard maximum 2×, per-objective caps, expiry 4 epochs, recalibration every 13 epochs ≤ 20% per step | as drafted; tighten after devnet data |
| F25 | Who may propose budgets (the decomposer/contract author, excluded from building the unit) and whether a budget proposal is itself a paid planning contribution | proposer = the decomposition/contract author; proposing is part of the planning task, not separately paid |
| F6/F7 (restated) | Mainnet escrow/program selection, cryptographic wallet verification and off-ramp drills stay separate gates; nothing here authorizes a mainnet launch or an ICO | closed |

Decided in this pass (no longer open): Astra-02's eight missing decisions → D39–D48 (confiscation, holdback, unrecoverable losses, audit capacity, dispute burden, cap promise, organization obligations, multisig custody and resumption, publication and retention, Genesis calibration).

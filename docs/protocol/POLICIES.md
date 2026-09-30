# POLICIES (DRAFT) — every rule and number as versioned data

**All V1 values are provisional and expected to change (D33).** Schemas: `packages/contracts/src/protocol/policies.ts` and `governance.ts`. Data: `packages/contracts/src/protocol/data/*.v1.json` (parsed at import by `data.ts`; a malformed file fails the build). Every receipt records the versions in force (`PolicyVersions`), every run the versions pinned at lease issue (`RunPolicySnapshot`), every epoch the versions and the enforcement numbers it runs under (`epochs` row).

## 1. Lifecycle of a policy version

1. A new version is a new immutable file and `policy_documents` row (kind, version, body, sha256).
2. **Preview:** `node tools/tokenomics-sim/preview.ts <file>` re-runs recent epochs (simulated now, real frozen manifests once they exist) under the candidate; its sha256 is attached.
3. **Activate:** founder mode — AdminAction `activate_policy` (two-person, reason); governance mode — a passed proposal at the right tier (GOVERNANCE.md). The activation names the effective epoch.
4. **Forward-only** (DB `check_policy_activation`): effective from the next epoch at the earliest, announced ≥ 72 h before that epoch starts, preview required; never applies to published (PROPOSED) or finalized allocations. **Emergency** activations (safety only, labelled) may target the open epoch while its allocations are unpublished.
5. Old versions stay forever; history is never recomputed.

Admin UX (web admin + Desktop Build app): policy list with versions and effective epochs; "propose change" opens a diff editor against the active file, runs the preview, shows the diff table ("what would last epoch have paid"), and submits the activation with reason and co-signer.

## 2. RewardPolicy (`reward-policy.v1.json`)

| Field | V1 value | Meaning |
|---|---|---|
| `epoch.lengthDays` | 7 | weekly epochs (UTC) |
| `epoch.riskReviewHours` | 48 | CALCULATING window (holds, revocations, sampled audits) |
| `epoch.challengeHours` | 48 | PROPOSED challenge window |
| `epoch.maxDeferrals` | 2 | a held receipt moves at most twice |
| `epoch.revertOffsetDays` | 14 | a defective merge reverted within this window becomes an offset |
| `emission.maxSupplyBase` | 1,000,000,000 WOS | |
| `emission.emissionReserveBase` | 995,000,000 WOS | |
| `emission.budgetPpmOfRemaining` | 3,327 | ≈ 4-year half-life |
| `emission.rateCeiling` | 100 WOS per ACU of budget, decay 3,327 ppm/epoch; the issuance rate is min(ceiling, task capacity / queued demand), fixed per task at issuance | D49 (Q3 damping removed) |
| `slicesBp` | execution 6000, planning 1000, human_review 500, outcomes 500, completion_accrual 1500, security_reserve 500 | |
| `eligibility.acceptedEvidenceClasses` | devnet [accepted_budget, outcome]; mainnet [] | D49: usage is telemetry, never an evidence class for pay |
| `acceptance[]` | one row per contribution type (PROTOCOL §3) | event, acceptor, slice, weight basis, lease/usage needs |
| `challenge` | window 48 h, reply 24 h, appeal 72 h, escalate 120 h, per-item stake max(1 WOS, min(2%, 10%/items)) of pending, forfeited per rejected item, joiner min stake, related parties never hold bounty priority, ≤ 25 items, ≤ 3 disputes/epoch, sampled audits 5%, rejected-disputes signal after 3, public allocations | D28–D32, D43 |
| `holdback` | 20% for 6 epochs (recommendation, F15); forfeited on exclusion only | D40 re-sized by D49 |
| `budgets` | ACU; reserve at issuance; binary acceptance, no q (F22); shares sum 10000; model multipliers difficulty 0.5–2.0, importance 1.0–1.5; human approval above 1.25×, hard max 2×; objective cap; proposer may not build; expiry 4 epochs; recalibration every 13 epochs, ≤ 20%/step, ≥ 20 samples | D49 |
| `losses` | bounty 20% of RECOVERED; unrecovered losses absorb ≤ 10% of a budget per epoch; published | D41 |
| `confiscation` | reply ≥ 72 h, appeal ≥ 168 h, time-boxed exclusion ≤ 52 epochs, permanent exclusion at the structural tier | D39 |
| `auditCapacity` | unaudited release on schedule; never penalize the contributor | D42 |
| `settlement` | unbound carry 52 epochs; devnet push; mainnet undecided; offset recovery ≤ 50% | |
| `execution` | the execution cap stops a run (telemetry); +10% of the review task's budget per upheld finding (max 5); failed-attempt reviews paid only with upheld findings | |
| `humanReview.weightAcuEqMicro` | the budget of a commissioned human review: low_risk 0.5, standard 1.0, security/accounting/protocol 2.0 ACU; +0.5 per upheld finding (max 3) | independent of the builder |
| `outcomes` | proposal 10 ACU-eq; bugs 2/6/20/50; ≤ 5 proposals/account/epoch | relative weights |
| `security` | 25/100/300/1000 ACU-eq; ≤ 25% of reserve per payout | |
| `completion` | feature pools 2/3, application pools 1/3 of the accrual | |

## 3. ModelRateOracle (`model-rate-oracle.v1.json`)

Rates in micro-ACU per million tokens per (provider, model), with `source` and `verified`; `effectiveEpoch`; `maxChangePerVersionBp` 3000. V1 rates in REWARD-PROTOCOL §3; all `verified: false`.

## 4. AgentCapabilityPolicy (`capability-policy.v1.json`) — capability classes, not brands

| Class | V1 qualified models (all `founder_bootstrap`) | Min reasoning |
|---|---|---|
| BUILD_L4 | claude-opus-5-5, gpt-6-astra | high |
| BUILD_L3 | gpt-6-sol | high |
| PLAN_L1 | claude-fable-5-1, claude-opus-5-5, gpt-6-astra | max |
| REVIEW_A | gpt-6-astra | max (never ultra) |
| REVIEW_B | claude-fable-5-1 | max |
| ARCHITECT_L1 | claude-fable-5-1 | max |

Task requirements: `abu_build`/`abu_revision` need BUILD_L3 below 3 size points and BUILD_L4 from 3 (so Sol keeps building small units, D15, while Part B's "builder minimum BUILD_L4" holds for real units — flagged in the ADR); authors PLAN_L1; reviews REVIEW_A/REVIEW_B; resolution ARCHITECT_L1. Budgets (caps, micro-ACU): build 4 ACU/size point; implementation review 3 + 1/size point; roadmap author 60; roadmap review 15; feature author 30; feature review 10; resolution 10; peer baseline P75 × 1.25 after 30 (build/review) or 10 (documents) samples. `ModelQualificationSuite`: classes can later be earned by `eval_suite`; V1 records model performance per class (receipts carry model and class) and does not run evals.

## 5. ReviewPolicy (`review-policy.v1.json`)

Risk classes (protocol 10, accounting 20, security 30, low_risk 90, standard 100 by priority), rules (every class: CI + REVIEW_A max + REVIEW_B max; humans 1, low_risk 0; adminQuorum 0), independence (human never author, never an agent slot of the same round, ≤ 10 reviews of one author per 7 days, admin-assigned in V1), SLA 72 h, `bootstrap` (founder merge authority, own work PROVISIONAL, self-review never satisfies, public label, ratification queue first), approval binding (head + submission + context + policy), `audits` (10%, 30% for accounts with < 10 receipts, 50% flagged; disagreement revokes original), `payoutAudit` (quorum 2 outside-feature + optional own-feature seat, small-pool threshold 10, ≤ 3 duty tasks per claim, duty effort `high`, provider diversity, sealed, unmet duty withheld 8 epochs, contradicted credit lost, inflation bonus 10% of the clip, false-findings signal after 3, usage published after finalization), `canaries` (5% / 15% new / 25% flagged; 6 perturbations; magnitude ≥ 1.5×; ≤ 2 uses per source; pass → revoke unfinalized and flag), random agent reviewer assignment.

## 6. UsageProofPolicy (`usage-proof-policy.v1.json`) — telemetry since D49

Run logs are optional evidence (`logs.required: false`); the bare-number haircut is removed (nothing is paid on usage).


Providers (claude ≥ 2.1.284 primary `cli_result_event`, cross-check stream sum; codex ≥ 0.155.0 primary the rollout transcript deduplicated by response id, cross-check the exec stream), adapters fail on any parse error (M15), plausibility (≤ 400 output tokens/s, ≤ 200,000 total tokens/s, ≤ 2% source mismatch, provider-id hashes, transcript hash, model match), logs (required, ≤ 1 MiB, ≤ 2,000 turns, 365-day retention, bare ATTESTED weighted 50%, exact totals), audit (build re-runs 0%, transcript requests 5%, 60-day retention, divergence factor 3×).

## 7. RiskPolicy (`risk-policy.v1.json`)

Two-person actions are a property of the action kind in the database (`wos.two_person_action`), mirroring `twoPersonActions` (H12). Detectors (peer outlier log-Z > 2.5 with ≥ 30 peers; cap saturation ≥ 95% on > 50% of ≥ 10 runs; throughput; source mismatch; model mismatch; duplicate provider ids; audit divergence 3×; transcript missing after 7 days; review pairs > 50% of ≥ 5; rubber stamp ≥ 98% pass over ≥ 20 with median < 120 s; wallet rebind within 30 days of a signal), effects (info/low none, medium hold, high exclude pending review), two-person actions, wallet rebind cooldown 7 days.

## 8. MergePolicy (`merge-policy.v1.json`)

Qualified + ReviewPolicy satisfied; merge queue; maintainer approval on `wos.json`, manifests/lockfiles, contracts, migrations and `docs/protocol/**`. Who merges after bootstrap is F5 (G-04).

## 9. CompletionRewardPolicy (`completion-policy.v1.json`)

Feature pool split implementers 75 / contract authors 10 / roadmap authors 5 / reviewers 8 / finder 2; application pools by lifetime weight on the target; completeness requires every in-profile surface, the acceptance suite, a security review and an exit-rights check (D50: standard Postgres, settings/env configuration, data export; not first-class self-hosting); definitions append new versions on scope change; shared features accrue equally across referencing targets; pools of removed/aliased features return after 52 epochs.

## 10. GenesisAllocationPolicy (`genesis-policy.v1.json`)

Cap 5,000,000 WOS; cutoff = first live receipt; valuation `accepted_output_reference` over live epochs 1–12 with ≥ 30 receipts from a FROZEN, independently reviewed reference population excluding Genesis beneficiaries and related parties, fallback 400 WOS per retro size point; each commit maps to exactly one retro unit (D48); vesting released by the protocol as scheduled entitlements (confiscatable, D39); vesting from mainnet launch, 730 days, no cliff; protocol-class review with ≥ 2 independent humans, founder excluded; excludes provisional receipts and test epochs; never minted on devnet.

## 11. GovernancePolicy (`governance-policy.v1.json`)

Mode `founder`; activation (≥ 50 voters, ≥ 10,000,000 WOS locked ≥ 12 months, no voter > 20%); lock rule (full weight while ≥ 365 days remain AND the lock is seasoned ≥ 1 full epoch before the snapshot; 5% per beneficial owner); beneficial owner = an organization, or a person with every account and wallet they control; FINAL-share caps by water-filling with a feasibility guard (D44); contribution window 26 epochs, linear age-out; locked voters must have contributed; per-organization cap 10%; tiers (routine 60% / 20% turnout, structural 70% / 30%, governance 75% / 40%, emergency ratification > 50% / 10%); voting 168 h; timelock 1 epoch; limits ±5 pp slices, ±30% oracle; emergency 3-of-5, pause ≤ 336 h.

## 12. Organizations (D38)

Default organization share of a sponsored contributor's allocations: 100% (`DEFAULT_ORGANIZATION_SHARE_BP`), configurable per link by the org; governance per-organization cap 10% (GovernancePolicy `orgCapBp`).

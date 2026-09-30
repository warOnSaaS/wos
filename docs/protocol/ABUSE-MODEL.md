# ABUSE-MODEL (DRAFT v4, D49 budget-based rewards) — threats, signals, flags, confiscation, admin actions

Contracts: `AbuseSignal`, `ContributionRiskFlag`, `AdminAction`, `RiskPolicy` (`risk-policy.v1.json`), anomaly metrics (`engine.ts`). DB: `abuse_signals`, `risk_flags` (private), `admin_actions` (public, hash-chained). Numbers referenced as (A)…(L) are tables in TOKENOMICS-SIMULATION.md.

## 1. What changed in the threat model

SECURITY S-24 said Sybil incentives are small because tokens have no cash value. A5 makes WOS a real Solana token that may become tradeable, so **every incentive below is real money at mainnet**. The design assumes contributors run modified clients, own several accounts, collude, and read every public record.

No perfect fraud algorithm exists here. What exists: (1) bounds on what any lie can gain (since D49 the pay of a task is its budget, fixed before work, so usage lies gain nothing; the issuance-rate ceiling; model-bounded budgets with a hard maximum; per-objective caps; a holdback against defective work and misattribution; confiscation; exclusion); (2) many independent chances to be caught (random gates, human review, anomaly ranking, disputes with bounties, sampled audits, canaries, the pattern lookback); (3) auditable, immutable responses (AdminActions, no silent confiscation).

## 2. Threats (Part B's list plus ours)

| # | Threat | Bound / control | Signals | Residual |
|---|---|---|---|---|
| T1 | Suspicious token consumption | **dissolved by D49**: usage is telemetry; pay is the budget fixed before work; the execution cap stops the run | `usage_outlier_vs_peers` (telemetry, calibration hygiene) | none economic: fabricated usage gains 0% by construction (A, A2); it could skew budget calibration (G-91) |
| T2 | Repeated cap saturation | telemetry signal only; decomposition when units always need more (feeds recalibration) | `cap_saturation_pattern` | none economic |
| T3 | Abnormal usage vs comparable ABUs | telemetry; excluded from calibration when anomalous | `usage_outlier_vs_peers` | calibration poisoning (G-91) |
| T4 | Repeated failures | `maxFailedAttemptsPerAbu`, nothing paid for failure | `repeated_failures` | quota burn only (theirs) |
| T5 | Collusive reviews | random assignment, distinct seats, related accounts, 5/7-day author cap, review audits 10–50% | `collusive_review_pattern` | small pools (D): 3-account ring in a pool of 10 captures both agent slots 2.8% of the time; the human is the gate |
| T6 | Sybil behaviour | GitHub age ≥ 90 d, one GitHub per account, related accounts, human gate, KYC at mainnet (F9) | `sybil_cluster` (maintainer-only linkage) | a person with several aged GitHub accounts; real until KYC |
| T7 | Model spoofing | capability class check, reported model vs policy, effort observed | `model_mismatch` | quality risk only (acceptance review decides); no pay effect since D49 |
| T8 | Fabricated usage | **dissolved by D49** (pay does not depend on usage); response-id dedup and exact-total logs keep telemetry clean | `run_log_inconsistent`, `duplicate_provider_ids`, `impossible_throughput` | calibration poisoning (G-91) |
| T9 | Manipulated telemetry | the client is untrusted (USAGE-PROOF §1); calibration only from accepted tasks, robust statistics, ≤ 20% change per step | as T8 | G-91 |
| T10 | Duplicate attempts | one live attempt per ABU; dedup keys; receipts once per mode | `duplicate_attempt` | none |
| T11 | Coordinated farming | ceiling, related accounts, per-org cap, anomaly clusters | `sybil_cluster`, `consistent_skim_pattern` | see T6 |
| T12 | Intentional looping | costs the looper's own subscription; pays nothing since D49 | `intentional_looping` | none economic |
| T13 | Context inflation | costs the contributor; pays nothing since D49 | `context_inflation` | none economic |
| T14 | Compromised reviewer accounts | device revocation, suspension, review audits | `compromised_account_suspected` | window until detected |
| T15 | **Skim** (v3: inflate every receipt a little) | D49: becomes BUDGET skim — budgets a little above the model on every task (T27) | `consistent_skim_pattern` (now on budgets vs peers) | see T27 |
| T16 | **Rubber-stamp / scripted auditors** | evidence-citing verdict schema, sealed seats, payout canaries, contradiction loses credit | `payout_canary_passed`, `rubber_stamp_pattern` | a client that cross-checks public data (§5) |
| T17 | **Dispute spam / griefing** | stake (2%/item, cap 10%), 3 disputes and 25 items per epoch, `rejected_disputes` halves the limit | `rejected_disputes` | max loss 36 WOS/epoch at the S2 rate for a griefer; each false dispute costs others ≤ 2 audit runs per item (G) |
| T18 | **Retaliation** (dispute whoever disputed you) | disputes are judged by random outside auditors, not the parties; the accused's dispute on the disputer is flagged as possible retaliation in the gate context | `rejected_disputes` | social cost only |
| T19 | Model choice gaming (expensive model for easy units) | pays nothing since D49 (the budget is model-independent) | outlier vs same-key peers (telemetry) | none economic |
| T20 | Task splitting / reward stacking | **per-objective budget cap** (DB): all tasks under one acceptance objective share its consensus budget; split gaming is a material finding and a dispute reason | `split_stacking` perturbation in canaries | without the cap a split adds review bases: +9% to +67% (O); with it 0% |
| T21 | Builder + friendly reviewer | review budgets fixed by risk class, independent of the builder's budget | `collusive_review_pattern` | none economic |
| T22 | Wallet takeover redirecting allocations | re-binding needs e-mail confirmation + signature from the new wallet, 7-day cooldown, rebind after a signal is itself a signal | `wallet_rebind_after_signal` | the cooldown window |
| T23 | Organization farms (D38) | related accounts across every gate, per-org 10% governance cap, per-org concentration in the anomaly view | `sybil_cluster` | an org using employees as cheap auditors of outsiders: allowed, but they never confirm each other |
| T24 | Founder capture | provisional receipts, rate ceiling, Genesis cap, two-person admin actions, founder mode ends at the activation threshold | public admin log | early concentration (K) |
| T25 | Policy capture | forward-only, previews, tiered dual supermajority, per-change limits | — | concentrated early weight (J, K) |
| T26 | Chain/program failure, legal order | off-ramp: pause (auto-expiring), adapter switch, migration from snapshot | — | OFF-RAMP.md |
| T27 | **Budget inflation** (D49): a proposer lobbies or colludes for bigger budgets on units a friend builds | budget model + bounded multipliers; consensus review (an unjustified budget is a material finding); written justification and a two-person `approve_budget` above 1.25× the model; hard maximum 2×; peer ranking of budgets (sign test); the proposer and related accounts may not take the lease; per-objective cap | `consistent_skim_pattern` on budgets, `budget_outlier_vs_peers` | +5% to +26% extra pay per inflated unit over 13 epochs depending on review quality and ring size (N); zero-sum inside an objective |
| T28 | **Cherry-picking easy budgets** (D49): take only tasks the model overprices | difficulty multiplier; recalibration from telemetry of accepted tasks every 13 epochs (≤ 20% per step); leases per account; review audits | `easy_task_concentration` | a +50% overpricing lasts ~2 recalibrations, 26 epochs (P) |
| T29 | **Stale budgets** (D49): models get cheaper, budgets in ACU overpay | the oracle and the budget model recalibrate; unaccepted tasks expire after 4 epochs and are re-priced | — | ~6% average overpay with 13-epoch recalibration vs ~73% never (P) |
| T30 | **Low-effort acceptance** (D49): accept work that barely meets the objective | binary acceptance with the full qualification chain (CI, both agent reviews, human per policy); review audits; defects after acceptance recovered from the holdback | `post_merge_defect` | quality factor q deliberately absent in V1 (F22) |

## 3. Signals and flags

A detector (RiskPolicy `detectors`, versioned) raises an `AbuseSignal` (kind, severity, subject, detector version, numeric evidence). A signal is evidence, not an accusation. Flags attach signals to receipts with an effect by highest severity: info/low → none; medium → `hold` (deferred to the next epoch, at most twice, then decided); high → `exclude_pending_review` (excluded from this epoch's manifest until a maintainer or a gate decides). Signals, flags and canaries are private (RLS) and published in aggregate each epoch (counts by kind and outcome).

## 4. Confiscation after proven cheating (D39) — no SILENT or ARBITRARY confiscation

Proven cheating (an upheld finding or a revoked receipt, with recorded evidence) leads to a NOTICE that immediately HOLDS what the protocol still controls — pending allocations, unreleased holdback tranches, unclaimed entitlements, each possibly in part — never more than the proven excess in total (v3, Astra-03 H4). The holds execute only after the reply window (≥ 72 h) and the appeal window (≥ 168 h) with no appeal, or after an appeal filed by the affected beneficiary is upheld by a two-person action taken after the reply window; an overturned appeal, or a hold not executed within 14 days of the appeal window (draft value, F17), releases them. Recovery is compensatory; punitive forfeiture is not adopted (F17: compensatory only, accepted by D57). Genesis vesting is not confiscable until Genesis entitlements exist (mainnet). Any remainder becomes an offset on future earnings; an uncollectable offset is written off and absorbed by later budgets (bounded). The cheater's receipts are revoked (append-only), governance weight is zeroed, and the account is excluded — time-boxed by AdminAction (≤ 52 epochs), or permanently by a structural governance vote. Confiscated amounts return to the epoch pool and fund recovered-only bounties; wOS never receives them.

**Not on chain.** Released tokens are never seized: there is no freeze authority and no permanent delegate, because a master key over every holder is itself the largest attack target and contradicts a neutral proof of contribution. More reach comes only from a longer or larger holdback, by policy.

## 5. Admin actions (every effect recorded, action-bound)

Every effect on a person's standing or allocation is an `AdminAction` row: actor, action, target, reason (≥ 20 characters), the exact payload it authorizes, previous state, resulting state, and a co-signer when the ACTION KIND requires two people (`wos.two_person_action`: invalidate_receipt, suspend_account, record_offset, activate_policy, activate_oracle, record_genesis, approve_genesis_reference, confiscate, decide_confiscation_appeal, exclude, clip_receipt, switch_adapter, write_off) — a caller's label is ignored (H12). Every consuming mutation (status events, clips, offsets, activations, qualifications, resolutions, appeals, pauses, confiscations, exclusions) must cite an action of an allowed kind whose target is exactly that row (`wos.require_admin_action`); hash-chained (`admin_actions_chain`, advisory lock 7313372) so the log is tamper-evident and published. Actions: authorize/revoke reviewer, suspend/restore reward eligibility, suspend/restore reviewer privileges, suspend/restore account, invalidate/restore/hold receipt, clear/uphold risk flag, record offset, clip receipt, activate policy/oracle, set model eligibility, epoch transitions, record Genesis, award security, bootstrap merge, ratify/reject ratification, resolve ratification dispute, end bootstrap, start/end test epochs. Invalidation before finalization excludes the receipt; after finalization it becomes an offset. Restoration is always possible and recorded. Nothing is deleted.

## 6. What canaries and client checks cannot do (stated plainly)

- The CLI cannot detect tampering by asking the agent: the client, the `claude`/`codex` binaries and the machine are contributor-controlled, and the model cannot see host integrity. Binary checks are speed bumps.
- **Code-defect canaries are not used**: any mutated commit is distinguishable from real public history.
- **Payout canaries** are behavioural checks, never execution attestation (H11). Their classification is private (quorums and verdicts are not public; only real outcomes are published) and packets carry no ids, feature keys or public dispute ids. They are indistinguishable only during the audit window, because per-run usage and logs are unpublished until finalization and packets carry no ids. A client can still cross-check a packet against work it contributed to, or share packets within a ring. Canaries therefore catch lazy and scripted clients (E: at 5% and 3 audits/epoch, 95% are caught within ~19 epochs); they do not stop a careful adversary, who must then actually run the model on real tasks — which is the goal.

## 7. Small pools (honest statement, D24)

With fewer than ~10 eligible auditors, random assignment concentrates and one person with several accounts can plausibly land on their own work (D). Backstops, in order: the admin-authorized human reviewer (the founder in V1), related-account rules, GitHub-age and one-GitHub rules, KYC at the mainnet gate, caps bounding any gain to the unit budget of real accepted work, and the provisional-receipt rule for the founder's own work. Below `smallPoolThreshold` (10) the human sign-off replaces the audit quorum.

**Residual (H8):** relatedness is evaluated live. Sponsorship history is never deleted, but team memberships can be; a colleague who leaves the organization just before an assignment is no longer related. Membership history is a gap (GAPS G-80).

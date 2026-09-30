# ABUSE-MODEL (DRAFT) — threats, signals, flags, admin actions

Contracts: `AbuseSignal`, `ContributionRiskFlag`, `AdminAction`, `RiskPolicy` (`risk-policy.v1.json`), anomaly metrics (`engine.ts`). DB: `abuse_signals`, `risk_flags` (private), `admin_actions` (public, hash-chained). Numbers referenced as (A)…(L) are tables in TOKENOMICS-SIMULATION.md.

## 1. What changed in the threat model

SECURITY S-24 said Sybil incentives are small because tokens have no cash value. A5 makes WOS a real Solana token that may become tradeable, so **every incentive below is real money at mainnet**. The design assumes contributors run modified clients, own several accounts, collude, and read every public record.

No perfect fraud algorithm exists here. What exists: (1) bounds on what any lie can gain (caps, the rate ceiling, clipping, offsets); (2) many independent chances to be caught (random gates, human review, anomaly ranking, disputes with bounties, sampled audits, canaries, the pattern lookback); (3) auditable, immutable responses (AdminActions, no silent confiscation).

## 2. Threats (Part B's list plus ours)

| # | Threat | Bound / control | Signals | Residual |
|---|---|---|---|---|
| T1 | Suspicious token consumption | cap P75×1.25; clipping; run logs; bare-number haircut | `usage_outlier_vs_peers`, `cap_saturation_pattern` | fabricated consistent logs at the cap: +56% receipt by receipt, 0% expected with the pattern lookback (A) |
| T2 | Repeated cap saturation | anomaly `capSaturationBp`; decomposition when units always need more | `cap_saturation_pattern` | honest hard units look the same; human judgement in the gate |
| T3 | Abnormal usage vs comparable ABUs | peer baselines per key | `usage_outlier_vs_peers` | needs ≥ 30 peers per key |
| T4 | Repeated failures | `maxFailedAttemptsPerAbu`, nothing paid for failure | `repeated_failures` | quota burn only (theirs) |
| T5 | Collusive reviews | random assignment, distinct seats, related accounts, 5/7-day author cap, review audits 10–50% | `collusive_review_pattern` | small pools (D): 3-account ring in a pool of 10 captures both agent slots 2.8% of the time; the human is the gate |
| T6 | Sybil behaviour | GitHub age ≥ 90 d, one GitHub per account, related accounts, human gate, KYC at mainnet (F9) | `sybil_cluster` (maintainer-only linkage) | a person with several aged GitHub accounts; real until KYC |
| T7 | Model spoofing | capability class check, reported model vs policy, effort observed | `model_mismatch` | a modified client reports anything; audits judge plausibility |
| T8 | Fabricated usage | exact-total logs, response-id dedup, throughput limits | `run_log_inconsistent`, `duplicate_provider_ids`, `impossible_throughput` | fabrication consistent with a plausible log; bounded by cap |
| T9 | Manipulated telemetry | the client is untrusted (USAGE-PROOF §1) | as T8 | same |
| T10 | Duplicate attempts | one live attempt per ABU; dedup keys; receipts once per mode | `duplicate_attempt` | none |
| T11 | Coordinated farming | ceiling, related accounts, per-org cap, anomaly clusters | `sybil_cluster`, `consistent_skim_pattern` | see T6 |
| T12 | Intentional looping | repairs inside the cap; wOS controls loops | `intentional_looping` (log repairs without failing checks) | capped |
| T13 | Context inflation | wOS builds the manifest; extra reads visible in the log | `context_inflation` | capped |
| T14 | Compromised reviewer accounts | device revocation, suspension, review audits | `compromised_account_suspected` | window until detected |
| T15 | **Skim** (inflate every receipt a little) | full transparency, sign-test ranking over the rolling window, total-excess bounty, pattern disputes with 13-epoch lookback | `consistent_skim_pattern` | slow: 10% skim, 10 receipts/epoch → 50% ranked after ~39 epochs (B); gain ≤ skim % of own allocation |
| T16 | **Rubber-stamp / scripted auditors** | evidence-citing verdict schema, sealed seats, payout canaries, contradiction loses credit | `payout_canary_passed`, `rubber_stamp_pattern` | a client that cross-checks public data (§5) |
| T17 | **Dispute spam / griefing** | stake (2%/item, cap 10%), 3 disputes and 25 items per epoch, `rejected_disputes` halves the limit | `rejected_disputes` | max loss 36 WOS/epoch at the S2 rate for a griefer; each false dispute costs others ≤ 2 audit runs per item (G) |
| T18 | **Retaliation** (dispute whoever disputed you) | disputes are judged by random outside auditors, not the parties; the accused's dispute on the disputer is flagged as possible retaliation in the gate context | `rejected_disputes` | social cost only |
| T19 | Model choice gaming (expensive model for easy units) | capability class per ABU size; ACU cap is model-independent | outlier vs same-key peers | up to cap headroom (A: +54% receipt by receipt) |
| T20 | Task splitting | ABUs are defined by reviewed contracts; split gaming is a material finding for contract reviewers and a dispute reason | — | +10% at most (A) |
| T21 | Builder + friendly reviewer | human weight fixed, not builder ACU (Astra-01 item 5) | `collusive_review_pattern` | none economic |
| T22 | Wallet takeover redirecting allocations | re-binding needs e-mail confirmation + signature from the new wallet, 7-day cooldown, rebind after a signal is itself a signal | `wallet_rebind_after_signal` | the cooldown window |
| T23 | Organization farms (D38) | related accounts across every gate, per-org 10% governance cap, per-org concentration in the anomaly view | `sybil_cluster` | an org using employees as cheap auditors of outsiders: allowed, but they never confirm each other |
| T24 | Founder capture | provisional receipts, rate ceiling, Genesis cap, two-person admin actions, founder mode ends at the activation threshold | public admin log | early concentration (K) |
| T25 | Policy capture | forward-only, previews, tiered dual supermajority, per-change limits | — | concentrated early weight (J, K) |
| T26 | Chain/program failure, legal order | off-ramp: pause (auto-expiring), adapter switch, migration from snapshot | — | OFF-RAMP.md |

## 3. Signals and flags

A detector (RiskPolicy `detectors`, versioned) raises an `AbuseSignal` (kind, severity, subject, detector version, numeric evidence). A signal is evidence, not an accusation. Flags attach signals to receipts with an effect by highest severity: info/low → none; medium → `hold` (deferred to the next epoch, at most twice, then decided); high → `exclude_pending_review` (excluded from this epoch's manifest until a maintainer or a gate decides). Signals, flags and canaries are private (RLS) and published in aggregate each epoch (counts by kind and outcome).

## 4. Admin actions (no silent confiscation)

Every effect on a person's standing or allocation is an `AdminAction` row: actor, action, target, reason (≥ 20 characters), affected receipts and epochs, previous state, resulting state, co-signer for two-person actions (`invalidate_receipt`, `suspend_account`, `record_offset`, `activate_policy`, `activate_oracle`, `record_genesis`), hash-chained (`admin_actions_chain`, advisory lock 7313372) so the log is tamper-evident and published. Actions: authorize/revoke reviewer, suspend/restore reward eligibility, suspend/restore reviewer privileges, suspend/restore account, invalidate/restore/hold receipt, clear/uphold risk flag, record offset, clip receipt, activate policy/oracle, set model eligibility, epoch transitions, record Genesis, award security, bootstrap merge, ratify/reject ratification, resolve ratification dispute, end bootstrap, start/end test epochs. Invalidation before finalization excludes the receipt; after finalization it becomes an offset. Restoration is always possible and recorded. Nothing is deleted.

## 5. What canaries and client checks cannot do (stated plainly)

- The CLI cannot detect tampering by asking the agent: the client, the `claude`/`codex` binaries and the machine are contributor-controlled, and the model cannot see host integrity. Binary checks are speed bumps.
- **Code-defect canaries are not used**: any mutated commit is distinguishable from real public history.
- **Payout canaries** are indistinguishable only during the audit window, because per-run usage and logs are unpublished until finalization and packets carry no ids. A client can still cross-check a packet against work it contributed to, or share packets within a ring. Canaries therefore catch lazy and scripted clients (E: at 5% and 3 audits/epoch, 95% are caught within ~19 epochs); they do not stop a careful adversary, who must then actually run the model on real tasks — which is the goal.

## 6. Small pools (honest statement, D24)

With fewer than ~10 eligible auditors, random assignment concentrates and one person with several accounts can plausibly land on their own work (D). Backstops, in order: the admin-authorized human reviewer (the founder in V1), related-account rules, GitHub-age and one-GitHub rules, KYC at the mainnet gate, caps bounding any gain to the unit budget of real accepted work, and the provisional-receipt rule for the founder's own work. Below `smallPoolThreshold` (10) the human sign-off replaces the audit quorum.

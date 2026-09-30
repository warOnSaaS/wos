# MAINNET-READINESS (DRAFT) — the gate before value-bearing WOS

Mainnet is a separate, deliberate milestone (A5). Every item below needs evidence (a document, a test run, an audit report, a transaction) recorded in this file with a date before any mainnet mint. A8: one legal checkpoint, no more regulatory friction than that.

| # | Gate item | Evidence required | Owner |
|---|---|---|---|
| G-1 | Tokenomics simulation re-run on real devnet data | `tools/tokenomics-sim` with parameters fitted to ≥ 26 live devnet epochs; founder sign-off on F2/F3 | architect, founder |
| G-2 | Solana programs | list of every program used, its audit report, its upgrade authority (must be `None` or a known multisig), verifiable-build hashes for anything we deploy | protocol-chain |
| G-3 | Authorities | TOKEN-AUTHORITIES executed on devnet first: escrow funded, mint revoked, metadata authority, signer list public | founder, protocol-chain |
| G-4 | Multisig | Squads v4 (or chosen) configuration, 3-of-5, hardware keys, signer independence, a recorded key-rotation drill | founder |
| G-5 | Reward abuse | ABUSE-MODEL threats T1–T26 each with a test or an accepted residual; canary and audit catch rates measured on devnet | protocol-review |
| G-6 | Sybil resistance | KYC decision (F9) implemented for claimants above the threshold; related-account rules exercised | founder, control-plane |
| G-7 | Wallet security | binding, re-binding cooldown, e-mail confirmation, no key in Desktop main process (IPC fuzz), phishing-resistant copy | desktop, web |
| G-8 | Governance locks | lock program chosen (TOKENOMICS-REVIEW §6), Token-2022 support verified, snapshot-by-slot tested | protocol-chain |
| G-9 | Epoch finality | 26 consecutive devnet epochs CLOSED with reconciliation; windows never violated (DB-enforced); at least one dispute resolved each way | protocol-engine |
| G-10 | Oracle integrity | oracle rates `verified: true` from providers' price pages; damping and ceiling re-basing exercised | architect |
| G-11 | Evidence eligibility | founder decision F1 recorded with the fabrication results (TOKENOMICS-SIMULATION A2) and a MEASURED per-receipt detection rate from devnet (audits, disputes, canaries against an adaptive red-team client); ATTESTED usage on mainnet yes/no, or accepted-output weight | founder |
| G-12 | Genesis | retro roadmap PR merged; computation reviewed by ≥ 2 independent humans; `record_genesis` two-person action | founder, reviewers |
| G-13 | Receipt integrity | every devnet receipt recomputes to its hash; admin-actions chain verifies; roots match Memo anchors | protocol-engine |
| G-14 | Economic attacks | skim, cap-saturation and dispute-griefing drills on devnet with measured detection | protocol-review |
| G-15 | Upgrade authority | no upgradeable program under anyone's unilateral control | protocol-chain |
| G-16 | Emergency procedures | pause drill (auto-expiry observed), incident runbook, contact list | founder |
| G-17 | **Off-ramp drill** | pause → accrue under `paused_accrual` → migrate to `in_app_credits` from a snapshot → every claimant reconciles (automated in the E2E test) | protocol-engine |
| G-18 | Legal checkpoint (the one) | a written opinion covering: whether WOS allocated for contribution is a security in the founder's jurisdictions; whether allocation, transferability or wOS Cloud accepting WOS changes that; tax reporting for recipients (contractor paperwork deferred to here by A8), including organization beneficiaries and employee/contractor responsibility (D45); consumer protection; the subscription-terms question G-03; **privacy (D47)**: publication of pseudonymous allocations and wallets, retention, the named responsible entity, organization-linked personal data; the confiscation and exclusion process (D39) | founder |
| G-19 | Transferability (F8) | decided with G-18 | founder |
| G-21 | Canaries against an adaptive client | measured catch rate of payout canaries when a red-team client cross-checks everything public; results published | protocol-review |
| G-22 | Holdback and confiscation drill | a proven-cheating drill on devnet: notice with holds, reply, appeal (upheld and overturned), execution from holdback/pending/unclaimed, lapse of an unexecuted hold, exclusion, recovered-only bounty; conservation checked | protocol-engine |
| G-23 | Settlement semantics on a cluster (Astra-03 H9) | devnet end-to-end: persisted signed attempt, a forced blockhash expiry proven by observed block height and a historical status lookup, one replacement, finalized confirmation; a pause and a migration snapshot racing an in-flight attempt; the broadcaster fenced by `may_broadcast` (GAPS G-89) | protocol-engine |
| G-24 | Recovery policy decided (F17) and finalization completeness enforced (G-90) | founder decision on compensatory vs punitive recovery and hold duration; the DISTRIBUTABLE transition checks that every final allocation was entitled | founder, protocol-engine |
| G-20 | Public disclosure | "WOS may become worthless or be replaced…" (OFF-RAMP) on every token surface; no price talk anywhere | web, desktop |

A failing item blocks mainnet. Passing all items does not oblige anyone to launch.

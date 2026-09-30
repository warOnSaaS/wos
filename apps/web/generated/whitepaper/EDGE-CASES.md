# warOnSaaS white paper: edge cases we considered

Companion file to the warOnSaaS white paper (`WHITEPAPER.md`, the core; its header gives the version and last-updated date). It indexes every edge case, abuse and failure mode the design addresses, where each is handled, the exact test name where one exists, and its status. Point 5 of the evaluation brief asks the agent to go through it. It is optional depth: an evaluating agent can reach a full assessment from the core alone and should open this file only to check a detail.

Section numbers in this file ("section 16", "section 33") refer to the full design narrative in `DESIGN.md`, which keeps the v0.4 numbering. History: https://github.com/warOnSaaS/wos/commits/main/docs/whitepaper

## Edge cases we considered (was section 43)

This is the index of every edge case, abuse and failure mode the design addresses, so an evaluating agent can go through them one by one (point 5 of the instructions). It is compact on purpose; each row says where the case is handled.

How to read it:

- **Where.** "Main" means a public file on the main branch, linked. "Draft" means the protocol draft under review, which is not yet public: ABUSE-MODEL threat numbers (T1 to T30), GUARANTEES rows, and GAPS items (G-nn) refer to documents on that branch.
- **Test.** A test name is quoted exactly where one exists. "db" is the draft's database assertion block, "unit" its rule and engine tests, "race" its two-session race tests; main tests are in https://github.com/warOnSaaS/wos/tree/main/tests/adversarial . A dash means no named test.
- **Status.** handled: a mechanism exists and a test exercises it. partial: a mechanism exists with a stated residual. open: acknowledged, not solved. "Handled" in a draft means handled in draft code and tests, not in production; nothing in the draft runs in production.

### Building and review (main, running code)

| Edge case | Where | Test | Status |
|---|---|---|---|
| Two builders claim the same unit at once | Main: leases (docs/architecture/BUILD-PROTOCOL.md) | "20 builders claiming one ABU: exactly one lease, 19 conflicts" | handled |
| Parallel builders touch overlapping files | Main: write-set path locks | "20 builders over 20 ABUs with overlapping scopes: granted scopes never overlap and every disjoint subtree is granted" | handled |
| A worker vanishes holding a lease | Main: heartbeats and expiry, SECURITY S-27 | "a lease with no heartbeat expires and the ABU can be claimed again (S-27)" | handled |
| A builder reviews their own work | Main: SECURITY S-12, D2 | "self-review outside bootstrap: the builder cannot review their own attempt" | handled |
| One account fills both review seats | Main: SECURITY S-12 | "the same account cannot fill both slots of a round (independent)" | handled |
| A reviewer sees the other reviewer's verdict first | Main: sealed verdicts, SECURITY S-11 | "reviewer seeing the other slot: nothing of a sealed verdict is served to the other slot before reveal" | handled |
| A verdict reused for a different diff or round | Main: SECURITY S-23 | "a verdict for a different head sha or diff hash is rejected" | handled |
| A pass verdict over a material finding | Main: SECURITY S-23 | "rejects a pass with a material finding" | handled |
| A modified client forges a submission | Main: signed submissions, SECURITY S-22 | "a forged submission (content swapped after signing, hashes recomputed) is refused with SIGNATURE_INVALID" | handled |
| A contributor pushes or opens a pull request directly | Main: only the App opens PRs, SECURITY S-18, D9 | "S-19: an unsigned webhook delivery is refused" (the App gate); repository rule verified by hand | handled |
| Symlinks, generated files, lockfiles or workflows smuggled into a change | Main: SECURITY S-15 to S-17, S-26 | - (adversarial pipeline suite) | handled |
| The candidate redefines its own verification | Main: SECURITY S-33 | - (adversarial pipeline suite) | handled |
| Prompt injection through repository content | Main: SECURITY S-21; agents run restricted, S-14 | "claude always runs restricted, in safe mode, without MCP, sessions or prompts" | partial (no agent is injection-proof) |
| Model identity cannot be proven | Main: SECURITY S-13, D1 (attestation, cross-review) | "S-13: a review citing an agent run whose signature did not verify is rejected (0003)" | partial (by design an attestation) |
| New or throwaway GitHub accounts | Main: SECURITY S-24 | "S-24: a GitHub account younger than 90 days cannot claim a build" | partial (aged accounts remain) |
| Contributor data visible to other contributors | Main: row-level security, SECURITY S-9 | "private rows: another account's leases, devices and emails are invisible" | handled |
| Records rewritten after the fact | Main: append-only records, SECURITY S-10 | "the table owner cannot rewrite a sealed verdict, a manifest or an event" | handled |
| Magic-link phishing or forwarding | Main: SECURITY S-2 | "S-2: a link redeemed with the wrong poll secret fails" | handled |
| Account enumeration at sign-in | Main: SECURITY S-3 | "S-3: the start response is identical for a known and an unknown email" | handled |
| A cheaper builder model used for reviews | Main: D15 | "no reviewer or resolver role lists Sol in the policy data" | handled |
| Copying a vendor's trade dress while replicating function | Main: D13, SECURITY S-36 | "covers all six reviewer roles" (S-36 suite) | partial (review judgment) |

### Rewards and budgets (draft, not yet public)

| Edge case | Where | Test | Status |
|---|---|---|---|
| Fabricated or inflated token usage | Draft: D49; ABUSE-MODEL T1, T8, T13, T19 (usage never pays) | unit: "D49: a receipt weighted by its usage instead of its task budget" | handled; calibration poisoning remains (G-91) |
| Budget inflation by a proposer and a friend | Draft: D49; ABUSE-MODEL T27 | unit: "D49: a budget above the hard maximum of the model"; "D49: a budget above the model without a written justification / without a two-person approval" | partial (+5% to +26% simulated, bounded) |
| A budget changed after work started | Draft: D49 | db: "D49: a budget set after work started (the task already has a lease)" | handled |
| The budget proposer builds the task | Draft: D49 | db: "D49: the proposer of a budget taking its lease" | handled |
| Splitting one piece of work to stack rewards | Draft: per-objective cap, ABUSE-MODEL T20 | db: "D49: task budgets under one objective exceeding it (splitting / stacking)"; unit: "D49: a third share on a fully declared task (reward stacking)" | handled |
| Paying more than a task's reserved budget | Draft: reservation at issuance | db: "D49: allocating more than the task's reserved budget" | handled |
| Over-issuing tasks beyond an epoch's capacity | Draft: reservation at issuance | db: "D49: issuing beyond the epoch's task capacity (reservation at issuance, never scaled)"; race: "D49: two task issuances racing for the last epoch capacity" | handled |
| Shares that do not add up | Draft: declared shares | db: "D49: declared shares of a task summing to less than 10000 bp" | handled |
| Cherry-picking overpriced tasks | Draft: recalibration, ABUSE-MODEL T28 | - | partial (~26 epochs for a +50% overpricing, simulated) |
| Stale budgets as model prices fall | Draft: recalibration and expiry, ABUSE-MODEL T29 | - | partial (~6% average overpay, simulated) |
| Barely acceptable work accepted | Draft: binary acceptance, holdback, ABUSE-MODEL T30 | - | partial (no quality factor, F22) |
| Collusive reviewers | Draft: random assignment, related accounts, audits, ABUSE-MODEL T5 | - | partial (small pools; the human is the gate) |
| Sybil identities | Draft: related accounts, GitHub age, KYC at mainnet (F9), ABUSE-MODEL T6 | - | open until an identity decision |
| Organizations farming through employees | Draft: related accounts, 10% cap, ABUSE-MODEL T23 | db: "H8: a human review of an org-mate's receipt" | partial (membership history, G-80) |
| A colleague leaves an organization just before an assignment | Draft: ABUSE-MODEL §7 | - | open (G-80) |
| Founder capture | Draft: provisional receipts, ceiling, Genesis cap, ABUSE-MODEL T24 | db: "bootstrap_merge outside bootstrap mode"; unit: "D23: ratifying a receipt that is not provisional; restoring to a status it never had" | partial (early concentration is stated) |
| Genesis double credit or a related party in the reference population | Draft: GENESIS-POLICY | db: "M16: one commit credited to two retro units"; unit: "A3-12 repro: a reference-population member added later as a Genesis beneficiary; …" | handled |
| Allocating one person's receipt to another | Draft: allocation rules | unit: "repro C / H2: allocating a receipt to someone else's beneficiary, …" | handled |
| Allocations changed after publication | Draft: epoch state machine | db: "repro C / H2: an allocation added after publication" | handled |
| Skipping the risk-review or challenge windows | Draft: epoch windows | db: "repro A: skipping every epoch window (H6)"; "H6: finalizing inside the challenge window" | handled |
| A service skips a rule and writes a wrong row | Draft: D51 engine-first | - | open (G-97; mitigations proposed) |

### Disputes, audits and recovery (draft, not yet public)

| Edge case | Where | Test | Status |
|---|---|---|---|
| Small skims on every line | Draft: transparency and anomaly metrics, ABUSE-MODEL T15, T27 | - | partial (depends on someone looking) |
| Dispute spam and griefing | Draft: per-item stakes, limits, ABUSE-MODEL T17 | unit: "repro E: a zero-stake dispute; an empty bundle; a non-participant; one's own allocation; joining a resolved allocation" | handled |
| One stake reused across disputes | Draft: stake reservation | unit: "A3-3 repro: a second dispute staking the same 1 WOS of pending allocation" | handled |
| Retaliatory disputes | Draft: outside auditors, ABUSE-MODEL T18 | - | partial (social cost) |
| A bounty paid on excess an appeal reversed | Draft: derived settlement | unit: "A3-3 repro: a settlement paying a bounty on excess the appeal reversed (derived: 0 excess, stake forfeited)" | handled |
| Settling before an appeal can be filed | Draft: appeal windows | unit: "A3-3 repro: settling before the appeal window closed; settling while an appeal is pending" | handled |
| Rubber-stamp or scripted auditors | Draft: payout canaries, sealed seats, ABUSE-MODEL T16 | unit: "A3-6 repro: a claude run declared as the codex seat" | partial (a careful adversary can cross-check public data) |
| No eligible auditor available | Draft: D42, release flagged unaudited | - | partial (by design) |
| Confiscation beyond the proven excess | Draft: D39, compensatory only | race: "A3-4: two 50 holds against 60 proven excess concurrently" | handled |
| Confiscation before reply and appeal | Draft: D39 due process | unit: "A3-4: executing while the appeal is open; after the hold lapsed; when overturned" | handled |
| Seizing tokens already released | Draft: no freeze authority, no permanent delegate | db: "D39: confiscating an entitlement already in a live (settled) leaf: released tokens are never seized" | handled |
| Fraud nobody can recover | Draft: D41 write-off, at most 10% of a budget per epoch | - | partial (losses absorbed, bounded) |
| An admin action reused or approved by the same person | Draft: action-bound, two-person admin actions | db: "A3-7 repro: one admin action used for a second mutation"; unit: "A3-7: an approval of a different operation hash / by the actor" | handled |
| A defect found after the holdback released | Draft: offsets on future allocations | - | partial (worthless if the contributor leaves) |

### Settlement, governance and exit (draft unless noted)

| Edge case | Where | Test | Status |
|---|---|---|---|
| One entitlement paid twice | Draft: claim leaves and settlement attempts | race: "A3-2: one entitlement claimed into two leaves concurrently"; db: "H3 / A3-2: the same entitlement in two live leaves" | handled in tests; never run on a real cluster (G-89) |
| A transaction whose landing is uncertain | Draft: persist before broadcast, proven expiry | db: "H3: declaring an attempt expired without a historical search"; "A3-9 repro: signed bytes declared failed-before-broadcast" | handled in tests; not run on devnet (G-74, G-89) |
| Test tokens routed to mainnet | Draft: default-deny | db: "A3-1 repro: a mainnet leaf (default-deny at the settlement boundary; also a CHECK)" | handled |
| A wallet takeover redirecting allocations | Draft: rebind cooldown, ABUSE-MODEL T22 | db: "repro D: one wallet bound to two accounts under RLS (H9)" | partial (cooldown window) |
| A chain failure, program bug or legal order | Draft: off-ramp pause and migration, ABUSE-MODEL T26 | race: "A3-9: a settlement attempt racing a pause and a migration snapshot"; db: "repro G: a pause expiring a year from now via a future created_at (H6)" | handled in tests; drill not yet run |
| A falling token price used as a pretext | Draft: not a trigger | - | handled by rule |
| Governance captured by a bloc or by capital | Draft: dual weights, tiers, caps, ABUSE-MODEL T25 | - | partial (early concentration; undeclared common control) |
| Caps infeasible with too few independent groups | Draft: tally refuses | - | open (fallback F20) |
| A vote backdated into a closed window | Draft: server time | unit: "H6: a vote in a closed window …" | handled |
| Retroactive policy changes | Draft: forward-only activation | - | handled by rule |
| Customer data reaching contributors | Main: development isolated from production (section 10) | - | handled by design; no product exists yet |
| A customer cannot leave wOS Cloud | Main: Stage 1 exit rules, D50 (section 9) | - | open (no product, no exit drill yet) |
| Migrating into wOS from Salesforce and others | Amendment 03, not written | - | open |
| The official project disappears | Section 33 | - | open (secrets on one machine) |
| Review capacity cannot keep up | Sections 17 and 36 | - | open (unmeasured) |
| The token never has value | Sections 28, 38, 39 | - | open by design (no value promised) |
| Coordination overhead exceeds the compute deduplication saves | The four theses; sections 5 and 41 | - | open (efficiency metrics planned, not measured) |
| Cheaper production raises total compute (Jevons) | The four theses; section 5 | - | open (stated, not mitigated) |
| "Avoided" duplicate work that would never have happened | The four theses; section 41 method | - | open (estimate with stated uncertainty) |
| Humans end up rewriting agent output | The four theses; section 41 | - | open (measure planned) |
| Allocations cannot be kept fair at acceptable cost | Thesis 4; sections 20 to 24 | - | open (no real epochs yet) |
| wOS depends on closed models | Thesis 1; capability classes (draft D52: GLM a candidate, not qualified) | unit: "candidate models (D52: GLM via Z.ai)" | open (no non-closed model qualified) |
| The open layer is not convenient enough to be chosen | Thesis 1; hosted-first, section 9 | - | open (no product yet) |
| Contributing pays worse than free-riding | Condition (c); sections 38, 39 | - | open (the token has no value) |
| Verification costs more than regeneration | Condition (b); section 41 | - | open (unmeasured) |


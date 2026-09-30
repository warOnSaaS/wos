DO NOT IMPLEMENT YET

warOnSaaS Proof of Contribution review 04

Scope: the uploaded DRAFT v3 snapshot in wos-protocol-review-04, not a moving checkout. The changes are substantial and many original examples are now explicitly guarded. However, ordinary dispute accounting, recovery after wrongful holds, human-review requirements and interactions between reservations remain incomplete. Continue isolated development and devnet rehearsals; do not connect this draft to authoritative contributor balances yet. Nothing here authorizes mainnet.

Verification performed

Independently executed: 66 tests passed across packages/contracts/test/protocol.test.ts and tests/tokenomics-sim.test.ts, including the generated simulation consistency check. Node 22.23.1. I ran the uploaded protocol/tests in an isolated workspace using existing installed dependencies and supplementary contracts modules/tsconfig from the local checkout; the bundle is not a standalone npm project.

Independently executed additional probes: a dispute can reduce cumulativeIssued after the corresponding tokens have been claimed; a dispute against currently claimable funds instead fails the ownership-bound assertion; omission of consumedIds is still accepted at runtime. Exact outputs accompany this report.

Not independently executed: PostgreSQL migration/assertion/concurrency tests, full repository check, or Solana E2E. I requested and received permission for Docker's socket, but the environment continued to reject socket connections. No container was created. TEST-RESULTS.txt reports 1,196 passing repository tests, 250 skipped tests, passing database assertions, four passing races and the 66-test subset. Those are supplied results, distinct from my execution. The SQL findings below are static sequences for new regression tests, not claims that I executed them.

Citation key: SQL = packages/db/migrations/0007_proof_of_contribution.sql; ENGINE = packages/contracts/src/protocol/engine.ts; ENTITIES = packages/contracts/src/protocol/entities.ts; GOV = packages/contracts/src/protocol/governance.ts; SIM = tools/tokenomics-sim/sim.ts. Line numbers refer to the uploaded snapshot. SQL paths generally require an authorized control-plane writer; this review tests the promised database backstops, not a demonstrated public endpoint exploit.

Review 03 verification table

Item | Status | Evidence and residual
H1 Source-backed entitlements | PARTIAL | SQL:1647–1752 now binds allocations, amounts and maturity, and default-denies mainnet leaves. Partial maturation followed by a lifted hold can strand the remainder (finding 2). Offset consumption and completeness remain G-83/G-90. The original three examples have direct guards, but the broader invariant is not finished.
H2 Duplicate claim payments | RESOLVED for the original sequences | SQL:1793–1850 serializes claim admission and leaf mutation; confirmed/in-flight leaves cannot be voided, and claims freeze after signing. The supplied race targets concurrent claims. Settlement-evidence and confiscation-expiry issues below are separate remaining paths; no claim of end-to-end exactly-once.
H3 Appeals and stakes | PARTIAL | SQL:1582–1640 uses effective appeal amounts and waits for final adjudication; original reversed-appeal example is addressed. Stakes still do not share the actual available-source accounting with confiscations, and finality has an insertion/timeout race (findings 3 and 5).
H4 Confiscation | PARTIAL | Actual appeals, action checks, source holds and aggregate locks added (SQL:1964–2114). Unbounded deadlines, expiry/execution races and partial-release liveness remain (2–4). F17 remains open.
H5 Qualification | PARTIAL | Stronger changeset, CI, round and usage relationships at SQL:297–353, 721–747. A missing humanReviewRequired key defaults to false even though the typed snapshot omits that key (6). Admission uses the epoch oracle instead of the run's pinned oracle (7). G-84/G-88 remain.
H6 Audit assignment and independence | PARTIAL as claimed | Assignment, provider, packet, lease and one-use run checks at SQL:1073–1132 address the original audit examples. Human subject risk remains G-85; typed non-build qualification remains G-88. Do not describe all contribution types as implemented.
H7 Administrative authorization | PARTIAL | Separate approvals and one-use actions at SQL:130–173 fix replay and the named co-signer cases. Some consumers still omit payload checks, and several bound payloads omit important fields (8). Session authentication is an explicit trust assumption, not inherently invalid merely because it lacks a signature; G-86's stale-state concern remains.
H8 Organization cap | RESOLVED for the reviewed defect | GOV:176–205, 359–390 applies eligibility before caps and carries explicit validity/feasibility. Original asymmetric-eligibility and missing-metadata regressions pass in the 66-test run. Declared ownership remains a separate assumption, and infeasible-cap fallback is F20.
H9 Settlement | PARTIAL | SQL:1866–1939 fixes NULL finalized commitment, removes failed_before_broadcast, and adds a shared fence. Expiry still accepts a status response that says the transaction landed (9). Chain behavior remains G-89.
M10 Engine ownership and pinned tranches | PARTIAL | Claimable balances and fixed maturity solve the original expiry/retroactive-maturity probes. The dispute path still subtracts aggregate I without consuming escrow/owner balances (1). consumedIds is required by TypeScript but not runtime (10).
M11 Usage parser failures | RESOLVED for the reported cases | Checked totals, missing identity and empty-log regressions pass in the independently executed suite. This is not a certification of every pinned provider version or real telemetry fixture.
M12 Genesis manifest | PARTIAL | SQL:2377–2456 adds bidirectional exclusion checks, freeze-by-version and deferred commit coverage. The approved hash is not recomputed from the manifest fields; duplicate receipt IDs and test-mode population are not excluded by the shown validator (11). F21 remains open.
M13 Recovery simulation | PARTIAL as claimed | SIM:630–725 compares compensatory/punitive outcomes explicitly. Detection, false findings and organization effects are not measured/modelled fully. Its results do not establish that forfeit-all makes cheating unprofitable in deployment.
M14 Quiet-epoch timing | RESOLVED as documentation | The claimed guarantee was narrowed to smoothing; the new scenarios/regression are included in the passing suite. Stronger pricing is a founder decision, F19.
M15 Late completion corrections | PARTIAL as claimed | ENGINE:413–427 can create offsets for the paid portion. The DB lacks that attribution (G-87), and offsets are not explicit source consumption (G-83). Not safe to wire until both sides agree.
L16 Sponsored rounding | RESOLVED for the reported cases | ENGINE:506–550 aggregates exact share numerators before allocation rounding. Sponsored partition regression passes. Keep that fix.

The review-02 duty terminal-event unique index and wallet-binding disclosure check are also present. The supplied database tests address them; I did not independently rerun those tests.

New and remaining findings

HIGH 1 — Disputes can consume tokens already delivered, while valid unclaimed corrections can fail
Location: ENGINE:183–208, 453–463, 274–284.
Evidence: executed.

Sequence A: start with reserve 900, issued 100 and Alice claimable 100. Process a settled claim of 100. The state becomes reserve 900, issued 100, claimable empty. In the next epoch submit a dispute settlement with excessBase=100. The engine accepts reserve 1000, issued 0. The external payment to Alice did not reverse. Re-emitting that purported reserve would double-count supply even though the internal equation still balances.

Sequence B: start from the same state before claiming, submit excessBase=20. I decreases to 80 but Alice's claimable balance stays 100; the engine throws “holdback and claimable balances exceed issuance.” A previously useful invariant now exposes the missing ownership transition.

The comment says disputes consume unreleased escrow, but neither input nor state identifies that escrow. An event ID is not a source balance.

Smallest fix: represent disputed escrow explicitly with source/beneficiary, separate from delivered and claimable amounts; consume the exact finalized recovery source once. If correcting a currently claimable or held amount, debit that owner/source in the same transition. If already delivered, create an offset rather than returning fictional funds to reserve. Add both probes as regressions and require I to reconcile to delivered plus owned outstanding balances, including escrow.

HIGH 2 — A partial matured release can permanently strand an honest person's remainder
Location: SQL:1663, 1733–1742, 2196–2210.
Evidence: static.

Sequence: a mature tranche T contains 100. A disputed confiscation holds 10. Create the permitted holdback_matured entitlement for the remaining 90. Later the appeal overturns the hold, or it lapses. entitlement_remaining(T) becomes 10 again. A second matured release is rejected by UNIQUE(source_kind, source_id, kind). The existing 90-unit entitlement is immutable, and no other entitlement kind can consume a tranche. The honest owner's 10 is stranded.

This is not merely G-90's missing finalization-completeness check; that check cannot create the missing legal release transition.

Smallest fix: allow uniquely identified partial release events against the tranche's locked remaining balance, preserving domain and maturity, or transfer the reserved portion into an explicit resumable remainder source. Test release while held → overturn and release while held → lapse, not just rejection of an oversized initial maturity. Do not solve it by withholding the uncontested 90 indefinitely.

HIGH 3 — Stakes and confiscations still reserve the same underlying allocation independently
Location: SQL:1382–1423, 1711–1727, 2051–2088, 2213–2232.
Evidence: static.

Dispute admission sums original allocation amounts minus reserved stakes. Confiscation uses allocation_remaining, which subtracts holds and entitlements but not stakes. They do not take one shared reservation lock or consume one shared available balance.

Sequence: contributor C has a 1-WOS proposed allocation. Reserve its 1 WOS as dispute stake under the floor. Then place a confiscation hold for 1 WOS against the same allocation. Both reservations pass. Reverse the insertion order and dispute admission still counts the original allocation. If the dispute loses and confiscation executes, two obligations compete for the same unit. Clipping the disputer's allocation can similarly leave its previously reserved stake undercollateralized.

Smallest fix: reserve stakes against named source balances using the same allocation locks and remaining-balance calculation as holds and entitlement creation. Define how adjudication changes collateral already reserved; use a stable lock order. Add both insertion orders and a concurrent test, including an allocation clipped while securing a stake. F18 decides whose units are collateral; it does not excuse double reservation.

HIGH 4 — Holds are not truly bounded, and expiry races execution
Location: SQL:1977–1987, 2024–2039, 2097–2114, 2180–2210.
Evidence: static, including a two-session sequence.

Only minimum reply and appeal durations are enforced. An authorized writer can choose appeal_closes_at decades ahead or infinity; hold_expires_at then becomes decades ahead/infinity. The approved payload includes beneficiary ID and proven excess, not these dates. “Appeal close plus 14 days” is not a maximum duration from notice.

Race: prepare a valid hold H about to expire, whose appeal window has ended and with no pending appeal. Session A inserts a confiscation execution just before expiry and keeps its transaction open. It locks the confiscation but not its sources. After expiry, session B claims the source: A's execution is invisible, so hold_active is false and the source is available. B commits; A then commits, making the same hold permanent after the asset was claimed. An execution can therefore change a previously available balance retroactively. Snapshot-consistency and explicit source locking need an actual two-session test here.

Smallest fix: pin finite maximum windows from notice in policy and authorization. Serialize execution with every affected source, establish a deterministic expiry/finalization transition, and prevent any consumer from treating an uncommitted finalization as a released hold. Use database-enforced ordering/locking, not only a wall-clock predicate. Test execution versus expiry/claim and decision versus execution.

HIGH 5 — A timely appeal can appear after money was finalized
Location: SQL:1553–1572, 1611–1640, 2147–2177.
Evidence: static two-session sequence.

Appeal insertion timestamps and validates itself but does not take the allocation's source/finality lock. Adjudication treats the allocation as final after the window if no committed appeal exists.

Sequence: session A inserts a timely appeal just before the deadline and keeps the transaction open. Session B runs just after the deadline, sees no appeal, and creates entitlements or settles the dispute. B commits. A commits its valid timely appeal. The allocation now becomes nonfinal again and can later be reversed despite already-created immutable money rows.

Smallest fix: serialize appeal acceptance and finalization on the same allocation state. Stamp/validate the appeal after acquiring that lock; persist the final transition so time plus absence of a visible row is not the sole authority. Test this exact deadline race and require the same effective final state for settlement, entitlement and revocation.

HIGH 6 — Typed run snapshots omit the flag that SQL uses to require human review
Location: ENTITIES:155–169; SQL:268–274, 347–351; packages/db/test/db-assertions.sql:525–528, 566.
Evidence: static cross-schema comparison.

SQL requires a human PASS only when body.humanReviewRequired is true, and defaults a missing key to false. The actual RunPolicySnapshot schema has no humanReviewRequired field. A normally constructed typed snapshot therefore omits it; parsing with a standard Zod object also does not preserve an undeclared field. Database fixtures manually supply the extra flag, so the test covers a shape the declared contract does not produce.

Sequence: persist a valid RunPolicySnapshot containing the documented fields, for work whose pinned policy requires a human. Supply valid changeset/CI/agent-round relationships without a human review. The SQL human-review predicate is false and does not reject it.

Smallest fix: add a required typed, policy-derived review requirement/risk snapshot; validate its linkage and fail closed on missing/unknown fields. Use the same canonical snapshot fixture in contract and database tests. Also check accepted submission against lease expiration, not only its hard deadline: SQL:318 omits expires_at. G-85/G-88 should remain explicit, but this missing-field default is a distinct fixable defect.

HIGH 7 — A run spanning an oracle change loses its promised normalization
Location: SQL:721–739; ENTITIES:150–152; docs/protocol/USAGE-PROOF.md and REWARD-PROTOCOL.md pinned-oracle rules.
Evidence: static.

The new admission check requires usage.oracle_version equal to the admitted epoch's policy oracle. The contract says ACU is computed using the oracle pinned at lease issue, regardless of the epoch where the receipt lands.

Sequence: issue a lease under oracle v1; its reviews finish after epoch v2 activates oracle v2. The correctly computed v1 usage is rejected when admitted to v2. Repricing it to v2 would violate the frozen run terms. This is an honest-work liveness/fairness failure, not an economic policy choice.

Smallest fix: compare usage to the qualified run snapshot's oracle and validate that immutable version/rates. The epoch may carry its own policy for new work and distribution; it must accept eligible completed work under prior pinned versions. Add a cross-epoch oracle-change test. G-84's SQL cost recomputation can be tracked separately.

HIGH 8 — Expiry evidence can explicitly say “landed” and still unlock replacement
Location: SQL:1866–1893.
Evidence: static.

The new expiry validator checks observed height exceeds last_valid_block_height and that status_observation is non-null. It never inspects that observation's result, transaction identity, error or confirmation state.

Sequence: for a signed attempt, insert expired_not_landed with a later block height, history_checked=true and a verbatim response reporting that the signature finalized successfully. The shown guard accepts it; a replacement attempt or leaf void becomes possible. Even {} satisfies the non-null evidence check.

Smallest fix: make a typed settlement observer verify the exact signature, cluster, successful/non-landed status, expiry commitment and required history coverage, then persist a validated observation; reject contradictory or incomplete evidence in the database consumer. Finalized-with-error is not a successful payment either. Retain ambiguous attempts as unresolved. Shared fence locking is a real improvement but does not establish what the chain did.

MEDIUM 9 — Approved operation payloads still omit security-relevant fields
Location: SQL:150–173, 610, 873–876, 1535–1537, 1985–1987, 2536–2539.
Evidence: static.

Reviewer qualification grants validate kind/target but not domains, level, contribution types or risk classes: an approval intended for low-risk review can grant protocol review. Epoch-transition actions omit the destination state. Confiscation approvals omit duration and beneficiary kind. Resolution approvals bind outcome/amount but not recovered_base, which affects bounties. Adapter approvals bind action but omit expiry and other configuration.

Smallest fix: enumerate the canonical mutation payload per consumer and compare all fields affecting authority, money or duration, including expected prior state where stale approval matters. Kind/target-only is sufficient only when those identify the entire possible operation—for example a tightly validated leaf void—not for broad grants or configurable transitions. Authenticated independent session approvals may be acceptable for devnet; lack of cryptographic signatures alone is not my blocker.

MEDIUM 10 — Replay state is required only at compile time
Location: ENGINE:183–187, 333–337.
Evidence: executed.

computeEpoch still uses input.consumedIds?.has(id). Omitting the required field at runtime succeeds. The test's type-level requirement does not validate JSON-derived/untyped input.

Smallest fix: require validated replay state/checkpoint at the public engine boundary and reject omission. Keep immutable event IDs and database uniqueness as additional defenses. This finding does not claim a correctly typed caller automatically loses replay history.

MEDIUM 11 — Genesis approval is bound to an asserted hash, not enforced manifest contents
Location: SQL:2429–2456.
Evidence: static.

The action approves manifest_sha256, but the validator never recomputes it over version, cutoff, rules and receipt list. A writer can keep the approved hash while supplying another eligible list. receipt_ids also permits duplicates, and the validator checks status/cutoff without excluding test-mode receipts or requiring the reference-population type/rules. This weakens the claimed frozen calibration even though insertion-order exclusions and commit coverage improved.

Smallest fix: canonicalize and verify the whole manifest before approval/consumption; enforce unique receipt membership, eligible live mode/type and the chosen population rules. Add altered-content/same-hash, repeated-ID and test-receipt regressions. F21 selects independent approvers; engineering must still bind their approval to what is used.

Answers to the nine packet questions

1. Verification: see the complete 16-item table above. The original examples have substantially better guards and named regression tests. I independently ran the unit/simulation subset, not the SQL suite. Passing a narrow repro does not establish nearby sequences involving reversals, timeouts and multiple consumers.
2. One source ledger: not yet. Stakes use aggregate original allocations, and execution/lapse can change holds without serializing every affected source. Partial maturation has no repeatable remainder transition. Findings 2–4 are the concrete counterexamples.
3. Effective adjudication: the shared function fixes the sequential reversed-appeal case. It does not persist stable finality against an in-flight appeal. Recovery is still supplied in a resolution rather than proven by consumed asset sources, and engine disputes are not owner-bound. Findings 1, 5 and 9.
4. Conservation: no new arithmetic inequality was reproduced in a returned result. Instead, the executed delivered-token example preserves the equation while destroying its economic meaning. Explicit delivered/escrow/claimable ownership is necessary. Existing invariants correctly reject the unclaimed-dispute example, but that leaves a required business transition unimplemented.
5. Recovery fairness: compensatory recovery is a reasonable devnet default, but wrongful holds can still be effectively indefinite or strand a partial remainder. Forfeit-all increases the sanction in the assumed simulation; it also increases loss from mistaken findings and creates uneven penalties based on recent honest work. The simulation has no measured detection or false-positive model, so it cannot justify “this makes cheating a bad bet” as a general conclusion.
6. Authorization: independent session approval plus one-use consumption materially improves the design. Complete canonical operation payloads and stale-state checks remain necessary. More signatures will not repair omitted fields.
7. Qualification: real relationships now cover important attempt/document evidence. Fix the human snapshot mismatch and run-oracle boundary. Review/audit/integration/resolution types still need G-88's own subject relationships; do not manufacture an author/build qualification for them.
8. Settlement: preserve signed-byte persistence, non-null finalized checks, shared fencing and one active attempt. Before exactly-once claims, devnet E2E must cover send accepted with response lost, rebroadcast, finalized success/error, historical lookup unavailable/incomplete/contradictory, blockhash expiry, pause versus in-flight broadcast, crash/restart, migration draining, and ledger reconciliation to actual transfers. No mainnet dependency is needed to run these tests.
9. New regressions: the most important are the absent human flag, the old-oracle admission rejection, partial maturity after a lifted hold, and the dispute path's mismatch with new claimable balances. Fix these before expanding the design further.

Founder decisions

F17 — Recovery versus punishment: keep excess-only recovery as the devnet default while measuring behavior. If punitive forfeiture is chosen, define intentional misconduct, evidence threshold, scope, proportional cap, independent appeal and false-positive restoration before implementing it. Separate recovery, punishment and bounty funding. The maximum notice-to-release duration must be finite under either choice. I do not endorse forfeit-all solely from A2.

F18 — Sponsored dispute stake: specify whose named balance is reserved and whose consent authorizes it. Prefer the disputer's own balance or an explicitly approved organization stake budget; do not silently expose unrelated employee contributions. Reservation mechanics must work whichever policy you select.

F19 — Timing gains: retaining accurately described smoothing is reasonable for devnet. Measure behavior before adding a rule that may suppress later useful work.

F20 — Infeasible caps: fail closed on ordinary proposals is coherent. Define a bounded, explicitly authorized fallback/recovery procedure so policy infeasibility cannot indefinitely disable necessary governance. Do not silently renormalize away the promised caps.

F21 — Genesis approvers: explicitly choose at least two people independent of beneficiaries/founder under the adopted policy, and approve the exact frozen population. Two maintainer IDs alone do not establish that independence. Keep issuance mainnet-only.

Additional unresolved policy detail: if an accused contributor's disputed allocation was used as stake for a separate dispute, decide how a later reduction affects that collateral and who bears any shortfall. This is adjacent to F18 but also affects unsponsored contributors.

Next fix pass

Prioritize 1–8. Add regression tests for each sequence, especially partial maturity → overturned hold, shared stake/hold collateral, appeal admission across timeout, and execution across hold expiry. Use the real typed snapshot in database fixtures. Preserve the fixes already working: governance ordering, sponsored rounding, parser errors, independent audit assignments and targeted one-use approvals.

Keep G-83 through G-90 open until their implementation paths exist. “Tracked” is useful transparency; it does not make an absent accounting transition ready to wire. The verdict concerns authoritative reward accounting, not a prohibition on continuing isolated implementation and devnet tests.

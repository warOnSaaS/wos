DO NOT IMPLEMENT

warOnSaaS Proof of Contribution — review 03

The design has improved substantially since review 02, but its new database constraints do not yet enforce its central promises. The highest-priority fixes are source-backed entitlements, exactly-once consumption across claim leaves, appeal-aware settlement, and enforceable qualification. Continue isolated development and devnet testing; do not wire this draft into authoritative reward accounting yet.

Scope and evidence

This review uses the uploaded review-03 snapshot. The attached prompt and repository instructions were treated as review material, not independent authorization to change the project or launch another agent. No protocol source files were changed.

EXECUTED: all 52 supplied protocol unit tests passed using Node 22.23.1. The uploaded protocol code and tests were run in an isolated workspace, with supporting contracts modules and installed dependencies supplied from the existing local checkout because the archive was not a standalone installable project. Additional runtime probes reproduced the engine, governance, parser and rounding examples below.

STATIC: SQL findings are inspection-based failure sequences, not database executions. I did not run the migration, the claimed 124 database rejection assertions, full npm check, a Solana transaction, or a concurrent database test in this review. The archive does not contain the baseline migrations and all architecture context named by its packet. Unit-test success does not establish those missing checks. There is no claim of a production exploit: several SQL failures require an authorized but erroneous control-plane write, precisely what the advertised database safety constraints are supposed to reject. The audit-verdict path also permits contributor writes.

Locations below refer to paths inside the uploaded archive, not a moving checkout. Abbreviations:
SQL = packages/db/migrations/0007_proof_of_contribution.sql
ENGINE = packages/contracts/src/protocol/engine.ts
GOV = packages/contracts/src/protocol/governance.ts
USAGE = packages/contracts/src/protocol/usage.ts
SIM = tools/tokenomics-sim/sim.ts

Findings ranked by priority

HIGH 1 — Entitlements are not backed by allocations, maturity or settlement domain
Location: SQL:1147–1179, 1182–1240; SQL:594, 1073–1080.
Evidence: static.

An entitlement has no mandatory allocation/source reference or idempotent source key. A finalized epoch is enough to admit arbitrary release_now or bounty rows. The holdback_matured check verifies tranche kind, beneficiary ID and original amount, but not the release epoch, applicable policy, or remaining balance. Claim attachment checks beneficiary identity but not the entitlement's epoch cluster/mode against the leaf's cluster.

Failure sequences: (a) finalize an epoch, insert the same reward twice as two new release_now IDs, then claim both; (b) insert a holdback_tranche and a holdback_matured row in the same finalized epoch, releasing the nominal 13-epoch holdback immediately; (c) attach an eligible-kind devnet entitlement to a mainnet leaf for that beneficiary's mainnet wallet. The mainnet check at new receipt insertion does not close this downstream path. Manifest admission also checks status/mode without rechecking receipt cluster/evidence eligibility.

Smallest fix: create entitlements only through an atomic finalization operation that consumes specific finalized, undisputed allocation balances. Persist source, cluster, mode, policy version and maturity epoch. Enforce source uniqueness and remaining amount. Require the same settlement domain throughout manifest → allocation → entitlement → leaf. Keep an explicit default-deny mainnet gate at the settlement boundary as well as receipt admission.

HIGH 2 — A paid entitlement can be paid again through another leaf
Location: SQL:1208–1240, 1269–1298.
Evidence: static; concurrent variant requires a two-session test.

The unique confirmed settlement is per leaf, while ownership of the underlying entitlement is protected only by an unlocked NOT EXISTS check. leaf_voids has no validating trigger for action kind/target, unsettled status or in-flight transactions.

Failure sequence: settle leaf L1 containing entitlement E; insert a void for L1 with any existing AdminAction ID; attach E to new leaf L2 and settle L2. The old confirmed payment remains, but the entitlement test ignores its void leaf. Alternatively, two transactions attach E to different leaves before either commits. Their composite primary keys differ and neither sees the other's insert. The per-leaf settlement locks cannot serialize this shared entitlement.

Smallest fix: lock the entitlement/source balance when reserving, voiding, confiscating or settling it. Record durable consumption at that level. Never void a confirmed leaf; never release its reservation while an old signed transaction could still land. Use a unique active reservation plus immutable spent state, not an existence check over arbitrary leaf history.

HIGH 3 — Appeals do not determine dispute settlement, and stakes are not fully reserved
Location: SQL:1381–1401, 1554–1607.
Evidence: static.

dispute_appeal_decisions stores final_amount_base, but settlement sums the original resolution's excess, recovery and UPHELD status. It merely checks whether an already-filed appeal is pending. Nothing requires the appeal window to close before settlement. Stake checks compare each dispute with the same original pending balance, without subtracting stakes already reserved by other disputes.

Failure sequences: (a) clip a 100-unit allocation to 60, then reverse that decision on appeal to 100; settlement still derives 40 excess and can pay a bounty on it; (b) settle immediately after the initial resolution, then file a timely appeal against an immutable settled result; (c) with a 1-WOS pending balance and the 1-WOS floor, open three separate one-item disputes, each ostensibly staking the same 1 WOS.

Smallest fix: define one effective final adjudication per allocation. Wait for appeal expiry or a valid waiver/final appeal decision, then derive all money and forfeitures from it. Reserve stakes atomically from available, unreserved entitlements. Base participant standing on the accountable contributor: the current personal-beneficiary-only query also excludes a fully sponsored contributor whose allocations go to their organization.

HIGH 4 — Confiscation can skip due process and mishandle partial recovery
Location: SQL:1639–1689; SQL:1171–1175, 1237; docs/DECISIONS.md:204–210.
Evidence: static.

confiscation_appeal_decisions has only a foreign key to an AdminAction, with no action-kind/target validator. An immediate “upheld” row bypasses both waiting windows. There is no source reservation on notice to stop claimable assets leaving during those windows. Partial recovery is treated as consuming the entire source for later claims, but maturation still uses its original amount.

Failure sequences: (a) record notice, immediately insert upheld using an unrelated action, then seize a source; (b) confiscate 10 from a 100-unit release entitlement: its other 90 becomes unclaimable because any confiscation_sources row blocks the entire entitlement; (c) confiscate 10 from a 100-unit holdback tranche, then mature all 100 because the maturity check ignores that recovery; (d) concurrent 50-unit sources against 60 proven excess each see an empty prior sum and exceed the cap collectively.

Smallest fix: bind appeal decisions to authenticated, targeted authorization and an actual completed response/appeal process. At notice, reserve only the permitted affected amount under a bounded reversible hold. Use remaining balances and atomic source consumption for recovery, release and claim. Serialize the confiscation aggregate as well as each source.

Also reconcile the policy: D39/D40 describe punitive forfeiture of all unreleased holdback on exclusion, while SQL caps confiscation at proven excess. Keep compensatory recovery and any separately authorized forfeiture distinct; one should not silently stand in for the other.

HIGH 5 — Qualification still accepts assertions instead of the required evidence chain
Location: SQL:235–258, 594–627; docs/protocol/PROTOCOL.md:61–80.
Evidence: static.

The new qualification record is useful, but its passed flag, revision, snapshot hashes and evidence are not tied to the required verification and review results. Document qualifications need little beyond the lease generation. Attempt qualifications do not check that the changeset belongs to the named attempt/revision, and validity checks omit lease expiry and attempt hard lifetime. Summing the contributor's ATTESTED usage does not bind those usage receipts to this subject/run or prevent their reuse in another contribution.

Failure sequence: create a passed document qualification with empty evidence, then an accepted-looking contribution using an otherwise eligible usage receipt; repeat for another subject with the same usage IDs and a new work key. The new sum check passes both. For attempts, a changeset from the same lease can be cited against an insufficiently bound subject revision. These guards do not prove Astra + Fable, CI and the applicable human policy actually passed.

Smallest fix: have a single deterministic qualification evaluator emit a typed result referencing the exact subject revision, accepted changeset, run/lease generation, pinned policies, verification results, agent reviews and required human approvals. Validate identity, expiry/hard lifetime at acceptance, and per-type outcome. Make usage attribution unique or explicitly partitioned, tied to that run and recalculated from canonical counters at the pinned oracle. Enforce the missing-log discount and inconsistent-log rejection at this boundary.

Do not respond by adding more boolean “verified” columns. The missing part is the relationship between evidence and the accepted contribution.

HIGH 6 — Audit verdicts are not bound to the assigned quorum, packet or provider
Location: SQL:900–942, 2144; SQL:327 and the human-review checks in section 8.
Evidence: static.

The verdict validator now requires the reviewer's own active payout_audit lease and a signed run. It does not prove that this task/run was assigned to this quorum and packet, that its provider matches the declared verdict provider, or that the run is consumed once. Thus provider diversity and random assignment can be satisfied by labels detached from the actual execution.

Failure sequence: obtain a legitimate audit lease/run for packet A, submit it for an unrelated open quorum B, and declare whichever provider fills B's last diversity seat. Reuse the run for other quorums. Existing own-lease and signature tests do not reject that mismatch.

Smallest fix: persist a server-owned assignment binding quorum, slot, packet hash, reviewer, task, lease generation, permitted provider/model and policy. Derive verdict metadata from the signed run and consume the assignment once. Check lease validity at submission. Extend author-relatedness checks to document reviews, not just implementation attempts, and derive human risk/domain/type qualification from the subject's frozen policy instead of caller labels. Live relatedness and declared beneficial ownership remain known residuals; these assignment gaps are additional defects.

HIGH 7 — Administrative authorization still does not bind the exact approved operation
Location: SQL:36–113, 689, 1317, 1639–1644.
Evidence: static.

Deriving two-person requirements from action kind fixes the old caller-controlled boolean. But the consumer helper validates only kind and target, never the payload or one-time use. The table records two maintainer IDs without representing the second maintainer's separate approval. Some sensitive consumers do not invoke the helper at all; others allow a weaker action kind.

Failure sequences: reuse an old record_offset action targeting a beneficiary for multiple offsets with different amounts; revoke a receipt using the one-person resolve_dispute action without a linked finalized dispute resolution; use any action for a leaf void or confiscation appeal decision as above.

Smallest fix: authenticate separate approvals to a canonical operation hash covering type, target, amount, policy and expected prior state. Consume that authorization once with the mutation. Permit dispute-driven revocation only through the actual final resolution, and make every privileged mutation use the same validation path. A hash-chained log is evidence of what was written, not evidence of who actually approved it.

HIGH 8 — The 10% organization cap is applied before voter eligibility
Location: GOV:67–149 (capGroupShares/applyWeightCaps); GOV:185–205.
Evidence: executed.

A probe used an organization with 900 locked and 900 contribution weight, 50 active outsiders with zero locked and 2 contribution each, and 50 passive outsiders with 2 locked and zero contribution each. Water-filling returns feasible=true. tallyDualMajority then drops the passive outsiders' locked weight because they have not contributed. The organization's 11,111,111 capped locked units become 100% of the eligible locked denominator.

This example does NOT pass a proposal alone: its contribution turnout fails. It does demonstrate that the promised maximum effective locked voting share is false. The separately attached array property feasible is also fragile: serialization/copying loses it, and the tally defaults to feasible when absent.

Smallest fix: freeze eligibility and beneficial-owner grouping first, then cap each actual eligible voting leg, and use exactly those totals for turnout and outcomes. Return an explicit structured result with weights, denominators and feasibility. Reject missing validation instead of defaulting to success. Test asymmetric eligibility, zero-weight legs, and serialization. Declared owners still require the documented anti-Sybil assumptions; mathematics cannot discover undeclared common control.

HIGH 9 — Settlement finality and migration fencing remain incomplete
Location: SQL:1257–1298, 1950–2010.
Evidence: static concurrency and constraint analysis; no chain execution.

CHECK(outcome <> 'confirmed' OR commitment = 'finalized') accepts a confirmed row with NULL commitment under SQL's three-valued CHECK semantics. A failed_before_broadcast outcome allows another signed attempt without demonstrating that the old signed transaction is incapable of landing. A history_checked boolean also does not capture an expiry observation or the quality of historical coverage.

The migration guard does not share a serialization lock with creation of settlement attempts. T1 can pass its unpaused-generation check and remain uncommitted; T2 pauses and snapshots after observing no unresolved attempts; T1 then commits an old-generation signed attempt absent from the snapshot.

Smallest fix: explicitly require non-null finalized commitment for confirmed outcomes. Keep ambiguous signed attempts unresolved until proven expired/non-landed or finalized; distinguish “never signed” from “signed but not sent.” Persist the relevant block-height and status observations. Serialize pause/generation/snapshot transitions with attempt creation, and fence the broadcaster as well as the database writer.

The official Solana documentation distinguishes recent-cache lookup from historical lookup and describes blockhash expiration. Neither turns a database label into on-chain idempotency. See getSignatureStatuses (https://solana.com/docs/rpc/http/getsignaturestatuses) and Transaction Confirmation and Expiration (https://solana.com/developers/cookbook/transactions/confirmation). Preserve the persisted-signed-bytes design, but do not call it exactly-once until the entitlement, retry and migration tests cover these cases.

MEDIUM 10 — Conservation is stronger, but source ownership and policy pinning remain incomplete
Location: ENGINE:124–175, 248–264, 366–408, 616.
Evidence: executed and static.

I did not reproduce a returned result violating R + pools + security + issued = reserve or its non-negative balance assertions with the tested valid policy. The old negative-security probe now throws. This is a real improvement, not a proof over all possible inputs.

The equation still cannot establish ownership. With R=900, I=100, two different unbound_expiry IDs naming a beneficiary with no recorded entitlement can return 80 and 20; the engine accepts R=1000, I=0. The input carries an event ID but no actual entitlement source. Distinct event IDs can therefore describe the same economic asset unless a separate validated input builder prevents it. Passing consumedIds is optional.

A second probe shows an epoch-1 holdback of 50 maturing at epoch 2 when the current holdbackEpochs changes to 1. The tranche carries no pinned maturity or policy. Another accepts unclaimed recovery of 100 against provenExcessBase=1, illustrating the recovery/forfeiture inconsistency discussed above.

Smallest fix: consume typed, validated source references with remaining balances, and require replay state/checkpoints in the epoch input builder. Persist maturityEpoch and policyVersion per tranche. Distinguish recovery from punitive forfeiture. Keep the global assertions as a second line of defense.

MEDIUM 11 — Malformed usage and unsafe aggregate totals can still return ok=true
Location: USAGE:79, 154–156, 197–211.
Evidence: executed.

Two Claude messages each containing the individually safe integer 9,007,199,254,740,991 sum to 18,014,398,509,481,982, which is outside JavaScript's safe-integer range; the parser returns errors=[] and ok=true. A Codex token_usage_record with input/output counters but no response_id is silently ignored and also returns ok=true with zero usage.

Smallest fix: checked addition or bigint accumulation for every aggregate; an explicit error for every recognized usage-bearing event missing its required identity/shape. Keep parsing failure distinct from a legitimate zero-usage session. Add these fixtures alongside the existing malformed-line tests, plus real pinned-provider fixtures before adapter integration. These are integrity failures, not evidence of a practical 10-quadrillion-token bill.

MEDIUM 12 — Genesis reference approval is not a frozen population
Location: SQL:1840–1885; SIM:557–567; docs/protocol/GENESIS-POLICY.md section 3.
Evidence: static.

The reference table accepts more receipts indefinitely under an action targeting generic genesis_reference/v1. Relatedness is checked only against Genesis contributors already present. Commit mapping is optional: a unique commit_claim row prevents duplicate mapping only when a mapping is actually supplied.

Failure sequences: approve a reference receipt before adding its account as a Genesis beneficiary; later add that Genesis contribution. Or record overlapping commit evidence under different retro-unit keys while omitting commit_claim rows. The current checks do not freeze/revalidate a complete reference population or require canonical evidence coverage.

Smallest fix: finalize a content-addressed reference manifest with cutoff, receipt status/type rules, complete exclusions and explicit independent approval of its hash. Prevent further additions after finalization; revalidate when finalizing Genesis. Require canonical commit-to-unit mappings for all commit-derived evidence, including overlap with live work. Keep the separate 0.5% cap, output-based credit, independent humans and mainnet-only vesting.

MEDIUM 13 — The economic model still depends on recovery that has no enforceable notice-time reservation
Location: SIM:630–679; SQL:1639–1689; docs/protocol/TOKENOMICS-SIMULATION.md headline results.
Evidence: static model assessment.

A2 is more honest than review 02: it models exit, churn, contamination and an explicitly unmeasured detection probability. However, detection immediately removes the current allocation and all outstanding holdback. The real process includes reply/appeal delays, no source reservation at notice, and inconsistent punitive-forfeiture rules. Its quoted break-even rates are conditional on those assumptions, not measured deterrence.

Smallest fix: use the same recovery/forfeiture transition rules as the production ledger in the simulator. Model time to notice, reservation, response, appeal, reversal and release, plus false positives and organization beneficiaries. Do not choose a “realistic” detection rate from these tables: it needs devnet measurement against adaptive clients. Keep ATTESTED usage mainnet-ineligible until that choice is made. Paying for accepted output remains the simpler structural alternative; retaining usage weighting for devnet is an explicit founder choice, not a new review defect.

MEDIUM 14 — Trailing-rate damping does not eliminate quiet-epoch timing gains
Location: ENGINE:428–435; SIM:248–266; docs/protocol/TOKENOMICS-SIMULATION.md headline 3.
Evidence: executed.

For four prior rates [100, 100, 100, 1] WOS/ACU, the trailing mean is 75.25. At epoch 5 the probe pays 98.675825 WOS for 1 ACU, versus the last epoch's 1 WOS/ACU. A ceiling of 1.5 times a trailing average is not a maximum 50% improvement over the immediately preceding opportunity. The absolute ceiling works; “removing quiet-epoch arbitrage” overstates the guarantee.

Smallest fix: either describe this accurately as smoothing with residual timing incentives, or choose a stronger rule based on a bounded prior realized rate/acceptance-time quote. Test alternating crowded/quiet epochs, recovery after a very low epoch and oracle rebasing. Do not add a stronger rule without assessing whether it starves later useful work.

MEDIUM 15 — Completion correction has no path once the pool has already paid
Location: ENGINE:382–389; SQL:1824–1832; docs/protocol/REWARD-PROTOCOL.md sections 5 and 7.
Evidence: static.

Application pools now use lifetime weights and the database forbids both paid and returned. But an accrual correction after payout finds a zero pool balance and throws. Omitting that correction preserves an erroneous benefit without a recorded recovery rule.

Smallest fix: preserve the original payout attribution and convert the already-paid part of a correction into beneficiary-specific recovery/offsets; return only the amount still held in the pool. Make late corrections explicit inputs so one historical correction cannot block all future epoch calculation. Test correction before payout, after payout and after partial beneficiary recovery.

LOW 16 — Sponsored splits still steer rounding before beneficiary aggregation
Location: ENGINE:289–296, 451 onward; packages/contracts/test/protocol.test.ts:323.
Evidence: executed.

The new test fixes ordinary per-receipt payout rounding, but splitWeight still rounds each receipt's micro-ACU first. One receipt of weight 2 split 50/50 produces a=100 and b=100 reward base units under the probe. Two receipts of weight 1 with the identical split produce a=200 and b=0. Total issuance stays 200; attribution changes.

Smallest fix: aggregate exact share numerators across receipts before rounding beneficiary weights/rewards, then apportion back to lines. Add sponsored and multi-beneficiary partition-invariance tests. The demonstrated amount is small; do not describe it as an unlimited drain.

Review 02 status table

ID | Status | Assessment and current location
H1 | Partially resolved | Equality/non-negative assertions and ID replay checks improved; source ownership and required replay state incomplete. ENGINE:248, 366; finding 10.
H2 | Partially resolved | Proposed allocations and final claims separated; epoch-write lock added. Entitlements still unbacked and unsafe across claims. SQL:1057, 1147; findings 1–2.
H3 | Partially resolved | Signed attempt persistence and per-leaf retry checks improved. NULL finality, cross-leaf reuse and migration races remain. SQL:1257, 1996; findings 2 and 9.
H4 | Partially resolved | Old full-recovery/near-zero-profit claim withdrawn; exit/churn modeled. Recoverability still depends on missing reservation and inconsistent forfeiture semantics. SIM:630; finding 13.
H5 | Partially resolved | Water-filling fixes raw-share cap example, but eligibility changes the denominator afterward. GOV:185; finding 8.
H6 | Resolved for the original cited paths, by static inspection | Explicit OPEN, IS TRUE transitions, server timestamps and activation/pause checks address original A/F/G cases. This does not certify every clock-dependent guard; settlement NULL defect is finding 9. SQL sections 2, 5, 13b.
H7 | Partially resolved | Qualification rows, own-usage sums and mainnet receipt rejection added. Evidence/subject binding and domain closure remain inadequate. SQL:235, 609; findings 1 and 5.
H8 | Partially resolved | Related-account checks and round/quorum locks improved; arbitrary audit assignment/provider claims remain. SQL:900; finding 6. G-80 remains an explicitly deferred residual.
H9 | Resolved at registry/design level, by static inspection | Privileged wallet registry uniqueness, person/org identity and PDA proof design address the original finding. Cryptographic binding/chain verification was not executed. Claim-domain defects are finding 1, not a recurrence of the registry bug. SQL section 11.
H10 | Partially resolved | Frozen bundles, per-item stakes and priority-derived settlement added; reservations and appeals remain wrong. SQL:1381, 1588; finding 3.
H11 | Resolved for direct disclosure and reason-check defects | Private quorum/verdict classification and reason-aware catch predicate replace the old behavior. Adaptive indistinguishability is a declared unproven mainnet gate, not an established capability. SQL section 9 and RLS section 15; unit test for wrong reason.
H12 | Partially resolved | Action-kind-derived co-signer requirement and target checks added. Exact operation, actual second approval and several consumer paths remain open. SQL:36–113; finding 7.
H13 | Partially resolved | Application payout split and paid-XOR-returned fixed; already-paid correction still unspecified. ENGINE:382; SQL:1824; finding 15.
M14 | Partially resolved | Append-only offer/completion lifecycle now works. Deadline capacity remains explicitly deferred (G-81). Concurrent terminal events with different seq values can pass the unlocked existence check; add a unique terminal index or offer lock. SQL:991–1017.
M15 | Partially resolved | Error-bearing adapter API improves malformed-line handling; aggregate overflow and missing rollout identity still pass. USAGE:154, 197; finding 11.
M16 | Partially resolved | Reference-population concept and twelve-epoch statistic improved; freeze/exclusion/evidence completeness not enforced. SQL:1860–1885; finding 12.
M17 | Partially resolved | Durable commitment/deletable log-body separation and first-receipt consent are present. The promised consent before wallet binding is not checked by the binding function. SQL:341, 582, section 11; PROTOCOL.md:195. Require current disclosure before binding/publication; legal adequacy is outside this review.
L18 | Partially resolved | Ordinary payout partition test fixed; sponsored micro-weight partition changes beneficiary shares. ENGINE:289; finding 16.

Original SQL repros A–G

Static reassessment only; not a rerun of database assertions:
A (skip epoch windows): original initialization/NULL transition rejected by explicit OPEN and fail-closed transition logic.
B (pre-ratified quorum/unsupported qualification): initial quorum outcome guarded; qualification variant remains in finding 5 and assignment variant in finding 6.
C (allocation outside frozen accounting): manifest/slice/beneficiary and epoch-lock checks improve rejection; entitlement creation bypass remains in finding 1.
D (wallet uniqueness under RLS): privileged registry and unique keys address it; chain proof verification not exercised here.
E (free or late dispute work): zero stake, empty bundle and late item insertion now guarded; aggregate reservations and appeal settlement remain in finding 3.
F (backdated activation): server time and published-target checks address the original example.
G (pause expiry): common server-time expiry rules address the old sequential path; concurrent drain/snapshot remains in finding 9.

Review 01 status table

Item | Status | Assessment
1 Evidence matrix/fail closed | Partial | Four levels and honest ATTESTED labeling retained; end-to-end eligibility and parser gaps remain (5, 11).
2 Bootstrap and bound human approval | Partial | PROVISIONAL founder receipts are the right separation; evidence and assignment weaknesses prevent certifying ratification (5–6).
3 Maximum permitted review effort | Resolved in specification | Pinned Astra/Fable max with unsupported settings blocked is the documented policy. No provider execution was tested. See HUMAN-REVIEW.md section 1 and POLICIES.md sections 4–5.
4 Conserved funding equation | Partial | Stronger executable global invariant; source ownership and database entitlement accounting remain incomplete (1, 10).
5 Waste incentives and human reward | Partial | Human reward remains independently weighted; usage gaming and recovery assumptions remain explicit residuals (13–14).
6 Canonical usage and caps | Partial | Exclusive counters, pinned oracle and cap/reservation design retained; parser and usage attribution defects remain (5, 11).
7 Exclusive leases and hard lifetime | Partial | Generation assignment/immutability added, but qualification does not enforce every identity/expiry boundary. SQL:178–258; finding 5.
8 Epochs, snapshots and settlement | Partial | Much better separation, still blocked by claims, appeals and settlement races (1–3, 9–10).
9 Genesis accounting separate | Partial | Output-based historical category, cap and vesting retained; frozen calibration and canonical evidence incomplete (12).
10 Completion definitions and per-type acceptance | Partial | Versioned definitions retained; qualification and late correction incomplete (5, 15).
Keep/simplify and supersession | Partial | SUPERSESSION.md is useful and custom programs remain deferred. The expanded V1 now has multiple overlapping payout/recovery machines; consolidate source balances and common transitions before adding more features.

What should be kept

Keep the four evidence levels: subscription telemetry is ATTESTED, not provider-verified. Keep canonical token categories and a pinned normalization oracle; unverified rate data must not silently become production truth. Keep independent Astra/Fable reviews at maximum permitted effort, with human requirements determined by a versioned policy and approvals bound to exact revisions. Keep founder merge authority separate from live reward eligibility. Keep integer accounting, deterministic results, conservation assertions, unused-budget returns and utilization-scaled accruals. Keep fixed human-review weights and versioned completion definitions. Keep devnet-first settlement, no initial mainnet/ICO, no freeze/permanent-delegate authority, and Genesis as separately approved historical output. Keep the explicit mainnet gate and honest unknown detection probabilities.

Changes to make before asking for review 04

1. Implement one source-balance ledger for allocation finalization, holdback, reservations, confiscation, claims and settlement. This is the smallest architectural simplification: the same asset should not have a different availability rule in each table.
2. Close evidence attribution and assignment: subject/revision → lease/run → canonical usage → verification/review → qualification → contribution.
3. Make adjudication finality and authorization explicit, then derive all money from the effective final outcome.
4. Add transaction-level tests for two claimers, claim versus confiscation, confiscation versus maturity, and settlement creation versus migration. Include paid-leaf voiding, NULL commitment, early maturity, cross-cluster claims, reused usage and reversed appeals.
5. Add the executed governance/parser/sponsored-rounding examples to the unit suite. Test policy changes against existing holdback tranches.
6. Reconcile docs, TypeScript entities, proposed allocation roots and final claim schemas. Do not maintain the old claim-leaf-shaped proposed-root API alongside the new two-stage design without an explicit adapter and tests.

Founder decisions still needed

• Decide the precise boundary between recovery of proven excess and punitive forfeiture on exclusion. D39/D40, SQL and the simulator currently disagree. Define reservation at notice, maximum duration, appeal effects and beneficiary liability, including sponsorship changes.
• Keep the current ATTESTED-mainnet prohibition until F1 is explicitly decided using measured evidence. Choose whether eventual value-bearing rewards use usage or accepted output; a simulation cannot settle this.
• Decide whether residual timing gains under the trailing-average ceiling are acceptable, or whether stronger smoothing/acceptance-time pricing is worth its starvation risk.
• Specify the bounded fallback when owner/organization caps are infeasible or ownership cannot be established. Preserve explicit founder mode until the activation criteria are actually met.
• Confirm the finalized Genesis reference population and independent approvers. Do not replace that with an open-ended list carrying a generic approval.
• Keep mainnet escrow/program selection, cryptographic wallet verification and off-ramp drills as separate gates. Nothing in this review authorizes a mainnet launch or requires an ICO.

Implementation readiness depends on these invariant fixes, not on increasing the number of policy documents or positive tests. The 52 passing tests are useful regressions; they do not yet cover the economically important combinations above.

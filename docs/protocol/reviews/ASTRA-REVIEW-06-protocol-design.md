warOnSaaS — Proof of Contribution review 06
Snapshot: bundle 06, declared commit 3cddbb1
Review date: 2026-09-30

VERDICT: DO NOT IMPLEMENT YET — specifically, do not wire this draft into authoritative reward accounting until the active-path issues below are fixed. Continue implementation of the fixes and isolated shadow tests. This is not a request to revive the dormant modules or redesign the economy again.

The fixed-budget design and D51 simplification are improvements. The old delivered-token recovery failure is fixed, and the engine now enforces ownership as well as conservation. Several remaining failures are integration failures between individually tested components: the new fallback conflicts with qualification, optimistic finalization conflicts with the status machine, and allocation/maturity rules disagree with engine output. Seven actionable findings follow; five are high priority and two medium. None demonstrates live loss: this is an undeployed draft.

D57 is accepted as supplied in the founder's update: F15, F17, F18 and F20–F34 are chosen devnet/shadow policy or chosen deferrals. Do not ask the founder to decide these again. In particular, F17 selects compensatory recovery, not punitive forfeiture; the earlier recommendation to forfeit everything is not this review's recommendation.

EVIDENCE AND LIMITS

I independently ran the uploaded protocol code through protocol.test.ts, protocol-rules.test.ts and tokenomics-sim.test.ts: 3 files, 190 tests passed. The extracted bundle used local installed dependencies and supporting contract/build files from the preceding review workspace because the export is not a complete standalone repository.

I also executed the attached review06-probes.mjs against bundle 06. PROBE-RESULTS.jsonl contains 11 records: a passing qualification baseline, the seven findings' counterexamples (some with multiple cases), and a reissue identity check. Each finding below says what was actually executed. These probes expose behavior; they are not yet regression tests asserting the desired fix.

The supplied TEST-RESULTS.txt reports full typecheck/lint/tests, database assertions and eight named two-session races passing. I inspected SQL and those results but did NOT independently execute PostgreSQL or Solana integration tests in this review. Database concurrency conclusions below are static review, not claimed reproduced races. No protocol source files in the user's repository were changed.

Reference aliases, all relative to the reviewed repository:
E = packages/contracts/src/protocol/engine.ts
R = packages/contracts/src/protocol/rules.ts
M = packages/contracts/src/protocol/machines.ts
N = packages/contracts/src/protocol/entities.ts
SQL = packages/db/migrations/0007_proof_of_contribution.sql
UT = packages/contracts/test/protocol.test.ts
RT = packages/contracts/test/protocol-rules.test.ts

PRIORITY FINDINGS

R06-1 — HIGH: D53 fallback is not an executable qualification path, and D56 can assign work with no legal reviewer.
References: R:190–208, R:1173–1200, R:1299–1315; capability-policy.v1.json:6–24; RT:1164 and RT:1258.

The fallback helper requires Astra plus a human. qualificationRefusals still requires exactly two distinct passing slots in round.reviewVerdicts, with the human approval checked separately. A valid baseline qualifies; change it to one passing Astra agent verdict plus the required human PASS and it is rejected for missing both seats. The current helper merely counts distinct slot strings; it does not derive and check the required seat identities from the pinned fallback. Fabricating a second agent verdict or relabelling a human as Fable would hide the contradiction rather than fix it.

A second executed case: nextUnitEligibilityRefusals accepts gpt-6-astra for BUILD_L4, but the active fallback requires an Astra reviewer and reviewSeatRefusals correctly prohibits Astra reviewing Astra-built work. This reserves work that cannot follow the configured acceptance path. The assignment rule has no fallback input despite the route's documentation claiming this filter.

Smallest fix: derive one acceptance requirement from the stored ReviewPolicy, including fallback and risk-specific human requirement; consume actual agent verdicts and the separately bound human approval. Check exact seats, model/account independence, observed maximum settings and required labels. Use the same policy in self-pick and build-next eligibility; while this fallback requires Opus authors, refuse incompatible builders before reservation/lease. Keep founder self-review insufficient for ordinary qualification; founder-own bootstrap work follows its provisional route.

Regression: an Opus build + Astra PASS + independent human PASS qualifies without Fable; missing human fails; labels cannot be omitted; Astra-built work is not assigned into an Astra-only reviewer configuration. Test the full qualification path, not just requiredReviewSeats.

R06-2 — HIGH: D54 silence finalization has no durable status transition or specified atomic challenge boundary.
References: R:1226–1236; M:64–95; N:342–349; SQL:373–388; HUMAN-REVIEW.md:45; GAPS.md:386–388.

Executed: provisionalReceiptOutcome returns final_by_silence after 48 hours. But ReceiptStatusMachine only permits PROVISIONAL -> RATIFIED through quorum_ratified or human_signoff; the SQL event-kind CHECK has no silence-finalization event. Implementing the chosen D54 route requires either an unsupported event or a false claim that a human/quorum approved it.

The helper takes a bootstrapEnded boolean and an arbitrary publication timestamp. A timestamp 100 hours old yields immediate finality as soon as bootstrapEnded becomes true. That is safe only if publication is a newly persisted, post-bootstrap challenge publication—not the receipt's earlier public appearance. The function cannot establish that distinction, notification/publication completion, or a pinned window. This is an integration precondition, not proof an existing endpoint permits backdating.

Also preserve the active analogue of R04-5: a free challenge submitted while its window is open must not commit after a separate transaction has finalized silence and enabled payment. Deferring paid disputes and appeals does not defer this basic challenge/finality serialization. I did not execute that race; the bundle lacks the active free-challenge/finalization write path needed to test it.

Smallest fix: explicit published-for-challenge record bound to receipt hash, bootstrap-end event and policy, server-stamped after bootstrap ends; persisted closesAt; explicit final_by_silence status event in contracts, machine and SQL. Serialize challenge admission, finalization and entitlement authorization on the same subject lock, reading authoritative state after acquiring it. Record the public publication/notification evidence. Keep original qualifiedAt separate from this new clock. One challenged receipt waits for its one decision; no appeal machinery required.

Regression: real silence transition persists; pre-bootstrap publication cannot satisfy the window; challenge-at-boundary versus finalization has only one permitted result; challenged work cannot receive entitlements before decision.

R06-6 — HIGH: parsing a snapshot does not bind it to the qualified lease; a different snapshot bypasses required human review.
References: R:154–157 and R:159–208; SQL:117–139; RT:1045.

Executed with the same valid qualification baseline: its correct snapshot requires a human and no human PASS is refused. Replace the snapshot with another schema-valid body's leaseId, generation=99 and humanReviewRequired=false; qualificationRefusals returns no refusals. The qualified lease remains at generation 1. The schema parser succeeds, but the function extracts only the human requirement/risk class and never compares snapshot identity to the lease. SQL's qualification policy_snapshot_sha256 is plain text, not a bound reference establishing that correspondence.

D51 legitimately trusts the service to load stored rows; it does not make a mismatched stored row an acceptable qualification. This is a missing relation check, not an accusation that contributors directly control the rule arguments.

Smallest fix: load the snapshot by qualified lease ID, compare body and row lease/generation, recompute/check its canonical hash and bind that hash to qualification. Derive the human requirement from the policy pinned by that snapshot. Prefer a typed bound snapshot parameter or one shared resolver so every caller cannot accidentally choose another snapshot.

Regression: a valid snapshot belonging to another lease or generation fails even when it would otherwise relax the human rule. Retain the malformed/missing-field regression too.

R06-4 — HIGH: submitted work loses its protected review grace through an unauthorised failed/abandoned release.
References: R:1075–1097; E:798–815; REWARD-PROTOCOL.md:56; RT:983.

Executed: reason=abandoned, current epoch 3, expiry 5, submitted epoch 2, review grace 2, accepted=false, activeLease=false, no authorization => no refusals. An author lease can normally have ended after submission while protocol review remains pending. Choosing cancelled/repriced would require authorization, but choosing abandoned or failed bypasses the submitted-work protection. The engine then accepts the release and returns its reservation, preventing later acceptance.

Smallest fix: failed/abandoned must require authoritative terminal task evidence and must reject pending submitted work unless an explicit final rejection or authorized cancellation is bound to that submission. Protect submitted work consistently across all release reasons; activeLease=false alone is insufficient.

Regression: submitted -> lease ends -> review pending -> abandoned/failed release refused; final rejected submission can release; genuinely unsubmitted abandoned work can release.

R06-7 — HIGH: active simple holds are invisible to engine maturity; engine and entitlement rule disagree.
References: E:150–157 and E:944–985; R:509–552; SQL:1406–1416; RT:1050.

Executed: Alice has a 100-unit tranche maturing at epoch 6. The database/rule-side source has 10 units held. computeEpoch has no hold input or source identifier to represent that reservation; it matures the full 100 into Alice's claimable balance and removes the tranche. entitlementRefusals correctly refuses that output and requires a 90-unit unheld release. The SQL source-balance constraint is a useful backstop, but rejecting the engine's output is not a functioning maturity pipeline. If a service instead writes 90 while checkpointing the engine's 100, its checkpoint diverges from payable ownership.

This is a reproduced cross-layer contract mismatch, not an independently reproduced database overpayment. R04-2's numbered releases fix the database's second release but do not fix the engine's representation of the retained 10.

Smallest fix: preserve stable tranche/source identities and source-specific active holds in the engine projection, or explicitly split nominal accounting from an authoritative payable projection with reconciliation. For engine-first V1, let maturation move only unheld units and retain the held remainder until release. Apply the same availability projection to claims. Conservation must include the retained held ownership without counting it twice.

Regression: hold 10 of 100 -> mature 90 -> claim 90 -> release hold -> mature/claim remaining 10 once; same trace yields identical engine state and SQL entitlement balances. Test a hold that lapses during the maturity transaction too.

R06-3 — MEDIUM: engine and allocation validator choose different winners for rounding remainders.
References: E:770–798; R:1044–1069; RT:914.

Executed: reserve 1 base unit, two contributors at 50/50. Alice sorts before Bob by the engine's beneficiaryId/accountId key, so engine pays Alice 1 and Bob 0. Give Alice receipt ID z and Bob receipt ID a. taskAllocationRefusals uses receipt ID as its remainder tie-break and expects Alice 0/Bob 1; it rejects the engine output. The same issue occurs for any odd reservation at 50/50, not just the tiny demonstration amount. No extra units are created; legitimate finalization can fail. Sponsorship splits add another rounding layer when that dormant feature activates.

Smallest fix: one shared allocation function and canonical key/order for both engine and rules, with explicit task-to-receipt mapping. Pin it in the protocol. Do not let receipt-ID generation change an already calculated payment.

Regression: odd reserves, swapped receipt/account ordering, multiple beneficiaries, zero-rounding lines; add the dormant sponsorship vectors before activating splits.

R06-5 — MEDIUM: review grace is taken from the current policy, so a policy switch rewrites existing reservations.
References: E:178–190, E:721–730, E:757–761, E:815–821; R:246–249 and R:1087.

Executed: issue and submit in epoch 1 with expiry 5 and grace 2; the promised effective expiry is 7. Compute epoch 6 with grace changed to 0; the same reservation now expires at 5 and is swept. Increasing grace can likewise revive the payable lifetime of outstanding work. The reservation stores original expiry and submission epoch, but not grace or its policy version.

The founder's chosen grace is 2; this does not request changing it. It requires forward-only policy behavior consistent with fixed quotes.

Smallest fix: pin effective review deadline/grace and policy version per reservation, preferably when issued, then use the same persisted deadline in engine, admission, release and sweeper rules. Persist a submission event linked to the reservation; the SQL task budget currently has no submitted/grace columns, so name the authoritative event storage instead of re-deriving from current policy.

Regression: later policy changes do not shorten or lengthen old reservations; newly issued work uses the new version.

VERIFICATION OF EVERY REVIEW-04/05 ITEM

“Resolved” below means the cited original failure is fixed in the inspected draft, within D51's service contract. It is not a deployed/E2E guarantee. SQL-only fixes remain statically checked plus supported by supplied execution results.

Item                 Status                     Evidence / qualification
R04-1                Resolved                   E:633–664 sourced recoveries and ownership; UT:1193–1208. Delivered becomes an offset; unclaimed recovery debits its owner.
R04-2                Partial overall            SQL:703–707 numbered releases, R:538–549 unheld remainder; RT:1050 passes. Original duplicate-key stranding fixed; engine/hold mismatch remains R06-7.
R04-3                Dormant, not resolved       G-98 retains named stake sources/common locks and both-order/race requirements. No stakes in active V1.
R04-4                Resolved original sequence R:584–607 maxima; SQL:1590 onward serializes execution/release. RT:1069; supplied race passes. Simple-hold projection still needs R06-7.
R04-5                Dormant appeal bug          G-98 correctly retains appeal/finality lock requirement. Active free-challenge finality must be implemented now, R06-2; not deferred with appeals.
R04-6                Partial                    R:154–157 parses required fields; RT:1045 passes; lease expiry checked at R:173. Missing identity binding remains R06-6; fallback composition R06-1.
R04-7                Obsolete                   D49 payment uses fixed budgets; oracle version no longer determines receipt payment. RT:1158.
R04-8                Resolved original sequence R:1145–1163, SQL:1555–1585 parse signature/cluster/history/status; RT:1078. Empty/wrong/landed evidence is refused. Actual devnet settlement still G-89.
R04-9                Resolved at rule boundary  R:54–105 consumer-specific fields and payload equality; RT:1106. Consumer must actually supply its consumer enum and complete operation. Prior-state verification G-86 remains.
R04-10               Resolved                   E:518 onward runtime Set/checkpoint checks; UT:1211. Service must persist event IDs and checkpoint atomically.
R04-11               Resolved, module dormant   R:784–824 canonical manifest hash, duplicate/test filtering; RT:1142. Population approval and activation remain deferred.
B1                   Resolved original failure  R:337–402 computes model and checks objective consensus; RT:879–912; SQL objective identity uniqueness. Scope/size inputs still require real approval; peer/calibration G-92 remains.
B2                   Partial                    R:1044 derived shares + SQL:1381 onward per-receipt and task bounds; RT:914. 100/0 theft fixed, but independent split implementations disagree on remainders, R06-3.
B3                   Resolved original failures E:476 onward envelope, E:518 checkpoint, issuance before acceptance; UT:1232–1241. R:1116 and SQL:254–270 pin/check envelope inputs. Service must persist opening and close atomically; do not call computeEpoch repeatedly within one epoch.
B4                   Partial                    UT:1248–1264 and RT:953–983 establish expiry boundary and basic grace. Submitted-work release loophole and mutable grace remain R06-4/R06-5.
B5                   Resolved                   E:678–735 ancillary held in Q, acceptance moves it, release returns it. UT:1275 and simulation pass. Failed work no longer funds pools/security.
B6                   Partial                    R:280–321 route/assignment checks; RT:1029–1045; SQL one review per assignment. Original human-receipt loophole fixed, but actual acceptance policy binding/fallback still R06-1/R06-6. G-94 commissioning remains.
B7                   Resolved                   Same as R04-1; do not count twice as a new issue.
B8                   Resolved                   Unfunded issuance no longer consumed; UT:1287. Different question: reissuing a previously funded/expired task still needs a new reservation identity (note below).
B9                   Resolved original failure  budgetToBase + SQL explicit floor; UT:1293; supplied SQL vectors. This does not resolve the distinct split tie-break in R06-3.
B10                  Resolved                   R:212–260 no telemetry admission dependency; telemetryLinkStatus excludes bad links without changing payment. RT:290.

Earlier reviews 01–03 remain relevant through this table and GUARANTEES.md. Do not relabel their unresolved service, identity, calibration or real-cluster integration gaps “done” merely because unit tests pass. The review-04 history correction is now accurate.

ANSWERS TO THE SIX REVIEW QUESTIONS

1. Verification: table above. Most original isolated repros are fixed. The strongest remaining defects cross the boundaries between rules, engine and storage.

2. Engine lifecycle: the exercised engine conserves R + pools + S + Q + I and exactly owns I as delivered + claimable + holdback. Conservation alone does not establish the right owner, availability, deadline or authorization. R06-3/4/5/7 demonstrate those distinctions. Do not advertise engine/SQL agreement “on every amount” until one differential trace exercises issuance, on-time submission, acceptance, release, expiry, hold, maturity and claim against both.

3. D53/D54: the chosen policies are reasonable for valueless devnet/shadow; they are not executable end to end yet. Fix R06-1/2/6. Bootstrap single-signer is an accepted limitation, publicly labelled by SQL:1092–1113; keep that label bound to each operation. Never reinterpret historical bootstrap approval as an independently co-signed approval after bootstrap ends. Final-by-silence is its own evidence class, not retroactive independent human ratification. Keep devnet-only labels and Genesis/mainnet readiness restrictions after finality.

4. D56: deterministic ranking and excluding own/related proposals are useful. Ranking safety depends on server-derived catalog/dependency counts (already G-101), stable eligible unit IDs, ready dependencies, and atomic lease fencing/rechecks. R06-1 shows a concrete eligibility gap. Derive graph counts from approved, deduplicated data so contributors cannot increase unlock/reuse scores by opening redundant dependencies. Self-pick and assigned mode must share eligibility and reservation logic. Keep the chosen assigned-only window OFF: it may reduce early cherry-picking but does not fix invented ranking inputs or missing reviewer capacity. Continuous mode should also measure actual time/cap consumption, not merely the estimate used to choose the next unit.

5. D55: keep paid disputes, bounties, appeals, org splits/caps, governance voting, advanced detection, punitive recovery and Genesis calibration dormant. That is appropriate simplification. ACTIVE necessities are free challenge admission/finality, real acceptance review, source-specific holds, claim availability, and a single authorized writer. They cannot be deferred with the larger dormant features. G-98 is necessary but incomplete: add active challenge serialization now; before enabling dormant modules require the named regression/race evidence, source identity/reconciliation, snapshot/policy binding and exact allocation vectors. moduleRefusals only checks membership in an activated string list; it is not an activation procedure. The service must load authorized persisted activations, verify preconditions and gate every relevant write path. A trigger occurring does not itself grant activation or mainnet permission.

6. Unchanged areas: preserve exclusive ABU lease generations, execution token caps, immutable receipt provenance, versioned policies and disclosed admin actions. D49 deliberately replaces token-proportional pay with accepted budgets: provider-token normalization is now telemetry/calibration, not a condition for earned payment. That supersession is authorized; do not reintroduce log haircuts. Telemetry claimed as VERIFIED still needs real evidence, and missing optional logs alone are not fraud. Completion pools now accrue on acceptance, which resolves the prior issuance/failure incentive. Genesis stays distinct and mainnet-gated. No ICO, mainnet deployment or live-value rewards are authorized by this review.

CONCRETE DOCUMENT/IMPLEMENTATION EDITS

- Rewrite the active acceptance flow in PROTOCOL/HUMAN-REVIEW and implement it in qualification, status machine and SQL together. Avoid adding more disconnected helper-only tests.
- Replace stale “independent ratification whatever happens in a challenge window” in machines.ts/entities.ts and obsolete ratification-review comments in policies.ts with D54's actual event/evidence semantics.
- Update the REVIEW-PACKET summary, which still describes paid dispute stakes, appeals, canaries and governance as though they were all active. Put the active path first and label dormant behavior at the point it appears, not only in a separate table.
- Update source-backed release prose in REWARD-PROTOCOL.md:125 from once per (source,kind) to numbered partial releases with a cumulative source bound; explain held remainders and the engine projection.
- Specify one rounding key and one pinned reservation deadline, and add differential engine/rule tests using real receipt identities and policy changes.
- Clarify reissue identity. Executed: issue task t, expire it, attempt to issue t again => consumed-twice refusal. SQL likewise makes task_id the budget primary key. This can be correct replay protection if reissue creates a NEW task/reservation generation linked to the same objective. State that explicitly and provide the replacement operation; do not simply clear consumedIds or mutate the original budget. REWARD-PROTOCOL.md:56 currently promises reissue without specifying the identity transition.
- Preserve G-97 as a precondition before authoritative writes: one transactional writer, restricted grants, mandatory rules and integration tests. Nightly auditing is a detection backstop, not permission for an unsafe write.
- Record D57 in the reviewed docs/policy status on the next export. Remove “awaiting founder choice” for the accepted defaults; retain explicit deferred activation work.

DECISIONS STILL OPEN

No new founder decision is required to fix these seven findings. Implement the already chosen policies coherently. Accepted F30/F21 deferrals do not magically supply an approved GLM test manifest/endpoint or a Genesis reference population: those remain future activation artifacts, with eligibility disabled until completed. F34 remains a chosen deferral to stake activation, not an invitation to deploy undefined collateral behavior. Mainnet escrow/security review and real settlement drills remain separate gates.

NEXT PASS

Claude should reproduce the attached cases first, implement the smallest fixes, and add end-to-end composition tests. Return a short per-finding response with changed paths, regression names, the engine-versus-database lifecycle trace and the active challenge/finality race. Do not build the dormant modules merely to close this review. The goal is a smaller coherent V1, not a larger protocol.

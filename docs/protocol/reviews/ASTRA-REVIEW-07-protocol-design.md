warOnSaaS — Proof of Contribution review 07
Bundle snapshot: declared commit 4dddfe7
Date: 2026-09-30

VERDICT: APPROVE WITH CHANGES

Approve the architecture for devnet implementation, with the corrections below. Do not enable authoritative reward writes until the two HIGH findings are closed and the service integration checks described here pass. This is not approval for mainnet, an ICO, or value-bearing tokens.

This pass materially improves the design. The original fallback, snapshot identity, rounding, grace-pinning, submitted-work release and held-maturity cases now have coherent fixes. Keep them. The remaining work is bounded: fail-closed policy resolution, the ordinary free-challenge path, a few lifecycle edge cases, and honest integration-test coverage. Do not revive dormant modules or redesign the economy.

D57 and D58 are treated as recorded founder decisions, not questions to reopen.

VALIDATION

Independently executed:
- protocol.test.ts, protocol-rules.test.ts and tokenomics-sim.test.ts: 3 files, 209 tests passed.
- Ten additional probe records in PROBE-RESULTS.jsonl, including passing fixed baselines and nearby failing cases.
- lifecycle-trace.mjs's engine/SQL-generation half: completed and generated the attached 161-line SQL file.

Not independently executed: PostgreSQL assertions/races, the generated SQL, full-repository typecheck/lint/tests, or Solana integration. Docker's daemon socket returned “operation not permitted.” The supplied TEST-RESULTS.txt reports 1,339 passed / 250 skipped in the full suite, nine database races passing, the lifecycle trace passing and the 209-test subset passing. Those are supplied results, not my own database execution.

The bundle was extracted in an isolated review workspace. Installed dependencies and non-protocol supporting contract/build files came from the preceding review workspace/local installation. The reviewed protocol files were the uploaded versions. No protocol source files in the user's repository were changed.

References below are repository-relative:
E = packages/contracts/src/protocol/engine.ts
R = packages/contracts/src/protocol/rules.ts
M = packages/contracts/src/protocol/machines.ts
N = packages/contracts/src/protocol/entities.ts
SQL = packages/db/migrations/0007_proof_of_contribution.sql
UT = packages/contracts/test/protocol.test.ts
RT = packages/contracts/test/protocol-rules.test.ts
TRACE = packages/db/test/lifecycle-trace.mjs

1. REVIEW-06 FINDINGS: DISPOSITION

R06-1 — Original fallback and assignment failures resolved; broader acceptance remains partially resolved.
R:194–239 and R:312–339 derive seats, enforce the human/label/max-effort requirements and exclude unreviewable builders. Self-pick aliases the build-next eligibility rule. RT:1524–1576 exercises the composition. My baseline Opus + Astra max + human qualifies. Nearby unknown-risk and unpinned-capability cases still qualify incorrectly: R07-1 below.

R06-2 — Partially resolved.
SQL:1676–1757 supplies a persisted, stamped publication and serializes provisional challenges against silence finalization/live admission; RT:1261–1317 covers the original rule cases. The supplied R06-2 race reports the challenger committed and finalizer rejected. The new status/event exists, but the machine's states list and restoration SQL disagree (R07-5). The general free challenge of ordinary ACTIVE contributions remains absent (R07-2). These are narrower than the original missing D54 mechanism.

R06-3 — Resolved for active contributor-only splits.
E:75–102 splitTaskReservation and R:1176–1200 use account ID as the shared canonical key. RT:1616 covers odd reserves, reversed receipt ordering, multiple contributors and zero lines. Do not rebuild separate rounding implementations. Organization splitting remains dormant; the helper's sponsorship vector alone does not prove the engine's later multi-beneficiary integration.

R06-4 — Resolved at the rule boundary.
R:1206–1245 requires terminal task evidence and final rejection or authorized cancellation for submitted failed/abandoned work; RT:1608 covers the original loophole. The service must load those facts and serialize them with submission/release, rather than accepting caller booleans. R07-4 identifies the adjacent persistence boundary.

R06-5 — Original retroactive-grace bug resolved.
E:202–220 and issuance at E:848 pin grace/policy on the reservation; SQL:1395–1396 copies them from the issuance epoch. UT:1325 covers policy changes. My probe changes the current grace to zero: the outstanding reservation still expires at 7 and is not swept at 6. R07-4 concerns proving when submission actually happened, not grace pinning.

R06-6 — Original foreign-snapshot bug resolved.
R:245–270 binds body, row, qualified lease/generation and canonical hash; SQL:1648–1658 adds the FK/relation guard. RT:1577 covers foreign leases, generations and hashes. My foreign-snapshot probe is refused. Full policy binding is not yet complete because capability version is unchecked: R07-1.

R06-7 — Original held-maturity bug resolved; same-epoch hold lifecycle still needs coverage.
E:483–515 checks held ownership, E:637–651 limits debits, and E:1067–1077 retains held units in the identified tranche. UT:1340/1383 cover 90 + 10 maturation and partial claimable holds. The supplied SQL trace supports that particular projection. A newly placed hold released in the same epoch cannot currently be replayed: R07-6.

Reissue note — Identity specified and enforced by the composed rule/database path.
New task IDs, reissueOf, same objective, ended/unaccepted predecessor and unique successor are explicit. R:1537–1553 and SQL:321/1397 enforce this; UT:1413 and RT:1678 cover it. The pure engine alone accepts two distinct successors of the same expired predecessor, but reissueRefusals rejects alreadyReissued and SQL has a unique reissue_of. I do not classify that as a new money exploit under D51. Ensure the writer invokes the rule under serialization before checkpointing the engine; include the duplicate-successor case in the differential trace.

2. NEW FINDINGS, RANKED

R07-1 — HIGH — Acceptance is fail-open for an unknown risk class and does not bind capability policy version.
Locations: R:194–219, R:314–318; CapabilityInput at R:166; N:173.
Evidence: executed TypeScript probes.

Sequence A: construct a correctly hashed, lease-bound snapshot with riskClass='unknown-risk' (the snapshot schema allows any nonempty string). Keep the pinned review policy unchanged and give a revealed consensus round no agent verdicts, with a human PASS and the fallback label. qualificationRefusals returns []. The missing rule falls through to an empty agentSeats array. A policy-mapping error can therefore silently remove Astra review.

Sequence B: keep the snapshot pinned to capability-policy.v1, but supply a capability-policy.v2 object whose REVIEW_A class allows a different model. Its verdict is accepted. The review policy's version is compared to the snapshot; capability policy has no corresponding check, and its input type omits policyVersion.

This is not a claim contributors directly choose trusted service arguments. The advertised fail-closed resolver itself cannot detect these mismatches, even when all inputs are genuine stored records selected incorrectly.

Smallest fix: refuse absent/duplicate risk rules and unknown required capabilities; never translate unrecognized policy entries into fewer reviews. Include and compare the capability policy version to the snapshot, loading immutable policy content by that identity. Validate the expected reviewer capability/provider/model tuple. Preserve the human requirement in addition to the agent seats.

Regression: correctly bound unknown-risk snapshot cannot qualify; mismatched capability version fails even if that other policy is valid. Keep the working fallback case. Before supporting policies with multiple humans, carry their count/scope instead of reducing the requirement to a boolean.

R07-2 — HIGH — The V1 free-challenge path covers provisional founder receipts, not ordinary ACTIVE allocations.
Locations: R:1404–1449; SQL:403–425 and SQL:1690–1724; SQL:647–674; REVIEW-PACKET §0 steps 6–7.
Evidence: executed publication-rule rejection; schema and trigger inspection. No live service exploit claimed.

Sequence: an outside contributor's accepted receipt is ACTIVE and its allocation is published in an epoch's PROPOSED window. Another participant submits the free flag promised by D55. challengePublicationRefusals refuses status ACTIVE; SQL publication likewise requires PROVISIONAL, and provisional_challenges requires that publication. The older allocation_disputes/dispute_items tables require positive stakes and belong to the dormant machinery. There is no implemented active persistence/adjudication route for this ordinary free flag in the reviewed protocol files.

Result: the claimed general optimistic payout challenge mechanism is not yet specified end to end. Routing only founder receipts through D54 does not protect ordinary accepted allocations.

Smallest fix: define one small free-challenge record bound to the frozen receipt/allocation revision and its epoch publication, with reply and one final decision. Either generalize the active tables safely or add a narrow ordinary-allocation variant. Bind adjudication/entitlement eligibility to it under one subject lock. Keep stakes, bounties and appeals dormant.

Regression: ACTIVE allocation -> timely free challenge -> finalization/payment waits -> one confirmed decision permits or changes the allocation. Also test silence, late challenge and challenge-versus-finalization for this path. Do not manufacture PROVISIONAL status or a token stake to reuse the wrong mechanism.

R07-3 — MEDIUM — The “end-to-end” trace conflates claims with delivery and does not independently reconcile all accounting balances.
Locations: TRACE:67–109, TRACE:118–125, TRACE:156 onward.
Evidence: executed SQL generator plus inspection; SQL not rerun.

aliceDeliveredSql sums entitlement_claims, not confirmed settlement outcomes. claim() writes a leaf and its entitlement reservations, then returns an engine claim event. No settlement_attempts or settlement_outcomes are written by the generated trace. Yet the engine increments delivered. Consequently, an unbroadcast claim is reported as delivered in both sides of the comparison.

Concrete next sequence: reserve a leaf, never broadcast it, then legitimately void it and release its reservation. No token was delivered. The current SQL projection still sums the claim row without excluding leaf_voids, and the engine checkpoint already counted it as delivered. The current trace cannot validate recovery from that state.

Other scope limits: epoch balances are copied from engine output, not reconstructed independently from persisted pool/security/reservation movements; pool keys are empty; acceptance uses fixtures rather than a real lease/snapshot/review chain; epoch-transition checks are explicitly disabled for fixture transitions; no active challenge is exercised here. These are acceptable shortcuts for a narrow accounting projection test, not proof of the whole active path.

Smallest fix: retain and name this test accurately. Add explicit pending-leaf, confirmed-settlement and voided-leaf projections; emit engine claims only for confirmed delivery, consistently with the engine contract. Derive Q/P/S/I and claimable ownership from source records for the comparison. Add one composed acceptance/challenge/settlement integration trace when the writer is built. Do not copy an engine balance into SQL and count equality with that copy as independent verification.

R07-4 — MEDIUM — A caller-supplied old submitted_epoch can masquerade as an on-time submission; submission/release lack a shared boundary.
Locations: SQL:327–333 and SQL:1662–1674; R:383 and R:1222; E:865–873.
Evidence: engine rejection executed; SQL acceptance path inferred from its complete trigger, not database execution.

Sequence: task issued at epoch 1, expires at 5, current epoch is 6, and the sweeper has not released it yet. Insert task_submissions with submitted_epoch=4 and a syntactically valid hash. SQL checks only that 1 <= supplied epoch < 5 and no release exists. It stamps created_at now but does not prove the work arrived in epoch 4. Receipt admission will then use the apparent on-time submission to extend expiry to 7. The engine correctly rejects an actual new submission processed in epoch 6. This is a cross-layer mismatch, not a grace-policy issue.

Adjacent race: session A admits a submission but leaves it uncommitted; session B, seeing no submission, validates a release and commits; A then commits. The new submission trigger and the release path do not share a task lock, and the release conservation branch only checks contribution receipts. A service transaction alone does not serialize that read/write sequence.

Smallest fix: derive the submission epoch from immutable accepted-submission evidence and its server timestamp, or from the current authoritative admission epoch if recording is synchronous. If recording is delayed, require the actual earlier changeset/submission record, not an asserted epoch/hash. Serialize admission, release and replacement on the same task/reservation lock and re-read state after it. Add the corresponding submission rule/write-path contract.

Regression: late new work cannot backdate itself; genuine earlier evidence can be processed according to the documented policy; concurrent submission/release produces a single coherent outcome.

R07-5 — MEDIUM — FINAL_BY_SILENCE is missing from the machine's state list, and its supported restoration is rejected by SQL.
Locations: M:70–74 and M:111–126; SQL:1727–1747.
Evidence: machine membership probe executed; SQL restoration rejection inferred directly from the branch.

The machine has transitions into/out of FINAL_BY_SILENCE but omits it from states. More concretely: finalize by silence, revoke the receipt, then authorize restoration to its prior FINAL_BY_SILENCE status. The machine explicitly permits event restored. SQL rejects every event targeting FINAL_BY_SILENCE except final_by_silence; using that event instead also fails because the current state is REVOKED, not PROVISIONAL.

Smallest fix: add the state to the declared list; allow an authorized restored event only when immutable history proves the prior status was FINAL_BY_SILENCE. Take the subject lock for every status mutation relevant to challenge/admission, not just the final_by_silence branch. Retain the prohibition against inventing silence finality via another event.

Regression: final-by-silence -> revoke -> authorized restore works once; a never-finalized provisional receipt cannot use restored to bypass its window. Assert every transition endpoint belongs to states.

R07-6 — MEDIUM — A simple hold created and released within one epoch cannot be replayed.
Locations: E:679–703; EpochInput holds/holdReleases; one-call-per-epoch checkpoint contract.
Evidence: executed engine probe.

Start with Alice's 100 claimable units. During epoch 1, place a 10-unit hold and then overturn/release it before the epoch closes. Replay that epoch with holds=[h] and holdReleases=[h]. computeEpoch processes releases before placements and throws “hold h is not active.” SQL can persist the valid hold followed by its release. Calling the engine twice for that epoch is prohibited.

Smallest fix: support the ordered hold lifecycle within the epoch, or define a validated event-folding step that derives net active holds while consuming both immutable event identities. Preserve duplicate-event protection. Do not simply omit the events from audit/replay history.

Regression: new hold then release in one epoch; prior hold released in this epoch; hold and claim ordering; hold lapse and maturity at the same boundary. The existing 90 + 10 multi-epoch test should remain unchanged.

R07-7 — LOW — D58's measurement rows assert the resolving lab/outcome without binding them to the confirmed ruling.
Locations: SQL:1065–1080 and SQL:1768–1787; R:1647–1685; 0001_init.sql:719–732.
Evidence: static SQL/rule inspection, not an executed SQL insertion.

The trigger derives raised_by_lab from the finding's review, which is good. resolved_by_lab and outcome remain supplied values; the independent foreign keys do not prove this finding appears in this confirmed ruling, or that the named resolver lab produced it. A row referencing an existing ruling for different findings can say resolved_by_lab='human', outcome='overruled' and satisfy the shown checks. Cross-lab statistics would then measure annotations rather than verified rulings.

Smallest fix: generate records from each confirmed ruling's actual per-finding outcomes, binding its resolver run/provider or explicit human decision. Refuse wrong finding membership, pending/rejected rulings and changed outcomes. Derive resolving lab as well as raising lab. The D58 routing policy itself is reasonable; do not add another committee or review layer.

3. LIFECYCLE-TRACE ASSESSMENT

The trace is useful evidence for the specific 100-unit tranche -> hold 10 -> mature 90 -> release -> mature 10 accounting case, budget flooring, pinned expiry/grace and ordinary release/expiry fixtures. It does not exercise commission -> eligibility -> lease -> snapshot -> qualification -> public challenge -> finality -> confirmed delivery end to end. R07-3 explains why the stronger claim is not supported.

Near traces worth adding, without a rewrite: unknown-risk/mismatched-policy qualification, ordinary ACTIVE challenge, late submission, hold created and released within one epoch, pending claim then void, two contributors with odd reservation, nonempty completion pools, and two attempted successors of one expired reservation. Use one small scenario per boundary; do not replace these with another large simulation.

4. CHALLENGE/FINALITY RACE ASSESSMENT

For the specific provisional challenge versus silence-finalization race, the subject lock is the right mechanism. Both operations take it before stamping/reading, so a timely challenge transaction holding it across the deadline prevents the finalizer from ignoring that uncommitted challenge. The supplied race result demonstrates that ordering. Its fixture disables triggers only while creating the shortened publication window in a separate session; that does not itself disable the later race sessions' checks.

The race test's oracle is too weak: it passes whenever challenge and finalization did not BOTH occur, including when both transactions failed. Require exactly the expected successful operation, the expected failure reason for its competitor, and the resulting current status. Add the reverse ordering and ensure timeout/deadlock/fixture failures cannot be mistaken for invariant success.

The lock must cover every status-changing decision affecting eligibility: human gate acceptance/rejection, revocation and restoration as well as silence. check_receipt_status_event currently acquires it only inside the silence branch. Apply the same pattern to the ordinary free-challenge path in R07-2. Reads used to authorize a subsequent write must happen after the lock; checking a boolean before entering the transaction is insufficient.

The architect's “live admission is the boundary” argument is valid conditionally: all allocations must be inseparably bound to included immutable manifest entries, and all entitlements to those allocations, with the service rules mandatory. In D51, part of that implication is procedural, not established solely by this new SQL trigger. Test the composed writer; do not claim the SQL alone proves it. A post-admission revocation also needs the defined correction/offset path, not an assumption that the receipt can never change.

5. ACCEPTANCE, D58, DORMANT MODULES AND FOUNDER DECISIONS

Acceptance: one shared requirement is now present and fixes the original D53 integration. Body/row/hash/lease/generation binding is sound for the exercised cases. Finish risk-rule failure handling and capability policy identity (R07-1). Keep observed max effort and independent human binding. Do not lower review requirements to make the test pass.

D58: routing single-lab findings to another eligible lab, splitting mixed sets, and sending fallback/both-lab/no-resolver cases to a human matches the decision. Preserve author/reviewer and related-account exclusions when computing the eligible pool, and the maintainer's confirmed decision as the source of the measurement record. R07-7 is a provenance fix. Unknown lab identity must fail closed; zero raising labs should not silently become a valid “both labs” finding. GLM remains ineligible; no additional provider work is required now.

G-98: the expanded dormant preconditions now cover the requested stake/hold collateral, appeal/finality serialization, exact splits, policy/source binding, reconciliation and explicit authorized activation. Keep them. Correct its claim that the ACTIVE challenge path is complete: it currently describes provisional receipts only. Nothing about an activation trigger grants mainnet permission. No dormant feature needs building to close this review.

Founder decisions: none newly required for these corrections. D57 already chose the numerical defaults/deferrals and D58 the resolver policy. Remove remaining stale phrases such as “punitive forfeiture awaits founder decision F17” from the packet summary and “F32 confirms or narrows” in G-99. Accepted compensatory-only recovery and bootstrap single-signer policy are not open votes. GLM evaluation artifacts, Genesis population approval and mainnet security work remain deferred activation prerequisites, not present authorization.

RECOMMENDED NEXT STEP FOR CLAUDE

Implement the two HIGH corrections first. Close the small state/hold issues and add authoritative submission evidence/serialization to the writer contract. Correct the trace's delivery projection and coverage claim. Bind D58 records to confirmed rulings when wiring that write path. Return a concise finding-to-test mapping and the new boundary traces. The chosen architecture is ready to implement with these changes; another broad protocol redesign is unnecessary.

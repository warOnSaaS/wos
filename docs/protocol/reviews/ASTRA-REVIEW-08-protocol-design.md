warOnSaaS — Proof of Contribution review 08
Snapshot: uploaded bundle 08, declared commit f5d7f7a
Date: 2026-09-30

VERDICT: FREEZE AFTER THE LISTED CHANGES

Two targeted corrections remain within the review-07 changes: allocation challenges must cover all live-countable receipt statuses, and submission admission must fail closed when its expiry deadline cannot be established. Fix these, add the specified regressions, and freeze the design for devnet/shadow implementation. No redesign, new founder decision, dormant-module implementation, mainnet launch or value-bearing token authorization is needed.

This is a narrow confirmation review of R07-1 through R07-7, the strengthened races and the accounting-projection trace. Settled decisions and unchanged protocol areas were not reopened.

VALIDATION

Independently executed: all 221 protocol/rule/simulation tests passed across 3 test files; 12 additional probe records are attached; the accounting trace's engine/SQL-generation half completed.

Not independently executed: PostgreSQL assertions/races or the generated accounting SQL. Docker access returned “operation not permitted.” Database results in TEST-RESULTS.txt are supplied evidence, supported here by code inspection, not my own database run. No actual Solana settlement was tested.

The uploaded protocol files were tested in an extracted workspace using installed dependencies and non-protocol supporting contract/build files from the preceding review workspace. No protocol source files in the user's repository were changed.

References are relative to the reviewed repository:
R = packages/contracts/src/protocol/rules.ts
E = packages/contracts/src/protocol/engine.ts
SQL = packages/db/migrations/0007_proof_of_contribution.sql
RT = packages/contracts/test/protocol-rules.test.ts
UT = packages/contracts/test/protocol.test.ts

R07 VERIFICATION TABLE

Item | Status | Evidence and nearby case

R07-1 | Resolved | R:209–258 refuses missing/duplicate risk rules, unknown capabilities, empty/unheld agent seats; qualification compares capability policy version and checks provider/model tuple at R:343–358. RT:1748–1792 covers these cases. My probes confirm the valid fallback passes and unknown risk, wrong policy version and wrong provider fail. Self-pick/build-next inherit the requirement's refusals. No new blocker in this fix.

R07-2 | Partially resolved | SQL:634–660 and SQL:1819–1906 add ordinary free challenges, reply, one decision and source-locked entitlement limits. RT:1797 onward covers ACTIVE receipts and wrong revision/root/window/decision. The supplied forward/reverse races exercise payment exclusion. The exact ACTIVE case now works, but RATIFIED and FINAL_BY_SILENCE receipts cannot challenge their subsequent live allocations. See R08-1.

R07-3 | Resolved within the correctly narrowed test claim | accounting-trace.mjs now counts delivery from confirmed settlement outcomes, excludes voided claims, projects pending leaves and uses source records for the quantities it compares. It explicitly excludes independent verification of completion/security reserves and full acceptance/challenge integration. The supplied output reports 54 checks. I executed the generator and inspected its SQL, not the PostgreSQL half. Assessment below.

R07-4 | Partially resolved | SQL:1696–1736 derives submission evidence from the task's accepted signed changeset and shares the task lock with release and replacement. The original asserted-epoch loophole is fixed when the expiry epoch exists; the supplied tests cover real earlier evidence and both race orderings. A missing expiry-calendar row disables the lateness check. See R08-2.

R07-5 | Resolved for the cited failure | FINAL_BY_SILENCE is now declared in ReceiptStatusMachine.states. SQL:1780–1810 locks every status event and admits restoration only from REVOKED with prior silence-finalization history. RT:1853 checks transition endpoints; supplied database regressions distinguish valid restoration from a never-finalized receipt. My endpoint-membership probe returns no invalid endpoints. Operation-bound restore authorization remains the existing D51 writer responsibility.

R07-6 | Resolved for the requested in-epoch hold/release sequence | E:679–706 folds prior releases, new holds and their releases before claims, consuming both identities. UT:1444–1500 covers same-epoch placement/release, claim availability and maturity; the original multi-epoch 90 + 10 test remains. My probe leaves no active hold, preserves Alice's 100 claimable and consumes both event IDs. No new blocker in this fix.

R07-7 | Resolved for the cited provenance failures | SQL:1925–1965 requires a confirmed ruling, finding membership, matching outcome and a derived resolver lab; same-lab/unknown cases fail. R:1724 onward derives records from the ruling rather than arbitrary measurement rows; RT:1859 covers that contract. My confirmed-human-ruling probe produces the expected row; an awaiting-maintainer ruling is refused. The supplied SQL tests cover a foreign finding and inconsistent outcome. No new blocker in this fix.

Reissue note | Resolved | The engine now consumes reissue:<predecessor> when funding a successor, matching the existing unique successor rule/database constraint. Unfunded work does not consume the successor marker. Retain the regression; no separate change requested.

BLOCKING FINDINGS — ONLY THESE TWO

R08-1 — HIGH: a receipt that finalized through D54 loses the right to challenge its later allocation.
Locations: R allocationChallengeRefusals (receiptStatus must equal ACTIVE); SQL:1842–1843. Related contract: PROTOCOL.md:104 says live epochs count ACTIVE, RATIFIED and FINAL_BY_SILENCE.
Evidence: executed rule probes; corresponding SQL guard inspected.

Failing sequence:
1. A founder receipt starts PROVISIONAL and is published through D54.
2. Its D54 window closes and it becomes FINAL_BY_SILENCE, or its review gate accepts it and it becomes RATIFIED.
3. That receipt enters a later live epoch. Its allocation and allocations root are published for the first time in that epoch's PROPOSED window.
4. A participant flags a defect in this allocation during that window, citing the correct receipt hash and allocations root.
5. allocationChallengeRefusals rejects both finalized statuses. The SQL trigger rejects them too. The old D54 challenge path is already closed and refuses a finalized receipt.

My identical valid challenge inputs return [] for ACTIVE but a refusal for RATIFIED and FINAL_BY_SILENCE; the D54 admission helper separately refuses the old finalized publication. Thus neither channel can hear a new allocation-specific challenge. Finalizing contribution eligibility before its payout is calculated cannot establish that the later allocation is correct.

Smallest fix: use the existing live-countable eligibility predicate (ACTIVE, RATIFIED, FINAL_BY_SILENCE) for allocation challenges, in both rule and SQL, while still requiring the current epoch's open allocation window and frozen allocation/revision binding. D54 remains the pre-admission contribution-qualification window. This does not reopen its old decision or add an appeal.

Required regressions: D54 silence -> live allocation -> timely allocation challenge -> payment blocked pending decision; repeat with RATIFIED. A still-PROVISIONAL or REVOKED receipt must not gain ordinary live admission. Retain late-challenge, wrong-root and wrong-revision rejection tests.

R08-2 — MEDIUM: missing expiry-calendar data turns off the new submission lateness check.
Locations: SQL:1715–1719, check_task_submission.
Evidence: static SQL analysis; not claimed executed against PostgreSQL.

Failing sequence:
1. Issue task T in epoch 1 with expires_epoch=5; no release has yet been written.
2. The calendar row for epoch 5 is absent. This is permitted by the schema: expires_epoch is an integer, not a required reference, and neither issuance nor this trigger requires the future calendar to be complete.
3. Later, a genuinely new accepted signed changeset for T arrives after the intended epoch-5 expiry. It is newer than the budget, so the earlier-than-budget check passes. To make the ordering explicit, an epoch-6 calendar row can exist; the schema does not require all intervening rows.
4. Insert task_submissions referencing that changeset. deadline becomes NULL. The guard `(deadline is not null and cs.created_at >= deadline)` is false. The epoch derivation searches only epochs 1–4, assigning an old epoch or falling back to the issued epoch.
5. The late changeset is now stored as an on-time submission and can acquire the pinned review grace, despite the engine rejecting a new submission at or after expiry.

The original fix correctly stopped callers asserting an arbitrary epoch. This adjacent case instead derives an incorrect old epoch when required calendar data is absent. It must not treat “deadline unknown” as “on time.”

Smallest fix: make the immutable expiry timestamp/calendar boundary available at issuance, or refuse submission until the required expiry-calendar data exists. Remove the fallback that silently classifies an unresolvable timestamp as the issuance epoch. If future epochs are pre-created, enforce that prerequisite rather than relying on it informally. Preserve acceptance of genuine earlier changeset evidence recorded later.

Required regressions: absent expiry row fails closed; late changeset with complete calendar fails; genuine pre-expiry changeset recorded later passes; derived epoch actually contains the evidence timestamp. The shared task lock and existing forward/reverse submission-release races should remain.

STRENGTHENED RACE ASSESSMENT

The winner/loser oracle is materially better: race_exact requires the expected commit, expected error text and expected final state. “Both failed” no longer counts as success. Forward and reverse cases exist for provisional challenge/finality, ordinary allocation challenge/payment and submission/release. The entitlement trigger correctly takes the subject lock before checking whether any challenge exists. That ordering matters for an uncommitted challenge.

These remain focused concurrency tests, not full production-workflow tests. The ACTIVE allocation race uses fixture epochs and disables the epoch-transition trigger in the payment transaction; it tests challenge-versus-entitlement serialization, not that production finalization respects its clock. Keep that scope explicit. I checked whether that DDL necessarily masks the reader race: DISABLE/ENABLE TRIGGER uses SHARE ROW EXCLUSIVE, compatible with an ordinary SELECT's ACCESS SHARE, so it is not by itself evidence that the challenge read was artificially serialized. See PostgreSQL 17's primary documentation:
[ALTER TABLE trigger lock mode](https://www.postgresql.org/docs/17/sql-altertable.html)
[Lock compatibility](https://www.postgresql.org/docs/17/explicit-locking.html)

One reporting limitation: the 20-second alarm wraps only session two; session one's wait is unbounded. This does not turn a failed race into a pass, so it is not a protocol-freeze blocker. Either bound both sessions in the test harness or narrow the claim that every hung session is killed. Do not treat supplied test success as independent execution by this reviewer.

ACCOUNTING-PROJECTION TRACE ASSESSMENT

It now tests its stated accounting projection rather than claiming an entire end-to-end acceptance pipeline. The SQL separates pending, voided and confirmed leaves, and the engine receives delivery events only on confirmation. Reclaim after void and the odd 105-unit split are present. Source-derived issued amounts, budget-part reservations, ownership, holds and delivery are meaningfully compared; copied epoch_balances merely exercise a CHECK and are explicitly excluded as independent evidence.

The header correctly states that completion pools/security reserve are not independently reconstructed and that lease/snapshot/qualification/challenge integration is not exercised here. Retain those limits. Signed transaction bytes and status observations are fixtures, not a real Solana-cluster test. The corrected trace satisfies R07-3 at this scope; no expansion is required as a condition of this narrow freeze review.

FREEZE CONDITION

Close R08-1 and R08-2 with the listed regressions and the existing suite, then freeze for devnet/shadow implementation under the already accepted decisions. Both are small guard/contract corrections. Do not reopen tokenomics, numerical defaults, D58 routing or dormant-module design. The later transactional writer and real integration checks remain implementation requirements already established by D51/G-97, not new architecture decisions.

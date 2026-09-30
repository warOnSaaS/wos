# GUARANTEES — where each write-time guarantee lives after D51 (engine-first enforcement)

Migration 0007 v5 keeps only the hard invariants (its section I; PROTOCOL.md §12). Every other rule is a pure function in `packages/contracts/src/protocol/rules.ts` (plus `engine.ts`, `machines.ts`, `governance.ts`, `policies.ts`) that the service layer MUST call inside the writing transaction and obey before it writes. This table lists every database assertion of migration 0007 **v4** (the last version that enforced everything in SQL) and the guard that rejects the same sequence now. `SQL` = still refused by the database (`packages/db/test/db-assertions.sql` 0007 block, or `packages/db/test/concurrency.sh`); `rule` = refused by the named unit test of the pure rule (`packages/contracts/test/protocol-rules.test.ts`); `engine` = the reward engine (`packages/contracts/test/protocol.test.ts`).

Totals: 118 v4 assertions; 45 still refused in SQL (some also by a rule); 73 moved to rules/engine with a unit test; 0 unmapped.

| v4 assertion (label) | Guard now | Test |
|---|---|---|
| A3-1 repro: a devnet entitlement routed to a mainnet leaf (default-deny at the settlement boundary) | SQL I9 + rule | db: 'A3-1 repro: a mainnet leaf (default-deny at the settlement boundary; also a CHECK)'; unit: claimRefusals |
| A3-1 repro: a tranche matured in its own epoch | rule (service must call) | unit (protocol-rules): 'A3-1 repro: a tranche matured in its own epoch; A3-4 repro: maturing the full tranche although part is held' |
| A3-1 repro: the same reward entitled twice (balance, then the (source, kind) key) | SQL I4/I8 | db: 'A3-1 repro: the same reward entitled twice (one per source and kind)' |
| A3-12 repro: a member of the frozen reference population added later as a Genesis beneficiary | rule | unit: 'A3-12 repro: a reference-population member added later as a Genesis beneficiary; …' |
| A3-12 repro: commit evidence without its canonical commit mapping | rule | unit: same test (commit evidence without its mapping) |
| A3-12: a merged live attempt claimed as Genesis history | rule | unit: same test (live work claimed as Genesis) |
| A3-12: adding to a finalized reference manifest | SQL invariant | db: 'A3-12: adding to a finalized reference manifest' |
| A3-1: Genesis vesting outside the Genesis finalization (mainnet-only) | rule | unit: 'A3-1: a bounty entitlement to someone other than the disputer; Genesis vesting outside Genesis finalization' |
| A3-1: a bounty entitlement to someone other than the disputer | rule (service must call) | unit (protocol-rules): 'A3-1: a bounty entitlement to someone other than the disputer; Genesis vesting outside Genesis finalization' |
| A3-1: a release that dips into the holdback share (20% pinned on the epoch) | rule (service must call) | unit (protocol-rules): 'A3-1: a release that dips into the holdback share; entitling more than the allocation holds' |
| A3-1: an entitlement naming someone else's allocation | rule (service must call) | unit (protocol-rules): 'A3-1: an entitlement naming someone else's allocation; a non-final allocation' |
| A3-1: entitling more than the allocation holds | SQL invariant | db: 'A3-1: entitling more than the allocation holds' |
| A3-2 repro: voiding a leaf with an unrelated admin action | rule (auth) + SQL I9 | unit: 'H12 / A3-7 repro: an unrelated action (…, leaf void, …)'; db: voids of confirmed or in-flight leaves stay refused |
| A3-2 repro: voiding a settled leaf to re-claim its entitlement | SQL invariant | db: 'A3-2 repro: voiding a settled leaf to re-claim its entitlement' |
| A3-2: a claim of less than the remaining balance | rule | unit: 'D40 / A3-1 / A3-2: claiming a tranche; …; less than the remaining' |
| A3-2: claiming into a void leaf | SQL invariant | db: 'A3-2: claiming into a void leaf' |
| A3-2: voiding a leaf whose signed attempt may still land | SQL invariant | db: 'A3-2: voiding a leaf whose signed attempt may still land' |
| A3-3 repro: a second dispute staking the same 1 WOS of pending allocation | rule (service must call) | unit (protocol-rules): 'A3-3 repro: a second dispute staking the same 1 WOS of pending allocation' |
| A3-3 repro: a settlement paying a bounty on excess the appeal reversed | rule (service must call) | unit (protocol-rules): 'A3-3 repro: a settlement paying a bounty on excess the appeal reversed (derived: 0 excess, stake forfeited)' |
| A3-3 repro: settling before the appeal window closed (a timely appeal would then face an immutable settlement) | rule (service must call) | unit (protocol-rules): 'A3-3 repro: settling before the appeal window closed; settling while an appeal is pending' |
| A3-3: a "confirmed" appeal that changes the amount | rule (service must call) | unit (protocol-rules): 'A3-3: a 'confirmed' appeal that changes the amount' |
| A3-3: entitling an allocation whose appeal is still pending | rule | unit: 'A3-1: an entitlement naming someone else's allocation; a non-final allocation' |
| A3-3: entitling the part of an allocation reserved as dispute stake | rule (service must call) | unit (protocol-rules): 'A3-3: entitling the part of an allocation reserved as dispute stake' |
| A3-4 repro: an appeal decided with an unrelated action | rule | unit: 'A3-4 repro: an immediate 'upheld' decision with no appeal filed; an unrelated action; …' |
| A3-4 repro: an immediate "upheld" decision with no appeal filed | rule (service must call) | unit (protocol-rules): 'A3-4 repro: an immediate 'upheld' decision with no appeal filed; an unrelated action; before the reply window' |
| A3-4 repro: maturing the full tranche although 10 is held | SQL I8 + rule | db: 'A3-4 repro: maturing a tranche that is fully held'; unit: 'A3-1 repro: … A3-4 repro: maturing the full tranche although part is held' |
| A3-4: deciding before the reply window closed | rule | unit: same test as the A3-4 decision repro |
| A3-4: executing while the appeal is open | rule (service must call) | unit (protocol-rules): 'A3-4: executing while the appeal is open; after the hold lapsed; when overturned' |
| A3-5 (telemetry): usage of another run (lease) attached to this contribution | rule | unit: 'A3-5 (telemetry): usage of another run attached / reused by a second contribution' |
| A3-5 repro: a qualification asserting an arbitrary revision | rule (service must call) | unit (protocol-rules): 'A3-5 repro: a qualification asserting an arbitrary revision' |
| A3-5 repro: another attempt's changeset cited for this attempt | rule (service must call) | unit (protocol-rules): 'A3-5 repro: another attempt's changeset cited for this attempt' |
| A3-5: a qualification citing a changeset of another lease | rule (service must call) | unit (protocol-rules): 'A3-5: a qualification citing a changeset of another lease' |
| A3-5: a qualification citing a round that ended in gaps | rule (service must call) | unit (protocol-rules): 'A3-5: a qualification citing a round that ended in gaps' |
| A3-5: a submission accepted after the attempt's hard lifetime | rule (service must call) | unit (protocol-rules): 'A3-5: a submission accepted after the attempt's hard lifetime' |
| A3-5: an implementation qualified without green CI at its head | rule (service must call) | unit (protocol-rules): 'A3-5: an implementation qualified without green CI at its head' |
| A3-5: the pinned snapshot requires a human approval that is missing | rule (service must call) | unit (protocol-rules): 'A3-5: the pinned snapshot requires a human approval that is missing' |
| A3-6 repro: a claude run declared as the codex seat | rule (service must call) | unit (protocol-rules): 'A3-6 repro: a claude run declared as the codex seat' |
| A3-6 repro: a run reused for another seat (the run is bound to its own lease's single assignment) | rule | unit: 'A3-6 repro: one run reused for a second verdict; an expired lease' |
| A3-6 repro: an assignment redeemed on an unrelated quorum | rule (service must call) | unit (protocol-rules): 'A3-6 repro: an assignment redeemed on an unrelated quorum; a verdict on another packet' |
| A3-6: a document review by an account related to the document's author | SQL invariant | db: 'A3-6: a document review by an account related to the document's author' |
| A3-6: a verdict on another packet than the assigned one | rule | unit: 'A3-6 repro: an assignment redeemed on an unrelated quorum; a verdict on another packet' |
| A3-7 repro: an old record_offset action reused for a different amount | rule (service must call) | unit (protocol-rules): 'A3-7 repro: an old record_offset action reused for a different amount' |
| A3-7 repro: an old record_offset action reused for the same amount | rule (service must call) | unit (protocol-rules): 'A3-7 repro: an old record_offset action reused for the same amount / one action used for a second mutation' |
| A3-7 repro: one admin action used for a second mutation | SQL invariant | db: 'A3-7 repro: one admin action used for a second mutation' |
| A3-7 repro: revoking with a one-person resolve_dispute action and no resolution | rule (service must call) | unit (protocol-rules): 'A3-7 repro: revoking with a one-person resolve_dispute action and no resolution' |
| A3-7: a decision action approved for the opposite outcome | rule | unit: 'A3-7 repro: an old record_offset action reused for a different amount' (payload binding) |
| A3-7: a maintainer session writing the co-signer's approval | SQL invariant | db: 'A3-7: a maintainer session writing the co-signer's approval' |
| A3-7: a two-person activation without the second approval | rule | unit: 'A3-7: a two-person action without the co-signer's separate approval' |
| A3-7: a two-person revocation without the co-signer's separate approval | rule | unit: same |
| A3-7: an action approved for another operation | rule | unit: 'A3-7 repro: … reused for a different amount' |
| A3-7: an activation approved for another epoch | rule | unit: same (payload binding) |
| A3-7: an approval of a different operation hash | rule (service must call) | unit (protocol-rules): 'A3-7: an approval of a different operation hash / by the actor' |
| A3-7: the actor approving their own two-person action | rule | unit: 'A3-7: an approval of a different operation hash / by the actor' |
| A3-9 repro: confirmed with a NULL commitment | SQL invariant | db: 'A3-9 repro: confirmed with a NULL commitment' |
| A3-9 repro: signed bytes declared failed-before-broadcast (only a proven expiry frees the leaf) | SQL invariant | db: 'A3-9 repro: signed bytes declared failed-before-broadcast' |
| A3-9: expiry declared at a block height that has not passed the last valid height | SQL invariant | db: 'A3-9: expiry declared at a block height that has not passed the last valid height' |
| D49: a budget above the hard maximum of the model | rule (service must call) | unit (protocol-rules): 'D49: a budget above the hard maximum of the model' |
| D49: a budget above the model without a human (two-person) approval | rule | unit: 'D49: a budget above the model without a written justification / without a two-person approval' |
| D49: a budget above the model without a written justification | rule (service must call) | unit (protocol-rules): 'D49: a budget above the model without a written justification / without a two-person approval' |
| D49: a budget set after work started (the task already has a lease) | SQL invariant | db: 'D49: a budget set after work started (the task already has a lease)' |
| D49: a receipt weighted by its usage instead of its task budget | rule (service must call) | unit (protocol-rules): 'D49: a receipt weighted by its usage instead of its task budget' |
| D49: a third share on a fully declared task (reward stacking) | rule (service must call) | unit (protocol-rules): 'D49: a third share on a fully declared task (reward stacking)' |
| D49: accepting a task whose budget was released | rule (service must call) | unit (protocol-rules): 'D49: accepting a task whose budget was released or expired' |
| D49: allocating more than the task's reserved budget | SQL invariant | db: 'D49: allocating more than the task's reserved budget' (I8, at commit) |
| D49: declared shares of a task summing to less than 10000 bp | SQL invariant | db: 'D49: declared shares of a task summing to less than 10000 bp' |
| D49: issuing a task on mainnet | rule (service must call) | unit (protocol-rules): 'D49: issuing a task on mainnet or outside an OPEN epoch with a pinned rate' |
| D49: issuing beyond the epoch's task capacity (reservation at issuance, never scaled) | SQL invariant | db: 'D49: issuing beyond the epoch's task capacity (reservation at issuance, never scaled)' |
| D49: releasing the budget of an accepted task | SQL invariant | db: 'D49: releasing the budget of an accepted task' |
| D49: task budgets under one objective exceeding it (splitting / stacking) | SQL invariant | db: 'D49: task budgets under one objective exceeding it (splitting / stacking)' |
| D49: the proposer of a budget taking its lease | SQL invariant | db: 'D49: the proposer of a budget taking its lease' |
| a Genesis beneficiary's related party in the reference population (M16) | rule | unit: 'M16 / A3-12: a related party or an unadmitted receipt in the reference manifest' |
| a human review of an org-mate's receipt | SQL invariant | db: 'H8: a human review of an org-mate's receipt' |
| a human review outside the reviewer's risk classes (H8) | rule (service must call) | unit (protocol-rules): 'H8: a human review outside the reviewer's risk classes; a pre-merge approval bound to another subject's round' |
| a human reviewing their own receipt | SQL invariant | db: 'H8: a human reviewing their own receipt' (I6) |
| a leaf to a wallet bound to someone else | SQL invariant | db: 'H9: a leaf to a wallet bound to someone else' |
| a leased contribution without a qualification (H7) | rule (service must call) | unit (protocol-rules): 'H7: a leased contribution without a qualification' |
| a maintainer transition without its admin action | SQL invariant | db: 'H6: a maintainer transition without its admin action' |
| a non-participant disputing | rule | unit: 'repro E: a zero-stake dispute; an empty bundle; a non-participant; …' |
| a pool both paid and returned (H13) | SQL invariant | db: 'H13: a pool both paid and returned' |
| a pre-merge approval bound to a round of a different subject (H8) | rule | unit: 'H8: a human review outside the reviewer's risk classes; a pre-merge approval bound to another subject's round' |
| a qualification granted by an unrelated admin action | rule | unit: 'H12 / A3-7 repro: an unrelated action (…, qualification grant, …)' |
| a receipt on a mainnet epoch (readiness gate) | rule (service must call) | unit (protocol-rules): 'readiness gate: a receipt on a mainnet epoch' |
| a receipt without the publication disclosure (D47) | rule (service must call) | unit (protocol-rules): 'D47: a receipt without the publication disclosure' |
| a replayed provider response id | SQL I4 | db: 'a replayed provider response id' |
| a resolution whose amounts do not add up | rule | unit: 'resolution amounts must add up and wait for the reply' |
| a second attempt while the first is unresolved (H3) | SQL invariant | db: 'H3: a second attempt while the first is unresolved' |
| a vote backdated into a closed window (H6) | SQL I2 + rule | server time stamped on governance_votes; unit: 'H6: a vote in a closed window …' |
| admin action by a non-maintainer | SQL invariant | db: 'H12: admin action by a non-maintainer' |
| admission to an epoch that is not OPEN | rule (service must call) | unit (protocol-rules): 'H6: admission to an epoch that is not OPEN' |
| an IMPLEMENTATION receipt without a merged attempt (H7) | rule (service must call) | unit (protocol-rules): 'H7: an IMPLEMENTATION receipt without a merged attempt' |
| an activation authorized by an unrelated admin action (H12) | rule | unit: 'H12 / A3-7 repro: an unrelated action (…, activation, …)' |
| an allocation added after publication | SQL invariant | db: 'repro C / H2: an allocation added after publication' |
| an allocation while the epoch is OPEN | SQL invariant | db: 'H2: an allocation while the epoch is OPEN' |
| an audit seat on someone else's non-audit lease (H8) | rule (service must call) | unit (protocol-rules): 'H8 / A3-6: an audit seat on someone else's non-audit lease; one task assigned twice; last seat without a second provider; outside-feature seat for an insider' |
| an organization wallet bound by a non-admin | rule (service must call) | unit (protocol-rules): 'review-02 M17: a wallet bound before the disclosure; H9: an organization wallet bound by a non-admin' |
| bootstrap_merge outside bootstrap mode | SQL invariant | db: 'bootstrap_merge outside bootstrap mode' |
| claiming an unmatured holdback tranche (D40) | rule | unit: 'D40 / A3-1 / A3-2: claiming a tranche; …' |
| confirming before finalized commitment (H3) | SQL invariant | db: 'H3: confirming before finalized commitment' |
| confiscating an entitlement already in a live (settled) leaf: released tokens are never seized | SQL invariant | db: 'D39: confiscating an entitlement already in a live (settled) leaf: released tokens are never seized' |
| declaring an attempt expired without a historical search (H3) | SQL invariant | db: 'H3: declaring an attempt expired without a historical search' |
| disputing one's own allocation | rule | unit: 'repro E: … one's own allocation; …' |
| ending a duty offer twice (M14) | SQL invariant | db: 'M14: ending a duty offer twice' |
| finalizing inside the challenge window | SQL invariant | db: 'H6: finalizing inside the challenge window' |
| one commit credited to two retro units (M16) | SQL invariant | db: 'M16: one commit credited to two retro units' |
| paying a pool that never became payable | rule (service must call) | unit (protocol-rules): 'H13: paying a pool that never became payable' |
| proposing inside the risk review window | SQL invariant | db: 'H6: proposing inside the risk review window' |
| repro A: skipping every epoch window (H6) | SQL invariant | db: 'repro A: skipping every epoch window (H6)' |
| repro C: allocating Bob's receipt to Alice, twice (H2) | rule + SQL I4 | unit: 'repro C / H2: allocating a receipt to someone else's beneficiary, …'; db: 'H2: the same receipt, slice and beneficiary allocated twice' |
| repro D: one wallet bound to two accounts under RLS (H9) | SQL invariant | db: 'repro D: one wallet bound to two accounts under RLS (H9)' |
| repro E: a zero-stake dispute (H10) | rule (service must call) | unit (protocol-rules): 'repro E: a zero-stake dispute; an empty bundle; a non-participant; one's own allocation; joining a resolved allocation' |
| repro E: joining an already-resolved allocation | rule | unit: 'repro E: … joining a resolved allocation' |
| repro G: a pause expiring a year from now via a future created_at (H6) | SQL invariant | db: 'repro G: a pause expiring a year from now via a future created_at (H6)' |
| restoring to a status it never had | rule (service must call) | unit (protocol-rules): 'D23: ratifying a receipt that is not provisional; restoring to a status it never had' |
| review-02 M17 (Astra-03): a wallet bound before the publication disclosure | rule | unit: 'review-02 M17: a wallet bound before the disclosure; H9: …' |
| revoking with an unrelated admin action (H12) | rule | unit: 'H12 / A3-7 repro: an unrelated action (revocation, …)' |
| sponsorship approved by a non-admin | rule | unit: 'H8 / D44: a sponsorship approved by a non-admin, …' |
| the same entitlement in two live leaves (H3) | SQL invariant | db: 'H3 / A3-2: the same entitlement in two live leaves' |
| two-person action labelled one-person by the caller (H12) | SQL invariant | db: 'H12: two-person action labelled one-person by the caller' |

## Concurrency (two sessions)

| Race | Guard now | Test |
|---|---|---|
| A3-2 one entitlement claimed into two leaves | SQL I8 (deferred, serialized conservation at commit: the later committer is refused) | race: 'A3-2: one entitlement claimed into two leaves concurrently' |
| A3-4 two holds against one proven excess | SQL I8 | race: 'A3-4: two 50 holds against 60 proven excess concurrently' |
| A3-9 attempt racing pause + snapshot | SQL I9 (shared/exclusive settlement fence) | race: 'A3-9: a settlement attempt racing a pause and a migration snapshot' |
| M14 duty ended twice | SQL I4 (unique terminal event) | race: 'M14 (review 02): a duty offer ended twice concurrently' |
| D49 two issuances for the last capacity | SQL I8 | race: 'D49: two task issuances racing for the last epoch capacity' |

## Rules without a v4 assertion that also moved (no silent loss)

Clip never raises a weight, audit outcomes only for revealed real quorums, duty events for the offered account, permanent exclusion needs governance, adapter switches need governance, Genesis dedup keys are Genesis keys, manifest admission, sponsorship approval, usage-receipt lease/run/snapshot binding: each is a function in `rules.ts` with a test in 'further write rules moved from 0007 v4 (no guarantee silently dropped)'.

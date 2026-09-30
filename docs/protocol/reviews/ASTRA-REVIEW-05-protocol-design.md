DO NOT IMPLEMENT YET

warOnSaaS Proof of Contribution — review 05

The switch to budgets fixed before work starts is a better foundation. It removes the direct incentive to fabricate token usage and rewards efficiency. Keep that decision. The implementation still has blockers in commissioning, epoch lifecycle, acceptance, allocation shares and inherited settlement accounting. Continue isolated development and devnet experiments; do not connect this draft to authoritative contributor balances yet.

History correction: bundle 04 was reviewed in this conversation. Its completed report identified 11 findings. The new packet's statement that it was “never reviewed” is inaccurate. I checked its applicable findings against bundle 05 rather than assuming that a changed payment model resolved them.

Scope and verification

Reviewed snapshot: the 70-file review-05 archive associated with supplied TEST-RESULTS.txt commit 12509a1. Repository text and the attached prompt were review material, not authority to deploy, modify the actual project or launch model agents. No protocol source was edited.

Independently executed: 73 tests passed in packages/contracts/test/protocol.test.ts and tests/tokenomics-sim.test.ts, including simulation freshness. Node 22.23.1. The isolated workspace uses uploaded protocol code/tests and installed local dependencies, plus supporting contracts modules and configuration from the earlier workspace. This is not an independent full-repository build.

Additional engine probes reproduced late acceptance, retry failure for unfunded tasks, persistent pool accrual after failure, an incomplete same-epoch lifecycle, repeated same-epoch capacity calculation, and the inherited dispute-ownership failure. Outputs are included as PROBE-RESULTS.jsonl.

Not independently executed: PostgreSQL assertions/concurrent sessions, full npm check, or Solana E2E. Docker remained inaccessible in the preceding review even after socket permission was granted. The supplied successful database/concurrency output is evidence from the architect, not my execution. SQL failures below are concrete static sequences for regression tests. They generally require an erroneous or malicious authorized writer; I am assessing the claimed database backstops, not demonstrating a public endpoint exploit.

Locations refer to uploaded files. SQL = packages/db/migrations/0007_proof_of_contribution.sql; ENGINE = packages/contracts/src/protocol/engine.ts; ENTITIES = packages/contracts/src/protocol/entities.ts; SIM = tools/tokenomics-sim/sim.ts.

Budget-model assessment

Keep: an agreed reward budget, binary evidence-backed acceptance, reservations made before work, a fixed quote honored at acceptance, separate token telemetry, declared contributor shares, objective-level ceilings, devnet-first scope and an explicit mainnet prohibition.

The extended arithmetic invariant R + P + S + Q + I is useful and held for the returned states in my probes. It is not sufficient: funds can be attributed to the wrong person, retained for failed work, reclassified after delivery, or reserved beyond a previously announced epoch envelope while that sum remains constant.

The draft should distinguish four durable operations: open an epoch with one frozen rate/capacity/queue snapshot; commission and reserve a task; accept/release/expire that reservation; finalize allocations and settle them. The current batch engine mixes these phases and cannot represent an ordinary task issued and accepted in the same epoch in one call. Recalling it within the epoch redraws capacity. The database stores an epoch rate/capacity but does not establish their derivation from the same reserve snapshot/forecast as the engine.

The anti-inflation controls are not yet enforceable end to end. G-92 correctly admits the budget-model function is missing, G-93 the queue policy, and G-94 the human assignment relationship. These are prerequisites for issuing real budgets, not optional polish. Neither a multiplier bound against a caller-supplied model number nor a cap against an arbitrary duplicate objective proves that the commissioned work is fairly valued.

Findings, ranked

HIGH B1 — Commissioned budgets are bounded against unverified inputs
Location: SQL:643–727; docs/architecture/GAPS.md:366–373.
Evidence: static.

model_acu_micro, basis and budget_model_version are caller-supplied. The SQL compares budget against that supplied model; it does not compute the model from the pinned task/size/multipliers. acceptance_objectives has a free ref, no uniqueness over its canonical work identity and an optional consensus_round_id with no consensus validation.

Sequence: set model_acu_micro=1,000 ACU and budget=1,000 for work whose intended model is 10. The multiplier is 1x, so neither above-1.25x approval nor 2x hard bound rejects it. Alternatively create two objective IDs with the same criterion/ref and commission a full budget beneath each. Each individual objective cap passes while the same acceptance objective is funded twice. No valid consensus round is required by the shown table/trigger.

Smallest fix: implement the versioned model evaluator before issuance, bind its inputs to immutable task/contract data, and validate its computed result. Give each objective a canonical unique identity/version and require the applicable completed consensus over scope and total budget. Approve the entire budget operation, including objective/model version and relevant inputs. A recorded G-92 is accurate disclosure but this remains a blocker.

HIGH B2 — Allocation checks do not enforce collaborators' declared shares
Location: SQL:881–893 and 1450–1478; ENGINE:531–563.
Evidence: static SQL comparison with the engine.

The deferred receipt check enforces shares sum to 10,000 bp. Allocation insertion only enforces that the task's total does not exceed reserved_base. It never checks the amount allocated to each receipt against that receipt's share, or its person/organization split.

Sequence: reserve 100 units for a task, create valid Alice/Bob receipts at 50/50, then allocate 100 to Alice and 0 to Bob. Both beneficiary checks pass and the total is 100. The engine would allocate 50/50. Similarly, a contributor's 20% personal/80% organization sponsorship can receive the whole amount personally because the person merely needs a nonzero permitted share.

Smallest fix: freeze the accepted share manifest and derive the exact allocation amounts from the reservation using the same largest-remainder rule as the engine. Validate the full per-task result and sponsorship split atomically. Serialize on the task when allocations span different epochs: the current epoch lock is not a cross-epoch task lock. A two-session test with the task's collaborator receipts in different epochs should verify the aggregate cap as well.

HIGH B3 — The engine lacks a coherent within-epoch reservation lifecycle
Location: ENGINE:531–639; SQL:569–570, 682–687, 722–727.
Evidence: executed.

Issuances occur after acceptances. Passing issuance and acceptance of the same new task to one computeEpoch call throws “has no reservation.” Calling computeEpoch again for that epoch has no epoch checkpoint and recalculates a fresh budget from remaining reserve.

Probe: reserve=1,000, budgetPpm=1,000,000, task-capacity share 75%, fixed rate 100 base units/ACU. First call for epoch 1 reserves 700 for task A and accrues pools/security. A second call for epoch 1 calculates a fresh budget of 126 and reserves 90 for task B. Total reservations issued under epoch 1 become 790, exceeding the first published 750 capacity. No arithmetic invariant fails. The stressed policy simply makes the defect easy to see; capacity must remain frozen for any permitted policy.

Smallest fix: open each epoch once with a persisted reserve snapshot, rate, capacity and remaining capacity. Apply issuance/acceptance/release events against that state, or define an event-ordered replay that uses one frozen envelope. Permit same-epoch completion without another emission-budget draw. Persist the forecast/queue snapshot used to quote the rate. The SQL's stored envelope and the engine's event model must reconcile byte-for-byte.

HIGH B4 — Expiration and cancellation have inconsistent or missing guards
Location: ENGINE:531–584; SQL:849–856, 896–906; G-95.
Evidence: executed engine, static SQL.

The engine accepts before sweeping expired reservations and does not inspect the reservation's expiry during acceptance. A task issued in epoch 1 with expiresAtEpoch=5 was paid 100 units when accepted at epoch 9 in the probe. The SQL rejects admission after 5, but permits at 5 (uses >), while the engine's expiry sweep expires at 5 (uses <=). At the boundary, processing order determines whether an honest contributor is paid.

The SQL release trigger only checks that no receipt exists. It permits reason='expired' before expiry and permits cancellation/repricing while work is active without a corresponding authorized transition. The budget proposer/lease trigger also does not require an unreleased, unexpired funded budget for reward-bearing work.

Smallest fix: define one inclusive/exclusive expiry rule and enforce it at acceptance and release in both layers. Tie cancellation/repricing to the required authorization and task state; distinguish failure, abandonment and expiry. Specify protection for on-time submitted work delayed by the protocol's reviews. Add before/at/after-expiry, active-work cancellation, and acceptance-versus-release tests. A missing sweeper alone is not the whole G-95 issue.

HIGH B5 — Failed tasks permanently fund completion pools and security reserves
Location: ENGINE:564–584, 681–725.
Evidence: executed.

Accrual depends on new reservations, not accepted work. Expiry/release returns Q to R but does not reverse the ancillary accrual attributable to that task.

Probe: issue a task reserving 100; this credits feature=12, application=6 and security=6 under the test parameters. Release the task with no acceptance. Q returns to zero, but all 24 ancillary units remain. Repeatedly issuing and abandoning tasks can move reserve into pools without verified contribution. It becomes an economic attack if participants can induce issuance and later receive those pools; the demonstrated accounting movement itself does not require that assumption.

Smallest fix: accrue on acceptance, or reserve provisional ancillary funding with the task and atomically finalize/reverse it on acceptance/release/expiry. If issuance alone intentionally funds security operations, make that a separate capped policy and do not characterize completion accrual as accepted contribution. Add a no-accepted-work repeated-issuance scenario to simulation.

HIGH B6 — Human review and alternate receipt types can bypass the required acceptance route
Location: SQL:689–699, 756–791, 824–868; SQL:352; ENTITIES RunPolicySnapshot; G-85/G-88/G-94.
Evidence: static.

A human_review budget may name an arbitrary commissioned ID without a task/assignment. HUMAN_REVIEW is absent from the qualification-required type list, and no alternative human-review result binding is checked by the contribution-receipt validator. More generally, contribution_type is not mapped to its required evidence class and acceptance event by the database.

Sequence: commission a human_review budget for an arbitrary UUID, then submit an accepted_budget HUMAN_REVIEW receipt with the matching amount/slice and 100% share, no lease and no completed human review reference. The new budget checks cannot prove any review happened. An outcome-class receipt for a normally commissioned type also needs explicit rejection, rather than relying on a later engine adapter.

Inherited issue: SQL checks snap.body.humanReviewRequired with missing→false, while the typed RunPolicySnapshot still omits that property. Valid agent/build relationships can therefore skip a required human gate through a normally shaped snapshot.

Smallest fix: require a typed server-owned human assignment and accepted result for human-review payments; enforce contribution type → commissioning/qualification/acceptance route. Put policy-derived human requirements in the actual typed snapshot and fail closed on omission. Until a type has a real acceptance path, refuse its reward-bearing receipts. Do not add more asserted “accepted” labels.

HIGH B7 — Delivered tokens remain recoverable as fictional dispute escrow
Location: ENGINE:251, 511–520.
Evidence: executed again on bundle 05.

After Alice claims 100 from I=100 and R=900, claimable is empty and the tokens remain issued/delivered. A dispute input excessBase=100 is accepted and makes R=1,000, I=0. No source or beneficiary escrow is consumed. Against Alice's still-unclaimed 100, a 20-unit dispute instead throws because claimable remains 100 while I falls to 80.

Smallest fix: consume explicit source-backed disputed escrow/owner balances. Delivered amounts become offsets, not reserve. The new Q bucket does not repair the old I ownership hole. This is review-04 finding 1, still applicable under budget rewards.

MEDIUM B8 — An unfunded task is marked consumed and cannot simply wait for the next epoch
Location: ENGINE:613–620; docs/protocol/REWARD-PROTOCOL.md section 4.
Evidence: executed.

consume('task:'+taskId) occurs before checking capacity. An unfunded task ID appears in consumedIds. Reissuing it next epoch with the persisted replay set throws “consumed twice,” contradicting the documented wait/retry behavior. Giving it a new ID risks weakening objective/task deduplication and is not the stated retry contract.

Smallest fix: consume an issuance event only after reservation succeeds, or distinguish task identity from uniquely numbered issuance attempts with an explicit pending/unfunded state. A scheduler retry must not require forgetting replay history. Test insufficient capacity followed by successful issuance at the same task identity.

MEDIUM B9 — PostgreSQL and TypeScript reserve different amounts at fractional boundaries
Location: SQL:717; ENGINE:362–364.
Evidence: executed TypeScript; static SQL semantics checked against PostgreSQL source.

The engine floors integer division. SQL casts a numeric quotient directly to bigint, which rounds to nearest. For budget=1 micro-ACU and rate=500,000 base units/ACU, the engine yields 0 and declines funding; SQL yields 1. Repeated tiny splits can therefore alter reservation totals across layers.

Smallest fix: use explicit floor on the numeric product/quotient before the bigint cast and handle overflow consistently. Add cross-language vectors below/at/above half-unit and near capacity limits. PostgreSQL's numericvar_to_int64 explicitly rounds before conversion: https://doxygen.postgresql.org/backend_2utils_2adt_2numeric_8c_source.html (numericvar_to_int64, round_var(..., 0)). SQL was not run here.

MEDIUM B10 — Optional telemetry can still block reward admission
Location: SQL:860–873; docs/protocol/POLICIES.md:65–70.
Evidence: static.

When supplied, telemetry must match the lease/account and cannot have been linked to an earlier contribution. Failure raises from the monetary receipt insertion. Omitting telemetry entirely succeeds. Thus an otherwise valid accepted task can fail reward admission merely because it included optional malformed/reused telemetry. This retains coupling that D49 says it removed.

Smallest fix: validate/store telemetry independently with an explicit integrity status; invalid evidence may be excluded from calibration and may raise a signal, but it must not silently change an already-earned budget absent a separately adjudicated material acceptance defect. Keep execution safety caps and model-policy enforcement separate from reward pricing.

Inherited review-04 findings still applicable

These are concrete blockers or residuals, not resolved merely by deleting usage-based pay. The SQL diff leaves the relevant functions substantially unchanged. The earlier full report is included in this handoff for the exact test sequences.

R04-1 Dispute ownership: reproduced as B7 above (HIGH).
R04-2 Partial holdback release: SQL:1820 and check_entitlement still permit release of 90 from a 100 tranche with a 10 hold, then cannot release the restored 10 after overturn/lapse because of the unique (source,kind) key. Allow resumable partial release under the same source lock (HIGH).
R04-3 Stake/hold double reservation: check_allocation_dispute at SQL:1539 and allocation_remaining/reserved_stake still use different available-balance rules. A 1-unit stake plus 1-unit hold can reserve the same 1-unit allocation. Use named shared collateral balances (HIGH).
R04-4 Unbounded/racing holds: SQL:2134 and 2254 still allow arbitrarily distant reply/appeal dates; execution can remain uncommitted across expiry while another session claims the apparently lapsed source. Bound duration from notice and serialize execution with source consumers (HIGH).
R04-5 Timely appeal race: SQL:1710 has no common finality/source lock. Insert a timely appeal and hold its transaction across the deadline; another session can finalize from absence of a committed appeal. Persist serialized finality (HIGH).
R04-6 Human snapshot mismatch: remains, included in B6 (HIGH).
R04-7 Old-oracle admission: DISSOLVED for payment by D49. Receipt admission no longer requires its telemetry oracle to equal the epoch oracle. Preserve run-pinned rates for telemetry comparability if needed.
R04-8 Contradictory settlement observation: SQL:2040 still accepts expired_not_landed based on later height/non-null evidence without rejecting an observation saying the transaction finalized. Validate typed chain observations before replacement/void (HIGH).
R04-9 Incomplete approved payloads: grant scopes, transition destination and several money/duration fields remain outside canonical consumer checks. Bind the complete operation; session authentication is not by itself the defect (MEDIUM).
R04-10 Runtime replay omission: still accepted, reproduced in PROBE-RESULTS. Required TypeScript fields do not validate runtime state (MEDIUM).
R04-11 Genesis asserted hash: SQL:2595 still does not recompute the manifest hash or enforce all reference-population rules. Require canonical contents and unique eligible live receipts (MEDIUM).

Review 03 verification table

Item | Current status | Evidence
H1 Entitlement sources | PARTIAL | Named sources/domain/maturity improved; partial-release liveness and G-83/G-90 remain. SQL section 10b, R04-2.
H2 Duplicate claims | RESOLVED for original examples | Source/leaf locks, no confirmed/in-flight void, frozen signed leaves retained. SQL section 10b. Does not certify chain exactly-once.
H3 Appeals/stakes | PARTIAL | Sequential appeal-derived settlement fixed; shared collateral and deadline race persist. SQL sections 10a/10d; R04-3/5.
H4 Confiscation | PARTIAL | Notice/appeal mechanics improved, but duration, partial release and execution races remain. F17 is still open.
H5 Qualification | PARTIAL / usage-pay clauses DISSOLVED | Token sums/haircuts no longer price rewards. Evidence/typed human and contribution-type acceptance remain incomplete. B6.
H6 Audit binding | PARTIAL as previously recorded | Server assignments bind packet/provider/run; human risk derivation and non-build qualification remain G-85/G-88.
H7 Admin authorization | PARTIAL | Separate approval/one-use retained; canonical payload completeness and prior-state checking remain.
H8 Governance caps | RESOLVED for the original eligibility-order defect | governance.ts unchanged from the independently tested fix; declared ownership and F20 remain policy/trust assumptions.
H9 Settlement | PARTIAL | NULL-finality/shared fence improved; contradictory expiry evidence and chain E2E unresolved.
M10 Engine ownership | PARTIAL | Owned claimable balances and pinned tranches retained; dispute source hole and runtime replay omission remain. B7.
M11 Parsers | RESOLVED for reported examples | Included in the independently passing suite. Now telemetry integrity, not direct reward evidence.
M12 Genesis freeze | PARTIAL | Frozen row and insertion-order checks improved; approved-content binding/population validation remain.
M13 Usage-recovery economics | DISSOLVED as direct usage-pay deterrence | Fixed accepted budgets remove direct fabrication gain. Recovery is still needed for defective/duplicate work; calibration poisoning remains G-91.
M14 Acceptance-time rate gaming | DISSOLVED in its old form | Existing reservation quote is fixed. Issuance-time queue/forecast manipulation remains a different risk; do not call all timing incentives eliminated.
M15 Paid completion correction | PARTIAL | Engine offset input exists; DB attribution and source consumption remain G-87/G-83. B5 adds failed-reservation accrual.
L16 Sponsored rounding | RESOLVED for the prior per-receipt micro-weight defect | Exact share apportionment remains. New reservation rounding divergence is B9, a separate issue.

Earlier-review coverage

Review 02: H1/H2/H3/H6/H7/H8/H10/H12/H13 remain partial at the broader protocol level for the reasons above; H4's direct usage-profit surface is dissolved; H5's original cap-order issue is resolved; H9's registry/RLS uniqueness fix and H11's direct canary-disclosure/reason-check fix remain intact. M14's duty terminal-event unique index is retained but capacity planning remains a scheduling issue. M15 remains fixed for the tested parser cases, M16 remains partial for Genesis, M17's retention split and wallet-consent additions remain, and L18's original rounding fix remains subject to B9's new cross-language reservation issue. This does not reopen already-correct narrow fixes.

Review 01: evidence levels/normalization are now telemetry, not the monetary foundation; retain honest labeling. Bootstrap separation, maximum permitted Astra/Fable reviews, versioned human rules, exclusive leases, frozen snapshots and independent Genesis accounting remain requirements. Conservation and completion correctness are still partial as described above. D49 legitimately supersedes the old token-usage weighting requirement; no return to unverifiable token-based pay is recommended.

Incentives and fairness

Budget inflation/splitting: the concept of independently reviewed model quotes and one objective ceiling is appropriate; B1 shows why identity and computed inputs are prerequisites. SIM:413 onward assumes bounded factors and reviewer detection probabilities; table O assumes one objective. These tables illustrate those assumptions, not the enforcement missing from SQL.

Cherry-picking: an efficient contributor keeping the fixed reward is intended. Mispricing becomes a coordination problem when essential difficult work stalls while easy tasks exhaust capacity. Publish queue priority, aging and dependencies; measure completion and time-to-acceptance, not just claimed token use. Accepted-only telemetry is selection-biased and contributor-controlled. The 20-sample/20%-step rules damp manipulation but do not prove independent data. Robust independent observations and explicit calibration provenance remain G-91/G-92 work.

Proposer exclusion: keep conflicts visible, but the decomposer may be the only qualified person for a specialist task. A blanket exclusion can prevent useful work. Decide whether independently priced/approved exceptions are permitted, with public disclosure; do not let the proposer self-approve the price. The budget-insertion and lease-insertion checks also lack a common task lock: concurrently insert a budget while the proposer obtains a lease, and each can see the other as absent. Add a two-session test before claiming the exclusion is concurrency-safe.

Capacity/rate: a forecast spike can reduce new quotes; an underestimated forecast can exhaust capacity early. Define the eligible-demand snapshot, treatment of duplicates/Sybils/cancelled requests and priority before quoting. A fixed acceptance quote solves completion-time repricing; it does not make queue-entry timing or forecast manipulation disappear. Preserve the quote for slow honest work submitted on time while review is delayed.

Holdback: budget rewards still face duplicate work, collusive acceptance and latent defects. Shrinking to 20%/6 is a new risk parameter, not a theorem following from zero direct usage gain. Keep compensatory recovery as the draft default until F17 is decided with false-positive/restoration rules. Do not adopt forfeit-all just because an old usage-fraud simulation favored it.

Obsolete material to remove or rewrite

1. docs/protocol/POLICIES.md:70 still says logs are required and bare ATTESTED is weighted 50%, contradicting lines 65–67. Delete the haircut/mandatory-log payment language.
2. REVIEW-PACKET.md section 3c H5 still describes epoch-oracle eligibility and missing-log discount as current payment controls. Rewrite as historical fixes superseded by D49, not current acceptance rules.
3. HUMAN-REVIEW.md:67 and POLICIES.md:63 retain inflation bonuses expressed as extra weight/percentage of clip. REWARD-PROTOCOL.md section 4 and POLICIES.md:38 promise +10% per upheld reviewer finding while the new task pays its fixed reservation. Delete usage-weight bonuses, or define an explicitly reserved separate outcome bounty. Never silently pay above the quote.
4. ENGINE:89 clipToCap and usage-mismatch/anomaly helpers are not automatically useless: retain only as clearly named telemetry/execution controls if still used. Remove them from monetary qualification APIs and reward explanations; do not delete useful integrity checks merely because usage stopped pricing pay.
5. Delete acceptance-time trailing-rate damping and its current-policy claims/tests where still presented as active. Preserve prior versions/review reports as history. F19's old question dissolves; the new forecast/priority timing problem needs its own decision.
6. Rewrite usage-payout canaries/dispute reasons, old recovery-profit recommendations and labels where still active. Optional transcript absence must not be treated as fraudulent reward evidence by default. Keep transcript checks where needed for actual acceptance evidence or a defined investigation.
7. Remove claims that the full budget model/consensus comparison/recalibration is implemented: G-92 states otherwise. Similarly distinguish the human-budget placeholder (G-94) from a payable review assignment.
8. Correct the epoch accounting prose: REWARD-PROTOCOL.md section 5 still says R -= B upfront, whereas the engine deducts actual reservations/outcome/accrual uses. Pick the implemented movement model and make each bucket reconciliation explicit.
9. Fix “bundle 04 was never reviewed” in PROMPT/REVIEW-PACKET. Attach the completed report and this carry-forward disposition so its invariant failures are not lost.

Packet answers

1. Verification: see the 16-item table and inherited review-04 list. Unit/simulation results are independently verified; SQL results are supplied plus static review.
2. Budget correctness: total-state conservation is promising, but quote rounding, shares, lifecycle and failed-task accrual disagree with the intended monetary contract. B1–B9 provide concrete sequences.
3. Incentives: direct token fabrication no longer raises a fixed task payout. Budget/identity/acceptance gaming and telemetry-driven future-price manipulation remain. Simulated 0% direct gain is conditional on fixed budgets and valid acceptance, not a global fraud result.
4. Epoch contract: not complete until the capacity/rate/forecast is frozen once and task events consume it without recalculating the budget. Define within-epoch issuance/acceptance, expiry, priority and demand admission.
5. Obsolete parts: remove the usage-pay remnants above; preserve telemetry integrity, auditability and historical artifacts.
6. Unchanged areas: source balances, finality, authorization and settlement still have the inherited defects listed. D49 does not resolve them.

Founder decisions still open

F17: compensatory recovery versus additional punishment; finite hold durations, independent appeal and restoration after error. Recommendation: compensatory-only devnet default while measuring actual acceptance abuse.
F18: whose named collateral funds a sponsored contributor's dispute; require explicit organizational authorization before charging its balance.
F19: old acceptance-time rate question superseded; decide issuance-demand/priority manipulation rules separately.
F20: fail-closed infeasible governance caps plus a bounded explicit recovery path; do not silently waive caps.
F21: independent Genesis approvers and exact reference population, with canonical content binding.
F22: binary acceptance is a reasonable V1 default; finish typed acceptance rather than introducing a subjective quality factor now.
F23: retain reservation-at-issuance and never haircut already-accepted quotes. Define one coherent frozen epoch lifecycle before implementation.
F24: model bounds, expiry and recalibration remain provisional; define model inputs, independent calibration sources and review-delay protection. The new 20%/6 holdback also needs explicit confirmation (F15).
F25: who proposes budgets, conflict rules and an independently approved exception for specialist work. Planning compensation must not duplicate execution/objective rewards.
Additional decisions: whether any ancillary reserves accrue for failed issued work; funding for reviewer-finding bonuses; eligible forecast demand and ordering under shortage. These materially affect payouts and should not be guessed by the implementation.

Next handoff

Fix the evidence/acceptance and accounting boundaries before adding mechanisms. Add paired engine/SQL golden vectors, same-epoch lifecycle tests, before/at/after expiry, unfunded retry, no-success repeated issuance, collaborator/sponsor share enforcement, canonical objective duplication, inflated model inputs and the inherited appeal/hold races. Do not mark a finding resolved solely because its original single-row example now rejects. Preserve the sound move to budget-based pay and the fixes already working.

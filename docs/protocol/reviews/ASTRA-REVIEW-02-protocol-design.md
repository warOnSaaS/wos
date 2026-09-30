DO NOT IMPLEMENT

I read every file listed in packet §2 and checked its Astra-01 resolution claims. Several changes are sound, but accounting, settlement, qualification and database enforcement still contain implementation blockers.

**Verification:** I executed read-only Node 22 probes against the actual TypeScript functions. SQL findings below are verified by inspection; the SQL reproductions were **not executed** because Docker access was blocked. Vitest also failed before running tests because the sandbox prohibited its temporary directory. Database examples distinguish contributor-context operations from privileged control-plane operations; they do not establish remotely exploitable endpoints.

**HIGH H1 — Returns create funding; replayed settlements can pass conservation with negative issuance**

**Where:** [engine.ts:124–145](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:124), [186–210](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:186), [328–376](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:328).

**Verified:** `returnsToReserve` increases R without debiting its source in I or P. `computeEpoch` never calls `assertConserved`; that helper checks equality, not nonnegative balances. Duplicate checking covers distributing receipts, excluding security payouts and dispute settlements.

Executed synthetic probes produced:

| Input | Result |
|---|---|
| Conserved state R=900, I=100; return 100 | Total becomes **1,100** |
| Same 100-unit dispute settlement twice, each paying 20 bounty | R=1,060, I=**−60**, bounty=40; `assertConserved(1000, result)` **passes** |
| Same security receipt four times against a 100-unit reserve | Paid **68.359375**, instead of one 25-unit payout |

**Failure:** An expiry, retry or duplicated settlement batch can overstate spendable reserve or pay the same work repeatedly. Undocumented caller-side pre-debits could compensate for returns, but the current input contract does not require or verify them.

**Smallest fix:** Represent returns as identified transfers from outstanding allocations or pools; debit and credit together. Consume settlement sources exactly once transactionally, reject duplicate payout IDs, and enforce conservation **and nonnegative balances** on input/output. Preserve the existing integer arithmetic.

---

**HIGH H2 — Proposed claim roots cannot accommodate challenges, late wallets or concurrent writes**

**Where:** [SOLANA-ARCHITECTURE.md:25–31](/Users/adventurini/waronsaas-protocol/docs/protocol/SOLANA-ARCHITECTURE.md:25), [64](/Users/adventurini/waronsaas-protocol/docs/protocol/SOLANA-ARCHITECTURE.md:64), [0007:824–907](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:824), [1306–1317](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1306).

**Verified:** The proposed allocations root hashes `ClaimLeaf`s. Leaves are immutable, require a wallet, and can only be inserted during CALCULATING. Yet challenges occur afterward, wallets are supposedly selected at FINALIZED, and unbound allocations can become claimable later.

Allocations also lack a required manifest entry and receipt/account/slice correspondence. Their uniqueness constraint allows the same receipt in different epochs or slices. Manifest/allocation inserts do not acquire the epoch-transition lock.

**Failure:** A proposed 100-unit leaf is clipped to 60; the schema cannot produce its corrected final leaf. An initially unbound contributor cannot later obtain a leaf. Separately, transaction A can insert an allocation while B publishes a root excluding A’s uncommitted row; A subsequently commits.

**Smallest fix:** Separate immutable proposed allocations from final settlement entitlements/root. Define how later-bound entitlements produce settlement leaves without counting issuance twice. Require manifest membership and correct beneficiary/slice, and serialize all epoch writes with publication under the same lock.

---

**HIGH H3 — A unique confirmed database row does not make transfers exactly once**

**Where:** [SOLANA-ARCHITECTURE.md:29–32](/Users/adventurini/waronsaas-protocol/docs/protocol/SOLANA-ARCHITECTURE.md:29), [0007:910–922](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:910), [OFF-RAMP.md:30–35](/Users/adventurini/waronsaas-protocol/docs/protocol/OFF-RAMP.md:30).

**Verified:** Multiple pending attempts per leaf are allowed. Attempt outcomes need not preserve the same signature. The unique constraint acts when recording confirmation, after the external payment.

**Failure inference:** Two workers send different transactions for one leaf. Both land; the second confirmation insert fails, but the transfer remains. Funding a wallet with the epoch total merely makes another claimant unpaid. After downtime, an expired transaction can also have landed previously: an unknown RPC status is not proof of nonpayment, especially when historical search is omitted. [Solana’s status API](https://solana.com/docs/rpc/http/getsignaturestatuses) explicitly limits default searches to its recent cache.

The migration procedure likewise lacks an in-flight transfer drain and finalized chain cutoff. A transfer classified as unclaimed at the snapshot could land afterward, followed by successor payment.

**Smallest fix:** Persist one immutable signed transaction before broadcast; allow one active attempt per entitlement; rebroadcast identical bytes; resolve ambiguous history before replacement. Define finality and reconciliation criteria. During migration, fence old workers, resolve pending attempts, and assign every entitlement exclusively to one adapter generation before publishing the snapshot.

---

**HIGH H4 — “Approximately zero” fabrication profit assumes recovery that the protocol cannot collect**

**Where:** [sim.ts:325–353](/Users/adventurini/waronsaas-protocol/tools/tokenomics-sim/sim.ts:325), [REWARD-PROTOCOL.md:54–58](/Users/adventurini/waronsaas-protocol/docs/protocol/REWARD-PROTOCOL.md:54), [99–103](/Users/adventurini/waronsaas-protocol/docs/protocol/REWARD-PROTOCOL.md:99).

**Verified:** The simulation treats eventual detection as recovery of all excess. Actual finalized corrections recover only from future earnings, capped at 50%. Auditor accuracy and dispute propensity are assumptions, not measurements.

**Exploit inference:** Submit accepted work with internally consistent fabricated usage, collect, then stop contributing or switch identities. The offset has no collectible future income. Exact-total logs establish consistency, not provider consumption. A coordinated population can also contaminate the peer percentile used to set future caps.

**Smallest fix:** Model detection, adjudication and actual recovery separately, including zero future earnings, correlated auditors, identity churn and contaminated baselines. Keep mainnet attested usage disabled. If enabled later, explicitly accept a loss budget or require recoverable collateral/withholding. Accepted-output weighting removes the usage-fabrication margin but still needs protection against size inflation and task splitting.

---

**HIGH H5 — The advertised organization cap does not cap effective voting power**

**Where:** [governance.ts:190–199](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/governance.ts:190), [279–304](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/governance.ts:279), [GOVERNANCE.md:20–26](/Users/adventurini/waronsaas-protocol/docs/protocol/GOVERNANCE.md:20).

**Verified by execution:** Caps use the **uncapped** total; turnout subsequently uses the **capped** total.

Synthetic population: five organization accounts hold 90% collectively; 50 outsiders hold 10%. After wallet and organization caps, the organization holds **50% of both effective denominators**. Its five accounts voting alone pass the **governance tier**, with 50% turnout and 100% yes votes. Each organization account has only 10% effective weight, so a 20% individual concentration check would not catch this distribution.

**Smallest fix:** Specify the denominator consistently. Retaining the uncapped eligible denominator for turnout prevents this particular solo-quorum exploit. If “10%” means final effective voting share, enforce that mathematical condition directly. Add this counterexample to the tally tests and simulation.

---

**HIGH H6 — Epoch initialization, policy activation and clock-dependent guards fail open**

**Where:** [0007:127–149](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:127), [369–400](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:369), [961–985](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:961), [1229–1259](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1229).

**Verified by inspection:**

- A first transition directly to FINALIZED passes: with `cur = NULL`, the invalid-transition expression evaluates to NULL, and `IF NOT NULL` does not raise. The challenge-time comparison also evaluates to NULL.
- Ordinary policy activation checks the highest OPEN epoch, but does not reject a later PROPOSED/FINALIZED target. Caller-supplied `announced_at` can satisfy notice retroactively.
- Disputes, replies and votes validate caller-supplied timestamps.
- Pause expiry is measured from caller-supplied `created_at`. Alternatively, `activate/paused_accrual` permits no expiry.
- The policy table cannot store the `governance` policy kind defined by the contracts. [0007:101–102](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:101)

PostgreSQL documents that NULL conditions do not execute an IF branch. [PostgreSQL 17 conditionals](https://www.postgresql.org/docs/17/plpgsql-control-structures.html#PLPGSQL-CONDITIONALS)

**Smallest fix:** Reject transitions unless validity `IS TRUE`; explicitly require initial OPEN. Stamp authoritative times server-side. Reject published targets on every activation path and validate notice against a recorded announcement. Give every pause path one enforced expiry rule.

---

**HIGH H7 — Qualification can be asserted without the evidence it supposedly requires**

**Where:** [0007:414–467](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:414), [528–530](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:528), [672–756](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:672).

**Verified:** An ACTIVE attested implementation receipt can omit its lease, use a nonexistent subject, and supply its own weight/verification labels. The positive fixture does exactly this. [db-assertions.sql:433–437](/Users/adventurini/waronsaas-protocol/packages/db/test/db-assertions.sql:433)

A quorum can be **inserted already ratified**; verdict-count validation runs only on UPDATE. Receipt ratification then trusts that outcome.

**Failure:** A control-plane bug can create payable work without qualification, or ratify bootstrap work without any auditor verdicts. Also, the epoch check intended to constrain modes is tautological and permits `test/mainnet-beta`. [0007:330–344](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:330)

**Smallest fix:** Require a persisted qualification result tied to subject revision, usage evidence and pinned policy. Require newly inserted quorums to have no outcome; validate every outcome transition. Explicitly constrain test epochs to devnet and enforce cluster eligibility at admission.

---

**HIGH H8 — Independence and audit-run binding are incomplete**

**Where:** [0007:243–269](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:243), [568–635](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:568), [703–735](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:703), [1363–1367](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1363).

**Verified:**

- “Related” means active sponsorship links, excluding ordinary organization membership and historical sponsorship relevant to the work.
- Sealed verdict RLS hides other reviewers’ rows from invoker-security independence checks.
- Payout audits do not bind reviewer, assigned task, lease, signed run, slot or provider diversity together.
- Human qualification checks only grant/restore status, ignoring authorized domain/risk/type/level.
- Human reviews compare hashes against a round without requiring that round to belong to the reviewed subject. The human-versus-agent exclusion is checked only when the human row arrives.

**Exploit inference:** Organization colleagues without sponsorship links occupy nominally independent seats; related auditors submit while their peers’ rows remain sealed; an auditor references an unrelated existing run; an agent review arrives after the same account’s human approval.

**Smallest fix:** Reuse the existing agent-review binding checks from [0002:25–39](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0002_backstops.sql:25) and [0003:49–63](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0003_subjects_and_runs.sql:49). Evaluate independence against a frozen relationship snapshot with privileged visibility and a shared round/quorum lock. Check exclusions in both insertion orders.

---

**HIGH H9 — Wallet uniqueness fails under RLS; organization settlement is underspecified**

**Where:** [0007:1093–1128](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1093), [1381–1384](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1381), [engine.ts:109–121](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:109), [0007:896–905](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:896).

**Verified:** The wallet trigger is an invoker-security function. Another account’s binding is invisible under RLS, so its advisory lock does not prevent duplicate bindings. It compares account IDs, not beneficiary identities.

Separately, the engine and claim leaves contain account beneficiaries only, while receipts can assign an organization a share. One leaf per account/epoch cannot directly represent personal and organization destinations.

The recommended Squads wallet also cannot sign the ordinary Ed25519 binding message “the same way.” A PDA has no private key. [SOLANA-ARCHITECTURE.md:59–64](/Users/adventurini/waronsaas-protocol/docs/protocol/SOLANA-ARCHITECTURE.md:59), [Solana PDA documentation](https://solana.com/docs/core/pda)

**Smallest fix:** Enforce current wallet ownership through a narrowly scoped privileged lookup or constrained binding registry. Introduce an explicit beneficiary identity for allocation and settlement, including organization split rounding and offset responsibility. Include the organization in signed authorization; use an approved on-chain multisig action for PDA binding.

---

**HIGH H10 — Disputes permit free griefing, late additions and duplicate excess settlement**

**Where:** [0007:950–1087](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:950), [PROTOCOL.md:103–108](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:103).

**Verified:** SQL accepts zero stake. It checks neither the required formula nor aggregate reserved stake. Disputes can begin empty; items can be appended after the challenge closes or after the allocation is resolved. Count-based limits lack serialization. Settlement totals are not derived from first-priority gates or their resolutions.

**Exploit:** Open a zero-stake dispute, append allegations later, or join a resolved allocation and record its excess again under another dispute ID. Under the intended economics, include one valid allegation alongside many frivolous ones: clipping anything returns the entire stake. Friendly identities can also preempt first-disputer bounty priority.

**Smallest fix:** Atomically submit and freeze the item bundle, compute/reserve stake, check current time/state, and serialize quota enforcement. Derive settlement from uniquely consumed gate resolutions. Charge for unsuccessful items independently; decide explicitly how related-party disputes affect bounty priority.

---

**HIGH H11 — Canary identity is exposed, and passing the checker does not demonstrate the claimed judgment**

**Where:** [0007:672–680](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:672), [1331–1341](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1331), [entities.ts:595–640](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/entities.ts:595), [752–754](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/entities.ts:752).

**Verified:** Public quorum records expose `is_canary` and the NULL receipt marker. Packets retain matchable feature/diff/contract information; dispute packets explicitly include a public dispute ID. `payoutCanaryCaught` checks judgment class but ignores the named reason.

**Exploit inference:** A modified client correlates packets with public records, handles recognizable canaries specially, and scripts ordinary verdicts. Even without correlation, recognizing a ≥1.5× perturbation does not prove a model ran or validate small fabrication.

**Smallest fix:** Keep quorum classification and source mapping private throughout auditing; remove unnecessary correlators; verify the required judgment and reason. Measure detection against an adaptive client. Describe canaries as behavioral checks, never execution attestation.

---

**HIGH H12 — Two-person authorization is a caller-controlled label**

**Where:** [ABUSE-MODEL.md:48](/Users/adventurini/waronsaas-protocol/docs/protocol/ABUSE-MODEL.md:48), [0007:38–95](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:38), [493–530](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:493).

**Verified:** `requires_co_signer=false` bypasses the co-signer requirement even for actions the policy calls two-person. A referenced action need not authorize the mutation’s kind or target. Existing tests revoke and restore a receipt using a `start_test_epochs` action. [db-assertions.sql:474–480](/Users/adventurini/waronsaas-protocol/packages/db/test/db-assertions.sql:474)

**Failure:** An unrelated historical admin action becomes reusable authority for changing rewards. A hash chain records this faithfully but does not authorize it.

**Smallest fix:** Derive quorum requirements from action/policy; bind approval to the complete action payload and target; validate that consuming mutations match that authorization. Preserve the hash chain.

---

**HIGH H13 — Application pools use the wrong payout rule, and disputed accrual survives**

**Where:** [REWARD-PROTOCOL.md:93](/Users/adventurini/waronsaas-protocol/docs/protocol/REWARD-PROTOCOL.md:93), [engine.ts:251–325](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:251), [347–359](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:347), [0007:1156–1163](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1156).

**Verified by execution:** Every pool uses feature component percentages. A 100-unit application pool with its lifetime beneficiaries supplied as implementers pays **75**, returning 25. The input has no pool kind.

Accrual occurs before dispute correction, and corrections do not reverse accrual attribution. Pool event rows also permit both `paid` and `returned`, without a transition rule.

**Exploit inference:** Fabricated work attracts completion funding; its immediate allocation is later clipped, but the inflated pool funding remains available. Scope can then be reduced under a newer definition without a specified treatment of previously accrued funding.

**Smallest fix:** Distinguish feature/application payout rules; retain pool/component identity in output lines; define correction treatment for associated accruals; enforce one terminal pool disposition. Specify funding treatment when scope shrinks.

---

**MEDIUM M14 — Duty records cannot progress, and the capacity model ignores timing**

**Where:** [0007:785–794](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:785), [1306–1317](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1306), [SOLANA-ARCHITECTURE.md:29](/Users/adventurini/waronsaas-protocol/docs/protocol/SOLANA-ARCHITECTURE.md:29), [sim.ts:598–607](/Users/adventurini/waronsaas-protocol/tools/tokenomics-sim/sim.ts:598).

**Verified:** One immutable duty row exists per account/epoch. Once it says `done=0, claim_gated=true`, neither update nor replacement can record completion.

**Failure:** A contributor completes offered audits but remains gated. More broadly, duty arrives when contributors claim, whereas sampled audits must finish earlier; “maximum three offered tasks” is not guaranteed timely supply. The simulation omits that dependency and additional canary/provisional demand.

**Smallest fix:** Derive duty from append-only offer/completion events, or version statements. Model deadline-specific available auditors by provider and independence constraints. Define a nonpunitive timeout when eligible work or capacity is unavailable.

---

**MEDIUM M15 — Usage adapters erase malformed evidence instead of reporting failure**

**Where:** [usage.ts:38–92](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/usage.ts:38), [135–177](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/usage.ts:135), [USAGE-PROOF.md:30–41](/Users/adventurini/waronsaas-protocol/docs/protocol/USAGE-PROOF.md:30), [66–78](/Users/adventurini/waronsaas-protocol/docs/protocol/USAGE-PROOF.md:66).

**Verified by execution:** Invalid counters become zero; cached input exceeding total input is clamped. An input with negative output and reasoning output=100 returns output=0, reasoning=100 without an error flag. Malformed JSON is silently discarded. The Codex exec parser lacks response identities; rollout parsing reports zero subagent events without demonstrating their detection.

**Failure:** Downstream qualification cannot distinguish legitimate zero usage from discarded malformed evidence using the adapter result alone.

**Smallest fix:** Return explicit parse/evidence failures; reject impossible relationships and unsafe sums; identify the authoritative event source. Keep unsupported pinned versions ineligible until real fixtures establish their semantics. Resolve the contradictory “exact logs required” versus “inconsistent/no logs receive 50%” rule.

---

**MEDIUM M16 — Genesis valuation remains dependent on manipulable live usage**

**Where:** [GENESIS-POLICY.md:20–30](/Users/adventurini/waronsaas-protocol/docs/protocol/GENESIS-POLICY.md:20), [sim.ts:565–570](/Users/adventurini/waronsaas-protocol/tools/tokenomics-sim/sim.ts:565), [794–808](/Users/adventurini/waronsaas-protocol/tools/tokenomics-sim/sim.ts:794), [0007:1169–1191](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1169).

**Verified:** Historical evidence is output-based, but monetary calibration uses early live ACU and rates. The illustrative simulation instead hardcodes four ACU/point and averages checkpoints 1, 13 and 52—not epochs 1–12. SQL deduplicates the supplied key, not overlapping work under different keys.

**Exploit inference:** Genesis beneficiaries influence the small calibration population, inflate its usage/size ratio, or map overlapping historical work to different retro units. The cap limits loss but does not make the valuation independent.

**Smallest fix:** Freeze an independently reviewed calibration population/rule and canonical work mapping; exclude beneficiaries and related parties from calibration influence. Compute the stated twelve-epoch statistic and specify the fallback when evidence is insufficient.

---

**MEDIUM M17 — Retention promises conflict with storage, and pseudonyms do not provide anonymity**

**Where:** [USAGE-PROOF.md:60–64](/Users/adventurini/waronsaas-protocol/docs/protocol/USAGE-PROOF.md:60), [PROTOCOL.md:181–185](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:181), [0007:655–662](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:655), [1306–1317](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1306).

**Verified:** Full structured log bodies are stored in an append-only table, contradicting deletion down to summaries after 365 days.

**Risk inference:** Public GitHub work, wallet transfers, timestamps and organization attribution make identity and work-pattern correlation straightforward. Wallet-binding disclosure comes too late if receipts/allocations were already published. Pseudonymization does not automatically remove data-protection obligations. [ICO guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/)

**Smallest fix:** Keep immutable commitments separate from expiring log content. Give disclosure before contribution/publication, define access and retention by field, and add privacy and organization-beneficiary responsibilities to the existing legal checkpoint. This is an unresolved design/legal scope issue, not a conclusion that the protocol is unlawful.

---

**LOW L18 — Per-receipt rounding can reward splitting**

**Where:** [engine.ts:40–62](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:40), [239–247](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:239).

**Verified by execution:** Splitting two base units over weights A=2, B=1, C=1 gives A one unit. Splitting A into lexically earlier A1=1 and A2=1 gives A two units. Total conservation remains correct.

**Smallest fix:** Round the account/beneficiary entitlement first, then apportion its fixed total across receipt explanation lines. Alternatively, explicitly accept the bounded micro-unit effect while preventing artificial receipt splitting.

---

The following are concrete SQL reproductions for a disposable database. Except where stated otherwise, they use the existing assertion fixtures and run as the migration owner/control-plane test actor. **Predicted outcomes are unexecuted.** No example requires disabling a trigger.

**A. Skip every epoch window.** Expected: FINALIZED immediately. This exercises H6. [0007:384–399](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:384)

```sql
BEGIN;
INSERT INTO wos.epochs
  (epoch_number, mode, cluster, starts_at, ends_at,
   risk_review_hours, challenge_hours, policy_versions)
VALUES
  (99001, 'test', 'devnet', now(), now() + interval '7 days',
   48, 48, '{}');

INSERT INTO wos.epoch_transitions
  (epoch_number, from_state, to_state, actor)
VALUES (99001, NULL, 'FINALIZED', 'system');

SELECT wos.epoch_state(99001); -- predicted: FINALIZED
ROLLBACK;
```

**B. Ratify a quorum without verdicts.** Expected: accepted. A PROVISIONAL receipt could subsequently use such a quorum for its status transition. [0007:528–530](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:528), [740–756](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:740)

```sql
INSERT INTO wos.payout_audit_quorums
  (receipt_id, size, review_policy_version, outcome)
VALUES
  ('00000000-0000-0000-0000-0000000cc001',
   2, 'review-policy.v1', 'ratified');
```

**C. Allocate Bob’s receipt to Alice twice, without requiring inclusion.** Fixture epoch 1 is CALCULATING. Expected: both rows accepted. [0007:859–893](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:859)

```sql
INSERT INTO wos.allocations
  (id, epoch_number, account_id, receipt_id, slice,
   weight_micro, amount_base, explanation, explanation_sha256)
SELECT gen_random_uuid(), 1,
       '00000000-0000-0000-0000-00000000000a'::uuid,
       '00000000-0000-0000-0000-0000000cc001'::uuid,
       s, 3000000, 300000000, '{}',
       'sha256:' || repeat('a', 64)
FROM unnest(ARRAY['execution', 'planning']) AS s;
```

**D. Bind one wallet to two accounts under contributor RLS.** Expected: both accepted. Signatures below are database-test placeholders; two accounts controlled by the same wallet owner can also supply genuine signatures. [0007:1108–1128](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1108), [1381–1384](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1381)

```sql
BEGIN;
SET LOCAL ROLE wos_app;
SELECT set_config('wos.actor_kind', 'contributor', true);

SELECT set_config(
  'wos.actor_id', '00000000-0000-0000-0000-00000000000a', true);
INSERT INTO wos.wallet_bindings
  (account_id, cluster, wallet, kind, action, message, signature)
VALUES
  (wos.actor_id(), 'devnet', repeat('2', 32), 'external', 'bind',
   wos.actor_id()::text || ' ' || repeat('2', 32), 'test-signature-a');

SELECT set_config(
  'wos.actor_id', '00000000-0000-0000-0000-00000000000b', true);
INSERT INTO wos.wallet_bindings
  (account_id, cluster, wallet, kind, action, message, signature)
VALUES
  (wos.actor_id(), 'devnet', repeat('2', 32), 'external', 'bind',
   wos.actor_id()::text || ' ' || repeat('2', 32), 'test-signature-b');
ROLLBACK;
```

**E. Join an already-resolved allocation for zero stake and settle its excess again.** The assertion fixtures already resolved `a1002` and paid its first dispute. The first two writes are permitted for Bob in contributor context; the final write represents erroneous privileged settlement processing. Expected: all pass. [db-assertions.sql:571–596](/Users/adventurini/waronsaas-protocol/packages/db/test/db-assertions.sql:571), [0007:1008–1087](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1008)

```sql
INSERT INTO wos.allocation_disputes
  (id, epoch_number, disputer_account_id, stake_base, body)
VALUES
  ('00000000-0000-0000-0000-0000000d2002', 3,
   '00000000-0000-0000-0000-00000000000b', 0, '{}');

INSERT INTO wos.dispute_items
  (dispute_id, allocation_id, reason, evidence)
VALUES
  ('00000000-0000-0000-0000-0000000d2002',
   '00000000-0000-0000-0000-0000000a1002', 'other', '[]');

INSERT INTO wos.dispute_settlements
  (dispute_id, total_excess_base, bounty_base,
   stake_forfeited_base, settled_in_epoch)
VALUES
  ('00000000-0000-0000-0000-0000000d2002',
   300000000, 60000000, 0, 3);
```

The item insert also has no epoch-state/deadline check: opening the header during the window and executing its item insert after finalization is another admissible sequence.

**F. Apply an ordinary policy change to published epoch 3.** Fixture epoch 2 remains OPEN; epoch 3 is PROPOSED. Expected: accepted because 3>2 and the announcement is backdated. [0007:127–149](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:127)

```sql
INSERT INTO wos.policy_activations
  (kind, version, effective_epoch, announced_at,
   preview_sha256, admin_action_id)
SELECT 'reward', 'reward-policy.v2', 3,
       starts_at - interval '73 hours',
       'sha256:' || repeat('4', 64),
       '00000000-0000-0000-0000-0000000aa001'::uuid
FROM wos.epochs WHERE epoch_number = 3;
```

**G. Record a pause expiring a year from now.** Expected: accepted. [0007:1247–1259](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1247)

```sql
INSERT INTO wos.settlement_adapter_events
  (action, adapter, trigger_kind, admin_action_id,
   created_at, expires_at)
VALUES
  ('pause', 'paused_accrual', 'security_incident',
   '00000000-0000-0000-0000-0000000aa001',
   now() + interval '1 year',
   now() + interval '1 year 13 days');
```

Two additional observations matter:

- `check_dispute_item` uses schema-qualified objects and a fixed `search_path`; I found no search-path injection there. Its defect is missing state, stake and serialization checks. Its side effects roll back if the outer insert fails RLS. [0007:1008–1032](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1008)
- Receipt UPDATE/DELETE/TRUNCATE protection and the partial unique manifest-inclusion index are useful and should remain. The failures concern admission, relationships and concurrent publication, not a need to replace append-only storage. [0007:18–23](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:18), [834–835](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:834)

The Astra-01 resolution claims resolve as follows:

| Astra-01 item | Status | Assessment |
|---|---|---|
| **1. Evidence matrix / fail closed** | **partially** | Matrix, four levels and empty mainnet eligibility are correct. Parser failures and receipt qualification do not yet enforce that model end to end. [USAGE-PROOF.md:30–43](/Users/adventurini/waronsaas-protocol/docs/protocol/USAGE-PROOF.md:30); H7/M15. |
| **2. Bootstrap / bound human approval** | **partially** | Merge authority is correctly separated from qualification in the design. Ratification insertion, subject binding and independence bypasses remain. [HUMAN-REVIEW.md:31–45](/Users/adventurini/waronsaas-protocol/docs/protocol/HUMAN-REVIEW.md:31); H7/H8. |
| **3. Pinned maximum, never ultra** | **resolved** | The design explicitly defines the permitted maximum, records observed effort and requires unsupported settings to block. Provider evidence limitations remain under item 6. [HUMAN-REVIEW.md:7](/Users/adventurini/waronsaas-protocol/docs/protocol/HUMAN-REVIEW.md:7), [USAGE-PROOF.md:75](/Users/adventurini/waronsaas-protocol/docs/protocol/USAGE-PROOF.md:75). |
| **4. Conserved funding equation** | **not** | The equation is stated, but executable counterexamples break funding or admit negative balances. H1; [engine.ts:186–210](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:186). |
| **5. Waste incentives / human reward** | **partially** | Fixed human weights and a separate slice are correct. The recovery model overstates deterrence and ignores exit. [REWARD-PROTOCOL.md:92](/Users/adventurini/waronsaas-protocol/docs/protocol/REWARD-PROTOCOL.md:92); H4. |
| **6. Usage accounting / caps** | **partially** | Exclusive categories, event IDs and pinned rates are specified. Malformed handling, real fixtures, subagent detection and the bare-log rule remain unresolved. [USAGE-PROOF.md:45–54](/Users/adventurini/waronsaas-protocol/docs/protocol/USAGE-PROOF.md:45); M15. |
| **7. Generation / lifetime / submission fencing** | **partially** | Locked generation assignment is present. `max_lifetime_at` is nullable, and matching an old lease’s generation does not prove valid submission before expiry or replacement. [0007:157–187](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:157), [464–465](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:464). |
| **8. Admission / snapshots / exactly once / settlement** | **partially** | Useful immutable records exist, but lifecycle, allocation membership, wallet uniqueness, transfer retries and migration remain unsafe. H2/H3/H6/H9. |
| **9. Genesis separate historical category** | **partially** | Separate cap, evidence, approvals and vesting are specified correctly. Calibration and canonical overlap deduplication remain manipulable. [GENESIS-POLICY.md:11–35](/Users/adventurini/waronsaas-protocol/docs/protocol/GENESIS-POLICY.md:11); M16. |
| **10. Completion definitions / acceptance events** | **partially** | Versioned definitions and acceptance events are explicit. Application payouts disagree with policy; scope/funding and terminal pool transitions remain incomplete. [REWARD-PROTOCOL.md:88–93](/Users/adventurini/waronsaas-protocol/docs/protocol/REWARD-PROTOCOL.md:88); H13. |
| **Keep and simplify** | **resolved** | Versioned records, off-chain evaluation, external wallets and deferred custom distribution are appropriate. Fix their invariants without introducing a policy language or custom chain program. [SOLANA-ARCHITECTURE.md:3](/Users/adventurini/waronsaas-protocol/docs/protocol/SOLANA-ARCHITECTURE.md:3), [55–64](/Users/adventurini/waronsaas-protocol/docs/protocol/SOLANA-ARCHITECTURE.md:55). |
| **Supersession table** | **resolved** | The dedicated document identifies superseded rules and the activation boundary. [SUPERSESSION.md:1](/Users/adventurini/waronsaas-protocol/docs/protocol/SUPERSESSION.md:1). |

Explicit answers to the ten packet questions:

1. **Fabrication economics: no, expected gain is not established as approximately zero.** Exit defeats future offsets; evidence consistency cannot authenticate consumption; collusion undermines independent-detection assumptions. The simulation explicitly assumes full recovery. [sim.ts:344–353](/Users/adventurini/waronsaas-protocol/tools/tokenomics-sim/sim.ts:344)

2. **Conservation: broken on returns; insufficient on replay and negative balances.** Ordinary integer splitting and empty-epoch returns are worth retaining. Per-receipt rounding is steerable at base-unit scale. H1/H13/L18. [engine.ts:194–376](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:194)

3. **Rate ceiling: timing games remain.** Realized rate is `min(slice/weight, ceiling)`: moving acceptance from a congested epoch to a quiet one can increase reward despite ceiling decay. Flooding dilutes others and influences accrual attribution. Prefer independently accepted size/output for value-bearing rewards, with usage retained as evidence/cost telemetry; size inflation remains a separate attack. [engine.ts:230–257](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/engine.ts:230), [PROTOCOL.md:91](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:91)

4. **Optimistic verification: no fixed minimum colluding group guarantees safety.** Once code passes review, inflated usage benefits from ordinary audit nondetection and silence. The current dispute system permits low-cost retaliation, first-bounty preemption and mixed valid/frivolous bundles. Forty-eight hours also requires actual available independent auditors, not just theoretical duty supply. [HUMAN-REVIEW.md:60–65](/Users/adventurini/waronsaas-protocol/docs/protocol/HUMAN-REVIEW.md:60), [PROTOCOL.md:103–108](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:103)

5. **Database enforcement: incomplete.** Receipt mutation guards and manifest uniqueness hold as written; qualification, initialization, publication races, allocations, wallet uniqueness, independent seats, normal policy activation and pause expiry do not provide the claimed guarantees. The SQL examples above target those failures. [0007:1300–1396](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1300)

6. **Canaries: not indistinguishable.** The database explicitly publishes the classification, and packet/public-record correlation remains possible even after hiding it. Passing a plausibility canary cannot establish provider execution. H11. [0007:1334](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1334)

7. **Bootstrap/Genesis: the intended isolation is sensible but not enforced sufficiently.** Pre-ratified quorum insertion bypasses ratification evidence; test/mainnet combinations are permitted; Genesis approval and work-overlap protections are not expressed as binding database relationships. Historical output evidence is legitimate, but its live-usage calibration is not independent. [0007:344](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:344), [1169–1191](/Users/adventurini/waronsaas-protocol/packages/db/migrations/0007_proof_of_contribution.sql:1169)

8. **Solana: retain the minimal mint choice; reject the current retry-safety claim.** Metadata-only Token-2022 and no confiscation authorities fit the stated requirements. M1 bounds supply, but unlocked, unspent tokens accumulate under multisig custody: scheduled escrow release does not enforce subsequent protocol spending. No compatible audited escrow/distributor deployment has been established here. New-mint migration needs no old mint authority, but needs the drain/cutoff protocol in H3. [TOKEN-AUTHORITIES.md:9–15](/Users/adventurini/waronsaas-protocol/docs/protocol/TOKEN-AUTHORITIES.md:9), [32–40](/Users/adventurini/waronsaas-protocol/docs/protocol/TOKEN-AUTHORITIES.md:32)

9. **Governance: capture remains possible, including the executed cap counterexample.** A remaining-duration lock can be created immediately before a predictable snapshot; it proves future illiquidity, not past commitment. Excluding unclaimed allocations from the **token** denominator is correct because they cannot be locked; their contribution weight should remain governed separately. Beneficial ownership and organization voting must be defined consistently. [governance.ts:122–123](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/governance.ts:122), [GOVERNANCE.md:14–16](/Users/adventurini/waronsaas-protocol/docs/protocol/GOVERNANCE.md:14)

10. **Privacy/legal: the draft needs a defined publication and beneficiary-responsibility model.** Linkable wallets and work histories remain potentially personal data. Organization payment requires decisions about authorization, attribution, reporting and employee/contractor responsibility. U.S. tax guidance treats digital assets received for services according to the underlying service relationship; a token label does not answer that question. Add these issues to the existing checkpoint rather than creating a parallel approval process. [PROTOCOL.md:181–185](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:181), [MAINNET-READINESS.md:24](/Users/adventurini/waronsaas-protocol/docs/protocol/MAINNET-READINESS.md:24), [IRS guidance](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions)

The founder decisions missing from, or insufficiently specified by, ADR F1–F13 are:

- **Who bears unrecoverable losses?** Define treatment of fraud followed by exit, duplicate transfers, signer theft and disputed-but-uncollectible excess. Decide whether bounties are funded only from actually recovered amounts. [REWARD-PROTOCOL.md:77–99](/Users/adventurini/waronsaas-protocol/docs/protocol/REWARD-PROTOCOL.md:77)
- **What does the governance cap promise?** Choose uncapped versus final effective denominators, organization representation and beneficial-owner aggregation; decide whether locks require seasoning. [governance.ts:279–304](/Users/adventurini/waronsaas-protocol/packages/contracts/src/protocol/governance.ts:279)
- **Who owns obligations when an organization receives payment?** Specify consent, split changes, offset liability, voting ownership and authorized wallet controllers. [PROTOCOL.md:185](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:185)
- **What dispute burden is acceptable?** Decide per-item forfeiture, related-party bounty rules, minimum-stake treatment for small earners, appeals and compensation for erroneous withholding. [PROTOCOL.md:103–108](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:103)
- **What happens when audit capacity is unavailable?** Define claim release and deadline behavior without penalizing contributors for missing independent auditors. [HUMAN-REVIEW.md:61–63](/Users/adventurini/waronsaas-protocol/docs/protocol/HUMAN-REVIEW.md:61)
- **How much accumulated multisig custody is acceptable under M1?** Revoked mint authority does not remove control over unlocked reserve tokens. Also resolve automatic resumption after a pause when the incident remains unsafe. [TOKEN-AUTHORITIES.md:32](/Users/adventurini/waronsaas-protocol/docs/protocol/TOKEN-AUTHORITIES.md:32), [OFF-RAMP.md:20](/Users/adventurini/waronsaas-protocol/docs/protocol/OFF-RAMP.md:20)
- **Who controls publication and retention?** Establish the responsible entity, disclosure timing, redaction/retention rules and handling of organization-linked personal data. [PROTOCOL.md:181](/Users/adventurini/waronsaas-protocol/docs/protocol/PROTOCOL.md:181), [USAGE-PROOF.md:63](/Users/adventurini/waronsaas-protocol/docs/protocol/USAGE-PROOF.md:63)
- **What independently fixes Genesis calibration?** Specify eligible reference contributors, exclusions for beneficiaries, and the fallback if twelve epochs do not supply sufficient trustworthy evidence. [GENESIS-POLICY.md:20–30](/Users/adventurini/waronsaas-protocol/docs/protocol/GENESIS-POLICY.md:20)

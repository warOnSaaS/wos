# HUMAN-REVIEW (DRAFT v2) — review policy, human reviewers, audits

Contracts: `ReviewPolicy` (`policies.ts`, data `review-policy.v1.json`), `HumanReview`, `HumanReviewContext`, `ReviewerQualification`, `ReviewEvalCase`, `PayoutAuditPacket`/`Verdict`, `PayoutCanary` (`entities.ts`). DB: `human_reviews`, `reviewer_qualification_events`, `review_eval_cases`, `payout_audit_*`, `payout_canaries` (0007). Decisions: A4, D23–D27, D32, D38. Changes to `docs/architecture/REVIEW-PROTOCOL.md` are listed in section 8.

## 1. What must pass before a merge (V1)

`deterministic verification (CI) ∧ Astra PASS (max permitted) ∧ Fable PASS (max permitted) ∧ the humans the risk class requires`, with every reviewer independent of the author and of each other, and bound to the same head sha and submission hash. "Max permitted" is the pinned AgentPolicy maximum: `max` for both (Astra's `ultra` is forbidden because it delegates outside the manifest); unsupported settings block the run rather than downgrade (Astra-01 item 3).

## 2. The ReviewPolicy engine

A versioned record, evaluated deterministically:

1. **Classify.** Risk classes have a priority and a matcher (`anyPathGlobs`, `contributionTypes`, `labels`). The first match in priority order wins; `low_risk` matches only when **every** changed path matches its globs; otherwise the default `standard`.
2. **Require.** The class's rule gives: deterministic verification (always), agent reviews by capability (`REVIEW_A`, `REVIEW_B` at `max`), humans (`count`, allowed `domains`, `distinctDomains`, `minLevel`), and an `adminQuorum`.
3. **Check independence.** Humans never review their own or a related account's work, never hold an agent seat of the same round (checked in BOTH insertion orders: `check_human_review` and `check_review_related`, under one per-round lock), at most 10 reviews of the same author per 7 days. **Related accounts** (H8) = same account, members of the same team organization (any role), or anyone ever sponsored by the same organization (ended links included). The check runs as a privileged function, so rows hidden by RLS (sealed verdicts, other organizations' memberships) still count.
4. **Scope.** A human's latest qualification must include the review's risk class (H8); qualification changes are append-only events bound to an `authorize_reviewer` / `revoke_reviewer` AdminAction on that account.
5. **Binding.** A pre-merge approval names a round that belongs to the reviewed subject and matches its head sha and submission hash (H8).

V1 values:

| Class | Matches | Humans | Notes |
|---|---|---|---|
| protocol | contracts, migrations, rewards, docs/protocol, Genesis | 1 (level ≥ 1) | Genesis additionally needs 2 independent humans (GenesisAllocationPolicy) |
| accounting | ledger/invoice/payment modules, label `accounting` | 1 | |
| security | auth, crypto, permissions paths, SECURITY contributions | 1 | |
| low_risk | docs, markdown, tests, copy only | **0** (D23) | Astra and Fable must both pass |
| standard | everything else | 1 | |

The engine already expresses future rules without code changes, e.g. `security: humans {count: 2, domains: [security], minLevel: 2}`, `accounting: humans {count: 2, distinctDomains: 2}`, `protocol: humans {count: 2}, adminQuorum: 1`. Relaxing a class (fewer humans) requires measured outcomes (section 6) and is a structural governance change.

## 3. HumanReviewContext

Built by the context engine and hashed (`humanReviewContextSha256`); the review is bound to that hash. Contents: the subject, risk class and reasons, the task contract and Feature Contract excerpts, architecture refs, invariants, the diff (head, base, submission hash, compare URL), CI results, **Astra's and Fable's verdicts side by side with their findings**, affected interfaces, and a risk-class checklist. The reviewer answers each checklist item (yes/no/n.a. + note), writes a rationale (≥ 40 characters), and records findings; the verdict must be PASS iff there is no material finding (schema refinement). A human approval is bound to (head sha, submission sha256, context sha256, review-policy version); any new revision voids it.

## 4. Reviewer qualification and admin management

- An admin (maintainer) grants, suspends, restores or revokes a qualification: domains (`general, frontend, backend, mobile, security, accounting, protocol, data, infra, docs`), a simple level (1 standard, 2 elevated classes, 3 protocol/accounting), the contribution types and risk classes they may review. Each change is an append-only `reviewer_qualification_events` row tied to an AdminAction with a reason.
- **V1: the founder authorizes human reviewers** (F11). The founder may act as the human reviewer of *other* contributors' work (independent, qualifies normally, D23).
- Admin UI (Desktop Build app and web admin): reviewer list with domains/levels, grant/revoke with reason, suspension, the **batch human-review queue** (D23 speed): subjects sorted by SLA (72 h), each showing the context with both AI findings side by side, one-key PASS/FAIL with the checklist.
- A human review is itself a contribution (HUMAN_REVIEW) with a fixed ACU-equivalent weight, accepted when the subject merges (PASS) or a material finding is upheld (FAIL); never rewarded for clicking approve on something later reverted (the award becomes an offset/revocation).

## 5. Bootstrap (D23) — replaces REVIEW-PROTOCOL §9 for qualification

- **Merge authority vs qualification.** In bootstrap mode the founder may approve and merge anything, including their own work (AdminAction `bootstrap_merge`, public label "Merged under founder bootstrap authority: provisional until its challenge window after bootstrap closes (D54)"). Self-review never satisfies a rule.
- **Founder's own work → PROVISIONAL receipt**: recorded, public, counted only in devnet **test epochs**, not Genesis-qualifying until final. **D54 (supersedes the ratification queue):** when bootstrap ends (3 outside contributors with an accepted receipt, provisional F31) every PROVISIONAL receipt is published with a challenge window (the payout window, 48 h) and every participant is notified — ONE persisted, server-stamped publication row after bootstrap ended, bound to the receipt hash, its window pinned (review 06 R06-2); **silence finalizes it** as FINAL_BY_SILENCE (its own evidence class, never an independent ratification; qualifying, Genesis-eligible, original timestamp); a free challenge inside the window sends that receipt to the normal review gate (evidence, right of reply, one decision: RATIFIED or rejected). Challenge, finalization and live admission are serialized on the receipt's subject lock. No recruited reviewer pool, no ratification queue; nothing waits on an independent human before bootstrap ends (rule `provisionalReceiptOutcome`).
- **Fable unavailable (D53).** While the ReviewPolicy fallback `fable_unavailable` is active, the Fable seat is replaced by this required human review (the founder or an authorized reviewer): the round needs Astra + the human. No model reviews work built by the same model (Opus never reviews Opus-built work). Every round and receipt reviewed this way carries `single_lab_review` with the reason and counts for devnet/shadow accounting only; a later Fable pass is optional and never blocks.
- **Other contributors' work** reviewed by the founder as the human is independent and ACTIVE.
- **Sunset:** the existing one-way automatic exit (≥ 3 distinct non-maintainer contributors per slot active within 14 days) or `end_bootstrap`; afterwards the founder is an ordinary maintainer.
- **Test mode:** while the founder is alone, test epochs allocate devnet WOS explicitly marked non-Genesis — a full rehearsal.

## 6. Eval data and reputation data (collect, don't score yet)

- Every disagreement is a permanent `review_eval_cases` row: `agents_pass_human_fail`, `agents_fail_human_pass`, `agents_split`, `post_merge_defect_missed_by_all`, `ratifiers_split`, with the context hash and, when known, the outcome (`human_upheld`, `agents_upheld`, `both_wrong`).
- Per reviewer (human and agent), the data needed for a future reputation algorithm is recorded, not computed: reviews by domain and class, verdicts, findings raised/upheld/overruled, later reverts of passed subjects, escalations, dispute outcomes, canary outcomes, time to verdict. No score is shown in V1.
- Human review for a class is reduced only when these measured outcomes support it (e.g. zero `agents_pass_human_fail` cases in N reviews of that class), via a structural governance change.

## 7. Audits, payout audits, duty and canaries (D24–D27, D32)

All agent compute runs on contributors' own subscriptions; wOS runs no model (D24).

| Mechanism | What it checks | Who | Rate / trigger |
|---|---|---|---|
| **Review audit** | re-review of a merged subject's pre-merge verdicts | a random third contributor (not author, not original reviewer, not related) on their own subscription | 10% of rounds; 30% for accounts with < 10 receipts; 50% for flagged accounts. A material disagreement upheld by a ruling revokes the original reviewer's receipts (append-only) and raises an AbuseSignal. Audits are rewarded (AUDIT_RERUN). |
| **Payout audit** | since D49: attribution, declared splits, the frozen budget record against its acceptance, duplicate or stacked units, budget outliers vs peers — not token usage (v3, Astra-03 H6: the server writes a private ASSIGNMENT per seat — quorum, slot, packet hash, reviewer, task, lease generation, permitted provider — and checks independence, outside-feature and provider diversity there; a verdict redeems its own assignment once, with a signed run of the assigned lease whose recorded provider is the permitted one, while the lease is still valid; a run is used once; related accounts never share a quorum; quorums and verdicts are PRIVATE until revealed, only real outcomes are published — H8, H11) — never code, never arithmetic | a quorum of 2 random auditors from outside the feature (+ one optional own-feature seat that counts as signal only), provider-diverse, sealed until all submit | 5% sampled every epoch; every disputed allocation; every PROVISIONAL ratification |
| **Duty** | supplies payout audits | the claimant's client, automatically, at claim time | owed only when offered, ≤ 3 per claim, effort `high`; append-only offer → completion / no-fault expiry events (M14); when no eligible audit can be offered by the deadline the claim releases on schedule flagged `unaudited` (D42) |
| **Payout canaries** | a BEHAVIOURAL check of the auditor's client — never an attestation that a model ran (H11); a catch needs the matching judgment AND the planted reason | model-free perturbations of real lines (D49: a budget changed from its frozen record, an unmet acceptance, a split stacked under one objective, duplicated attribution, wrong split), magnitude ≥ 1.5× | 5% of audit tasks (15% new, 25% flagged). Approving one: duty credit lost, unfinalized receipts of the auditor revoked, `payout_canary_passed` |

Verdict substance: every line judged with cited evidence (run-log turn, diff path, baseline, contract) and a rationale; for dispute gates one `focusAnswers` entry per concern. A bare "all plausible" is schema-invalid. An auditor whose "plausible" is contradicted by an upheld finding loses that duty credit; an upheld inflation finding earns no bonus weight in V1 (0, F27: nothing is paid above a reserved quote); inflation claims overruled three times in 30 days raise `false_inflation_findings`.

## 8. Changes to REVIEW-PROTOCOL.md (to apply at implementation)

1. §9 bootstrap: replace "awards … held until independent re-review" with section 5 above; `bootstrap_self` and `bootstrap_maintainer` rounds never produce a qualifying receipt.
2. §1: "maximum reasoning" is defined as the pinned AgentPolicy maximum; record requested and observed effort.
3. New: human review per ReviewPolicy, bound as in section 3; low_risk classes may have 0 humans.
4. New: related accounts (organizations) join the independence rules (DB `check_review_related`).
5. §10 rewards: replaced by REWARD-PROTOCOL v4 (D49: every commissioned review — agent or human — is paid its task budget).
6. New: review audits, payout audits, duty and canaries (section 7).

# REVIEW-PROTOCOL

Independent Astra + Fable review rounds for roadmaps, feature contracts and implementations. Part of the wOS constitution.

| Source of truth | What it fixes |
|---|---|
| `packages/contracts/src/state-machines.ts` | `RoundMachine`, `DocumentMachine`, `AttemptMachine`, `TaskMachine` |
| `packages/contracts/src/agent-io.ts` | `ReviewVerdict`, `AuthorSummary`, `BuildSummary`, `Ruling`, `ReviewIndependence` |
| `packages/contracts/src/data/agent-policy.v1.json` | reviewer roles, `independence`, `materialFindingRules`, `limits`, `bootstrap` |
| `packages/contracts/src/api.ts` | `claimReview`, `submitVerdict`, `submitRuling`, `confirmRuling` |
| `packages/db/migrations/0001_init.sql` | `rounds`, `reviews`, `findings`, `finding_responses`, `rulings`, triggers `reviews_independence`, RLS `sealed_until_revealed` |

## 1. The rule

Every canonical document revision and every implementation candidate is reviewed by two agents on two different contributors' machines (D2):

| Slot | Model | Provider | Reasoning |
|---|---|---|---|
| `astra` | `gpt-6-astra` | `codex` CLI, `-c model_reasoning_effort="max"` | `max` (`ultra` is forbidden: it delegates to sub-agents outside the context manifest) |
| `fable` | `claude-fable-5-1` | `claude` CLI, `--effort max` | `max` |

Both try to prove the subject incomplete or wrong. Neither sees the other's current verdict. The subject passes only when both return `NO_MATERIAL_GAPS` on the same head sha and the same submission (diff) hash, in the same round.

Model identity is an attestation, not a proof (D1; SECURITY.md). Publicly a review is labelled "Astra MAX (attested)" / "Fable MAX (attested)".

## 2. Round lifecycle

A round (`rounds` row) belongs to exactly one subject: a document (`roadmap`, `feature_contract`) or an attempt (`implementation`). It pins `head_sha` and `submission_sha256`. One open round per subject (`rounds_one_open_document`, `rounds_one_open_attempt`).

| From | Event | To | Actor | Effect |
|---|---|---|---|---|
| (none) | opened | `awaiting_reviews` | system | On `validation_passed` (documents) or `ci_passed` (attempts). Creates two review tasks (`roadmap_review` / `feature_review` / `implementation_review`), one per slot (`tasks_one_review_per_slot`), `excluded_account_ids` = subject authors. Event `document.round_opened`. |
| `awaiting_reviews` | `second_verdict_sealed` | `revealed` | system | Both slots have a stored verdict. Outcome and independence label computed; both verdicts become visible atomically. |
| `awaiting_reviews` | `cancel` | `cancelled` | system, maintainer | Subject abandoned or superseded; open review tasks cancelled, leases revoked. |

A new revision can only be submitted after the round is revealed (authors have no task while the round is open), so a round's head never changes under reviewers.

## 3. Assignment

Reviewers do not choose subjects. `POST /v1/reviews/claim {deviceId, slot, kinds}` (or `wos review --slot astra|fable`):

1. The caller must be eligible for the slot's role: GitHub account age >= 90 days, at least 1 accepted contribution, a current attestation for the slot's provider with the slot's model, fewer than 2 active review leases.
2. Candidate tasks: open review tasks of the requested kinds and slot where the caller is not in `excluded_account_ids` (authors of any accepted revision of the subject; for implementations, the builder), is not the account holding or having sealed the other slot of the same round, and has reviewed the same author fewer than 5 times in the trailing 7 days (`maxReviewsOfSameAuthorPer7d`).
3. Pick the oldest `created_at`; ties broken by a uniformly random choice. Returns `null` when none.
4. Claim transaction: task `open -> leased`, lease (TTL 30 min, heartbeat 60 s, hard deadline 180 min), `ContextPlan` for the reviewer role.

Timeouts: if the reviewer's lease expires or is released, the task goes back to `open` and is re-offered to the next eligible reviewer; the round keeps waiting. A reviewer who let a lease expire is excluded from that task (added to `excluded_account_ids`).

## 4. What reviewers receive

Built by the context engine (CONTEXT-PROTOCOL.md), identical artifact set for both slots:

- the subject at the round's head: document files, or the candidate diff plus the ABU spec, contract, profiles and acceptance checks;
- the role's `obligations` and `materialFindingRules`, verbatim from the policy;
- prior rounds' revealed findings with the author's responses (`mayViewPriorRounds`), so fixes can be checked;
- for roadmaps: the catalog, the previous merged roadmap version, the inventory sources list; for contracts: every impacted app's roadmap ref and profile (FEATURE-CONTRACT.md section 5).

Never included: the other slot's verdict for the current round (`mayViewOtherSlotCurrentRound: false`, excluded with reason `other_slot_current_round`), reviewer identities of the current round.

Reviewers run read-only: claude with `--restricted --safe-mode --tools Read,Grep,Glob --permission-mode dontAsk`; codex with `--sandbox read-only --ignore-user-config --ignore-rules -c project_doc_max_bytes=0`. Repository text is data, not instructions; text that tries to instruct a reviewer is itself a material security finding.

## 5. Verdict

The agent's final output must validate as `review-verdict.v1` (passed as `--json-schema` / `--output-schema`):

| Field | Rule |
|---|---|
| `verdict` | `NO_MATERIAL_GAPS` iff no `material` finding and no prior finding `still_open`; otherwise `MATERIAL_GAPS` (schema refinement) |
| `summary` | up to 4000 chars |
| `findings[]` | up to 50; `localId` `f1..`, `severity` `material` or `minor`, `category`, `title`, `detail`, `evidence[]` (path, lines, quote), `suggestedResolution` |
| `priorFindings[]` | every still-open prior finding id with `resolved` or `still_open` |

Material vs minor: material = matches a rule in the role's `materialFindingRules` or would make the subject wrong, incomplete, unsafe or unbuildable. Minor findings are shown publicly but never block and never earn rewards.

Submission: `POST /v1/leases/:id/verdict` with `{verdict, headSha, submissionSha256, agentRunId}`. The server checks the lease, that `headSha` and `submissionSha256` equal the round's (the DB trigger `reviews_independence` enforces it again, plus reviewer is not the author unless labelled `bootstrap_self`), stores the review (append-only), inserts `findings` rows (state `open`), completes task and lease. Response `{sealed: true}`. Idempotent by `Idempotency-Key`.

Sealing: until the round is revealed, RLS lets only the reviewer and privileged actors read the review and its findings. The API never returns sealed verdicts to anyone else.

## 6. Reveal and outcome

When the second verdict is stored, in the same transaction:

1. Round `-> revealed`, `revealed_at`, `independence` = the weakest of the two reviews' labels.
2. Prior findings: each `priorFindings` entry adds a `finding_responses` row (`resolved` / `still_open`, source `reviewer`). A prior finding becomes `resolved` only when every reviewer who re-checked it says resolved; otherwise it stays `open` (or `disputed`).
3. Outcome = `planning.computeRoundOutcome(astra, fable, priorOpenFindingIds, overruledFindingIds)`: `consensus` iff both verdicts are `NO_MATERIAL_GAPS` and no open material finding remains (overruled findings excluded); else `gaps`.
4. Drive the subject: documents `round_consensus` / `round_gaps` / `round_limit_reached`; attempts `round_passed_and_qualified` (after QUALIFY) / `round_gaps`.
5. The App posts one PR review comment (event COMMENT, never APPROVE) on the document PR, or stores it for the implementation PR body: both verdicts, the findings, models, reasoning, reviewer handles, independence label.
6. Event `round.revealed`.

## 7. Finding lifecycle

| State | Meaning | Set by |
|---|---|---|
| `open` | raised, not yet answered or answered but not verified | reviewer verdict |
| `disputed` | the author answered `disputed` in `AuthorSummary.responses` / `BuildSummary.responses` | author submission (`dispute_rounds += 1`) |
| `resolved` | reviewers confirmed the fix in a later round | reveal |
| `upheld` | resolver ruled material, maintainer confirmed | ruling confirmation |
| `overruled` | resolver ruled not material, maintainer confirmed; excluded from gating from then on | ruling confirmation |

Every author submission must answer every open material finding with `fixed` or `disputed` and a note; missing answers are a validation error. A finding disputed in 2 consecutive rounds (`disputeEscalationRounds`) escalates the subject.

## 8. Escalation and rulings

Triggered by round limits (roadmap 6, contract 5 rounds; implementations: 3 repairs, then the attempt fails instead of escalating) or repeated disputes.

1. A `conflict_resolution` task opens (role `conflict_resolver`: Fable, `max`, read-only; eligibility: 3 accepted contributions; excludes authors and both reviewers of the disputed rounds).
2. The resolver receives the subject, the disputed findings, both sides' arguments; not the reviewers' identities. It submits `ruling.v1` (`POST /v1/leases/:id/ruling`): per finding `upheld` or `overruled` with a rationale of at least 20 chars.
3. The ruling is `awaiting_maintainer`. A maintainer confirms or rejects with a public note (`POST /v1/admin/rulings/:id/confirm`). Rejected: a new resolver task opens.
4. Confirmed: findings take the ruled states; document `ruling_upheld -> revising` or `ruling_all_overruled -> validating` (fresh round on the same head with overruled findings closed). Event `finding.ruled`.

What stops infinite rounds: fixed round limits, dispute escalation, and a human final say. A maintainer may also abandon the workflow with a public reason.

## 9. Bootstrap mode (D2)

At launch the founder is contributor zero. `platform_settings.bootstrap_mode.enabled = true` until it ends.

| Rule | Detail |
|---|---|
| Who may review | Anyone eligible as normal. If a review task has been open 24 h (`selfReviewAfterHours`) with no eligible independent claimant, a maintainer may claim it, even as the author. |
| Labels | `independent` (neither reviewer is the author), `bootstrap_maintainer` (a maintainer who is not the author reviewed), `bootstrap_self` (the author reviewed). Stored on each review and the round; shown on every page and PR as "Bootstrap review: not yet independently cross-reviewed" for `bootstrap_self`. |
| Rewards | Awards for work whose acceptance relied on a `bootstrap_self` review stay `held` until an independent re-review passes (REWARD-PROTOCOL.md). |
| Distinct slots | The two slots of a round are different accounts, enforced by the trigger `check_review_independence`. The only exception: one account may hold both slots when BOTH reviews are `bootstrap_self` (a solo founder in bootstrap; Astra still runs on Codex and Fable on Claude), labelled publicly. See GAPS.md G-02. |
| Exit | Automatic when, for each slot, at least 3 distinct non-maintainer contributors hold a valid attestation and completed a lease in the last 14 days; or a maintainer `end_bootstrap` with a reason. One-way; event `platform.bootstrap_ended`. |
| After exit | Every merged subject with a `bootstrap_self` round gets an independent re-review task (an ordinary round on the merged head). Pass: held awards become releasable and the label becomes `independent`. Fail: findings become new work (a contract revision or a fix ABU); held awards for the failed work are voided. |

## 10. Rewards for reviewers

Flat reward per completed review of an accepted subject plus a bonus per material finding later upheld or fixed; nothing for findings that were overruled. Details and the rubber-stamp risk in REWARD-PROTOCOL.md.

## 11. Rulings at the Wave 2a gate (contracts 4.2.0, B-0002-planning)

- `computeRoundOutcome.priorOpenFindingIds` contains MATERIAL findings only. A minor finding never blocks consensus. The control plane's query filters `severity = 'material'` (this was a real bug: minor findings blocked consensus forever; fixed at the gate).
- Overruled findings: consensus is reached iff neither verdict has a new material finding and no non-overruled prior material finding is still open. A prior material finding counts as open if it is in `priorOpenFindingIds` or a verdict marks it `still_open`. A reviewer holding an overruled finding open cannot block, because the maintainer-confirmed ruling is final.

## D53 — Fable unavailable (protocol draft)

While the ReviewPolicy fallback `fable_unavailable` is active a round has two independent checks: **Astra** (agent, a different lab from the Opus builder) and the **required human review** (the founder or an authorized reviewer), which replaces the Fable slot; the consensus rule reads "both NO_MATERIAL_GAPS" over those two. A Fable verdict submitted while the fallback is active is refused as a seat (a later optional pass is recorded, never counted, never blocking). A reviewer whose model built the subject is refused (no same-model self-review). Each such round and its receipts carry `single_lab_review` with the reason (devnet/shadow accounting only). Conflicts go to the human instead of the Fable resolver. Policy: docs/protocol/POLICIES.md §5 `fallbacks`; decision D53.

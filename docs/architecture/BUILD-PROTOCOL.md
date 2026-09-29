# BUILD-PROTOCOL

LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR, for one Atomic Build Unit, with gated PRs (D9). Part of the wOS constitution.

| Source of truth | What it fixes |
|---|---|
| `packages/contracts/src/state-machines.ts` | `TaskMachine`, `LeaseMachine`, `AbuMachine`, `AttemptMachine`, `RoundMachine` |
| `packages/contracts/src/agent-io.ts` | `ContextPlan`, `ContextManifest`, `Changeset`, `ChangesetErrorCode`, `AgentRunRecord`, `ProvenanceRecord`, `COMMIT_TRAILERS` |
| `packages/contracts/src/api.ts` | `claimBuild`, `heartbeat`, `releaseLease`, `postManifest`, `postAgentRun`, `setAttemptPhase`, `submitChangeset`, `getAttempt`, `claimTask` |
| `packages/contracts/src/orchestrator.ts` | the `Orchestrator` interface used by both CLI and Desktop |
| `packages/github/src/index.ts` | branch names, status contexts, commit author and trailers |
| `packages/verification/src/index.ts` | `scopesOverlap`, `validateChangeset` |
| `packages/db/migrations/0001_init.sql` | `attempts`, `leases`, `tasks`, `resource_locks`, `changesets`, `candidate_commits`, `verification_runs`, `pull_requests`, `provenance_records` |

Principle: contributors never push and never open PRs. Their machine produces a signed submission; the control plane validates it; the wOS GitHub App turns it into commits and, only after qualification, into a PR (D9).

## 1. Actors and places

| Actor | Runs where | Can do |
|---|---|---|
| Builder | contributor's machine (Desktop main process or CLI), their own Claude subscription | claim, build, verify locally, submit, revise, abandon |
| Reviewers (Astra, Fable) | two other contributors' machines | review a candidate head (REVIEW-PROTOCOL.md) |
| Control plane | Vercel `waronsaas-api`, Postgres | every guarded transition, validation, qualification |
| wOS GitHub App | via the control plane | commits (Git Data API), branches, PRs, statuses, merge queue |
| GitHub Actions `wos-verify` | GitHub runners, no secrets | trusted deterministic verification |

## 2. Attempt state machine

One `attempts` row per builder try at one ABU. At most one live attempt per ABU (`attempts_one_live_per_abu`).

| From | Event | To | Actor | Guard / effect |
|---|---|---|---|---|
| (none) | claim | `leased` | contributor | `POST /v1/abus/:id/claim` (section 3). ABU `ready -> in_progress`. |
| `leased` | `start_build` | `building` | contributor | `POST /v1/leases/:id/manifest`: manifest accepted (section 4). |
| `building` | `start_verify` | `verifying` | contributor | `POST /v1/attempts/:id/phase {phase: verifying}` after `postAgentRun`. |
| `verifying` | `verify_failed_locally` | `building` | contributor | `phase: building, localRepair: true`; `local_repair_count < 3` (`maxLocalRepairLoops`) else 409 `LIMIT_REACHED`. |
| `verifying` | `submit_changeset` | `submitted` | contributor | `POST /v1/leases/:id/changeset`; server validation passes (section 6); lease `-> completed`. |
| `submitted` | `candidate_committed` | `candidate_pushed` | system | App commit created on `wos/candidate/<attemptId>` (section 7). |
| `candidate_pushed` | `ci_passed` | `in_review` | github | `wos-verify` check suite concluded `success` for exactly the head sha; a round opens with one Astra and one Fable `implementation_review` task. |
| `candidate_pushed` | `ci_failed` | `changes_requested` | github | conclusion failure or timed_out; `repair_count < 3`. |
| `in_review` | `round_gaps` | `changes_requested` | system | round revealed with open material findings; `repair_count < 3`. |
| `in_review` | `round_passed_and_qualified` | `qualified` | system | qualification (section 9) passes. |
| `changes_requested` | `resume_for_revision` | `building` | contributor | the attempt's builder claims the `abu_revision` task (new lease); `repair_count += 1`; base may move (section 10). |
| `qualified` | `pr_opened` | `pr_open` | system | App opened the PR from the official branch and set `wos/qualified` = success. |
| `pr_open` | `merge_blocked` | `changes_requested` | github | merge queue ejected the PR (conflict or failing combined CI); `repair_count < 3`; PR stays open. |
| `pr_open` | `pr_merged` | `merged` | github | PR merged into the default branch. |
| `pr_open` | `pr_closed` | `closed_unmerged` | github | PR closed without merge. |
| `leased`, `building`, `verifying` | `lease_lapsed` | `expired` | system | the active lease expired or was revoked. |
| `changes_requested` | `lease_lapsed` | `expired` | system | 48 h (`revisionWindowHours`) elapsed with no revision claim (`revision_deadline_at`). |
| `leased`, `building`, `verifying`, `changes_requested`, `pr_open` | `abandon` | `abandoned` | contributor | the builder releases; an open PR is closed by the App. |
| any live state or `pr_open` | `fail` | `failed` | system, maintainer | system: `repair_count` reached 3 and another repair was needed, or a security rule was hit; maintainer: public reason. |
| any live state or `pr_open` | `supersede` | `superseded` | system | the ABU was superseded by a new contract version. |

Terminal: `merged`, `expired`, `abandoned`, `failed`, `closed_unmerged`, `superseded`. When an attempt ends without merge: resource locks are released, the ABU goes `in_progress -> ready` and `failed_attempts += 1`; at 3 (`maxFailedAttemptsPerAbu`) it goes `needs_decomposition` instead, which requires a new contract version.

No transition reaches `pr_open` except from `qualified` (a test enforces this).

## 3. LEASE

`POST /v1/abus/:id/claim` with `Idempotency-Key`, body `{deviceId}`. One transaction:

1. Auth: `contributor` (email account with linked GitHub, not suspended; else 403 `GITHUB_REQUIRED`).
2. `pg_advisory_xact_lock(hashtext('wos.locks:' || repo_full_name))` for the ABU's repo. All lock acquisition for a repo is serialised; contention is low (claims only).
3. ABU `state = ready` and its `abu_build` task `open` (else 409 `CONFLICT`).
4. Eligibility (`agent-policy.checkEligibility` for role `builder`): GitHub account age >= 90 days, a current `claude_cli` attestation for the device with Opus available, fewer than 2 active build leases (`maxConcurrentBuildLeasesPerContributor`; else `LIMIT_REACHED`). Failure: 403 `NOT_ELIGIBLE` with reasons.
5. Resource locks. Required set = one `path:<prefix>` exclusive lock per write scope (prefix = scope without `/**`, `path_is_tree` = it had `/**`) plus every declared `ResourceClaim`. Conflict if any live lock in the repo (`released_at is null`):
   - is a path lock whose prefix overlaps a required path (same prefix, or one is a tree containing the other: `scopesOverlap`), or
   - has the same resource key and either side is exclusive.
   Any conflict: 409 `RESOURCE_LOCKED` naming the holder ABU. The partial unique index `resource_locks_exclusive_key` is a backstop for identical exclusive keys.
6. Pin the base: `base_sha` = current head of the default branch (read via the App). Immutable for the attempt until a rebase (section 10).
7. Insert `attempts` (`leased`, `github_user_id` snapshot), `resource_locks` (held by the attempt, not the lease, so they survive the review wait), `leases` (`active`, `expires_at = now + 30 min`, `hard_deadline_at = now + 480 min`, `context_plan`), task `open -> leased`, ABU `ready -> in_progress`, events.
8. Response: task, lease, `ContextPlan`, attempt.

Concurrency: two builders claiming ABUs of the same feature succeed simultaneously when their scopes and resources are disjoint (the build graph validator guarantees this for ABUs without a dependency path; the lock check guarantees it at run time, including across features and apps sharing the repo). Two builders claiming the same ABU: one wins, the other gets 409.

Heartbeats: `POST /v1/leases/:id/heartbeat` every 60 s from the same device; extends `expires_at` to `min(now + 30 min, hard_deadline_at)`. The sweeper (`GET /v1/cron/sweep`, every minute) expires active leases with `expires_at <= now` (checked again inside the UPDATE) and applies `lease_lapsed` to the attempt.

## 4. BUILD

On the builder's machine, all through `@waronsaas/orchestrator` (CLI and Desktop call the same code):

1. **Worktree**: a bare mirror at `<workspaceRoot>/repos/<owner>/<name>.git` (created once, fetched each time), then a detached worktree at `base_sha` (`github/local.createWorktree`). One worktree per lease; removed on terminal states.
2. **Context**: `context-engine.buildContext(plan, reader, policy)` produces the prompt and the `ContextManifest` (CONTEXT-PROTOCOL.md). `POST /v1/leases/:id/manifest`; the server checks it against the plan (role, model, reasoning, source commit, budget, required artifacts; blob oids verified via the Trees API) and stores it in `context_manifests`. Rejection: 422 `MANIFEST_REJECTED`; attempt stays `leased`.
3. **Launch**: `agent-policy.buildInvocation` gives the exact argv: `claude -p --model claude-opus-5-5 --effort <level> --output-format stream-json --verbose --restricted --safe-mode --strict-mcp-config --no-session-persistence --session-id <uuid> --tools Read,Grep,Glob,Edit,Write,Bash --permission-prompts none --permission-mode acceptEdits --allowedTools <Bash(...) rules for the plan's allowedCommands> --json-schema <build-summary.v1>`, prompt on stdin, cwd = the worktree. Effort is at least `high` (builder policy floor).
4. **Record**: `POST /v1/leases/:id/agent-runs` with the signed `AgentRunRecord` (CLI version, auth method, requested and reported model, reasoning, argv hash, transcript hash, output hash, exit code). This is an attestation, not proof (SECURITY.md).

## 5. VERIFY (local, untrusted)

1. `wos.json` `install` (for npm: `npm ci --ignore-scripts`), then every `verify` step, then every ABU `acceptance.checks` command, each with its timeout.
2. Capture changes with `github/local.captureChanges`: diff against `base_sha`, read bytes with `lstat`; symlinks, submodules, special files and paths outside the worktree are reported as rejected and never followed.
3. Run `verification.validateChangeset` locally with the same inputs the server uses; fail fast before upload.
4. On failure the orchestrator may loop back to BUILD (`verify_failed_locally`, max 3). The repair run uses the same plan plus the `local_document` artifact `local:verification-output` (the failing checks' output, sha256 recorded), so it posts a NEW manifest for the same lease before running (`postManifest` accepts several per lease); the submission cites the manifest of the run that produced it (contracts 2.0.0, B-0004-github-build).

Local results are recorded in the changeset's `localVerification` (id, exit code, duration, output hash). They are never trusted alone (D2); CI re-runs everything.

## 6. Submissions

`POST /v1/leases/:id/changeset` with a `Changeset`:

- `parentCommit`: always the plan's `source.commit` — `base_sha` for the first submission, the current candidate head for a revision, the new default-branch head after a rebase;
- `files`: upserts (mode `100644` or `100755`, base64 content, sha256, bytes) and deletes; max 500 files, total at most `wos.json` `maxChangesetBytes` (<= 4,000,000, the API body limit);
- `manifestSha256`: the accepted manifest of the run that produced it;
- `submissionSha256`: the diff hash, computed ONLY with `submissionSha256()` from `@waronsaas/contracts/canonical` (rule C-3: JCS `{parentCommit, files}` sorted by path; upserts `{path, op, mode, sha256}`, deletes `{path, op}` with no other keys);
- `summary`: `build-summary.v1` (or `author-summary.v1` for documents);
- `signature`: computed ONLY with `signChangeset()` (rules C-4/C-5): Ed25519 by the device key over JCS of the zod-parsed changeset without `signature`, each upsert's `contentBase64` replaced by its sha256; base64 of 64 bytes. The device public key is base64 of its raw 32 bytes.
- Toolchain paths (`wos.json` `toolchainPaths`, at least `DEFAULT_TOOLCHAIN_PATHS`) may change only when the ABU holds the exclusive resource `toolchain:<path>`; otherwise `TOOLCHAIN_WITHOUT_RESOURCE`.

Server validation (`verification.validateChangeset` plus server-only checks). Any error: 422 with `ChangesetValidation`, nothing is committed, the attempt stays `verifying`, the lease stays active.

| Code | Rejected when |
|---|---|
| `PATH_INVALID` | path fails `RepoPath` |
| `OUT_OF_SCOPE` | a written or deleted path is not inside an ABU write scope (or document paths) |
| `PROTECTED_PATH` | inside `wos.json` `protectedPaths` (always includes `.github/**` and `wos.json`) |
| `WORKFLOW_FILE` | any `.github/workflows/**` path (the App also lacks the `workflows` permission) |
| `GENERATED_PATH` | inside `generatedPaths` |
| `LOCKFILE_WITHOUT_RESOURCE` | a lockfile changed without a `lockfile:<path>` claim |
| `MIGRATION_WITHOUT_RESOURCE` | a file under `migrationsDir` without `db:migrations` |
| `SYMLINK_OR_SPECIAL_FILE` | reported by capture; symlinks (120000) and submodules (160000) cannot be expressed in the schema |
| `CASE_COLLISION` | two paths equal ignoring case, or equal to an existing path ignoring case |
| `HASH_MISMATCH` | a file's sha256 or byte count does not match its content |
| `SUBMISSION_HASH_MISMATCH` | recomputed diff hash differs |
| `MANIFEST_MISMATCH` | `manifestSha256` is not the accepted manifest of this lease |
| `SIGNATURE_INVALID` | signature does not verify with the device's key |
| `PARENT_MISMATCH` | `parentCommit` is not the expected base or candidate head |
| `TOO_LARGE` | over the byte or file limit |
| `SECRET_DETECTED` | content matches the secret patterns in SECURITY.md |
| `DELETE_MISSING_FILE` | delete of a path absent at the parent |
| `EMPTY_DIFF` | nothing changes |

On success, in one transaction: insert `changesets` (file manifest without content, validation, `ok = true`, summary), lease `-> completed`, task `leased -> submitted`, attempt `verifying -> submitted`. Idempotency: same `Idempotency-Key` + same body replays the stored response.

## 7. Candidate commit (App)

Right after the transaction (and retried by the dispatcher if it fails):

1. Create blobs, a tree (`base_tree` = parent tree; deletions as null-sha entries) and a commit via the Git Data API. No git binary, no contributor push.
2. Commit author: `waronsaas-wos[bot]`. Message: ABU key and title, then trailers:
   ```
   wOS-Task: <task id>
   wOS-Attempt: <attempt id>
   wOS-Abu: <abu key>
   wOS-Manifest: sha256:...
   wOS-Contributor: <handle>
   Co-authored-by: <login> <githubUserId+login@users.noreply.github.com>
   ```
3. Create or fast-forward `refs/heads/wos/candidate/<attemptId>` (expected head check). Candidate refs are App-only by ruleset, never a PR, and deleted after the PR opens.
4. Insert `candidate_commits`; `attempts.head_sha`, `candidate_branch`; task `-> completed`; attempt `-> candidate_pushed`.
5. If GitHub fails after retries: task `submitted -> open` is NOT used for builds; the attempt stays `submitted` and the dispatcher retries until success or a maintainer fails the attempt.

## 8. CI (trusted verification)

Workflow `wos-verify` in the product repo (owned by the verification workstream):

- Triggers: `push` to `wos/candidate/**`, `pull_request`, `merge_group`, `push` to the default branch (for profile acceptance suites).
- `permissions: contents: read`; the repo has no Actions secrets; the workflow file itself can never be changed by a submission.
- Trusted verification (contracts 2.0.0, B-0005-verification, SECURITY.md S-33): the job checks out the candidate, then restores EVERY `toolchainPaths` file from the base commit (the merge base with the default branch) and reads the install and verify steps from the base's `wos.json`. So a candidate cannot redefine `npm test`, a test config or a lockfile for the required check.
- Steps: base `wos.json` install and verify steps; the ABU's acceptance checks (ABU found via the `wOS-Abu` trailer, spec read from `BUILD-GRAPH.yaml` at the base); `verification.validateChangeset` re-run against the base (scope check in CI).
- A second job, `wos-verify-candidate-toolchain`, runs only when the candidate changes a toolchain path, uses the candidate's own files and is NOT a required check; its result is shown to reviewers and to the maintainer whose CODEOWNERS approval such a PR needs before merge.
- Result reaches the control plane via the `check_suite` webhook and is stored in `verification_runs` (source `ci`). Only a result for exactly `attempts.head_sha` moves the attempt.

## 9. REVIEW and QUALIFY

REVIEW: see REVIEW-PROTOCOL.md. The round is bound to the candidate head sha and the submission hash.

QUALIFY runs inside the transaction that reveals a passing round. All must hold; each check and its evidence id is stored and rendered in the PR body:

| # | Check (D9) | Evidence |
|---|---|---|
| 1 | The attempt's build lease was valid and held by this account when the submission was accepted | `leases` row, `changesets.lease_id` |
| 2 | The account has a linked GitHub identity and is active | `accounts.github_user_id`, `attempts.github_user_id` |
| 3 | The submission's parent is the attempt's base (or the previous candidate head) | `changesets.parent_sha`, `attempts.base_sha` |
| 4 | Diff hash reviewed = diff hash submitted = the candidate head's changes | `rounds.submission_sha256`, `reviews.submission_sha256`, `changesets.submission_sha256` |
| 5 | Only allowed paths touched; no workflows, protected, generated, symlinks; lockfiles and migrations only with resources | `changesets.validation.ok` plus the CI scope check |
| 6 | The context manifest matches the one issued for the lease | `context_manifests`, check result stored at `postManifest` |
| 7 | Model and effort attested per Agent Policy for builder and both reviewers | `agent_runs` records, signature valid |
| 8 | Astra review and Fable review both `NO_MATERIAL_GAPS`, by two accounts other than the builder, bound to the same head and diff hash | `reviews` rows (DB trigger enforces binding and independence) |
| 9 | `wos-verify` succeeded on the head sha | `verification_runs` (ci, success, head sha) |

Pass: attempt `-> qualified`, then the App:

1. creates `wos/<abu-key with '#' -> '-'>-<first 8 hex of attempt id>` (e.g. `wos/contacts-04-0192ab3c`) pointing at the exact reviewed candidate commit;
2. opens the PR (author: the App) with title `<abu key>: <title>`, body = objective, qualification table, reviews summary, provenance record hash; labels `wos:implementation`, `feature:<key>`;
3. sets commit status `wos/qualified` = success on the head (only the App can set it; the ruleset pins the source);
4. writes `pull_requests` and `provenance_records` (`ProvenanceRecord`, JCS sha256), deletes the candidate ref, attempt `-> pr_open`, event `attempt.pr_opened`;
5. if the diff touches a toolchain path, requests review from `@waronsaas/maintainers` (CODEOWNERS makes that approval required before merge);
6. enables auto-merge / adds to the merge queue (who may merge is a FOUNDER DECISION, see GAPS.md; the recommended default is App auto-merge for implementation PRs once qualified and CI green).

Any failed check: the attempt fails with the check named (`fail`, system) if the failure indicates tampering (checks 1-7), or goes `changes_requested` if it is a reviewable defect.

## 10. Revisions and rebase

- `changes_requested` sets `revision_deadline_at = now + 48 h` and opens one `abu_revision` task restricted to the builder (`restricted_to_account_id`). Open findings and CI output are in its context.
- The builder claims it (`POST /v1/tasks/:id/claim`, or automatically by the orchestrator), gets a new lease, `repair_count += 1`, attempt `-> building`. Locks were held throughout.
- Rebase: if the default branch moved and the candidate no longer applies cleanly (or after `merge_blocked`), the revision's plan sets a new `base_sha` = current default-branch head; the worktree is recreated there; the submission's `parentCommit` is the new base and the App builds a fresh candidate commit on the same candidate branch (force-moved by the App only).
- Every revision re-runs CI and a fresh review round on the new head.
- After 3 repairs, the next need for repair fails the attempt.
- For a revision after `merge_blocked` (PR already open), the App moves the official branch to the new qualified head instead of opening a second PR; the attempt passes through `qualified -> pr_open` again (`pr_opened` means "opened or updated").

## 11. MERGE and after

The only way to main is the merge queue (ruleset: nobody pushes to the default branch; required checks `wos/qualified` (App source) and `wos-verify`, which also runs on `merge_group` so the combined state of simultaneous PRs is tested).

On `pull_request.closed` with `merged = true` (webhook, deduplicated by delivery id), one transaction:

1. `pull_requests.state = merged`; attempt `-> merged`; ABU `in_progress -> merged`; release its resource locks.
2. Dependents: for each ABU depending on it whose dependencies are now all merged: `pending_dependencies -> ready` and its `abu_build` task `blocked -> open` (the `task_unlocker` consumer does this idempotently).
3. Contribution rows: implementation for the builder, review for each reviewer (REWARD-PROTOCOL.md), then ledger awards via the `rewards` consumer.
4. Events `attempt.merged`, `abu.state_changed`; the `progress` consumer recomputes every app whose profile the ABU is relevant to.

## 12. Logical conflicts beyond paths

| Conflict | Rule |
|---|---|
| Migrations | Files under `migrationsDir` are named by ABU key, not by a sequence number: `<abu key with '#' -> '_'>__<description>.sql`, so two ABUs never race for the same number. Writing them needs `db:migrations` exclusive, so migrations are also serialised. |
| Lockfiles | Need `lockfile:<path>` exclusive; dependency additions are ABUs of their own in the graph. |
| Shared schema, tables, routes, events | Declared as `db:table:<name>`, `api:route:<METHOD> <path>`, `event:<name>` resources; exclusive to change, shared to consume. |
| Cross-feature conflicts in the same repo | Locks are per repo, so they apply across features and apps. |
| Anything undeclared | The merge queue's combined CI is the last line; an ejected PR goes `merge_blocked -> changes_requested`. Repeated ejections are evidence for a resource the graph failed to declare (feed to the conflict resolver / contract revision). |

## 13. Failure summary

| Failure | Result |
|---|---|
| Builder's machine dies | Lease expires in <= 30 min; attempt `expired`; locks released; ABU `ready`. |
| Builder goes silent during changes_requested | 48 h; attempt `expired`. |
| Two claims for overlapping ABUs | Second gets `RESOURCE_LOCKED`. |
| Submission out of scope | 422, nothing committed, fix locally. |
| Modified client submits a forged changeset | Signature, hashes, scope re-check in CI and two independent reviews; tampering fails the attempt. |
| CI flake | Maintainer may re-run the check suite; only the final conclusion for the head sha counts. |
| Reviews never arrive | Review task leases expire and are re-offered (REVIEW-PROTOCOL.md). The attempt waits; no deadline in V1 beyond the ABU staying `in_progress` (see GAPS.md). |
| PR closed by a human | `closed_unmerged`; ABU back to `ready`. |

## 14. V1 dogfood note

The V1 build of wOS itself runs a manual version of this protocol: the Lead Architect's contracts are the frozen build graph; each implementation agent is a builder in its own git worktree with owned paths as its write scope (WORKSTREAMS.md); integration waves play the merge queue; ARCHITECTURE_BLOCKER files play the conflict resolver. Anything that makes that build hard is evidence for a missing wOS capability.

# wOS domain model

Status: frozen at contracts 1.0.0. Owner: Lead Architect. Ground truth:
`packages/contracts/src/state-machines.ts` (machines), `packages/contracts/src/domain.ts` (read models),
`packages/db/migrations/0001_init.sql` (tables) and `0002_backstops.sql` (contracts 2.0.0: review binding, one-way bootstrap flag via trigger `bootstrap_one_way`, private events visible only to privileged actors and the account concerned, raw Ed25519 device keys). The transition tables below are generated from the
code and must be regenerated if it changes.

## 1. Vocabulary

| Term | Meaning |
|---|---|
| Target (application) | A rented product we replace, e.g. Salesforce. One row in `wos.targets`. The spec uses "Sniper Target" and "application" for the same thing; wOS has one entity. TGT-00 is warOnSaaS itself (rank 0). |
| Replacement product | The ONE modular suite in `waronsaas/product` (D14). A target's roadmap `productName` names how we present the replacement for that target (e.g. on its website page); there is no per-target codebase or store listing. |
| Inventory | The enumerated public surface of the target (`roadmaps/<target>/INVENTORY.yaml`). Completeness evidence reviewers check the roadmap against. Items weigh 1 and do not drive progress. |
| Roadmap | Per target, versioned. Lists ALL capabilities with reasoned weights (D12); mapped capabilities list catalog features with reasoned weights. |
| Capability | A grouping inside one app's roadmap, e.g. `crm` for Salesforce. Keys are per app. |
| Catalog feature | A global, app-independent feature (D10), e.g. `contacts`. One Feature Contract, one Build Graph, built once. |
| App feature | The tracked record of one catalog feature for one app (D11): its capability, weight, app notes and derived state. |
| Feature Contract | Canonical requirements of a catalog feature plus one requirement profile per app. |
| Requirement profile | The requirement ids one app needs from a contract (D10). |
| Build Graph / ABU | The contract's Atomic Build Units, each sized for one Opus builder. |
| Task | Any unit of leasable work (8 kinds). |
| Lease | Time-bounded exclusive right of one account + device to work one task. |
| Attempt | One contributor's run at one ABU, from lease to merge or failure. |
| Document | A canonical workflow for a roadmap version (per target) or a contract version (per catalog feature). |
| Round | One Astra verdict + one Fable verdict, sealed, on one head sha and submission hash. |
| Finding | One issue raised in a verdict; carried across rounds until resolved or ruled. |
| Contribution | Accepted useful output that earns tokens. |
| Ledger entry | One append-only movement of WOS tokens. |

## 2. Entities (tables in schema `wos`)

Legend: M = mutable aggregate with `row_version`; A = append-only (triggers reject UPDATE/DELETE/TRUNCATE
for every role, and `wos_app` has only SELECT, INSERT); P = private (RLS restricts rows, SECURITY.md S-9).

### Identity (D8)

| Table | Kind | Purpose and invariants |
|---|---|---|
| `accounts` | M | One per person, created on first verified email. `github_user_id` unique; GitHub fields are all set or all null (`accounts_github_consistent`). `handle` (unique case-insensitive) is set from the GitHub login on first link and never changes. `status` active/suspended; suspension requires a reason. `canContribute` in the API = GitHub linked and active. |
| `account_emails` | P | One email per account, `email_normalized` unique (lower, trimmed). Private: own row or privileged. |
| `account_roles` | | `maintainer` role. V1: the founder. |
| `github_identity_history` | A | Every link/unlink. An `unlinked` row carries `reserved_until` = unlink + 90 days: nobody else may link that GitHub id before then. Also used by independence checks across relinks. |
| `email_signin_requests` | P | One per sign-in attempt. Hashes only (link token, code, poll secret, IP). `attempts` 0..5, `expires_at` <= created + 15 min. Single use: redeemed by one guarded UPDATE `where redeemed_at is null and expires_at > now() and attempts < 5`. System actor only. |
| `github_link_requests` | P | Pending GitHub device/web authorisations; outcome `linked`, `denied`, `expired`, `refused` (`GITHUB_LINKED_ELSEWHERE` / `GITHUB_RESERVED`). |
| `devices` | P | Desktop/CLI installs with their Ed25519 public key (unique). Used to verify signed agent runs and changesets. Revocable. |
| `sessions` | P | Opaque access (1 h) + refresh (30 d) token hashes, grouped by `family_id`. Refresh rotates; presenting a rotated refresh token revokes the family. System actor only. |
| `provider_attestations` | A, P | What `wos status` found: CLI installed, version, signed in, auth method, models. Latest row per (account, provider) is current. An attestation, not proof. |
| `platform_settings` | | `bootstrap_mode`, `active_reward_schedule`, `active_policy`, `product_repo`. |

### Targets, roadmaps, catalog

| Table | Kind | Purpose and invariants |
|---|---|---|
| `targets` | M | Seeded: `waronsaas` rank 0 (platform repo `waronsaas/wos`), then the ten targets rank 1..10, whose parity profiles are served by the one suite in `waronsaas/product` (D14; `product_path` dropped in 0005). `hosted_url` https only; `self_hostable` set by maintainer action `set_hosting`. |
| `follows` | | Account follows a target (non-contributor feature, GAPS G-27). |
| `documents` | M | Canonical workflows. `kind = roadmap` has `target_id` and no feature; `kind = feature_contract` has `catalog_feature_id` and no target. `(target, version)` and `(catalog_feature, version)` unique. At most one open (not merged/abandoned) per subject: `documents_one_open_roadmap`, `documents_one_open_contract`. `merged` iff `merged_sha` set; `abandoned` requires `ended_reason`. |
| `inventory_versions` | | Per target, versioned; `proposed -> frozen -> superseded`; at most one frozen per target (`inventory_one_frozen`). Frozen when the roadmap version that carries it merges. |
| `inventory_items` | A | Items of one inventory version, weight fixed at 1. |
| `capabilities` | M | One app's capabilities as of its latest merged roadmap version: `weight_bp` 1..10000 with `weight_rationale` >= 40 characters (D12), `mapped`, `roadmap_version`, `retired`. Older versions live in git history and progress snapshots. |
| `catalog_features` | M | Global catalog (D10). `key` unique forever. `aliased` iff `alias_of` set. `created_by_document_id` = the roadmap document that proposed it. `current_contract_document_id` = latest merged contract. |
| `app_features` | M | One per (target, catalog feature), materialised when the app's roadmap version merges (D11). Holds the app's capability, `weight_bp` + rationale (share of its capability), `app_notes`, `phase`, `first_roadmap_version`, `roadmap_version`, derived `state`. |
| `inventory_dispositions` | | Each item of an inventory version is in exactly one capability or excluded (with reason); once mapped, also in one app feature. |
| `requirements` | | Requirements of a contract version (`R-nnn`, unique per document). |
| `requirement_profiles` | | (contract document, target, requirement): which requirements each app needs (D10). |

### Build graph and work

| Table | Kind | Purpose and invariants |
|---|---|---|
| `abus` | M | ABUs of a contract version: key `<feature>#nn` unique per document, `size_points` in (1,2,3,5,8), `spec` = the merged `AbuSpec` JSON, `est_context_tokens` computed at validation, `failed_attempts`. |
| `abu_dependencies`, `abu_requirements` | | Graph edges (no self edge) and requirement coverage. |
| `tasks` | M | 8 kinds (`TaskKind`). Review kinds carry `reviewer_slot` and `round_id`; build kinds carry `abu_id`; `abu_revision` also carries `attempt_id` and `restricted_to_account_id` (the builder). `excluded_account_ids` = accounts that may never claim. `carry` = validator errors for the next author. One live review task per (round, slot); one live build task per ABU. |
| `leases` | M, P | One active lease per task (`leases_one_active_per_task`). `expires_at <= hard_deadline_at`. `context_plan` = the `ContextPlan` issued with the lease, immutable by convention. Private: holder or privileged. |
| `attempts` | M | One live attempt per ABU (`attempts_one_live_per_abu`). `github_user_id` snapshot at claim (provenance). `base_sha` immutable; `head_sha` = current candidate commit. `repair_count`, `local_repair_count`, `revision_deadline_at` (required in `changes_requested`). |
| `resource_locks` | | Path and logical locks held by a live attempt, per repository (see section 5). |
| `rounds` | M | One per review round of a document or attempt; `(subject, round_number)` unique; at most one open round per subject. Bound to `head_sha` and `submission_sha256`. `revealed` iff `revealed_at`, `outcome` and `independence` set. |
| `proposals`, `blockers` | M | `wos propose` and in-target ARCHITECTURE_BLOCKERs, mirrored to GitHub Issues. |

### Evidence

| Table | Kind | Purpose and invariants |
|---|---|---|
| `context_manifests` | A | Every `ContextManifest` posted, `manifest_sha256` unique. |
| `agent_runs` | A | Every signed `AgentRunRecord`, with `signature_valid` computed by the server. |
| `changesets` | A | Every submission's file manifest (paths, modes, sha256, bytes; never contents), `parent_sha`, `manifest_sha256`, `submission_sha256`, `signature_valid`, validation result, summary. |
| `candidate_commits` | A | Commit the App built from a changeset (one per changeset). |
| `reviews` | A, P | One per (round, slot); distinct accounts per round except two `bootstrap_self` reviews. Trigger `check_review_independence` (rewritten in `0002_backstops.sql`) binds it to the round's head and submission hash, to the review task of that round and slot, to that task's active lease held by the reviewer, and to a manifest of that lease; rejects an author reviewing their own subject unless `bootstrap_self`; accepts `bootstrap_self`/`bootstrap_maintainer` only while bootstrap mode is on and only from a maintainer. Sealed: visible only to its author and privileged actors until the round is revealed. |
| `findings` | M, P | One per verdict finding; state `open, resolved, disputed, upheld, overruled`; `dispute_rounds`. Written only by privileged actors; readable after reveal. |
| `finding_responses` | A | Every author response, reviewer re-check, ruling and maintainer confirmation. |
| `rulings` | M | Conflict Resolver output; `awaiting_maintainer -> confirmed/rejected`. |
| `verification_runs` | A | Local (untrusted) and CI (trusted) results per head sha. |
| `pull_requests` | M | Every official PR; `(repo, number)` unique; `merged` iff `merged_sha`. |
| `provenance_records` | A | One `ProvenanceRecord` per official PR, `record_sha256` unique. |

### Rewards and progress

| Table | Kind | Purpose and invariants |
|---|---|---|
| `contributions` | M | Accepted useful output (REWARD-PROTOCOL.md). `idempotency_key` unique so one unit of work creates one contribution. `target_id` null for shared-feature work (paid once, D10). |
| `reward_pools` | M | Feature completion pool per app feature, application completion pool per target (each unique). |
| `ledger_entries` | A | See REWARD-PROTOCOL.md. Sign rules by CHECK, gapless `entry_no` and sha256 hash chain by trigger. |
| `v_balances`, `v_leaderboard` | views | Derived balances and the opted-in leaderboard. Never stored. |
| `events` | A | Every domain event (`DomainEventBody`), `idempotency_key` unique when given. Also the outbox. |
| `event_consumptions` | A | (event, consumer) processed markers; consumers are idempotent on this PK. |
| `progress_snapshots` | A | Output of `computeAppProgress` per scope (app, capability, feature) with `input_sha256` and the full `AppProgress` JSON in `detail` for app rows. `built <= specified <= mapped` enforced. |
| `v_target_progress` | view | Latest app snapshot per target, zeros when none. |

### Infrastructure

`idempotency_keys` (24 h), `webhook_deliveries` (dedupe by `X-GitHub-Delivery`), `rate_limits`
(fixed windows), `outbound_emails` (recipient stored only as a hash).

## 3. Persistence rule for every transition

In ONE transaction:

1. `set_config('wos.actor_id', ..., true)`, `set_config('wos.actor_kind', ..., true)`.
2. The guarded update:
   `update wos.<table> set state = $to, row_version = row_version + 1, ... where id = $id and state = $from and row_version = $v`.
3. If zero rows: roll back, respond `409 CONFLICT`. The client re-reads.
4. Insert exactly one `wos.events` row for the transition (type per `events.ts`, `contracts_version`).
   Creation is not a transition: inserting an aggregate in an initial state writes `<aggregate>.created`
   (`attempt.created`, `task.created`, `lease.issued`, `document.opened`, ...), never a `state_changed` from
   a pseudo-state "none". Every transition of every machine has an event type since contracts 3.0.0
   (`document.state_changed`, `round.cancelled`, `contribution.state_changed`, `proposal.state_changed`,
   `blocker.state_changed`, `inventory_version.state_changed`; B-0002-control-plane).

Work subjects (contracts 3.0.0): roadmap work belongs to one app (`target`); contract, build and
implementation-review work belongs to one catalog feature and serves every app in `relevantTo`. Views and
plans never pick a representative app. Every document, catalog feature and ABU records its
`repo_full_name` (migration 0003): the product repo, or the platform repo for TGT-00. Catalogs are per
repository: a roadmap may reference only catalog features of its own repository. `reviews.agent_run_id`
binds a verdict to the signed run that produced it (same lease, same manifest, valid signature).
5. Insert or update the rows the transition implies (listed per machine below).

Consumers (`progress`, `rewards`, `task_unlocker`, `github_sync`, `public_feed`) run from
`GET /v1/cron/dispatch` and also inline after commit when cheap. Each consumer processes an event
at most once by inserting `(event_id, consumer)` into `event_consumptions` in the same transaction as
its effects; a unique violation means another run already did it.

GitHub side effects (commit, PR, status, issue) happen AFTER the database transaction that records the
intent, from the `github_sync` consumer, with retries. The row that awaits a GitHub result is in an
intermediate state (`submitted`, `qualified`) until the call succeeds; the next state is entered by the
consumer or by the webhook, never optimistically.

Actor mapping: `contributor` in the tables = an account acting through a `contributor` or `account`
route; `maintainer` = an admin route; `system` = side effects, cron and consumers; `github` = a
verified webhook delivery. Webhook processing sets `wos.actor_kind = 'github'`.

## 4. State machines

Every table below is generated from `state-machines.ts`. States not listed as a `from` are terminal.
Self-loop `heartbeat` on leases is the only transition out of a state into itself.

### 4.1 Task

Created by: roadmap open (author task), round opened (two review tasks), contract workflow opened
(author task), build graph ingested (one `abu_build` per ABU, `blocked` if dependencies pending),
`changes_requested` (one `abu_revision` restricted to the builder), escalation or blocker
(`conflict_resolution`). Persisted per transition: task row, and for `claim` the lease row, the attempt
row (build) and resource locks in the same transaction; for `lease_lost` the lease end.

Initial: `blocked,open`. Terminal: `completed,cancelled`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `blocked` | `dependencies_met` | `open` | system | every prerequisite recorded for the task is satisfied |
| `open` | `claim` | `leased` | contributor | claimant passes Agent Policy eligibility and independence rules; resource locks acquired; no other active lease on the task |
| `leased` | `lease_lost` | `open` | system, contributor | the active lease expired, was released or revoked, and the subject is still live |
| `leased` | `submit` | `submitted` | contributor | caller holds the active lease; payload validates against the task kind's submission schema |
| `submitted` | `accept_output` | `completed` | system | deterministic post-submission checks passed (e.g. candidate commit created, verdict stored) |
| `submitted` | `reject_output` | `open` | system | post-submission checks failed for a reason not attributable to the subject (e.g. GitHub API outage after retries); a new lease may be taken |
| `blocked` | `cancel` | `cancelled` | system, maintainer | subject superseded, abandoned or its round closed |
| `open` | `cancel` | `cancelled` | system, maintainer | subject superseded, abandoned or its round closed |
| `leased` | `cancel` | `cancelled` | system, maintainer | subject superseded or abandoned; the active lease is revoked in the same transaction |

Failure paths: claim fails with `NOT_ELIGIBLE`, `RESOURCE_LOCKED`, `LIMIT_REACHED` or `CONFLICT` and
changes nothing. A lease lost while `leased` returns the task to `open` (build tasks: the attempt goes
to `expired` or `abandoned` and the ABU back to `ready`, so a NEW build task is created and the old one
is cancelled; a task is never reused across attempts).

### 4.2 Lease

TTL, heartbeat interval and hard deadline come from the role's policy (`lease` block). Heartbeat:
`POST /v1/leases/:id/heartbeat` extends `expires_at` to `min(now + ttl, hard_deadline_at)`. The sweeper
(`/v1/cron/sweep`, every minute) expires leases with `expires_at <= now()` using the same guarded
update, so a heartbeat racing the sweeper either wins (lease extended) or loses (409, lease expired).

Initial: `active`. Terminal: `completed,released,expired,revoked`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `active` | `heartbeat` | `active` | contributor | caller is the lease holder on the same device; now < expires_at; extends expires_at to min(now + ttl, hard_deadline) |
| `active` | `complete` | `completed` | system | the task's submission was accepted |
| `active` | `release` | `released` | contributor | caller is the lease holder |
| `active` | `expire` | `expired` | system | now >= expires_at (sweeper) — checked again inside the UPDATE |
| `active` | `revoke` | `revoked` | system, maintainer | task cancelled, contributor suspended, or maintainer action with reason |

A lease is `completed` in the same transaction that accepts its submission. For builds the lease ends
at submission; the attempt then lives without a lease through CI and review, holding its resource
locks.

### 4.3 Document (roadmap and feature contract)

Opened by: maintainer `openRoadmap` (roadmaps), and automatically by the system when a roadmap version
merges and references a catalog feature without an open contract workflow, or whose merged contract
lacks this app's profile (D11). A contract workflow already open for another app is linked instead:
its author task receives the new app's roadmap reference.

Per transition persisted: document row; `revision_submitted` also the changeset and its candidate
commit (App commits to the document branch); `validation_passed` opens a `rounds` row and two review
tasks; `round_gaps` creates a new author task carrying open findings; `round_limit_reached` creates a
`conflict_resolution` task; `pr_merged` ingests the document (section 6).

Initial: `drafting`. Terminal: `merged,abandoned`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `drafting` | `revision_submitted` | `validating` | contributor | caller holds the author task lease; changeset only touches the document's allowed paths |
| `revising` | `revision_submitted` | `validating` | contributor | caller holds the author task lease; changeset only touches the document's allowed paths |
| `validating` | `validation_passed` | `in_review` | system | document parses against its schema; deterministic validators pass (build-graph validator for contracts); candidate commit pushed; new consensus round opened on that head sha |
| `validating` | `validation_failed` | `revising` | system | schema or validator errors; errors attached to a new author task; round counter unchanged |
| `in_review` | `round_gaps` | `revising` | system | round revealed with >=1 open material finding and round_number < policy.maxRounds |
| `in_review` | `round_limit_reached` | `escalated` | system | round revealed with open material findings and round_number >= policy.maxRounds, or a finding disputed in two consecutive rounds |
| `in_review` | `round_consensus` | `consensus` | system | both reviewers (Astra and Fable providers) returned NO_MATERIAL_GAPS on the same head sha in the same round |
| `escalated` | `ruling_upheld` | `revising` | maintainer | every escalated finding has a confirmed ruling (upheld/overruled); at least one upheld |
| `escalated` | `ruling_all_overruled` | `validating` | maintainer | every escalated finding overruled; a fresh round is opened on the unchanged head sha with overruled findings closed |
| `consensus` | `maintainer_reopen` | `revising` | maintainer | maintainer requests changes before merge, with reason (public) |
| `consensus` | `pr_merged` | `merged` | github | PR merged with merge commit whose tree equals the consensus head sha tree |
| `drafting` | `abandon` | `abandoned` | maintainer | reason recorded |
| `validating` | `abandon` | `abandoned` | maintainer | reason recorded |
| `in_review` | `abandon` | `abandoned` | maintainer | reason recorded |
| `revising` | `abandon` | `abandoned` | maintainer | reason recorded |
| `escalated` | `abandon` | `abandoned` | maintainer | reason recorded |
| `consensus` | `abandon` | `abandoned` | maintainer | reason recorded |

Limits (policy `limits`): roadmap 6 rounds, feature contract 5 rounds, escalation when a finding is
disputed in 2 consecutive rounds.

### 4.4 Consensus round

A round is opened with `head_sha` and `submission_sha256` of the subject's current candidate commit
and exactly two review tasks (slots `astra`, `fable`). Verdicts are sealed in `reviews`. When the
second valid verdict is stored, in the same transaction: the round becomes `revealed`, `outcome` =
`computeRoundOutcome`, findings rows are written, and the subject's machine takes its next transition
(`round_gaps`, `round_consensus`, `round_limit_reached`, or for attempts `round_gaps` /
`round_passed_and_qualified`). A review task whose lease is lost goes back to `open` and is reassigned;
the round keeps waiting.

Initial: `awaiting_reviews`. Terminal: `revealed,cancelled`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `awaiting_reviews` | `second_verdict_sealed` | `revealed` | system | a valid verdict from each required provider is stored for this round's head sha; outcome computed; both verdicts become visible atomically |
| `awaiting_reviews` | `cancel` | `cancelled` | system, maintainer | subject abandoned or superseded; open review tasks cancelled |

### 4.5 ABU

Initial: `pending_dependencies,ready`. Terminal: `merged,needs_decomposition,superseded`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `pending_dependencies` | `dependencies_merged` | `ready` | system | every depends_on ABU is merged |
| `ready` | `attempt_started` | `in_progress` | system | an attempt was created by a successful build-task claim in the same transaction |
| `in_progress` | `attempt_ended` | `ready` | system | the attempt reached expired/abandoned/failed/closed_unmerged; failed_attempts < policy.maxFailedAttemptsPerAbu |
| `in_progress` | `flag_for_decomposition` | `needs_decomposition` | system, maintainer | failed_attempts reached policy.maxFailedAttemptsPerAbu, or maintainer decision with reason |
| `ready` | `flag_for_decomposition` | `needs_decomposition` | maintainer | maintainer decision with reason |
| `in_progress` | `attempt_merged` | `merged` | github | the attempt's PR merged into the default branch (an ABU is built once and counts for every app whose profile it covers, D10) |
| `pending_dependencies` | `supersede` | `superseded` | system | a newer contract version of the catalog feature merged and does not carry this ABU over unchanged |
| `ready` | `supersede` | `superseded` | system | a newer contract version of the catalog feature merged and does not carry this ABU over unchanged |
| `in_progress` | `supersede` | `superseded` | system | a newer contract version merged; the active attempt is superseded in the same transaction |

### 4.6 Attempt (LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR)

Per transition persisted: `start_build` stores the manifest; `start_verify` stores the agent run;
`submit_changeset` stores the changeset, completes the lease and the build/revision task;
`candidate_committed` stores `candidate_commits` and sets `head_sha`; `ci_passed` stores the CI
`verification_runs` row and opens a round; `round_passed_and_qualified` stores the qualification
record; `pr_opened` stores `pull_requests` and `provenance_records`; `pr_merged` sets `merged_sha`,
releases locks, moves the ABU to `merged`, and emits `attempt.merged`. Every terminal state releases
the attempt's resource locks in the same transaction and, except `merged`, moves the ABU with
`attempt_ended` (or `flag_for_decomposition` when `failed_attempts` reaches 3).

Initial: `leased`. Terminal: `merged,expired,abandoned,failed,closed_unmerged,superseded`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `leased` | `start_build` | `building` | contributor | caller holds active build lease; context manifest posted and accepted (policy, source commit, artifact oids) |
| `building` | `start_verify` | `verifying` | contributor | caller holds active lease; agent run record posted |
| `verifying` | `verify_failed_locally` | `building` | contributor | local_repair_count < policy.maxLocalRepairLoops (incremented) |
| `verifying` | `submit_changeset` | `submitted` | contributor | caller holds active lease; changeset passes server-side scope validation against the ABU scope at the attempt's base commit; lease completed in same txn |
| `submitted` | `candidate_committed` | `candidate_pushed` | system | GitHub App created commit on wos/candidate/<attemptId> with parent = base commit (or previous candidate head) |
| `candidate_pushed` | `ci_passed` | `in_review` | github | required CI check suite concluded success for exactly the candidate head sha; review round opened with one Astra and one Fable review task |
| `candidate_pushed` | `ci_failed` | `changes_requested` | github | required CI concluded failure/timed_out for the candidate head sha; repair_count < policy.maxRepairRounds |
| `in_review` | `round_gaps` | `changes_requested` | system | implementation round revealed with >=1 open material finding; repair_count < policy.maxRepairRounds |
| `in_review` | `round_passed_and_qualified` | `qualified` | system | both verdicts NO_MATERIAL_GAPS on candidate head sha; CI success on same sha; scope re-validated; reviewer independence satisfied; attestations present |
| `changes_requested` | `resume_for_revision` | `building` | contributor | caller is the attempt's builder; claims the revision task (new lease); repair_count incremented; base may be moved to current default-branch head (rebase) |
| `qualified` | `pr_opened` | `pr_open` | system | GitHub App opened PR from candidate branch; wos/qualified status set on head sha |
| `pr_open` | `merge_blocked` | `changes_requested` | github | merge queue ejected the PR (conflict or failing combined CI) and repair_count < policy.maxRepairRounds; PR stays open |
| `pr_open` | `pr_merged` | `merged` | github | pull_request closed with merged=true on the default branch |
| `pr_open` | `pr_closed` | `closed_unmerged` | github | pull_request closed with merged=false |
| `leased` | `lease_lapsed` | `expired` | system | the attempt's active lease expired or was revoked |
| `building` | `lease_lapsed` | `expired` | system | the attempt's active lease expired or was revoked |
| `verifying` | `lease_lapsed` | `expired` | system | the attempt's active lease expired or was revoked |
| `changes_requested` | `lease_lapsed` | `expired` | system | revision window (policy.revisionWindowHours) elapsed without a revision claim |
| `leased` | `abandon` | `abandoned` | contributor | caller is the attempt's builder; open PR (if any) is closed by the App |
| `building` | `abandon` | `abandoned` | contributor | caller is the attempt's builder; open PR (if any) is closed by the App |
| `verifying` | `abandon` | `abandoned` | contributor | caller is the attempt's builder; open PR (if any) is closed by the App |
| `changes_requested` | `abandon` | `abandoned` | contributor | caller is the attempt's builder; open PR (if any) is closed by the App |
| `pr_open` | `abandon` | `abandoned` | contributor | caller is the attempt's builder; open PR (if any) is closed by the App |
| `leased` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `building` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `verifying` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `submitted` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `candidate_pushed` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `in_review` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `changes_requested` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `qualified` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `pr_open` | `fail` | `failed` | system, maintainer | system: repair_count reached policy.maxRepairRounds, or submission rejected for a security rule; maintainer: reason recorded |
| `leased` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `building` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `verifying` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `submitted` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `candidate_pushed` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `in_review` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `changes_requested` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `qualified` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |
| `pr_open` | `supersede` | `superseded` | system | the ABU was superseded by a newer contract version |

Failure paths in words:

- Local verification fails: `verify_failed_locally` back to `building`, at most `maxLocalRepairLoops`
  (3) times; the fourth failure is reported and the builder must release.
- Scope validation fails at submission: the request returns `422 SCOPE_VIOLATION` with the
  `ChangesetValidation` errors; the attempt stays `verifying`. Security-rule rejections
  (`WORKFLOW_FILE`, `SYMLINK_OR_SPECIAL_FILE`, `SIGNATURE_INVALID`, `SUBMISSION_HASH_MISMATCH`,
  `SECRET_DETECTED`) are logged and repeated ones fail the attempt (`fail`, system).
- CI fails or reviewers find gaps: `changes_requested` with `revision_deadline_at` = now + 48 h;
  after 3 repair rounds the next failure is `fail`.
- The builder does not come back: `lease_lapsed` from `changes_requested` when the revision window
  passes.
- The merge queue ejects the PR (conflict with something merged meanwhile): `merge_blocked`; the
  revision rebases onto the current default-branch head (new `parent` = current head, same attempt).

### 4.7 Catalog feature

Initial: `active`. Terminal: `aliased`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `active` | `alias_merged` | `aliased` | github | a maintainer-approved alias PR merged: catalog/<key>.yaml has aliasOf set and the target feature's contract version that absorbs this feature's requirements and profiles merged in the same PR |

### 4.8 App feature (derived)

App-feature state is written only by the `progress` consumer, never by a request handler.

Initial: `mapped`. Terminal: `descoped`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `mapped` | `contract_workflow_linked` | `specifying` | system | the catalog feature's contract workflow is open (opened or linked when the roadmap merged) and will carry this app's profile |
| `mapped` | `profile_merged` | `specified` | github | a merged contract of the catalog feature contains this app's profile (e.g. contract already existed with the profile) |
| `specifying` | `profile_merged` | `specified` | github | the contract version containing this app's profile merged; build graph ingested |
| `specified` | `first_relevant_abu_started` | `building` | system | an attempt exists for an ABU relevant to this app's profile |
| `specified` | `profile_complete` | `built` | system | all relevant ABUs already merged (built by another app's work) and the profile acceptance suite passed |
| `building` | `profile_complete` | `built` | system | all relevant ABUs merged and the profile acceptance suite passed on the default branch |
| `specified` | `profile_reopened` | `specifying` | system | an open contract version lists this app in impactedTargets |
| `building` | `profile_reopened` | `specifying` | system | an open contract version lists this app in impactedTargets |
| `built` | `profile_reopened` | `specifying` | system | an open contract version lists this app in impactedTargets |
| `mapped` | `descoped` | `descoped` | github | a merged roadmap version of this app no longer references the catalog feature |
| `specifying` | `descoped` | `descoped` | github | a merged roadmap version of this app no longer references the catalog feature |
| `specified` | `descoped` | `descoped` | github | a merged roadmap version of this app no longer references the catalog feature |
| `building` | `descoped` | `descoped` | github | a merged roadmap version of this app no longer references the catalog feature |
| `built` | `descoped` | `descoped` | github | a merged roadmap version of this app no longer references the catalog feature |

### 4.9 Contribution

Initial: `pending`. Terminal: `rejected,reversed`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `pending` | `accept` | `accepted` | system, github | the category's acceptance condition in REWARD-PROTOCOL.md holds |
| `pending` | `reject` | `rejected` | system, maintainer | subject ended without acceptance, or maintainer rejection with reason |
| `accepted` | `reverse` | `reversed` | maintainer, github | the merged change was reverted as defective within the hold window, or fraud finding by maintainer (public reason) |

### 4.10 Inventory version

Initial: `proposed`. Terminal: `superseded`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `proposed` | `roadmap_merged` | `frozen` | github | the roadmap PR containing this inventory merged |
| `frozen` | `superseded_by_newer` | `superseded` | github | a later roadmap version with a newer inventory merged |

### 4.11 Proposal and blocker

Proposal:

Initial: `open`. Terminal: `rejected,incorporated`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `open` | `accept` | `accepted` | maintainer, system | maintainer triage, or the roadmap author task for the next round lists it as addressed |
| `open` | `reject` | `rejected` | maintainer | reason recorded publicly on the issue |
| `accepted` | `incorporate` | `incorporated` | github | a merged roadmap/contract version references the proposal id |

Blocker:

Initial: `open`. Terminal: `resolved,rejected`.

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `open` | `claim_resolution` | `resolving` | contributor | resolver task claimed under the Architecture Conflict Resolver policy |
| `resolving` | `resolution_lost` | `open` | system | resolver lease expired or released |
| `resolving` | `resolution_merged` | `resolved` | github | the resolution PR (contract change) merged |
| `open` | `reject` | `rejected` | maintainer | reason recorded on the issue |
| `resolving` | `reject` | `rejected` | maintainer | reason recorded on the issue |

## 5. Concurrency rules

- Guarded updates with `row_version` everywhere (section 3). Never `select ... for update` followed
  by an unguarded write in a different statement.
- Partial unique indexes are the backstop for the invariants that matter most:
  `documents_one_open_roadmap`, `documents_one_open_contract`, `inventory_one_frozen`,
  `attempts_one_live_per_abu`, `rounds_one_open_document`, `rounds_one_open_attempt`,
  `tasks_one_review_per_slot`, `tasks_one_live_build_per_abu`, `leases_one_active_per_task`,
  `resource_locks_exclusive_key`, `reward_pools_feature`, `reward_pools_application`,
  `reviews (round_id, slot)` (distinct accounts per round are enforced by the trigger `check_review_independence`, except two `bootstrap_self` reviews), `accounts_handle_lower`,
  `account_emails.email_normalized`, `accounts.github_user_id`. A unique violation maps to `409 CONFLICT`.
- Resource locks. A build claim computes the ABU's locks: one `path:<prefix>` lock per write scope
  (`path_prefix` = scope without `/**`, `path_is_tree` = it ended with `/**`, mode exclusive) plus
  each declared `ResourceClaim`. Inside the claim transaction the control plane takes
  `pg_advisory_xact_lock(hashtext('wos.locks:' || repo_full_name))`, reads all live locks of the repo,
  and refuses with `RESOURCE_LOCKED` if any live lock conflicts: two path locks conflict when
  `scopesOverlap` (prefix algebra in `packages/verification`) is true; two logical locks with the same
  key conflict unless both are `shared`. Then it inserts the new locks. Locks are released when the
  attempt reaches any terminal state. The lock is per repository because every app shares
  `waronsaas/product` (D10).
- Ledger inserts are serialised by `pg_advisory_xact_lock(7313371)` inside the chain trigger.
- The migration runner takes `pg_advisory_lock(7313370)`.
- Webhooks are deduplicated by `X-GitHub-Delivery` (`webhook_deliveries` primary key), stored first,
  then processed; processing is idempotent because every effect is a guarded transition.

## 6. Ingestion on merge

`pull_request.closed` with `merged = true` on an official PR is processed as `github`:

- Roadmap PR: parse `INVENTORY.yaml`, `ROADMAP.yaml` and new `catalog/*.yaml` at the merge commit;
  freeze the inventory version (supersede the old one); upsert capabilities with weights; create
  catalog features for `newCatalogFeatures`; upsert `app_features` (new ones `mapped`; ones no longer
  referenced `descoped`); write dispositions; open or link contract workflows (D11); emit
  `app_feature.tracked` per feature; recompute progress.
- Feature contract PR: parse `CONTRACT.yaml` and `BUILD-GRAPH.yaml`; insert requirements, profiles,
  ABUs, edges; supersede ABUs of the previous version that are not carried over unchanged (same key and
  identical spec); create build tasks (`blocked` or `open`); move app features to `specified`; recompute
  progress.
- Implementation PR: attempt `merged`, ABU `merged`, unlock dependents, contribution `accepted`,
  rewards, progress.

## 7. Surfaces (D13, migration 0005)

| Table | Purpose |
|---|---|
| `repositories` | Registry of official repos and their family (`platform`, `product`). An ABU's repo must be in the family of its contract's repo (trigger `check_repo_consistency`). |
| `target_surfaces` | Per app: each vendor surface `in_scope` (repo + path) or `excluded` (reason), from the merged roadmap version. |
| `app_feature_surfaces` | Per app feature: reasoned surface weight and rationale (frozen per roadmap version). `app_features.journeys` holds the roadmap journeys. |
| `requirement_surfaces` | Surface tags of each contract requirement. |
| `verification_runs.surface` | Per-surface profile acceptance results (required for `profile_acceptance`). |
| `toolchain_attestations` | Append-only device toolchain reports used for path-based toolchain eligibility. |

Migration 0005 also moves every product target to `waronsaas/product`.

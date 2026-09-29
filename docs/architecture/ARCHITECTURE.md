# wOS architecture

Status: frozen at contracts 1.0.0 (Phase 0, 2026-09-29). Owner: Lead Architect.
Changes go through an ARCHITECTURE_BLOCKER (see WORKSTREAMS.md). Where this document and the code
disagree, the code in `packages/contracts` and `packages/db/migrations` wins and this document is a bug.

Founder decisions D1-D12 in `docs/DECISIONS.md` override `docs/V1-SPEC.md`. This document applies them.

## 1. What the system is

warOnSaaS builds open-source replacements for rented business software. wOS is the platform that
coordinates it: contributors run AI agents on their own subscriptions (D1), wOS decides what they may
work on, gives each agent exactly the context it needs, verifies and cross-reviews the result, and only
then lets the wOS GitHub App open a pull request (D9). The public website shows honest progress.

```
                         contributors' machines                                   hosted (Vercel pdx1 + Supabase us-west-2)
 +--------------------------------------------------------+        +-------------------------------------------------------+
 | wOS Desktop (Electron)          wOS CLI (`wos`)         |        |  api.waronsaas.com  (Vercel project waronsaas-api)    |
 |   renderer (React, sandboxed)     commander shell       |        |    services/control-plane  (Hono, Node runtime)       |
 |        | IPC (window.wos)              |                |  HTTPS |      routes = Routes in @waronsaas/contracts          |
 |   main process ----------+-------------+                | <----> |      uses: db, agent-policy, context-engine,          |
 |                          v                              |  JSON  |            verification, github/app, planning, rewards|
 |            @waronsaas/orchestrator  (ONE driver)        |        |      cron: /v1/cron/sweep, /v1/cron/dispatch (1 min)  |
 |              agent-policy, context-engine,              |        |                  |                       ^            |
 |              verification, github/local                 |        |                  v                       | webhooks   |
 |                 |                |                      |        |   Supabase Postgres (schema wos, role wos_app, RLS)   |
 |       git worktrees        claude / codex CLIs          |        +-------------------------------------------------------+
 |       (per lease)          (contributor's own login)    |                               |  GitHub App (installation token)
 +--------------------------------------------------------+                               v
                                                                   +-------------------------------------------------------+
 waronsaas.com (Vercel project waronsaas-web, apps/web)  ---GET--> |  github.com/waronsaas                                  |
   public Sniper List and drilldowns, reads /v1/public/*           |    waronsaas/waronsaas  platform repo (wOS + web)      |
                                                                   |    waronsaas/suite      product repo (all replacements) |
                                                                   |    Actions: wos-verify (no secrets), merge queue        |
                                                                   +-------------------------------------------------------+
```

GitHub is the public, auditable record. The control plane is the coordinator. Contributors never push
and never open PRs (D9). wOS never holds model credentials (D1).

## 2. Repositories

| Repo | Visibility | Holds | Who writes |
|---|---|---|---|
| `waronsaas/waronsaas` | public | this monorepo: wOS (control plane, Desktop, CLI, shared packages) and `apps/web`. Also TGT-00 warOnSaaS, whose roadmap is `docs/roadmap/waronsaas.roadmap.json`. | V1 is built by the founder's implementation agents in worktrees (WORKSTREAMS.md). |
| `waronsaas/suite` | public | the ONE product repository for every replacement app. Name is a FOUNDER DECISION (GAPS G-05); `PRODUCT_REPO` in `primitives.ts` holds it. | Only the wOS GitHub App (D9). |

Product repo layout (from `ARTIFACT_PATHS` in `packages/contracts/src/artifacts.ts`):

```
wos.json                                  RepoManifest (install, verify steps, protected/generated paths, lockfiles, migrationsDir)
catalog/<featureKey>.yaml                 CatalogEntry - the global Feature Catalog (D10)
roadmaps/<target>/INVENTORY.yaml          Inventory - public surface of the rented product (completeness evidence)
roadmaps/<target>/ROADMAP.yaml            Roadmap - capabilities -> catalog features, reasoned weights (D12)
features/<featureKey>/CONTRACT.yaml       FeatureContract - app-independent, with per-app requirement profiles
features/<featureKey>/BUILD-GRAPH.yaml    BuildGraph - Atomic Build Units
features/<featureKey>/acceptance/**       acceptance suites (one per app profile)
modules/<featureKey>/**                   shared implementation of a feature (built once)
products/<target>/**                      per-app product surface: navigation, branding, composition
```

Decision: one product repo, not one repo per target. Rejected alternative: `waronsaas/crm`,
`waronsaas/chat` and so on. D10 makes features shared across apps (Contacts serves Salesforce, HubSpot,
Zendesk and NetSuite), so shared code must live in one place; per-target repos would need published
packages and cross-repo version pinning for every shared module. Cost we accept: one merge queue and
one CI budget for everything, so merge-queue contention and CI minutes grow with contributors. The
logical lock model (DOMAIN-MODEL.md "Resource locks") is per repository for the same reason.

Why the product repo is separate from the platform repo: contributor-built code never shares branch
rules, CI, secrets or release signing with wOS itself. The platform repo holds the Electron signing
secrets; the product repo holds no secrets at all (SECURITY.md S-20).

## 3. Monorepo layout and tooling

```
apps/web                 public website (Next.js 16) - NOT yet an npm workspace (see section 9)
apps/desktop             wOS Desktop (Electron main + preload + React renderer)
apps/cli                 wOS CLI, npm package @waronsaas/cli, binary `wos`
services/control-plane   Hono API, Vercel project waronsaas-api
packages/contracts       frozen shared contracts: types, zod schemas, state machines, route map, events,
                         artifacts, agent I/O, ledger, progress functions, policy + reward schedule data
packages/db              SQL migrations (architect-owned) + migration runner (control-plane workstream)
packages/agent-policy    policy evaluator: eligibility, reasoning resolution, CLI invocation builder
packages/context-engine  deterministic context assembly and manifest hashing
packages/verification    deterministic changeset scope validation (client, server and CI)
packages/github          ./app (server: GitHub App, Git Data API, PRs, webhooks) and ./local (git worktrees)
packages/planning        YAML parsing, roadmap/build-graph validators, round outcome logic
packages/rewards         pure reward rules: events in, ledger entry drafts out
packages/orchestrator    the single LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR driver
blockers/                ARCHITECTURE_BLOCKER files during the V1 build
docs/                    spec, decisions, architecture constitution, wOS's own roadmap
```

| Choice | Picked | Rejected, and why |
|---|---|---|
| Package manager | npm 10.9 workspaces | pnpm: broken on this machine (corepack cache points at a missing pnpm 12.6.0 build); npm needs no extra tool on any contributor machine. Yarn: a third tool for no gain. |
| Node | 22 LTS, pinned by `.nvmrc` and `engines` (`>=22.12 <23`) | Node 20 is end-of-life (April 2026) and Vitest 5, Electron 44 and commander 15 require >=22.12. |
| TypeScript | 7.0.2 with project references, `tsc -b`, `module: NodeNext`, strict, `noUncheckedIndexedAccess` | Bundler-only "internal packages" pointing at TS source: the CLI and the Electron main process run plain Node, which needs emitted JS. |
| Tests | Vitest 5 (`vitest.config.ts` at the root) | Jest: slower ESM story, extra transform config. |
| Lint/format | Biome 2.5 (`biome.json`) | ESLint + typescript-eslint + Prettier: three tools and heavy config for the same checks. |
| Validation | zod 4 schemas as the single source; JSON Schema for agent outputs is generated from them (`z.toJSONSchema`) | Hand-written JSON Schema: drifts from types. |
| API framework | Hono on Vercel (zero-config Node runtime) | Next.js route handlers: couples the API to a UI framework and its build. Express: heavier cold start, no typed routing. |
| DB access | `postgres` (porsager) driver with hand-written SQL | Prisma or Drizzle: both want to own the schema; D7 requires SQL migrations applied by a ledgered runner, and the ledger/RLS/trigger features are SQL-first anyway. |
| Background work | Vercel Cron (every minute) over the `events` table used as an outbox, with `event_consumptions` for idempotent consumers | Vercel Queues / Workflow: newer, more vendor surface, and the V1 volume is tiny. A separate worker host: another thing to run. |
| Canonical documents | YAML files validated by zod after parsing (`yaml` package in planning) | JSON: unreadable for prose-heavy roadmaps and contracts. A database-only roadmap: not auditable on GitHub. |
| Desktop | Electron + React + Vite, electron-builder, signed and notarised in GitHub Actions (D7) | Tauri: the spec names Electron; signing from the founder's Mac is known to crash (D7). |

Dependency rule for the lockfile: every approved third-party dependency was installed in Phase 0 so
parallel workstreams never edit `package-lock.json`. Adding a dependency is a blocker (the lockfile is a
shared resource, exactly like `lockfile:` resources in a build graph).

## 4. Package responsibilities and dependency rules

Layering (an arrow means "may import"; nothing may import upward or sideways unless listed):

```
contracts            <- everything
agent-policy         <- contracts
verification         <- contracts
rewards              <- contracts
db                   <- contracts
context-engine       <- contracts, agent-policy
planning             <- contracts, agent-policy, context-engine, verification
github               <- contracts            (./app server side, ./local client side)
orchestrator         <- contracts, agent-policy, context-engine, verification, github (./local only), planning (local document validation)
control-plane        <- contracts, db, agent-policy, context-engine, verification, github (./app), planning, rewards
cli                  <- contracts, orchestrator
desktop (main)       <- contracts, orchestrator
desktop (renderer)   <- contracts (types only)
web                  <- contracts (types only, after Wave 2 adoption)
```

Hard rules:

1. `packages/contracts` has one runtime dependency (zod) and no I/O. It is imported by everything.
   Its second entry point `@waronsaas/contracts/canonical` (Node only, `node:crypto`) is THE hashing and
   signing implementation (contracts 2.0.0, SECURITY.md S-32): JCS, sha256, the diff hash, signing
   payloads, Ed25519 key encoding, manifest and provenance hashes, git blob ids. No other package may
   carry its own copy; browser code (web, desktop renderer) imports only the root entry.
2. The control plane never imports `orchestrator` or `github/local`. Clients never import `db`,
   `github/app` or `rewards` (the orchestrator may import `planning` for local validation only).
3. Apps never import `packages/db`. Only `services/control-plane` talks to Postgres.
4. Pure packages (`agent-policy`, `verification`, `context-engine`, `planning`, `rewards`, the
   progress functions in `contracts`) do not read the clock, the environment, the network or the
   filesystem. Inputs are passed in. This is what lets the same code run on the client, the server
   and in CI and give the same answer.
5. `apps/desktop` renderer code has no Node access at all; it calls `window.wos` (`WosBridge` in
   `apps/desktop/src/shared/ipc.ts`).

| Package | Responsibility | Public API (frozen signature, Phase 0 stub) |
|---|---|---|
| contracts | every shared type and schema; state machines as data; `Routes`; `DomainEventBody`; artifacts; `computeAppProgress` (implemented and tested); `AGENT_POLICY_V1`; `REWARD_SCHEDULE_V1`; `Orchestrator` interface | as exported by `src/index.ts` |
| db | migrations `0000_meta.sql` .. `0003_subjects_and_runs.sql`; runner | `runMigrations({databaseUrl, migrationsDir, checkOnly})` |
| agent-policy | eligibility, reasoning resolution, argv building | `getRolePolicy`, `resolveReasoning`, `checkEligibility`, `buildInvocation` |
| context-engine | context assembly; ALL prompt templates in `templates/` (files for roadmap_*, feature_* and conflict_resolver owned by planning, builder and implementation_reviewer_* by context-policy) | `buildContext`, `checkManifestAgainstPlan`, `estimateTokens`; `canonicalSha256` re-exported from `contracts/canonical` |
| verification | changeset scope validation, scope algebra | `validateChangeset`, `scopesOverlap` (implemented) |
| github | branch naming (root), App operations (`./app`), worktrees (`./local`) | `commitChangeset`, `openPullRequest`, `setCommitStatus`, `enableAutoMerge`, `blobOidsAt`, `createIssue`, `verifyWebhookSignature`, `exchangeUserAuthorization`, and (2.0.0, B-0001-github-build) `createBranchAt`, `deleteBranch`, `closePullRequest`, `startDeviceAuthorization`, `configureGithubApp`/`resetGithubAppConfig`, `GithubAppError`, `renderPullRequestBody`, `renderProvenanceSection`, and (3.0.0, B-0001-control-plane) `getBranchHead`, `readFileAt`, `listTreePaths`, `moveBranch`, `compareDiff`, `webAuthorizeUrl`; local: `createWorktree`, `captureChanges`, `removeWorktree` |
| planning | YAML parsing and deterministic validators; round outcome | `parse*Yaml`, `validateRoadmap`, `validateBuildGraph`, `computeRoundOutcome` |
| rewards | reward rules | `computeLedgerDrafts`, `allocatePool` |
| orchestrator | the one workflow driver | `createOrchestrator(deps): Orchestrator` (2.0.0: `signIn` for email sign-in and `linkGithub` replace `login`) |
| control-plane | HTTP API, auth, state machines, persistence, webhooks, cron | `Routes` |

## 5. Runtime topology

| Component | Where | Domain | Notes |
|---|---|---|---|
| Public website | Vercel project `waronsaas-web` (team `battle-juice`) | `waronsaas.com` (`www` redirects to apex) | static Next.js now; ISR against the API after Wave 2 |
| Control plane | Vercel project `waronsaas-api`, functions pinned to `pdx1` | `api.waronsaas.com` | Node runtime; Vercel Cron for `/v1/cron/*` |
| Database | Supabase Postgres, AWS `us-west-2` (same region as `pdx1`, D7) | n/a | app connects through the Supabase transaction pooler as `wos_app`; migrations connect directly as the owner |
| Mail | Resend, sending domain `notify.waronsaas.com` | n/a | apex MX stays with ImprovMX (D5) |
| GitHub | org `waronsaas`, the wOS GitHub App installed on `waronsaas/suite` and `waronsaas/waronsaas` | n/a | App has no `workflows` permission (SECURITY.md S-19) |
| Releases | GitHub Releases on `waronsaas/waronsaas` | `github.com/waronsaas/waronsaas/releases/latest` | Desktop builds from Actions; CLI on npm as `@waronsaas/cli` |

Every Postgres transaction opened by the control plane first runs:

```sql
select set_config('wos.actor_id', $accountIdOrEmpty, true),
       set_config('wos.actor_kind', $kind, true);   -- 'contributor' | 'maintainer' | 'system' | 'github'
```

`true` makes the settings transaction-local, which is what the transaction pooler requires. RLS
policies read them through `wos.actor_id()`, `wos.actor_kind()` and `wos.is_privileged()`
(SECURITY.md S-9).

## 6. The BUILD path end to end

The spec's steps 1-26, with the component and contract that does each step.

| # | Step | Component | Contract |
|---|---|---|---|
| 1-2 | Install Desktop or CLI, sign in by email link or code, link GitHub | Desktop/CLI -> `orchestrator.signIn` -> `startEmailSignIn`, `redeemEmailSignIn`; then `orchestrator.linkGithub` -> `startGithubLink`, `pollGithubLink` | D8, SECURITY.md S-1..S-6 |
| 3-6 | Pick Salesforce -> CRM -> feature -> ABU | `getTarget`, `getFeature`, `listClaimableAbus` | `TargetDetail`, `AppFeatureDetail`, `AbuSummary.claimable` |
| 7 | BUILD / `wos build <abu>` | `Orchestrator.build` | `BuildOptions` |
| 8 | Eligibility | orchestrator runs `claude auth status`, `codex login status`, versions -> `postAttestation`; server `checkEligibility` at claim | AGENT-POLICY.md "Eligibility" |
| 9 | Lease | `claimBuild` (POST `/v1/abus/:id/claim`): creates Attempt (`leased`), leases the `abu_build` task, takes resource locks, pins `base_sha` | DOMAIN-MODEL.md Task, Lease, Attempt, Resource locks |
| 10 | Worktree | `github/local.createWorktree` at `base_sha` under the workspace root | BUILD-PROTOCOL.md |
| 11 | Builder context | `context-engine.buildContext(plan)`; `postManifest` moves attempt `leased -> building` | CONTEXT-PROTOCOL.md |
| 12 | Launch Opus | `agent-policy.buildInvocation` -> `claude -p ... --model claude-opus-5-5 --effort high|...` | AGENT-POLICY.md "Launch mapping" |
| 13 | Enforce scope | Claude restrictions at run time; `github/local.captureChanges` + `verification.validateChangeset` locally | SECURITY.md S-15..S-17 |
| 14 | Deterministic verification | `setAttemptPhase(verifying)`; orchestrator runs `wos.json` verify steps and ABU acceptance checks; failures loop back (`verify_failed_locally`, max 3) | BUILD-PROTOCOL.md |
| - | Submit | `postAgentRun` (signed), `submitChangeset` (signed); server re-validates scope, recomputes `submissionSha256`, App commits to `wos/candidate/<attemptId>` | D9 |
| - | CI | `wos-verify` runs on the candidate push; webhook `check_suite` -> `ci_passed` / `ci_failed` | BUILD-PROTOCOL.md |
| 15-17 | Astra and Fable review | round opened with one review task per slot; other contributors claim via `claimReview`, run at `max`, `submitVerdict` (sealed) | REVIEW-PROTOCOL.md |
| 18 | Revisions | `round_gaps` -> `changes_requested`; builder claims `abu_revision` task (`resume_for_revision`), max 3 repair rounds | DOMAIN-MODEL.md Attempt |
| 19 | Qualify | both verdicts NO_MATERIAL_GAPS on same head sha + submission hash, CI green on that sha, scope re-validated, independence and attestations present -> `qualified` | BUILD-PROTOCOL.md "Qualification" |
| 20 | PR | App creates `wos/<unit>` at the candidate commit, opens the PR with provenance, sets `wos/qualified`, enables merge queue | D9 |
| 21 | Provenance | `provenance_records` row + PR body + commit trailers | `ProvenanceRecord` |
| 22 | Merge | merge queue runs `wos-verify` on `merge_group`; `pull_request.closed merged=true` webhook -> attempt `merged`, ABU `merged` | DOMAIN-MODEL.md |
| 23-24 | Rewards, leaderboard | `rewards` consumer writes held awards; leaderboard is the `v_leaderboard` view | REWARD-PROTOCOL.md |
| 25 | Dependents unlock | `task_unlocker` consumer: `pending_dependencies -> ready`, build task `blocked -> open` | DOMAIN-MODEL.md |
| 26 | Public site updates | `progress` consumer recomputes `computeAppProgress`, appends snapshots; site revalidates within 60s | ROADMAP-PROTOCOL.md "Progress" |

The same pipeline, with a different role, runs for roadmap and feature-contract revisions: an author
task submits a changeset limited to the document's paths, the App commits it to the canonical document
PR branch (`wos/roadmap/<target>/v<n>` or `wos/feature/<key>/v<n>`), and a round of two reviews
follows. For documents the PR is opened early (as a draft) because the PR is the public place the
roadmap is discussed; it still only ever receives App commits.

## 7. The one-orchestrator rule

The spec requires the CLI and Desktop to share orchestration. Therefore:

- The `Orchestrator` interface is frozen in `packages/contracts/src/orchestrator.ts`. It is
  implemented once, in `packages/orchestrator`, which receives its side effects by injection
  (`SecretStore`, `ProcessRunner`, `fetch`, workspace root).
- `apps/cli` is a thin commander shell: it parses arguments, calls one orchestrator method, prints
  `OrchestratorEvent`s. It contains no workflow logic.
- `apps/desktop` main process creates the same orchestrator with an Electron `SecretStore`
  (safeStorage) and forwards `OrchestratorEvent`s to the renderer over the `wos:events` channel.
- Neither app calls a workflow route directly. Only the orchestrator's typed `ApiClient` calls `Routes`.
- The integration test for this rule: a fake `ProcessRunner` and fake API produce byte-identical event
  streams through the CLI and through the Desktop main process (verification workstream).

## 8. Conventions

- Names: always "warOnSaaS" and "wOS" in prose, UI strings, CLI output and docs. Lowercase `waronsaas`
  only where a technical identifier requires it (domain, npm scope `@waronsaas`, GitHub org and repos,
  package names, database schema `wos`). Known exception, flagged not fixed: D3 mandates the wording
  "WOS tokens are in-app credits with no cash value." (`TOKEN_DISCLAIMER`); see GAPS G-31.
- Identifiers: UUIDv7 minted by the control plane (time ordered). `gen_random_uuid()` defaults exist
  only as a fallback. Human keys: target slug, capability key, catalog feature key, requirement key
  `R-nnn`, ABU key `<feature>#nn`, inventory key `INV-nnnn` (regexes in `primitives.ts`).
- Time: the server clock only, `timestamptz`, ISO-8601 UTC on the wire. Clients never send times that
  the server trusts except inside signed agent-run records (which are evidence, not authority). Tests
  build fixture times relative to the clock and never pin absolute dates (D7).
- Numbers: progress in integer basis points (0..10000), always floored; tokens are whole integers.
  Display with `formatPercent` only.
- Idempotency: every route with `idempotent: true` requires `Idempotency-Key: <uuid>`; stored in
  `wos.idempotency_keys` keyed by (account, route, key) with the request body hash for 24 hours.
- Concurrency: mutable aggregates carry `row_version`. Transitions are guarded updates
  (`... where id = $1 and state = $from and row_version = $v`); zero rows means 409 CONFLICT and the
  client re-reads. Clients never blind-retry a 409.
- Every state change writes one `wos.events` row in the same transaction.
- Git: official commits are authored by the App (`waronsaas-wos[bot]`) with a `Co-authored-by:`
  trailer for the contributor's linked GitHub noreply address and trailers `wOS-Task`, `wOS-Attempt`,
  `wOS-Abu`, `wOS-Manifest`, `wOS-Contributor` (`COMMIT_TRAILERS`).
- Branches: `wos/candidate/<attemptId>` (pre-qualification, App-only, never a PR),
  `wos/<abu-key with # replaced by ->-<first 8 hex of attempt id>` (official PR branch, `officialBranch`),
  `wos/roadmap/<target>/v<n>`, `wos/feature/<key>/v<n>`.

## 9. How apps/web switches to the API

`apps/web` was built by another agent and is live as Vercel project `waronsaas-web`. It is adopted
without edits in Phase 0. In Wave 2 the web workstream:

1. Deletes `apps/web/package-lock.json`, adds `apps/web` to the root `workspaces`, keeps its Next.js
   and TypeScript versions, and sets the Vercel project's root directory to `apps/web` with the install
   command run from the repo root (`npm ci` at the root).
2. Replaces the body of `apps/web/data/targets.ts` with a fetch of `GET /v1/public/targets`
   (`listTargets`) using `next: { revalidate: 60 }`, mapping `TargetSummary` onto the existing
   `Target` type so no page changes: `mapped/specified/built` = `formatPercent`-ready basis points
   converted to whole percents by flooring, `roadmapPr` = `roadmap.prUrl`, `hosted` =
   `hosted.available`, `selfHosted` = `selfHostable`.
3. Never falls back to invented data. If the API is unreachable at build time the build fails; at
   runtime ISR keeps the last good page.
4. Adds the drilldown pages (`getTarget`, `getFeature`, `getCatalogFeature`, `getAbu`, activity,
   profiles, leaderboard) in Wave 2. The site does not need sign-in in V1 except for the account
   pages that GAPS G-27 decides.
5. Fixes the download page claim of Windows and Linux builds to match what Desktop actually ships
   (see GAPS.md).

## 10. Environments and the ship gate

| Environment | Database | API | Notes |
|---|---|---|---|
| local | Docker `postgres:17-alpine` or `supabase/postgres:17.4.1.048` via `packages/db/scripts/test-migrations.sh` | `vercel dev` or node | no GitHub App writes; fakes for GitHub and CLIs |
| preview | a separate Supabase project (FOUNDER-CHECKLIST.md) | Vercel preview deployments of `waronsaas-api` | GitHub App pointed at a sandbox org or repo, never `waronsaas/suite` |
| production | Supabase us-west-2 | `api.waronsaas.com` | migrated only by the ship gate |

Ship gate (D7), implemented by the verification workstream as `scripts/ship.sh` (Wave 1):

1. Refuse if the working tree is dirty, HEAD is not pushed, or CI on HEAD is not green.
2. Refuse if the HEAD commit author is not `adventurini <anthonydventurini@gmail.com>` (Vercel blocks
   deploys by non-members, D7).
3. Run `runMigrations({checkOnly: true})` to list pending migrations, then apply them with the
   migration URL, then deploy with the Vercel CLI.
4. Nothing migrates production by hand. The migration ledger (`wos_meta.schema_migrations`) is
   append-only and checksummed; an edited or deleted migration stops the runner.

Static assets served immutable must have hashed filenames (D7); Next.js and Vite already do this.

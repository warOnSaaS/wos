# WORKSTREAMS — who builds what, in which wave, against which contracts

Contracts 1.0.0, 2026-09-29. Read with ARCHITECTURE.md (package boundaries) and the constitution documents each workstream is told to honour.

The V1 build of wOS is itself TGT-00 warOnSaaS: every workstream is mapped to features of `docs/roadmap/waronsaas.roadmap.json` (status PROPOSED), so the V1 build is tracked exactly like a target: capability → feature → requirement → work.

## 1. Rules that apply to every workstream

1. **One worktree per workstream.** Branch `ws/<workstream>` from the frozen contracts commit; worktree at `~/waronsaas-<workstream>`. Never commit to another workstream's branch.
2. **Owned paths only.** Write only inside the paths listed under OWNS. Everything else is read-only. A change needed outside your paths is an ARCHITECTURE_BLOCKER (section 4), never a quiet edit.
3. **Frozen shared files (architect-owned):** `packages/contracts/**`, `packages/db/migrations/**`, `docs/architecture/**` (except your own dogfood log), `docs/DECISIONS.md`, `docs/roadmap/**`, root `package.json`, `package-lock.json`, `tsconfig*.json`, `biome.json`, `vitest.config.ts`, `.nvmrc`, `.npmrc`.
4. **Dependencies are pre-installed.** The lockfile is a shared logical resource: no workstream runs `npm install <pkg>` or edits `dependencies` in any `package.json`. You may edit `scripts` and your own `tsconfig.json` `references` for packages you already depend on. Need a new dependency? Blocker; the architect batches them. Pre-installed: zod, postgres, hono, @octokit/rest, @octokit/auth-app, @octokit/webhooks-methods, yaml, picomatch, commander, @napi-rs/keyring, react, react-dom, electron, electron-builder, vite, @vitejs/plugin-react, vitest, @biomejs/biome, typescript 7.0.2. (Electron's binary is not downloaded yet: the desktop workstream runs `node node_modules/electron/install.js` once.)
5. **Use Node 22** (`.nvmrc`; `nvm use`). `pnpm` is broken on this machine and is not used.
6. **Stubs.** Every exported function in your package that throws `NotImplementedError` is yours to implement. Its signature is part of the frozen interface between workstreams: changing a signature another workstream calls is a blocker.
7. **Definition of green:** `npm run typecheck`, `npm run lint`, `npm test` pass at the repo root, plus your own DONE tests. Commit authored `adventurini <anthonydventurini@gmail.com>` (D7).
8. **Casing:** `warOnSaaS` and `wOS` in every human-facing string; lowercase only in identifiers.
9. **Dogfood log.** Each workstream keeps `docs/dogfood/<workstream>.md` (the only file under `docs/` it owns) with one row per working session: date, context size at start (tokens, estimated), task scope, files owned, files changed, duration, blockers raised, merge conflicts, repair loops, verification failures, integration failures, lessons (spec: "Dogfood the wOS model").

## 2. Waves

| Wave | Workstreams | Integration gate before the next wave |
|---|---|---|
| 0 | architect | this commit: contracts, schema, policy, docs; `npm run check` and `npm run db:test` green |
| 1 | control-plane, github-build (App + local git), context-policy, verification | Migrations apply via the runner in Docker; control plane serves auth (email code), GitHub link, claim → heartbeat → expire → release against Postgres with a fake GitHub; scope validator passes the shared vector suite; `buildInvocation` snapshots match the policy for all ten roles; CI workflow `wos-verify` runs in the platform repo |
| 2 | planning, rewards, orchestrator (github-build continues), cli, desktop, web | A fake end-to-end run: CLI and Desktop both drive the orchestrator through LEASE → … → PR against the control plane with a fake GitHub and fake agent CLIs; a roadmap document goes through two fake rounds to consensus; rewards written for a fake merge; the web renders real API data with 0% everywhere |
| 3 | all (end to end), led by verification | The spec's FINAL V1 INTEGRATION TEST with real accounts, the real App on `waronsaas/suite`, real Claude Code and Codex, the Salesforce roadmap v1 mapping the CRM capability, one Feature Contract at consensus, two ABUs of one feature built in parallel |

After every wave the architect: runs the full suite, inspects contract violations, merges `ws/*` branches into `integration` in dependency order (contracts consumers after providers), resolves conflicts on purpose, updates the constitution, bumps contracts if a blocker was accepted, then starts the next wave.

## 3. The workstreams

Roadmap features referenced below are keys in `docs/roadmap/waronsaas.roadmap.json`.

### control-plane (spec Agent 1) — Wave 1, continues in 2–3

- **Owns:** `services/control-plane/**`; `packages/db/src/**` and `packages/db/test/**` except `schema.test.ts` and `db-assertions.sql` (architect); `docs/dogfood/control-plane.md`.
- **May read:** everything.
- **May not change:** `packages/db/migrations/**`, `packages/contracts/**`, other packages.
- **Honours:** `Routes` (api.ts) exactly — every route, auth mode, idempotency and error code; all machines in state-machines.ts (every state change is a guarded UPDATE + event in one transaction); events.ts; DOMAIN-MODEL.md; SECURITY.md S-controls marked control-plane; ROADMAP-PROTOCOL.md materialisation and progress consumer (calls `computeAppProgress`); REWARD-PROTOCOL.md persistence of `computeLedgerDrafts` output; the migration runner contract in `packages/db/src/index.ts`.
- **Roadmap features:** magic-link-sign-in, github-identity-link, device-sessions, contributor-profile, leases-and-locks (server), review-rounds (server persistence), provenance-and-merge (server), transactional-email, ship-gate-and-migrations (runner half).
- **Depends on:** contracts, db schema (Wave 0); github-build `app` functions and context-policy `checkEligibility`/`checkManifestAgainstPlan` (Wave 1, use fakes until they land); planning and rewards (Wave 2).
- **DONE (testable):** (1) runner applies `0000`/`0001` to Docker Postgres, refuses an edited migration, `--check` exits 1 when pending; (2) contract tests: every route in `Routes` exists, validates input with its zod schema, returns its response schema, and rejects the wrong auth mode; (3) sign-in tests: single use, 15-minute expiry, 5 attempts, poll-secret binding, identical responses for unknown emails, per-email and per-IP limits; (4) concurrency tests: 20 parallel claims of one ABU produce exactly one lease; overlapping write scopes across two ABUs cannot both be in progress; a lease with no heartbeat expires and the task reopens; (5) every transition writes exactly one event in the same transaction (test by forcing a failure after the UPDATE); (6) RLS: request handlers set `wos.actor_*`; a sealed review is invisible to another account through the API.
- **Escalate when:** a route, field, state or event you need is missing; a guard cannot be checked with the data in the schema; a migration is needed; Vercel limits force a contract change.

### desktop (spec Agent 2) — Wave 2

- **Owns:** `apps/desktop/**`, `docs/dogfood/desktop.md`.
- **May read:** everything. **May not change:** anything outside `apps/desktop`.
- **Honours:** the `Orchestrator` interface and `OrchestratorEvent` (orchestrator.ts) — the desktop never calls workflow routes directly; `WosBridge` in `src/shared/ipc.ts` (desktop-owned but reviewed by the architect at the Wave 2 gate); SECURITY.md desktop controls; D7 (signing and notarisation only in GitHub Actions); D8 sign-in (email code or `wos://auth` deep link bound to the poll secret).
- **Roadmap features:** wos-desktop.
- **Depends on:** orchestrator (github-build), control-plane API.
- **DONE:** (1) renderer has no Node (`typeof require === "undefined"` test), `contextIsolation`, `sandbox`, navigation and `window.open` denied, `openExternal` allowlist; (2) the spec's flow — sign in, pick Salesforce → CRM → feature → eligible ABU → BUILD — works against a fake control plane and streams orchestrator events into the activity pane; (3) contribution history, profile and settings screens read real API shapes; (4) `electron-builder` produces a macOS dmg and a Linux AppImage in CI; signing wired to the `release` environment secrets.
- **Escalate when:** the orchestrator interface lacks an operation the UI needs; an IPC need implies Node in the renderer.

### web (spec Agent 3) — Wave 2 (adoption of the existing site)

- **Owns:** `apps/web/**`, `docs/dogfood/web.md`.
- **May read:** everything. **May not change:** anything outside `apps/web`, except that adoption into the workspaces (deleting `apps/web/package-lock.json`, adding `apps/web` to root `workspaces`) is done by the architect on the web workstream's request at the Wave 2 gate.
- **Honours:** public routes of `Routes`; `formatPercent` for every percentage; `TOKEN_DISCLAIMER` wherever tokens appear; no mock data (0% when 0); the drilldown app → capability → feature → requirement → ABU → PR with weights and rationales shown (D11/D12); casing rule; G-32 copy fixes (email sign-in, GitHub only to contribute, Windows "coming later" unless G-18 decides otherwise).
- **Roadmap features:** sniper-list-site, progress-drilldown, activity-and-profiles.
- **Depends on:** control-plane public routes (Wave 1–2).
- **DONE:** (1) `data/targets.ts` replaced by a fetch of `GET /v1/public/targets` with ISR (revalidate 60 s), keeping the `Target` shape; TGT-00 warOnSaaS rendered from the API (or from `docs/roadmap/waronsaas.roadmap.json` until the API serves it); (2) a test that fails if any page renders a number not present in the API response; (3) every drilldown level linked and rendered; (4) Lighthouse CLS < 0.1 on the home page (median of three runs).
- **Escalate when:** a page needs data the public API does not return.

### github-build (spec Agent 4) — Wave 1 (App + local git), Wave 2 (orchestrator)

- **Owns:** `packages/github/**`, `packages/orchestrator/**`, `docs/dogfood/github-build.md`.
- **May read:** everything. **May not change:** other packages; the workflow YAML (verification owns it).
- **Honours:** BUILD-PROTOCOL.md (LEASE → BUILD → VERIFY → REVIEW → QUALIFY → PR, D9 gate); `Changeset` and submission hashing; branch and trailer naming in `packages/github/src/index.ts`; `Orchestrator` interface; `ProviderSpec` launch templates via `buildInvocation`; SECURITY.md S-controls marked github-build.
- **Roadmap features:** gated-pull-requests, local-orchestrator, provenance-and-merge (App side), leases-and-locks (client heartbeats).
- **Depends on:** contracts; verification (`validateChangeset` locally before submit); context-policy (`buildContext`, `buildInvocation`); planning (templates, local document validation) in Wave 2.
- **DONE:** (1) `commitChangeset` against a recorded GitHub fixture builds a commit whose tree equals `git write-tree` of the same files, with App author and `Co-authored-by`/`wOS-*` trailers; (2) `captureChanges` rejects symlinks, submodules and files outside the worktree (tests create each); (3) webhook signature check is constant-time and rejects a one-byte change; (4) the orchestrator drives a full fake run (fake API, fake `claude`/`codex` binaries on PATH) through every attempt state, including local repair, CI failure, changes requested, rebase and resume after a process restart; (5) the same fake run through CLI and Desktop produces identical event sequences.
- **Escalate when:** GitHub behaviour contradicts BUILD-PROTOCOL (e.g. the day-one PR-restriction test fails in a way the fallback does not cover).

### context-policy (spec Agent 5) — Wave 1

- **Owns:** `packages/context-engine/**` except the planning-role template files below, `packages/agent-policy/**`, `docs/dogfood/context-policy.md`.
- **May read:** everything. **May not change:** the policy data `packages/contracts/src/data/agent-policy.v1.json` (architect) — propose changes by blocker.
- **Honours:** CONTEXT-PROTOCOL.md (ordered artifacts per role, determinism, budgets, exclusions, JCS hashing); AGENT-POLICY.md (eligibility algorithm, independence, bootstrap, reasoning resolution); `ContextPlan`, `ContextManifest`, `AgentRunRecord`.
- **Roadmap features:** context-engine, agent-policy.
- **DONE:** (1) determinism: the same plan and snapshot produce byte-identical prompt and manifest across 100 runs and across macOS/Linux; (2) a reviewer's manifest never contains the other slot's current verdict (property test over generated rounds); (3) an ABU whose required artifacts exceed the builder budget is reported `OVER_CONTEXT_BUDGET` (used by planning's validator); (4) `buildInvocation` snapshot tests for all ten roles match the provider templates; `ultra` is never produced; (5) `checkEligibility` table tests for every rule including bootstrap self-review after 24 h; (6) obligations and materialFindingRules appear verbatim in rendered prompts.
- **Escalate when:** a flag in the policy templates behaves differently from its help text (update the UNVERIFIED list via blocker).

### planning (spec Agent 6) — Wave 2

- **Owns:** `packages/planning/**`; the planning-role prompt templates `packages/context-engine/templates/tpl.roadmap_*`, `tpl.feature_*` and `tpl.conflict_resolver*` (contracts 2.0.0: all templates ship inside context-engine; ownership is per file); `docs/dogfood/planning.md`.
- **May read:** everything. **May not change:** progress formulas (`progress.ts`, architect) and policy data.
- **Honours:** ROADMAP-PROTOCOL.md, FEATURE-CONTRACT.md, REVIEW-PROTOCOL.md; D10–D12; the `DocumentMachine` and `RoundMachine`; `BuildGraphErrorCode`.
- **Roadmap features:** feature-catalog, roadmap-consensus, feature-contract-consensus, build-graph-validation, proposals-and-resolution, review-rounds (outcome logic).
- **DONE:** (1) YAML parsers return path-precise errors; (2) `validateRoadmap` rejects every coverage and catalog error listed in ROADMAP-PROTOCOL (one test each) and accepts `docs/roadmap/waronsaas.roadmap.json` converted to files; (3) `validateBuildGraph` has one failing fixture per `BuildGraphErrorCode`; (4) `computeRoundOutcome` table tests including prior still_open findings and overruled findings; (5) templates render obligations verbatim and delimit untrusted content.
- **Escalate when:** a document rule cannot be expressed with the artifact schemas.

### rewards (spec Agent 7) — Wave 2

- **Owns:** `packages/rewards/**`, `docs/dogfood/rewards.md`.
- **May read:** everything. **May not change:** the schedule data (architect; FOUNDER DECISION G-12), the ledger schema.
- **Honours:** REWARD-PROTOCOL.md, TOKEN-DISTRIBUTION.md (proposal only — implement nothing transferable), D3, D10 (unit paid once; per-app pools).
- **Roadmap features:** token-ledger (rules side), reward-rules.
- **DONE:** (1) `computeLedgerDrafts` is pure and idempotent-by-key: replaying any event yields drafts with the same keys; (2) one test per `RewardCategory` acceptance condition; (3) pool allocation by largest remainder is deterministic and sums exactly; (4) a merged ABU relevant to two apps pays its implementer once and counts toward both apps' pools; (5) bootstrap_self awards are held until re-review; (6) no draft is ever produced for opening a PR.
- **Escalate when:** a rule needs data not present in the event or `RewardFacts`.

### verification (spec Agent 8) — Waves 1–3

- **Owns:** `packages/verification/**`, `tests/**` (integration and e2e suites at the repo root), `.github/workflows/**` of the platform repo, `templates/suite/**` (the product repo's `wos.json`, `wos-verify.yml`, CODEOWNERS and ruleset documentation), `scripts/ship.sh` (the ship gate, D7), `docs/dogfood/verification.md`.
- **May read:** everything. **May not change:** other packages' source (report defects as blockers or issues to the owner).
- **Honours:** SECURITY.md (every S-control needs a test that fails when the control is removed); BUILD-PROTOCOL.md scope algebra and qualification list; D2 (CI is the trusted verification); D7 ship gate rules.
- **Roadmap features:** scope-verification, integration-and-e2e, security-hardening, ship-gate-and-migrations (gate half).
- **DONE:** (1) `validateChangeset` passes a shared vector suite with one case per `ChangesetErrorCode`, including case collisions and `..` tricks; (2) platform CI runs typecheck, lint, tests and `db:test` on every PR; (3) `wos-verify.yml` for the suite has `permissions: contents: read`, no secrets, triggers on `push` to `wos/candidate/**`, `pull_request` and `merge_group`; (4) the ship gate refuses a dirty tree, an unpushed commit or red CI, then runs migrations with the ledger, then deploys; (5) adversarial suite: modified-client submission, fabricated verdict for another round, self-review outside bootstrap, reviewer seeing the other slot, symlink escape, workflow edit, lockfile without resource, 20 simultaneous builders; (6) Wave 3 runs the spec's final integration test.
- **Escalate when:** a control in SECURITY.md cannot be tested as written.

### cli (required by the spec; its own workstream) — Wave 2

- **Owns:** `apps/cli/**`, `docs/dogfood/cli.md`.
- **May read:** everything. **May not change:** anything outside `apps/cli`.
- **Honours:** the `Orchestrator` interface (no workflow logic in the CLI); commands `wos login` (orchestrator `signIn`: email, then the emailed code), `link-github` (orchestrator `linkGithub`), `logout`, `status`, `build <abu>`, `review`, `roadmap`, `propose`, `resolve`; session in the OS keychain via `@napi-rs/keyring`; exit codes 0 success, 1 failure, 2 usage, 3 not signed in / GitHub required; `--json` output of `OrchestratorEvent`s for scripting.
- **Roadmap features:** wos-cli.
- **DONE:** (1) every command calls the orchestrator and prints its events; (2) `wos status` reports git, claude, codex installation and sign-in via the policy's check commands; (3) a golden test of `wos build` against the fake orchestrator; (4) `npm pack` produces `@waronsaas/cli` with the `wos` binary.
- **Escalate when:** a command needs an orchestrator operation that does not exist.

### architect (Lead Architect) — Wave 0 and every gate

- **Owns:** everything listed as frozen in section 1, `blockers/` decisions, integration merges.
- **DONE for Wave 0:** this commit.

## 4. Escalation: ARCHITECTURE_BLOCKER

When a shared contract is insufficient, stop that part of the work and write `blockers/B-<nnnn>-<workstream>.md`, where `<nnnn>` is your own sequence (0001, 0002, …) — the workstream suffix keeps ids unique across parallel agents. Commit it on your branch and tell the coordinator. The file starts with a fenced `json` block that parses as `ArchitectureBlocker` (`packages/contracts/src/blocker.ts`), then free prose:

```json
{
  "id": "B-0001-control-plane",
  "status": "open",
  "raisedBy": "control-plane",
  "raisedAt": "2026-10-02T15:04:05Z",
  "affectedContract": "packages/contracts/src/api.ts Routes.claimBuild",
  "reason": "What is insufficient and why.",
  "evidence": "File, line, failing test or command output.",
  "requestedCapability": "What you need the contract to provide.",
  "affectedWorkstreams": ["control-plane", "github-build"],
  "suggestedResolution": "Your proposal, or null.",
  "decision": null
}
```

Continue with unaffected work. Do not implement around the blocker by changing a frozen file or by inventing a local type that duplicates a contract.

## 5. Contract versioning

- `CONTRACTS_VERSION` in `packages/contracts/src/version.ts` is semantic:
  - **PATCH** — comments or docs; no type or schema change.
  - **MINOR** — additive only: a new optional field, route, event type or enum member that consumers must already treat as unknown-safe. Existing producers and consumers keep compiling and passing.
  - **MAJOR** — anything else (renamed/removed field, changed meaning, new required field, state machine change, migration that alters an existing table).
- For every accepted blocker the architect: (1) versions the change and records it in `docs/architecture/CHANGELOG-CONTRACTS.md` with the blocker id; (2) lists affected workstreams; (3) updates their context (this file and the relevant protocol docs); (4) tells each affected workstream to rebase onto the new contracts commit and reconcile; (5) only then lets work continue. A shared interface never changes silently under an active agent.
- Database: migrations are append-only files `NNNN_name.sql`; an applied migration is never edited (the runner refuses a checksum change). A new migration is always a contract change.
- Persisted records (manifests, events, ledger entries, provenance) carry the contracts version they were written under; readers must handle every version still present in the database.
- D10 adds one more rule for the product repo's shared Feature Contracts: a new version must list `impactedTargets`, and its review contexts include every impacted app's roadmap reference and profile (FEATURE-CONTRACT.md).

## 6. Mapping: workstreams → TGT-00 roadmap features

| Capability (weight) | Feature | Workstream(s) |
|---|---|---|
| identity (700) | magic-link-sign-in | control-plane |
| | github-identity-link | control-plane (+ github-build `exchangeUserAuthorization`) |
| | device-sessions | control-plane (+ cli, desktop keychain) |
| | contributor-profile | control-plane (API), web, desktop |
| planning (2200) | feature-catalog | planning (+ control-plane ingestion) |
| | roadmap-consensus | planning (+ control-plane persistence) |
| | feature-contract-consensus | planning |
| | build-graph-validation | planning (+ context-policy budget estimate) |
| | proposals-and-resolution | planning, control-plane |
| pipeline (3200) | agent-policy | context-policy |
| | leases-and-locks | control-plane (+ github-build heartbeats) |
| | context-engine | context-policy |
| | local-orchestrator | github-build |
| | scope-verification | verification |
| | review-rounds | planning (logic), control-plane (persistence), context-policy (isolation) |
| | gated-pull-requests | github-build |
| | provenance-and-merge | github-build, control-plane |
| clients (1500) | wos-desktop | desktop |
| | wos-cli | cli |
| web (1300) | sniper-list-site, progress-drilldown, activity-and-profiles | web |
| rewards (600) | token-ledger | architect (schema, done) + rewards + control-plane |
| | reward-rules | rewards |
| operations (500) | ship-gate-and-migrations | verification (gate), control-plane (runner) |
| | integration-and-e2e, security-hardening | verification |
| | transactional-email | control-plane |

A feature of TGT-00 counts as BUILT when every requirement listed for it in the roadmap file has a passing test named after the requirement id (e.g. `it("magic-link-sign-in R-001 ...")`), merged at a wave gate.

## 7. Contracts 2.0.0 (Wave 1 gate) — what each workstream must change

Rulings are in `blockers/B-*.md` (the `decision` field). Rebase onto the architect commit that carries contracts 2.0.0, then:

| Workstream | Must change |
|---|---|
| github-build | Implement `Orchestrator.signIn` (email, code or `wos://auth?r=&t=` deep link, poll secret in memory only) and `linkGithub` (device flow); delete `login`. Delete `packages/github/src/internal/hash.ts` and the orchestrator's own `submissionSha256`/signing code: import `@waronsaas/contracts/canonical` (`canonicalJson`, `sha256Of`, `gitBlobOid`, `submissionSha256`, `signChangeset`, `encodeDevicePublicKey`, `provenanceSha256`). Fetch server documents with `getLeaseDocument`. Put `local:verification-output` into repair-run manifests and post a new manifest per run. Set `ContextPlan.taskKind` handling to trust the plan. Comment `WorktreeHandle.branch = "HEAD"` for detached worktrees. |
| context-policy | Make `EligibilityInput.now` required (keep `excludedAccountIds`, `restrictedToAccountId`); count the author lease family with `maxConcurrentAuthorLeasesPerContributor`; exempt `bootstrap_self` from the same-author cap when `exemptSelfReviewFromSameAuthorCap`; use `ContextPlan.taskKind` (drop `taskKindForPlan` inference); support `local_document`; reject `wos:verdict/` refs and any server_document ref not in the plan; replace the context-engine JCS with a re-export from `@waronsaas/contracts/canonical`; apply `trailingArgs` and the drop-empty-flag rule in `buildInvocation`; render the new builder obligation and implementation-reviewer rule verbatim. |
| verification | Delete `src/jcs.ts` and the local `computeSubmissionSha256` / `changesetSigningPayload` / key parsing: import from `@waronsaas/contracts/canonical` (PEM/SPKI keys are no longer accepted). Add `TOOLCHAIN_WITHOUT_RESOURCE` to `validateChangeset` using `RepoManifest.toolchainPaths`. Update `templates/suite/wos.json` (`toolchainPaths` must include `DEFAULT_TOOLCHAIN_PATHS`) and `wos-verify.yml` (restore toolchain paths and read verify steps from the base; add the non-required candidate-toolchain job). Remove the `it.fails` markers from the five B-0003 tests and give their fixtures real task/lease/manifest bindings and a maintainer role for bootstrap cases. Move suites to `tests/**` if wanted (now included). |
| control-plane | Apply `0002_backstops.sql`; implement `getLeaseDocument`; accept several manifests per lease; pass `now`, `excludedAccountIds`, `restrictedToAccountId` to `checkEligibility`; store device keys in the C-5 encoding; hash and verify only via `@waronsaas/contracts/canonical`; set `taskKind` in every plan; qualification requests maintainer review when a toolchain path changed. |
| planning (Wave 2) | Build-graph rule `TOOLCHAIN_WITHOUT_RESOURCE`; planning-role templates now in `packages/context-engine/templates/`. |
| cli, desktop (Wave 2) | Call `signIn` / `linkGithub`; the desktop registers `wos://` and forwards deep links to `SignInPrompt.deepLinks`. |

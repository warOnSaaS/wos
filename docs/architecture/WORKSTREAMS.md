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
| 3 | all (end to end), led by verification | The spec's FINAL V1 INTEGRATION TEST with real accounts, the real App on `waronsaas/product`, real Claude Code and Codex, the Salesforce roadmap v1 mapping the CRM capability, one Feature Contract at consensus, two ABUs of one feature built in parallel |

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

- **Owns:** `packages/verification/**`, `tests/**` (integration and e2e suites at the repo root), `.github/workflows/**` of the platform repo, `templates/product/**` (the product repo's `wos.json`, `wos-verify.yml`, CODEOWNERS and ruleset documentation), `scripts/ship.sh` (the ship gate, D7), `docs/dogfood/verification.md`.
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

## 7. Wave 1 gate: rebase briefs (contracts 3.0.0)

Every Wave 1 workstream rebases ONCE onto the architect commit carrying contracts 3.0.0 (2.0.0 was never merged; its changes are included). Rulings with reasons: `blockers/B-*.md` (`decision` field). Changelog: `docs/architecture/CHANGELOG-CONTRACTS.md`. After rebasing, `npm run check` and `npm run db:test` must be green at the root, plus the proving tests listed per brief.

### 7.1 github-build (ws/github-build)

What changed in contracts: `Orchestrator.login` removed, `signIn` + `linkGithub` + `SignInPrompt` + events `sign_in`/`github_link` added; `@waronsaas/contracts/canonical` is the only hashing/signing code; `ContextPlan.taskKind` required, `source.commit` = submission parent, `local_document` artifacts; `getLeaseDocument` route (`GET /v1/leases/:id/documents?ref=`); views: `AttemptView`/`TaskView` use `feature` + `relevantTo` + `repo`; `ProvenanceRecord.prNumber` rule; github/app additions ratified.

You must:
1. Replace `login` with `signIn(input, prompt, observer)`: `startEmailSignIn` with the device public key from `encodeDevicePublicKey`, keep the poll secret in memory only, race `prompt.code()` against `prompt.deepLinks` (accept only `wos://auth?r=<requestId>&t=<token>` whose `r` matches), `redeemEmailSignIn`, store session + device id in `SecretStore`. Add `linkGithub(observer, openUrl)` over `startGithubLink` (flow `device`) and `pollGithubLink`, surfacing `GITHUB_LINKED_ELSEWHERE` / `GITHUB_RESERVED`.
2. Delete `packages/github/src/internal/hash.ts` and the orchestrator's `submissionSha256` / `signChangeset`; import `canonicalJson`, `sha256Of`, `gitBlobOid`, `submissionSha256`, `signChangeset`, `provenanceSha256`, `encodeDevicePublicKey` from `@waronsaas/contracts/canonical`.
3. Implement `SnapshotReader.readServerDocument` with `getLeaseDocument` (query `ref`) and check the returned sha256 against the plan.
4. Repair runs: add the `local:verification-output` local document and post a new manifest per agent run; cite the producing run's manifest in the changeset.
5. Use `plan.taskKind` and `plan.source.commit` as given (no inference).
6. Add to `@waronsaas/github/app`: `getBranchHead`, `readFileAt`, `listTreePaths`, `moveBranch(creds, repo, branch, sha, {expectedHeadSha} | {force: true})`, `compareDiff`, `webAuthorizeUrl(creds, {state, redirectUri})`; keep the 2.0.0 additions. All repo operations take the repo from the ABU/document (`repo`), never a constant.
7. Comment `WorktreeHandle.branch` = `"HEAD"` for detached worktrees.

Proving tests: canonical vectors reproduce through the orchestrator (sign a fixture changeset and compare with `packages/contracts/test/canonical.test.ts` values); `signIn` via code, via deep link, and with a deep link for a different request id (ignored); `linkGithub` refused path; fake-API run fetching server documents by query ref; repair run posts two manifests; each new App function against the content-addressed fake.

### 7.2 context-policy (ws/context-policy)

What changed: `ContextPlan.taskKind` (required), `target` nullable (feature work), `local_document` selector and manifest kind, reserved `wos:verdict/` refs, template ownership by file, canonical module, policy data (`trailingArgs`, drop-empty-flag rule, `maintainersExempt`, `waiveMinAcceptedContributions`, `exemptSelfReviewFromSameAuthorCap`, `maxConcurrentAuthorLeasesPerContributor`, new builder obligation and implementation-reviewer material rule).

You must:
1. `EligibilityInput.now` REQUIRED; keep `excludedAccountIds`, `restrictedToAccountId`; add the author lease family (`roadmap_author` + `feature_author` + `conflict_resolution`, limit 1); do not count or cap `bootstrap_self` reviews for the same-author rule; apply `maintainersExempt` and `waiveMinAcceptedContributions`.
2. Remove `taskKindForPlan`; copy `plan.taskKind` into the manifest. Handle `target: null`.
3. `checkManifestAgainstPlan`: reject any `server_document` ref not in the plan, any `wos:verdict/` ref (exact prefix, no loose variants), and `wos:findings/<subject>@k` in a reviewer plan unless k <= round - 1; accept `local_document` only for `local:verification-output`.
4. Replace the context-engine JCS with a re-export of `canonicalJson` / `canonicalSha256` / `computeManifestSha256` from `@waronsaas/contracts/canonical`.
5. `buildInvocation`: argv = base + mode + reasoning + outputSchema + `trailingArgs`; drop a flag whose list placeholder is empty.
6. Templates stay in `packages/context-engine/templates/`; the planning workstream will own `tpl.roadmap_*`, `tpl.feature_*`, `tpl.conflict_resolver*` from Wave 2 (leave your current drafts in place for them).

Proving tests: invocation snapshots for all ten roles (codex `-` last, no dangling `--allowedTools`); eligibility table rows for no-clock (fails closed), author family limit, bootstrap_self beyond 5/week allowed, maintainer and bootstrap waivers; manifest checks rejecting `wos:verdict/`, an unplanned ref and a current-round findings ref; manifest hashes equal `computeManifestSha256` from contracts.

### 7.3 verification (ws/verification)

What changed: canonical module; `RepoManifest.toolchainPaths` + `DEFAULT_TOOLCHAIN_PATHS`; `toolchain:` resources and `TOOLCHAIN_WITHOUT_RESOURCE`; migrations 0002 and 0003; `profileAcceptanceCheckName`; `tests/**` now included.

You must:
1. Delete `src/jcs.ts`, the local `computeSubmissionSha256`, `changesetSigningPayload`, `ed25519Key`; use `@waronsaas/contracts/canonical` (`submissionSha256`, `verifyChangesetSignature`). PEM/SPKI keys are now invalid.
2. `validateChangeset`: emit `TOOLCHAIN_WITHOUT_RESOURCE` for any path matching `repoManifest.toolchainPaths` (picomatch) unless the ABU holds exclusive `toolchain:<path>`.
3. `templates/product/wos.json`: `toolchainPaths` includes every `DEFAULT_TOOLCHAIN_PATHS` entry. `wos-verify.yml`: (a) the required job restores every toolchain path from the base commit and reads install/verify steps from the base `wos.json`; (b) a non-required `wos-verify-candidate-toolchain` job when the candidate touches toolchain paths; (c) on push to the default branch, one check run per profile named `wos-acceptance/<feature>/<target>` running that profile's acceptance command.
4. Adversarial DB suite: drop the five `it.fails` markers (B-0003 is closed by 0002); give fixtures real task/lease/manifest/agent-run bindings (`reviews.agent_run_id` is now required), `repo_full_name` on documents/catalog features/ABUs, and the maintainer role for bootstrap cases. Add: review citing another lease's agent run is rejected; TGT-00 roadmap outside the platform repo is rejected. Move suites to `tests/**` if you want.

Proving tests: vector suite passes via contracts canonical; one test per toolchain case (package.json edit with and without the resource); workflow lint asserting the base-restore step and acceptance check names; the five former KNOWN GAP tests green as plain `it`; mutation check: removing the 0002/0003 triggers turns them red.

### 7.4 control-plane (ws/control-plane)

What changed: everything above plus the events and route changes from your blockers.

You must:
1. Apply migrations 0002 and 0003 (runner). Write `repo_full_name` on catalog features, documents and ABUs from their parent (TGT-00 = `waronsaas/wos`); pass it to every GitHub call.
2. Views and plans: `TaskView`/`AttemptView` with `target | feature`, `relevantTo`, `repo`; `ContextPlan.target` null for feature work; `taskKind` in every plan; `listOpenTasks` `feature` filter. Remove the lowest-rank-app workaround.
3. Serve `getLeaseDocument` at `GET /v1/leases/:id/documents?ref=` from your existing renderer; 403 for refs outside the lease plan. Accept several manifests per lease.
4. Events: `attempt.created` on attempt creation (no state_changed from "none"); your six workaround events become the contract types and PUBLIC; `verification.recorded` when you store any `verification_runs` row.
5. Submissions: keep commit-inside-the-request; one transaction records changeset, candidate commit, `verifying -> submitted -> candidate_pushed`; replace `changesetSigningBytes` with `changesetSigningPayload`/`verifyChangesetSignature` from `@waronsaas/contracts/canonical`; store device keys only in the raw 32-byte base64 form.
6. Reviews: persist `agent_run_id` from `submitVerdict`; qualification check 7 uses exactly that run.
7. Profile acceptance: on `check_run` completed with name `wos-acceptance/<feature>/<target>`, insert `verification_runs` (subject `profile_acceptance`) and recompute progress with `profileAcceptancePassed` per ROADMAP-PROTOCOL section 6.
8. Eligibility: pass `now`, `excludedAccountIds`, `restrictedToAccountId`. Qualification: request maintainer review when a toolchain path changed.
9. Map your `GithubPort` 1:1 onto the ratified github/app names (`startDeviceAuthorization`, `webAuthorizeUrl`, `getBranchHead`, `readFileAt`, `listTreePaths`, `createBranchAt`, `moveBranch`, `deleteBranch`, `closePullRequest`, `compareDiff`).
10. Token hashing stays HMAC-SHA256 with `SESSION_TOKEN_PEPPER` (now normative).

Proving tests: the "every 2xx parses with its route schema" scenario on the new shapes; server-document fetch by query ref and 403 for an unplanned ref; a feature-work task view with `target: null` and two `relevantTo` apps; submit with a failing fake App commit records nothing and a retry with the same key succeeds; a verdict whose agent run belongs to another lease is refused; a profile-acceptance check run moves a feature to BUILT 10000 in the fake end-to-end run; every emitted event parses as `DomainEvent`.

## 8. D13 (contracts 4.0.0): who builds surfaces and experience in Wave 2

| Workstream | Owns for D13 | Proving tests |
|---|---|---|
| planning | `validateRoadmap`: every inventory surface appears in `roadmap.surfaces`; `validateBuildGraph`: `ABU_REPO_UNKNOWN` (repo not in the family), `SHARED_API_MISSING`, `JOURNEY_UNCOVERED`, `REQUIREMENT_SURFACE_NOT_IN_SCOPE`, `NATIVE_CAPABILITY_UNPLANNED`; planning-role templates render the D13 obligations and rules | one failing fixture per new code; the TGT-00 bundle converted to files passes |
| control-plane | materialise `target_surfaces`, `app_feature_surfaces` and `app_features.journeys` on roadmap merge, `requirement_surfaces` on contract merge (remove the one-web-surface fallback once written); store `ToolchainAttestation` from `postAttestation` into `toolchain_attestations`; compute toolchain requirements at claim; record per-surface acceptance (already adapted) | a roadmap with web + ios materialises both; a Linux device cannot claim an ABU under `apps/mobile/ios/**`; iOS and Android acceptance recorded separately |
| context-policy | eligibility step for toolchain requirements (AGENT-POLICY.md section 5); builder context includes matching `toolchainRequirements`; roadmap and feature contexts include surfaces and journeys | eligibility table rows for macOS/Xcode present, missing, too old; JS-only mobile ABU eligible on Linux |
| github-build | `wos status` / Desktop collect a `ToolchainAttestation` (os, version, `xcodebuild -version`, Android SDK, Node) and post it | status output snapshot on macOS and Linux fakes |
| verification | `templates/product`: Playwright browser-matrix runner for web suites (`WOS_BROWSERS`), Maestro runner for iOS and Android suites, macOS jobs only for native iOS, EAS release workflow in the protected environment; `wos.json` template with `toolchainRequirements` for `ios/`, `android/`, config plugins and native modules; adversarial: a web suite missing a browser, a native ABU claimed from Linux | workflow lint (runner selection, secrets only in `release`), fixture repo runs each surface suite |
| web | per-surface progress and journeys on app and feature pages (`TargetDetail.surfaces`, `AppFeatureSummary.surfaces`, `journeys`); excluded surfaces with reasons | a page test that renders web, iOS and Android numbers from the API response |
| cli, desktop | nothing new beyond the attestation shown in status | — |

TGT-00 mapping for the new capability `surfaces` (weight 700): multi-repo-products → control-plane + planning; toolchain-eligibility → context-policy + control-plane + github-build; native-ci-runners → verification; per-surface-acceptance → verification + control-plane; mobile-app-signing → verification.

## 9. D14: web copy and URL changes (for the web workstream; the architect does not edit apps/web)

- `lib/site.ts` `LINKS`: `repo` → `https://github.com/waronsaas/wos`, `releases` → `https://github.com/waronsaas/wos/releases/latest`, `pullRequests` → `https://github.com/waronsaas/wos/pulls` (and add `product: https://github.com/waronsaas/product` for the suite's code). `DOWNLOADS` hrefs follow `releases`.
- Any copy that says we build "an app for each product" or "a Salesforce app": the replacements are modules of ONE open-source suite (one account, one navigation, one data model, one phone app for iPhone and Android); each Sniper List target page describes the parity profile (what the suite must do to fully replace that product) and its progress per surface (web, iPhone, Android).
- `data/targets.ts` / API switch: drop any per-target product path; `TargetSummary.productPath` no longer exists in contracts 4.0.0.
- `llms.txt` / `llms-full.txt` and the about/how-it-works pages: the same repository names and the one-suite model.
- TGT-00 page: repository `waronsaas/wos`; roadmap from `docs/roadmap/waronsaas.roadmap.json` (now with surfaces, journeys and the `surfaces` capability).

## 10. D15 (contracts 4.1.0): who picks it up

| Workstream | Change |
|---|---|
| context-policy (next session) | `checkEligibility`: per-provider build-lease limit; honour a model chosen at claim; effective budget from `budgetOverrides`; `buildInvocation` snapshot for an Astra builder and Astra authors |
| github-build (building now) | orchestrator: let the contributor choose the builder model (`wos build --model astra`, Desktop picker); capture codex runs for builds; fill `provider` in agent-run provenance |
| control-plane | claim body may name the model; per-provider lease count; `AttemptView.builtWith`; provenance `agentRuns[].provider` |
| web (building now) | show "built with Opus/Astra" on ABU and PR drilldown from `builtWith` / provenance |
| planning, rewards (building now) | nothing required; rewards stay per unit regardless of provider |
| cli, desktop | model choice in `wos build` and the BUILD flow |

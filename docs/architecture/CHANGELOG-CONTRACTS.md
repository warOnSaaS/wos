# Contracts changelog

## 1.0.0 — 2026-09-29 (Wave 0, Lead Architect)

Initial frozen contracts: `packages/contracts` (state machines, domain read models, API route map, events, artifacts including the global Feature Catalog, roadmaps with reasoned weights and per-app requirement profiles, build graphs, agent I/O and signed submissions, ledger, progress functions, orchestrator interface, blocker schema), `agent-policy.v1` and `rewards.v1` (proposal) data, and `packages/db/migrations/0000_meta.sql` + `0001_init.sql`. Incorporates founder decisions D1–D12 and the naming rule.

## 2.0.0 — 2026-09-29 (Wave 1 gate, Lead Architect)

MAJOR. Rulings in `blockers/B-*.md`.

- `Orchestrator.login` removed; `signIn(input, prompt, observer)` (D8 email sign-in, code or `wos://auth?r=&t=` deep link bound to the poll secret) and `linkGithub(observer, openUrl)` added; `SignInPrompt`; events `sign_in`, `github_link`. (B-0003-github-build)
- New entry point `@waronsaas/contracts/canonical`: the only JCS, sha256, diff-hash, signing-payload, Ed25519 key encoding, manifest/provenance hash and git blob id implementation, with test vectors. Device keys are base64 of the raw 32 bytes. (B-0002-github-build, B-0004-github-build, B-0001-verification)
- `ContextPlan.taskKind` (required); `ContextPlan.source.commit` defined as the submission parent for builds and revisions; artifact kind `local_document` (`local:verification-output`); reserved ref `wos:verdict/<roundId>/<slot>`; route `getLeaseDocument`; several manifests per lease. (B-0001-context-policy, B-0004-github-build, B-0004-verification)
- `RepoManifest.toolchainPaths` (must include `DEFAULT_TOOLCHAIN_PATHS`), resource prefix `toolchain:`, error codes `TOOLCHAIN_WITHOUT_RESOURCE` (changeset and build graph); new builder obligation and implementation-reviewer material rule. (B-0005-verification)
- Agent policy data: `trailingArgs` (codex stdin `-` last), drop-empty-list-flag rule, `eligibility.maintainersExempt`, `bootstrap.waiveMinAcceptedContributions`, `bootstrap.exemptSelfReviewFromSameAuthorCap`, `limits.maxConcurrentAuthorLeasesPerContributor`, two more UNVERIFIED items. (B-0001/B-0002-context-policy)
- `ProvenanceRecord.prNumber` rule (App opens the PR, then fills the number and PATCHes the body). (B-0002-github-build)
- Migration `0002_backstops.sql`: review bound to task/lease/slot/manifest; bootstrap labels only in bootstrap mode and only for maintainers; bootstrap mode one-way; private events hidden from other accounts; raw Ed25519 device keys. (B-0003-verification)
- Root `vitest.config.ts` / `tsconfig.test.json` include `tests/**`. (B-0002-verification)
- Additive `@waronsaas/github/app` exports ratified (createBranchAt, deleteBranch, closePullRequest, startDeviceAuthorization, configureGithubApp/resetGithubAppConfig, GithubAppError, renderPullRequestBody, renderProvenanceSection; local: configureLocalGit, isBlockingRejection, CaptureRejectReason). (B-0001-github-build)

Affected workstreams: github-build, context-policy, verification, control-plane (all must rebase; WORKSTREAMS.md section 7), planning, cli, desktop (Wave 2 briefs).

## 3.0.0 — 2026-09-29 (Wave 1 gate, control-plane findings)

MAJOR (2.0.0 was never merged by any workstream, so every workstream rebases once, onto 3.0.0). Rulings in `blockers/B-*-control-plane.md` and `blockers/B-*-architect.md`.

- Work subject model: `TaskView.target`, `ContextPlan.target`, `ContextManifest.target` nullable (set only for roadmap work); `TaskView.feature/relevantTo/repo`; `AttemptView.target` replaced by `feature`, `relevantTo`, `repo`; `AbuSummary.repo`; `listOpenTasks` gains a `feature` filter. (B-0001-architect)
- `getLeaseDocument` moves the ref to the query string: `GET /v1/leases/:id/documents?ref=`. `UPSTREAM_GITHUB` added to `claimBuild`, `claimTask`; implicit errors documented. (B-0003-control-plane)
- Events: `attempt.created`, `document.state_changed`, `round.cancelled`, `contribution.state_changed`, `proposal.state_changed`, `blocker.state_changed`, `inventory_version.state_changed`, `verification.recorded` (all public). (B-0002-control-plane, B-0006-architect, B-0007-architect)
- Submissions are committed inside the request; guards reworded; no retry-later path. (B-0004-control-plane, B-0008-architect)
- `profileAcceptanceCheckName(feature, target)` and the acceptance recording rule. (B-0007-architect)
- Migration `0003_subjects_and_runs.sql`: `repo_full_name` on catalog_features, documents, abus with a consistency trigger; `reviews.agent_run_id` bound to a valid signed run of the same lease and manifest; `inventory_versions.row_version`; profile-acceptance index. (B-0002/B-0003/B-0005-architect)
- Docs: token hashes are HMAC-SHA256 with `SESSION_TOKEN_PEPPER`. (B-0004-architect)
- github/app additions ratified: `getBranchHead`, `readFileAt`, `listTreePaths`, `moveBranch`, `compareDiff`, `webAuthorizeUrl` (plus the 2.0.0 set). (B-0001-control-plane)

## 3.1.0 — 2026-09-29 (Wave 1 integration gate)

MINOR. Rulings in the four blocker files below.

- `ContextPlan.roundNumber` (optional, set for review plans). (B-0003-context-policy)
- `SnapshotReader.readLocalDocument(ref)` in `@waronsaas/context-engine` ratified as the only channel for `local_document` artifacts. (B-0005-github-build)
- `@waronsaas/github/app` `requestTeamReview(creds, repo, prNumber, teamSlug)` ratified; `document.opened.target` nullable and `relevantTo` added (default []). The nullable widening is recorded as MINOR by architect decision: its only producer requested it and nothing consumes it yet. (B-0005-control-plane)
- Migration `0004_manifest_per_lease.sql`: a context manifest is unique per (lease, manifest sha), not globally, because a deterministic engine gives a re-claimed task the same manifest (found at the integration gate).
- Built-in builder rule: inside `features/` only `features/<f>/acceptance/**` is writable; `features/**` removed from the suite template's protectedPaths. (B-0006-verification)

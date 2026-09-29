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

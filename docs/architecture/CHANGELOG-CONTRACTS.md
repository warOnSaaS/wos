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

## 4.0.0 — 2026-09-29 (D13: features AND experience, on every surface)

MAJOR.

- `Surface` and `Browser` enums, `MINIMUM_BROWSERS` (Chrome, Edge, Safari macOS, Firefox, iPhone and Android phone viewports).
- Inventory `surfaces` (with evidence and browsers); Roadmap `surfaces` (in scope with repo and path, or excluded with reason); `RoadmapFeatureRef.surfaces` (reasoned surface weights summing to 10000) and `journeys` (`Journey`: steps, entry points, platform behaviour, native capabilities); schema checks for all of it.
- `Requirement.surfaces`; `FeatureContract.journeys` (linked to requirements) and `sharedApi`; `RequirementProfile.acceptance` is per surface (`SurfaceAcceptance`: browsers, runner); `AbuSpec.repo`; new build-graph codes.
- `RepoManifest.toolchainRequirements` (path-based) and `browsers`; `ToolchainAttestation` in `postAttestation`.
- `profileAcceptanceCheckName(feature, target, surface)` → `wos-acceptance/<feature>/<target>/<surface>`.
- Progress per surface (`FeatureProgress.surfaces`, `AppProgress.surfaces`); a feature is complete only when every in-scope surface is.
- Views: `TargetDetail.surfaces`, `AppFeatureSummary.surfaces` and `journeys`, `RequirementView.surfaces`; event `verification.recorded.surface`.
- Policy data: D13 obligations for roadmap and feature authors and the builder; material-finding rules for all reviewers (missing surface, missing journey, surface mis-weighting, missing browser, native capability unplanned, vendor trade dress).
- `PRODUCT_REPO = "waronsaas/product"` (founder; briefly `waronsaas/replacements` the same day); templates renamed to `templates/product`.
- Migration `0005_surfaces.sql`: repository registry and family rule for ABUs, `target_surfaces`, `app_feature_surfaces`, `app_features.journeys`, `requirement_surfaces`, `verification_runs.surface`, `toolchain_attestations`; product targets moved to `waronsaas/product`.
- TGT-00 roadmap: surfaces (web, desktop, CLI), journeys and surface weights for every feature, and the new capability `surfaces` (multi-repo products, toolchain eligibility, native CI runners, per-surface acceptance, mobile app signing).

Integration adaptations made by the architect so `main` stays green (owners review in Wave 2): control-plane progress input (surfaces from `app_feature_surfaces`, requirement tags, per-surface acceptance; features mapped before D13 fall back to one web surface), per-surface check-run parsing in webhooks, public views; verification CI (`wos-ci.mjs` profiles and acceptance per surface, workflow job name and runner), vectors and template fixtures; `repo` in ABU fixtures of context-engine, orchestrator and control-plane tests; golden hashes.
- D14 (folded into 4.0.0): `PLATFORM_REPO = "waronsaas/wos"`; the product is ONE suite: `RepoManifest.products` replaced by `apps` (surface → app shell path), `ARTIFACT_PATHS.product` replaced by `webApp`/`mobileApp`, `TargetSummary.productPath` removed (`targets.product_path` dropped in 0005), repository registry uses `waronsaas/wos`; roadmap author obligation and reviewer rule against target-specific apps.

## 4.1.0 — 2026-09-29 (D15: two agents per contributor)

MINOR.
- Policy data: `builder` allows `opus` and `astra`; `roadmap_author` and `feature_author` also allow `astra`; `RolePolicy.budgetOverrides` (per-model budgets; Astra entries); `limits.maxConcurrentBuildLeasesPerProvider` = 1 (total stays 2); codex `workspaceWriteArgs` add `sandbox_workspace_write.network_access=false`; two UNVERIFIED items about codex sandbox confinement and the missing per-command allowlist.
- `ModelRef` gains `sol` (gpt-6-sol), builders only; policy `models[]` adds Sol.
- Correction: `codex debug models` reports a 272000 window at 95% effective for Astra and Sol; `contextWindowTokens` is now 258000 (was an UNVERIFIED 400000), and Astra reviewer and author budgets get overrides that fit.
- Optional fields: `ProvenanceRecord.agentRuns[].provider`, `AttemptView.builtWith`.

## 4.2.0 — 2026-09-29 (Wave 2a gate)

MINOR (additive for consumers; the one implementer of `Orchestrator`, github-build, adds the four read methods).
- `ClaimResponse.round` {id, number, headSha, submissionSha256} for review claims (B-0008-github-build).
- `LocalStatus.toolchain`; `ToolName` enum (`node`, `xcode`, `android-sdk`) for attestations and `toolchainRequirements`; `compareToolVersions` (B-0006-github-build).
- `Orchestrator.listClaimableAbus`, `listOpenTasks`, `myWork`, `events` (B-0009-github-build).
- `PROMPT_TEMPLATE_BY_ROLE` moves to contracts; `FeatureContractErrorCode`; `BuildGraphErrorCode.CONTRACT_VERSION_MISMATCH` (B-0001/B-0002-planning).
- `picomatch` dependency for `@waronsaas/planning`.
- Protocol text: REWARD-PROTOCOL section 8, REVIEW-PROTOCOL section 11, FEATURE-CONTRACT section 9.

## 4.3.0 — 2026-09-29 (B-0010-github-build)

MINOR, additive.
- `claimBuild` and `claimTask` bodies: optional `model: ModelRef`. The server checks it is in the role's `allowedModels` and attested by the device (`NOT_ELIGIBLE` otherwise; a second build lease on the same provider is `LIMIT_REACHED`). When omitted, the server uses the first entry of the role's `allowedModels` (in policy order) that the device attests: Opus for builders. The plan's model, modelId, provider, reasoning and budget (with `budgetOverrides`) follow the chosen model, and the manifest must match the plan. For `conflict_resolution` the only model is Fable.
- `BuildOptions.model?: ModelRef`. `AuthorOptions.model` is now documented as sent in the `claimTask` body.
- For implementers: the control plane passes the requested model to eligibility (`EligibilityInput.requestedModel?: ModelRef`, which the context-policy workstream adds to `@waronsaas/agent-policy`), and the orchestrator sends the field.

## 5.0.0 — 2026-09-30 (Amendment 01: one product; D16, D17)

MAJOR: `FeatureContract.surfaces` is required.
- New module `wos-app.ts` (node-free):
  - `WosAppManifest` (`wos-app/v1`), `ModulePackage`, `AppRegistryEntry`;
  - `Organization`/`OrganizationView`/`OrgRole`, `EntitlementState`, `AppEntitlement`, `OrgApps`;
  - `EnvironmentDescriptor`/`EnvironmentAuth`/`EnvironmentTokenClaims`/`ActiveApps`, `CoreRoutes`, `MobileScreen` (`wos-screen.v1`);
  - `ProductSurface`, and the helpers `activeAppIds`, `satisfiesRange`, `compareSemVer`.
- `canonical.ts` C-6: `modulePackageSigningPayload`, `verifyModulePackage` (pinned keys).
- State machines: `EntitlementMachine`, `AppReleaseMachine`, `ModuleInstallMachine`; actors `account` and `client`.
- Events: `organization.created`, `organization.member_changed`, `entitlement.changed`, `app.release_published`, `app.release_yanked`.
- API:
  - `AppRoutes`, served by the control plane from Wave 3: registry, organizations, org apps, enable/disable, environment tokens and keys, app releases.
  - Error codes `NOT_ENTITLED`, `DEPENDENCY_NOT_ENABLED`, `DEPENDENT_ENABLED`.
  - `NOT_ENTITLED` on `claimBuild`, `claimTask` and `claimReview` (the Build gate, D16).
  - `HOSTS.app` and `HOSTS.core`.
- `Surface` gains `api`.
- Artifacts:
  - `FeatureContract.surfaces` (required; per surface `required` and `capabilities`, with consistency refinements).
  - `Roadmap.apps` (target → applications); a product-repo roadmap may not put a non-product surface in scope.
  - `ARTIFACT_PATHS` gains `apiApp`, `desktopApp`, `appManifest` and `appDir`.
- Migration 0006:
  - organizations, memberships, app_registry, app_releases, app_entitlements, target_apps, environments;
  - `api` in the surface checks;
  - backfill of personal organizations with Build enabled for existing accounts.
- Docs: `WOS-APP-PROTOCOL.md`, ARCHITECTURE section 14, SECURITY S-37..S-42, DOMAIN-MODEL section 8, FEATURE-CONTRACT and ROADMAP-PROTOCOL surface sections, WORKSTREAMS section 12, GAPS G-59..G-65, FOUNDER-CHECKLIST sections 12–13, DECISIONS D16/D17.

## 4.4.0 — 2026-09-30 (Wave 2 gate)

MINOR, additive.
- `Orchestrator.updateMe(patch)` (B-0003-desktop).
- `TargetDetail.basis?: "merged" | "proposed"`; `AppFeatureSummary.state` also accepts `"proposed"`; `RequirementView.acceptance?: string[]` (B-0001-web).
- `RepoManifest.toolchainRequirements[].paths` must be anchored (no leading `*`/`**`) so JS-only ABUs do not inherit macOS requirements (control-plane flag).
- Documented: a 422 `SCOPE_VIOLATION` carries `ChangesetValidation` in `error.details` (B-0006-control-plane).
- SECURITY S-29 amendment: Desktop main may open exactly `https://github.com/login/device` from `linkGithub` (B-0002-desktop).
- Dependencies (one lockfile change): `esbuild` (CLI bundle, B-0001-cli), `electron-updater` (B-0006-desktop), `picomatch` declared in agent-policy (B-0004-context-policy); `apps/web` joins the workspaces (B-0001-web, two-step adoption, ARCHITECTURE section 9).
- Root test config: Desktop tests included; `testTimeout` 30 s, `hookTimeout` 60 s (B-0001-desktop, B-0007-verification).
- Gate clarifications, no schema change:
  - An omitted claim `model` is the first attested allowed model, with no fallthrough to another provider (agent-policy had drifted; it is fixed, and the control plane now passes `requestedModel` and maps refusals with `eligibilityRouteError`).
  - There is one toolchain matcher, agent-policy's `scopeCanTouchGlob`. The control plane's literal-prefix copy made `apps/mobile/ios/**` require the Android SDK.
  - The product template's `**/*.podspec` is anchored to `modules/*/native/*.podspec`.
  - `github/local` serialises mirror work per repository (B-0005-desktop).

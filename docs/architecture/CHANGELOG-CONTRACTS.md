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

## 5.1.0 — 2026-09-30 (white paper assessments, architect role for the assessments workstream)

MINOR, additive. No route, no migration.
- New module `assessment.ts`, exported only as the subpath `@waronsaas/contracts/assessment` (not from the barrel, so the product repo's vendored CI bundle is unchanged). It imports only zod, so plain `node` scripts can import it by path:
  - `AssessmentBlock` (`wos-assessment/v1`): the score block an evaluating agent appends to its report on the white paper (v0.7 brief): paper version, self-reported evaluator, date, stage 1 (problem real, importance 0–100 as five 0–20 dimensions whose sum must equal the total, the four theses each importance 0–10 / compelling 0–10 / confidence, overall confidence) and stage 2 (effectiveness 0–100, credibility 0–100, readiness class, verdict ignore/watch/test/participate, confidence).
  - `AssessmentRecord` (`wos-assessment-record/v1`): one reference run stored as `docs/assessments/<id>.json` with the verbatim report in `<id>.md`; source is only `reference run by warOnSaaS` (founder, 2026-09-30: no reader submissions).
  - `extractAssessmentBlock(report)`: finds the last fenced `wos-assessment` block (or a `json` block declaring the schema) and validates it; never guesses values.
- Golden files that embed the contracts version (context-engine manifest hashes, CLI golden output) re-recorded for 5.1.0; no other change in them.

## 5.2.0 — 2026-09-30 (Wave 3a architect: application progress, Build manifest, AppRoutes freeze check)

MINOR, additive. No migration. Wave 3a (control-plane, suite-shell, desktop, mobile-runtime, cli) builds against 5.2.0; WORKSTREAMS section 12.4 lists each workstream's exports.
- `progress.ts`: `computeApplicationProgress(ApplicationProgressInput)` with `ApplicationFeatureInput`, `ApplicationSurface`, `ApplicationProgress`, `ApplicationSurfaceProgress`, `ApplicationFeatureProgress` (WOS-APP-PROTOCOL section 11). Size points only, no weights of its own; a supported surface is capped at 99% until every feature with a requirement on it passed acceptance for at least one profile and every app feature has a merged contract; overall is the size-point-weighted mean, capped at 99% until every supported surface is complete; 0 with no merged work. Its input and `ProgressInput` are disjoint and neither has an organization, entitlement or install field; a type-level test freezes that (V1 proof step 9). progress.ts keeps its single import so apps/web's vendored copy still builds.
- Build's manifest `apps/desktop/src/apps/build/wos-app.json` (`build@0.1.0`: free, desktop only, `/build`, permission `build.contribute`, three navigation entries, no features, not self-hostable), validated by a contracts test.
- `wos-app.ts`:
  - Environment token wire format: `EnvironmentTokenHeader` (`alg` EdDSA, `typ` `wos-env+jwt`, `kid` `wos-env-NNNN`), `EnvironmentKey` (C-5 public key), `ENVIRONMENT_TOKEN_TTL_SECONDS` 900, `ENVIRONMENT_TOKEN_SKEW_SECONDS` 60, `ACTIVE_APPS_REFRESH_SECONDS` 60. Hosted Core takes the token as `Authorization: Bearer`.
  - `ModuleBundle` (`wos-module-bundle.v1`): the one JSON file Desktop downloads (signed `ModulePackage` plus base64 file contents).
  - `AppReleaseView` (one version, published or yanked) and `ApplicationProgressView`.
  - wos-screen.v1 data contract: `ScreenRecord`, `ScreenListData`, `ScreenRecordData`, `ScreenFormBody`, `ScreenInvokeResult`, and the HTTP semantics of each screen kind and action (doc comment).
  - `FieldSpec.options` for `select` inputs: required for select and only for select. This refinement tightens the schema. It is recorded as MINOR by architect decision because no `wos-screen.v1` file exists anywhere yet (the 3.1.0 precedent).
  - Clarified: `AppRegistryEntry` is built from the current release, so an app with no published release (core and build after 0006) is not listed, and `getApp` returns 404 for it. Its entitlement still exists and still gates.
- `canonical.ts` C-8: `signEnvironmentToken`, `verifyEnvironmentToken` (compact EdDSA JWS over canonical JSON, base64url).
- `api.ts` `AppRoutes`: `getAppRelease` (`GET /v1/public/apps/:app/releases/:version`), `getApplicationProgress` (`GET /v1/public/apps/:app/progress`); `getEnvironmentKeys` responds with `EnvironmentKey[]` (tightened; no producer existed); `publishAppRelease` documents the Build exception (no desktop package, source waronsaas/wos).
- `domain.ts`: `TargetSummary.apps?` (and so `TargetDetail.apps?`): the target's applications from `target_apps`.
- Regenerated, no other change: context-engine manifest golden hashes and CLI golden output (they embed the contracts version), the vendored validator bundle `templates/product/.github/wos/wos-ci-lib.mjs`, `apps/web/generated/contracts-progress.ts`.

Affected workstreams: control-plane, suite-shell, desktop, mobile-runtime, cli (section 12.4), and web (`TargetSummary.apps`, `getApplicationProgress`).

## 5.3.0 — 2026-09-30 (white paper self-assessment, architect role granted to the self-assess workstream for this one change)

MINOR, additive. No route, no migration. Only `packages/contracts/src/assessment.ts` (and `CONTRACTS_VERSION`).
- `AssessmentBlock` now accepts two schemas, told apart by `schema` (`z.discriminatedUnion`):
  - `wos-assessment/v1` (`AssessmentBlockV1`), unchanged: every record written under 5.1.0 stays valid.
  - `wos-assessment/v2` (`AssessmentBlockV2`, asked for by paper v0.9): v1 plus two **required**, bounded lists. `gaps` (at most `MAX_GAPS` = 10): `id` (lowercase slug, 3–48 chars, `GAP_ID_RE`), `title` (≤ 120), `concerns` (the paper section or thesis, ≤ 80), `part` (`I` the thesis, `II` the approach), `severity` (high/medium/low). `improvements` (at most `MAX_IMPROVEMENTS` = 10): `id`, `change` (≤ 240), `gap` (the id of a gap in the same block, or null), `raises` (1–4 of `IMPROVABLE_SCORES`). Ids are unique within each list; an improvement's `gap` must name a gap of the block.
- Why v2 and not optional fields on v1: the schema string says which brief a block answers. With optional fields, a v0.9 run that skipped the lists would be recorded as "no gaps"; with v2 the lists are required (empty means "looked, found none") and the runner refuses a block whose schema is not the one the served paper specifies.
- New exports: `ASSESSMENT_SCHEMA_V2`, `ASSESSMENT_SCHEMAS`, `CURRENT_ASSESSMENT_SCHEMA`, `AssessmentGap`, `AssessmentImprovement`, `SEVERITIES`, `PAPER_PARTS`, `IMPROVABLE_SCORES`, `hasGaps(block)`. `ASSESSMENT_SCHEMA` keeps its value (`wos-assessment/v1`). `AssessmentRecord` keeps `wos-assessment-record/v1`; its `block` widens to the union. `extractAssessmentBlock`'s json fallback recognises either schema.
- Golden files that embed the contracts version re-recorded for 5.3.0 where needed; no other change in them.

## 5.4.0 — 2026-09-30 (D59: every target roadmap plans getting customers off the target)

MINOR, additive. No route, no migration.
- `artifacts.ts`: `MIGRATION_DATA_CLASSES`, `MigrationDataClass`, `MigrationClassPlan`, `NotExtractable`, `RoadmapMigration`, `IMPORT_ENGINE_FEATURE` (`import-engine`), `PLATFORM_TARGET` (`waronsaas`), and `Roadmap.migration` (optional in the schema, so earlier documents still parse).
- `@waronsaas/planning` `validateRoadmap` (added by the architect with the coordinator's leave; the planning workstream owns it from here) refuses a target roadmap without the section or with a class unaccounted for. It adds the codes `MIGRATION_MISSING`, `MIGRATION_CLASS_MISSING`, `MIGRATION_CLASS_DUPLICATE`, `MIGRATION_CLASS_UNACCOUNTED`, `MIGRATION_EXTRACTION_MISSING` and `MIGRATION_FEATURE_NOT_IN_CATALOG`, with one failing fixture each. TGT-00 is exempt. For consumers this is a new rejection path of an existing validator. It is recorded as MINOR because no product roadmap exists yet.
- Policy data (`agent-policy.v1`):
  - a MIGRATION obligation for `roadmap_author` and an IMPORTERS obligation for `feature_author`;
  - material-finding rules for both roadmap reviewers and both feature reviewers.
- Docs: DECISIONS D59; ROADMAP-PROTOCOL section 2 "Migration" (importer guarantees, `import-engine` as TGT-00-stewarded shared infrastructure catalogued in the product repo, customer-owned OAuth credentials deferred to Amendment 03); WORKSTREAMS 12.5.
- Regenerated, no other change: context-engine golden hashes, CLI golden output, the vendored validator bundle.

Affected workstreams: planning (owns the new rule), context-policy (prompts carry the new policy text), control-plane (surfaces the new codes through document validation unchanged).

## 5.5.0 — 2026-09-30 (D60: architecture changes)

MINOR, additive. No migration yet: migration 0007 comes when the control plane serves it (WORKSTREAMS 13). No Wave 3a interface changed.
- New module `architecture.ts`:
  - `ArchitectureRecord` (`wos-architecture-record.v1`), `ArchElementKey`, `ArchitectureRecordId`;
  - `ARCHITECTURE_PATHS`, `architectureDocumentAllowedPaths`, `architecturePrTitle`, `architectureGraphKey`;
  - `architectureRegistry`, `architectureRecordIssues` (`ArchitectureRecordErrorCode`, 8 codes);
  - `computeArchitectureImpact`, `abuOffered`, `holdOutcome`, `rankWithArchitecture`, `ArchitecturePolicy`.
- Policy data `architecture-policy.v1.json` (`ARCHITECTURE_POLICY_V1`):
  - `maxRounds` 4 and a required maintainer sign-off;
  - `migrationBoost` 100000;
  - holds start at the record's merge and end when its migration merges or it is abandoned;
  - transitive dependents are not held;
  - in-flight review is not paused and runs with the record in context.
- `DocumentKind` gains `architecture`. `ResourceKey` accepts `arch:`. `FeatureContract.architecture` is optional.
- `BuildGraphErrorCode` gains `ARCH_ELEMENT_UNKNOWN`, `ARCH_PATH_WITHOUT_RESOURCE`, `ARCH_CHANGE_OUTSIDE_RECORD` and `ARCH_NOT_IN_CONTRACT`. Planning's `validateBuildGraph` runs them only when `BuildGraphContext.architecture` is passed, so existing callers are unaffected.
- `ArchitectureHoldMachine` (held -> released | superseded) is an overlay, and the ABU, attempt and task machines keep their states. The `TaskMachine` claim guard now also requires no active hold for `abu_build`; that is guard text only.
- Events `architecture.impact_computed` and `architecture.hold_changed`, both public.
- Docs:
  - DECISIONS D60;
  - ARCHITECTURE section 15 (design principle: what is architecture, what is local);
  - FEATURE-CONTRACT "Architecture elements and holds";
  - WORKSTREAMS 13;
  - `D60-PROTOCOL-DELTA.md`, the note for the protocol architect. It covers the build-next hold filter and boost term, ranking continuity on reissue and a release label; no accounting change.
- Regenerated, no other change: golden hashes and output, the vendored validator bundle.

Affected workstreams: control-plane, planning, context-policy (later, section 13); protocol (the delta note).

## 5.6.0 — 2026-09-30 (Wave 3a blocker rulings: B-0001/B-0002/B-0003-suite-shell, B-0007/B-0008-control-plane)

MINOR, additive, plus migration 0008. Rulings and who implements them: WORKSTREAMS 14.
- `wos-app.ts` (B-0001): `CoreRoutes.localSignInStart`, `localSignInRedeem`, `logout`; `LocalSignInStartBody`, `LocalSignInStartResponse`, `LocalSignInRedeemBody`, `LocalSignInRedeemResponse`.
- `blocker.ts` (B-0001): `Workstream` gains `suite-shell` and `mobile-runtime`.
- `api.ts` (B-0002, B-0008):
  - `startEmailSignIn.clientKind` gains `web_app` (wOS Web's server; body tokens; the link goes to `HOSTS.app + WEB_APP_SIGNIN_CODE_PATH`);
  - optional `csrfToken` in the `redeemEmailSignIn` and `refreshSession` responses;
  - `WEB_APP_SIGNIN_CODE_PATH`.
- `artifacts.ts` (B-0003): optional `RepoManifest.appMigrationsDir`. Planning's `validateBuildGraph` requires `db:migrations:<id>` exclusive for writes under an app's migrations (MIGRATION_WITHOUT_RESOURCE). The product template's `wos.json` now has `migrationsDir: null` and `appMigrationsDir: "applications/*/migrations"`.
- Migration `0008_build_release.sql` (B-0007):
  - Build's release may list desktop with no package;
  - new column `desktop_bundle_sha256`, allowed only with a package and immutable (not required, so the current control plane keeps working; it writes the hash at publish);
  - db assertions added;
  - numbered after ws/protocol's 0007 and commutes with it. It relaxes a check and adds a nullable column, recorded as MINOR by architect decision since it breaks no reader or writer.
  - Production: yes, by the coordinator through the runner (`--check` first).
- SECURITY:
  - S-5 amended: host-only cookies, HttpOnly `wos_csrf`, the CSRF value returned in web bodies;
  - new S-43: wOS Web is a server-side client.
- WORKSTREAMS: section 5 (contracts bump procedure: regenerate the validator bundle, the site's progress copy, the template's vendored contracts, the goldens), 12.4 (suite-shell exports), 14 (rulings, migration order 0007 protocol then 0008, next free 0009). WOS-APP-PROTOCOL section 8.
- Dependencies: `nodemailer` (and `@types/nodemailer`) as root devDependencies for the product template's SMTP transport (B-0003 item 4).
- Regenerated: goldens, the vendored validator bundle.

Affected workstreams: suite-shell, control-plane, desktop, mobile-runtime, verification, web.

## 5.7.0 — 2026-09-30 (D61: bugs and maintenance, the planning and build side)

MINOR, additive. No migration yet: 0010 comes with serving (WORKSTREAMS 15; 0009 went to B-0009).
- New module `bugs.ts`:
  - `BugId`, `BugSeverity`, `BugTaskKind`, `BUG_ISSUE_LABEL`;
  - `BugReport` (`wos-bug-report.v1`) with `renderBugIssueBody` / `parseBugIssueBody` / `bugIssueTitle` / `bugReportRefusals`;
  - `TriageOutcome`, `TriageDecision` (`wos-triage-decision.v1`);
  - `regressionTestPattern`, `regressionCheckName`, `RedGreenEvidence`, `redGreenRefusals`;
  - `BugSweep`, `SweepOutput`, `sweepOutputRefusals`;
  - `BugsPolicy`, `computeBugHolds`, `WorkHoldSource`, `rankBuildNext`.
- Policy data `bugs-policy.v1.json` (`BUGS_POLICY_V1`):
  - severity boosts 0 / 150 / 1000 / 200000;
  - critical bugs hold their feature's new ABUs, after a maintainer confirms critical;
  - regressions are removable only by a contract revision.
- `AbuSpec.fix` (optional: bug and regression test). `FixUnitErrorCode` and planning `validateFixUnit`.
- State machines:
  - the D60 hold is generalized as `WorkHoldMachine` (`work_hold`, architecture or bug source); `ArchitectureHoldMachine` is an alias for it. The rename is recorded as MINOR because no table or client persisted `architecture_hold`.
  - New `BugMachine`. Claim guard text: no active work hold.
- Events `bug.reported`, `bug.triaged` (with the decision's canonical hash), `bug.fixed`, `bug.hold_changed`, `sweep.completed`.
- Docs: DECISIONS D61; FEATURE-CONTRACT "Fix units and regressions"; WORKSTREAMS 15; `D61-PROTOCOL-NOTES.md` for the protocol architect.
- Regenerated: goldens, the vendored validator bundle, the product template's vendored contracts.

Affected workstreams: control-plane, cli, desktop, planning, verification, context-policy, web (later, section 15); protocol (the note).

## 5.8.0 — 2026-09-30 (B-0009-control-plane: the database follows the 5.6.0 rulings; implementation of WORKSTREAMS 14)

MINOR, plus migration 0009. Architect role held by ws/blockers for this change (coordinator's grant).
- Migration `0009_web_app_client.sql` (B-0009-control-plane):
  - `wos.email_signin_requests.client_kind` and `wos.sessions.client_kind` accept `web_app` (5.6.0 added it to `startEmailSignIn.clientKind`, but 0001's checks refused it, so S-43 could not be stored). `wos.devices` is unchanged: web_app registers no device.
  - `desktop_bundle_sha256` is now present exactly with a desktop package (B-0007-control-plane's original request); the control plane writes it at every publish from this version on. The check validates existing rows, so the migration fails in its transaction, changing nothing, if a release with a package has no hash.
  - Recorded as MINOR by the same reasoning as 0008: the widened checks are additive and the tightened one binds only the control plane, updated in the same change.
  - Production: yes, after 0008, by the coordinator through the runner (`--check` first). It touches `wos.email_signin_requests`, `wos.sessions` and `wos.app_releases`, disjoint from ws/protocol's 0007.
- No schema in `packages/contracts/src` changed; only `CONTRACTS_VERSION`.
- Implemented with it (WORKSTREAMS 14):
  - control-plane: host-only HttpOnly cookies with `csrfToken` in the web bodies (S-5); clientKind `web_app` with the link to `APP_ORIGIN` (default `HOSTS.app`) + `WEB_APP_SIGNIN_CODE_PATH` (S-43); the bundle hash stored at publish, the in-memory cache removed.
  - suite-shell (templates/product): Core serves `CoreRoutes.localSignInStart` / `localSignInRedeem` / `logout`; wOS Web signs in as `web_app` and no longer reads Set-Cookie; the template root (`package.json`, `package-lock.json`, `docker-compose.yml`); nodemailer 10.0.13 behind `WOS_SMTP_URL` / `WOS_SMTP_FROM`.
  - verification: `validateChangeset` honours `appMigrationsDir` (`db:migrations:<id>` exclusive), with vectors.
  - `scripts/regen-contracts.mjs` runs the bump procedure (section 5); `tools/registry/publish-build-release.mjs` publishes Build's release.
- Regenerated: goldens, the vendored validator bundle, the template's vendored contracts, the site's progress copy.

Affected workstreams: control-plane, suite-shell, verification, desktop and mobile-runtime (local sign-in routes), web (csrfToken when a browser sign-in is built).

## 5.9.0 — 2026-09-30 (Proof of Contribution protocol v1 FROZEN for devnet/shadow, D62; integrated from `ws/protocol`)

MINOR: the `@waronsaas/contracts/protocol` subpath export leaves draft as frozen protocol v1 (additive; no existing contract changes). Review-08 fixes: `allocationChallengeRefusals` admits every live-countable receipt (R08-1); migration 0007 pins `task_budgets.expires_at` and fails closed on submission lateness (R08-2). Migration 0007 is not applied to production. The 6.0.0 MAJOR (TaskKind/AgentRole additions, api.ts routes, TOKEN_DISCLAIMER) remains the P0 wiring step.

### Protocol history (included in 5.9.0) — DRAFT v8 (Astra review 07 fix pass, `ws/protocol`)

Still unreleased and unwired. **Rules:** `acceptanceRequirement` fails closed (`refusals`, `humanCount`, `seatQualified` tuples, `capabilityPolicyVersion`); `CapabilityInput.policyVersion`; verdicts carry `provider`; `allocationChallengeRefusals`, `allocationChallengeDecisionRefusals`, `challengedAllocationPaymentRefusals`; `rulingLabRecordsFromConfirmedRuling`; `routeDisputedFindings` throws on an unknown raising lab. **Engine:** in-epoch hold fold order; one re-issue successor (`reissue:<prev>` consumed). **Machines:** `FINAL_BY_SILENCE` declared; history-proven restore. **Migration 0007 v8:** `allocation_challenges`, `allocation_challenge_replies`, `allocation_challenge_decisions`, `entitlements_challenged`; `task_submissions.changeset_id` with derived `submitted_at`/`submitted_epoch`/`submission_sha256`; `lock_task`; `task_budget_releases.final_rejection_ref`/`admin_action_id`; every receipt status event under the subject lock; `ruling_lab_records` derived from confirmed rulings. **Tests:** `packages/db/test/accounting-trace.mjs` (renamed from lifecycle-trace; source-derived, settlement-aware), `race_exact` races in both orderings.

### Protocol history (included in 5.9.0) — DRAFT v7 (Astra review 06 fix pass; D57, D58, `ws/protocol`)

Still unreleased and unwired. **Engine:** `splitTaskReservation` (the one task split, key = account id); `HoldbackTranche.trancheId`; `EngineState.holds` with `holds`/`holdReleases` inputs (simple holds on a tranche or a claimable balance; maturity and claims take unheld units only); `Reservation.reviewGraceEpochs`, `.policyVersion`, `.reissueOf` pinned at issuance, `reservationExpiry(r)` (no params); `TaskIssuance.reissueOf`. **Rules:** `acceptanceRequirement`, `builderAcceptanceRefusals`, `boundRunPolicySnapshot`; `QualificationEvidence` gains `snapshotRow`, `qualificationSnapshotSha256`, `pinnedReviewPolicy`, `pinnedCapabilityPolicy`, `receiptLabels` and verdict `modelId`/`reasoning`; `nextUnitEligibilityRefusals` takes the acceptance requirement (`claimEligibilityRefusals` alias); `taskAllocationRefusals` receipts carry `accountId`; `budgetReleaseRefusals` gains `taskTerminal`, `finalRejectionOfSubmission`; D54 `provisionalReceiptOutcome` reads a persisted publication, plus `challengePublicationRefusals`, `challengeAdmissionRefusals`, `silenceFinalizationRefusals`; `reissueRefusals`. D58 `labOfProvider`, `routeDisputedFindings`, `resolverEligibilityRefusals`, `crossLabUpholdRates`. **Entities:** `ReceiptStatus.FINAL_BY_SILENCE`, event `final_by_silence`, `ProvisionalChallengePublication`. **Migration 0007 v7:** `task_submissions`, `provisional_publications`, `provisional_challenges`, receipt subject lock (challenge, silence finalization, live admission), qualification snapshot FK + lease/generation check, `epochs.review_grace_epochs` and `provisional_challenge_hours`, `task_budgets.review_grace_epochs`/`policy_version`/`reissue_of`, bootstrap-end stamp, `ruling_lab_records` (D58). Tests: `packages/db/test/lifecycle-trace.mjs` (engine vs database), race R06-2. Root config: `biome.json` excludes `docs/protocol/reviews` (reviewers' files are committed verbatim).

### Protocol history (included in 5.9.0) — DRAFT v6 (Astra reviews 04/05 fix pass; D52–D56, `ws/protocol`)

Still unreleased and unwired. **Engine** (breaking inside the draft): `EngineState` gains `delivered` (I = delivered + claimable + holdback, asserted) and `lastEpoch` (one call per epoch); `Reservation` gains `ancillary` (pool and security accrual reserved with the task, paid on acceptance, returned on release/expiry) and `submittedEpoch`; `EpochInput.disputeSettlements[]` take `recoveries` (owner + source `claimable`/`holdback`/`delivered`) instead of `excessBase`; new `submissions`; issuances apply before acceptances; an unfunded issuance is not consumed; `consumedIds` checked at runtime; `EngineParams.reviewGraceEpochs`; new `openEpoch`/`EpochEnvelope`, `reservationTotal`, `reservationExpiry`; `EpochResult.envelope`. **Rules:** `budgetModelMicro`, `taskAllocationRefusals`, `budgetReleaseRefusals`, `leaseBudgetRefusals`, `receiptRouteRefusals`, `telemetryLinkStatus`, `snapshotHumanRequirement`, `epochEnvelopeRefusals`, `settlementObservationRefusals`, `CANONICAL_OPERATION_FIELDS` (consumer-bound admin operations), `genesisReferenceManifestSha256`; `receiptRefusals` drops telemetry and uses the one expiry rule; `budgetRefusals` takes the computed model and the objective's consensus; `qualificationRefusals` takes the stored snapshot body and the lease expiry; `confiscationNoticeRefusals` takes the hold expiry and maxima. D53 `reviewSeatRefusals`, `requiredReviewSeats`, `reviewPolicySwitchRefusals`; D54 `provisionalReceiptOutcome`; D55 `DORMANT_MODULES`, `moduleRefusals`; D56 `protocol/assignment.ts` (`POST /v1/builds/next`), `nextUnitEligibilityRefusals`, `rankNextUnits`, `selfPickRefusals`, `continuousNextStop`. **Entities/policies:** `RunPolicySnapshot.humanReviewRequired` and `.riskClass` (required); `ContributionReceipt.reviews.labels`; RewardPolicy `budgets.reviewGraceEpochs`, `confiscation.max*`, `modules`, finding bonuses 0; ReviewPolicy `ratification` (optimistic), `fallbacks` (`fable_unavailable`), `bootstrap.ratificationQueueFirst` removed; AgentCapabilityPolicy `candidates`, `qualificationSuites` (D52), `assignment` (D56). **Migration 0007 v6:** floor reservations and zero refused, `acceptance_objectives unique (kind, ref)`, per-receipt share bound, `entitlements.release_seq`, finite `hold_expires_at` and one confiscation end (serialized), typed settlement observations, epoch envelope columns, `human_review_assignments`, `admin_actions.bootstrap_single_signer`, action `switch_review_policy`. See REVIEW-PACKET §3f–§3g, ADR-001 §11.

### Protocol history (included in 5.9.0) — DRAFT v5 (D51 engine-first enforcement, `ws/protocol`)

New `protocol/rules.ts`: pure write-time rules (admin authorization, qualification, receipts, budgets, disputes and adjudication, entitlements and claims, confiscation procedure, audits, human review scope, wallets, votes, pools, Genesis, sponsorships, usage telemetry, clips, exclusions, adapter events, duty, manifest admission, allocation attribution) with `test/protocol-rules.test.ts`. Migration 0007 v5: 2,900 → about 1,720 lines; only the hard invariants I1–I9 remain (one deferred conservation check, new tables `confiscation_releases` and `epoch_balances`, `allocation_disputes.opened_txid`, devnet-only leaves). See PROTOCOL §12, docs/protocol/GUARANTEES.md, SECURITY §6.

### Protocol history (included in 5.9.0) — DRAFT v4 (D49 budget-based rewards, `ws/protocol`)

Still unreleased and unwired. Engine: `issuances` (reserve budget × issuance rate from the pooled task capacity; `unfunded` returned), `acceptances` (pay the reservation by declared shares), `releases` and expiry, `demandForecastAcuMicro` (ex-ante rate), `EngineState.reserved`, funding equation with Q; `EngineReceipt` is outcomes-only; `maxRateVsTrailingBp`/`trailingRateBasePerAcu` removed; `budgetToBase`, `TASK_SLICES`. Policies: RewardPolicy `budgets`, `eligibility.acceptedVerificationLevels` removed, `weightBasis: task_budget`, holdback 20%/6; UsageProofPolicy `logs.required: false`, `bareAttestedWeightBp` removed; CompletionRewardPolicy/CompletionDefinition `requireExitRightsCheck` (was `requireSelfHostCheck`, D50). Entities: `EvidenceClass` = accepted_budget | outcome | historical; `ContributionReceipt.taskBudget`, `.telemetry` (attested/cap fields removed); `DisputeReason` and `PerturbationClass` on budgets, acceptance, splits and attribution; `PayoutAuditPacket` lines carry the frozen budget; new `TaskBudget`, `AcceptanceObjective`. Migration 0007 v4 §5b (objectives, budgets, releases, proposer rule), budget-paid receipts with declared shares, allocations capped by the reservation. See ADR-001 §9, REVIEW-PACKET §3d.

### Protocol history (included in 5.9.0) — DRAFT v3 (Astra review 03 fix pass, `ws/protocol`)

Still unreleased and unwired into authoritative reward accounting. Breaking changes inside the draft `@waronsaas/contracts/protocol` entry: `EpochInput.consumedIds` is required; `EngineState` gains `claimable`; `HoldbackTranche` gains `maturesAtEpoch` and `policyVersion`; `EngineParams` gains `holdbackPolicyVersion`; `accrualCorrections[]` gain `recoverFromPaid`; new `claims` input; confiscation recovery is capped at the proven excess; sponsored splits use exact share numerators. Governance: `applyWeightCaps` replaced by `governanceWeights` (eligibility before caps) returning `GovernanceWeights`; `tallyDualMajority` accepts only that object; `capGroupShares` returns `{ shares, feasible }`. Usage adapters: checked aggregates, missing `response_id` and empty logs are errors. Entities: `EntitlementRecord` (source, cluster, mode, maturesEpoch, policyVersion, `withheld_release`), `SettlementOutcome`, `Confiscation` (holds, appeal, decision, execution), `AdminAction` (payload, operationSha256), new `AdminActionApproval`, `PayoutAuditAssignment`, `QualificationResult`, `GenesisReferenceManifest`. Migration 0007 v3: source-balance ledger, appeal-aware adjudication, holds at notice, qualification relationships, audit assignments, operation-bound single-use admin actions, settlement fence (ADR-001 §8, REVIEW-PACKET §3c). New DB race tests: `packages/db/test/concurrency.sh`.

### Protocol history (included in 5.9.0) — DRAFT v2 (Astra review 02 fix pass, `ws/protocol`)

Still unreleased and unwired. Engine v2 (identified sources, conservation with non-negative balances asserted on input and output, per-beneficiary rounding, holdback, confiscation, recovered-only bounties, bounded loss absorption, application pools, rate damping); governance water-filling caps with feasibility, lock seasoning; adapters report errors; new entities (Confiscation, Exclusion, DutyEvent, EntitlementRecord, SettlementAttempt, PublicationConsent, RunLogCommitment, BeneficiaryRef, per-item dispute stakes); receipt statuses ACTIVE/PROVISIONAL/RATIFIED/REVOKED; migration 0007 rewritten (see ADR-001 §7 and REVIEW-PACKET §3b). Policy data: holdback, losses, confiscation, audit capacity, damping, Genesis reference population and fallback, governance seasoning and beneficial owner, Genesis cap 0.5%.

### Protocol history (included in 5.9.0) — DRAFT (Proof of Contribution, `ws/protocol`, pending the Astra review)

Not released and not wired into any service. Will ship as **6.0.0** (MAJOR) when the review is resolved: `TaskKind`/`AgentRole` gain `payout_audit`/`payout_auditor`, `TOKEN_DISCLAIMER` is replaced (D18), new routes and events.

- New entry point `@waronsaas/contracts/protocol` (`packages/contracts/src/protocol/`): entities (UsageReceipt, RunLog, ContributionReceipt with beneficiary, receipt status ACTIVE/PROVISIONAL/RATIFIED/REVOKED, epochs with PROPOSED, allocations per receipt with explanations, anomaly metrics, disputes over any set of allocations, payout audit packets/verdicts with a focus section, payout canaries, clips, duty, completion definitions, Genesis historical credit, abuse signals, risk flags, AdminAction, human review, qualifications, eval cases, wallet bindings, sponsorship links), nine policy schemas + activation rules, governance (tiered dual supermajority, caps) and the settlement-adapter off-ramp, the deterministic bigint reward engine with the conserved funding equation, receipt/Merkle hashing rules P-1..P-4, provider usage adapters, state machines, V1 policy data (all `status: draft`).
- Draft migration `0007_proof_of_contribution.sql` (applies on 0006; exercised by `db:test`; never applied to production).
- `tools/tokenomics-sim` (deterministic simulation and policy preview), root scripts `sim:tokenomics` and typecheck of the tool.

## 5.10.0 — 2026-09-30 (protocol versioned additions after the freeze: D61 economy side, the D60 delta, D63 work next; `ws/protocol`)

MINOR, additive: frozen protocol v1 (5.9.0) is unchanged — its policy files are byte-identical and its rules keep their behaviour; everything new is optional in the schemas and present from `reward-policy.v2` / `capability-policy.v2`. Pending Astra review 09. Not wired into authoritative accounting; devnet only.
- Policy data: `reward-policy.v2.json` (`REWARD_POLICY_V2`: `BUG_TRIAGE` / `BUG_FIX` routes, `bugs`, modules + `priority_vote` dormant) and `capability-policy.v2.json` (`CAPABILITY_POLICY_V2`: `bug_triage` budget, `workNext` = `work-next-ranking.v1`). Schema: optional `RewardPolicy.bugs`, optional `AgentCapabilityPolicy.workNext`, budget `taskKind` accepts `bug_triage`, `WorkKind`.
- Entities: `ContributionType` + `BUG_TRIAGE`, `BUG_FIX`; `AcceptanceEvent` + `triage_decision_confirmed`; `BugTriageRecord`, `BugTriageConfirmation` (bound to 5.7.0 `BugId`, `TriageOutcome`, `BugSeverity`); optional `RunPolicySnapshot.claim` (mode, queue bonus, whether it applies).
- Rules: `effectiveBugSeverity`, `triageConfirmationRefusals`, `bugReportOutcome`; `receiptRouteRefusals` BUG_TRIAGE / BUG_FIX (uses 5.7.0 `redGreenRefusals`); `budgetModelMicro` severity factor; D60 delta `holdLabel`, `holdReleaseLabelRefusals`, `ageingIssueEpoch`; D63 `WorkCandidate`, `ContributorLimits`, `contributorLimitsRefusals`, `workEligibilityRefusals`, `workNextPolicyRefusals`, `priorityVoteTerm`, `rankWorkNext`, `basePriceAcuMicro`, `nextClaimTerms`; `DORMANT_MODULES` + `priority_vote`.
- Engine: `TaskAcceptance.claim`, `queueBasePrice`, `EpochResult.queueBonusReturnedBase` (a claim without the queue bonus is paid the base price; the bonus portion returns to R).
- Draft migration `0010_bugs_and_maintenance.sql` (after main's 0008 and 0009; never applied to production): `bug_triage_decisions`, `bug_triage_confirmations`, bug receipt invariants, `offsets.bug_id`, `task_budget_releases.hold_label`, the queue-bonus allocation cap. Assertions `packages/db/test/bugs-assertions.sql` (run by `db:test`).
- Docs: DECISIONS D61 (economy side), D63 (D56 marked superseded in part); PROTOCOL §14; POLICIES §0, §13; REWARD-PROTOCOL; SUPERSESSION §3d; GAPS G-98, G-102; REVIEW-PACKET §3l; simulation tables R and S.
- Regenerated: goldens, the context-engine snapshot, the product template's vendored contracts.

Affected workstreams: protocol build waves (V1-active modules: bugs, work next), control-plane (serves the ranking inputs and bug records, G-102), cli and desktop (work-next claims, base price and "+20% queue bonus" copy).

## 5.11.0 — 2026-09-30 (B-0001-mobile-runtime: a sign-in client kind for wOS Mobile)

MINOR, additive, plus production migration 0011.
- `api.ts`: `startEmailSignIn.clientKind` gains `mobile`. The pollSecret and tokens come in bodies, `devicePublicKey` must be null, and the email carries the code only.
- Migration `0011_mobile_client.sql` (**production**): the `client_kind` checks of `wos.email_signin_requests` and `wos.sessions` accept `mobile`; db assertions added.
- Control plane:
  - accepts `mobile`, refuses a device key for it, and sends a code-only email;
  - test `mobile-signin.test.ts`;
  - the test mailer tolerates a mail without a link.
- wOS Mobile: `MOBILE_CLOUD_CLIENT_KIND = "mobile"`, and the cloud sign-in test is flipped.
- SECURITY:
  - S-2: mobile binding through the pollSecret; no PKCE addition needed;
  - S-4: expo-secure-store only on phones.
- WORKSTREAMS: 12.4 mobile-runtime row (the account routes and local sign-in names), 16 (ruling; the template lockfile rule).
- Regenerated: the product template's vendored contracts, goldens.

Affected workstreams: control-plane, mobile-runtime, suite-shell (vendored contracts).

## 5.12.0 — 2026-09-30 (Amendment 04: identity and organizations, D65; D64 order)

MINOR, additive, plus production migration 0012.
- New module `identity.ts`:
  - GitHub sign-in: `GithubSignInStartBody` / `Response`, `GithubSignInPollBody`, `resolveGithubSignIn` (never merges), `githubSignInFlowFor`, `GITHUB_SIGNIN_LANDING`;
  - invites and members: `OrgInvite`, `OrgMemberView`, `memberActionRefusals`;
  - domains and joining: `OrgDomain`, `DomainName`, `JoinPolicy`, `domainVerificationRecord`, `isBlockedDomain`, `emailDomain`, `domainJoinOutcome`, `OrgJoinRequest`;
  - permissions: `PermissionOverride`, `effectiveGrants`;
  - policy: `IdentityPolicy`, `quotaRefusal`;
  - dormant: `OrgSsoConnection`, `ScimToken`, `AuditExportRequest`, `AUDIT_EVENT_TYPES`, `DormantModuleName`.
- `IdentityRoutes` in `api.ts` (23 routes; the three enterprise routes answer `MODULE_DORMANT`).
- `ApiErrorCode` gains `GITHUB_EMAIL_UNVERIFIED`, `LAST_OWNER`, `DOMAIN_CLAIMED`, `PUBLIC_EMAIL_DOMAIN`, `INVITE_EMAIL_MISMATCH`, `QUOTA_EXCEEDED` and `MODULE_DORMANT`. The control plane's `HTTP_STATUS` maps them.
- `EnvironmentTokenClaims.permissions` (optional).
- State machines `OrgInviteMachine`, `OrgDomainMachine`, `OrgJoinRequestMachine`.
- Events `organization.invite_changed`, `organization.domain_changed`, `organization.join_request_changed`, `organization.permission_override_changed`, `account.github_signed_in` (all private).
- Policy data `identity-policy.v1.json` (`IDENTITY_POLICY_V1`):
  - rate limits;
  - plan `free` quotas (members 25, pending invites 50, verified domains 5, team organizations owned 10, invites per day 100);
  - abuse guards;
  - public and disposable domains;
  - SSO, SCIM and audit export dormant.
- Migration `0012_identity_and_organizations.sql` (**production**):
  - new tables `github_signin_requests`, `org_invites`, `org_domains`, `org_join_requests`, `org_join_exclusions`, `org_app_permissions`;
  - new columns `organizations.plan` and `memberships.via`;
  - trigger `memberships_rules_actor`;
  - RLS;
  - db assertions.
- Docs:
  - `docs/AMENDMENT-04-IDENTITY-AND-ORGANIZATIONS.md`;
  - DECISIONS D64, D65;
  - SECURITY S-44..S-46;
  - WORKSTREAMS 17;
  - AGENTS.md "Next" (D64).

Affected workstreams: control-plane, suite-shell, desktop, cli, mobile-runtime, web, verification (section 17).

## 5.13.0 — 2026-09-30 (D66: Amendment 04 decisions and addendum A, account lifecycle)

MINOR, additive. No migration yet: the build's migration comes in Wave 3b (WORKSTREAMS 18).
- `identity.ts`:
  - domain lists: `DomainList`, `isDisposableDomain`;
  - addendum A: `DataExportRequest`, `DATA_EXPORT_SECTIONS`, `AccountDeletionRequest`, `ACCOUNT_DELETION_GRACE_DAYS`, `RETENTION_RULES`, `deletedContributorPseudonym`, `accountDeletionRefusals`, `EmailChangeRequest`, `emailChangeComplete`;
  - `IdentityPolicy.lists` and `ssoBreakGlass` (optional).
- Data:
  - `disposable-email-domains.v1.json` (`DISPOSABLE_EMAIL_DOMAINS`): 9189 domains from `disposable-email-domains` at 51fafcd878e7e67b82f8184c21134fa079f8609f, CC0-1.0, with the source sha256; refreshed by `tools/domain-lists/refresh-disposable.mjs` through a reviewed PR;
  - `identity-policy.v1` gains `lists` and `ssoBreakGlass`.
- `IdentityRoutes` gains `requestDataExport`, `confirmDataExport`, `getDataExport`, `requestAccountDeletion`, `confirmAccountDeletion`, `cancelAccountDeletion`, `startEmailChange` and `confirmEmailChange`. `ApiErrorCode` gains `DELETION_BLOCKED` (mapped to 409).
- `AccountDeletionMachine`. Events `account.email_changed`, `account.deletion_changed` and `account.export_ready` (private).
- Docs: DECISIONS D66; Amendment 04 sections 11 and addendum A; WORKSTREAMS 18.
- `biome.json` skips the pinned list (and its vendored copy).

Affected workstreams: control-plane, suite-shell, desktop, cli, mobile-runtime, web, verification, protocol (a note).

## 5.14.0 — 2026-09-30 (protocol: Astra review 09 fix pass, R09-1 to R09-6; branch `ws/protocol-v2`)

MINOR, additive to the pending v2 additions (frozen v1 unchanged). Pending Astra review 10. Not wired into authoritative accounting; devnet only.
- `reward-policy.v2` gains `queue.queueBonusBp` (2000); `capability-policy.v2` `workNext` loses `queueBonusBp` (pay lives in the pinned reward policy) and its budgets gain `abu_revision` and `architecture_author`. Schema: optional `RewardPolicy.queue`; budget `taskKind` admits `architecture_author`.
- Engine: `EngineParams.queueBonusBpByPolicy` (from `engineParamsFrom`), `taskPayableBase`; an acceptance of v2 work without complete claim terms at the pinned coefficient is refused, v1 work takes none (validated before the reservation is consumed).
- Rules: `taskAllocationRefusals` versioned path (`pinnedQueueBonusBp`, `claim`); `claimTermsRefusals`, `taskClaimOf`; `receiptRouteRefusals` `commission` (required under policies with D61 routes) and `bugFix.expected` / `severityAtIssuance` (replaces `effectiveSeverity`); `bugFixAccepted`, `fixRevocationDependents`, `fixBudgetIssuanceRefusals`.
- Migration 0010 amended in place (never applied anywhere; excluded from production by its marker): `queue_bonus`, `receipt_live`, F1 `check_bug_budget`, B1/B3 route and live-fix checks, Q1 required and bound claim terms with one set per task.
- Tests: work-next "Astra review 09" block; `bugs-assertions.sql` R09 regressions; `packages/db/test/accounting-trace-v2.mjs` (run by `db:test`); `tools/astra-09/` probes.
- `tools/make-review-bundle.sh` honours `WOS_REVIEW_OUT`.
- Regenerated: goldens, the context-engine snapshot, the vendored contracts.

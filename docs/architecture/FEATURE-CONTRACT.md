# FEATURE-CONTRACT

How a Feature Contract and its Build Graph are written, reviewed, versioned, shared across apps (D10) and ingested. Part of the wOS constitution.

| Source of truth | What it fixes |
|---|---|
| `packages/contracts/src/artifacts.ts` | `CatalogEntry`, `FeatureContract`, `Requirement`, `RequirementProfile`, `BuildGraph`, `AbuSpec`, `ResourceClaim`, `BuildGraphErrorCode` |
| `packages/contracts/src/state-machines.ts` | `DocumentMachine` (shared with roadmaps), `CatalogFeatureMachine`, `AppFeatureMachine`, `AbuMachine` |
| `packages/contracts/src/data/agent-policy.v1.json` | `feature_author` obligations, feature reviewer material-finding rules, `featureContractMaxRounds` = 5 |
| `packages/db/migrations/0001_init.sql` | `catalog_features`, `documents`, `requirements`, `requirement_profiles`, `abus`, `abu_dependencies`, `abu_requirements` |

Round mechanics are in REVIEW-PROTOCOL.md; the lifecycle table in ROADMAP-PROTOCOL.md section 3 applies to contracts unchanged except where noted here.

## 1. One contract per catalog feature (D10)

- The Feature Catalog is global and app-independent: `catalog/<key>.yaml` in `waronsaas/suite` (G-05). Keys are like `contacts`, `threaded-messaging`, `e-signature-envelope`. A key is never reused, even after aliasing.
- Each catalog feature has at most one open contract workflow (`documents_one_open_contract`) and a sequence of merged versions. The latest merged version is the one progress and building use.
- One contract, one build graph, built once. Every app that references the feature gets a **profile**: the list of requirement ids it needs.

### Files

| Path | Content |
|---|---|
| `features/<key>/CONTRACT.yaml` | `wos-feature-contract.v1` |
| `features/<key>/BUILD-GRAPH.yaml` | `wos-build-graph.v1` |
| `features/<key>/acceptance/**` | acceptance tests; one suite per profile (`profiles[].acceptance.dir`) |
| `modules/<key>/**` | the shared implementation (written by ABUs) |
| `products/<target>/**` | app-specific surface (written by ABUs whose scope names it) |

## 2. Contract content

| Field | Rule |
|---|---|
| `feature`, `version` | catalog key; version = previous merged + 1 |
| `title`, `summary` | app-neutral words, no vendor names |
| `requirements[]` | `key` `R-nnn` unique in the version; `kind` one of functional, data, api, ui, security, performance, operability; `statement` one testable MUST/MUST NOT sentence; `acceptance[]` at least one criterion |
| `profiles[]` | one per app that references the feature and is specified; `target`, `requirements` (ids, at least one), `acceptance` `{dir, run}` for that profile's suite |
| `impactedTargets[]` | required non-empty for every version > 1: every app whose profile or shared requirements changed versus the previous merged version |
| `interfaces` | named data, api, ui, events definitions the feature defines or consumes |
| `dependsOnFeatures[]` | catalog keys this feature needs first |
| `openQuestions[]` | must be empty at consensus; any entry is a material finding |

Rules of profiles:

- A profile lists exactly the requirements that app needs. Requirements needed by all referencing apps appear in every profile; app-only requirements appear in one.
- One app's needs must never leak into another app's profile (material finding).
- A feature is SPECIFIED for app A exactly when the latest merged contract contains A's profile (ROADMAP-PROTOCOL.md section 6). There is no partial specification.

## 3. Build Graph content

The build graph is written and reviewed together with the contract, in the same PR and the same rounds. This deviates from the spec's wording ("A merged Feature Contract generates a Build Graph"): decomposition quality is the thing most likely to break parallel building, so it must be under the same Astra/Fable consensus. The control plane ingests ABUs when the PR merges.

| `AbuSpec` field | Rule |
|---|---|
| `key` | `<feature>#nn`, unique in the version |
| `objective` | one actionable paragraph, at least 20 characters |
| `requirements[]` | at least one requirement key of this contract |
| `dependsOn[]` | ABU keys of the same graph |
| `sizePoints` | 1, 2, 3, 5 or 8; drives BUILT % and rewards |
| `scope.write[]` | exact file paths or `<dir>/**` only; must be under `modules/<feature>/`, `products/<target>/` or `features/<feature>/acceptance/` |
| `scope.read[]` | extra read globs |
| `resources[]` | logical resources: `db:`, `api:`, `schema:`, `lockfile:`, `config:`, `event:`, `ui:`, `dep:` prefixes, mode `exclusive` or `shared` |
| `acceptance.checks[]` | commands that must exit 0, locally and in CI |
| `acceptance.tests[]` | test files, inside `scope.write` |

At most 60 ABUs per graph.

### Build graph validity (`planning.validateBuildGraph`)

Run on every revision before a round opens. Any error returns the document to `revising` with the errors.

| Code | Rule |
|---|---|
| `DUPLICATE_KEY` | ABU keys unique |
| `KEY_NOT_IN_FEATURE` | every key starts with `<feature>#` |
| `UNKNOWN_DEPENDENCY` | every `dependsOn` exists in the graph |
| `CYCLE` | the dependency graph is acyclic |
| `UNKNOWN_REQUIREMENT` | every ABU requirement exists in the contract |
| `REQUIREMENT_UNCOVERED` | every requirement in every profile is covered by at least one ABU |
| `WRITE_SCOPE_PROTECTED` | no write scope overlaps `wos.json` `protectedPaths` or `generatedPaths` |
| `WRITE_OUTSIDE_MODULE_OR_PRODUCT` | write scopes stay under the allowed roots above |
| `PARALLEL_WRITE_OVERLAP` | two ABUs with no dependency path between them (in either direction) must have non-overlapping write scopes (`verification.scopesOverlap`) |
| `PARALLEL_EXCLUSIVE_RESOURCE` | two such ABUs must not both claim the same resource key when either claim is exclusive |
| `LOCKFILE_WITHOUT_RESOURCE` | an ABU writing a `wos.json` lockfile path must claim `lockfile:<path>` exclusive |
| `TOOLCHAIN_WITHOUT_RESOURCE` | an ABU writing a `wos.json` `toolchainPaths` file (package.json, tsconfig, test/lint configs, `.npmrc`, `wos.json`...) must claim `toolchain:<path>` exclusive; such ABUs are flagged in the contract PR and their implementation PRs need a maintainer's CODEOWNERS approval (contracts 2.0.0, SECURITY.md S-33). Feature authors should isolate toolchain changes in their own small ABU. |
| `MIGRATION_WITHOUT_RESOURCE` | an ABU writing under `migrationsDir` must claim `db:migrations` exclusive |
| `TEST_OUTSIDE_SCOPE` | `acceptance.tests` inside `scope.write` |
| `OVER_CONTEXT_BUDGET` | the context engine's estimate of the builder context for the ABU exceeds the builder role's `contextBudgetTokens` (120000); such an ABU must be decomposed further (spec Agent 5) |

## 4. Lifecycle

Same `DocumentMachine` and transitions as roadmaps (ROADMAP-PROTOCOL.md section 3) with `kind = 'feature_contract'`, `catalog_feature_id` set, `target_id` null, branch `wos/feature/<key>/v<n>`, PR title `<title> Feature Contract v<n>`, round limit 5 (`featureContractMaxRounds`), author role `feature_author` (Fable or Opus, `max` floor), reviewer roles `feature_reviewer_astra` / `feature_reviewer_fable`.

How workflows open:

| Trigger | Result |
|---|---|
| A roadmap merges referencing a feature that never had a contract | contract v1 opens (`drafting`) with a `feature_author` task naming every referencing app |
| A roadmap merges referencing a feature whose contract is open | the app is added to the open author task's spec; its app feature goes `specifying` |
| A roadmap merges referencing a feature whose merged contract lacks the app's profile | contract v n+1 opens with the app in the task spec; `impactedTargets` must include it |
| Maintainer decides a merged contract must change | maintainer opens v n+1 with a reason (`reopen_document` on a merged workflow is not possible; a new version document is created) |

Allowed paths for a contract submission: `features/<key>/CONTRACT.yaml`, `features/<key>/BUILD-GRAPH.yaml`, `features/<key>/acceptance/**`. Anything else is `OUT_OF_SCOPE`.

## 5. Versioning a shared contract

Changing a shared contract affects every app that references it.

1. The new version must list `impactedTargets`: every app whose profile or any requirement in its profile changed.
2. Every reviewer and the author receive, for every impacted app: its roadmap feature ref (`appNotes`, weight), its current profile and its current BUILT numbers. Unimpacted apps' profiles are included read-only so reviewers can confirm they are untouched.
3. Changing a requirement that appears in an unlisted app's profile is a validation error (the validator diffs profiles against the previous merged version).
4. App features of impacted apps go `profile_reopened -> specifying` while the version is open; they keep their merged-version numbers until the new version merges (SPECIFIED stays 10000 if the old profile exists).
5. On merge: ABUs carried over unchanged keep their rows and state; ABUs removed or changed are `superseded` (their merged work stays credited; live attempts are superseded); new ABUs are created. Progress is recomputed for every referencing app.

"Carried over unchanged" means same key, same `objective`, `requirements`, `scope`, `resources`, `acceptance`, `sizePoints` and `dependsOn` (deep equality of the `AbuSpec`).

## 6. Duplicates and the alias procedure

Prevention: the catalog is in every roadmap author's and reviewer's context. "This duplicates catalog feature F" is a material finding at roadmap review and at contract review.

When a duplicate is found after both exist (feature D duplicates F):

1. A maintainer opens the absorbing contract version of F (v n+1). The same PR, authored through the normal author task, must:
   - set `aliasOf: F` in `catalog/D.yaml`;
   - add D's requirements that F lacks and add profiles for every app that referenced D, listing those apps in `impactedTargets`;
   - carry over or supersede D's ABUs in F's new build graph.
2. The PR goes through normal rounds; reviewers check nothing D's apps needed is lost.
3. On merge (maintainer approval required): `catalog_features` D `active -> aliased` (`alias_merged`), `alias_of = F`; `app_features` rows for D are repointed to F (if the app already referenced F, the rows merge: weights add inside the capability and the app's next roadmap version must restate them); D's merged ABUs stay credited; unmerged ABUs of D are `superseded`; progress is recomputed for all affected apps; event `catalog.feature_aliased`.
4. Roadmaps must not reference D afterwards (validation rejects aliased refs).

## 7. Ingestion on merge

When the contract PR merges (`pr_merged`), in one transaction:

1. `documents` -> `merged`; `catalog_features.current_contract_document_id` = this document.
2. Insert `requirements` for this version and `requirement_profiles` rows (document, target, requirement).
3. Insert `abus` (`spec` = the `AbuSpec` JSON, `est_context_tokens` from the context engine estimate), `abu_dependencies`, `abu_requirements`. State `ready` when `dependsOn` is empty or every dependency is already merged, else `pending_dependencies`. Carried-over ABUs keep their existing rows (no duplicate). Superseded ABUs transition `-> superseded`.
4. For each ABU in `ready`, create one open `abu_build` task (`tasks_one_live_build_per_abu`). For `pending_dependencies`, the task is created `blocked`.
5. App features of every profile app: `-> specified` (`profile_merged`).
6. Events `document.merged`, `abu.created`; the progress consumer recomputes.

Idempotency: the transition guard `state = consensus` makes a replayed webhook a no-op.

## 8. Within-feature weighting

The split of a feature's BUILT % across its requirements and units is mechanical: ABU size points of the relevant ABUs (ROADMAP-PROTOCOL.md section 6). A contract cannot override it with per-requirement weights in V1 (G-30). Size points are fixed in the reviewed build graph, so they are as hard to game as the contract; reviewers treat a size point assignment that is plainly out of proportion to the ABU's objective as a material finding.

# ROADMAP-PROTOCOL

How an Application Roadmap is written, reviewed, merged, versioned and turned into tracked features with progress. Part of the wOS constitution. Code is the contract; this document explains it.

| Source of truth | What it fixes |
|---|---|
| `packages/contracts/src/artifacts.ts` | `Inventory`, `Roadmap` (with the D12 sum rules), `CatalogEntry`, `RoadmapBundle` |
| `packages/contracts/src/state-machines.ts` | `DocumentMachine`, `RoundMachine`, `InventoryMachine`, `AppFeatureMachine`, `CatalogFeatureMachine` |
| `packages/contracts/src/progress.ts` | every percentage on every surface |
| `packages/contracts/src/data/agent-policy.v1.json` | author/reviewer obligations, material-finding rules, round limits |
| `packages/db/migrations/0001_init.sql` | `documents`, `inventory_versions`, `inventory_items`, `capabilities`, `app_features`, `inventory_dispositions`, `progress_snapshots` |

Round mechanics (tasks, sealed verdicts, reveal, findings, escalation) are shared with Feature Contracts and are specified once in REVIEW-PROTOCOL.md. This document covers what is specific to roadmaps.

## 1. What a roadmap is

One roadmap per application (Sniper Target). It answers three questions, and reviewers try to prove each answer wrong:

1. **What is the whole product?** `roadmaps/<target>/INVENTORY.yaml`: an enumerated list of the vendor's public product surface, every item citing a public source. This is completeness evidence. It does not weight anything.
2. **How is it divided, and how much does each part matter?** `roadmaps/<target>/ROADMAP.yaml`: every capability of the app with a reasoned weight (D12), the inventory items it covers, and (once mapped) the catalog features it uses with their own reasoned weights.
3. **Which shared features does it need?** Feature references point at the global Feature Catalog (`catalog/<key>.yaml`, D10). A roadmap reuses catalog features and proposes new ones only when nothing in the catalog covers the same user job.

### Where it lives

| App | Repository | Files |
|---|---|---|
| The ten Sniper Targets | `waronsaas/product` (the product repo, name is FOUNDER DECISION G-05) | `roadmaps/<target>/INVENTORY.yaml`, `roadmaps/<target>/ROADMAP.yaml`, new `catalog/<key>.yaml` files |
| TGT-00 warOnSaaS (wOS itself) | `waronsaas/wos` (platform repo) | `docs/roadmap/waronsaas.roadmap.json` (a `RoadmapBundle`, status PROPOSED) |

## 2. Artifact rules

### Inventory (`wos-inventory.v1`)

- `items[].key` is `INV-nnnn`, unique within the version. `weight` is always `1` in V1 (the field exists so weighting could change by version; it is unused by progress).
- Every item cites `sources[source]`: public vendor documentation only. No logins, no scraped private data.
- The inventory has its own `version`. A roadmap version names the `inventoryVersion` it uses. A new inventory version is proposed inside a roadmap PR and freezes when that PR merges (`InventoryMachine`: `proposed -> frozen` on `roadmap_merged`, `frozen -> superseded` on `superseded_by_newer`; one frozen version per target, partial unique index `inventory_one_frozen`).

### Roadmap (`wos-roadmap.v1`)

| Field | Rule |
|---|---|
| `target` | the app slug |
| `version` | 1 for the first merged roadmap; exactly previous merged version + 1 afterwards |
| `inventoryVersion` | the inventory this version is checked against |
| `productName` | our name, never the vendor's trademark |
| `architecture` | how the target's parity profile maps onto modules of the one suite (D14), target-specific data needs, self-hosting |
| `capabilities[]` | ALL capabilities of the app, every version (the skeleton) |
| `capabilities[].weightBp`, `.weightRationale` | D12: capability share of the app; all capabilities sum to exactly 10000; rationale at least 40 characters |
| `capabilities[].inventoryItems` | every inventory item is in exactly one capability or in `excluded` |
| `capabilities[].features[]` | empty = capability not mapped yet. Non-empty = mapped: feature weights sum to exactly 10000 inside the capability, and the features' `inventoryItems` together equal the capability's `inventoryItems` exactly |
| `features[].feature` | a catalog key (`FeatureKey`, global, app-independent) |
| `features[].appNotes` | what this app needs from the shared feature that the contract must cover in this app's profile |
| `features[].phase` | `core` or `later` (informational; does not affect progress) |
| `excluded[]` | items deliberately not replaced, each with a reason of at least 10 characters a vendor customer would accept |
| `newCatalogFeatures[]` | catalog keys this PR creates; each must have a `catalog/<key>.yaml` in the same PR |
| `proposals[]` | ids of `wos propose` proposals this version incorporates |
| `migration` | D59: how customers get their data off the target, per data class (required for every target except TGT-00; section "Migration") |

### Validation (deterministic, before any round opens)

A revision is valid only if all of these pass. Failure moves the document `validating -> revising` (`validation_failed`) with the errors carried into the new author task (`tasks.carry`); the round counter does not advance.

- Catalogs are per repository (contracts 3.0.0, GAPS G-54): every referenced catalog feature must have the roadmap's own `repo_full_name`; a product roadmap cannot reference a TGT-00 platform feature and vice versa.

1. YAML parses (`@waronsaas/planning` `parseInventoryYaml`, `parseRoadmapYaml`, `parseCatalogEntryYaml`).
2. Zod schema passes, including the `Roadmap` `superRefine`: capability weights sum to 10000; each mapped capability's feature weights sum to 10000; no feature listed twice in one capability; every weight 1..10000 with a rationale of at least 40 characters.
3. `planning.validateRoadmap(roadmap, inventory, catalog, previousMergedVersion)`:
   - every inventory item in exactly one capability or excluded, none unknown;
   - mapped capabilities: feature refs cover the capability's items exactly;
   - every referenced feature exists in the catalog at the PR head, or is listed in `newCatalogFeatures` with its catalog file;
   - no reference to an `aliased` catalog feature;
   - `version = previousMergedVersion + 1` (1 when none);
   - D59: a target roadmap has a migration section accounting for every data class (section "Migration" below).
4. The changeset touched only document paths: `roadmaps/<target>/**` and `catalog/<key>.yaml` for keys in `newCatalogFeatures` (see BUILD-PROTOCOL.md "Submissions"; error `OUT_OF_SCOPE`).

### One suite, many profiles (D14, contracts 4.0.0)

A roadmap does not plan an app. It defines the target's parity profile against the ONE suite: which modules (catalog features) replace which parts of the product, with what weights, on which surfaces. It reuses the app-shell features (workspace modules, navigation, tenancy, roles, notifications) that every target references. A roadmap that plans a target-specific app, shell, login, data store or store listing is a material finding (policy rule).

### Surfaces and experience (D13, contracts 4.0.0)

Parity means features AND experience, on every surface the rented product ships.

- **Inventory surfaces.** `INVENTORY.yaml` lists every client surface the vendor ships with cited public evidence: `web` (with the vendor's supported browsers), `ios` (iPhone and iPad), `android`, `desktop` (with platforms), `browser_extension`, `email_addin`, `other`. A missing surface is a material finding.
- **Roadmap surfaces.** `ROADMAP.yaml` `surfaces` marks each inventory surface `in_scope` (with the repository and app shell that serve it: web in `apps/web`, iPhone and Android in `apps/mobile`, both in `waronsaas/product`, shared by every target, D14) or `excluded` with a reason a customer would accept. Android is in scope and built from the same React Native code as iPhone (D13, decided).
- **Journeys.** Every feature ref lists key user journeys, at least one per surface it exists on: the steps a user takes, entry points, navigation, and offline, notification, background and responsive behaviour; mobile journeys name the native capabilities they need (push, background audio or video, CallKit, share sheet, offline storage, camera). Schema: `Journey` in `artifacts.ts`.
- **Surface weights.** Every feature ref gives each of its surfaces a `weightBp` with a `weightRationale` (D12 applied to D13), summing to 10000, frozen with the version. The Roadmap Agent is told to reason about them and both reviewers treat an unjustified split as SURFACE MIS-WEIGHTING (policy data).
- **Not trade dress.** Parity is functional and experiential, explicitly NOT a copy of the vendor's trade dress, logos, icons, colours, layouts or wording. Our look is the warOnSaaS monochrome design system. Copying the vendor's visual design is a material finding at every review level.
- The schema (`Roadmap.superRefine`) rejects: surface weights not summing to 10000, a feature on a surface that is not in scope, a surface without a journey, an excluded surface without a reason, an in-scope surface without repo and path.

### Product surfaces and applications (Amendment 01, contracts 5.0.0)

- **Surfaces in scope.** In `waronsaas/product` only wOS's own shells can be in scope: `web` (`apps/web`), `desktop` (`apps/desktop`, renderer bundles for the one wOS Desktop), `ios` and `android` (`apps/mobile`), and `api` (`apps/api`). A vendor surface wOS does not ship (browser extension, e-mail add-in, vendor CLI) is `excluded` with a reason; the schema refuses it in scope. A vendor desktop app maps to `desktop`, and a vendor public API maps to `api`.
- **`apps`.** The roadmap names the wOS applications that replace the target (`Roadmap.apps`, `wos.target_apps`): Salesforce → `crm`. The Sniper List tracks the target; the application is the product. The roadmap still plans no target-specific shell, login or store listing (D14).

### Migration: getting customers off the target (D59, contracts 5.4.0)

Parity is not enough if a customer cannot leave. Every target roadmap has a `migration` section (`RoadmapMigration` in `artifacts.ts`) that plans how the target's customers bring their data into wOS. The input facts are `docs/scans/<target>.md`, section "Getting data out". The scans are on main, from the `ws/scans` merge.

- **`engine`** is always `import-engine`, the shared catalog feature every importer is built on (below).
- **`classes[]`** has exactly one entry per data class (`MIGRATION_DATA_CLASSES`):

  | Data class | Covers |
  |---|---|
  | `records` | the target's standard objects (Salesforce: Account, Contact, Opportunity...) |
  | `custom_objects_fields` | customer-defined objects and fields, and their metadata |
  | `files_attachments` | files, attachments, documents |
  | `history_activity` | field history, activities, emails, notes, audit trails |
  | `users_permissions` | users, roles and permissions mapped onto wOS Core roles, where the target exposes them |

- **What each class must say.** Either:
  - `connector` names the catalog feature that imports it, with `objects`, `extraction` (method and public source) and `deltaSync` (`supported` or `not_available`, with the source that shows the target's incremental API or its absence); or
  - `connector` is null and `notExtractable` lists what cannot leave the target, each item with a reason and a public source.

  A class that is partly extractable uses both. Nothing is dropped silently.
- **Validation** (`planning.validateRoadmap`). It fails on:
  - `MIGRATION_MISSING`: the section is absent;
  - `MIGRATION_CLASS_MISSING` and `MIGRATION_CLASS_DUPLICATE`: a data class is missing or listed twice;
  - `MIGRATION_CLASS_UNACCOUNTED`: a class has no connector and no sourced not-extractable list;
  - `MIGRATION_EXTRACTION_MISSING`: an imported class lacks its objects, its extraction or its delta-sync source;
  - `MIGRATION_FEATURE_NOT_IN_CATALOG`: the engine or a connector is neither in the catalog nor proposed in `newCatalogFeatures`.

  TGT-00 warOnSaaS is exempt: it has no customers to move off.
- **Reviews.** Roadmap reviewers treat an unaccounted class, an unsourced extractable or not-extractable claim, and a documented incremental API that was missed as material findings (policy data, D59).

**Importer guarantees** (Feature Contracts of `import-engine` and every connector; reviewers treat a gap as material):
- **Mapping:** from the target's objects and fields (including custom ones) onto wOS modules' entities, reviewed before a run.
- **Dry run:** the full run without writing, producing the same report.
- **Verification report:** per object, the counts read, written, skipped and failed, with checksums of the source and imported data. Every skipped or failed record has a reason. Nothing is silently dropped.
- **Idempotent re-runs:** re-running converges and never duplicates, keyed on the target's record ids.
- **Delta sync during cutover:** wherever the target exposes an incremental API, so a customer can keep working in the target until the switch.

**`import-engine` is shared infrastructure stewarded by TGT-00 warOnSaaS.**
- It is built once and reused by every target's connectors.
- Its catalog entry lives in the product repo (`catalog/import-engine.yaml`), because it runs on customer data inside wOS Core and catalogs are per repository (G-54). The entry is created in the first product roadmap PR that references it.
- Per-target connectors (`salesforce-import`, ...) are small catalog features whose contracts depend on it.
- The first proof is importing Salesforce contacts and accounts in the first CRM catalog build.

**Credentials.** An importer signs in to the customer's own account of the target with the customer's own OAuth tokens. The tokens are held encrypted and scoped to one organization. wOS never uses its own credentials to read a customer's data. The detailed design (connections, token storage, refresh, revocation) is Amendment 03 and is not specified here.

## 3. Lifecycle

The roadmap workflow is a `documents` row with `kind = 'roadmap'` driven by `DocumentMachine`. Only one open roadmap workflow per app exists at a time (`documents_one_open_roadmap`: unique `target_id` where state not in `merged`, `abandoned`). This is the spec's "ONE canonical active Roadmap PR per application".

| From | Event | To | Actor | Guard / effect |
|---|---|---|---|---|
| (none) | maintainer `openRoadmap` | `drafting` | maintainer | 409 `CONFLICT` if an open roadmap exists. Creates the `documents` row (version = last merged + 1, abandoned rows excluded), branch `wos/roadmap/<target>/v<n>` (a re-opening after an abandoned opening of the same version: `wos/roadmap/<target>/v<n>-<k>`, k = 2, 3, …, because the abandoned branch stays App-owned), and one open `roadmap_author` task. Event `document.opened`. |
| `drafting` / `revising` | `revision_submitted` | `validating` | contributor | Caller holds the author task lease; changeset only touches document paths. |
| `validating` | `validation_passed` | `in_review` | system | Section 2 checks pass; the App commits the changeset to the branch; on the first valid revision the App opens the PR as a draft titled `<productName> Replacement Roadmap` (e.g. "Zoom Replacement Roadmap"); `round_number += 1`; a round opens on the head sha + submission hash with one Astra and one Fable review task. |
| `validating` | `validation_failed` | `revising` | system | New author task with the errors. |
| `in_review` | `round_gaps` | `revising` | system | Round revealed with at least one open material finding and `round_number < roadmapMaxRounds` (6). New author task. |
| `in_review` | `round_limit_reached` | `escalated` | system | Open material findings at round 6, or a finding disputed in 2 consecutive rounds (`disputeEscalationRounds`). A `conflict_resolution` task opens. |
| `in_review` | `round_consensus` | `consensus` | system | Both slots `NO_MATERIAL_GAPS` on the same head sha and submission hash in the same round. App sets `wos/consensus` = success and `wos/qualified` = success (one context every mergeable PR carries, contracts 5.15.0), marks the PR ready for review. Under the D53 fallback the second slot is the required human review (REVIEW-PROTOCOL "D53 in the V1 control plane"). Event `document.consensus_reached`. This is ROADMAP CONSENSUS. |
| `escalated` | `ruling_upheld` | `revising` | maintainer | Every escalated finding ruled and confirmed; at least one upheld. |
| `escalated` | `ruling_all_overruled` | `validating` | maintainer | All overruled; a fresh round opens on the unchanged head with overruled findings closed. |
| `consensus` | `maintainer_reopen` | `revising` | maintainer | Public reason. |
| `consensus` | `pr_merged` | `merged` | github | Merge commit tree equals the consensus head tree. Triggers materialisation (section 5). |
| any non-terminal | `abandon` | `abandoned` | maintainer | Public reason recorded in `ended_reason`; open tasks cancelled, leases revoked. |

Who runs the Roadmap Agent: any eligible contributor who claims the `roadmap_author` task (`GET /v1/tasks?kind=roadmap_author`, `POST /v1/tasks/:id/claim`, or `wos roadmap`), on their own Claude subscription with Fable or Opus at the policy's reasoning (`max`, floor). Nobody is assigned; the task sits open until claimed. Its obligations (inventory from public sources, exactly-once placement, catalog reuse, D12 weights with rationale, answering every open finding) are rendered verbatim from `agent-policy.v1.json` `roles[roadmap_author].obligations`.

Who merges: FOUNDER DECISION (see GAPS.md). Recommendation: during bootstrap a maintainer approves the PR; the App then adds it to the merge queue. Required status checks: `wos/consensus` (App-only source) and `wos-verify`. With the merge queue (contracts 5.15.0) the App answers `merge_group.checks_requested` by setting `wos/qualified` (and `wos/consensus` for documents) on the merge-group commit when the group's PR is an open wOS PR at consensus or qualified, `failure` otherwise; the ruleset can then require `wos/qualified` for every PR.

Proposals: `wos propose` creates a `proposals` row and a GitHub Issue labelled `wos:proposal` (opened by the App, D9). Open proposals for the target are included in the next author task's context; the author lists the ones it incorporated in `proposals[]` and in `AuthorSummary.proposalsAddressed`. A proposal moves `open -> accepted` (maintainer or the author task) and `accepted -> incorporated` when a merged version references it.

## 4. Versions and capability-at-a-time

- The first merged roadmap is version 1. Every later change is a new version opened by a maintainer as the single active roadmap PR; its file replaces the previous one in full.
- Every version lists every capability with weights (the skeleton). A capability with an empty `features` list is unmapped. A later version maps more capabilities. So CRM features of Salesforce can start as soon as a version that maps only `crm` merges.
- Weights are frozen with the merged version. Changing any weight, adding or removing a capability, or moving inventory items needs a new version through the same consensus loop. Reviewers see the previous merged version and must treat unjustified weight changes as material (MIS-WEIGHTING rule).
- Every percentage published states the roadmap version it was computed with (`Progress.roadmapVersion`, `progress_snapshots.roadmap_version`).
- A capability that is under review in an open version counts as it did in the last merged version: unmapped capabilities contribute 0 to MAPPED until the version that maps them merges.
- Inventory changes: a version may propose a new inventory version (new items found by reviewers). MAPPED is by capability weight, so adding items to a mapped capability does not lower MAPPED; it forces the capability's feature refs to cover the new items (validation) and may justify re-weighting in that version.

## 5. Materialisation on merge (D11)

When the roadmap PR merges (`pr_merged`, processed from the `pull_request` webhook), in ONE transaction:

1. `documents.state = merged`, `merged_sha`, `merged_at`; `inventory_versions` of this version `proposed -> frozen`, previous frozen `-> superseded`.
2. Upsert `capabilities` for the target from the file: `weight_bp`, `weight_rationale`, `mapped`, `roadmap_version`; capabilities no longer present get `retired = true`.
3. For each `newCatalogFeatures` key: insert `catalog_features` (`state = active`, `created_by_document_id`). Event `catalog.feature_added`.
4. For each feature ref: upsert `app_features` (unique `target_id, catalog_feature_id`) with capability, `weight_bp`, `weight_rationale`, `app_notes`, `phase`, `roadmap_version` (and `first_roadmap_version` on insert, state `mapped`). Event `app_feature.tracked`.
5. For each `app_features` row of this target whose feature is no longer referenced: state `-> descoped` (`descoped` event, actor github).
6. Write `inventory_dispositions` for the frozen inventory (capability, app feature, or excluded reason).
7. Open or link the Feature Contract workflow for each referenced catalog feature:
   - no contract workflow ever opened: open one (`feature_contract`, version 1, `drafting`, one `feature_author` task) whose task spec names this app as needing a profile;
   - a contract workflow is open: add this app to that workflow's author task spec (it must add this app's profile before consensus); app feature `mapped -> specifying` (`contract_workflow_linked`);
   - a contract is merged and already has this app's profile: app feature `mapped -> specified` (`profile_merged`);
   - a contract is merged without this app's profile: open contract version n+1 with this app in `impactedTargets` and a task spec to add its profile; app feature `-> specifying`.
8. Insert one `document.merged` event. The progress consumer (section 6) recomputes.

All steps are idempotent: they are keyed by `(document_id)` and re-running the materialisation for an already merged document is a no-op (the webhook is deduplicated by `X-GitHub-Delivery`, and the transition guard `state = consensus` fails on replay).

## 6. Progress

Implemented exactly by `computeAppProgress` / `computeFeatureProgress` in `packages/contracts/src/progress.ts`. Integers only; basis points (0..10000); always floor.

| Level | MAPPED | SPECIFIED | BUILT |
|---|---|---|---|
| App feature f (app A) | (weight shown) | 10000 if the latest merged contract of f contains A's profile, else 0 | 0 if not specified; else floor(10000 x merged size points / relevant size points), capped at 9999 until complete, then 10000 |
| Capability c | 10000 if mapped, else 0 (shown as "mapped" or not) | floor(sum_f w_f x SPECIFIED_f / 10000) | floor(sum_f w_f x BUILT_f / 10000) |
| App A | sum of W_c over mapped capabilities | floor(sum_c sum_f W_c x w_f x SPECIFIED_f / 10^8) | floor(sum_c sum_f W_c x w_f x BUILT_f / 10^8) |

Definitions:

- `W_c`: capability weight toward the app (bp). `w_f`: feature weight inside its capability (bp). Effective app weight of a feature = floor(W_c x w_f / 10000), published on the feature page.
- Relevant ABUs of f for A: non-superseded ABUs of f's latest merged contract whose `requirements` intersect A's profile. A shared ABU counts for every app whose profile it touches (built once, D10). Building HubSpot-only ABUs does not move Salesforce.
- Complete (for A): at least one relevant ABU, every requirement in A's profile covered by merged ABUs, and A's profile acceptance suite passed on the default branch after the last relevant merge.
- How acceptance is recorded (contracts 3.0.0): `wos-verify` runs, on every push to the default branch, one check run per profile named `profileAcceptanceCheckName(feature, target)` = `wos-acceptance/<feature>/<target>`. The control plane records each concluded run as `verification_runs` (subject `profile_acceptance`, `catalog_feature_id`, `profile_target_id`, `head_sha`, `conclusion`) and emits `verification.recorded`, which triggers the progress consumer. `profileAcceptancePassed` is true when the latest recorded run for (feature, target) on a default-branch commit that contains the last merged relevant ABU concluded `success`.
- Invariant: BUILT <= SPECIFIED <= MAPPED at every level. 10000 only when literally complete.
- Before the first roadmap merges, every number is 0 (`roadmap: null`).
- Unmapped capabilities are 0/0/0. The inventory size and excluded count are reported next to the numbers but weight nothing.
- The within-feature split is mechanical by ABU size points (1, 2, 3, 5, 8), fixed in the consensus build graph. V1 allows no per-requirement weight override (G-30).

Display: `formatPercent(bp)`: `0%`; `<1%` for 1..99 bp; whole percent floored, max `99%` below 10000; `100%` only at 10000. Every surface (web, Desktop, CLI) uses it.

### Recompute and traceability

- The `progress` event consumer runs on every event that can change an input: `document.merged` (roadmap or contract), `attempt.merged`, `abu.state_changed` to `superseded`, `app_feature.state_changed`, and the profile acceptance workflow result (a `wos-verify` check suite on the default branch reported via `check_suite` webhook).
- It builds the `ProgressInput` for each affected app from the database (latest merged roadmap version, latest merged contract per feature, profiles, ABUs), computes `AppProgress`, and appends to `progress_snapshots`: one `app` row (with `detail` = the full `AppProgress` JSON), one `capability` row per capability, one `feature` row per app feature, all with `input_sha256` = sha256 of the canonical JSON of the input and `cause_event_id`. It emits `progress.recomputed` with the same hash.
- If the newest `app` snapshot for the target already has the same `input_sha256`, nothing is written (idempotent).
- Snapshots are append-only (DB trigger). `v_target_progress` serves the latest app row; history via `GET /v1/public/targets/:slug/progress`.
- Traceability: every number on the web links to the weights (the merged roadmap file at `merged_sha`), the profile (the merged contract), the ABUs and their PRs. The `detail` JSON contains `relevantPoints`, `mergedPoints` and per-requirement ABU lists, so any percentage can be re-derived from records.

### Per-surface progress (D13, contracts 4.0.0)

`progress.ts` computes every feature per surface: a surface is SPECIFIED when the merged contract's profile for the app has requirements tagged with it, and BUILT by the size points of the ABUs relevant to those requirements, capped at 9999 until the surface's own acceptance check `wos-acceptance/<feature>/<target>/<surface>` passed. The feature's numbers are the surface-weighted sum, so a feature reaches 10000 only when every in-scope surface is complete; iOS and Android are separate surfaces with separate checks. `AppProgress.surfaces` gives per-surface app progress (over the features that include the surface) for the drilldown, and each `AppFeatureSummary.surfaces` shows the weights, rationales and numbers.

### Target progress versus application progress (Amendment 01)

Target progress (above) is unchanged, and it never reads entitlements or installs: enabling or disabling CRM changes nothing on the Sniper List (V1 proof step 9). Application progress (wOS CRM overall and per surface) is derived from the same merged ABUs and acceptance records of the application's features (WOS-APP-PROTOCOL section 11).

## 7. Failure paths

| Situation | Handling |
|---|---|
| Author lease expires | Task `leased -> open` (`lease_lost`); anyone eligible may claim. No penalty; no partial commit exists because submissions are atomic. |
| Two contributors race to claim the author task | `leases_one_active_per_task` unique index; the loser gets 409 `CONFLICT`. |
| Maintainer opens a second roadmap for the app | 409 `CONFLICT` (partial unique index). |
| App commit fails after a valid submission (GitHub outage) | Task `submitted -> open` (`reject_output`) after retries; document stays `validating` until a submission is committed or the maintainer abandons. |
| Merge conflict with another app's roadmap PR proposing the same catalog key | Merge queue fails; the later PR's document returns to `revising` via a maintainer reopen or the next author revision must reuse the now-existing key. Reviewers of the later PR see the catalog at its head. |
| Roadmap merged but materialisation transaction fails | Webhook delivery stays unprocessed (`webhook_deliveries.processed_at` null) and is retried by the dispatcher; the transaction is all-or-nothing. |
| Reviewers never agree | Round limit 6 or repeated disputes escalate; the resolver rules; the maintainer confirms (REVIEW-PROTOCOL.md). |

## 8. TGT-00 warOnSaaS

warOnSaaS is its own first target (rank 0). Its V1 roadmap is `docs/roadmap/waronsaas.roadmap.json`, a `RoadmapBundle` with status `PROPOSED`: 41 inventory items drawn from V1-SPEC.md and DECISIONS.md, 7 capabilities, 28 catalog features, weights with rationale, and proposed requirements per feature. A test validates it against the schema and the coverage rules. It has not been through Astra/Fable review; the V1 build is tracked against it exactly like a target (WORKSTREAMS.md).

TGT-00 is exempt from the migration section (D59). It stewards the shared `import-engine` feature, which is catalogued in the product repo because it runs on customer data (section 2, "Migration").

## 9. The roadmap method (D72, agent-policy.v3, contracts 5.19.0)

Every roadmap author, whatever the model, follows one method, so two runs on the same context land close to each other and reviewers can check the result mechanically. The data is in `agent-policy.v3` `roadmapMethod`, generated from the scans by `scripts/gen-roadmap-method.mjs`. The author and both reviewers receive it as the server document `wos:method/<target>`.

1. **Scan-seeded skeleton.** Every capability id of the target's scan (`docs/scans/<target>.json`, vocabulary ids) goes either into exactly one capability's `scanIds`, or into `scanExcluded` with a reason and a public source. A capability beyond the scan lists `sources`. Validator codes: `SCAN_CAPABILITY_UNACCOUNTED`, `SCAN_ID_UNKNOWN`, `SCAN_ADDITION_UNSOURCED`.
2. **Required reading.** Per target, derived from the scan's sources by a fixed rule: editions and pricing, a feature docs page, the App Store and Google Play listings, the API docs, and the export or bulk API docs. The author fetches these first; extra pages are allowed. Fetches are logged (D70), so a comparison can see whether two runs read the same core pages.
3. **Weight rubric `wos-weight-rubric.v1`.** Each capability is scored 1–5 on four criteria, each score with a basis (a source URL or a scan fact):
   - edition breadth;
   - core daily use;
   - surface parity need;
   - migration data gravity.

   Points = the sum of the four scores. `weightBp` = the capability's share of all points × 10000, apportioned by largest remainder (ties: capability order). Planning exposes this as `rubricWeights`. The scores are written in `ROADMAP.yaml` (`rubric`), with `weightRubric: wos-weight-rubric.v1`. D12's reasoned weights remain, derived from the rubric, with a short rationale. Validator codes: `RUBRIC_MISSING`, `RUBRIC_WEIGHT_MISMATCH` (tolerance 1 bp).
4. **Step order, with files written at each step:**
   1. `INVENTORY.yaml`;
   2. capability mapping;
   3. rubric scores and weights;
   4. D59 migration;
   5. catalog proposals;
   6. self-check;
   7. the author summary, last.
5. **Sub-agent partition.** Where a model may use sub-agents, each helper gets a fixed cluster of scan ids. Clusters come from the scan vocabulary's groups: a group larger than a fair share is split into consecutive parts; groups are sorted by size, then name, and each goes to the helper holding the fewest ids so far. The lead merges the clusters and owns keys, weights, consistency and the migration section.
6. **Self-check before the summary.** Check that:
   - every scan id is placed;
   - every inventory item cites a fetched page or a scan source;
   - the weights match the rubric;
   - D59 is complete;
   - the files parse.

   Gaps are fixed first.

The control plane applies the method checks to a revision authored under a plan of the policy in force (agent-policy.v3 or later). Documents authored under earlier plans keep the earlier rules.

## 10. Drift control (D73, agent-policy.v4, roadmap method v2, contracts 5.21.0)

Section 9 tells every author what to cover. This section removes the freedom that made two runs of the same author differ: the capability list, the feature keys and uncited sources are fixed, several runs can be merged into one, and whatever stays open is a decision the reviewers rule on. The data is `agent-policy.v4` `roadmapMethod` (version `wos-roadmap-method.v2`), generated by `scripts/gen-roadmap-method.mjs`, served as `wos:method/<target>` (now with `template`, `scanSources` and `defaultCatalog`). Revisions authored under v3 plans keep the section 9 rules only.

### 10.1 The capability template

Per target, `roadmapMethod.targets.<target>.template` lists the capabilities: one per vocabulary group that the target's scan uses, in vocabulary order, key = the group name in kebab case, with that group's scan ids. For Salesforce: `platform` (28 scan ids), `crm` (18), `marketing` (4), `service` (2).

- Every inventory item carries `scanId`: the vocabulary id it belongs to, or null for an item beyond the scan (with a source).
- An item goes into the capability of its scan id's group.
- A capability may be split, merged or added only with `templateDeviation` (`kind` split, merge or addition; the template keys it touches; a reason of 20 characters or more) and a `template_deviation` decision.

Validator codes: `TEMPLATE_CAPABILITY_MISSING`, `TEMPLATE_DEVIATION_UNREASONED`, `ITEM_SCAN_ID_MISSING`, `ITEM_OUTSIDE_TEMPLATE`, `DECISION_MISSING`.

### 10.2 Catalog-first features

The default catalog feature of a scan capability id is the id itself, shared across targets (D10). Its entry is fixed: title = the id's words capitalised, summary = the vocabulary definition (planning `defaultCatalogEntry`; `wos:method` lists them as `defaultCatalog`).

- **The first roadmap creates the initial catalog.** A roadmap that references a default not yet in `catalog/` lists it in `newCatalogFeatures` and writes `catalog/<id>.yaml` exactly as the default entry. That needs no decision. When the roadmap merges (section 5), the file is in the catalog and later roadmaps of other targets reference it without listing it.
- **Anything else is a catalog proposal.** A new key outside the vocabulary (a split of a default, a connector, a feature beyond the scan) is listed in `newCatalogFeatures`, gets its catalog file, and a `catalog_proposal` decision the reviewers rule on.
- `import-engine` (D59) is the one fixed key outside the vocabulary.

Validator codes: `CATALOG_PROPOSAL_UNDECIDED`, `CATALOG_DEFAULT_MODIFIED`.

### 10.3 Grounding

Every URL the revision cites must be a page fetched by the run that wrote it, or a URL the target's scan cites (`scanSources`). Cited URLs are: inventory sources, capability `sources`, URLs inside a rubric basis, migration extraction, delta-sync and not-extractable sources, and scan exclusion sources (planning `citedUrls`). URLs are compared without scheme, `www.` and trailing slashes. The control plane reads the fetch logs of the revision's lease and, for an ensemble, of the runs it names. When no run recorded a fetch log (runs before contracts 5.17.0) grounding is not checked. Validator code: `UNGROUNDED_SOURCE`.

### 10.4 Decisions

`ROADMAP.yaml` `decisions` lists what the reviewers must rule on, each with an id (`DEC-001`…), a kind (`template_deviation`, `catalog_proposal`, `ensemble_disagreement`), the subject, a summary, the options (for an ensemble: which runs said what, with their sources) and what the revision chose. `roadmaps/<target>/DECISIONS.md` renders them for people (an ensemble writes it; it is part of the roadmap's document scope). Validator code: `DECISION_DUPLICATE`. Reviewers rule on every decision (REVIEW-PROTOCOL section 5).

### 10.5 Ensemble authoring

`wos roadmap <task> --ensemble N` (N from 2 to `ensemble.maxRuns`, 5; the default the policy names is 3):

1. N shadow runs of the task, one after another (a task holds one lease at a time). Each claims the task, builds the same context, runs the model, posts its signed run record (`mode: shadow`), archives under `<WOS_HOME>/shadow/<task>/<run>/` and releases. All N must report the same manifest hash, or the ensemble stops (`ENSEMBLE_CONTEXT_CHANGED`).
2. A deterministic merge (planning `mergeRoadmapRuns`), no model involved:
   - the majority threshold is a strict majority, `floor(N/2)+1`;
   - inventory items match across runs by normalised title; an item, a surface, a capability (by key) and a feature reference are kept when the threshold of runs has them; each item goes to the capability most runs put it in;
   - rubric scores take the median per criterion (the lower median for an even count); capability weights are derived from the merged scores (`rubricWeights`); a feature's weight is the median of its weights, re-apportioned within its capability;
   - per migration data class, the variant the threshold of runs wrote is kept;
   - the catalog files are the defaults and proposals the merged roadmap references; the runs' own template and catalog decisions on what survived are kept;
   - what the threshold did not settle becomes an `ensemble_disagreement` decision listing each run's version (an item left out, a placement or migration variant taken from run 1, a capability dropped).
3. The merged `INVENTORY.yaml`, `ROADMAP.yaml`, catalog files and `DECISIONS.md` are validated locally with the union of the runs' fetch logs. A merge that does not validate is archived under `<WOS_HOME>/ensemble/` and refused (`ENSEMBLE_MERGE_INVALID`).
4. The task is claimed once more; that lease's manifest must equal the runs'. The changeset's summary carries `ensemble`: the N runs (lease, agent run, manifest), the threshold, the decision count and the stability. The control plane accepts it only if every named run is a distinct, signed shadow run of the caller on the same task and the same manifest.

Ensembles are for document authoring (`ensemble.roles`: roadmap and feature contract authors); builds stay single-run. The merge is implemented for roadmaps; a feature-contract ensemble is refused until its merge exists.

### 10.6 Stability

Measured across the runs (planning `ensembleStability`), pairwise with the minimum over pairs:

| metric | how | target (policy `ensemble.stabilityTargets`) |
|---|---|---|
| capabilities matched | shared capability keys / all keys | ≥ 90% |
| features matched | shared feature keys / all keys | ≥ 80% |
| weight Spearman | rank correlation of capability weights on shared keys (n/a when all weights tie) | ≥ 0.85 |
| grounding | cited URLs grounded, minimum over runs | 100% |

The summary and the PR body show the table. Below a target the PR gets the label `low-stability` (policy `ensemble.lowStabilityLabel`); it does not block. `tools/experiments/roadmap-drift/compare.ts` reports the same metrics for any two sides.

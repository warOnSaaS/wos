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
| The ten Sniper Targets | `waronsaas/suite` (the product repo, name is FOUNDER DECISION G-05) | `roadmaps/<target>/INVENTORY.yaml`, `roadmaps/<target>/ROADMAP.yaml`, new `catalog/<key>.yaml` files |
| TGT-00 warOnSaaS (wOS itself) | `waronsaas/waronsaas` (platform repo) | `docs/roadmap/waronsaas.roadmap.json` (a `RoadmapBundle`, status PROPOSED) |

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
| `architecture` | how `products/<target>` composes shared `modules/<feature>` code, app-specific data, self-hosting |
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

### Validation (deterministic, before any round opens)

A revision is valid only if all of these pass. Failure moves the document `validating -> revising` (`validation_failed`) with the errors carried into the new author task (`tasks.carry`); the round counter does not advance.

1. YAML parses (`@waronsaas/planning` `parseInventoryYaml`, `parseRoadmapYaml`, `parseCatalogEntryYaml`).
2. Zod schema passes, including the `Roadmap` `superRefine`: capability weights sum to 10000; each mapped capability's feature weights sum to 10000; no feature listed twice in one capability; every weight 1..10000 with a rationale of at least 40 characters.
3. `planning.validateRoadmap(roadmap, inventory, catalog, previousMergedVersion)`:
   - every inventory item in exactly one capability or excluded, none unknown;
   - mapped capabilities: feature refs cover the capability's items exactly;
   - every referenced feature exists in the catalog at the PR head, or is listed in `newCatalogFeatures` with its catalog file;
   - no reference to an `aliased` catalog feature;
   - `version = previousMergedVersion + 1` (1 when none).
4. The changeset touched only document paths: `roadmaps/<target>/**` and `catalog/<key>.yaml` for keys in `newCatalogFeatures` (see BUILD-PROTOCOL.md "Submissions"; error `OUT_OF_SCOPE`).

## 3. Lifecycle

The roadmap workflow is a `documents` row with `kind = 'roadmap'` driven by `DocumentMachine`. Only one open roadmap workflow per app exists at a time (`documents_one_open_roadmap`: unique `target_id` where state not in `merged`, `abandoned`). This is the spec's "ONE canonical active Roadmap PR per application".

| From | Event | To | Actor | Guard / effect |
|---|---|---|---|---|
| (none) | maintainer `openRoadmap` | `drafting` | maintainer | 409 `CONFLICT` if an open roadmap exists. Creates the `documents` row (version = last merged + 1), branch `wos/roadmap/<target>/v<n>`, and one open `roadmap_author` task. Event `document.opened`. |
| `drafting` / `revising` | `revision_submitted` | `validating` | contributor | Caller holds the author task lease; changeset only touches document paths. |
| `validating` | `validation_passed` | `in_review` | system | Section 2 checks pass; the App commits the changeset to the branch; on the first valid revision the App opens the PR as a draft titled `<productName> Replacement Roadmap` (e.g. "Zoom Replacement Roadmap"); `round_number += 1`; a round opens on the head sha + submission hash with one Astra and one Fable review task. |
| `validating` | `validation_failed` | `revising` | system | New author task with the errors. |
| `in_review` | `round_gaps` | `revising` | system | Round revealed with at least one open material finding and `round_number < roadmapMaxRounds` (6). New author task. |
| `in_review` | `round_limit_reached` | `escalated` | system | Open material findings at round 6, or a finding disputed in 2 consecutive rounds (`disputeEscalationRounds`). A `conflict_resolution` task opens. |
| `in_review` | `round_consensus` | `consensus` | system | Both slots `NO_MATERIAL_GAPS` on the same head sha and submission hash in the same round. App sets `wos/consensus` = success, marks the PR ready for review. Event `document.consensus_reached`. This is ROADMAP CONSENSUS. |
| `escalated` | `ruling_upheld` | `revising` | maintainer | Every escalated finding ruled and confirmed; at least one upheld. |
| `escalated` | `ruling_all_overruled` | `validating` | maintainer | All overruled; a fresh round opens on the unchanged head with overruled findings closed. |
| `consensus` | `maintainer_reopen` | `revising` | maintainer | Public reason. |
| `consensus` | `pr_merged` | `merged` | github | Merge commit tree equals the consensus head tree. Triggers materialisation (section 5). |
| any non-terminal | `abandon` | `abandoned` | maintainer | Public reason recorded in `ended_reason`; open tasks cancelled, leases revoked. |

Who runs the Roadmap Agent: any eligible contributor who claims the `roadmap_author` task (`GET /v1/tasks?kind=roadmap_author`, `POST /v1/tasks/:id/claim`, or `wos roadmap`), on their own Claude subscription with Fable or Opus at the policy's reasoning (`max`, floor). Nobody is assigned; the task sits open until claimed. Its obligations (inventory from public sources, exactly-once placement, catalog reuse, D12 weights with rationale, answering every open finding) are rendered verbatim from `agent-policy.v1.json` `roles[roadmap_author].obligations`.

Who merges: FOUNDER DECISION (see GAPS.md). Recommendation: during bootstrap a maintainer approves the PR; the App then adds it to the merge queue. Required status checks: `wos/consensus` (App-only source) and `wos-verify`.

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

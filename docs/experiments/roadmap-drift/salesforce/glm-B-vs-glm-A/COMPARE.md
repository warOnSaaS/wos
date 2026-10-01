# Roadmap drift: salesforce, A vs B

Deterministic comparison (tools/experiments/roadmap-drift). No model judged anything. A textual difference is not
an error by itself, and neither side is ground truth: a roadmap is a reference only after it passes Astra and
human review.

Sources: `/Users/adventurini/.wos/shadow/01a0f47a-0b77-7043-9299-0b237bb8d59c/2026-10-01T01-03-48-208Z-01a0f4e0` and `/Users/adventurini/.wos/failed/01a0f47a-0b77-7043-9299-0b237bb8d59c/2026-10-01T01-31-25-130Z-01a0f4fd`.

## Validity

| | A | B |
|---|---|---|
| schema violations | 0 | 0 |
| validateRoadmap errors | 2 | 0 |
| D72 method errors (scan, rubric) | 0 | 0 |

### A

Errors by code:

- SURFACE_DUPLICATE: 1
- SURFACE_NOT_IN_INVENTORY: 1

### B

No schema violations and no validator errors.

## Scan coverage (D72)

| | A | B |
|---|---|---|
| scan ids placed | 52/52 | 52/52 |
| scan ids excluded | 0 | 0 |
| scan ids unaccounted | 0 | 0 |
| scan ids in matching capabilities | 38/52 |  |

## Inventory

| | A | B |
|---|---|---|
| items | 52 | 53 |
| sources | 30 | 28 |
| distinct sources cited by items | 6 | 8 |
| surfaces | 7 | 8 |
| items citing a valid source | 100.00% | 100.00% |
| duplicate source URLs | 0 | 0 |
| placeholder source URLs | 0 | 0 |
| inventory sources in the run's fetch log | 8/30 | 5/28 |
| required reading fetched | editions_pricing, feature_docs, app_store, google_play, export_api | editions_pricing, feature_docs, app_store, google_play, export_api |
| required reading missed | none | none |

Items matched by source URL and normalised title: 48; only in A: 4; only in B: 5. By normalised title alone: 49.

Only in A (title): accounts person accounts, collaborative forecasts advanced forecast pipeline management, sales programs

Only in B (title): accounts and person accounts, collaborative forecasts advanced forecast and pipeline management, data export service export backup data, sales programs sales enablement

## Capabilities and features

| | A | B |
|---|---|---|
| capabilities | 21 | 15 |
| mapped capabilities | 14 | 15 |
| feature refs | 33 | 49 |
| excluded items | 0 | 0 |

Capabilities matched (key, title or shared scan ids): 14; by key: 4; by title: 5. Feature keys in both: 13.

## Weights

| capability weights | A | B |
|---|---|---|
| count | 21 | 15 |
| min | 258 | 273 |
| median | 480 | 656 |
| max | 701 | 984 |
| top3ShareBp | 1992 | 2787 |
| rubric (declared / scored / weights follow) | wos-weight-rubric.v1 / 21 / true | wos-weight-rubric.v1 / 15 / true |

Matched capabilities: 14; mean absolute weight difference 212.4 bp; Spearman rank correlation 0.7769.
Per scan id (the weight of the capability each side placed it in): 52 comparable; mean absolute difference 204.2 bp; Spearman 0.5822.

Largest disagreements (bp):

| A | B | matched by | A bp | B bp | delta |
|---|---|---|---|---|---|
| sales-engagement | sales-engagement | key | 406 | 874 | +468 |
| opportunity-pipeline | deal-management | scanIds | 627 | 929 | +302 |
| account-contact-management | accounts-contacts | scanIds | 701 | 984 | +283 |
| app-platform | extensibility | scanIds | 332 | 601 | +269 |
| mobile | mobile | key | 553 | 820 | +267 |
| reporting-analytics | reporting | scanIds | 554 | 820 | +266 |
| service-essentials | service | scanIds | 406 | 601 | +195 |
| sales-planning | sales-planning | key | 369 | 547 | +178 |
| ai-assistance | ai | title | 295 | 437 | +142 |
| workflow-automation | automation | scanIds | 406 | 546 | +140 |

## Catalog proposals

newCatalogFeatures: A 35, B 50, in both 15.

## Migration (D59)

| data class | A | B |
|---|---|---|
| records | complete; salesforce-connector; 22 objects; delta supported; 2 not extractable | complete; salesforce-connector; 17 objects; delta supported; 0 not extractable |
| custom_objects_fields | complete; salesforce-connector; 7 objects; delta not_available; 1 not extractable | complete; salesforce-connector; 7 objects; delta not_available; 1 not extractable |
| files_attachments | complete; salesforce-connector; 7 objects; delta supported; 0 not extractable | complete; salesforce-connector; 7 objects; delta not_available; 0 not extractable |
| history_activity | complete; salesforce-connector; 4 objects; delta supported; 2 not extractable | complete; salesforce-connector; 4 objects; delta supported; 2 not extractable |
| users_permissions | complete; salesforce-connector; 7 objects; delta supported; 0 not extractable | complete; salesforce-connector; 6 objects; delta supported; 0 not extractable |


# Target scans

> **SCAN — unreviewed, 2026-09-30.** Everything in this folder is a scan. It has not been reviewed by anyone, and it counts toward no progress percentage anywhere.

## What a scan is

A scan is a short, shallow look at one Sniper List target's public product surface. It is a table of contents, not a roadmap. It has three jobs:

1. It is the starting outline for that target's roadmap v1.
2. It maps overlap across targets: which capability areas several targets share, and so should be built once and reused (`OVERLAP.md`).
3. It gives the website honest content before any roadmap exists.

For each target the scan records:

- 20 to 60 capability areas at catalog level, not every button. Each area has:
  - a shared vocabulary id;
  - the vendor's own name for it;
  - a one or two sentence description;
  - the surfaces public sources show it on;
  - the lowest plan or edition that includes it, where a public page states one;
  - one to three source URLs.
- The product's own client apps (the parity rule: iPhone app, browser and each target's own apps).
- Its public API style.
- A "Getting data out" section: export options and their limits, bulk, incremental and event APIs, the auth model for a third-party importer, stated rate limits, what is hard to get out, and the migration tools the vendor documents. These are facts for a future shared import engine, not a design.
- What the scan could not see, and every search or fetch that failed.

## What a scan is not

- **Not a roadmap.** It has no build units, weights, budgets or progress, and it does not decide what warOnSaaS builds or in what order.
- **Not reviewed.** No Astra or Fable round has looked at it, and nothing here should be presented as reviewed or as consensus.
- **Not progress.** A scan never counts toward MAPPED, SPECIFIED or BUILT, or toward any other percentage. The Sniper List numbers stay 0% until a roadmap merges (ROADMAP-PROTOCOL section 6).
- **Not complete.** It is shallow by design. A missing capability means the scan did not list it, not that the product lacks it.
- **Not the Feature Catalog.** The vocabulary ids are scan vocabulary. A roadmap may adopt, split or rename them through its own review.

## Relation to roadmaps

Roadmap v1 for each target starts from its scan and supersedes it. The roadmap's `INVENTORY.yaml` is the real completeness evidence, reviewed by Astra and Fable (ROADMAP-PROTOCOL section 2). Once a target's roadmap v1 merges, its scan is history.

The web workstream will show the scans later. It must label them "SCAN — unreviewed" and never show them as progress.

## Files

| File | What it is |
|---|---|
| `vocabulary.json` | Source of truth for the shared capability ids: id, group, one-line definition, and a note where vendors differ materially. |
| `<slug>.json` | Source of truth for one target's scan: `salesforce`, `hubspot`, `slack`, `zoom`, `shopify`, `quickbooks`, `jira`, `zendesk`, `docusign`, `netsuite`. |
| `<slug>.md` | Generated readable version of the scan. |
| `VOCABULARY.md` | Generated readable vocabulary, with how many scans use each id. |
| `overlap.json`, `OVERLAP.md` | Generated capability x target matrix, most shared first, plus the cross-target "Getting data out" summary. |

Only the JSON sources are edited by hand. To regenerate everything else:

```
node tools/scans/build.ts
node tools/scans/build.ts --check   # fails if a generated file is stale
```

The schema is local to this workstream (`tools/scans/schema.ts`), not a contract. `tests/scans.test.ts` checks four things:

- every scan validates against the schema;
- every capability id is in the vocabulary;
- every capability and every data-out fact has at least one source URL;
- `reviewed` and `countsTowardProgress` are always `false`, and every generated file is current.

## Method (2026-09-30)

1. A shared capability vocabulary was written first. It grew during the scans: each scanner proposed ids only where nothing fitted, and the proposals were reconciled so that one id is reused wherever the capability is genuinely the same thing. Where vendors' versions differ materially the id stays one and the difference goes in `notes`.
2. Each target was scanned from public sources only:
   - vendor product pages;
   - pricing and edition comparison pages;
   - public help centres and docs;
   - App Store, Google Play and desktop download pages;
   - public API docs.

   Scanners used no login-walled content, respected robots.txt, and fetched one page at a time within a small per-target search budget. A second pass per target gathered the "Getting data out" facts under the same rules.
3. Honesty rules:
   - Every capability cites at least one source the scanner actually fetched or saw in search results.
   - A capability that could not be confirmed is left out or marked `unconfirmed` with a reason.
   - Tiers, counts and features come from sources, never from memory.
   - Failed searches and fetches are recorded in each scan.
4. Scope choices per target are stated at the top of each scan. For example, Salesforce covers Sales Cloud and the core platform and names the clouds it leaves out; QuickBooks covers QuickBooks Online (US).

## Known limits

- **Many plan-comparison pages are rendered by JavaScript.** Where a scanner could not read the plan table itself, `lowestTier` is null or its note gives the weaker source. Plan names are as the vendor's pages showed them on 2026-09-30, and several had changed recently (see each scan).
- **Some tier cells came through a summarising fetcher.** On two targets that fetcher contradicted the raw page; those scanners read the raw HTML instead. Every tier should be spot-checked before a roadmap relies on it.
- **Some sources are search-result snippets, not fetched pages.** This applies where vendor sites blocked fetches or needed JavaScript. Each scan's limits section says where.
- **NetSuite publishes no price list,** so it has no tiers.
- **Surfaces are under-reported rather than guessed.** A capability not marked on `ios` may still exist there.
- **Each scan's own "Limits" and "Search and fetch failures" sections** list the rest.

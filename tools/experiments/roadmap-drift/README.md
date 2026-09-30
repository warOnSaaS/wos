# Roadmap drift: compare two roadmaps of one target

`compare.ts` compares two authored roadmaps of the same target, for example GLM's (the D69 candidate trial) and an
Opus version if one is ever produced. It is deterministic and no model judges anything.

```
node tools/experiments/roadmap-drift/compare.ts <dirA> <dirB> --target salesforce --out docs/experiments/roadmap-drift/salesforce/<a>-vs-<b>
```

Each directory holds `INVENTORY.yaml` and `ROADMAP.yaml` (at its root or under `roadmaps/<target>/`) and any new
`catalog/*.yaml`, e.g. a checkout of each document's branch in warOnSaaS/product
(`git -C <product clone> worktree add <dir> origin/wos/roadmap/salesforce/v1`).

It reports, for each side and side by side:
- schema violations (the contracts' `wos-inventory.v1` / `wos-roadmap.v1` / `wos-catalog-entry.v1` parsers) and
  `validateRoadmap` errors by code;
- inventory size, items matched by source URL and normalised title (and by title alone), items unique to each side;
- capability count and overlap (by key and by normalised title), feature references;
- capability weight distribution and the largest weight disagreements on matched capabilities;
- new catalog features proposed by each and their overlap;
- the D59 migration section per data class (present, connector, objects, delta sync, not-extractable, complete);
- the share of inventory items citing a valid source, duplicate source URLs and placeholder URLs.

Read it carefully:
- A textual difference is not an error. Two good roadmaps can cut capabilities differently.
- Neither side is ground truth. A roadmap becomes a reference only after it passes Astra and human review; run the
  comparison again once a version merges.
- Review findings per round are in the round comments on each PR and in `wos.findings` (public once revealed).

# Architecture blockers (V1 build)

When a workstream finds that a frozen shared contract is insufficient, it writes `blockers/B-<nnnn>-<workstream>.md` here instead of changing the contract. `<nnnn>` is the workstream's own sequence; the suffix keeps ids unique across parallel agents.

The file starts with a fenced `json` block that parses as `ArchitectureBlocker` (`packages/contracts/src/blocker.ts`), followed by any prose. Copy `TEMPLATE.md`. The Lead Architect fills `decision` and, if accepted, versions the contracts (`docs/architecture/CHANGELOG-CONTRACTS.md`) and tells the affected workstreams to rebase. Full rules: `docs/architecture/WORKSTREAMS.md` sections 4 and 5.

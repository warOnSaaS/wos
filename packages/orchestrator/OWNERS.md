# orchestrator

- **Owner:** github-build workstream (spec Agent 4)
- **Purpose:** The single LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR driver used by both wOS CLI and wOS Desktop.
- **Contracts:** consumes `@waronsaas/contracts` 1.0.0 (implements the Orchestrator interface); changes to shared contracts go through an ARCHITECTURE_BLOCKER (`docs/architecture/WORKSTREAMS.md` section 4).
- **Done means:** the DONE list for this workstream in `docs/architecture/WORKSTREAMS.md`.

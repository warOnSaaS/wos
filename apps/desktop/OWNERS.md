# desktop

- **Owner:** desktop workstream (spec Agent 2)
- **Purpose:** wOS Desktop (Electron + React). Main process owns processes, git and fs via the orchestrator; the renderer is sandboxed.
- **Contracts:** consumes `@waronsaas/contracts` 1.0.0; changes to shared contracts go through an ARCHITECTURE_BLOCKER (`docs/architecture/WORKSTREAMS.md` section 4).
- **Done means:** the DONE list for this workstream in `docs/architecture/WORKSTREAMS.md`.

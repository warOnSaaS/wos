# db

- **Owner:** Lead Architect for `migrations/` and the schema tests; control-plane workstream for `src/` (the migration runner)
- **Purpose:** PostgreSQL schema (append-only ledger, RLS) and the migration runner with its ledger.
- **Contracts:** consumes `@waronsaas/contracts` 1.0.0; changes to shared contracts go through an ARCHITECTURE_BLOCKER (`docs/architecture/WORKSTREAMS.md` section 4).
- **Done means:** the DONE list for this workstream in `docs/architecture/WORKSTREAMS.md`.

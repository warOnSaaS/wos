# cli

- **Owner:** cli workstream
- **Purpose:** The `wos` command (npm @waronsaas/cli), a thin shell over the orchestrator.
- **Contracts:** consumes `@waronsaas/contracts` through `@waronsaas/orchestrator` for the build pipeline, and calls four `AppRoutes` (`listMyOrganizations`, `listOrgApps`, `enableApp`, `disableApp`) directly in `src/apps.ts` for `wos orgs` and `wos apps` (WORKSTREAMS 12.4), with the orchestrator's session from the same SecretStore; changes to shared contracts go through an ARCHITECTURE_BLOCKER (`docs/architecture/WORKSTREAMS.md` section 4).
- **Done means:** the DONE list for this workstream in `docs/architecture/WORKSTREAMS.md`.

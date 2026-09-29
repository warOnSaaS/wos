# desktop

- **Owner:** desktop workstream (spec Agent 2)
- **Purpose:** wOS Desktop (Electron + React). Main process owns processes, git and fs via the orchestrator; the renderer is sandboxed.
- **Contracts:** consumes `@waronsaas/contracts` 4.3.0 (Orchestrator, OrchestratorEvent, LocalStatus, SignInPrompt, public routes); changes to shared contracts go through an ARCHITECTURE_BLOCKER (`docs/architecture/WORKSTREAMS.md` section 4).
- **Done means:** the DONE list for this workstream in `docs/architecture/WORKSTREAMS.md`.
- **Layout:** `src/main` (Electron main: one orchestrator, IPC, security), `src/preload` (sandboxed, CommonJS bundle), `src/renderer` (React, no Node, strict CSP), `src/shared/ipc.ts` (`WosBridge`), `dev/` (fake control plane; never packaged), `ci/` (release workflow awaiting B-0004-desktop).
- **Commands (from the repo root, after `npm run build`):** `npm test -w apps/desktop`, `npm run typecheck:test -w apps/desktop`, `npm run start:fake -w apps/desktop` (the app against the fake control plane; sign-in code ABCD-EFGH), `WOS_SHOTS_DIR=<dir> npx electron apps/desktop/dist/app/main-fake.mjs` (screenshots), `npm run dist:mac|dist:linux -w apps/desktop` (CI only for signed builds, D7).

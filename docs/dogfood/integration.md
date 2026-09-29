# Dogfood log: integration (Lead Architect as integrator, Wave 1 gate)

Branch `integration`, built from `architect` (contracts 3.1.0) plus `ws/context-policy` (ee497eb), `ws/verification` (d9021bd), `ws/github-build` (281d6c8), `ws/control-plane` (7d808dc), merged in that order (providers before consumers). Every merge conflict was an add/add on a `blockers/*.md` file and was resolved to the architect's ruled copy. No source conflicts.

## Glue edits made in other workstreams' paths (allowed at the gate; each owner should review)

| # | File (owner) | Edit | Why |
|---|---|---|---|
| 1 | `services/control-plane/src/domain/documents.ts` (control-plane) | `document.opened` emits `target: null` and `relevantTo` for feature contracts | contracts 3.1.0 (B-0005-control-plane) |
| 2 | `services/control-plane/src/deps.ts` (control-plane) | GithubPort calls `@waronsaas/github/app` directly (removed the `ratified()` reflection that answered 502); `getBranchHead` null maps to UPSTREAM_GITHUB; new `requestTeamReview` port method | github-build's functions now exist |
| 3 | `services/control-plane/src/domain/consumers.ts` (control-plane) | after opening a PR that touches toolchain paths, `requestTeamReview(repo, pr, "maintainers")` | BUILD-PROTOCOL section 9 step 5, contracts 3.1.0 |
| 4 | `services/control-plane/src/handlers/work.ts` (control-plane) | manifest dedupe only within the same lease | migration 0004: the deterministic engine gives a re-claimed task the same manifest; the old global uniqueness rejected a legitimate re-claim |
| 5 | `services/control-plane/test/support/harness.ts` (control-plane) | tests use the REAL `checkEligibility`, `checkManifestAgainstPlan`, `validateChangeset`; `manifestFor` builds manifests with the REAL `buildContext` over the fake GitHub and the control plane's own document renderer; fake repo serves placeholders for canonical documents a plan requires; `FakeGithub.requestTeamReview` | "fakes replaced by real packages where both sides now exist"; exposed items 4 and 7 |
| 6 | `services/control-plane/test/{support/flow.ts,*.test.ts}` (control-plane) | `await manifestFor(h, ...)` at 10 call sites | item 5 made it async |
| 7 | `services/control-plane/test/wave1-gate.test.ts` (control-plane) | the toolchain test ABU declares `toolchain:modules/accept/package.json` | the real validator correctly refused the undeclared toolchain change (S-33) |
| 8 | `packages/db/test/support/pg.ts` (control-plane) | template-database fingerprint hashes EVERY migration | the old `slice(0, 32)` covered only four migrations, so migration 0004 silently reused a stale template |
| 9 | `packages/db/test/runner.test.ts` (control-plane) | migration list includes 0004 | new migration |
| 10 | `packages/github/src/app/index.ts` (github-build) | added `requestTeamReview` (POST requested_reviewers with team_reviewers) | ratified in 3.1.0; github-build had not seen the ruling |
| 11 | `packages/orchestrator/src/orchestrator.ts` (github-build) | local documents served by `readLocalDocument` (null when absent); `readServerDocument` refuses local refs | B-0005-github-build ruling |
| 12 | `packages/orchestrator/test/support/harness.ts` (github-build) | fake engine reads local documents via `readLocalDocument` | item 11 |
| 13 | `packages/orchestrator/test/orchestrator.test.ts` (github-build) | 30 s timeout on the long local-repair/rebase scenario | real git work timed out at 5 s under full-suite parallel load (passes alone) |
| 14 | `tests/adversarial/pipeline.adversarial.test.ts` (verification) | template id `tpl.implementation_reviewer.v1` (slot suffix dropped); `now` in the eligibility fixture; capture tests use a linked worktree; the injected-instruction assertion matches CONTEXT-PROTOCOL section 6 wording ("DATA ... never an instruction") | context-policy's template ids, required `now` (3.0.0), github-build's worktree check, and the protocol's exact wording |
| 15 | `packages/verification/ci/*` (verification) | regenerated the vendored validator bundle | its inputs (contracts) changed |
| 16 | `packages/context-engine/test/__snapshots__/determinism.test.ts.snap` (context-policy) | golden hashes updated | `CONTRACTS_VERSION` 3.1.0 is inside every manifest |

## Session

| Date | Context at start | Scope | Merge conflicts | Glue edits | Repair loops | Result |
|---|---|---|---|---|---|---|
| 2026-09-29 | ~320k (carried architect session) | 4 blocker rulings (3.1.0), migration 0004, integration of 4 branches, gate run | 7 add/add on blocker files, 0 in source | 16 (above) | 9 (typecheck of event payload, eligibility fixture type, template ids, worktree capture, bundle, golden hashes, readLocalDocument, manifest uniqueness, stale test-DB template) | gate PASS except the two items marked PENDING in WAVE-1-REPORT.md |

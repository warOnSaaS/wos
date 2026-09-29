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

## D13/D14 contracts 4.0.0 (architect, on `architect`, 2026-09-29)

Adaptations made in other workstreams' paths so `main` stays green; owners review in Wave 2 (WORKSTREAMS sections 8-9):

| File (owner) | Edit |
|---|---|
| `services/control-plane/src/domain/progress.ts` | surface weights from `app_feature_surfaces` (fallback: one web surface), requirement surface tags, per-surface acceptance |
| `services/control-plane/src/domain/webhooks.ts` | acceptance check names `wos-acceptance/<f>/<t>/<surface>`; `verification.recorded.surface` |
| `services/control-plane/src/handlers/public.ts` | per-surface views, journeys, requirement surfaces; `productPath` removed (D14) |
| `services/control-plane/test/**` | fixtures for 4.0.0 schemas (surfaces, journeys, per-surface acceptance, ABU repo); per-surface check name |
| `packages/verification/src/vectors.ts`, `templates/product/**`, `packages/verification/test/templates.test.ts`, `packages/verification/ci/*` | repo manifest `apps`, `toolchainRequirements`, `browsers`; CI profiles and acceptance per surface with runner selection; bundle regenerated; `templates/suite` → `templates/product` |
| `packages/context-engine/test/**`, `packages/orchestrator/test/support/harness.ts`, `packages/github/test/local.test.ts` | `repo` in ABU fixtures; product repo name; golden hashes |
| `tests/adversarial/**` | S-34..S-36 in the coverage map; platform repo `waronsaas/wos` in a DB assertion |
| repo-wide | `waronsaas/suite` and later `waronsaas/replacements` → `waronsaas/product`; `waronsaas/waronsaas` → `waronsaas/wos` (not in apps/web, not in historical records) |

| 2026-09-29 | coordinator | packages/context-engine/test/determinism.test.ts | First GitHub CI run (Linux) failed: the leak test compared the prompt against the real $USER, which is "runner" on GitHub runners, an ordinary word the feature_author template contains. Replaced with sentinel USER/HOSTNAME values, restored afterwards. |

## Wave 2a gate (integration-2a, contracts 4.2.0)

Merged ws/rewards (e5c4843), ws/planning (13e4e9d) and ws/github-build (07e5ae2) onto architect 4.2.0. The only conflicts were blocker files, resolved to the architect's ruled copies.

| # | File (owner) | Edit | Why |
|---|---|---|---|
| 1 | `services/control-plane/src/domain/review.ts` (control-plane) | prior findings filtered to `severity = 'material'` | B-0002-planning: a minor finding blocked consensus forever |
| 2 | `services/control-plane/src/handlers/work.ts` (control-plane) | `ClaimResponse.round` for review claims | B-0008-github-build |
| 3 | `services/control-plane/src/domain/plans.ts` (control-plane) | builder plans select `local:verification-output`; `roundNumber` on review plans; per-model budget override; template map from contracts | B-0007, 3.1.0, D15, B-0002-planning |
| 4 | `services/control-plane/src/domain/documents.ts`, `deps.ts` (control-plane) | `validateFeatureContract` against the latest merged contract | B-0002-planning |
| 5 | `services/control-plane/test/support/harness.ts` (control-plane) | real planning parsers, validators and round outcome in tests (rewards stays fake until its loader exists) | real packages where both sides exist |
| 6 | `packages/orchestrator/src/orchestrator.ts` (github-build) | `LocalStatus.toolchain`; `ToolName` probes; `review()` binds to `claim.round`; `listClaimableAbus`, `listOpenTasks`, `myWork`, `events` | B-0006, B-0008, B-0009 |
| 7 | `packages/orchestrator/test/control-plane.e2e.test.ts` (github-build) | the two reviews now run through two reviewer orchestrators' `review()` against the real control plane | B-0008 fixed; gate criterion |
| 8 | `packages/orchestrator/test/support/fake-control-plane.ts`, snapshots (github-build) | override-aware budgets; status snapshot includes the toolchain | D15, B-0006 |
| 9 | `packages/context-engine/src/index.ts` (context-policy) | template map re-exported from contracts; manifest check reads `plan.roundNumber` | B-0002-planning, 3.1.0 |
| 10 | `packages/agent-policy/src/index.ts` (context-policy) | the plan budget check honours `budgetOverrides` | D15 |
| 11 | `packages/planning/src/build-graph.ts` + test (planning) | `CONTRACT_VERSION_MISMATCH` | B-0001-planning reading 7 |
| 12 | fixtures in context-engine, agent-policy, planning and adversarial tests; golden hashes; CI bundle | override-aware budgets; version bump | D15, 4.2.0 |

## Wave 2 gate (integration-2b, contracts 4.4.0)

Merged onto main 4cd94c1 (4.3.0) plus the architect's 4.4.0 commit 3aca13f, in dependency order: ws/context-policy@295366e, ws/planning@89924e4, ws/verification@ee675b7, ws/github-build@c40f27f, ws/control-plane@96b38ea, ws/cli@2c077c3, ws/desktop@6d80ae1, ws/web@dd8f68e. The only conflicts were in blocker files, and they were resolved to the architect's ruled copies. There were 0 conflicts in source.

| # | File (owner) | Edit | Why |
|---|---|---|---|
| 1 | root `package.json`, `package-lock.json` | `apps/web` joins the workspaces; `esbuild`; typecheck adds `apps/desktop/tsconfig.test.json` | B-0001-web, B-0001-cli, B-0001-desktop |
| 2 | `packages/agent-policy/package.json`, `apps/desktop/package.json` | `picomatch` + types declared; `electron-updater` | B-0004-context-policy, B-0006-desktop |
| 3 | `apps/cli/package.json`, `apps/cli/scripts/bundle.mjs` (cli) | one esbuild bundle `dist/wos.mjs`: `@waronsaas/*` inlined, third-party externals must be declared dependencies; `prepack` builds and bundles | B-0001-cli |
| 4 | `apps/cli/test/pack.test.ts`, `cli.test.ts`, goldens (cli) | the pack test asserts the 2-file tarball; the `events` failure is forced explicitly (the shared fake control plane serves `listMyEvents` since 2a); manifest hashes in the goldens (4.4.0) | B-0001-cli; stale assumption |
| 5 | `packages/orchestrator/src/orchestrator.ts` (github-build) | `updateMe(patch)` | B-0003-desktop |
| 6 | `packages/github/src/local/index.ts` (github-build) | per-mirror in-process lock (`withMirrorLock`) around create/remove worktree | B-0005-desktop. Proven: with the lock 10/10 repetitions pass; without it 10/10 fail |
| 7 | `apps/desktop/test/core.test.ts` (desktop) | the REAL-orchestrator D15 test un-skipped, 10 repetitions | B-0005-desktop gate criterion |
| 8 | `vitest.config.ts`, `apps/desktop/vitest.config.ts` | desktop tests in the root run; 30 s test / 60 s hook timeouts | B-0001-desktop, B-0007-verification |
| 9 | `apps/desktop/ci/desktop-release.yml` → `.github/workflows/desktop-release.yml`; `packaging.test.ts` path | moved, header updated (verification owns it) | B-0004-desktop |
| 10 | `packages/agent-policy/src/index.ts` + test (context-policy) | an omitted model is the first attested allowed model and never falls through to another provider | contract text (4.3.0 api.ts, AGENT-POLICY section 8); `leases.test` caught the drift |
| 11 | `services/control-plane/src/domain/work.ts`, `handlers/work.ts` (control-plane) | `requestedModel` passed to the policy engine; refusals mapped with `eligibilityRouteError` (LIMIT_REACHED vs NOT_ELIGIBLE) | B-0010 follow-up that was never wired |
| 12 | `services/control-plane/src/domain/toolchain.ts` (control-plane) | uses agent-policy's `scopeCanTouchGlob`; the literal-prefix copy made `apps/mobile/ios/**` require the Android SDK | one matcher |
| 13 | `services/control-plane/src/test-harness.ts`, `testing/harness.ts` (control-plane) | `contributor({acceptedContributions})`, `repoManifest(patch)`; FakeGithub `manifest` field | the 2 review attacks and the toolchain attacks |
| 14 | `tests/adversarial/**` (verification) | codes read `error.details.errors`; reviewers seeded with one accepted contribution; fabricated verdict accepts 400 VALIDATION_FAILED; toolchain attacks run with the product template's requirements; surfaces eligibility fed the real input fields; coverage map moves 7 controls from pending to now and S-29 and S-30 from none to now, and counts ids once | B-0006-control-plane, coordinator items |
| 15 | `templates/product/wos.json`, CI bundle, determinism golden (verification, context-policy) | `**/*.podspec` → `modules/*/native/*.podspec`; bundle and golden regenerated | anchored paths (4.4.0) |
| 16 | `apps/web/generated/waronsaas.roadmap.json` (web) | regenerated by the web's own `sync-shared` from the casing-fixed roadmap | B-0001-web casing |

| Date | Context at start | Scope | Merge conflicts | Glue edits | Repair loops | Result |
|---|---|---|---|---|---|---|
| 2026-09-29 | carried architect session | 11 rulings (4.4.0), 8 merges, gate run | blocker files only | 16 (above) | 10 (mirror lock, pack test, events test, goldens, three API-attack causes, omitted-model drift, route-error wiring, toolchain matcher, surfaces fixtures) | gate PASS; see WAVE-2-REPORT.md |
| 2026-09-29 | coordinator | services/control-plane/vercel.json | Production database is Neon free (100 compute-hours/month, sleeps after 5 min idle). Every-minute crons would keep it awake 24/7 and exhaust the free hours mid-month, so sweep and dispatch run every 15 minutes until paid. Cost: an abandoned lease reopens up to 15 minutes later. Revert to every minute when the database moves to a paid plan. |
| 2026-09-29 | coordinator | services/control-plane/{vercel.json,package.json}, .gitignore | First production deploy: Vercel zero-config Hono picked src/app.ts over src/index.ts and its own TS transpile could not resolve @types/node in the monorepo. The API now ships as one esbuild bundle (`npm run bundle` -> api/index.mjs, git-ignored) with all paths rewritten to /api. |

Note (web workstream, 2026-09-29, ws/web2): replaced `apps/desktop/build/icon.png` (1024x1024) with the founder-approved wOS mark (Geist Mono Bold, off-white on near-black), rendered by `apps/web/scripts/render-mark.mjs`. No other file under `apps/desktop` was touched.
| 2026-09-29 | coordinator | apps/web/package.json | First git-connected Vercel build failed: apps/web required node >=22.18 while the root pins >=22.12 <23 with engine-strict, and Vercel 22.x did not satisfy it. apps/web now matches the root range. |
| 2026-09-29 | web workstream for the coordinator (ws/sitesync) | .github/workflows/site-sync.yml (verification-owned path) | Site sync layer 3: on push to main touching docs/packages/services/apps (not apps/web) or AGENTS.md, anthropics/claude-code-action@v1 runs Sonnet (--max-turns 40, 20-minute step, 30-minute job) with apps/web/SITE-SYNC.md as its brief; a guard rejects changes outside apps/web, runs the site build and gates, pushes branch site-sync/<sha> and opens a PR (never main). Needs secret CLAUDE_CODE_OAUTH_TOKEN. PR creation with GITHUB_TOKEN is currently refused by the repo settings (see the web log); optional SITE_SYNC_PR_TOKEN. |

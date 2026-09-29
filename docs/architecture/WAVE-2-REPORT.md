# Wave 2 report: integration gate

Date 2026-09-29. Branch `integration-2b` from `main` 4cd94c1 (contracts 4.3.0) with the 4.4.0 rulings (3aca13f). The eight workstream branches are merged. Integrator: Lead Architect. Nothing has been pushed or merged into `main`.

## 1. Gate results

| Criterion | Result | Evidence |
|---|---|---|
| `npm run check` (typecheck incl. desktop test config, Biome, tests without a database) | **PASS** | 1099 passed, 249 skipped (database suites), 0 failed |
| `npm run db:test` | **PASS** | postgres:17-alpine and supabase/postgres 17.4.1.048 |
| Full suite on Postgres 17 (port 55443), three runs in a row | **PASS** | 1346 passed, 2 skipped, 0 failed, in each of 3 runs (73 files; 52 s, 50 s, 36 s). No flakes |
| Adversarial tests enabled or justified | **PASS** | `tests/adversarial` 161/161 with 0 skipped. The 20 API attacks run against `createTestHarness()` and all pass. The two remaining root skips are justified: the live Electron test needs the bundle, and it passed when run after `npm run bundle -w @waronsaas/desktop`. The real-OS-keychain round trip is opt-in (`WOS_TEST_KEYCHAIN=1`) because it writes to the login keychain |
| Concurrency fix (B-0005-desktop) | **PASS** | Two builds (Opus and Astra) in ONE real orchestrator, 10 repetitions: 10/10 pass. The negative control, with the lock removed, failed 10/10 |
| CLI tarball | **PASS** | `npm pack` produces 2 files (`dist/wos.mjs`, `package.json`). Installed into an empty directory, `wos --help` and `wos --version` (`0.0.0 (contracts 4.4.0)`) run |
| Desktop suite in the root test | **PASS** | 9 files in `apps/desktop/test` run in the root suite, including the real-control-plane flow on Postgres |
| `apps/web` from the root install | **PASS** | `npm run build -w @waronsaas/web`: casing OK (145 pages), numbers OK (803 figures). Its lockfile and `generated/` copy are kept (two-step adoption) |

The gate found 5 defects that no builder had reported:
- agent-policy let an omitted model fall through to another provider, contrary to the contract.
- The control plane never passed `requestedModel` to the policy engine.
- The control plane mapped every refusal to NOT_ELIGIBLE.
- The control plane had its own, wrong toolchain matcher, which made iOS ABUs require the Android SDK.
- The verification fixtures had drifted from the 4.2.0 eligibility inputs.

All five are fixed, and `docs/dogfood/integration.md` lists 16 glue edits.

## 2. Per-workstream dogfood (Wave 2b rows)

| Workstream | Files changed | Duration | Blockers | Merge conflicts | Repair loops | Integration failures |
|---|---|---|---|---|---|---|
| cli | 10 + 11 goldens | ~55 min | 1 | 0 | 7 | 0 |
| desktop | 45 | ~45 min | 6 | 0 | 9 | 2 |
| control-plane | ~30 | ~2 h | 1 | 0 | 8 | 0 (7 attacks were left for the gate) |
| context-policy | 9 + 5 | ~10 min (4.3.0 follow-up) | 1 | 0 | 1 | not run |
| planning | 6 | ~15 min | 0 | 0 | 1 | not run |
| verification | ~24 | ~45 min | 1 | 0 | 4 | 0 |
| github-build | 8 | ~25 min | 1 | 0 | 1 | 0 |
| web | ~40 | ~1 h 40 min | 1 | 0 | 6 | 0 |
| rewards (2a) | 13 | ~35 min | 1 | 0 | 3 | not run |

## 3. Blockers

Wave 2 raised 20 blockers and all 20 were accepted:
- 4.2.0: 8 blockers (rewards 2, planning 2, github-build 4).
- 4.3.0: 1 blocker (B-0010).
- 4.4.0: 11 blockers (desktop 6, cli 1, web 1, control-plane 1, context-policy 1, verification 1).

No blocker was rejected. Contracts went from 4.1.0 to 4.4.0, and every change was additive.

## 4. Lessons

1. **Two implementations of one rule drift.** This happened with the toolchain matcher and with the model choice. The fix is one exported function, and the other side calls it. The review checklist should ask "does this re-implement something in another package?"
2. **A contract field is not wired until a test crosses the seam.** B-0010 added `model`, but the control plane patched the model after eligibility instead of passing it in. Only the D15 lease test, which runs through both packages, caught it.
3. **Workstream tests that assume "the fake lacks X" break when X lands.** Force a failure explicitly; don't rely on a gap in the fake.
4. **Negative controls are cheap.** Removing the lock for one run turned "it passed" into "it is the fix".
5. **Whole-module scopes need the native toolchain,** and that is correct. Planning must scope JS-only ABUs below the native directories (AGENT-POLICY section 5, toolchain).

## 5. What Wave 3 needs from the founder, in order

1. **GitHub** (FOUNDER-CHECKLIST sections 1–3): the org, the repos `waronsaas/wos` and `waronsaas/product`, and the wOS GitHub App with its key and webhook secret. Rulesets and the D9 day-one test.
2. **Supabase** (section 4): the project in us-west-2. Migrations 0000–0005 are applied by hand through the runner (ship gate).
3. **Vercel** (sections 5 and 11): the `api` project for the control plane. Switch the web project to the root install; after that, delete `apps/web/package-lock.json` and `generated/`.
4. **Resend** (section 6): the sending domain for magic links.
5. **Decisions** in GAPS: G-02 (seed reviewers during bootstrap), G-51 (toolchain changes need a maintainer), G-57 (store accounts and app names), G-31 (token casing).
6. **Legal** before any outside contribution: G-03 (subscription terms) and G-29 (licence, DCO/CLA).
7. **Apple Developer ID, App Store Connect API key, Expo and Google Play** (sections 7 and 10): needed for the signed Desktop release and the mobile apps.
8. **npm** (section 8): the `@waronsaas` scope for publishing the CLI.

Open engineering items for Wave 3:
- Desktop auto-update. The dependency is in, but it needs a publish provider and a mac zip target in `electron-builder.yml`; then the release job uploads `latest-*.yml` (B-0006-desktop).
- Rewards on real facts.
- The spec's final integration test against real GitHub.

# Wave 1 report — integration gate

Date 2026-09-29. Branch `integration` (contracts 3.1.0, migrations 0000–0004). Integrator: Lead Architect. Nothing pushed; nothing merged into `main`.

## 1. Gate results (WORKSTREAMS.md section 2, Wave 1 row)

| Criterion | Result | Evidence |
|---|---|---|
| `npm run check` (typecheck, lint, tests without a database) | **PASS** | 568 passed, 235 skipped (database suites skip without a URL), 0 failed; three consecutive runs green |
| Full suite against Postgres 17 (Docker, port 55443) | **PASS** | 785 passed, 18 skipped, 0 failed (41 files) |
| `npm run db:test` (SQL assertions) | **PASS** | postgres:17-alpine and supabase/postgres 17.4.1.048 |
| Migrations via the runner in Docker | **PASS** | `wos-migrate --check` exit 1 with 5 pending → apply exit 0 → `--check` exit 0 "up to date"; 5 ledger rows; runner tests (lock serialisation, edited-file refusal) 25/25 |
| Control plane: email sign-in, GitHub link, claim → heartbeat → expire → release, against Postgres with a fake GitHub | **PASS** | `identity.test.ts` (single use, 15 min, 5 tries, poll-secret binding, no enumeration, rate limits, sessions, link/unlink/reservation), `leases.test.ts` (20 parallel claims → one lease, scope overlap, exclusive resources, heartbeat/expiry/reopen, release); control plane 157/157 now running on the REAL context-policy and verification logic |
| Scope validator vector suite | **PASS** | `packages/verification` 172/172 (one case per `ChangesetErrorCode`, toolchain cases) |
| `buildInvocation` snapshots, all ten roles | **PASS** | `packages/agent-policy/test/invocation.test.ts` 23/23 |
| Adversarial suite with previously pending tests enabled where code exists | **PASS (partial)** | 95 passed, 18 skipped. Enabled at this gate: the database suite (incl. the five former B-0003 known gaps) and the pipeline suite (context isolation, symlink capture, webhook signatures, eligibility). Still **PENDING**: the 18 API-level attacks, which need the `@waronsaas/control-plane/test-harness` adapter export (Wave 2, control-plane). Every one of those attacks also has an equivalent test inside `services/control-plane/test` that passes. |
| `wos-verify` runs in the platform repo | **PENDING** | no GitHub repository yet (FOUNDER-CHECKLIST sections 1–3) |

## 2. Blockers

| Workstream | Raised | Ruled accepted | Rejected |
|---|---|---|---|
| context-policy | 3 (B-0001..0003) | 3 | 0 |
| github-build | 5 (B-0001..0005) | 5 | 0 |
| verification | 6 (B-0001..0006) | 6 | 0 |
| control-plane | 5 (B-0001..0005) + 8 silent workarounds recorded as B-0001..0008-architect | 13 | 0 |
| **Total** | **27** | **27** | **0** |

Contracts went 1.0.0 → 2.0.0 → 3.0.0 → 3.1.0 during Wave 1. The integration gate itself found two more defects that no builder had reported: global uniqueness of context manifests (migration 0004) and a stale test-database template (a test-support bug that hid 0004).

## 3. Dogfood numbers (from each `docs/dogfood/<workstream>.md`)

| Workstream | Sessions | Context at start | Files changed | Time | Blockers | Merge conflicts | Repair loops | Verification failures before green |
|---|---|---|---|---|---|---|---|---|
| control-plane | 2 | ~95k, then ~40k | 44 (~10.4k lines), then 21 | ~1 h 50 min + ~20 min | 4 + 1 | 0, then 4 (blocker files) | 11 + 6 | 9 red test runs, then 17 failing tests after the rebase |
| context-policy | 2 | ~110k, then ~260k carried | 30, then 13 | ~45 + ~25 min | 2 + 1 | 0, then 2 (blocker files) | 4 + 2 | 0 after repairs |
| github-build | 2 | ~95k, then ~120k carried | 27, then 17 | ~30 + ~35 min | 4 + 1 | 0, then 4 (blocker files) | 8 + 3 | 6 first-run test failures (fixtures, no product defect) |
| verification | 2 | ~95k, then ~130k carried | 36 (15.7k generated), then ~20 | ~35 + ~30 min | 5 + 1 | 0, then 5 (blocker files) | 6 + 4 | 2 red runs |
| integration | 1 | ~320k carried | 16 glue edits | this gate | 0 (fixed in contracts) | 7 (all blocker files) | 9 | 8 failing tests after merge, 14 after switching to real logic, 0 at the end |

## 4. Lessons

1. **The contracts were the weak point, not the code.** 27 blockers in one wave, all accepted, three contract versions. Every blocker came from cross-reading two documents or a document against the frozen signatures; the builders' code was sound (github-build and verification report zero product defects in their first-run failures).
2. **The same gap reached several builders.** Hashing/signing rules hit github-build, verification and control-plane independently (three JCS copies existed before 2.0.0); the server-document route was requested twice (github-build B-0004, control-plane B-0003); local documents twice (github-build B-0005, context-policy's own addition). wOS lesson: a contract that two packages must reproduce byte for byte belongs in code with test vectors, never in prose.
3. **One builder worked around eight issues silently.** Control-plane chose defaults (lowest-rank app, product repo for all ABUs, any signed run, HMAC hashing...) instead of raising blockers. All eight were real contract gaps. The escalation rule needs teeth: WORKSTREAMS should require a blocker for any choice the contracts do not state, and the dogfood log should list "assumptions made".
4. **Fakes hide integration defects.** Replacing control-plane's fake eligibility/manifest/validator with the real packages turned 14 green tests red and exposed a real bug (global manifest uniqueness) plus two test-support bugs. Wave 2 builders should run against the real Wave 1 packages from day one.
5. **Blocker files collide on every rebase.** Each branch carried stale copies of blocker files the architect had ruled; every merge produced add/add conflicts (7 at this gate, 15 across rebases). Wave 2 rule: builders never edit a blocker file after raising it; decisions live only on `architect`.
6. **Parallel test load exposes timing.** A 5 s default timeout failed only under the full parallel suite. Long git-backed scenarios need explicit timeouts.
7. **Context carried across sessions is large** (up to ~260k tokens at rebase start). The rebase briefs (WORKSTREAMS section 7) kept rebases to 20–35 minutes each; a brief per workstream is worth writing at every gate.

## 5. What Wave 2 needs

- **Merge this gate**: coordinator merges `integration` into `main` after review; then every Wave 1 and Wave 2 branch starts from it.
- **control-plane**: export `@waronsaas/control-plane/test-harness` implementing `tests/adversarial/support/harness.ts` so the 18 API attacks run; review the 16 glue edits in `docs/dogfood/integration.md` (items 1–9 are in its paths); set `ContextPlan.roundNumber` on review plans (then context-policy drops the third argument).
- **github-build**: review glue items 10–13; implement `SignInPrompt` handling in real CLI/Desktop wiring with the cli and desktop workstreams.
- **verification**: review glue items 14–15; add the `wos-acceptance/<feature>/<target>` jobs and toolchain restore to `wos-verify.yml` if not complete; move remaining suites to `tests/**`.
- **context-policy**: review glue item 16; hand the planning-role templates to planning.
- **New Wave 2 workstreams** (planning, rewards, cli, desktop, web): brief them against contracts 3.1.0; start on the real Wave 1 packages, not fakes; planning replaces the parse/validate fakes still used in control-plane tests; rewards replaces `computeLedgerDrafts: () => []`.
- **Founder** (blocking Wave 3, not Wave 2): the GitHub org, App and repos (FOUNDER-CHECKLIST 1–3) so `wos-verify` can run; Supabase and Vercel projects; G-51 (maintainer approval for toolchain changes) and the other open decisions in GAPS.md.

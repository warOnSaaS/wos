# P1 report — shadow contribution receipts (first slice)

Branch `ws/p1-shadow`, contracts 5.20.0. What shipped, what is honest, what is unverified.

## What was built

**Contracts 5.20.0** (MINOR, additive; CHANGELOG entry in `docs/architecture/CHANGELOG-CONTRACTS.md`; version bump + the
regen procedure's artifacts — vendored copies, context-engine and CLI goldens — only manifest hashes and the version
changed, as the procedure requires):

- `packages/contracts/src/shadow.ts` — the public shadow-receipt read model and its rules:
  - S-1 public fields only (handle, never email/account id/device id/signature),
  - S-2 `shadowReceiptSha256` = canonicalSha256 of the zod-parsed receipt with the hash field removed (the C-4
    pattern) — anyone recomputes it from the served JSON,
  - S-3 the shadow budget states its basis (pinned standard 10 000 bp x 10 000 bp) instead of implying one,
  - S-4 sealed verdicts never appear (served as the anonymous actor; RLS hides them until a round is revealed).
- `shadowBudget(taskKind, sizePoints)`: the D49 budget model through the frozen protocol's own pure functions
  (`budgetModelMicro` with the pinned v2 policies, `basePriceAcuMicro` for the D63 published base price at the pinned
  `queueBonusBp` = 2000), labelled `"shadow — no value"`. Unknown task kind = no budget, never a made-up number.
- Public routes in `packages/contracts/src/api.ts`: `GET /v1/public/receipts` (cursor-paginated, newest first) and
  `GET /v1/public/receipts/:id` (NOT_FOUND).

**Control plane** (`services/control-plane`):

- `src/domain/shadow-receipts.ts` — the read model, built ONLY from production tables (0000–0016; never 0007/0010):
  attempts that submitted a changeset (ABU build/revision work) and document versions that reached review
  (roadmap/feature-contract author work), their agent runs (provider as declared, model requested/reported,
  reasoning, token usage and cost as reported, timing, manifest/transcript hashes), their review rounds with slots,
  models, verdicts and labels (`single_lab_review`, `bootstrap_self`, `candidate_trial:<candidate>` via `to_jsonb`
  for the 0013/0015 columns), the human seat gated on `to_regclass('wos.round_human_reviews')` (tolerates a database
  without 0013/0015, exactly like the D53/D69 handlers), the outcome (attempt/document state, merged, PR,
  `wos.contributions` state), and the shadow budget. Attempt runs are windowed to the attempt's own lifetime so one
  attempt's receipt never claims another's runs.
- Two handlers in `src/handlers/public.ts`, run as the anonymous actor.

**Website** (`apps/web`): `/receipts` (list, newest first) and `/receipts/[id]` (the work, agent runs, review rounds
with verdicts and labels, outcome, shadow budget, verify section with every hash) — monochrome, server components,
ISR 60 s, linked from the nav, footer, sitemap and llms.txt/llms-full.txt. Pure display model in
`apps/web/lib/receipts.mts` (the gauge.mts pattern: no React, no imports), fetched through `lib/data-source.ts`
with minimal runtime guards. Empty states are honest: "the receipts route is not live yet" (API 404, until the next
API deploy) is distinct from "no receipts yet" (200 with zero items).

**Tests** (all green):

- `packages/contracts/test/shadow.test.ts` — the budget numbers (2-point abu_build = 8 ACU, base 6,666,666 micro-ACU;
  roadmap_author 60 ACU; unknown kind = null), the label/basis, and the receipt hash (stable, changes with the data,
  independent of unknown keys).
- `services/control-plane/test/shadow-receipts.test.ts` — a real contribution end to end (build -> sealed round with
  no leaked verdicts -> revealed round -> merge): list and detail parse against the route schemas, counts, budget,
  recomputable hash, and **no private field leaked** (no email, device id, account id, lease id, signature in the
  served JSON). Plus a submitted-but-unreviewed attempt, a roadmap author's document receipt, newest-first ordering,
  and a clean 404.
- `services/control-plane/test/routes.contract.test.ts` — the new routes added to the one-scenario-per-route coverage.
- `tests/shadow-receipts-web.test.ts` — the page data model: labels, honest unknowns (NOT REPORTED / UNKNOWN),
  outcome wording, budget line, review labels, verify lines.

## Key decision: no migration 0017

The brief allowed migration 0017 "if a new table/view is needed". None is: every field of the receipt is read live
from tables the control plane already stores in production, and sealed reviews are already guarded by RLS
(`sealed_until_revealed`, 0001/0013). Reading live means: no migration coordination, nothing written, no protocol
table touched, and the receipts are visible the moment the API deploys. The tolerance patterns were kept anyway
(`to_regclass` gate for `wos.round_human_reviews`, `to_jsonb` reads of the 0013/0015 round columns), so this code
serves today's production database unchanged.

## Verification

- `npm run check` — green (typecheck, lint, 1,943 tests).
- Full suite against a migrated throwaway Postgres (`WOS_TEST_DATABASE_URL`/`WOS_VERIFY_DATABASE_URL`, all 17
  migrations applied per test file): 2,274 passed.
- `npm run build -w apps/web` — green, `check-casing: OK`, `check-numbers: OK`; `apps/web/generated/build-log.json`
  and `whitepaper-meta.json` reverted after the build regenerated them.
- `npm run bundle -w @waronsaas/control-plane` — bundles (3.0 MB, as before plus the new module).
- `node scripts/regen-contracts.mjs` run for the 5.20.0 bump; golden diffs reviewed: only manifest hashes and the
  contracts version changed.

## What is unverified

- Production: nothing is deployed from this branch (no push, no merge, per the brief). Until the API deploys from
  main, waronsaas.com/receipts honestly says the route is not live yet; it flips to live data within 60 s of the
  deploy. No production data exists to render yet either way (the first real agent runs have not happened).
- The shadow budget uses the pinned standard basis (10 000 bp x 10 000 bp) because production stores no per-task
  difficulty/importance (task budgets are protocol tables, devnet-only). The receipt states this openly (rule S-3);
  when protocol migrations apply and real task budgets exist, the basis can be read from them instead.
- Fix units (D61 `AbuSpec.fix`) get their model budget without the severity multiplier (the effective severity lives
  in the devnet-only triage tables); the receipt's task kind and size points are stated so the number is still
  checkable.

## Blockers

None.

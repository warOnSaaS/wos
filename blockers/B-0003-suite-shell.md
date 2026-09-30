```json
{
  "id": "B-0003-suite-shell",
  "status": "resolved",
  "raisedBy": "suite-shell",
  "raisedAt": "2026-09-30T17:07:45Z",
  "affectedContract": "templates/product root (package.json, package-lock.json, wos.json migrationsDir, .github/workflows/wos-verify.yml) and the architect's regeneration list for contract bumps",
  "reason": "suite-shell owns apps/api, apps/web, applications and modules/core* but not the product template's root, so the product repo cannot yet install, test or compose from its root. wos.json says migrationsDir db/migrations while WOS-APP-PROTOCOL puts migrations in applications/<id>/migrations. The vendored contracts copy goes stale on every contracts bump.",
  "evidence": "templates/product has no root package.json or lockfile; apps/api and apps/web each declare hono, postgres, zod and resolve them from the wos monorepo's node_modules today. The compose file had to live at templates/product/apps/api/docker-compose.yml. templates/product/wos.json migrationsDir = db/migrations; Core's migrations are applications/core/migrations/0001_core.sql. tests/suite-shell.test.ts fails (vendor --check) after any change under packages/contracts/src until `node templates/product/modules/core-contracts/vendor.mjs` runs.",
  "requestedCapability": "(1) A template root package.json with workspaces [apps/api, apps/web, apps/mobile] and scripts typecheck/lint/test that run each app's, plus its lockfile, owned by whoever owns the template root. (2) wos.json: migrationsDir for per-app migrations (applications/*/migrations) or a list. (3) Regenerate modules/core-contracts/src/vendor with every contracts bump, next to wos-ci-lib.mjs. (4) An SMTP transport for local sign-in needs a dependency (nodemailer) or an agreed minimal client; today only the log transport is built.",
  "affectedWorkstreams": [
    "architect",
    "verification"
  ],
  "suggestedResolution": "Architect adds the root files at seed time (FOUNDER-CHECKLIST 13.4), moves docker-compose.yml to the root if preferred (it only needs build contexts ./apps/api and ./apps/web), and adds the vendor regeneration to the contracts-bump checklist.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "5.6.0",
    "note": "Accepted (WORKSTREAMS 14). (1) The template root: package.json with workspaces apps/* and modules/*, scripts typecheck/lint/test/build, package-lock.json, and docker-compose.yml (with docker-compose.proof.yml, proof/ and .env.example) moved to the root with build contexts ./apps/api and ./apps/web. (2) RepoManifest.appMigrationsDir = applications/*/migrations with migrationsDir null; writing an app's migrations needs db:migrations:<id> exclusive (planning since 5.6.0; the changeset validator on ws/blockers). (3) Vendor regeneration is in the contracts bump procedure (WORKSTREAMS 5). (4) nodemailer 10.0.13 (pinned) in apps/api: SMTP when WOS_SMTP_URL and WOS_SMTP_FROM are set, the log otherwise; tested with a fake transport and nodemailer's stream transport.",
    "decidedAt": "2026-09-30T17:29:27Z"
  }
}
```

`raisedBy` read `architect` until contracts 5.6.0 added `suite-shell` to `Workstream` (B-0001-suite-shell item 2); corrected on ws/blockers.

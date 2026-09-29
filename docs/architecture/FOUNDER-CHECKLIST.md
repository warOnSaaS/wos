# Founder checklist — things only the founder can create or decide

Contracts 1.0.0, 2026-09-29. Do these roughly in order; each step says which workstream is blocked without it. Setting names are as GitHub, Supabase, Vercel and Resend label them; where a label could not be checked from here it says CONFIRM IN UI.

Secrets never go in the repo. Every secret below goes into the place named (Vercel env var or a GitHub Actions environment secret).

## 0. Decisions to make first (from GAPS.md)

| Id | Decision | Recommendation | Blocks |
|---|---|---|---|
| G-05 / G-06 | Product repo name and stack | one repo `waronsaas/suite` (rename freely); TypeScript, Node 22, Postgres, Next.js | Wave 3 |
| G-29 | Licences and contributor sign-off | platform Apache-2.0 or MIT; suite AGPL-3.0 or Apache-2.0; DCO sign-off | first outside contribution |
| G-03 | Legal read of Anthropic and OpenAI consumer terms | get it before public launch | launch |
| G-02 | Bootstrap thresholds; recruit 4–6 seed reviewers (2+ with Codex/ChatGPT, 2+ with Claude) | yes | real independence in the V1 test |
| G-04 | Who merges | App auto-merges implementation PRs; maintainer approval for roadmap/contract PRs during bootstrap | first merge |
| G-01 | Public wording for model claims | "max reasoning, attested" | site and PR copy |
| G-12 | Reward amounts (`reward-schedule.v1.json`) | activate as proposed or edit | rewards in V1 test |
| G-18 | Desktop platforms in V1 | macOS + Linux; Windows later | Desktop release, download page |
| G-27 | What non-contributors get | follow targets + weekly progress email | web sign-in scope |
| G-31 | "WOS tokens" vs "wOS tokens" | founder's call | copy |
| G-22 | Hosted / self-hostable criteria | as in GAPS.md | status badges |
| G-23, G-28, G-42 | Trademark review, deletion policy, ToS and privacy policy | legal review | launch |

## 1. GitHub organisation and repositories (blocks Wave 1 GitHub work)

1. Finish renaming the organisation login to `waronsaas` (D4). All contracts use `waronsaas`.
2. Create `waronsaas/waronsaas` (public) if it does not exist and push `main` (the platform monorepo).
3. Create `waronsaas/suite` (public, default branch `main`, add a README so `main` exists). Rename if you chose another name in G-05 — then tell the architect; `PRODUCT_REPO` changes in one place.
4. Org settings → Member privileges: base permission **Read**. Contributors are never collaborators (D9).

## 2. The wOS GitHub App (blocks github-build and control-plane)

Org settings → Developer settings → GitHub Apps → New GitHub App.

| Setting | Value |
|---|---|
| Name | `wOS` (if taken: `wOS by warOnSaaS`) |
| Homepage URL | `https://waronsaas.com` |
| Callback URL | `https://api.waronsaas.com/v1/github/oauth/callback` (web linking flow, D8) |
| Expire user authorization tokens | on |
| Request user authorization (OAuth) during installation | off |
| Enable Device Flow | **on** (Desktop and CLI link GitHub with it) |
| Setup URL | empty |
| Webhook | active |
| Webhook URL | `https://api.waronsaas.com/v1/github/webhook` |
| Webhook secret | generate 32+ random bytes; keep for `GITHUB_WEBHOOK_SECRET` |
| SSL verification | on |
| Where can this app be installed | Only on this account |

Repository permissions (everything not listed: **No access**):

| Permission | Access | Why |
|---|---|---|
| Contents | Read and write | Git Data API commits on candidate and official branches, merges |
| Pull requests | Read and write | open, label, comment, close non-App PRs |
| Checks | Read and write | read CI check suites; publish the qualification check run |
| Commit statuses | Read and write | set `wos/qualified` and `wos/consensus` |
| Issues | Read and write | proposals and blockers (D4) |
| Actions | Read-only | read workflow runs and logs for provenance |
| Merge queues | Read and write | enqueue qualified PRs (CONFIRM IN UI: label may read "Merge queues") |
| Metadata | Read-only | mandatory |
| **Workflows** | **No access — deliberately** | the App can never commit a workflow change, even by a bug (SECURITY.md) |
| Administration | No access | branch protection is set by you, not the App |

Organisation permissions: **Members: Read-only** (to check the maintainers team). Account permissions: none (email comes from our own sign-in, D8).

Subscribe to events: Check run, Check suite, Issue comment, Issues, Merge group, Pull request, Pull request review, Push, Status, Workflow run. (Installation events are always delivered.)

After creating:
- Generate a private key (`.pem`) → `GITHUB_APP_PRIVATE_KEY`.
- Note App ID → `GITHUB_APP_ID`, Client ID → `GITHUB_APP_CLIENT_ID`, generate a client secret → `GITHUB_APP_CLIENT_SECRET`, and the app slug → `GITHUB_APP_SLUG`.
- Install it on `waronsaas/waronsaas` and `waronsaas/suite` only. Note each installation id (URL of the installation page) → `GITHUB_APP_INSTALLATION_ID`.

## 3. Repository settings, rulesets and the D9 day-one test (blocks the first official PR)

For `waronsaas/suite` (and the same for `waronsaas/waronsaas` once wOS dogfoods itself):

1. Settings → General → Pull Requests: enable **merge queue** support; allow squash merge only; enable auto-merge; automatically delete head branches.
2. Settings → General: **Restrict pull request creation to collaborators** (GitHub, 2026-02-13). If the same control exists for issues, enable it too (CONFIRM IN UI).
3. Settings → Actions → General: allow GitHub-owned and verified actions only; **Workflow permissions: Read repository contents**; do not allow Actions to create or approve PRs. Add **no** Actions secrets or variables to `waronsaas/suite`.
4. **Day-one test (GAPS G-09):** with the App installation token, create a test branch and open a PR. If GitHub refuses because the App is not a collaborator, add the App as a collaborator with Write if GitHub allows it for Apps, otherwise leave the restriction off and rely on the fallback (the webhook auto-closes non-App PRs, and the required `wos/qualified` status makes them unmergeable). Record the result in `docs/architecture/GAPS.md` G-09.
5. Rulesets → New branch ruleset `main`:
   - Target: default branch. Enforcement: Active. Bypass list: **empty** (not even admins).
   - Restrict deletions; block force pushes; require linear history.
   - Require a pull request before merging (0 approvals for implementation PRs; see 6 for documents).
   - Require status checks: `wos/qualified` with source **the wOS App**, and `wos-verify` with source **GitHub Actions**. Require branches up to date.
   - Require merge queue (build concurrency 5, merge method squash, minimum group size 1).
6. CODEOWNERS (in `waronsaas/suite`, maintainer-owned): `/roadmaps/ @waronsaas/maintainers`, `/catalog/ @waronsaas/maintainers`, `/features/*/CONTRACT.yaml @waronsaas/maintainers`, `/wos.json @waronsaas/maintainers`, `/.github/ @waronsaas/maintainers`; in the `main` ruleset enable "Require review from Code Owners" (this is the bootstrap maintainer approval for document PRs, G-04).
7. Rulesets → New branch ruleset `wos-refs`: target `wos/**`; restrict creations, updates and deletions; bypass list: **the wOS App** only.
8. Create team `waronsaas/maintainers` with yourself.

## 4. Supabase (blocks control-plane integration tests against a real database)

1. New project `waronsaas` in the organisation of your choice. Region **AWS us-west-2 (Oregon)** (D5). Postgres 17. Plan: Pro (for daily backups and point-in-time recovery; enable PITR once there is real data).
2. Project settings → Data API: **remove every schema from "Exposed schemas" or disable the Data API**. wOS uses only schema `wos`, which must never be exposed through PostgREST.
3. Apply migrations with the ship gate (never by hand, D7): `DATABASE_MIGRATION_URL=<direct or session connection string as postgres> npm run db:migrate` (the runner is built in Wave 1; until then do not create tables manually).
4. After `0001_init.sql` is applied, set the app role's password (SQL editor, as `postgres`):
   `alter role wos_app with login password '<generate 32+ random chars>';`
5. Connection strings (Project → Connect):
   - `DATABASE_URL` = **Transaction pooler** (port 6543), user `wos_app.<project-ref>`, password from step 4, `sslmode=require`.
   - `DATABASE_MIGRATION_URL` = **Session pooler** or direct, user `postgres`. Only the ship gate uses it.
6. Seed yourself as maintainer after your first sign-in (SQL editor):
   `insert into wos.account_roles (account_id, role) select account_id, 'maintainer' from wos.account_emails where email_normalized = 'anthonydventurini@gmail.com';`

## 5. Vercel (team `battle-juice`, D5)

Project `waronsaas-api` (new): Git repository `waronsaas/waronsaas`, Root Directory `services/control-plane`, framework preset Other (Hono), Node.js 22.x, Function region **`pdx1` (Portland, Oregon)** to sit beside Supabase us-west-2 (D5, D7), domain `api.waronsaas.com`. Cron jobs (in the project's `vercel.json`, written by the control-plane workstream): `/v1/cron/sweep` and `/v1/cron/dispatch` every minute.

Environment variables for `waronsaas-api` (Production; Preview gets its own database or none):

| Name | Value | Secret |
|---|---|---|
| `DATABASE_URL` | transaction pooler URL as `wos_app` | yes |
| `GITHUB_APP_ID` | App ID | no |
| `GITHUB_APP_SLUG` | app slug | no |
| `GITHUB_APP_CLIENT_ID` | client id | no |
| `GITHUB_APP_CLIENT_SECRET` | client secret | yes |
| `GITHUB_APP_PRIVATE_KEY` | full PEM, newlines preserved | yes |
| `GITHUB_APP_INSTALLATION_ID` | installation id on the product repo | no |
| `GITHUB_WEBHOOK_SECRET` | webhook secret | yes |
| `PRODUCT_REPO` | `waronsaas/suite` | no |
| `RESEND_API_KEY` | from Resend | yes |
| `EMAIL_FROM` | `warOnSaaS <signin@notify.waronsaas.com>` | no |
| `SESSION_TOKEN_PEPPER` | 32 random bytes, hex (HMAC key for hashing session and sign-in tokens) | yes |
| `IP_HASH_SECRET` | 32 random bytes, hex (daily-salted IP hashing for rate limits) | yes |
| `CRON_SECRET` | 32 random bytes, hex (Vercel sends it to cron routes) | yes |
| `WOS_ENV` | `production` | no |
| `WEB_ORIGIN` | `https://waronsaas.com` (CORS and cookie checks) | no |

Project `waronsaas-web` (exists): add `WOS_API_URL=https://api.waronsaas.com` when the web workstream switches to the API (Wave 2). Keep its function region `pdx1`.

`DATABASE_MIGRATION_URL` is **not** a Vercel variable: it lives only in the platform repo's GitHub Actions environment `production` (required reviewer: you), used by the ship gate job.

Remember D7: Vercel CLI deploys are blocked unless the HEAD commit author is `adventurini <anthonydventurini@gmail.com>`.

## 6. Email sending for magic links (D8; blocks sign-in)

1. Create a Resend account (recommended: boring, has a Vercel integration; Postmark is the alternative). Add domain **`notify.waronsaas.com`** in region us-east-1 or whatever Resend offers — CONFIRM IN UI.
2. Add exactly the records Resend shows, in Vercel DNS for `waronsaas.com`. They will look like:
   - `TXT resend._domainkey.notify` — DKIM public key (value from Resend)
   - `MX send.notify` → `feedback-smtp.<region>.amazonses.com`, priority 10
   - `TXT send.notify` → `v=spf1 include:amazonses.com ~all`
   - `TXT _dmarc.notify` → `v=DMARC1; p=none; rua=mailto:dmarc@waronsaas.com` (tighten to `p=quarantine` after two clean weeks)
3. **Do not touch** the apex `MX` and `TXT` (SPF) records: they belong to ImprovMX forwarding (D5).
4. Create an API key with sending access to that domain only → `RESEND_API_KEY`.
5. Test: a sign-in email to a Gmail address shows "PASS" for SPF, DKIM and DMARC in "Show original".

## 7. Apple and desktop signing (blocks the Desktop release, not development)

1. Apple Developer Program as an **Organisation** (needs a D-U-N-S number; allow a week or more).
2. Create a **Developer ID Application** certificate; export as `.p12` with a password.
3. App Store Connect → Users and Access → Integrations → **App Store Connect API** key with Developer access; download the `.p8` once.
4. In `waronsaas/waronsaas` create GitHub Actions environment `release` (required reviewer: you) with secrets: `CSC_LINK` (base64 of the .p12), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (contents of the .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. Notarisation runs only in Actions (D7).
5. Windows (only if G-18 says so): an Azure Trusted Signing account or an OV code-signing certificate.

## 8. npm (blocks publishing `@waronsaas/cli`)

1. Create the npm organisation `waronsaas`.
2. On the package `@waronsaas/cli` (after first publish) configure **Trusted Publishing** for GitHub Actions from `waronsaas/waronsaas`, workflow `release.yml`, environment `release`. No long-lived npm token.

## 9. Before public launch

- ToS and privacy policy pages (G-42), licence files (G-29), trademark review (G-23), subscription-terms review (G-03).
- Recruit and onboard the seed reviewers (G-02).
- Run the V1 integration test from the spec end to end with real accounts, then turn bootstrap off only when the exit rule is met.

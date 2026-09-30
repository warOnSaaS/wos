# AGENTS.md — handoff for any coding agent (Codex, Claude Code, others)

Read this first. It is the single place that says what exists, what is running, and how to continue. It is written so the founder can hand the project to Codex (or any agent) if Claude usage runs out. Keep it current: update the "State" section whenever a wave, gate or deployment changes.

## What this is

warOnSaaS builds open-source replacements for rented business software (the "Sniper List": Salesforce, HubSpot, Slack, Zoom, Shopify, QuickBooks, Jira, Zendesk, DocuSign, NetSuite; TGT-00 is warOnSaaS itself). **wOS** is the system that coordinates it: contributors run AI agents on their own Claude/ChatGPT subscriptions, wOS leases small build units, gives each agent an exact context, has two other contributors review the work (Astra on Codex, Fable on Claude), and only then lets the wOS GitHub App open a PR. The end-user product is ONE wOS app (desktop, mobile, web) with modular apps (wOS CRM, Chat, …) — see Amendment 01.

## Read in this order

1. `docs/V1-SPEC.md` — the founder's original brief (verbatim).
2. `docs/DECISIONS.md` — founder decisions D1… that override the spec.
3. `docs/AMENDMENT-01-ONE-PRODUCT.md` — one product, entitlements, WOS-APP protocol (being incorporated; see State).
4. `docs/architecture/ARCHITECTURE.md`, then the protocol docs next to it (DOMAIN-MODEL, BUILD-, CONTEXT-, REVIEW-, ROADMAP-, REWARD-PROTOCOL, FEATURE-CONTRACT, AGENT-POLICY, SECURITY).
5. `docs/architecture/WORKSTREAMS.md` — who owns which paths, blockers, contract versioning, wave briefs.
6. `docs/architecture/GAPS.md` and `FOUNDER-CHECKLIST.md` — open decisions and things only the founder can do.
7. `docs/architecture/WAVE-1-REPORT.md`, `WAVE-2-REPORT.md`, `docs/dogfood/*.md` — what happened and lessons.

## Hard rules (the founder's, non-negotiable)

- **No fake data.** Never invent progress, contributors, numbers or dates. 0% shows as 0%.
- **Casing:** always `warOnSaaS` and `wOS` in any human-facing text. Lowercase only in identifiers (domain, npm scope, repo names).
- **Brand:** monochrome military-ops look, never marketing. The logo is `wOS` in Geist Mono Bold, off-white on #0b0b0b. Body text JetBrains Mono.
- **Contracts are frozen:** `packages/contracts/**`, `packages/db/migrations/**`, `docs/architecture/**`, root configs and the lockfile are changed only by the architect role, versioned, with a CHANGELOG entry. Everyone else raises a blocker (`blockers/B-nnnn-<workstream>.md`, format in WORKSTREAMS §4) instead of working around a contract.
- **One worktree per workstream** (`~/waronsaas-<name>`, branch `ws/<name>`). Never commit to another workstream's branch.
- **Commit author must be** `adventurini <anthonydventurini@gmail.com>` (Vercel blocks other authors). Use `git -c user.name=adventurini -c user.email=anthonydventurini@gmail.com commit …`.
- **Node 22** (`nvm use 22`). pnpm is broken on this machine; use npm workspaces.
- **Never run real model calls in tests** — they spend the founder's subscriptions. Tests use fake `claude`/`codex` binaries.
- **Nothing migrates production by hand silently.** Use the runner; list first with `--check`.
- **Keep the website current** for everything shipped (see "Website").

## Commands

```
nvm use 22
npm ci --ignore-scripts
npm run check                      # typecheck + lint + tests (no DB)
npm run db:test                    # migrations + DB assertions in Docker
# full suite against a throwaway Postgres:
docker run -d --rm --name wos-pg -e POSTGRES_PASSWORD=test -p 55443:5432 postgres:17-alpine
WOS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55443/postgres \
WOS_VERIFY_DATABASE_URL=postgres://postgres:test@127.0.0.1:55443/postgres npx vitest run
docker rm -f wos-pg
```

Migrations to production (Neon), owner connection from `~/.waronsaas/neon.env` (`DATABASE_URL_UNPOOLED`):
```
npm run build -w @waronsaas/db
DATABASE_MIGRATION_URL=<unpooled owner url> node packages/db/dist/cli.js --check --dir packages/db/migrations
DATABASE_MIGRATION_URL=<unpooled owner url> node packages/db/dist/cli.js --dir packages/db/migrations
```

## Infrastructure

| Thing | Where |
|---|---|
| Code | github.com/warOnSaaS/wos (this repo, public) and github.com/warOnSaaS/product (the suite, App-only PRs) |
| GitHub App | "warOnSaaS wOS", slug `waronsaas-wos`, App ID 5125461, installation 166277827 on wos + product only. No workflows permission by design. |
| Repo rule | `pull_request_creation_policy = collaborators_only` on both repos (verified: the App can still open PRs) |
| Website | waronsaas.com — Vercel project `waronsaas-web` (team battle-juice), root `apps/web`, deploys from `main` |
| API | api.waronsaas.com — Vercel project `waronsaas-api`, root `services/control-plane`, pdx1, ships as one esbuild bundle (`npm run bundle -w @waronsaas/control-plane`), deploys from `main` |
| Database | Neon (Vercel Marketplace, free plan, us-west-2). App connects as `wos_app` (no RLS bypass, owns nothing). Crons every 15 min to stay in free compute hours — set back to every minute when on a paid plan. |
| Email | Resend, sending domain notify.waronsaas.com (from signin@notify.waronsaas.com). Apex MX is ImprovMX forwarding to the founder — never touch it. |
| DNS | Vercel DNS for waronsaas.com |
| Secrets | Only on the founder's Mac in `~/.waronsaas/` (0600): `github-app.json`, `neon.env`, `database.json`, `resend.json`, `api-secrets.json`; and in Vercel env vars. Never commit them, never print them. |

## State (update this section)

As of 2026-09-30:
- **Wave 0–2 done** and on `main`: contracts 5.0.0 (Amendment 01 incorporated: one wOS product, WOS-APP protocol, entitlements, Build app D16, Desktop on macOS/Windows/Linux D17), migrations 0000–0006 (all applied to production), control plane, orchestrator (shared by CLI and Desktop), context engine + agent policy, planning validators, rewards ledger rules, verification + adversarial suite, CLI (`wos`), Desktop (Electron). GitHub CI green. Production API and database live; real sign-in email verified.
- **Website auto-update ("site sync") is on main:** the site reads the live API (60 s refresh), /log is generated from git history and wave reports at build, and `.github/workflows/site-sync.yml` runs Claude Code (Sonnet, capped) after merges to propose copy updates on a `site-sync/<sha>` branch. Needs the repo secret `CLAUDE_CODE_OAUTH_TOKEN` (founder: `claude setup-token`). It cannot open the PR itself yet: repo setting "Allow GitHub Actions to create and approve pull requests" is off; until decided it leaves a compare link in the job summary.
- **Next:** Wave 3a per WORKSTREAMS §12 (one-product shell: registry, entitlements, CRM appearing/disappearing in Desktop/Web/Mobile, Build app, Windows) → first real agent runs (one Opus build, one Astra review on a throwaway task) → Wave 3b (real Salesforce CRM roadmap v1, uses Fable, needs independent reviewers).
- **Protocol design in review on `ws/protocol`:** Proof of Contribution (Amendment 02, D18–D58) designed in `docs/protocol/` with DRAFT contracts (`@waronsaas/contracts/protocol`), draft migration 0007 (v7: **D51 engine-first** — SQL keeps only hard invariants, procedure lives in `protocol/rules.ts`; mapping in `docs/protocol/GUARANTEES.md`) and a reproducible simulation. **D49: execution rewards are budget-based.** Astra reviews 01–06 are in `docs/protocol/reviews/` (bundle 04 WAS reviewed — review 04; an earlier note here said otherwise); their status with tests: `docs/protocol/REVIEW-PACKET.md` §3c (03), §3f (04, 05); what changed since: §3g. **D53 Fable unavailable** (Opus authors, Astra + a human review, `single_lab_review`), **D54** provisional receipts finalize optimistically, **D55 V1-active vs dormant modules** (PROTOCOL §13), **D56 build next**. Founder decisions in ADR-001 §6: all accepted as recommended (D57); D58 cross-lab conflict resolvers. Astra review 06 (7 findings, all at the engine/rules/SQL seams) is fixed with regression tests, a challenge/finality race and an engine-vs-database lifecycle trace (`packages/db/test/lifecycle-trace.mjs`, run by `db:test`); status in REVIEW-PACKET §3i, the V1 active path in §0. Next: Astra review 07 from `tools/make-review-bundle.sh 07`. Not wired into reward accounting; devnet only. **D50: wOS is hosted-first**; integrations are Amendment 03, after this rework.
- **Open founder decisions:** see GAPS.md (bootstrap reviewers, merge authority, reward amounts, wording, "wOS tokens"), licences (Apache-2.0 for wos; AGPL or Apache for product), legal read of subscription terms, Apple Developer + Windows signing + npm scope + Expo/Google Play accounts.

## How the work is run (the coordinator loop)

One coordinator (the agent reading this) does not write feature code itself. It:
1. keeps the architect role for contracts/docs changes;
2. gives each workstream a brief pointing at its WORKSTREAMS section, in its own worktree;
3. collects blockers, has the architect rule on them as a versioned contract change, tells affected workstreams;
4. runs the integration gate (merge `ws/*` in dependency order onto an `integration-*` branch, `npm run check`, `db:test`, full DB suite 3× with zero failures), then fast-forwards `main` and pushes;
5. records lessons in `docs/dogfood/` and the WAVE reports, and updates this file.

With Codex: run each workstream as its own Codex session in its own worktree, pasting the WORKSTREAMS brief; Astra (`gpt-6-astra`) for architect/review-heavy work, Sol (`gpt-6-sol`) for straightforward builders. Never use `ultra` effort (it delegates outside the agent's context).

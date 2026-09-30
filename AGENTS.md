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
| Secrets | Only on the founder's Mac in `~/.waronsaas/` (0600): `github-app.json`, `neon.env`, `database.json`, `resend.json`, `api-secrets.json`, `env-token-keys/` (Ed25519 environment-token keys wos-env-2026 and -next, set as WOS_ENV_TOKEN_KEY and WOS_ENV_TOKEN_KEY_NEXT on waronsaas-api, 2026-09-30); and in Vercel env vars. Never commit them, never print them. |

## State (update this section)

As of 2026-09-30:
- **Wave 0–2 done** and on `main`: contracts 5.5.0 (5.1.0 and 5.3.0: the assessment module; 5.2.0: Wave 3a; 5.4.0: D59; 5.5.0: frozen protocol v1) (Amendment 01 incorporated: one wOS product, WOS-APP protocol, entitlements, Build app D16, Desktop on macOS/Windows/Linux D17), migrations 0000–0006 (all applied to production), control plane, orchestrator (shared by CLI and Desktop), context engine + agent policy, planning validators, rewards ledger rules, verification + adversarial suite, CLI (`wos`), Desktop (Electron). GitHub CI green. Production API and database live; real sign-in email verified.
- **Website auto-update ("site sync") is on main:** the site reads the live API (60 s refresh), /log is generated from git history and wave reports at build, and `.github/workflows/site-sync.yml` runs Claude Code (Sonnet, capped) after merges to propose copy updates on a `site-sync/<sha>` branch. Needs the repo secret `CLAUDE_CODE_OAUTH_TOKEN` (founder: `claude setup-token`). It cannot open the PR itself yet: repo setting "Allow GitHub Actions to create and approve pull requests" is off; until decided it leaves a compare link in the job summary.
- **White paper v0.2 is a living document:** source `docs/whitepaper/WHITEPAPER.md` (v0.1 kept verbatim beside it), rendered at waronsaas.com/whitepaper and /whitepaper.md; the site-sync agent checks it after merges and proposes edits with a changelog entry and version bump (`docs/whitepaper/README.md`).
- **White paper assessments (branch `ws/assessments`, 2026-09-30):** paper v0.7 asks agents for a `wos-assessment/v1` score block (contracts 5.1.0, `packages/contracts/src/assessment.ts`) and to read the recorded trend only after scoring. Only the founder's reference runs are recorded: `node tools/assessments/run-reference.ts --cli claude|codex` (spends his subscription; never run by coding agents; since v0.9 also run by CI, see the self-assessment entry) writes `docs/assessments/*.json` + `.md`; the site renders /assessments (SVG charts, number-gated) and /whitepaper/assessments.md from them. No reader submissions, no routes, no migration. No run recorded yet.
- **White paper version history (branch `ws/wp-history`, 2026-09-30):** paper v0.8. waronsaas.com/whitepaper/changes (and /whitepaper/changes.md for agents, without scores) lists every version newest first with its changelog entry verbatim, the GitHub compare diff, companion files changed, a PART I CHANGED flag (from the section headings of the diff, or MATERIALITY.md / tools/materiality/model.ts changed) and the reference runs per version; /whitepaper/v/<version> shows each version in full (v0.1 is the verbatim .txt). Generated by `apps/web/scripts/gen-whitepaper-history.mjs` into committed files `apps/web/generated/whitepaper-history.json` + `whitepaper-history/`, because Vercel clones at depth 10 (unshallow fails there): full-history builds regenerate, shallow builds verify and fail if stale. `apps/web/scripts/check-whitepaper-version.mjs` fails the build if the paper changes without a version bump and changelog entry. Rule: never edit the paper without both (README, SITE-SYNC.md, site-sync.yml).
- **Wave 3a contracts ready (contracts 5.2.0, 2026-09-30):** `computeApplicationProgress` (application progress, structurally independent of target progress for V1 proof step 9), Build's manifest `apps/desktop/src/apps/build/wos-app.json`, and a freeze-check of `AppRoutes`. The freeze-check added the environment-token wire format (C-8), `ModuleBundle`, `getAppRelease`, `getApplicationProgress`, the wos-screen.v1 data envelopes and `TargetSummary.apps`. WORKSTREAMS 12.4 lists the exact exports each Wave 3a workstream uses.
- **White paper self-assessment (branch `ws/self-assess`, 2026-09-30; founder directive "The white paper should always ship with a self-assessment, as well as rooms for improvement, gaps, etc."):** paper v0.9, contracts 5.3.0. The score block is now `wos-assessment/v2` (v1 records stay valid): bounded `gaps` (id slug, title, section or thesis, Part I/II, severity; at most 10) and `improvements` (change, gap id, scores it raises; at most 10). **CI now runs the reference assessment on the founder's token** (previously "never run by agents"): `.github/workflows/self-assessment.yml` runs after a push to main that changes `WHITEPAPER.md` (or by hand), waits until waronsaas.com/whitepaper.md serves the repo's version (`tools/assessments/wait-for-version.ts`), runs `run-reference.ts --cli claude --commit` (safe mode, default model opus, live-prompt check), and pushes only `docs/assessments/*` plus the derived `apps/web/generated/assessments.json` and `gap-register.json` to main as adventurini. It needs the repo secret `CLAUDE_CODE_OAUTH_TOKEN` (not set yet; the job fails clearly without it). Codex/Astra runs stay manual (ChatGPT login is not automatable). Coding agents still never run it. The version gate now fails a new paper version while an older one has no recorded run (v0.1–v0.8 grandfathered by a frozen list), so **v0.10 cannot ship until v0.9 has a run**; it warns when a new version leaves the previous run's high-severity gaps unmentioned. /whitepaper (after the handoff prompt), /assessments and each version on /whitepaper/changes show the self-assessment as monochrome score rings (server-rendered SVG), or SELF-ASSESSMENT PENDING with empty dashed rings; scores stay out of /whitepaper/read, /whitepaper.md, changes.md and the companions (check-numbers enforces it). Gap register at /assessments/gaps (+ .md), exact-id matching only; changelog convention "Gaps addressed: `id`" / "Gap declined: `id`: reason". No run recorded yet: v0.9 is pending until the founder sets the secret and dispatches the workflow (or runs it locally).
- **Protocol v1 (Proof of Contribution) FROZEN for devnet/shadow (D62), integrated from `ws/protocol`:** Proof of Contribution (Amendment 02, D18–D58, D62) designed in `docs/protocol/` with contracts `@waronsaas/contracts/protocol` (contracts 5.5.0, frozen protocol v1) and migration 0007 (v8: **D51 engine-first** — SQL keeps only hard invariants, procedure lives in `protocol/rules.ts`; mapping in `docs/protocol/GUARANTEES.md`) and a reproducible simulation. **D49: execution rewards are budget-based.** Astra reviews 01–08 are in `docs/protocol/reviews/` (bundle 04 WAS reviewed — review 04; an earlier note here said otherwise); their status with tests: `docs/protocol/REVIEW-PACKET.md` §3c (03), §3f (04, 05); what changed since: §3g. **D53 Fable unavailable** (Opus authors, Astra + a human review, `single_lab_review`), **D54** provisional receipts finalize optimistically, **D55 V1-active vs dormant modules** (PROTOCOL §13), **D56 build next**. Founder decisions in ADR-001 §6: all accepted as recommended (D57); D58 cross-lab conflict resolvers. Astra review 06 is fixed (REVIEW-PACKET §3i). Astra review 07: APPROVE WITH CHANGES for devnet implementation; R07-1 to R07-7 fixed with regressions, exact two-session races in both orderings and the accounting-projection trace (`packages/db/test/accounting-trace.mjs`, run by `db:test`); status in §3j, the V1 active path in §0. Astra review 08: FREEZE AFTER THE LISTED CHANGES; R08-1 and R08-2 fixed (§3k). **Protocol v1 is FROZEN for devnet/shadow implementation (D62)**; later changes are versioned additions with their own review. Migration 0007 is never applied to production by this. Not wired into reward accounting; devnet only. **D50: wOS is hosted-first**; integrations are Amendment 03, after this rework.
- **Migration 0007 (protocol) is NOT applied to production** — devnet/shadow only; applying it is a separate, explicit step after the P0 wiring and the ship gate.
- **Next:** protocol build waves (WORKSTREAMS-PROTOCOL: V1-active modules only) → D61 bugs and maintenance (versioned addition, Astra review 09) → Wave 3a per WORKSTREAMS §12 (one-product shell: registry, entitlements, CRM appearing/disappearing in Desktop/Web/Mobile, Build app, Windows) → first real agent runs (one Opus build, one Astra review on a throwaway task) → Wave 3b (real Salesforce CRM roadmap v1).
- **Product direction (2026-09-30):** hosted-first; self-hosting staged (exit rights now, Docker Compose eval after V1, first-class only when an enterprise pays). Connections/integrations will be Amendment 03, Cloud-first, after the budget-model rework of the protocol.
- **Open founder decisions:** see GAPS.md (bootstrap reviewers, merge authority, reward amounts, wording, "wOS tokens"), licences (Apache-2.0 for wos; AGPL or Apache for product), legal read of subscription terms, Apple Developer + Windows signing + npm scope + Expo/Google Play accounts.

## How the work is run (the coordinator loop)

One coordinator (the agent reading this) does not write feature code itself. It:
1. keeps the architect role for contracts/docs changes;
2. gives each workstream a brief pointing at its WORKSTREAMS section, in its own worktree;
3. collects blockers, has the architect rule on them as a versioned contract change, tells affected workstreams;
4. runs the integration gate (merge `ws/*` in dependency order onto an `integration-*` branch, `npm run check`, `db:test`, full DB suite 3× with zero failures), then fast-forwards `main` and pushes;
5. records lessons in `docs/dogfood/` and the WAVE reports, and updates this file.

With Codex: run each workstream as its own Codex session in its own worktree, pasting the WORKSTREAMS brief; Astra (`gpt-6-astra`) for architect/review-heavy work, Sol (`gpt-6-sol`) for straightforward builders. Never use `ultra` effort (it delegates outside the agent's context).

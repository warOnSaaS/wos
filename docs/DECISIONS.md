# Founder decisions after the V1 spec

These override `docs/V1-SPEC.md` where they differ. Date: 2026-09-29.

## D1. Models run on contributors' own subscription CLIs. wOS holds no model API keys.
- Fable and Opus run through the contributor's installed `claude` CLI (Claude Code), signed in with their Claude subscription. Model ids: Fable `claude-fable-5-1`, Opus `claude-opus-5-5`.
- Astra is ChatGPT's model, run through the contributor's installed `codex` CLI (OpenAI Codex CLI), signed in with ChatGPT. Model id on the founder's machine: `gpt-6-astra` (in `~/.codex/config.toml`, where `model_reasoning_effort` is the reasoning setting).
- wOS launches these CLIs as local processes. It never reads, stores or proxies the contributor's model credentials.
- Consequence: the server cannot prove which model ran. Agent Policy must treat model identity as an attestation, and cross-review (D2) is what keeps it honest.

## D2. Reviews run on a DIFFERENT contributor's machine.
- A builder never reviews their own work. Astra review and Fable review are each a leased review task, assigned by the control plane to eligible contributors other than the author (and ideally two different reviewers).
- Deterministic verification (typecheck, lint, tests, scope/diff check) is re-run in GitHub Actions on the PR. A contributor's local "tests passed" is never trusted alone.
- Bootstrap problem: at launch the founder is contributor zero and there is nobody else to review. The architect must specify a bootstrap mode (who may review when the pool is too small, how that is labelled publicly, and when it switches off).

## D3. Tokens and points are one unit.
- WOS tokens are in-app credits, earned per individual for accepted work. The running total is the person's score; the leaderboard ranks it.
- One append-only ledger, one unit. Balances are derived, never stored-and-mutated.
- Not cryptocurrency, not transferable, no cash value. Required public wording wherever tokens appear: "WOS tokens are in-app credits with no cash value."
- The ledger must support debits (spending may be added later) without a schema change.

## D4. GitHub
- Org: currently `deployreadystudio` (display name already "warOnSaaS"); the founder is renaming the login to `waronsaas`. Use `waronsaas` in all contracts and URLs.
- Main repo: `waronsaas/waronsaas`, PUBLIC. All warOnSaaS repos are public (open source). The three old Deploy Ready repos in the org are private and out of scope.
- Decide explicitly whether architecture blockers / `wos resolve` / roadmap proposals use GitHub Issues, PRs, or both.

## D5. Hosting and data
- Vercel team `battle-juice` (Pro). Domain `waronsaas.com` is on Vercel DNS (the founder's registrar is Namecheap; nameservers now point to Vercel).
- Mail for the domain is forwarded by ImprovMX (MX + SPF records in Vercel DNS) — do not touch those records. App-sent mail (notifications, sign-in links) should use a sending service on a subdomain such as `notify.waronsaas.com`.
- Postgres on Supabase, created in AWS us-west-2 (Oregon). Vercel functions pinned to `pdx1` (same region). Not created yet — the founder creates it when the architect says what is needed.
- Secrets live in Vercel env vars (GitHub App private key, webhook secret, DB URL, OAuth secret). The desktop app and CLI hold only the contributor's own short-lived wOS session (OS keychain via Electron safeStorage / keytar-equivalent for the CLI).

## D6. Public website already in progress
- A separate agent is building `apps/web` now (static Next.js, honest 0% everywhere, data in `apps/web/data/targets.ts`, deployed as Vercel project `waronsaas-web`). The architect must NOT edit `apps/web`; it adopts it into the monorepo and specifies how it will switch from the static data file to the control-plane API.
- The founder asked that download instructions be written as if the Desktop build exists: releases at `https://github.com/waronsaas/waronsaas/releases/latest`, CLI package `@waronsaas/cli`, binary `wos`.

## D7. Lessons carried over from the founder's previous product (Deploy Ready)
- Put the app and database in the same region first; cross-region cost ~95% of latency there.
- Row-level security from day one if multi-tenant data exists; the app connects as a non-bypassing role.
- A migration runner with a ledger, applied by a ship gate — nothing migrates production by hand silently.
- A ship script that refuses a dirty tree, an unpushed commit, or red CI before deploying.
- Vercel CLI deploys are BLOCKED if the HEAD commit author is not a project member; commits must be authored `adventurini <anthonydventurini@gmail.com>`.
- Tests must not pin absolute dates that pass "now"; build fixture times relative to the clock.
- Static assets served immutable must have hashed filenames.
- Electron signing/notarization must run in CI (GitHub Actions); `notarytool` uploads from the founder's Mac crashed repeatedly.

## D8. Sign-in is by email magic link for everyone; GitHub only to contribute
- Founder's words: "we should add a magic link. If you want to contribute only you need a github account."
- An account is created by a verified email address. GitHub is a linked identity added later, and it is required before any lease, review, proposal or resolution is issued (anything that produces a commit, PR or review).
- Rewards and the leaderboard belong to the account, not the GitHub login. Provenance still records the GitHub identity that authored each commit.
- App-sent mail uses a sending subdomain (e.g. `notify.waronsaas.com`); the apex MX stays with ImprovMX.

## D9. Gated PRs: only the wOS GitHub App opens PRs, and only after qualification
- Founder's words: "Not everyone can just open a PR. It has to be done by an agent with specific criteria. That is a very important architecture choice."
- No human opens a PR on waronsaas repos. Use GitHub's "restrict pull request creation to collaborators only" setting for public repos (GitHub changelog 2026-02-13); contributors are not collaborators. Restrict issue creation to collaborators too if proposals and blockers go through wOS. UNVERIFIED: whether a GitHub App installation token counts as a collaborator for that restriction; test on day one, with an auto-close webhook as the fallback.
- Contributors never push. Their machine produces a signed submission (changes against the lease's immutable base commit, plus the context manifest hash and verification output) and uploads it to the control plane. After qualification the App creates branch `wos/<unit-id>`, applies it, pushes and opens the PR. The PR author is the App; the contributor is credited with a `Co-authored-by` trailer carrying their linked GitHub identity, and by the provenance record.
- Qualification is machine-checked, recorded and listed in the PR body: valid unexpired lease held by that account; linked GitHub; base commit matches; diff hash matches what was reviewed; only allowed paths touched (CI workflows, lockfiles unless allowed, symlinks and generated files rejected); context manifest matches the one issued; model and effort attested per Agent Policy; Astra and Fable reviews both pass, done by other contributors, bound to the same diff hash; CI re-verification passes.
- Branch rulesets: nobody pushes to main; required checks include `wos/qualified` (settable only by the App) and CI verification. Who merges stays a founder decision.
- The same gate applies to canonical Roadmap and Feature Contract PRs: only the App adds commits to them.

## D10. Features are shared across applications: one global Feature Catalog
- Founder's words: "I am hoping there is a cross reference for other roadmap PRs that go into feature PRs. Because a lot of apps have the same features?"
- A Feature Contract is canonical and app-independent (Contacts, Threaded messaging, Video meeting, Invoices, E-signature envelope, Ticket queue, Roles & permissions, Audit log). One contract, one build graph, built once.
- Each Application Roadmap maps its capabilities to catalog feature ids (existing, or proposes a new one). Many-to-many.
- Per-app requirements: each app has a profile of the requirement ids it needs. A feature counts as SPECIFIED/BUILT for app A only when every requirement A references is specified/built.
- Dedup is part of consensus ("this duplicates catalog feature F" is a material finding); a merge/alias procedure handles duplicates found later.
- Changing a shared contract lists the impacted apps and puts their requirements in review contexts.
- Rewards: a unit is paid once, not once per app; per-app completion pools still fire when that app's referenced requirements reach 100%.
- Recommended by the founder for the architect to weigh: roadmap versioning after merge, and consensus one capability at a time.

## D11. A merged roadmap materialises tracked features with their own progress
- Founder's words: "the roadmap PR, once pulled, should assign and track features by %."
- When a roadmap version merges, every referenced catalog feature gets a tracked record for that app (with the app's requirement ids per D10), each feature opens or links its Feature Contract workflow, and every feature shows its own progress, rolling up to capability and app.
- Progress is computed by pure deterministic functions in the shared contracts, with tests; weighting is fixed per roadmap version and published; every number is traceable to the records behind it and recomputed on merge webhooks.

## D12. Feature weights are reasoned by the agents, not a formula
- Founder's words: "This has to be reasoned by the agents during the roadmap process. Make sure it's explicit in the roadmap context." (Supersedes the weighting question in D11.)
- Every roadmap (and capability slice) assigns each capability a weight toward the app and each feature a weight toward its capability, with a written rationale (relative size, user importance, complexity, share of the product's value). Required fields, sum constraints, rationale text.
- The Roadmap Agent is explicitly instructed to reason about and justify weights; both reviewers explicitly treat mis-weighting as a material finding. Consensus includes the weights.
- Weights freeze with the merged roadmap version; changing them needs a new roadmap version through the same consensus loop. Published so every percentage is traceable to weights and records.
- The architect decides how a feature's progress splits across requirements and build units.

## Naming rule (founder, 2026-09-29)
- The name is always `warOnSaaS`; the system short name is `wOS`. Lowercase `waronsaas` only where a technical identifier requires it (domain, npm scope, GitHub org and repo, package names).
- warOnSaaS is its own first target: TGT-00 warOnSaaS (wOS), ahead of the ten. Its V1 roadmap lives at `docs/roadmap/waronsaas.roadmap.json`.

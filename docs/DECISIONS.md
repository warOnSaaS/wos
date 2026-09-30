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

## D3. Tokens and points are one unit. (SUPERSEDED by D18, 2026-09-29: WOS is a Solana token; the one-record and derived-balance principles survive)
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

## D13. Parity means features AND experience, on every surface the rented product ships
- Founder's words: "We need to add a rule to the roadmap. It's not just feature mirroring. It's also experience. iPhone app — which will need a new repo, added to our own roadmap and parity with their apps, plus browser parity as well."
- Surfaces are first-class: each inventory lists the product's client surfaces (web app and supported browsers, iPhone/iPad, Android, desktop, extensions, add-ins) with cited public evidence. A shipped surface is in scope unless excluded with a reason.
- Experience, not only capability: roadmaps and Feature Contracts describe the key user journeys per surface, and acceptance tests journeys. Parity is functional and experiential, explicitly NOT copying the vendor's trade dress, logos or visual design (our look is the warOnSaaS monochrome system).
- Requirements are tagged per surface; a feature is SPECIFIED/BUILT for an app only when every requirement on every in-scope surface its profile references is. Surface weights are reasoned per D12. The web drilldown shows progress per surface.
- Browser parity: web acceptance runs across the vendor-supported browsers (at minimum Chromium, WebKit/Safari, Firefox and a mobile Safari viewport). Acceptance checks are per surface.
- Feature Contracts spanning surfaces specify the shared API; each ABU stays in one repo; cross-repo ABU dependencies use global ABU keys.
- wOS must be able to build it: multi-repo products, per-repo toolchain eligibility, macOS CI for native checks, per-surface acceptance checks, suite-app signing in CI only (D7), all added to TGT-00's roadmap.

### D13 corrections and delegated choices (founder, same day)
- Mobile apps are React Native with Expo and EAS, TypeScript like the rest of the suite (this supersedes native Swift and a separate iOS repo).
- DECIDED (delegated to the architect): the mobile apps live INSIDE the product repo, one app per replacement product (`products/<target>/mobile`) sharing `modules/**` with web. No separate mobile repo.
- DECIDED: Android is in scope and built alongside iPhone from the same code, with separate per-surface acceptance for iOS and Android.
- DECIDED: JS/TS-only mobile ABUs build and test on any OS; only ABUs touching native code or config (ios/, android/, config plugins, native modules) need a macOS + Xcode or Android SDK attestation, expressed as path-based toolchain requirements in wos.json.
- DECIDED: native journeys (push, background audio/video, CallKit, share sheets, offline) are specified per surface and the Feature Contract names the native modules they need.
- DECIDED: no wOS phone app for contributors in V1 (contributors use Desktop or the CLI); recorded as a post-V1 idea.
- DECIDED: browser support is current Chrome and Edge, Safari on macOS and iOS, and Firefox, in phone-sized and desktop viewports.
- DECIDED by the founder: the product repository is `waronsaas/product` (an earlier same-day choice, `waronsaas/replacements`, was overridden).

## D14. One suite, and the platform repo is `waronsaas/wos`
- The platform repository is renamed `waronsaas/wos` (was `waronsaas/waronsaas`); releases at `https://github.com/waronsaas/wos/releases/latest`. This supersedes the repo name in D4 and D6.
- Founder: "Isn't it just one web and one phone app?" The product is ONE web app and ONE mobile app: a single modular suite (think Odoo or Zoho One) with one account, one navigation and one data model, and feature modules a workspace turns on or off.
- Targets (Salesforce, Slack...) stay the Sniper List and become parity PROFILES: the definition of what the suite must do to fully replace each product. They are not separate codebases or store listings. Per-target "replacement complete" is still computed from that target's profile.
- `waronsaas/product` mirrors wos: `apps/web`, `apps/mobile` (React Native + Expo), `modules/<featureKey>/**`, plus `catalog/`, `roadmaps/<target>/`, `features/<key>/`. No `products/<target>/**`.
- The app shell (workspace modules, navigation, accounts, tenancy) is itself catalog features every target references. Self-hosting deploys the one suite with the modules you enable. Marketing pages per target stay on the site.

## D15. Contributors with both subscriptions are two agents
- Founder's words: "I have a ChatGPT subscription, so I am 2 agents."
- The Builder may run on Opus (claude CLI) or Astra (codex CLI, `gpt-6-astra`), the contributor's choice per lease, at the policy's builder reasoning minimum. Same for `roadmap_author` and `feature_author`.
- Reviews are unchanged: every round needs one Astra and one Fable review by contributors other than the author (D2).
- A contributor may hold one build lease per provider at a time, so one person with both subscriptions can run an Opus builder and an Astra builder in parallel on different ABUs.
- Provenance records which provider and model built each unit; the site can show it.
- Addition (founder): GPT-6-Sol (`gpt-6-sol`, "Previous generation workhorse model") is also permitted for builders only, never for reviews or rulings. The builder model list is policy data; provenance records the model so throughput and quality can be compared per model.

## Amendment 01. wOS is one product with modular applications (founder, 2026-09-29)
- Verbatim in `docs/AMENDMENT-01-ONE-PRODUCT.md`. It supersedes any architecture that treats CRM, Chat, Meet and the rest as separate end-user applications. Users install ONE wOS Desktop and ONE wOS Mobile and may use ONE wOS Web; an organization enables applications, and the same set appears on every surface. The architect's decisions applying it are in `docs/architecture/ARCHITECTURE.md` section 14 and `docs/architecture/WOS-APP-PROTOCOL.md` (contracts 5.0.0, migration 0006).

## D16. One wOS Desktop; contributing is the opt-in application "Build"
- Founder: ONE wOS Desktop app. Contributing becomes an opt-in wOS application called **Build**, off by default and enabled like CRM. Build covers everything the current `apps/desktop` does: Sniper List browse, BUILD, reviews, agents, git and worktrees.
- Business users never get agent or git tooling unless their organization, or they themselves, enable Build. The privileged main-process capabilities Build needs are gated behind that entitlement and are still bounded by the existing S-controls.
- The CLI `wos` stays the contributor CLI: it is Build's CLI surface.
- The public Sniper List site stays separate from authenticated wOS Web (the amendment's boundary rule).

## D17. Desktop V1 platforms are macOS, Windows and Linux
- Founder: wOS Desktop V1 ships on macOS, Windows and Linux. This supersedes the G-18 recommendation of "macOS + Linux; Windows later".
- Windows code signing uses Azure Trusted Signing or an OV certificate (FOUNDER-CHECKLIST section 12).
- Windows paths and worktrees need test coverage.

## Amendment 02. Proof of Contribution (founder, 2026-09-29)
- Verbatim in `docs/AMENDMENT-02-PROOF-OF-CONTRIBUTION.md` (Part A binding). The founder's further decisions in the same design pass, relayed by the coordinator, are D18–D38 below. The architect's design applying them is in `docs/protocol/` (DRAFT, pending the Astra review; ADR-001 argues every deviation). Nothing here is implemented in services yet.

## D18. WOS is a real Solana token (supersedes D3)
- A5: WOS is a Solana token; V1 runs on devnet (no monetary value, and the UI says so); it may become tradeable. wOS never sells WOS, runs no presale/ICO, provides no liquidity and never promotes a price; the company is funded by wOS Cloud. Mainnet is a deliberate milestone behind MAINNET-READINESS with one legal checkpoint (A8).
- **D3 is superseded**: "WOS tokens are in-app credits with no cash value", "not cryptocurrency, not transferable" no longer hold. D3's one-append-only-record and derived-balances principles survive. Every statement that must change is listed in `docs/protocol/SUPERSESSION.md` §3.

## D19. Proof of Contribution; execution rewarded by normalised usage (A1, A2)
- Language: contribution, receipt, allocation. Builders, agent reviewers, resolvers (and auditors) are weighted by provider usage normalised to ACU through a versioned ModelRateOracle, only when merged/accepted, clipped at the authorised cap; repairs count inside the cap; failed work earns nothing.

## D20. Planning and ideas by outcome (A3)
- Authoring compute counts only if in the merged version, plus pool shares; proposals, bugs and security are rewarded by outcome (acceptance, finder's share, severity).

## D21. Human review required in V1 (A4)
- Deterministic verification + Astra PASS + Fable PASS + 1 authorized non-author human, under a versioned ReviewPolicy; human review is a contribution; disagreements become eval data. Amended by D23 for low-risk classes.

## D22. Founder allocation, treasury, regulation (A6–A8)
- Founder = contributor zero under the same rules + a capped Genesis credit from recorded evidence; no premine; treasury only as a rules-bound protocol pool; one legal checkpoint before a value-bearing mainnet.

## D23. Merge authority is separate from reward qualification
- In bootstrap mode the founder may approve and merge anything, including their own work (AdminAction `bootstrap_merge`, public label). The founder may be the human reviewer of others' work (qualifies normally). The founder's own work so merged gets a PROVISIONAL receipt: public, devnet test allocations only, not Genesis-qualifying, until an independent reviewer ratifies it (original timestamp kept; rejections stay provisional, never deleted). Sunset = the existing one-way bootstrap exit. While the founder is alone: devnet test mode. A batch human-review queue in the Desktop Build app; low-risk classes (docs, tests, copy) may require 0 humans when Astra and Fable both pass. Supersedes REVIEW-PROTOCOL §9's self-review exception for qualification.

## D24. All agent compute runs on contributors' own subscriptions (reaffirms D1)
- Builds, Astra and Fable reviews, audits and planning run on contributors' subscriptions; wOS pays for no model usage and holds no model API keys. Reviewers are assigned at random by the control plane; audit re-reviews are leased tasks for a random third contributor (rate in ReviewPolicy); a material disagreement revokes the original reviewer's receipts (append-only) and raises an AbuseSignal; audits are rewarded. The site-sync GitHub Action (founder's own subscription) is a convenience outside the protocol.

## D25. Review duty at claim time
- To claim, a contributor's client runs randomly assigned audit tasks on their own subscription (automatic, no manual effort). Re-scoped by D27 (payout audits) and D28 (duty serves dispute gates, sampled audits and provisional ratification only).

## D26. Canaries
- Decoy review tasks with known defects, generated without a model. Re-aimed by D27 at payouts; code-defect canaries are not used in V1 (ADR-001 §3.6).

## D27. Payout audits, not code review; run logs; payout canaries
- Duty/audit reviews judge the plausibility of payouts (usage vs diff/contract/complexity, repairs, context, model choice, attribution, peer outliers); arithmetic is the engine's. Builders and agent reviewers submit scrubbed structured run logs. Upheld inflation findings clip or revoke receipts (append-only) and pay the auditor a bonus; quorums need outside-feature auditors. Payout canaries are model-free perturbations of real lines.

## D28. Optimistic verification with a challenge window (default payout path)
- Allocations are published with explanations to every participant; 48 h challenge window; silence accepts; undisputed allocations finalize automatically; disputed ones go to an audit gate while the rest finalize on time. Epoch-wide standing; bounty for upheld disputes; anti-griefing stake from the disputer's pending allocation; rate limits; sampled audits (~5%) and canaries continue regardless; admin escalation for deadlocks.

## D29. Full transparency against skims
- Every participant sees every allocation; deterministic anomaly metrics rank the challenge list; the dispute bounty is computed on the total excess of the accused across the epoch; pattern disputes; sampled audits and baseline flags always run. The opt-in leaderboard stays opt-in.

## D30. Dispute one specific allocation
- Stable ids and permalinks, `wos dispute <id>`, a dispute form with reasons, evidence, proposed amount, stake and bounty previews; DISPUTED shown publicly; right of reply (24 h); outcomes published with immutable history; duplicate disputes merge into one gate (first disputer has bounty priority).

## D31. Dispute any set of allocations
- One dispute may select several allocations across contributors and features; per-allocation evidence and outcomes; stake scaled by count with a cap; bounty on total upheld excess; rate limits on items per dispute.

## D32. A dispute focuses the audit
- The dispute builds the auditors' context around the disputed allocations (concern, evidence, run-log turns, diff, baselines, the reply) and instructs them to answer the concern first; disputer text is untrusted and delimited; stakes stay low enough not to intimidate.

## D33. Every economic number is policy data, forward-only
- Versioned policy records activated by AdminAction (later governance), effective from the next epoch, announced before it, previewable by re-running the engine on recent epochs; emergency changes only for safety and only on unpublished allocations. V1 values are provisional.

## D34. Governance by locked tokens and contribution
- Dual weight: WOS locked ≥ 12 months (snapshot before voting, per-wallet cap) and accepted contribution over the trailing 6 months (decaying). Proposals are policy PRs with previews and Astra + Fable exploit reviews, ≥ 1-epoch timelock, per-change limits, an auto-expiring emergency pause. V1 runs governance off chain with devnet locks; the founder sets policy until an activation threshold.

## D35. Off-ramp
- The off-chain receipt/allocation ledger is canonical; WOS is a settlement adapter (`solana_wos`, `in_app_credits`, `paused_accrual`, successor). Security, chain, legal or program failure → emergency pause (accrual continues, auto-expiring, ratified by governance); switching or migrating needs governance + timelock; a falling price is not a trigger; migrations use a public snapshot and a deterministic mapping; governance falls back to contribution-only weight; honest disclosure; an off-ramp drill in the devnet E2E and the mainnet gate.

## D36. Tiered supermajorities
- Routine 60%, structural 66–75% (architect recommends 70%), governance 75%, emergency ratification simple majority — required in BOTH weights, each with a minimum turnout; thresholds are policy data changeable only at the governance tier.

## D37. Denominators are distributed, never maximum supply
- Token side: ≥ 12-month-locked WOS in contributor wallets; unemitted supply, the protocol pool, multisig and wOS-controlled holdings never vote or count. Contribution side: contribution weight of contributors active in the trailing 6 months. Snapshot moment defined in GOVERNANCE.md.

## D38. Organizations as beneficiaries
- Contributor (the accountable person) vs Beneficiary (the person or an Organization). Sponsorship links approved by an org admin, with a split (default 100% org), recorded on every receipt as of qualification; forward-only. Org-mates are related accounts for every independence rule (DB-enforced). Governance weight accrues to the beneficiary with a 10% per-organization cap. Org wallets (multisig recommended).

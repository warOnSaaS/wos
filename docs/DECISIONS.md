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

## D59. Every target roadmap plans getting customers OFF the target (seamless importers)
- Founder (2026-09-30): parity is not enough if a customer cannot leave. Every target roadmap must include getting its customers OFF that target.
- **Migration section.** Every target roadmap has a `migration` section (`Roadmap.migration`, contracts 5.4.0) covering the target's data classes:
  - records;
  - custom objects and fields;
  - files and attachments;
  - history and activity;
  - users and permissions mapping, where exposed.

  Each class is imported by a named connector feature, or listed as "not extractable" with a public source. Partial classes do both. A roadmap without the section fails validation (`MIGRATION_MISSING`), and so does a class left unaccounted for. TGT-00 warOnSaaS is exempt: it has no customers to move off.
- **Importer guarantees.** Every importer supports:
  - a dry run;
  - idempotent re-runs;
  - delta sync during cutover wherever the target exposes an incremental API;
  - a verification report with per-object counts and checksums, in which nothing is silently dropped.
- **Built once.** `import-engine` is a shared catalog feature: mapping, dry run, verification report, idempotency and delta sync. It is built once and stewarded by TGT-00 warOnSaaS as shared infrastructure. Per-target connectors are small catalog features that depend on it. The first proof is importing Salesforce contacts and accounts in the first CRM catalog build.
- **Credentials.** An importer signs in to the CUSTOMER's own account with the customer's OAuth tokens, held encrypted and scoped per organization, never with wOS's own credentials. The detailed design belongs to Amendment 03 (connections) and is not decided here.
- **Input facts.** They come from `docs/scans/<target>.md`, section "Getting data out", on main since the `ws/scans` merge.
- Protocol text: ROADMAP-PROTOCOL.md "Migration: getting customers off the target (D59)".

## D60. Architecture changes: affected work is held and reprioritised, everything else keeps building
- Founder (2026-09-30): the product must stay flexible. When an architecture change happens, the affected work is held and reprioritised, and everything else keeps building.
- **Architecture records.** A cross-cutting change (shared core, auth, data layer, API conventions, UI shell) is an architecture record, `architecture/ADR-nnn.yaml` in the product repo (`ArchitectureRecord`, contracts 5.5.0).
  - It declares the elements it introduces, changes or retires as stable keys (`arch:auth-session`, `arch:data-layer`, ...), and the paths each element governs.
  - Its migration plan is its own build graph (`architecture/ADR-nnn/BUILD-GRAPH.yaml`, ABUs `adr-nnn#NN`).
  - It goes through the same Astra/Fable round loop as a contract, with at most 4 rounds, and needs a maintainer's explicit sign-off before merge.
  - Elements are defined ONLY by architecture records. ADR-000 records the core as it exists when the product repo is seeded; contracts rely on elements and never define them.
- **Dependencies are declared.**
  - ABUs declare the elements they rely on as `arch:` resources: `shared` = relies on it, `exclusive` = changes it. Only a record's migration ABUs may claim exclusive.
  - Feature contracts list the elements they rely on (`FeatureContract.architecture`).
  - Writing under an element's paths without declaring it, and an unknown element, are validation errors.
- **Impact is computed, not judged.** When a record opens, and again when it merges, `computeArchitectureImpact` lists what relies on the changed elements: contracts, unstarted ABUs (held), in-progress ABUs and their live attempts (finishing), their queued tasks, merged ABUs (the migration must cover them) and the dependents blocked behind held ABUs. It is published on the PR and as `architecture.impact_computed`.
- **HELD.**
  - Holds start when the record merges. The impact published at open is advisory, so an unmerged proposal cannot freeze work.
  - An unstarted affected ABU is held (`ArchitectureHoldMachine`, an overlay; the ABU, attempt and task machines are unchanged). Self-pick and build next do not offer it.
  - Dependents of held ABUs are not held themselves: they cannot start until the held ABU merges, and the impact lists them.
  - In-flight attempts finish. Their review is never paused.
    - Before the record merges, review is against the architecture the attempt was leased under, with the record in context as information; non-conformance with an unmerged record is not a material finding.
    - After it merges, remaining rounds review against the new architecture, and the fixes are ordinary revision rounds.
  - Submitted work keeps its protocol protection.
  - Budgets of held unstarted tasks are released as cancelled and reissued when the hold ends. The builder carries no penalty or reputation mark, and the reissue keeps the unit's original place in the ranking (protocol delta, below).
  - Holds end when the migration graph has fully merged, or when the record is abandoned. Each held ABU is then re-validated: released unchanged, or superseded when a newer contract version does not carry it over (FEATURE-CONTRACT section 5).
- **Priority.** While a record is migrating, its migration ABUs get a published build-next boost (`architecture-policy.v1` `migrationBoost`). Held work returns in its prior order.
- **Rare by design.** Core and conventions get their own record first. Features are modules that talk only through declared APIs and resources. ARCHITECTURE.md section 15 says what is an architecture change and what is local.
- **Protocol impact:** small and additive (build-next boost and hold filter, ranking continuity on reissue, a release label). It is written as a note for the protocol architect in `docs/architecture/D60-PROTOCOL-DELTA.md`; `ws/protocol` is not edited.

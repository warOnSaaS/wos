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

## D19. Proof of Contribution; execution rewarded by normalised usage (A1, A2) — execution part SUPERSEDED by D49
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

## D27. Payout audits, not code review; run logs; payout canaries — audit focus and mandatory run logs SUPERSEDED by D49
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

## Astra review 02 fix pass (founder decisions, 2026-09-29)

## D39. Confiscation after proven cheating — no SILENT or ARBITRARY confiscation
- Supersedes the looser "no confiscation" wording. When review, dispute or audit PROVES cheating, the protocol confiscates everything it still controls: unreleased holdback (all open lookback windows), pending allocations (risk-review and challenge windows), claimable-but-unclaimed entitlements, unreleased Genesis vesting; then offsets on future earnings until the proven excess is repaid; revocation of the cheater's receipts (append-only); zeroed governance weight; time-boxed or permanent exclusion from rewards, voting, review and duty.
- Never on-chain seizure of released tokens: no permanent-delegate or freeze authority (a master key over every holder is an attack target and contradicts a neutral proof of contribution). More reach, if wanted, comes from a longer or larger holdback by policy.
- Due process: recorded evidence, notice, a reply window, one appeal, an action-bound two-person AdminAction for confiscation, a governance vote (structural tier) for permanent exclusion (founder AdminAction in founder mode), a full public record on the permalinks. Confiscated amounts return to the epoch pool and fund recovered-only bounties — never wOS.

## D40. Holdback — rationale and size SUPERSEDED by D49 (holdback now protects against defective work and misattribution)
- Usage-based rewards stay (A2). Each finalized allocation releases a share now and holds the rest (default 50%, policy data) for the 13-epoch lookback. Findings recover from the holdback first. Exclusion after proven cheating forfeits unreleased holdback (RiskPolicy); an ordinary pause in contributing never does. Attested usage stays mainnet-ineligible until F1 is decided with the fabrication results (TOKENOMICS-SIMULATION A2).

## D41. Unrecoverable losses
- Bounties are paid only from amounts actually recovered. Unrecovered fraud (a written-off offset) reduces the following epochs' pools, at most 10% of a budget per epoch, published.

## D42. Audit capacity unavailable
- When no eligible auditor exists by the deadline, the claim releases on schedule, flagged "unaudited" (still inside the holdback). Contributors are never penalised for missing auditors.

## D43. Dispute burden
- Stake forfeited per rejected item (not all-or-nothing); a minimum-stake floor so small earners pay a real but small amount; one appeal per resolved item; erroneously withheld amounts are released with the delay recorded; related parties of the accused never take bounty priority.

## D44. What the governance cap promises
- No organization's FINAL effective voting share exceeds 10% of either weight, enforced mathematically (water-filling; the tally refuses when too few independent groups make the caps infeasible). Turnout uses the same capped denominator. Locks count only if seasoned (held at least one full epoch before the snapshot). Beneficial-owner aggregation: an organization, or a person with every account and wallet they control.

## D45. Organization obligations
- Org admin consent is required for sponsorship; split changes are forward-only (end the link, start a new one); offsets and confiscations are charged to the beneficiary; the organization votes with its own capped weight; authorized wallet controllers are recorded.

## D46. Multisig custody and pause resumption
- Under mainnet option M1 the escrow releases on a schedule sized to at most a few epochs' budgets; the multisig never accumulates more. Resuming settlement after a pause requires an explicit safety confirmation; an expired pause does not auto-resume while the incident is open.

## D47. Publication and retention
- Contributors accept a disclosure of what becomes public BEFORE their first contribution or wallet binding. Run-log bodies expire after 365 days; commitments and hashes are kept. The responsible entity is named in the docs. Privacy items join the existing legal checkpoint only.

## D48. Genesis calibration
- A frozen, independently reviewed reference population excluding the founder and related parties; the stated twelve-epoch statistic computed exactly; a published fallback rate if evidence is insufficient; a canonical work mapping (each commit to exactly one retro unit) so keys cannot overlap.

## Budget-based rewards and hosted-first (founder decisions, 2026-09-30)

## D49. Execution rewards are BUDGET-BASED, not usage-based (supersedes Amendment 02 A2, the execution part of D19, the usage focus of D27, the rationale of D40)
- Every build unit, and every commissioned review, audit, resolution and planning task, carries a **reward budget fixed before work starts**, set during decomposition / contract consensus: sized from expected compute (denominated in ACU, so it stays "agentic compute"), difficulty, importance and shared-dependency value; reviewed in consensus (for Astra and Fable an unjustified budget is a material finding) and compared with peer units.
- Acceptance and merge earn the unit's budget, **independent of actual token usage**. Collaborators split by declared shares (sum = 1; integer rounding at beneficiary level). V1 form: R_ij = B_i x a_i x s_ij with binary acceptance a_i; **no quality factor q in V1** (recommended; founder confirms as F22).
- Token usage is **telemetry**: it enforces the per-unit execution cap, calibrates future budgets (the budget model learns from observed usage of accepted units), feeds abuse signals and model comparisons. It never sets a payout. Run logs become optional evidence.
- **Epoch contract: reservation at issuance.** Each epoch has a task capacity (its execution, planning and human-review slices); a task's budget x the epoch's issuance rate is reserved when the task is issued; a task that does not fit is not issued. Accepted budgets are never scaled afterwards. The issuance rate (WOS per ACU) is announced before issuance: min(the decaying ceiling, capacity / queued demand).
- New risks designed against: budget inflation (model bounds, human approval above 1.25x, hard maximum 2x, peer ranking, proposer may not build), task splitting / reward stacking (per-objective budget cap), cherry-picking easy budgets and stale budgets (recalibration from telemetry of accepted units, re-pricing on expiry). Payout audits refocus on attribution, splits, acceptance and budgets.
- Holdback re-sized: it now protects against defective work and misattribution, not usage fraud. Recommended 20% for 6 epochs (founder decision F15).
- Consequence: the question "is ATTESTED usage good enough to pay on mainnet" (F1) largely dissolves; the mainnet readiness gate itself stays.

## D50. wOS is hosted-first; self-hosting is staged (narrows Amendment 01; not a protocol change)
- Customers in priority order: wOS Cloud organizations (the business), contributors, self-hosters (open-source users, not customers).
- Stage 1 (now, binding): exit rights — open licence; no licence or payment checks in code; standard Postgres; configuration via settings/env; full data export; no hard dependency on Vercel/Neon-only features in product code (portable scheduler, storage and queue interfaces).
- Stage 2 (after V1): a single-server Docker Compose install for evaluation.
- Stage 3 (only when a paying enterprise self-host customer funds it): SSO (OIDC/SAML), bring-your-own OAuth apps with per-provider guides, webhook relay, mobile push relay (APNs/FCM keys belong to the publisher), LTS channel, self-host test matrix, per-version security patches, client environment switcher.
- Deferred from Amendment 01: the client environment switcher, self-host sign-in flows, first-class self-host UX. Integrations and connections will be designed Cloud-first (wOS-registered OAuth apps; credentials read from settings so self-hosters can supply their own) as Amendment 03, after the protocol rework.
- Protocol impact: "entitlements never gate self-hosted code" stays (it is simply "no licence checks"); nothing in the protocol assumes first-class self-hosting.

## D51. Engine-first enforcement: the database keeps only hard invariants (founder-approved, 2026-09-30)
- Migration 0007 had grown to about 2,900 lines of SQL triggers and each review round found new enforcement gaps there; the method, not the individual bugs, was the risk. With usage fraud gone (D49), the database's job shrinks to invariants that must hold even if the application is buggy: append-only records, uniqueness, conservation and non-negative balances at commit, reviewer independence and no self-review, serialized epoch publication, budget immutability after a lease, settlement finality.
- Policy evaluation, qualification chains, dispute outcome derivation, pool payout rules, holdback schedules, confiscation computation, governance tallies, canary evaluation and budget-model bounds live in the deterministic engine and rules (`packages/contracts/src/protocol`) with table tests; the service layer must call them before writing; the database stores their outputs append-only.
- No guarantee may silently disappear: every repro and assertion of reviews 02 and 03 is rejected by an SQL invariant or by a rule test (docs/protocol/GUARANTEES.md; REVIEW-PACKET §3e).


## D52. GLM (Z.ai, GLM-5.x) is a CANDIDATE builder model, eligible for nothing until qualified (founder decision, 2026-09-30)
- `capability-policy.v1.json` lists `glm` under `candidates`: provider `zai`, status `candidate`, no allowed roles, target classes BUILD_L1 then BUILD_L2. It is never a reviewer or resolver unless separately qualified for REVIEW_A/REVIEW_B/ARCHITECT_L1.
- Launch paths: (a) the `claude` CLI with `ANTHROPIC_BASE_URL` pointed at Z.ai's Anthropic-compatible endpoint, `ANTHROPIC_AUTH_TOKEN` the contributor's own key (wOS never reads it) and `ANTHROPIC_MODEL` the GLM id; the orchestrator detects the base URL and records base URL and provider **as declared** — a CLI pointed elsewhere only self-reports its model, so a non-Anthropic base URL never passes as an Anthropic model. The endpoint value is unverified here. (b) A ZCode (`zcode`) adapter later; not built.
- Qualification: `ModelQualificationSuite` `model-qualification.build-l1-l2.v1` — a fixed set of historical/benchmark build units with known acceptance outcomes, run in devnet shadow mode, pass thresholds per class (draft: at least 20 units, 80% of acceptable units accepted, at most 5% of rejectable units accepted), recorded per model version. The unit manifest is not frozen yet (hash null; no units invented). Passing adds a `qualifiedBy: "eval_suite"` entry to the class; budgets are unaffected (D49 pays the budget, whatever model).
- Enforced by the rule `modelClaimRefusals` (a candidate is refused at claim for every role until qualified); test "candidate models (D52: GLM via Z.ai)".

## D53. Fable unavailable: ReviewPolicy fallback `fable_unavailable` (founder decision, 2026-09-30)
- The founder is out of Fable. Working model until the founder says otherwise: **authoring (roadmaps, feature contracts, builds) on Opus; agent review on Astra at max permitted effort; Fable not used.**
- ReviewPolicy data (`review-policy.v1.json` `fallbacks[]`, key `fable_unavailable`, active): the Fable seat is replaced by the **required human review** (the founder or authorized reviewers) as the second independent check; Astra stays the agent reviewer (a different lab from the Opus builder, so builder/reviewer independence holds); **a model never reviews work built by the same model** (no Opus review of Opus-built work); every round and receipt reviewed under the fallback carries the label `single_lab_review` with the reason (ContributionReceipt `reviews.labels`, in the receipt hash) and is eligible for devnet/shadow accounting only; a later Fable pass is optional, never required and never blocking.
- The switch is an AdminAction (`switch_review_policy`, forward-only) and is shown publicly. Rules `reviewSeatRefusals`, `requiredReviewSeats`, `reviewPolicySwitchRefusals`; tests "D53: …" in `protocol-rules.test.ts` (Fable seat refused while active; Opus reviewer refused on Opus-built work; labels present).

## D54. Provisional receipts finalize optimistically (founder decision, 2026-09-30; supersedes the ratification queue)
- When bootstrap ends (ReviewPolicy `ratification.bootstrapEndsAtOutsideContributors`: 3 — F31, accepted by D57), every PROVISIONAL receipt is published with a challenge window (default the payout challenge window, 48 h) and all participants are notified; **silence accepts it**: it becomes qualifying (Genesis-eligible) with its original timestamp. A challenge sends that receipt to the normal review gate (evidence, right of reply, a decision; stakes and appeals follow D55). No recruited reviewer pool or ratification queue.
- Everything else about bootstrap stays: the founder merges and reviews anything; devnet/shadow mode; `single_lab_review` labels under D53.
- **No hard dependency on an independent human before bootstrap ends.** Paths checked and changed: (1) the ratification queue and payout-audit ratification of PROVISIONAL receipts → optimistic finalization (rule `provisionalReceiptOutcome`); (2) two-person AdminActions (budget approval above 1.25x, policy activation, offsets, clips, write-offs, confiscation) → in bootstrap a two-person action without a co-signer is recorded **single-signed** and labelled in the public chain (`admin_actions.bootstrap_single_signer`), still one-use and operation-bound (F32); (3) the `standard`/`security`/`protocol` human review requirement → met by the founder or an authorized reviewer (founder's own work stays PROVISIONAL, D23); (4) Genesis approval by independent humans is mainnet-only and dormant (D55); (5) dispute gates → resolved by a maintainer AdminAction in V1. Tests: "D54: …" (provisional → final on silence; challenged → gate; nothing waits before bootstrap ends) and db "D54 a two-person action in bootstrap is single-signed".

## D55. V1-ACTIVE and DORMANT modules (founder decision, 2026-09-30)
- Budgets removed the direct incentive to fabricate usage; much of the remaining machinery defends value that does not exist yet. The protocol is split so review 06 and the build plan cover only what V1 needs while the solo founder runs on devnet/shadow with valueless tokens.
- **V1-ACTIVE:** accounting correctness (conservation, single payment, reservation lifecycle, expiry, no stranded balances — every review-04/05 correctness finding), budgets with bounds and the per-objective cap, acceptance review (Astra + human per ReviewPolicy, including the D53 fallback), the optimistic challenge window and publication, D54 provisional finalization, append-only audit and AdminActions, the shadow-mode epoch pipeline, a simple bounded hold and the holdback.
- **DORMANT** (designed, contracts and tests kept, excluded from V1 build waves, refused until a forward-only policy switch by AdminAction after its trigger): dispute stakes and bounties; multi-allocation disputes and appeals (V1: one flagged receipt → review gate with reply and one decision); payout canaries; organization caps and org-beneficiary splits; governance voting (the founder sets policy by public AdminAction); collusion/Sybil detection beyond related-account independence and anomaly metrics; confiscation beyond a simple hold; the Genesis calibration population. Triggers: `reward-policy.v1.json` `modules.dormant[]` (F33, accepted by D57), POLICIES §0, PROTOCOL §13. Rule `moduleRefusals`.
- Review-04/05 findings that concern only dormant modules get the status "dormant — deferred to activation" (R04-3 stake/hold collateral, R04-5 appeal/finalization race; GAPS G-98 makes their fix a precondition of activation) unless the fix was trivial (R04-4 bounded holds and one confiscation end, R04-11 manifest hash, R04-9 canonical fields were fixed).

## D56. Build next: contributors can let wOS pick their work (founder decision, 2026-09-30; V1-ACTIVE; ranking and "budgets identical in both modes" SUPERSEDED by D63 from capability-policy.v2)
- Two modes: **self-pick** (the existing claim of a chosen unit) and **assigned** (`wos build --next`, Desktop BUILD NEXT): the control plane returns the highest-ranked unit the contributor is ELIGIBLE for and leases it atomically with the same fencing as a claim. Eligibility = the claim's (model qualified for the class, D52 candidates refused, D53 fallback; toolchain attestation; per-provider lease limits; never the contributor's own — or a related account's — proposed budget; a funded live budget; the contributor's limits). Optional continuous mode takes the next unit until stopped or a contributor-set limit (units, wall time, ACU, per provider) is reached; checkpoint/stop as for single builds.
- Ranking is versioned, published policy data (`capability-policy.v1.json` `assignment`, `build-next-ranking.v1`): reuse (targets served by the unit's catalog feature), unlock value (dependents waiting), declared focus (e.g. Salesforce first), ageing so nothing starves; deterministic, ties by unit id. The contributor's limits are a filter, never a score. Budgets are identical in both modes. Optional lever, default OFF: a short window in which freshly issued units are offered only to assigned mode (reduces cherry-picking). Weights and focus as drafted (F29, accepted by D57).
- Contracts: `protocol/assignment.ts` (`POST /v1/builds/next`, `ClaimNextBuildRequest`/`Response`; joins `api.ts` when the protocol leaves draft); rules `nextUnitEligibilityRefusals`, `rankNextUnits`, `selfPickRefusals`, `continuousNextStop` with table tests; interface note in WORKSTREAMS-PROTOCOL.

## D57. Founder accepts the architect's recommendations on the open protocol decisions (founder decision, 2026-09-30)
- The founder accepted every open recommendation and provisional value in ADR-001 §6: **F15** (holdback 20% for 6 epochs), **F17** (compensatory only; maxima 336 h reply / 720 h appeal / 336 h lapse), **F18**, **F20**, **F21**, **F22** (acceptance only, no quality factor), **F23** (reservation at issuance), **F24**, **F25**, **F26** (failed work funds nothing), **F27** (finding bonuses 0), **F28** (review grace 2 epochs), **F29** (build-next weights as drafted, assigned-only window off), **F30** (GLM eligible for nothing until thresholds and units are set), **F31** (bootstrap ends at 3 outside contributors with an accepted receipt), **F32** (single-signed two-person actions during bootstrap, publicly labelled), **F33** (dormant-module triggers as in POLICIES §0), **F34** (decided before stakes activate, G-98).
- "Provisional" values become the policy values for devnet and shadow mode. They remain tunable by a public AdminAction, and Astra review 06 may still change them.
- Not adopted: recurring payments to feature builders (stewardship or a reuse royalty). The founder judged it unnecessary; no module is added.

## D58. The conflict resolver comes from another lab than the reviewer who raised the finding (founder decision, 2026-09-30; V1-active, low priority)
- REVIEW-PROTOCOL §8 gave every `conflict_resolution` to Fable, so a disputed Fable finding was judged by its own lab. Now each disputed finding goes to a resolver of the OTHER lab: Fable-raised → Astra resolver, Astra-raised → Fable resolver. Mixed sets are **split per raising lab** (one resolver task per group — the existing task kind opened twice, the smaller change; sending every mixed set to the human would load the founder with routine rulings). A finding raised by both reviewers (only two labs exist) or with no eligible other-lab resolver goes to the human maintainer. While the D53 fallback is active every conflict already goes to the human — unchanged. Existing exclusions stay (not the author, neither reviewer of the disputed rounds); the maintainer's confirmation stays final.
- "An objective we can see how it works": per ruled finding, `wos.ruling_lab_records` (a tiny append-only, public table in migration 0007) records the raising lab (derived by the database from the finding's review provider), the resolving lab (`human` for the maintainer) and the outcome; the database refuses a same-lab record. `crossLabUpholdRates` gives the uphold rate per (raising lab, resolving lab), to measure whether resolvers favour their own lab.
- Rules `labOfProvider`, `routeDisputedFindings`, `resolverEligibilityRefusals`, `crossLabUpholdRates`; tests "D58: …" (rules) and db "D58: a Fable-raised finding resolved by a resolver of the same lab". For bundle 07 (REVIEW-PACKET §3h).

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

## D61. Bugs and maintenance (founder decision, 2026-09-30): the planning and build side
- Founder: bugs and maintenance are first-class work. The protocol architect designs the economy side (task types, budgets, outcomes) on `ws/protocol`; this side is contracts 5.7.0 (`packages/contracts/src/bugs.ts`). The two meet only through the records here; the note for the protocol is `docs/architecture/D61-PROTOCOL-NOTES.md`.
- **Intake.** `wos bug` (CLI and Desktop) files a `BugReport` (`wos-bug-report.v1`) through the wOS GitHub App as a GitHub Issue in waronsaas/product, labelled `wos:bug` (D9). The issue body carries the report as one fenced `wos-bug-report` block. Reproduction steps are required; a failing test is optional but encouraged. The bug's id is `BUG-<issue number>`.
- **Triage.** A `bug_triage` task, done by an agent or a maintainer, outputs a `TriageDecision` (`wos-triage-decision.v1`):
  - whether it reproduced, and where;
  - the severity (low, medium, high or critical);
  - duplicates;
  - the mapping through the scope paths: catalog feature, contract version, requirements, divergent ABUs and files;
  - the outcome: `fix`, `contract_revision`, `duplicate`, `not_reproducible`, `not_a_bug` or `wont_fix` (maintainer only).

  Its canonical hash is what the protocol binds the reward to.
- **Fix units.** When the code diverges from a merged contract, a fix ABU (`AbuSpec.fix`: bug and regression test) is created directly at the current merged contract version, with no version bump.
  - `planning.validateFixUnit` enforces the rules: writes only inside `modules/<feature>/**` and `features/<feature>/acceptance/**`; restores requirements of the merged contract; the regression test is at `<profile acceptance dir>/regressions/BUG-<n>.*`; no architectural element changes.
  - CI proves red then green: check `wos-regression/<feature>/BUG-<n>`, `redGreenRefusals`. The regression test fails on the parent commit and passes on the head.
  - Normal review and merge queue.
  - When the contract itself is wrong, a contract revision opens instead.
- **Sweeps.** Scheduled or maintainer-opened `bug_sweep` tasks (`BugSweep`) run acceptance journeys across surfaces (the web browser matrix, iOS, Android) and explore. Their output (`SweepOutput`) is bug reports only: no write scope, and every failed journey is reported.
- **Priority and holds.**
  - Severity boosts are published policy data (`bugs-policy.v1`): low 0, medium 150, high 1000, critical 200000. A critical fix outranks an architecture migration (100000).
  - A critical bug whose outcome is fix or contract_revision HOLDS the unstarted new feature ABUs of its feature until the fix merges (`computeBugHolds`, the D60 overlay, now `WorkHoldMachine` with an architecture or bug source). The fix and every other feature keep building. A maintainer confirms critical severity before holds open.
- **The regression suite grows.** Every fix's regression test stays in that feature's acceptance suite for good. Removing one needs a contract revision.

## D61 (economy side). Bugs and maintenance: triage, fixes and reports are paid only through confirmed, resolved bugs (founder decision, 2026-09-30; first versioned addition after the freeze D62)
- Versioned addition: `reward-policy.v2` and `capability-policy.v2` (v1 files byte-identical; a budget or receipt pinned to v1 has no bug route and fails closed), contracts 5.10.0, migration 0010. It binds to the planning side's records (contracts 5.7.0 `bugs.ts`: `BUG-n`, `TriageDecision` and its canonical hash, `RedGreenEvidence`), never to their prose.
- **Triage** (`BUG_TRIAGE`, event `triage_decision_confirmed`): a commissioned `bug_triage` task under a lease (execution slice; capability budget 2 ACU, provisional). The receipt is bound to the decision's canonical hash and paid only once the decision is CONFIRMED: `fix` by the fix's red-then-green acceptance or a maintainer's ratification; `contract_revision` when the revision merges or by ratification; `duplicate` when it names an EARLIER bug (lower BUG number) whose outcome acts; `not_reproducible` / `not_a_bug` by a maintainer's ratification; `wont_fix` is a maintainer's own decision, never a paid triage. A critical severity is effective only once a maintainer confirms it (bugs-policy.v1 `maintainerConfirmsCritical`); a maintainer's severity correction is penalty-free for the triager.
- **Fix** (`BUG_FIX`, event `bug_fix_merged`; review 09: the quote is priced at the severity effective AT ISSUANCE and pins that decision revision, so a later correction changes future commissions and the ranking only; `abu_revision` is priced as a build of its size): an ordinary `abu_build` (or `abu_revision`) budget with a bounded severity factor on its price (low/medium 1x, high 1.25x, critical 1.5x; ceiling 1.5x; 2x budget hard maximum still applies), priced at the EFFECTIVE severity and pinned at issuance. Decision (the planning note left it to the protocol): severity changes the price as well as the ranking, because the founder's brief framed a fix as "a budgeted task by severity and size"; the factor is small, bounded and only effective once a critical is confirmed. Acceptance needs outcome `fix`, `redGreenRefusals` empty, the lease, and the fixer must not have triaged the bug (nobody both triages and fixes one bug).
- **Report** (`BUG_REPORT`, the existing outcome weights 2/6/20/50 by effective severity): one paid report per bug (dedup key `bug:BUG-n`), the first reporter only (the duplicate chain decides who was first), paid once resolved (fix accepted or revision merged), at most 10 paid reports per reporter per epoch.
- **Sweeps** have no receipt type and no base: they are paid only through their confirmed, resolved reports (reporter = the sweep's lease holder). The planning note allowed "at most a small base"; zero is within it and matches the founder's "only through confirmed, fixed bugs".
- **Self-dealing.** Nobody triages their own (or a related account's) report or a bug blamed on their receipt; nobody triages and fixes one bug. Within the pinned revert-offset window (14 days, `revertOffsetDays`) a bug blamed on an accepted receipt is a partial revert: its introducer (or a related account) is never paid for reporting it and does not take its fix; and when the first unrelated reporter is paid, the introducer carries an OFFSET equal to that report's pay (`introducerOffsetEqualsReportPay`, recovered through the existing offsets / holdback path; compensatory, no reputation effect). Simulation table R: with the offset a plant-and-report pair nets 0 per bug (only a fix's severity premium, for real work that passes red-then-green and two reviews); without it the pair nets the full report weight.
- **Disagreement with the planning note, flagged for the founder (F35):** the note recommends no introducer consequence in V1 (the ABU passed two reviews). The founder's brief asked to tie bugs into the 14-day revert offset and the holdback, and table R shows the plant-and-report loop pays without it. Implemented: the offset, bounded to the report's pay and to the window. The alternative is one policy switch (`introducerOffsetEqualsReportPay: false`), not a code change.
- **Priority:** fix units rank by the published severity boosts of `bugs-policy.v1` (0/150/1000/200000), copied into `work-next-ranking.v1` and asserted equal (D63).

## D62. Protocol v1 frozen for devnet/shadow implementation (founder decision, 2026-09-30)
- Astra review 08 (docs/protocol/reviews/ASTRA-REVIEW-08-protocol-design.md) returned FREEZE AFTER THE LISTED CHANGES; R08-1 (allocation challenges for every live-countable receipt) and R08-2 (submission admission fails closed; expiry instant pinned at issuance) are fixed with the regressions it listed (REVIEW-PACKET §3k). **Proof of Contribution protocol v1 — the V1-ACTIVE modules of PROTOCOL §13 with their contracts, rules, engine and migration 0007 — is FROZEN for devnet and shadow implementation.**
- Frozen means: implementation builds against it (WORKSTREAMS-PROTOCOL waves); every later change is a VERSIONED ADDITION (a new D-decision, a contracts version, a migration after 0007) with its own narrow Astra review. It does not authorize mainnet, an ICO, value-bearing tokens, activating a dormant module (each needs its G-98 preconditions and a public AdminAction), or applying migration 0007 to production.
- Contracts: the protocol entry point `@waronsaas/contracts/protocol` leaves "draft" as **frozen protocol v1** and ships in contracts **5.9.0 (MINOR: an additive subpath export; nothing in the existing contracts changes)**. The MAJOR 6.0.0 described in WORKSTREAMS-PROTOCOL §1 (TaskKind/AgentRole additions, api.ts routes, TOKEN_DISCLAIMER replacement) remains the P0 wiring step and is not part of this freeze.

## D63. One priority queue for all work, with a queue bonus over the base price (founder decision, 2026-09-30; versioned addition; supersedes D56's build-only ranking and "budgets identical in both modes")
- **One queue ("work next").** The assigned mode ranks EVERY claimable task the contributor is eligible for: `abu_build` / `abu_revision` (including D61 fix units), `roadmap_author`, `feature_author`, `architecture_author` (D60), `bug_triage`, `bug_sweep`, the three review kinds where the review protocol lets them be pulled (seat rules, independence, D53 and D58 unchanged; never your own or a related account's work) and `conflict_resolution`. Eligibility is ONE rule (`workEligibilityRefusals`) shared by the queue, self-pick and continuous mode, which walks the same queue.
- **One published, deterministic ranking** (`capability-policy.v2` `workNext`, `work-next-ranking.v1`; `rankWorkNext`): reuse x targets served + unlock x dependents waiting + kindBase[kind] + focus + ageing + severity boost (D61, bugs-policy.v1) + architecture-migration boost (D60, architecture-policy.v1) + priority vote (DORMANT). Ties by unit id. Held units are excluded (D60 delta).
- **Cross-kind priority is derived, not hand-set.** Documents rank by their measured unlock value: dependents waiting = the tasks that cannot be issued until the document merges (a roadmap: its target's features awaiting contracts; a feature contract: the ABUs of its build graph and the features ordered after it). `kindBase[k] = weights.unlock x structuralUnlock[k]`, where structuralUnlock is what a kind unblocks by construction: 1 for a review (its subject's merge) and a triage (its fix), 0 for every other kind (they carry their own measured dependents). `workNextPolicyRefusals` rejects any hand-set kindBase.
- **Pay: a published BASE price and a "+20% queue bonus"** (review 09 R09-1: the coefficient is PAY and lives in the pinned reward policy, `reward-policy.v2` `queue.queueBonusBp`; v2 work must carry complete claim terms at it, one set per task). Every task has a published base price (the self-pick price). The queue pays base x (1 + `queueBonusBp`), `queueBonusBp` = 2000 provisional, tunable by public AdminAction and pinned per lease. The reservation at issuance is the queue price (the budget-model output), so no extra capacity is locked. Rounding: base = floor(reservation x 10000 / (10000 + bonus)) in base units; a claim without the bonus is paid the base and the bonus portion (reservation − base) returns to R at acceptance (engine `queueBasePrice`, `queueBonusReturnedBase`; SQL Q1 caps its allocations at the base). Self-pick therefore pays budget / 1.2 ≈ 83.3%. The claim (mode, bonus, whether it applies) is pinned in the lease's `RunPolicySnapshot.claim`.
- **Anti-gaming.** Contributor limits that filter the queue stay coarse: providers, maximum size points, the surfaces and toolchains the machine can build, wall time, ACU, unit counts (`ContributorLimits`, strict; a limit naming a feature, target or task is refused). Toolchain and specialist eligibility (e.g. native iOS) is a filter, so specialists are not penalised. Releasing an assigned task before submission (anything but an authorized cancel, a work hold, or an expiry the contributor did not cause) means "your next claim doesn't get the queue bonus"; 3 such releases within 168 h start a 24 h cooldown (`declines`, provisional). The v1 `assignedOnlyWindowMinutes` lever is not carried into work next: the bonus does its job (it stays in the frozen v1 data at 0).
- **Priority voting is a DORMANT module (`priority_vote`).** A `priorityVote` ranking term fed by votes on targets, features or bugs; voter eligibility and weight reuse the governance seasoning rules (12-month lock, 6-month contribution, distributed-supply basis, organization cap) with the governance Sybil rules; the term is linear in seasoned weight and capped at `maxBoost` 500, which `workNextPolicyRefusals` keeps below the migration (100000) and critical (200000) boosts. Activation trigger in POLICIES §0; preconditions in GAPS G-98. In V1 the founder's focus list (F29) is the only priority input.

## D64. Order: the CRM slice before the Solana devnet and wallets (founder decision, 2026-09-30)
- Founder ("do what you think"): product before protocol. The v0.9 self-assessment's high gap `bottleneck-is-adoption-not-code` and its improvement `product-before-protocol` (docs/assessments/2026-09-30-v0.9-claude-opus.*) say the barrier is migration, trust and a usable product, not reward accounting.
- The order is:
  1. P1 shadow accounting, first: it is cheap and records real contributions from day one.
  2. The first real agent runs.
  3. The Salesforce CRM roadmap v1.
  4. The CRM slice: Contacts, Organizations and Activities, plus `import-engine` with the Salesforce import (D59).
  5. Then P2 Solana devnet, P3 wallets and claims, and P4 devnet end to end.
- AGENTS.md "Next" follows this order.

## D65. Amendment 04: identity and organizations (founder decision, 2026-09-30)
- Founder ("do what you think"): the architect designs it. Text: `docs/AMENDMENT-04-IDENTITY-AND-ORGANIZATIONS.md`; contracts 5.12.0 (`identity.ts`, `IdentityRoutes`, `identity-policy.v1`); migration 0012.
- **V1-active:**
  - Sign in with GitHub on every client. It creates or links the account and is the contributor's GitHub link. Accounts are never auto-merged: a GitHub email that belongs to an account needs a code sent to that mailbox, redeemed by the same client.
  - Invites by email with a role (7 days; the account's email must match the invite's).
  - Member management, where the last owner cannot leave.
  - Verified domains: a DNS TXT proof, one organization per domain, a public-domain blocklist, and a join policy of off, request or auto_join, applied at the member's own next sign-in and never after they leave.
  - Per-app permission overrides by admins.
  - Per-account and per-org rate limits, per-org quotas on plan `free`, and abuse guards.
- **Dormant until an enterprise pays (D50):**
  - SSO (OIDC, SAML) enforced per verified domain;
  - SCIM;
  - audit export.

  Their contracts are designed now; their routes answer `MODULE_DORMANT` until a public AdminAction activates them. They are never gated on self-hosted Core (S-41).
- Contributors keep one account. Build is independent of company organizations.

## D66. Amendment 04 open items, decided (coordinator for the founder, "do what you think"; 2026-09-30)
- **Quotas:** the `free` plan quotas are accepted as drafted; a paid plan is undecided until one is sold.
- **Blocklists:** maintained open lists, pinned by commit hash and refreshed only by a reviewed PR, never fetched live.
  - Disposable domains: `disposable-email-domains` (CC0-1.0) at 51fafcd8…, committed as `data/disposable-email-domains.v1.json`.
  - Public mail providers: the curated committed list.
- **SSO break-glass:** an email code plus a second owner's approval; with a single owner, a maintainer AdminAction with a public label.
- **Account lifecycle:** account deletion, data export and email change are designed before Wave 3b (Amendment 04 addendum A, contracts 5.13.0).
  - Deletion has a 14-day grace; personal data is deleted; contribution, ledger and receipt records are pseudonymised; git history is kept.
  - An email change is re-verified at both addresses, or by the linked GitHub when the old mailbox is lost.
- **Public site:** "Sign in with GitHub" appears next to the email code once the routes are live.
- **GitHub App:** the founder enables the App's "Email addresses: read" permission (FOUNDER-CHECKLIST).

## D67. Bootstrap exception: the founder may hold the D53 human seat on the founder's own work (founder decision, 2026-09-30)
- While bootstrap is on (D23/D54; bootstrap ends at 3 outside contributors with an accepted receipt, F31), the bootstrap founder, as maintainer, may hold the D53 human review seat on a round whose subject the founder's own account authored.
- Conditions:
  - the round, its human verdict, the PR comment and any provenance are labelled `bootstrap_self` publicly, alongside `single_lab_review`;
  - the founder's authored work stays PROVISIONAL (D23). After bootstrap ends it gets the independent re-review of REVIEW-PROTOCOL section 9 "After exit" (an ordinary round on the merged head);
  - the agent seat is still never the author's own model (Astra reviews Opus-authored work);
  - the human seat still opens only after the Astra verdict is sealed ("the human is the final check");
  - only the maintainer account named as the bootstrap founder may use it, and it is refused automatically once bootstrap ends;
  - the founder still never holds both the agent seat and the human seat of one round (`humanMayHoldAgentSlotOfSameRound` is unchanged).
- Encoded as `review-policy.v2` (`bootstrap.bootstrapFounderMayHoldHumanSeatOnOwnWork: true`, `bootstrapFounderMayHoldBothSeats: false`); v1 is unchanged. It is activated by the existing forward-only AdminAction `switch_review_policy` naming the founder, and a round follows the policy in force when it opened. Contracts 5.16.0, migration 0014 (the database guard of the human seat mirrors it).

## D71. Solo bootstrap: the founder may hold both seats of a round on the founder's own work (coordinator ruling for the founder, 2026-09-30)
- The founder: "there is no way I am set up for other reviewers yet … that cannot be baked in this early". So while bootstrap is on (D23/D54, F31), the bootstrap founder named by the review policy may:
  - (a) run the agent seat (Astra, on the founder's own Codex) AND hold the D53 human seat of the same round, on work the founder's account authored;
  - (b) do so without the 24-hour self-review wait (`selfReviewAfterHours`).
- What still holds:
  - the agent seat's model is never the author's model (Astra for Opus- or GLM-authored work; a candidate-trial author under D69 is matched by the model id its run recorded);
  - the human seat opens only after the agent verdict is sealed;
  - everything is labelled `bootstrap_self` and `single_lab_review` in public (round, `round.revealed`, PR comment, provenance);
  - the work stays PROVISIONAL (D23) and gets the independent re-review of REVIEW-PROTOCOL section 9 "After exit";
  - it is refused for anyone except the named founder, and for everyone once bootstrap ends.
- Encoded as `review-policy.v3` (`bootstrapFounderMayHoldBothSeats: true`, `bootstrapFounderSkipsSelfReviewWait: true`). v1 and v2 are unchanged. It is activated by the same forward-only `switch_review_policy`, and a round follows the policy in force when it opened. Contracts 5.18.0, migration 0016.

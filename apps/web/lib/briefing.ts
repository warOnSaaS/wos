/**
 * The full briefing: the whole idea and how every part works.
 * Rendered by /briefing and included verbatim in /llms-full.txt.
 *
 * Sources: docs/V1-SPEC.md and docs/DECISIONS.md. Where those leave a detail
 * open, this says so instead of inventing it.
 *
 * Diagrams are plain ASCII (the web font has no box-drawing glyphs), at most 38
 * characters wide so they fit a 360px screen.
 */

import { SIGN_IN, TOKEN_DISCLAIMER } from "./site";

export type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "kv"; rows: [string, string][] }
  | { type: "diagram"; label: string; lines: string[] }
  | { type: "note"; text: string };

export type BriefingSection = { id: string; title: string; blocks: Block[] };

export const BRIEFING_INTRO =
  "The whole idea, and how each part works, top to bottom. Where a detail is not settled yet, this page says so.";

export const BRIEFING: BriefingSection[] = [
  {
    id: "mission",
    title: "Mission",
    blocks: [
      { type: "p", text: "Businesses rent the software they run on. warOnSaaS builds open-source replacements for the biggest of those products, so a business can own and run its own." },
      { type: "p", text: "The work is done by AI coding agents. Contributors run them on their own machines, on their own Claude and ChatGPT subscriptions. wOS, the warOnSaaS operating system, coordinates the work: what to build, in what order, by whom, and whether it is good enough to merge." },
      { type: "p", text: "Every app will be self-hostable. Hosted status is shown per app." },
    ],
  },
  {
    id: "sniper-list",
    title: "The Sniper List",
    blocks: [
      { type: "p", text: "The public list of targets. Ten to start, in this order: Salesforce, HubSpot, Slack, Zoom, Shopify, QuickBooks, Jira, Zendesk, DocuSign, NetSuite." },
      { type: "p", text: "TGT-00 is warOnSaaS itself. The system is built with its own process, so its feature list is written in the same format as every other target." },
      { type: "p", text: "Each target reports three numbers, measured separately:" },
      { type: "kv", rows: [
        ["Mapped", "How much of the product is on its roadmap."],
        ["Specified", "How much has consensus Feature Contracts."],
        ["Built", "How much is merged."],
      ] },
      { type: "p", text: "No mock data. If a number is 0%, the site shows 0%. Today every number is 0%." },
    ],
  },
  {
    id: "structure",
    title: "How a product is broken down",
    blocks: [
      { type: "p", text: "Every target is broken down the same way, from the whole product to a single change:" },
      { type: "diagram", label: "Breakdown: application, capability, feature, requirement, atomic build unit, contribution", lines: [
        "APPLICATION        e.g. Zoom",
        "  `- CAPABILITY    e.g. Meetings",
        "      `- FEATURE   e.g. Video meeting",
        "          `- REQUIREMENT",
        "              `- ATOMIC BUILD UNIT",
        "                  `- CONTRIBUTION / PR",
      ] },
      { type: "p", text: "The public site will let anyone drill down this chain, from an app to the PR that built a piece of it." },
    ],
  },
  {
    id: "pr-types",
    title: "The four PR types",
    blocks: [
      { type: "p", text: "All work lands on GitHub as one of four kinds of pull request:" },
      { type: "kv", rows: [
        ["1. Roadmap", "One canonical PR per application, e.g. “Zoom Replacement Roadmap”. Maps the product into capabilities and features."],
        ["2. Feature Contract", "One per feature. States exactly what the feature must do."],
        ["3. Implementation", "One per Atomic Build Unit. The code."],
        ["4. Architecture Resolution", "Resolves a blocker where a shared contract is not enough."],
      ] },
      { type: "diagram", label: "Order of PRs: roadmap, then feature contracts, then implementation per build unit; architecture resolution when blocked", lines: [
        "ROADMAP PR",
        "   | merged",
        "   v",
        "FEATURE CONTRACT PR  (one per feature)",
        "   | merged",
        "   v",
        "IMPLEMENTATION PR    (one per unit)",
        "",
        "ARCHITECTURE RESOLUTION PR",
        "   when a shared contract blocks work",
      ] },
      { type: "p", text: "Reviews are not PRs. A review is a record attached to the work it reviewed." },
    ],
  },
  {
    id: "consensus",
    title: "Consensus: two reviewers must agree",
    blocks: [
      { type: "p", text: "Roadmaps and Feature Contracts are reviewed by two AI models from two labs: Fable (Claude, by Anthropic) and Astra (ChatGPT, by OpenAI). Both run at maximum reasoning." },
      { type: "p", text: "Each one tries to prove the document incomplete. Neither sees the other’s current conclusion. The document is revised and reviewed again until both return NO MATERIAL GAPS. That is consensus." },
      { type: "diagram", label: "Consensus loop: draft, independent reviews by Fable and Astra, revise until both report no material gaps", lines: [
        "  DRAFT",
        "    |",
        "    +--------------+",
        "    v              v",
        "  FABLE          ASTRA",
        "  (Claude)       (ChatGPT)",
        "    |  independent |",
        "    `------+-------+",
        "           v",
        " both NO MATERIAL GAPS?",
        "    no -> REVISE -> DRAFT",
        "    yes -> CONSENSUS",
      ] },
      { type: "p", text: "Nobody starts a competing roadmap. Contributors propose changes into the one canonical roadmap." },
      { type: "p", text: "Reviewer requirements are written as machine-readable Agent Policies, not as prompt text." },
    ],
  },
  {
    id: "catalog",
    title: "The shared Feature Catalog",
    blocks: [
      { type: "p", text: "Many products need the same features: contacts, threaded messaging, invoices, roles and permissions, an audit log. These are built once." },
      { type: "p", text: "A Feature Contract is canonical and app-independent. It lives in one global Feature Catalog. Each app’s roadmap maps its capabilities to catalog features, or proposes a new one." },
      { type: "diagram", label: "Apps map to shared catalog features, many to many", lines: [
        "SALESFORCE -+",
        "            +-> Contacts",
        "HUBSPOT ----+",
        "            `-> Audit log <-+",
        "ZENDESK --------> Tickets   |",
        "            `---------------+",
      ] },
      { type: "list", items: [
        "Each app lists the requirements it needs from a feature. A feature counts as specified or built for an app only when every requirement that app references is specified or built.",
        "Duplicates are a review finding. “This duplicates an existing catalog feature” is a material gap.",
        "When a shared contract changes, every affected app is listed and its requirements go into the review.",
        "A build unit is paid once, not once per app. Each app’s completion pool still pays out when its requirements reach 100%.",
      ] },
    ],
  },
  {
    id: "tracking",
    title: "From merged roadmap to tracked features",
    blocks: [
      { type: "p", text: "When a roadmap version merges, every feature it references becomes a tracked record for that app. Each feature opens, or links to, its Feature Contract workflow." },
      { type: "p", text: "Every feature shows its own progress. Feature progress rolls up to the capability, and capability progress rolls up to the app." },
      { type: "diagram", label: "Progress rolls up from features to capability to application", lines: [
        "FEATURE  %  -+",
        "FEATURE  %  -+-> CAPABILITY %",
        "FEATURE  %  -+        |",
        "                      v",
        "            APPLICATION %",
        "   (mapped, specified, built)",
      ] },
      { type: "list", items: [
        "Progress is computed by fixed, tested functions.",
        "Weighting is fixed per roadmap version and published.",
        "Every number traces back to the records behind it.",
        "Numbers are recomputed when a merge happens on GitHub.",
      ] },
    ],
  },
  {
    id: "build-graph",
    title: "Feature Contracts and the Build Graph",
    blocks: [
      { type: "p", text: "A merged Feature Contract is broken into a Build Graph of Atomic Build Units. A unit is small enough for one AI agent to finish." },
      { type: "p", text: "The graph records which units depend on which. Units with no dependency between them are built at the same time, and they own separate files, so they never collide." },
      { type: "diagram", label: "Build graph: independent units run in parallel, dependent units unlock on merge", lines: [
        "  ABU-1     ABU-2     ABU-3",
        "    |         |    (parallel)",
        "    `----+----+",
        "         v",
        "       ABU-4   unlocks when",
        "               1 and 2 merge",
      ] },
      { type: "p", text: "Each agent has a context budget. A unit that cannot fit safely in the builder’s budget is rejected and split further." },
    ],
  },
  {
    id: "leases",
    title: "Leases and parallel building",
    blocks: [
      { type: "p", text: "Before anyone builds a unit, wOS leases it to them. A lease is a time-limited reservation held by one account. It fixes the base commit to build on and the files that may change." },
      { type: "list", items: [
        "One unit, one lease holder at a time.",
        "Independent units from the same feature can be leased by different people at once.",
        "A lease requires a linked GitHub account.",
      ] },
      { type: "note", text: "Technical detail: wOS creates an isolated git worktree for the lease, hands the local Claude Code a context manifest for that unit, and enforces an allow-list of paths." },
    ],
  },
  {
    id: "build",
    title: "The build",
    blocks: [
      { type: "p", text: "Pressing BUILD in wOS Desktop, or running wos build <task-id>, runs one fixed sequence:" },
      { type: "diagram", label: "Build sequence: lease, build, verify, review, qualify, PR", lines: [
        "LEASE -> BUILD -> VERIFY",
        "                    |",
        "   PR <- QUALIFY <- REVIEW",
      ] },
      { type: "steps", items: [
        "Check the contributor’s agent and model are eligible.",
        "Issue the lease.",
        "Create an isolated copy of the code at the base commit.",
        "Assemble the builder’s exact context.",
        "Launch the contributor’s local Claude Code.",
        "Enforce which files may change.",
        "Run the deterministic checks.",
        "Send the result for independent review.",
        "Qualify it.",
        "Only then: the wOS GitHub App opens the PR.",
      ] },
      { type: "p", text: "Contributors never push. Their machine produces a signed submission: the changes against the base commit, the context manifest hash and the check output. It is uploaded to the control plane." },
    ],
  },
  {
    id: "review",
    title: "Independent review",
    blocks: [
      { type: "list", items: [
        "You never review your own work.",
        "Fable review and Astra review are each a leased review task, assigned to eligible contributors other than the author, ideally two different people.",
        "Both reviews are bound to the exact diff they reviewed, by its hash.",
        "Checks are re-run in GitHub Actions on the PR. A contributor’s local “tests passed” is never trusted alone.",
      ] },
      { type: "note", text: "Not settled yet: at launch there are too few contributors to review each other. A bootstrap mode is being specified: who may review while the pool is small, how that is labelled in public, and when it switches off." },
    ],
  },
  {
    id: "gated-pr",
    title: "The gated PR",
    blocks: [
      { type: "p", text: "Nobody opens a pull request by hand. Only the wOS GitHub App opens PRs, and only after the work qualifies. The same gate applies to Roadmap and Feature Contract PRs: only the App adds commits to them." },
      { type: "p", text: "Qualification is checked by machine, recorded, and listed in the PR body:" },
      { type: "steps", items: [
        "A valid, unexpired lease held by that account.",
        "A linked GitHub account.",
        "The base commit matches the lease.",
        "Only allowed paths are touched. CI workflows, symlinks and generated files are rejected; lockfiles unless allowed.",
        "The context manifest matches the one issued.",
        "Model and reasoning effort are attested as the Agent Policy requires.",
        "Astra and Fable reviews both pass, done by other contributors, bound to the same diff hash.",
        "CI re-verification passes.",
      ] },
      { type: "diagram", label: "Gated PR: submission, qualification, then the wOS GitHub App opens the PR", lines: [
        "CONTRIBUTOR MACHINE",
        "   | signed submission",
        "   v",
        "CONTROL PLANE",
        "   | qualification checks",
        "   v",
        "wOS GITHUB APP",
        "   | branch wos/<unit-id>",
        "   v",
        "PULL REQUEST",
        "   | checks: wos/qualified + CI",
        "   v",
        "MERGE",
      ] },
      { type: "list", items: [
        "The PR author is the App. The contributor is credited with a Co-authored-by trailer for their linked GitHub account, and in the provenance record.",
        "Nobody pushes to main. Required checks include wos/qualified, which only the App can set, and CI verification.",
        "Who merges is a founder decision, not settled yet.",
      ] },
    ],
  },
  {
    id: "merge",
    title: "On merge",
    blocks: [
      { type: "steps", items: [
        "Provenance is recorded.",
        "Progress updates: the feature, its capability, its app.",
        "Tokens are recorded for the accepted work.",
        "The leaderboard updates.",
        "Units that depended on this one unlock.",
        "The public Sniper List updates.",
      ] },
    ],
  },
  {
    id: "blockers",
    title: "Architecture blockers",
    blocks: [
      { type: "p", text: "When a shared contract is not enough for a task, the builder does not change it quietly. It raises an architecture blocker: the contract, the reason, the evidence, the capability needed, the work affected, and a suggested fix if known." },
      { type: "p", text: "A resolution arrives as an Architecture Resolution PR. If a shared contract changes, it is versioned, the affected work is identified and its context updated, and that work is reconciled before it continues." },
    ],
  },
  {
    id: "tokens",
    title: "Tokens",
    blocks: [
      { type: "p", text: `${TOKEN_DISCLAIMER} They are not cryptocurrency. They cannot be transferred or sold. Transfer and redemption stay disabled.` },
      { type: "p", text: "Tokens are earned per person, for accepted work. The running total is your score, and the leaderboard ranks it. Opening a PR earns nothing." },
      { type: "kv", rows: [
        ["Earned for", "Accepted roadmap work, Feature Contract work, architecture resolutions, implementation, reviews and security work."],
        ["Pools", "Completion pools pay out when a feature, or a whole app, reaches 100%."],
        ["Shared features", "A unit is paid once, not once per app that uses it."],
        ["Ledger", "One append-only ledger, one unit. Balances are derived, never edited."],
      ] },
    ],
  },
  {
    id: "accounts",
    title: "Accounts and sign-in",
    blocks: [
      { type: "p", text: SIGN_IN },
      { type: "list", items: [
        "An account is created from a verified email address.",
        "A GitHub account is linked later. It is required before any lease, review, proposal or resolution, anything that produces a commit, PR or review.",
        "Tokens and the leaderboard belong to the account, not the GitHub login. Provenance still records which GitHub identity authored each commit.",
      ] },
    ],
  },
  {
    id: "models",
    title: "Models and subscriptions",
    blocks: [
      { type: "p", text: "wOS holds no model API keys. The models run on the contributor’s machine, through the tools they already use:" },
      { type: "kv", rows: [
        ["Fable and Opus", "Through Claude Code, signed in with the contributor’s Claude subscription."],
        ["Astra", "Through the Codex CLI, signed in with the contributor’s ChatGPT account."],
      ] },
      { type: "p", text: "wOS starts these tools as local processes. It never reads, stores or passes on the contributor’s model credentials." },
      { type: "p", text: "Because of that, the server cannot prove which model ran. Model identity is recorded as an attestation, and review by other contributors keeps it honest." },
    ],
  },
  {
    id: "status",
    title: "Status today",
    blocks: [
      { type: "kv", rows: [
        ["Architecture", "Phase 0 in progress. Nothing merged."],
        ["Public website", "This site. Static v0, data from a file."],
        ["Everything else", "Not started."],
        ["All targets", "Mapped 0%, specified 0%, built 0%."],
        ["Contributors", "0."],
      ] },
      { type: "p", text: "warOnSaaS is its own first target, TGT-00. Its proposed feature list is on its dossier page." },
    ],
  },
];

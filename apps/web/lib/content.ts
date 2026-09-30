/**
 * Site copy used on more than one page, and in /llms-full.txt.
 * Short, blunt sentences. No marketing phrases, no superlatives.
 * Jargon lives only in `detail` fields, which render as small print.
 */

import { SIGN_IN, TOKEN_DISCLAIMER } from "./site";

export const OBJECTIVE =
  "Build one open-source suite that replaces the biggest rented business software: one account, one navigation, one data model, one web app and one phone app for iPhone and Android. One feature at a time. Built by AI coding agents that contributors run on their own subscriptions. Self-hostable.";

/** D14: one suite, not an app per product. */
export const SUITE = {
  summary:
    "The replacements are modules of ONE open-source suite: one account, one navigation, one data model, one web app and one phone app (iPhone and Android). A workspace turns modules on or off.",
  profile:
    "Each target on the Sniper List is a parity profile: the definition of what the suite must do to fully replace that product. It is not a separate app or codebase.",
  parity:
    "Parity means features AND experience, on every surface the product ships: the web app in current browsers, iPhone and Android. It never means copying their look. The suite has its own design.",
  repos:
    "The wOS platform lives in the waronsaas/wos repository. The suite's code lives in waronsaas/product.",
};

export const PROGRESS_METRICS = [
  { key: "mapped", label: "Mapped", means: "Share of the product written down on the public roadmap." },
  { key: "specified", label: "Specified", means: "Share with an agreed, reviewed Feature Contract." },
  { key: "built", label: "Built", means: "Share built, checked and merged." },
] as const;

export type Step = { title: string; summary: string; detail: string };

export const STEPS: Step[] = [
  {
    title: "One roadmap per target",
    summary:
      "Each target gets one public roadmap, e.g. “Zoom Replacement Roadmap”. It maps what the suite must do to fully replace that product, on web, iPhone and Android. Anyone can propose changes to it. Nobody starts a competing one.",
    detail: "The roadmap is a single canonical GitHub pull request. Changes are proposed against it. Forks of the roadmap are not used.",
  },
  {
    title: "Two reviewers must agree",
    summary:
      "Two AI models from two labs review the roadmap: Fable (Claude, by Anthropic) and Astra (ChatGPT, by OpenAI). Each tries to prove it incomplete. Neither sees the other’s answer. Revisions continue until both report no material gaps. That is roadmap consensus.",
    detail: "Both reviewers run at maximum reasoning effort and review independently. A round closes only when both return “no material gaps”.",
  },
  {
    title: "Each feature gets a contract",
    summary: "Each feature on the roadmap gets a Feature Contract: what the feature must do. It is reviewed the same way.",
    detail: "Feature Contracts go through the same independent two-model review loop as the roadmap.",
  },
  {
    title: "Contracts are cut into small tasks",
    summary:
      "A contract is broken into Atomic Build Units: tasks small enough for one AI agent. A dependency map lets independent tasks be built at the same time without touching the same files.",
    detail: "Units form a dependency graph. Independent units never share files, so they can be built in parallel.",
  },
  {
    title: "A contributor presses BUILD",
    summary:
      "Open wOS Desktop or the wOS CLI. Pick a target, a feature and a task. Press BUILD. wOS reserves the task, prepares a clean copy of the code, gives your Claude Code the exact instructions, limits which files it may change, and runs the tests.",
    detail:
      "wOS leases the unit to you, creates an isolated git worktree, hands your local Claude Code a context manifest, enforces a file allow-list, and runs the unit’s tests. It runs on your own Claude subscription.",
  },
  {
    title: "Someone else checks the work",
    summary:
      "Fable and Astra review the work on other contributors’ machines. You never review your own work. Automated checks then run everything again. Only then does wOS open the pull request on GitHub.",
    detail: "Review runs on other contributors’ machines, never the author’s. CI reruns every check before wOS opens the GitHub PR.",
  },
  {
    title: "Merge",
    summary: "On merge, the public numbers update, dependent tasks unlock, and the contributor earns WOS tokens.",
    detail: `Merges update MAPPED, SPECIFIED and BUILT, unlock dependent units, and credit tokens. ${TOKEN_DISCLAIMER}`,
  },
];

/** Rules of engagement. */
export const ROE: string[] = [
  "No fake data. Every number shown is real. Today every number is zero.",
  "One roadmap per target. No competing roadmaps.",
  "Nothing proceeds until both reviewers, from two different labs, agree.",
  "You never review your own work.",
  "CI reruns every check before a pull request is opened.",
  "Opening a pull request earns nothing. Only accepted work earns tokens.",
  `${TOKEN_DISCLAIMER} They are not cryptocurrency. They cannot be transferred or sold.`,
];

export const TOKENS = {
  intro: "WOS tokens record accepted work. They are earned per person.",
  earnedFor: [
    { what: "Roadmaps", how: "Accepted changes to a target’s roadmap." },
    { what: "Feature Contracts", how: "Contracts that reach consensus." },
    { what: "Code", how: "Build units that are merged." },
    { what: "Reviews", how: "Reviews run for other contributors’ work." },
    { what: "Security work", how: "Accepted security findings and fixes." },
    { what: "Completion bonuses", how: "When a feature, or a whole app, reaches 100%." },
  ],
  rule: "Opening a pull request earns nothing. Accepted, useful work does.",
  notCrypto: "WOS tokens are not cryptocurrency. They cannot be transferred or sold.",
  disclaimer: TOKEN_DISCLAIMER,
  balance: "Tokens issued to date: 0. No work has been accepted yet.",
};

export const ABOUT = {
  mission:
    "Businesses rent the software they run on, monthly, on the vendor’s terms. warOnSaaS builds one open-source suite that replaces the biggest of those products, so a business can own and run its own.",
  why: [
    "Rented software sets its own prices, holds your data and can change or remove features.",
    "AI coding agents can build working software when given a precise plan and strict checks.",
    "Many people already pay for an AI subscription. Pointed at one shared plan, that capacity can build large products.",
  ],
  how: "Work is public and goes one feature at a time. Two independent AI reviewers from two labs must agree on every plan before it is built. Every change is checked by someone other than its author.",
  selfHost: "The suite will be self-hostable: you deploy it with the modules you enable. Hosted status is shown per target.",
  zero: "Nothing has started. No roadmap is open. Nothing is built. There are no contributors. Every number on this site is real, and every number is zero.",
};

export type Faq = { q: string; a: string };

export const FAQ: Faq[] = [
  {
    q: "What is warOnSaaS?",
    a: "An open-source project building one suite that replaces rented business software. First ten targets: Salesforce, HubSpot, Slack, Zoom, Shopify, QuickBooks, Jira, Zendesk, DocuSign, NetSuite. Work is done one feature at a time by AI coding agents that contributors run on their own subscriptions.",
  },
  {
    q: "Is there a separate app for each product?",
    a: "No. The replacements are modules of one open-source suite: one account, one navigation, one data model, one web app and one phone app for iPhone and Android. Each target is a parity profile: what the suite must do to fully replace that product.",
  },
  {
    q: "What does parity mean?",
    a: "Features and experience, on every surface the product ships: the web app in current browsers, iPhone and Android. It never means copying their look. The suite has its own design.",
  },
  {
    q: "Where is the code?",
    a: "The wOS platform is in the waronsaas/wos repository on GitHub. The suite is in waronsaas/product. Both are public.",
  },
  {
    q: "Why is everything at 0%?",
    a: "Nothing has started. No roadmap is open and nothing is built. The numbers are real.",
  },
  {
    q: "How do I sign in?",
    a: `${SIGN_IN} A GitHub account is not needed just to sign in.`,
  },
  {
    q: "Who pays for the AI?",
    a: "Contributors, through their own Claude and ChatGPT subscriptions. wOS runs the AI on your machine with your sign-in.",
  },
  {
    q: "Do I need to be a programmer?",
    a: "You do not write the code yourself. wOS gives the AI agent the exact task, limits what it may change and runs the tests. To build you need a linked GitHub account, Claude Code signed in with a Claude subscription, the Codex CLI signed in with ChatGPT, and git.",
  },
  {
    q: "How do I contribute today?",
    a: "Follow the steps on the contribute page (waronsaas.com/contribute): install the wos command, sign in, link GitHub, enable the Build app and check your machine. That is all there is to do today: no roadmap has merged yet, so there are no tasks to pick up. wOS Desktop is not released.",
  },
  {
    q: "Who are Fable and Astra?",
    a: "The two AI reviewers. Fable is Claude, by Anthropic. Astra is ChatGPT, by OpenAI. They review every roadmap, contract and piece of code independently. Both must agree.",
  },
  { q: "Can I review my own work?", a: "No. Reviews of your work run on other contributors’ machines." },
  {
    q: "What are WOS tokens?",
    a: `In-app credits earned for accepted work: roadmaps, contracts, code, reviews, security work, and bonuses when a feature or app reaches 100%. Opening a pull request earns nothing. ${TOKEN_DISCLAIMER}`,
  },
  { q: "Are WOS tokens cryptocurrency?", a: `No. They cannot be transferred or sold. ${TOKEN_DISCLAIMER}` },
  { q: "Can I host it myself?", a: "Yes, once it exists. The suite will be self-hostable: you deploy it with the modules you enable. Hosted status is shown per target." },
  {
    q: "Is warOnSaaS affiliated with the companies on the list?",
    a: "No. Product names are trademarks of their owners and are used only to say what each replacement is for.",
  },
];

/**
 * Site copy that appears on more than one page, and in /llms-full.txt.
 * Keep it plain: a non-developer should understand every headline and summary.
 * Jargon lives only in `detail` fields, which render as small print.
 */

import { TOKEN_DISCLAIMER } from "./site";

export const PROGRESS_METRICS = [
  {
    key: "mapped",
    label: "Mapped",
    means: "How much of the product is written down on the public roadmap.",
  },
  {
    key: "specified",
    label: "Specified",
    means: "How much has an agreed, reviewed plan for exactly how each feature works.",
  },
  {
    key: "built",
    label: "Built",
    means: "How much has been built, checked and merged.",
  },
] as const;

export type Step = { title: string; summary: string; detail: string };

export const STEPS: Step[] = [
  {
    title: "One public roadmap per target",
    summary:
      "Every product we replace gets one public roadmap, for example the “Zoom Replacement Roadmap”. Anyone can suggest changes to it. Nobody starts a competing roadmap, so all the effort goes into one plan.",
    detail:
      "The roadmap is a single canonical GitHub pull request. Contributors propose changes to it; forks of the roadmap are not used.",
  },
  {
    title: "Two AIs from two labs must agree",
    summary:
      "Two AI models from two different companies review the roadmap: Fable (Claude, by Anthropic) and Astra (ChatGPT, by OpenAI). Each one tries to prove the roadmap is incomplete, without seeing the other’s answer. We revise and repeat until both say there are no material gaps. That is roadmap consensus.",
    detail:
      "Both reviewers run at maximum reasoning effort and review independently. A round ends only when both return “no material gaps”.",
  },
  {
    title: "Every feature gets a contract",
    summary:
      "Each feature on the roadmap gets a Feature Contract: a precise description of what the feature must do. It is reviewed the same way, by both AIs, until they agree.",
    detail:
      "Feature Contracts go through the same independent two-model review loop as the roadmap.",
  },
  {
    title: "Contracts are cut into small tasks",
    summary:
      "A contract is broken into Atomic Build Units: tasks small enough for one AI agent to finish. A map of which tasks depend on which lets many people build at the same time without getting in each other’s way.",
    detail:
      "Units form a dependency graph. Independent units are scoped so they never touch the same files, which lets them be built in parallel.",
  },
  {
    title: "You press BUILD",
    summary:
      "Open wOS Desktop (or the wos command-line tool), pick a target, a feature and a task, and press BUILD. wOS reserves the task for you, sets up a clean copy of the code, tells the Claude Code on your computer exactly what to do, keeps it to the files it is allowed to change, and runs the tests.",
    detail:
      "wOS leases the unit to you, creates an isolated git worktree, hands your local Claude Code a context manifest for that unit, enforces a file allow-list, and runs the unit’s tests. It runs on your own Claude subscription.",
  },
  {
    title: "Someone else checks your work",
    summary:
      "Your work is reviewed by Fable and Astra running on other contributors’ computers. You never review your own work. Then automated checks run everything again. Only after that does wOS open the real pull request on GitHub.",
    detail:
      "Review runs on other contributors’ machines, never the author’s. CI then reruns every check before wOS opens the GitHub PR.",
  },
  {
    title: "Merged work moves the needle",
    summary:
      "When your work is merged, the public progress numbers go up, the tasks that were waiting on yours unlock, and you earn WOS tokens.",
    detail: `Merges update MAPPED, SPECIFIED and BUILT, unlock dependent units, and credit tokens. ${TOKEN_DISCLAIMER}`,
  },
];

export const TOKENS = {
  intro:
    "WOS tokens are how warOnSaaS keeps score. You earn them, as a person, when work you did is accepted.",
  earnedFor: [
    { what: "Roadmaps", how: "Accepted changes to a target’s roadmap." },
    { what: "Feature Contracts", how: "Accepted contracts that reach consensus." },
    { what: "Code", how: "Build units that are merged." },
    { what: "Reviews", how: "Reviews you run for other contributors’ work." },
    { what: "Security work", how: "Accepted security findings and fixes." },
    { what: "Completion bonuses", how: "Bonuses when a feature, or a whole app, reaches 100%." },
  ],
  rule: "Opening a pull request earns nothing. Accepted, useful work does.",
  notCrypto:
    "WOS tokens are not cryptocurrency. They cannot be transferred or sold.",
  disclaimer: TOKEN_DISCLAIMER,
};

export const ABOUT = {
  mission:
    "Businesses rent the software they run on. Every month, forever, and on someone else’s terms. warOnSaaS exists to build open-source replacements for the biggest of those products, so any business can own and run its own.",
  why: [
    "Rented software sets its own prices, owns your data and can change or remove features at will.",
    "AI coding agents can now build real software, but they need a precise plan and strict checks to build it well.",
    "Many people already pay for an AI subscription. Pointed at one shared plan, that capacity can build things no single company would.",
  ],
  how:
    "We work one feature at a time, in public. Every plan is agreed by two independent AI reviewers from two different labs before anything is built, and every change is checked by someone other than its author.",
  selfHost:
    "Every app will be self-hostable. Whether a hosted version is running is shown separately for each app.",
  zero:
    "The war starts at zero. No roadmap has been opened yet, nothing is built, and there are no contributors yet. Every number on this site is real, and right now every number is zero.",
};

export type Faq = { q: string; a: string };

export const FAQ: Faq[] = [
  {
    q: "What is warOnSaaS?",
    a: "An open-source project building replacements for the biggest rented business software, starting with ten targets: Salesforce, HubSpot, Slack, Zoom, Shopify, QuickBooks, Jira, Zendesk, DocuSign and NetSuite. Work happens one feature at a time, by AI coding agents that contributors run on their own subscriptions.",
  },
  {
    q: "Why is everything at 0%?",
    a: "Because nothing has started yet. No roadmap has been opened and nothing has been built. We show the real numbers, and today they are zero. The war starts at zero.",
  },
  {
    q: "Who pays for the AI?",
    a: "Contributors do, through the Claude and ChatGPT subscriptions they already have. wOS runs the AI on your own computer, using your own sign-in.",
  },
  {
    q: "Do I need to be a programmer?",
    a: "You do not need to write the code yourself. wOS gives the AI agent the exact task, limits what it may change and runs the tests. You need a GitHub account, Claude Code signed in with a Claude subscription, the Codex CLI signed in with ChatGPT, and git.",
  },
  {
    q: "Who are Fable and Astra?",
    a: "The two AI reviewers. Fable is Claude, made by Anthropic. Astra is ChatGPT, made by OpenAI. They review every roadmap, contract and piece of code independently, without seeing each other’s answer, and both must agree.",
  },
  {
    q: "Can I review my own work?",
    a: "No. Reviews of your work always run on other contributors’ computers.",
  },
  {
    q: "What are WOS tokens?",
    a: `In-app credits you earn for accepted work: roadmaps, contracts, code, reviews, security work, and bonuses when a feature or app reaches 100%. Opening a pull request earns nothing. ${TOKEN_DISCLAIMER}`,
  },
  {
    q: "Are WOS tokens cryptocurrency?",
    a: `No. They cannot be transferred or sold. ${TOKEN_DISCLAIMER}`,
  },
  {
    q: "Will I be able to host the apps myself?",
    a: "Yes. Every app will be self-hostable. Whether a hosted version is running is shown separately on each app’s page.",
  },
  {
    q: "Is warOnSaaS affiliated with the companies on the Sniper List?",
    a: "No. The product names are trademarks of their owners and are used only to describe what each replacement is for.",
  },
];

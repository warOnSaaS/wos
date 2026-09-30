/** Site-wide constants. Change links here, and only here. */

export const SITE_URL = "https://waronsaas.com";
export const SITE_NAME = "warOnSaaS";

export const TAGLINE = "Open-source replacements for the software you rent.";

export const SITE_DESCRIPTION =
  "warOnSaaS builds open-source replacements for the biggest rented business software, one feature at a time, with AI coding agents run by contributors on their own subscriptions.";

export const TOKEN_DISCLAIMER = "WOS tokens are in-app credits with no cash value.";

export const LINKS = {
  github: "https://github.com/waronsaas",
  /** The wOS platform repository (D14). */
  repo: "https://github.com/waronsaas/wos",
  releases: "https://github.com/waronsaas/wos/releases/latest",
  pullRequests: "https://github.com/waronsaas/wos/pulls",
  /** The suite's code: one web app, one phone app, feature modules (D14). */
  product: "https://github.com/waronsaas/product",
  productPullRequests: "https://github.com/waronsaas/product/pulls",
  claudeCode: "https://docs.anthropic.com/en/docs/claude-code/overview",
  codexCli: "https://github.com/openai/codex",
  git: "https://git-scm.com/downloads",
  node: "https://nodejs.org",
  githubSignup: "https://github.com/signup",
} as const;

/** wOS Desktop downloads. NOT RELEASED: there is no signed Desktop release yet, so nothing links to a download.
 *  Give each an href only when a signed desktop-v* release exists (SITE-SYNC.md rule). Windows follows macOS and Linux. */
export const DOWNLOADS: { os: string; file: string; label: string; href: string | null }[] = [
  { os: "macOS", file: "not released yet", label: "MACOS", href: null },
  { os: "Linux", file: "not released yet", label: "LINUX", href: null },
  { os: "Windows", file: "not released yet", label: "WINDOWS", href: null },
];

/** The wos command. Its install line and release state live in lib/cli-release.ts (read from GitHub at build). */
export const CLI = {
  commands: [
    { cmd: "wos login", what: "Sign in with your email. wOS mails you an 8-character code." },
    { cmd: "wos link-github", what: "Link your GitHub account. Required to contribute." },
    { cmd: "wos apps enable build", what: "Enable the Build app." },
    { cmd: "wos status", what: "Check that git, Claude Code and the Codex CLI are ready." },
    { cmd: "wos tasks", what: "List the open tasks you could take." },
    { cmd: "wos build <abu>", what: "Lease one build unit and build it with your agent." },
  ],
} as const;

/** Sign-in is by an emailed code for everyone. GitHub is required only to contribute. */
export const SIGN_IN =
  "Sign in with your email: wOS mails you an 8-character code. To contribute (build, review, propose), link a GitHub account.";

export const PREREQUISITES: { name: string; href: string | null }[] = [
  { name: "An email address, for sign-in by an emailed code", href: null },
  { name: "Node.js 22.12 or later, for the wos command", href: LINKS.node },
  { name: "A GitHub account, linked to wOS. Required only to contribute (build, review, propose)", href: LINKS.githubSignup },
  { name: "Claude Code, installed and signed in with a Claude subscription", href: LINKS.claudeCode },
  { name: "The Codex CLI, signed in with ChatGPT (used for reviews)", href: LINKS.codexCli },
  { name: "git", href: LINKS.git },
];

export const NAV = [
  { href: "/#targets", label: "TARGETS" },
  { href: "/briefing", label: "BRIEFING" },
  { href: "/whitepaper", label: "WHITE PAPER" },
  { href: "/assessments", label: "ASSESSMENTS" },
  { href: "/how-it-works", label: "PROCEDURE" },
  { href: "/tokens", label: "TOKENS" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/faq", label: "FAQ" },
  { href: "/contribute", label: "CONTRIBUTE" },
  { href: "/download", label: "DOWNLOAD" },
] as const;

/**
 * How to contribute, as told on /whitepaper (and in the white paper's section 16). The steps and the honest status live
 * on /contribute and /contribute.md (lib/contribute.ts); the CLI's release state is read from GitHub at build.
 */
export const CONTRIBUTE = {
  email: "hello@waronsaas.com",
  summary:
    "Sign-in, GitHub linking and the Build app work today with the wos command. There is no work to pick up yet: no roadmap or Feature Contract has merged, so there are no build units. wOS Desktop is not released.",
  desktop:
    "wOS Desktop with the Build app: pick a target, a feature and a build unit, and press BUILD (not released yet).",
  needs:
    "An email address, a GitHub account, and your own AI subscription: Claude Code, or the Codex CLI with ChatGPT. wOS never sees your AI credentials; you work within your own subscription's limits.",
} as const;

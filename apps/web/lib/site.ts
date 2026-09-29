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
  githubSignup: "https://github.com/signup",
} as const;

/** wOS Desktop downloads. V1 ships macOS and Linux; Windows is coming later (href null). */
export const DOWNLOADS: { os: string; file: string; label: string; href: string | null }[] = [
  { os: "macOS", file: ".dmg", label: "DOWNLOAD — MACOS", href: LINKS.releases },
  { os: "Linux", file: ".AppImage", label: "DOWNLOAD — LINUX", href: LINKS.releases },
  { os: "Windows", file: "coming later", label: "WINDOWS", href: null },
];

export const CLI = {
  packageName: "@waronsaas/cli",
  install: "npm install -g @waronsaas/cli",
  commands: [
    { cmd: "wos login", what: "Sign in with your email. A magic link is sent to you." },
    { cmd: "wos status", what: "Check that Claude Code, the Codex CLI and git are ready." },
    { cmd: "wos build <task-id>", what: "Claim a build unit and build it." },
  ],
} as const;

/** Sign-in is by email magic link for everyone. GitHub is required only to contribute. */
export const SIGN_IN =
  "Sign in with your email. To contribute (build, review, propose), link a GitHub account.";

export const PREREQUISITES: { name: string; href: string | null }[] = [
  { name: "An email address, for sign-in by magic link", href: null },
  { name: "A GitHub account, linked to wOS. Required only to contribute (build, review, propose)", href: LINKS.githubSignup },
  { name: "Claude Code, installed and signed in with a Claude subscription", href: LINKS.claudeCode },
  { name: "The Codex CLI, signed in with ChatGPT (used for reviews)", href: LINKS.codexCli },
  { name: "git", href: LINKS.git },
];

export const NAV = [
  { href: "/#targets", label: "TARGETS" },
  { href: "/briefing", label: "BRIEFING" },
  { href: "/how-it-works", label: "PROCEDURE" },
  { href: "/tokens", label: "TOKENS" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/faq", label: "FAQ" },
  { href: "/download", label: "DOWNLOAD" },
] as const;

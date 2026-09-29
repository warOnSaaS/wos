/** Site-wide constants. Change links here, and only here. */

export const SITE_URL = "https://waronsaas.com";
export const SITE_NAME = "warOnSaaS";

export const TAGLINE = "Open-source replacements for the software you rent.";

export const SITE_DESCRIPTION =
  "warOnSaaS builds open-source replacements for the biggest rented business software, one feature at a time, with AI coding agents run by contributors on their own subscriptions.";

export const TOKEN_DISCLAIMER = "WOS tokens are in-app credits with no cash value.";

export const LINKS = {
  github: "https://github.com/waronsaas",
  repo: "https://github.com/waronsaas/waronsaas",
  releases: "https://github.com/waronsaas/waronsaas/releases/latest",
  pullRequests: "https://github.com/waronsaas/waronsaas/pulls",
  claudeCode: "https://docs.anthropic.com/en/docs/claude-code/overview",
  codexCli: "https://github.com/openai/codex",
  git: "https://git-scm.com/downloads",
  githubSignup: "https://github.com/signup",
} as const;

/** wOS Desktop downloads. All three point at the latest GitHub release for now. */
export const DOWNLOADS = [
  { os: "macOS", file: ".dmg", label: "Download for macOS", href: LINKS.releases },
  { os: "Windows", file: ".exe", label: "Download for Windows", href: LINKS.releases },
  { os: "Linux", file: ".AppImage", label: "Download for Linux", href: LINKS.releases },
] as const;

export const CLI = {
  packageName: "@waronsaas/cli",
  install: "npm install -g @waronsaas/cli",
  commands: [
    { cmd: "wos login", what: "Sign in with your GitHub account." },
    { cmd: "wos status", what: "Check that Claude Code, the Codex CLI and git are ready." },
    { cmd: "wos build <task-id>", what: "Claim a build unit and start building it." },
  ],
} as const;

export const PREREQUISITES = [
  { name: "A GitHub account", href: LINKS.githubSignup },
  { name: "Claude Code, installed and signed in with a Claude subscription", href: LINKS.claudeCode },
  { name: "The Codex CLI, signed in with ChatGPT (used for reviews)", href: LINKS.codexCli },
  { name: "git", href: LINKS.git },
] as const;

export const NAV = [
  { href: "/#sniper-list", label: "Sniper List" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/tokens", label: "Tokens" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/about", label: "About" },
  { href: "/download", label: "Download" },
] as const;

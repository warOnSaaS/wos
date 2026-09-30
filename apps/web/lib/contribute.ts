/**
 * How to contribute: one source for /contribute (people), /contribute.md (agents), the llms files and the white
 * paper handoff prompt's pointer. Every command here is a real `wos` command (checked against `wos --help`).
 * The CLI's release state is read from GitHub at build (lib/cli-release.ts), never typed here.
 */
import { type CliRelease, cliReleaseLine, INSTALL } from "./cli-release";
import { LINKS } from "./site";

export const CONTRIBUTE_PATH = "/contribute";
export const CONTRIBUTE_MD_PATH = "/contribute.md";
export { CONTRIBUTE_MD_URL } from "./handoff-prompt";

/** What works in production today, and what does not. Update when either changes (SITE-SYNC.md rule). */
export const CONTRIBUTE_WORKS = [
  "Sign in by email (wos login), link GitHub (wos link-github) and enable the Build app (wos apps enable build): these work against the live wOS service.",
];
export const CONTRIBUTE_NOT_YET = [
  "wOS Desktop is not released.",
  "There is no work to pick up yet. No roadmap or Feature Contract has merged in waronsaas/product, so there are no build units. Contributing today means signing up and getting ready.",
];

export type ContributeStep = { title: string; body: string; cmds?: string[]; note?: string };

export const CONTRIBUTE_STEPS: ContributeStep[] = [
  {
    title: "Get the prerequisites",
    body: "Node.js 22.12 or later, git, a GitHub account, and your own AI subscription: Claude Code signed in with a Claude plan (builds), and/or the Codex CLI signed in with ChatGPT (reviews). wOS never sees your AI credentials.",
  },
  {
    title: "Install the wos command",
    body: "The first line is for macOS and Linux, the second for Windows (PowerShell). The script checks Node.js, verifies the download's SHA-256 checksum and installs into your own home folder (~/.local/bin on macOS and Linux). No sudo, no admin rights, no npm.",
    cmds: [INSTALL.unix, INSTALL.windows],
  },
  {
    title: "Sign in",
    body: "wOS mails you an 8-character code; type it in. The session is kept in your OS keychain.",
    cmds: ["wos login"],
  },
  {
    title: "Link GitHub",
    body: "Opens GitHub's device page with a code to enter. Required to contribute: accepted work is credited to this account.",
    cmds: ["wos link-github"],
  },
  {
    title: "Enable the Build app",
    body: "Turns on Build for your personal organization. Check with wos apps.",
    cmds: ["wos apps enable build"],
  },
  {
    title: "Check your machine",
    body: "Shows git, claude and codex readiness, sign-in and your toolchain, and lists any problem to fix.",
    cmds: ["wos status"],
  },
  {
    title: "Pick up work",
    body: "wos tasks lists the open tasks you could take; wos build leases one build unit, runs your agent on it, verifies it, submits it and waits through review until wOS opens the pull request. Today wos tasks lists none (see the status above).",
    cmds: ["wos tasks", "wos build <abu>"],
    note: "Coming, designed and not built: one work-next queue that picks your next task for you and pays a +20% queue bonus over the published base price (provisional, decision D63).",
  },
];

/** The status lines shown first, on the page and in contribute.md. */
export function contributeStatus(release: CliRelease): { works: string[]; notYet: string[] } {
  const cli = cliReleaseLine(release);
  return release.state === "released"
    ? { works: [...CONTRIBUTE_WORKS, cli], notYet: CONTRIBUTE_NOT_YET }
    : { works: CONTRIBUTE_WORKS, notYet: [cli, ...CONTRIBUTE_NOT_YET] };
}

/** /contribute.md: the same steps as plain Markdown, for an agent walking its human through them. */
export function contributeMarkdown(release: CliRelease): string {
  const s = contributeStatus(release);
  const out = [
    "# How to contribute to warOnSaaS",
    "",
    "For an AI agent helping its human take part, usually after evaluating the white paper (https://waronsaas.com/whitepaper.md). Walk them through the steps in order, one at a time; run a command only with their agreement, on their machine, and stop at the first failure. Nothing here costs money or earns money; WOS tokens are in-app credits with no cash value.",
    "",
    "## Status today",
    "",
    ...s.works.map((l) => `- Works: ${l}`),
    ...s.notYet.map((l) => `- Not yet: ${l}`),
    "",
    "## Steps",
    "",
  ];
  CONTRIBUTE_STEPS.forEach((st, i) => {
    out.push(`${i + 1}. **${st.title}.** ${st.body}`);
    if (st.cmds) out.push("", "   ```", ...st.cmds.map((c) => `   ${c}`), "   ```");
    if (st.note) out.push("", `   ${st.note}`);
    out.push("");
  });
  out.push(
    "## Commands",
    "",
    "`wos --help` lists every command; `wos help build` (or any other command) explains one. Exit codes: 0 ok, 1 failed, 2 usage, 3 not signed in or GitHub not linked.",
    "",
    "## More",
    "",
    "- How the work flows, from roadmap to merged code: https://waronsaas.com/how-it-works",
    "- Questions: https://waronsaas.com/faq",
    `- Install scripts (read them before running): https://waronsaas.com/install.sh and https://waronsaas.com/install.ps1; releases: ${LINKS.repo}/releases`,
    `- Source: ${LINKS.repo}`,
    "",
  );
  return out.join("\n");
}

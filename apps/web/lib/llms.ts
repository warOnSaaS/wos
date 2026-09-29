import { programme, roadmapState, roadmapStatus, roadmapTitle, targetStatus, targets } from "@/data/targets";
import { ABOUT, FAQ, OBJECTIVE, PROGRESS_METRICS, ROE, STEPS, TOKENS } from "./content";
import { abs } from "./seo";
import { CLI, DOWNLOADS, LINKS, PREREQUISITES, SIGN_IN, SITE_DESCRIPTION, SITE_NAME, TAGLINE } from "./site";

const pages = [
  { path: "/", title: "Home", about: "What warOnSaaS is, the Sniper List with live progress, how it works, WOS tokens, download and FAQ." },
  { path: "/how-it-works", title: "How it works", about: "The seven steps from public roadmap to merged code, and how progress is measured." },
  { path: "/download", title: "Download wOS", about: "wOS Desktop for macOS, Windows and Linux, the wos CLI, and prerequisites." },
  { path: "/tokens", title: "WOS tokens", about: "What earns WOS tokens. WOS tokens are in-app credits with no cash value." },
  { path: "/leaderboard", title: "Leaderboard", about: "Contributors ranked by accepted work. No accepted contributions yet." },
  { path: "/about", title: "About", about: "The mission." },
];

const progressLine = (t: (typeof targets)[number]) =>
  `mapped ${t.mapped}%, specified ${t.specified}%, built ${t.built}%`;

export function llmsTxt(): string {
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "Status: nothing has started. Every target is at mapped 0%, specified 0%, built 0%. No roadmap pull request has been opened, and there are no contributors yet.",
    "",
    "## Pages",
    "",
    ...pages.map((p) => `- [${p.title}](${abs(p.path)}): ${p.about}`),
    "",
    "## The Sniper List (targets, in order)",
    "",
    ...targets.map(
      (t) => `- [${t.id} Open-source ${t.name} alternative](${abs(`/targets/${t.slug}`)}): ${t.category}. ${t.whatItIs} Progress: ${progressLine(t)}. ${roadmapStatus(t)}.`,
    ),
    "",
    "## Optional",
    "",
    `- [Full site text](${abs("/llms-full.txt")}): every page's copy in one markdown file.`,
    `- [Sitemap](${abs("/sitemap.xml")})`,
    `- [GitHub](${LINKS.repo})`,
    "",
  ].join("\n");
}

export function llmsFullTxt(): string {
  const out: string[] = [];
  const push = (...l: string[]) => out.push(...l);

  push(`# ${SITE_NAME}`, "", `> ${SITE_DESCRIPTION}`, "", `${TAGLINE}`, "");
  push("This file contains the full text of every page on " + abs("/") + ".", "");

  push(`## Home (${abs("/")})`, "");
  push("### Sitrep", "");
  push(
    `- Targets: ${targets.length}`,
    `- Roadmaps open: ${targets.filter((t) => t.roadmapPr).length}`,
    `- Contributors: ${programme.contributors}`,
    `- Accepted work: ${programme.acceptedContributions}`,
    `- Tokens issued: ${programme.tokensIssued}`,
    "",
    "Nothing has started. The numbers are real. The war starts at zero.",
    "",
  );
  push("### Objective", "", OBJECTIVE, "");
  push("### Rules of engagement", "", ...ROE.map((r, i) => `R-${i + 1}. ${r}`), "");
  push("### Targets (the Sniper List)", "");
  push(
    "Each target gets its own public roadmap. Progress is three independent numbers:",
    "",
    ...PROGRESS_METRICS.map((m) => `- ${m.label.toUpperCase()} %: ${m.means}`),
    "",
  );
  push("| ID | Target | Category | Mapped | Specified | Built | Roadmap | Status |", "|---|---|---|---|---|---|---|---|");
  targets.forEach((t) => push(`| ${t.id} | ${t.name} | ${t.category} | ${t.mapped}% | ${t.specified}% | ${t.built}% | ${roadmapState(t)} | ${targetStatus(t)} |`));
  push("");

  push(`## How it works (${abs("/how-it-works")})`, "");
  STEPS.forEach((s, i) => push(`### ${i + 1}. ${s.title}`, "", s.summary, "", `Detail: ${s.detail}`, ""));
  push(
    "### Reviewers",
    "",
    "Fable: Claude, by Anthropic. Astra: ChatGPT, by OpenAI. Two models from two labs, working without seeing each other's answer, are less likely to miss the same gap. Nothing proceeds until both agree. Both run at maximum reasoning effort for every review.",
    "",
  );

  push(`## Download wOS (${abs("/download")})`, "");
  push("wOS is the build tool. Pick a target, a feature and a task. Press BUILD. Your local Claude Code does the work under wOS's checks.", "");
  push("### Sign-in", "", SIGN_IN, "No GitHub account is needed just to sign in.", "");
  push("### wOS Desktop", "", ...DOWNLOADS.map((d) => `- ${d.os} (${d.file}): ${d.href}`), "");
  push("### Command line", "", "```", CLI.install, ...CLI.commands.map((c) => `${c.cmd}    # ${c.what}`), "```", "");
  push("### Requirements", "", ...PREREQUISITES.map((p) => `- ${p.name}${p.href ? ` (${p.href})` : ""}`), "");
  push(
    "### Setup",
    "",
    `1. Install wOS: download wOS Desktop for your system, or run \`${CLI.install}\`.`,
    "2. Sign in with your email (`wos login`). A magic link is sent to you. No GitHub account is needed to sign in.",
    "3. To contribute (build, review, propose), link a GitHub account.",
    "4. Install the build tools: Claude Code signed in with a Claude subscription; the Codex CLI signed in with ChatGPT, for reviews; git. Check with `wos status`.",
    "5. Build. Desktop: pick a target, a feature and a task, press BUILD. CLI: `wos build <task-id>`. Accepted work earns WOS tokens.",
    "",
    "The AI runs on your machine with your own Claude and ChatGPT sign-ins.",
    "",
  );

  push(`## WOS tokens (${abs("/tokens")})`, "", TOKENS.intro, "", "Earned for:", "");
  TOKENS.earnedFor.forEach((e) => push(`- ${e.what}: ${e.how}`));
  push("", TOKENS.rule, "", TOKENS.notCrypto, "", TOKENS.disclaimer, "");
  push(TOKENS.balance, "");

  push(`## Leaderboard (${abs("/leaderboard")})`, "", "Contributors are ranked by WOS tokens earned for accepted work.", "", "No accepted contributions yet.", "");

  push(`## About (${abs("/about")})`, "", ABOUT.mission, "", "### Reasons", "", ...ABOUT.why.map((w) => `- ${w}`), "");
  push("### Method", "", ABOUT.how, "", ABOUT.selfHost, "", "### Position", "", ABOUT.zero, "");

  push("## Targets", "");
  targets.forEach((t, i) => {
    push(`### ${t.id} Open-source ${t.name} alternative (${abs(`/targets/${t.slug}`)})`, "");
    push(`Target ${i + 1} of ${targets.length}. Designation: ${t.name}. Category: ${t.category}. Status: ${targetStatus(t)}. ${t.whatItIs}`, "");
    push(`- Mapped: ${t.mapped}%`, `- Specified: ${t.specified}%`, `- Built: ${t.built}%`);
    push(`- Roadmap: ${t.roadmapPr ?? roadmapStatus(t)} (the canonical PR will be titled "${roadmapTitle(t)}")`);
    push(`- Self-hosted: ${t.selfHosted ? "available" : "not available yet"}`, `- Hosted: ${t.hosted ? "running" : "not running yet"}`, "- Contributors: none yet", "");
    push("Scope (provisional outline; the public roadmap sets the exact scope; not a feature commitment):", "", ...t.replacementCovers.map((c) => `- ${c}`), "");
    push("To contribute: propose changes to the one canonical roadmap pull request (do not start a separate one). Fable and Astra review it independently until both report no material gaps. Once features have agreed contracts, download wOS, pick this target, a feature and a task, and press BUILD. Contributing requires a linked GitHub account.", "");
  });

  push("## FAQ", "");
  FAQ.forEach((f) => push(`### ${f.q}`, "", f.a, ""));

  push("## Legal", "", TOKENS.disclaimer + " They are not cryptocurrency and cannot be transferred or sold.", "", "Product names on this site are trademarks of their respective owners. warOnSaaS is not affiliated with, endorsed by or sponsored by any of them.", "");
  return out.join("\n");
}

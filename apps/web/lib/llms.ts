import { roadmapStatus, roadmapTitle, targets } from "@/data/targets";
import { ABOUT, FAQ, PROGRESS_METRICS, STEPS, TOKENS } from "./content";
import { abs } from "./seo";
import { CLI, DOWNLOADS, LINKS, PREREQUISITES, SITE_DESCRIPTION, SITE_NAME, TAGLINE } from "./site";

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
      (t) => `- [Open-source ${t.name} alternative](${abs(`/targets/${t.slug}`)}): ${t.whatItIs} Progress: ${progressLine(t)}. ${roadmapStatus(t)}.`,
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
  push("0% built so far, across all ten targets. The war starts at zero.", "");
  push("### The Sniper List", "");
  push(
    "Each target gets its own public roadmap. Progress is three independent numbers:",
    "",
    ...PROGRESS_METRICS.map((m) => `- ${m.label.toUpperCase()} %: ${m.means}`),
    "",
  );
  targets.forEach((t, i) => push(`${i + 1}. ${t.name}: ${t.whatItIs} (${progressLine(t)}; ${roadmapStatus(t)})`));
  push("");

  push(`## How it works (${abs("/how-it-works")})`, "");
  STEPS.forEach((s, i) => push(`### ${i + 1}. ${s.title}`, "", s.summary, "", `Detail: ${s.detail}`, ""));
  push(
    "### Why two AIs?",
    "",
    "One AI can miss what it does not know. Two models from two different labs, trained differently and working without seeing each other's answer, are much less likely to miss the same thing. Nothing moves forward until both agree. Fable is Claude, made by Anthropic. Astra is ChatGPT, made by OpenAI. Both run at maximum reasoning effort for every review.",
    "",
  );

  push(`## Download wOS (${abs("/download")})`, "");
  push("wOS is the app you build with. Pick a target, a feature and a task, press BUILD, and the Claude Code on your computer does the work under wOS's checks.", "");
  push("### wOS Desktop", "", ...DOWNLOADS.map((d) => `- ${d.os} (${d.file}): ${d.href}`), "");
  push("### Command line", "", "```", CLI.install, ...CLI.commands.map((c) => `${c.cmd}    # ${c.what}`), "```", "");
  push("### Prerequisites", "", ...PREREQUISITES.map((p) => `- ${p.name} (${p.href})`), "");
  push("wOS uses your own Claude and ChatGPT subscriptions; the AI runs on your computer with your sign-in.", "");

  push(`## WOS tokens (${abs("/tokens")})`, "", TOKENS.intro, "", "Earned for:", "");
  TOKENS.earnedFor.forEach((e) => push(`- ${e.what}: ${e.how}`));
  push("", TOKENS.rule, "", TOKENS.notCrypto, "", TOKENS.disclaimer, "");
  push("No tokens have been earned yet, because no work has been accepted yet.", "");

  push(`## Leaderboard (${abs("/leaderboard")})`, "", "Contributors are ranked by the WOS tokens they earn for accepted work.", "", "No accepted contributions yet.", "");

  push(`## About (${abs("/about")})`, "", ABOUT.mission, "", "### Why now", "", ...ABOUT.why.map((w) => `- ${w}`), "");
  push("### How we work", "", ABOUT.how, "", ABOUT.selfHost, "", "### Where we are", "", ABOUT.zero, "");

  push("## Targets", "");
  targets.forEach((t, i) => {
    push(`### Open-source ${t.name} alternative (${abs(`/targets/${t.slug}`)})`, "");
    push(`Target ${i + 1} of ${targets.length}. ${t.name}: ${t.whatItIs}`, "");
    push(`- Mapped: ${t.mapped}%`, `- Specified: ${t.specified}%`, `- Built: ${t.built}%`);
    push(`- Roadmap: ${t.roadmapPr ?? roadmapStatus(t)} (the canonical PR will be titled "${roadmapTitle(t)}")`);
    push(`- Self-hosted: ${t.selfHosted ? "available" : "not available yet"}`, `- Hosted: ${t.hosted ? "running" : "not running yet"}`, "- Contributors: none yet", "");
    push("In broad strokes, the replacement will cover:", "", ...t.replacementCovers.map((c) => `- ${c}`), "");
    push("The public roadmap decides the exact scope. To contribute: propose changes to the one canonical roadmap pull request (do not start a separate roadmap); Fable and Astra review it independently until both find no material gaps; once features have agreed contracts, download wOS, pick this target, a feature and a task, and press BUILD.", "");
  });

  push("## FAQ", "");
  FAQ.forEach((f) => push(`### ${f.q}`, "", f.a, ""));

  push("## Legal", "", TOKENS.disclaimer + " They are not cryptocurrency and cannot be transferred or sold.", "", "Product names on this site are trademarks of their respective owners. warOnSaaS is not affiliated with, endorsed by or sponsored by any of them.", "");
  return out.join("\n");
}

import type { TargetDetail, TargetSummary } from "@contracts/domain";
import { BRIEFING, BRIEFING_INTRO, type Block } from "./briefing";
import { WOS_PROPOSAL_LABEL, WOS_ZERO_REASON, wosTarget } from "@/data/wos-roadmap";
import { formatPercent, getTarget, listTargets, ROADMAP_SOURCE, SURFACE_LABEL, siteFields, suiteSurfaceProgress } from "./data-source";
import { programme, roadmapState, roadmapStatus, roadmapTitle, targetStatus, targets } from "@/data/targets";
import { ABOUT, FAQ, OBJECTIVE, PROGRESS_METRICS, ROE, STEPS, SUITE, TOKENS } from "./content";
import { abs } from "./seo";
import { CLI, DOWNLOADS, LINKS, PREREQUISITES, SIGN_IN, SITE_DESCRIPTION, SITE_NAME, TAGLINE } from "./site";

const pages = [
  { path: "/", title: "Home", about: "What warOnSaaS is, the Sniper List with live progress, how it works, WOS tokens, download and FAQ." },
  { path: "/briefing", title: "Briefing", about: "The whole idea and how every part works: PR types, Feature Catalog, progress, leases, review, gated PRs, tokens, sign-in, models." },
  { path: "/targets/waronsaas", title: "TGT-00 warOnSaaS builds itself", about: "The proposed wOS V1 feature list in roadmap format, with honest status." },
  { path: "/how-it-works", title: "How it works", about: "The seven steps from public roadmap to merged code, and how progress is measured." },
  { path: "/download", title: "Download wOS", about: "wOS Desktop for macOS and Linux (Windows coming later), the wOS CLI, and prerequisites." },
  { path: "/tokens", title: "WOS tokens", about: "What earns WOS tokens. WOS tokens are in-app credits with no cash value." },
  { path: "/leaderboard", title: "Leaderboard", about: "Contributors ranked by accepted work. No accepted contributions yet." },
  { path: "/faq", title: "FAQ", about: "Short answers to common questions." },
  { path: "/log", title: "Build log", about: "What landed on main, generated from the git history and the wave reports." },
  { path: "/about", title: "About", about: "The mission." },
];

/** Progress line for a target, from the data source (formatPercent of basis points). */
type Data = { list: TargetSummary[]; details: Map<string, TargetDetail> };

/** Everything the llms files need from the API, fetched once per render. */
async function load(): Promise<Data> {
  const list = await listTargets();
  const details = new Map<string, TargetDetail>();
  for (const t of list) {
    const d = await getTarget(t.slug);
    if (d) details.set(t.slug, d.data);
  }
  return { list, details };
}

let data: Data;

const progressLine = (slug: string) => {
  const p = data.list.find((x) => x.slug === slug)!.progress;
  return `mapped ${formatPercent(p.mappedBp)}, specified ${formatPercent(p.specifiedBp)}, built ${formatPercent(p.builtBp)}`;
};

export async function llmsTxt(): Promise<string> {
  data = await load();
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
    `- [${wosTarget.id} warOnSaaS (wOS)](${abs("/targets/waronsaas")}): warOnSaaS is its own first target. ${WOS_PROPOSAL_LABEL}. Progress: ${progressLine(wosTarget.slug)}.`,
    ...targets.map(
      (t) => `- [${t.id} Open-source ${t.name} alternative](${abs(`/targets/${t.slug}`)}): ${t.category}. ${t.whatItIs} Progress: ${progressLine(t.slug)}. ${roadmapStatus(t)}.`,
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

export async function llmsFullTxt(): Promise<string> {
  data = await load();
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
  push("### One suite", "", SUITE.summary, "", SUITE.profile, "", SUITE.parity, "", SUITE.repos, "");
  push("### The Sniper List", "");
  push(
    "Each target gets its own public roadmap. Progress is three independent numbers:",
    "",
    ...PROGRESS_METRICS.map((m) => `- ${m.label.toUpperCase()} %: ${m.means}`),
    "",
  );
  push("| ID | Target | Category | Mapped | Specified | Built | Roadmap | Status |", "|---|---|---|---|---|---|---|---|");
  data.list.forEach((t) => {
    const site = siteFields(t.slug)!;
    const p = t.progress;
    push(`| ${site.id} | ${site.name} | ${site.category} | ${formatPercent(p.mappedBp)} | ${formatPercent(p.specifiedBp)} | ${formatPercent(p.builtBp)} | ${roadmapState(site)} | ${targetStatus(site)} |`);
  });
  push("");

  push("", "### Procedure (summary)", "", "1. Each target gets one public roadmap. Two AI reviewers from two labs must both find no gaps.", "2. Each feature gets a contract, cut into tasks small enough for one AI agent.", "3. A contributor presses BUILD. Someone else reviews it. Only then does wOS open the PR.", "");
  push(`## How it works (${abs("/how-it-works")})`, "");
  STEPS.forEach((s, i) => push(`### ${i + 1}. ${s.title}`, "", s.summary, "", `Detail: ${s.detail}`, ""));
  push(
    "### Reviewers",
    "",
    "Fable: Claude, by Anthropic. Astra: ChatGPT, by OpenAI. Two models from two labs, working without seeing each other's answer, are less likely to miss the same gap. Nothing proceeds until both agree. Both run at maximum reasoning effort for every review.",
    "",
  );

  push("### Rules of engagement", "", ...ROE.map((r, i) => `R-${i + 1}. ${r}`), "");
  push(`## Briefing (${abs("/briefing")})`, "", BRIEFING_INTRO, "");
  BRIEFING.forEach((sec, i) => {
    push(`### ${String(i + 1).padStart(2, "0")}. ${sec.title}`, "");
    sec.blocks.forEach((b) => push(...blockMd(b), ""));
  });
  push(`## TGT-00 warOnSaaS builds itself (${abs("/targets/waronsaas")})`, "");
  push("warOnSaaS is its own first target. wOS is built with the same process it runs for every other target. Repository: waronsaas/wos.", "");
  push(`- Status: ${targetStatus(wosTarget)}`, `- Roadmap: ${WOS_PROPOSAL_LABEL}`, `- Progress: ${progressLine(wosTarget.slug)}`, `- Why 0%: ${WOS_ZERO_REASON}`, "");
  push("State of work: contracts, database schema and protocols are written. Wave 1 (control plane, GitHub integration, context and policy, verification) passes its tests locally; not deployed, not on GitHub yet. Wave 2 is in progress (planning, rewards, orchestrator, CLI, Desktop, this website). None of it counts toward the measures until the roadmap merges and work goes through wOS.", "");
  const wos = data.details.get(wosTarget.slug)!;
  push(`### Roadmap (${WOS_PROPOSAL_LABEL}; source ${ROADMAP_SOURCE.path})`, "");
  push("Surfaces: " + wos.surfaces.map((s) => `${SURFACE_LABEL[s.surface]} (${s.status === "in_scope" ? "in scope" : "excluded"}, ${s.repo ?? "no repo"})`).join("; ") + ".", "");
  wos.capabilities.forEach((c) => {
    push(`#### ${c.title} (weight ${c.weightBp} bp)`, "", c.summary, "", `Weight rationale: ${c.weightRationale}`, "");
    c.features.forEach((f) => push(`- ${f.title} (${f.weightBp} bp of the capability, ${f.effectiveAppWeightBp} bp of wOS): ${f.summary}`));
    push("");
  });
  push(`Drilldown with every rationale, surface weight, journey and requirement: ${abs("/drilldown/waronsaas")}`, "");
  push(`## Download wOS (${abs("/download")})`, "");
  push("wOS is the build tool. Pick a target, a feature and a task. Press BUILD. Your local Claude Code does the work under wOS's checks.", "");
  push("### Sign-in", "", SIGN_IN, "No GitHub account is needed just to sign in.", "");
  push("### wOS Desktop", "", ...DOWNLOADS.map((d) => (d.href ? `- ${d.os} (${d.file}): ${d.href}` : `- ${d.os}: ${d.file}`)), "");
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
    const p = data.details.get(t.slug)!;
    push(`- Progress: ${progressLine(t.slug)}`);
    push(`- Progress per surface: ${suiteSurfaceProgress(p).map((s) => `${SURFACE_LABEL[s.surface]} specified ${formatPercent(s.specifiedBp)}, built ${formatPercent(s.builtBp)}`).join("; ")}`);
    push(`- Roadmap: ${t.roadmapPr ?? roadmapStatus(t)} (the canonical PR will be titled "${roadmapTitle(t)}", in waronsaas/product)`);
    push(`- Self-hosted: ${t.selfHosted ? "available" : "not available yet"}`, `- Hosted: ${t.hosted ? "running" : "not running yet"}`, "- Contributors: none yet", "");
    push(`Parity profile: what the suite must do to fully replace ${t.name} (provisional outline; the public roadmap sets the exact profile; not a feature commitment):`, "", ...t.replacementCovers.map((c) => `- ${c}`), "", SUITE.parity, "");
    push("To contribute: propose changes to the one canonical roadmap pull request (do not start a separate one). Fable and Astra review it independently until both report no material gaps. Once features have agreed contracts, download wOS, pick this target, a feature and a task, and press BUILD. Contributing requires a linked GitHub account.", "");
  });

  push(`## FAQ (${abs("/faq")})`, "");
  FAQ.forEach((f) => push(`### ${f.q}`, "", f.a, ""));

  push("## Legal", "", TOKENS.disclaimer + " They are not cryptocurrency and cannot be transferred or sold.", "", "Product names on this site are trademarks of their respective owners. warOnSaaS is not affiliated with, endorsed by or sponsored by any of them.", "");
  return out.join("\n");
}

function blockMd(b: Block): string[] {
  switch (b.type) {
    case "p":
    case "note":
      return [b.text];
    case "list":
      return b.items.map((i) => `- ${i}`);
    case "steps":
      return b.items.map((i, n) => `${n + 1}. ${i}`);
    case "kv":
      return b.rows.map(([k, v]) => `- ${k}: ${v}`);
    case "diagram":
      return [`Diagram: ${b.label}.`, "", "```", ...b.lines, "```"];
  }
}

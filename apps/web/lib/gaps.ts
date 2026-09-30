/**
 * The gap register: what warOnSaaS's own self-assessments found missing or wrong in the white paper, version by
 * version, and what became of each gap.
 *
 * Source: generated/gap-register.json, written by scripts/sync-shared.mjs with buildGapRegister
 * (scripts/wp-history-lib.mts) from docs/assessments/*.json and the changelogs of WHITEPAPER.md and APPENDICES.md.
 * Rendered at /assessments/gaps and /assessments/gaps.md. Nothing here types or matches a gap by hand.
 */
import data from "@/generated/gap-register.json";
import type { GapRegister, RegisterGap } from "@/scripts/wp-history-lib.mts";
import { REPORT_BASE_URL } from "./assessments";

export const GAP_REGISTER = data as GapRegister;
export const GAPS_PATH = "/assessments/gaps";
export const GAPS_MD_PATH = "/assessments/gaps.md";

export const gapReportUrl = (g: RegisterGap) => REPORT_BASE_URL + g.reportFile;

export function statusText(g: RegisterGap): string {
  if (g.status === "addressed") return `addressed in v${g.statusIn}`;
  if (g.status === "declined") return `declined in v${g.statusIn}${g.reason ? `: ${g.reason}` : " (no reason given)"}`;
  return "open";
}

export const MATCHING_RULE =
  "Gaps are matched across runs and to the changelog by their exact id (the slug the agent gave it), nothing else. Two runs that describe the same problem with different ids count as two gaps; no fuzzy or model-based matching is done, so the register never merges or closes a gap by guesswork.";

export const CONVENTION =
  "A version's changelog entry may cite gap ids, one line each: \"Gaps addressed: `id`, `id`\" or \"Gap declined: `id`: the reason\". A gap from version N is addressed or declined by the newest later version whose entry cites its id; otherwise it is open.";

/** The register as plain Markdown (/assessments/gaps.md). Gaps only, no scores. */
export function gapsMarkdown(site: (p: string) => string): string {
  const R = GAP_REGISTER;
  const L: string[] = [];
  L.push("# warOnSaaS white paper: the gap register", "");
  L.push(
    "**If you are evaluating the white paper: read this only after you have written your own `wos-assessment` score block,** like the recorded trend. It lists what warOnSaaS's own reference runs found missing or wrong, per paper version.",
    "",
    `Generated at build from docs/assessments/ (the latest run of each version that lists gaps; schema wos-assessment/v2, paper v0.9 onwards) and the paper's changelog. Current paper version: v${R.current}. Scores: ${site("/whitepaper/assessments.md")}.`,
    "",
    `Matching: ${MATCHING_RULE}`,
    "",
    `Convention: ${CONVENTION}`,
    "",
  );
  if (!R.gaps.length) {
    L.push("## Gaps", "", "No gaps recorded yet: no recorded run lists gaps (runs before paper v0.9 used a score block without them).", "");
    return L.join("\n");
  }
  L.push(`## Gaps, newest version first (${R.gaps.length})`, "");
  L.push("| Id | Title | Concerns | Part | Severity | Found in | Status | Also reported in | Report |", "|---|---|---|---|---|---|---|---|---|");
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const g of R.gaps) {
    L.push(
      `| \`${g.id}\` | ${cell(g.title)} | ${cell(g.concerns)} | ${g.part} | ${g.severity} | v${g.version} | ${cell(statusText(g))} | ${g.alsoReportedIn.length ? g.alsoReportedIn.map((v) => `v${v}`).join(", ") : "-"} | ${gapReportUrl(g)} |`,
    );
  }
  if (R.unknownCitations.length) {
    L.push("", "## Changelog citations that match no recorded gap", "");
    for (const c of R.unknownCitations) L.push(`- v${c.version}: ${c.kind} \`${c.id}\``);
  }
  L.push("");
  return L.join("\n");
}

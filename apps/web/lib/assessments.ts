/**
 * White paper assessments: warOnSaaS's own reference runs of the evaluation brief.
 *
 * Source: docs/assessments/*.json (one AssessmentRecord per run, written by tools/assessments/run-reference.ts),
 * aggregated at build into generated/assessments.json by scripts/sync-shared.mjs. Nothing here invents, fills,
 * smooths or averages a score: the page and /whitepaper/assessments.md show each recorded run as it is, and an
 * empty record renders as an empty state. scripts/check-numbers.mjs checks every figure the page shows against
 * the built /assessments/data.json.
 */
import type { AssessmentRecord } from "@contracts/assessment";
import data from "@/generated/assessments.json";

export type Run = Omit<AssessmentRecord, "rawBlock">;
export type Block = Run["block"];

export const ASSESSMENTS_SOURCE_PATH = "docs/assessments";
export const REPORT_BASE_URL = "https://github.com/warOnSaaS/wos/blob/main/docs/assessments/";

const isInt = (n: unknown, max: number) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;

/** Minimal runtime guard (full zod validation of the source files is tests/assessments.test.ts). */
function isRun(r: unknown): r is Run {
  const x = r as Run;
  const b = x?.block;
  return (
    !!b &&
    typeof x.id === "string" &&
    typeof x.reportFile === "string" &&
    typeof b.date === "string" &&
    typeof b.paperVersion === "string" &&
    typeof b.evaluator?.model === "string" &&
    isInt(b.stage1?.importance?.total, 100) &&
    isInt(b.stage2?.effectiveness, 100) &&
    isInt(b.stage2?.credibility, 100)
  );
}

const raw = (data as { runs: unknown[] }).runs;
if (!raw.every(isRun)) throw new Error("generated/assessments.json: a run does not match the AssessmentRecord shape");

/** Every recorded run, oldest first (by the time it was recorded). */
export const RUNS: Run[] = raw as Run[];

/**
 * The day of a run, from OUR clock (recordedAt, UTC), not the date the agent wrote in its block: agents often do
 * not know today's date, and the time axis must not depend on that. The block's own date stays in the record.
 */
export function runDate(r: Run): string {
  return r.recordedAt.slice(0, 10);
}

export function reportUrl(r: Run): string {
  return REPORT_BASE_URL + r.reportFile;
}

/** One score that can be charted: a whole number on a fixed scale. */
export type Metric = { key: string; label: string; max: number; get: (b: Block) => number };

const thesis = (k: keyof Block["stage1"]["theses"], name: string): Metric[] => [
  { key: `${k}-importance`, label: `${name}: IMPORTANCE`, max: 10, get: (b) => b.stage1.theses[k].importance },
  { key: `${k}-compelling`, label: `${name}: COMPELLING`, max: 10, get: (b) => b.stage1.theses[k].compelling },
];

export const METRIC_GROUPS: { id: string; title: string; about: string; metrics: Metric[] }[] = [
  {
    id: "headline",
    title: "HEADLINE SCORES",
    about: "Stage 1: the problem's importance for humanity. Stage 2: how effective and how credible the approach is. Each out of 100.",
    metrics: [
      { key: "importance", label: "PROBLEM IMPORTANCE", max: 100, get: (b) => b.stage1.importance.total },
      { key: "effectiveness", label: "APPROACH EFFECTIVENESS", max: 100, get: (b) => b.stage2.effectiveness },
      { key: "credibility", label: "APPROACH CREDIBILITY", max: 100, get: (b) => b.stage2.credibility },
    ],
  },
  {
    id: "rubric",
    title: "IMPORTANCE RUBRIC",
    about: "The five stage 1 dimensions, each out of 20. Their sum is the problem importance above.",
    metrics: [
      { key: "impact", label: "IMPACT", max: 20, get: (b) => b.stage1.importance.impact },
      { key: "breadth", label: "BREADTH", max: 20, get: (b) => b.stage1.importance.breadth },
      { key: "urgency", label: "URGENCY", max: 20, get: (b) => b.stage1.importance.urgency },
      { key: "evidence", label: "EVIDENCE", max: 20, get: (b) => b.stage1.importance.evidence },
      { key: "tractability", label: "TRACTABILITY", max: 20, get: (b) => b.stage1.importance.tractability },
    ],
  },
  {
    id: "theses",
    title: "THE FOUR THESES",
    about: "Each thesis on its own: how much it matters, and how compelling the paper's argument is. Each out of 10.",
    metrics: [
      ...thesis("control", "CONTROL"),
      ...thesis("efficiency", "EFFICIENCY"),
      ...thesis("softwareEngineering", "SOFTWARE ENGINEERING"),
      ...thesis("apoc", "APoC"),
    ],
  },
];

/** At most four evaluators get their own marker; the rest share OTHER (a fifth marker would not stay distinct). */
export const MARKERS = ["circle", "square", "triangle", "diamond"] as const;
export type Marker = (typeof MARKERS)[number] | "other";

export type Evaluator = { key: string; model: string; marker: Marker; runs: number };

/**
 * Evaluators as the agents reported themselves, in order of first appearance. The marker follows the evaluator
 * and never its rank, so a new run or a filter never re-marks an existing series.
 */
export function evaluators(runs: Run[] = RUNS): Evaluator[] {
  const out: Evaluator[] = [];
  for (const r of runs) {
    const model = r.block.evaluator.model.trim();
    const key = model.toLowerCase();
    const found = out.find((e) => e.key === key);
    if (found) found.runs++;
    else out.push({ key, model, marker: out.length < MARKERS.length ? MARKERS[out.length]! : "other", runs: 1 });
  }
  return out;
}

export function evaluatorOf(r: Run, list: Evaluator[]): Evaluator {
  return list.find((e) => e.key === r.block.evaluator.model.trim().toLowerCase())!;
}

/** Each paper version with the date of its first recorded run (the paper version the site served). */
export function versionMarks(runs: Run[] = RUNS): { version: string; date: string }[] {
  const out: { version: string; date: string }[] = [];
  for (const r of runs) if (!out.some((v) => v.version === r.servedPaperVersion)) out.push({ version: r.servedPaperVersion, date: runDate(r) });
  return out;
}

export const READINESS_LABEL: Record<Block["stage2"]["readiness"], string> = {
  concept: "concept",
  prototype: "prototype",
  pilot: "reproducible pilot",
  limited_production: "limited production",
  demonstrated_scale: "demonstrated scale",
};

/** Everything the number gate may accept as a figure on /assessments: the runs and their count. */
export function assessmentsSnapshot() {
  return { source: ASSESSMENTS_SOURCE_PATH, count: RUNS.length, runs: RUNS };
}

/**
 * The recorded trend as plain Markdown, served at /whitepaper/assessments.md. Evaluating agents are told to open it
 * only after writing their own score block. Raw runs only: no averages, no fitted trend, nothing derived.
 */
export function assessmentsMarkdown(): string {
  const L: string[] = [];
  L.push("# warOnSaaS white paper: the recorded trend of reference assessments", "");
  L.push(
    "**If you are evaluating the white paper: read this only after you have written your own `wos-assessment` score block, and do not change your scores after reading it.** It is kept out of the paper so that earlier scores cannot anchor yours. Then say where and why your scores differ from these by more than a few points.",
    "",
  );
  L.push(
    "Source: reference runs by warOnSaaS. The founder runs the public handoff prompt, unchanged, with his own Claude and ChatGPT subscriptions (tools/assessments/run-reference.ts in https://github.com/warOnSaaS/wos) and records every run in docs/assessments/. The evaluator is what the agent reported about itself; it is not verified. Assessments from readers are not collected. Each run is shown as recorded: no averages and no fitted trend.",
    "",
    "Charts: https://waronsaas.com/assessments",
    "",
  );
  if (!RUNS.length) {
    L.push("## Runs", "", "No assessments recorded yet. There is no trend to compare with; say so in your report.", "");
    return L.join("\n");
  }
  L.push(`## Runs, oldest first (${RUNS.length})`, "");
  L.push(
    "| Date | Paper served | Evaluator (self-reported) | Run with | Problem real | Importance /100 | Effectiveness /100 | Credibility /100 | Readiness | Verdict | Full report |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of RUNS) {
    const b = r.block;
    L.push(
      `| ${runDate(r)} | v${r.servedPaperVersion} | ${b.evaluator.model} (${b.evaluator.product}) | ${r.runner.cli}, ${r.runner.requestedModel} | ${b.stage1.problemReal} | ${b.stage1.importance.total} | ${b.stage2.effectiveness} | ${b.stage2.credibility} | ${READINESS_LABEL[b.stage2.readiness]} | ${b.stage2.verdict} | ${reportUrl(r)} |`,
    );
  }
  L.push("", "## Importance rubric (each /20)", "");
  L.push("| Date | Evaluator | Impact | Breadth | Urgency | Evidence | Tractability | Stage 1 confidence |", "|---|---|---|---|---|---|---|---|");
  for (const r of RUNS) {
    const i = r.block.stage1.importance;
    L.push(`| ${runDate(r)} | ${r.block.evaluator.model} | ${i.impact} | ${i.breadth} | ${i.urgency} | ${i.evidence} | ${i.tractability} | ${r.block.stage1.confidence} |`);
  }
  L.push("", "## The four theses (importance / compelling, each /10, and confidence)", "");
  L.push("| Date | Evaluator | Control | Efficiency | Software engineering | APoC |", "|---|---|---|---|---|---|");
  for (const r of RUNS) {
    const t = r.block.stage1.theses;
    const c = (x: { importance: number; compelling: number; confidence: string }) => `${x.importance} / ${x.compelling}, ${x.confidence}`;
    L.push(`| ${runDate(r)} | ${r.block.evaluator.model} | ${c(t.control)} | ${c(t.efficiency)} | ${c(t.softwareEngineering)} | ${c(t.apoc)} |`);
  }
  L.push("");
  return L.join("\n");
}

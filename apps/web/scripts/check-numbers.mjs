#!/usr/bin/env node
/**
 * Number gate. Runs after `next build`; exits non-zero if a data page renders a number that is not
 * in the data source.
 *
 * The data source (lib/data-source.ts: the live public API plus the TGT-00 roadmap file) is
 * snapshotted at build as /data-source.json, from the same fetches the pages used. Every
 * percentage on a data page must equal formatPercent(n) (the contracts' own function) for some
 * number n in that snapshot, and every "N bp" figure must be a number in it. Data pages: the home
 * page, every target dossier and every drilldown page. The white paper (/whitepaper) is prose and is
 * excluded explicitly; see PROSE_PAGES below.
 *
 * /assessments is a data page with its own data source: the recorded reference runs (docs/assessments, built as
 * /assessments/data.json from the same module the page renders from). See "Assessments" at the end: every figure
 * the page marks as data (<data value>, data-figure) and every "N/100", "N/20" or "N/10" score must be a number in
 * that snapshot; RUNS: N must be its count; with no runs the page must show no figure and its empty state.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const web = process.cwd();
const app = join(web, ".next", "server", "app");
const { formatPercent } = await import(pathToFileURL(join(web, "generated", "contracts-progress.ts")).href);

const snapshot = JSON.parse(readFileSync(join(app, "data-source.json.body"), "utf8"));
const numbers = new Set();
(function collect(v) {
  if (typeof v === "number") numbers.add(v);
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === "object") Object.values(v).forEach(collect);
})(snapshot);
const percents = new Set([...numbers].filter((n) => Number.isInteger(n) && n >= 0 && n <= 10000).map((n) => formatPercent(n)));

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".html")) files.push(p);
  }
})(app);
// /whitepaper is excluded on purpose, and by name: it is prose, not data. Its numbers (provisional
// policy values, simulation illustrations, worked arithmetic, test counts quoted from the repository)
// are explanations with their sources given in the text, not progress read from the data source.
// This exclusion does not relax the gate for any data page: the list below is an allowlist of data
// pages, and the assertion after it fails the build if the white paper is ever classified as one.
// The other white paper routes are prose too and are never data pages: /whitepaper/read (HTML, not under
// targets/ or drilldown/) and the companion bodies, including /whitepaper/materiality.md, whose estimates are
// labelled ranges with sources (they are .md.body files, which this gate does not scan).
const PROSE_PAGES = new Set(["whitepaper.html"]);
const dataPages = files.filter((f) => {
  const r = relative(app, f);
  if (PROSE_PAGES.has(r)) return false;
  return r === "index.html" || r.startsWith("targets/") || r.startsWith("drilldown/") || r.startsWith(`targets${"\\"}`) || r.startsWith(`drilldown${"\\"}`);
});
if (dataPages.some((f) => PROSE_PAGES.has(relative(app, f)))) throw new Error("check-numbers: a prose page was classified as a data page");

function text(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const out = [body.replace(/<[^>]+>/g, " ")];
  for (const m of body.matchAll(/\s(?:content|alt|aria-label|title)="([^"]*)"/g)) out.push(m[1]);
  return out.join("\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const errors = [];
let seen = 0;
for (const f of dataPages) {
  const t = text(readFileSync(f, "utf8"));
  for (const m of t.matchAll(/(<1|\d+)%/g)) {
    seen++;
    if (!percents.has(`${m[1]}%`)) errors.push(`${relative(web, f)}: "${m[0]}" is not formatPercent of any number in the data source`);
  }
  for (const m of t.matchAll(/(\d+)\s*bp\b/gi)) {
    seen++;
    if (!numbers.has(Number(m[1]))) errors.push(`${relative(web, f)}: "${m[0]}" is not a number in the data source`);
  }
}

// ---- Assessments: /assessments against its own snapshot (never against the progress snapshot, never skipped).
{
  const page = join(app, "assessments.html");
  const src = join(app, "assessments", "data.json.body");
  let html = null;
  let snap = null;
  try {
    html = readFileSync(page, "utf8");
    snap = JSON.parse(readFileSync(src, "utf8"));
  } catch {
    errors.push("assessments: assessments.html or assessments/data.json.body is missing from the build");
  }
  if (html && snap) {
    const nums = new Set();
    (function collect(v) {
      if (typeof v === "number") nums.add(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    })(snap.runs);
    const t = text(html);
    const figures = [
      ...[...html.matchAll(/<data value="([^"]*)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/\sdata-figure="([^"]*)"/g)].map((m) => m[1]),
    ];
    for (const f of figures) {
      seen++;
      if (!nums.has(Number(f))) errors.push(`assessments.html: figure ${f} is not a score in the recorded runs`);
    }
    for (const m of t.matchAll(/(\d+)\s*\/\s*(100|20|10)\b/g)) {
      seen++;
      if (!nums.has(Number(m[1]))) errors.push(`assessments.html: "${m[0]}" is not a score in the recorded runs`);
    }
    const runsLabel = t.match(/RUNS:\s*(\d+)/);
    if (!runsLabel || Number(runsLabel[1]) !== snap.count || snap.count !== snap.runs.length) {
      errors.push(`assessments.html: RUNS label ${runsLabel?.[1] ?? "missing"} does not equal the ${snap.runs.length} recorded runs`);
    }
    if (snap.runs.length === 0) {
      if (figures.length) errors.push("assessments.html: shows figures although no run is recorded");
      if (!t.includes("No assessments recorded yet")) errors.push("assessments.html: no runs recorded but the empty state is missing");
    }
    for (const m of t.matchAll(/(<1|\d+)%|(\d+)\s*bp\b/gi)) errors.push(`assessments.html: "${m[0]}": the record has no percentages or basis points`);
    dataPages.push(page);
  }
}

if (!dataPages.length) errors.push("No data pages found. Run next build first.");
if (errors.length) {
  console.error(`check-numbers: ${errors.length} violation(s)`);
  for (const e of errors.slice(0, 50)) console.error("  " + e);
  process.exit(1);
}
console.log(`check-numbers: OK (${seen} figures on ${dataPages.length} data pages, all from the data source)`);

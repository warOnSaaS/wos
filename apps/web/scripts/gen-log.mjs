#!/usr/bin/env node
/**
 * Build log generator (layer 2 of site sync; no agent, no prose).
 *
 * Writes generated/build-log.json from facts only:
 *   - the first-parent history of main (what landed on main, merges as one entry): sha, date, subject;
 *   - docs/architecture/WAVE-*-REPORT.md: title, the "Date YYYY-MM-DD" line, and the count of
 *     PASS / PASS (partial) / PENDING / FAIL results in the report's first table.
 *
 * Runs at the start of every build. If the checkout is shallow it tries to fetch the full history of
 * main; if that fails the file records how many commits were available (complete: false) and the
 * page says so. Without a git checkout (some CI/Vercel builds ship no .git) it makes a treeless bare
 * clone of the public repository and reads the history of the commit being built
 * (VERCEL_GIT_COMMIT_SHA, else main). If that also fails it keeps the committed file.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const web = process.cwd();
const repo = join(web, "..", "..");
const out = join(web, "generated", "build-log.json");
const REPO_URL = "https://github.com/warOnSaaS/wos";
let gitDir = repo;
const git = (...args) => execFileSync("git", args, { cwd: gitDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

let cloned = false;
if (tryGit("rev-parse", "--is-inside-work-tree") !== "true") {
  const tmp = join(tmpdir(), "wos-history.git");
  try {
    execFileSync("git", ["clone", "--quiet", "--bare", "--filter=tree:0", `${REPO_URL}.git`, tmp], { stdio: "ignore" });
    gitDir = tmp;
    cloned = true;
  } catch {
    if (existsSync(out)) {
      console.log("gen-log: no git checkout and the clone failed; keeping the committed generated/build-log.json");
      process.exit(0);
    }
    console.error("gen-log: no git history available and no committed generated/build-log.json");
    process.exit(1);
  }
}

if (tryGit("rev-parse", "--is-shallow-repository") === "true") {
  tryGit("fetch", "--quiet", "--unshallow", "origin");
}
const complete = tryGit("rev-parse", "--is-shallow-repository") !== "true";

// Prefer the local main branch (local builds); on CI/Vercel the checkout of main is HEAD.
const ref =
  process.env.SITE_LOG_REF ||
  (cloned ? process.env.VERCEL_GIT_COMMIT_SHA || "main" : tryGit("rev-parse", "--verify", "-q", "refs/heads/main") ? "main" : "HEAD");
const SEP = "\u001f";
const commits = git("log", "--first-parent", `--format=%H${SEP}%cI${SEP}%s`, ref)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, date, subject] = line.split(SEP);
    return { sha, short: sha.slice(0, 7), date, day: date.slice(0, 10), subject, url: `${REPO_URL}/commit/${sha}` };
  });

const reportsDir = join(repo, "docs", "architecture");
const reports = readdirSync(reportsDir)
  .filter((f) => /^WAVE-.*-REPORT\.md$/.test(f))
  .sort()
  .map((file) => {
    const text = readFileSync(join(reportsDir, file), "utf8");
    const title = (text.match(/^#\s+(.+)$/m) ?? [])[1] ?? file;
    const date = (text.match(/^Date (\d{4}-\d{2}-\d{2})/m) ?? [])[1] ?? null;
    // First markdown table: count results by the words PASS / PENDING / FAIL in its second column.
    const table = (text.match(/\n(\|[^\n]+\|\n\|[-| :]+\|\n(?:\|[^\n]+\|\n?)+)/) ?? [])[1] ?? "";
    const results = { pass: 0, partial: 0, pending: 0, fail: 0 };
    for (const row of table.split("\n").slice(2)) {
      const cell = (row.split("|")[2] ?? "").toUpperCase();
      if (/\bFAIL/.test(cell)) results.fail++;
      else if (/\bPENDING/.test(cell)) results.pending++;
      else if (/\bPASS\b.*PARTIAL/.test(cell)) results.partial++;
      else if (/\bPASS/.test(cell)) results.pass++;
    }
    const sha = tryGit("log", "-1", "--format=%H", ref, "--", `docs/architecture/${file}`);
    return { file, title, date, results, url: `${REPO_URL}/blob/${sha ?? "main"}/docs/architecture/${file}` };
  });

const log = { ref: cloned && process.env.VERCEL_GIT_COMMIT_SHA ? "main" : ref, head: commits[0]?.sha ?? null, complete, count: commits.length, commits, reports };
writeFileSync(out, `${JSON.stringify(log, null, 2)}\n`);
console.log(`gen-log: ${commits.length} commits on ${ref}${complete ? "" : " (shallow history)"}, ${reports.length} wave reports`);

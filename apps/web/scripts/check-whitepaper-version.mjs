#!/usr/bin/env node
/**
 * Version gate for the white paper. Runs in every web build (before next build); exits non-zero on a violation.
 *
 * The rule (docs/whitepaper/README.md): never edit the paper without a version bump and a changelog entry.
 *   - If docs/whitepaper/WHITEPAPER.md's text differs from the previous commit's, its header's Version must be higher
 *     and its "## Changelog" must have a "### v<that version>" entry.
 *   - A changelog entry (in the paper or in APPENDICES.md) for a version newer than the header's version fails.
 *
 * What "the previous commit's" text is:
 *   1. uncommitted edits (a local build, the site-sync agent): the working tree against HEAD;
 *   2. always: the last commit that changed the paper against its parent (skipped, with a note, when the parent is
 *      beyond a shallow clone's depth: Vercel clones main at depth 10);
 *   3. with full git history: every commit that changed the paper against the one before it.
 * The rules themselves are checkVersionGate in scripts/wp-history-lib.mts (tested in tests/wp-history.test.ts).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkVersionGate } from "./wp-history-lib.mts";

const repo = join(import.meta.dirname, "..", "..", "..");
const PAPER = "docs/whitepaper/WHITEPAPER.md";
const APPENDICES = "docs/whitepaper/APPENDICES.md";
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};
const show = (sha, path) => tryGit("show", `${sha}:${path}`);

const errors = [];
const notes = [];
const check = (label, prev, curr, appendices) => {
  const r = checkVersionGate(prev, curr, appendices ?? "");
  for (const e of r.errors) errors.push(`${label}: ${e}`);
};

const now = readFileSync(join(repo, PAPER), "utf8");
const nowAppendices = readFileSync(join(repo, APPENDICES), "utf8");
const hasGit = tryGit("rev-parse", "--is-inside-work-tree")?.trim() === "true";

if (!hasGit) {
  notes.push("no git: checked the working tree's changelog against its version only");
  check("working tree", null, now, nowAppendices);
} else {
  // 1. The working tree against HEAD (null when the paper is not committed yet: nothing to compare).
  check("working tree vs HEAD", show("HEAD", PAPER), now, nowAppendices);

  // 2. The last commit that changed the paper, against its parent.
  const last = tryGit("log", "-1", "--format=%H", "HEAD", "--", PAPER)?.trim();
  if (last) {
    const parent = tryGit("rev-parse", "--verify", "-q", `${last}^`)?.trim();
    if (parent) check(`commit ${last.slice(0, 7)}`, show(parent, PAPER), show(last, PAPER), show(last, APPENDICES));
    else notes.push(`the parent of ${last.slice(0, 7)} is not in this clone (shallow); step 2 skipped`);
  }

  // 3. With full history, every change of the paper.
  if (tryGit("rev-parse", "--is-shallow-repository")?.trim() === "false") {
    const shas = git("log", "--reverse", "--topo-order", "--format=%H", "HEAD", "--", PAPER).split("\n").filter(Boolean);
    let prev = null;
    for (const sha of shas) {
      const text = show(sha, PAPER);
      if (text === null) {
        prev = null; // deleted at this commit
        continue;
      }
      check(`commit ${sha.slice(0, 7)}`, prev, text, show(sha, APPENDICES));
      prev = text;
    }
    notes.push(`${shas.length} commits of the paper checked`);
  } else {
    notes.push("shallow clone: the full history was not re-checked");
  }
}

const unique = [...new Set(errors)];
if (unique.length) {
  console.error(`check-whitepaper-version: ${unique.length} violation(s). Never edit the paper without a version bump and a changelog entry.`);
  for (const e of unique) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`check-whitepaper-version: OK (${notes.join("; ")})`);

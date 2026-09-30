#!/usr/bin/env node
/**
 * White paper version history (no agent, no prose): writes, or verifies, generated/whitepaper-history.json and one
 * full-text snapshot per version in generated/whitepaper-history/. Rendered by /whitepaper/changes,
 * /whitepaper/changes.md and /whitepaper/v/<version>.
 *
 * Everything comes from git and the files themselves; nothing is typed by hand:
 *   - the commits that changed the tracked files (TRACKED below: WHITEPAPER.md, its companions and the materiality
 *     model), oldest first;
 *   - for each commit, the "Version" row of WHITEPAPER.md's header table at that commit. Consecutive commits with the
 *     same version form that version: its first and last commit, their dates, the files it changed;
 *   - the diff between the previous version's last commit and this version's last commit (the GitHub compare link),
 *     and from it whether Part I changed (lib: partIChanges, from the section headings; or MATERIALITY.md or
 *     tools/materiality/model.ts changed);
 *   - the changelog entry, verbatim, from the paper's "## Changelog", else from APPENDICES.md's changelog history;
 *   - v0.1 is WHITEPAPER-v0.1-original.txt (never a WHITEPAPER.md commit of its own); a version that appears only in a
 *     changelog is listed with its entry and "no separate commit", never with an invented diff or date.
 *
 * The current version (the working tree's Version row) is recorded WITHOUT its commits: the commit that introduces a
 * version cannot contain its own hash, so recording it would make the file differ after every commit. Its compare link
 * runs from the previous version's last commit to main, and its date on the pages is the paper's last-updated date
 * from gen-log.mjs. Once a newer version exists, the next generation records its commits like every other version.
 * The output is therefore a pure function of (committed history, working tree): regenerating after a commit that
 * changes nothing tracked writes the same bytes.
 *
 * Modes (see docs/whitepaper/README.md, "Version history"):
 *   node scripts/gen-whitepaper-history.mjs            full git history available: regenerate and write.
 *                                                      shallow clone or no git (Vercel clones main at depth 10):
 *                                                      verify the committed files instead (--verify behaviour).
 *   node scripts/gen-whitepaper-history.mjs --verify   never touch git history: check the committed JSON and snapshots
 *                                                      match the working tree (current version, its text, the tracked
 *                                                      files' hashes, every changelog entry). Fails if stale.
 *   node scripts/gen-whitepaper-history.mjs --check    full history required: regenerate in memory, fail if the
 *                                                      committed files differ.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PART_I_FILES, compareVersions, extractChangelog, extractVersion, partIChanges } from "./wp-history-lib.mts";

const web = join(import.meta.dirname, "..");
const repo = join(web, "..", "..");
const OUT = join(web, "generated", "whitepaper-history.json");
const SNAP_DIR = join(web, "generated", "whitepaper-history");
const REPO_URL = "https://github.com/warOnSaaS/wos";
const PAPER = "docs/whitepaper/WHITEPAPER.md";
const APPENDICES = "docs/whitepaper/APPENDICES.md";
const V01 = "docs/whitepaper/WHITEPAPER-v0.1-original.txt";
const TRACKED = [
  PAPER,
  "docs/whitepaper/MATERIALITY.md",
  "docs/whitepaper/EDGE-CASES.md",
  "docs/whitepaper/DESIGN.md",
  APPENDICES,
  "docs/whitepaper/SOURCES.md",
  "tools/materiality/model.ts",
];
const STALE = "run `npm run gen:wp-history -w apps/web` in a checkout with full git history, then commit apps/web/generated";

const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--verify") ? "verify" : "auto";
const sha256 = (s) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;
const read = (p) => readFileSync(join(repo, p), "utf8");
const git = (...args) =>
  execFileSync("git", ["-c", "core.quotepath=off", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const tryGit = (...args) => {
  try {
    return git(...args).trim();
  } catch {
    return null;
  }
};

const fullHistory = tryGit("rev-parse", "--is-inside-work-tree") === "true" && tryGit("rev-parse", "--is-shallow-repository") === "false";

if (mode === "check" && !fullHistory) {
  console.error("gen-whitepaper-history: --check needs full git history (this checkout is shallow or has no git)");
  process.exit(1);
}
if (mode === "verify" || (mode === "auto" && !fullHistory)) {
  if (mode === "auto") console.log("gen-whitepaper-history: shallow or no git history; verifying the committed history instead of regenerating it");
  process.exit(verify() ? 0 : 1);
}

const { json, snapshots } = generate();
if (mode === "check") {
  const problems = diffOutput(json, snapshots);
  if (problems.length) {
    console.error(`gen-whitepaper-history: the committed history is stale; ${STALE}`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`gen-whitepaper-history: OK (${JSON.parse(json).versions.length} versions, committed files match git)`);
} else {
  mkdirSync(SNAP_DIR, { recursive: true });
  for (const f of readdirSync(SNAP_DIR)) if (!snapshots.has(f)) rmSync(join(SNAP_DIR, f));
  let wrote = 0;
  for (const [f, text] of snapshots) {
    const p = join(SNAP_DIR, f);
    if (!existsSync(p) || readFileSync(p, "utf8") !== text) {
      writeFileSync(p, text);
      wrote++;
    }
  }
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== json) {
    writeFileSync(OUT, json);
    wrote++;
  }
  const h = JSON.parse(json);
  console.log(`gen-whitepaper-history: ${h.versions.length} versions (current v${h.current}), ${wrote ? `wrote ${wrote} file(s)` : "unchanged"}`);
}

// --------------------------------------------------------------------------------------------------------------------

function generate() {
  const SEP = "\u001f";
  const paperNow = read(PAPER);
  const current = extractVersion(paperNow);
  if (!current) throw new Error(`gen-whitepaper-history: ${PAPER} has no Version row`);

  // Every commit that changed a tracked file, oldest first, with the paper's version at that commit.
  const log = git("log", "--reverse", "--topo-order", `--format=%H${SEP}%cI${SEP}%s`, "HEAD", "--", ...TRACKED)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject] = line.split(SEP);
      return { sha, date, subject };
    });
  const groups = [];
  for (const c of log) {
    const text = tryGitRaw("show", `${c.sha}:${PAPER}`);
    if (text === null) continue; // before the paper existed (no version to attribute the commit to)
    const version = extractVersion(text);
    if (!version) throw new Error(`gen-whitepaper-history: ${PAPER} at ${c.sha.slice(0, 7)} has no Version row`);
    const files = git("show", "--name-only", "--format=", c.sha, "--", ...TRACKED).split("\n").filter(Boolean);
    const commit = { sha: c.sha, date: c.date, subject: c.subject, files };
    const last = groups[groups.length - 1];
    if (last && last.version === version) last.commits.push(commit);
    else {
      if (groups.some((g) => g.version === version)) throw new Error(`gen-whitepaper-history: version ${version} reappears at ${c.sha.slice(0, 7)}`);
      if (last && compareVersions(version, last.version) < 0) throw new Error(`gen-whitepaper-history: version went down from ${last.version} to ${version} at ${c.sha.slice(0, 7)}`);
      groups.push({ version, commits: [commit] });
    }
  }
  const lastGroup = groups[groups.length - 1];
  if (lastGroup && compareVersions(current, lastGroup.version) < 0) throw new Error(`gen-whitepaper-history: the working tree's version ${current} is older than the committed ${lastGroup.version}`);
  // The current version never records its commits (see the header comment).
  const complete = lastGroup && lastGroup.version === current ? groups.slice(0, -1) : groups;

  const paperLog = extractChangelog(paperNow);
  const appendixLog = existsSync(join(repo, APPENDICES)) ? extractChangelog(read(APPENDICES)) : [];
  const changelogOf = (version) => {
    const p = paperLog.find((e) => compareVersions(e.version, version) === 0);
    if (p) return { source: PAPER, heading: p.heading, text: p.text };
    const a = appendixLog.find((e) => compareVersions(e.version, version) === 0);
    if (a) return { source: APPENDICES, heading: a.heading, text: a.text };
    return null;
  };

  const partIOf = (from, to) => {
    const range = to ? [from, to] : [from];
    const diff = git("diff", "--no-color", "--no-ext-diff", "--unified=100000000", ...range, "--", PAPER);
    const r = partIChanges(diff);
    const files = git("diff", "--name-only", ...range, "--", ...PART_I_FILES).split("\n").filter(Boolean);
    return { changed: r.changed || files.length > 0, sections: r.sections, files };
  };
  const changedFiles = (from, to) =>
    git("diff", "--name-only", ...(to ? [from, to] : [from]), "--", ...TRACKED)
      .split("\n")
      .filter(Boolean);

  const snapshots = new Map();
  const versions = [];

  // v0.1: the original, kept verbatim beside the paper; never a WHITEPAPER.md commit of its own.
  if (existsSync(join(repo, V01))) {
    const added = tryGit("log", "--diff-filter=A", "--format=%H%x1f%cI%x1f%s", "HEAD", "--", V01);
    const [asha, adate, asubject] = (added ?? "").split("\n")[0].split(SEP);
    const text = read(V01);
    snapshots.set("0.1.txt", text);
    versions.push({
      version: "0.1",
      current: false,
      separateCommit: false,
      note: `No separate commit: v0.1 was written before the repository tracked the paper. It is kept verbatim as ${V01.split("/").pop()}${asha ? `, first committed together with v0.2 in ${asha.slice(0, 7)}` : ""}.`,
      addedIn: asha ? { sha: asha, date: adate, subject: asubject, url: `${REPO_URL}/commit/${asha}` } : null,
      firstCommit: null,
      lastCommit: null,
      commits: [],
      previous: null,
      compare: null,
      filesChanged: [],
      companionsChanged: [],
      partI: null,
      changelog: changelogOf("0.1"),
      snapshot: { file: "0.1.txt", format: "text", sha256: sha256(text), sourceUrl: `${REPO_URL}/blob/${asha ?? "main"}/${V01}` },
    });
  }

  let prevLast = null;
  let prevVersion = versions.length ? "0.1" : null;
  for (const g of complete) {
    const first = g.commits[0];
    const last = g.commits[g.commits.length - 1];
    const text = git("show", `${last.sha}:${PAPER}`);
    const file = `${g.version}.md`;
    snapshots.set(file, text);
    const filesChanged = prevLast ? changedFiles(prevLast, last.sha) : [...new Set(g.commits.flatMap((c) => c.files))].sort();
    versions.push({
      version: g.version,
      current: false,
      separateCommit: true,
      note: null,
      addedIn: null,
      firstCommit: ref(first),
      lastCommit: ref(last),
      commits: g.commits.map((c) => ({ ...ref(c), files: c.files })),
      previous: prevVersion,
      compare: prevLast ? { from: prevLast, to: last.sha, url: `${REPO_URL}/compare/${prevLast}...${last.sha}` } : null,
      filesChanged,
      companionsChanged: filesChanged.filter((f) => f !== PAPER && f.startsWith("docs/whitepaper/")),
      partI: prevLast ? partIOf(prevLast, last.sha) : null,
      changelog: changelogOf(g.version),
      snapshot: { file, format: "markdown", sha256: sha256(text), sourceUrl: `${REPO_URL}/blob/${last.sha}/${PAPER}` },
    });
    prevLast = last.sha;
    prevVersion = g.version;
  }

  // The current version: the working tree, compared with the previous version's last commit.
  {
    const file = `${current}.md`;
    snapshots.set(file, paperNow);
    const filesChanged = prevLast ? changedFiles(prevLast, null) : [];
    versions.push({
      version: current,
      current: true,
      separateCommit: true,
      note: "The current version. Its commits are recorded once a newer version exists; its date is the paper's last-updated date from git.",
      addedIn: null,
      firstCommit: null,
      lastCommit: null,
      commits: null,
      previous: prevVersion,
      compare: prevLast ? { from: prevLast, to: "main", url: `${REPO_URL}/compare/${prevLast}...main` } : null,
      filesChanged,
      companionsChanged: filesChanged.filter((f) => f !== PAPER && f.startsWith("docs/whitepaper/")),
      partI: prevLast ? partIOf(prevLast, null) : null,
      changelog: changelogOf(current),
      snapshot: { file, format: "markdown", sha256: sha256(paperNow), sourceUrl: `${REPO_URL}/blob/main/${PAPER}` },
    });
  }

  // Versions that exist only in a changelog: listed with their entry, no commit, no diff, no text.
  for (const e of [...paperLog, ...appendixLog]) {
    if (versions.some((v) => compareVersions(v.version, e.version) === 0)) continue;
    versions.push({
      version: e.version,
      current: false,
      separateCommit: false,
      note: "No separate commit: this version appears only in the changelog; git has no text of it.",
      addedIn: null,
      firstCommit: null,
      lastCommit: null,
      commits: [],
      previous: null,
      compare: null,
      filesChanged: [],
      companionsChanged: [],
      partI: null,
      changelog: changelogOf(e.version),
      snapshot: null,
    });
  }
  versions.sort((a, b) => compareVersions(a.version, b.version));

  const history = {
    schema: "wos-whitepaper-history/v1",
    generator: "apps/web/scripts/gen-whitepaper-history.mjs",
    repo: REPO_URL,
    tracked: TRACKED,
    partIFiles: PART_I_FILES,
    current,
    trackedHashes: Object.fromEntries(TRACKED.filter((p) => existsSync(join(repo, p))).map((p) => [p, sha256(read(p))])),
    versions,
  };
  return { json: `${JSON.stringify(history, null, 2)}\n`, snapshots };
}

function ref(c) {
  return { sha: c.sha, date: c.date, subject: c.subject, url: `${REPO_URL}/commit/${c.sha}` };
}

function tryGitRaw(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function diffOutput(json, snapshots) {
  const problems = [];
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== json) problems.push("generated/whitepaper-history.json differs from git");
  const have = existsSync(SNAP_DIR) ? readdirSync(SNAP_DIR) : [];
  for (const f of have) if (!snapshots.has(f)) problems.push(`generated/whitepaper-history/${f} is not a version`);
  for (const [f, text] of snapshots) {
    const p = join(SNAP_DIR, f);
    if (!existsSync(p) || readFileSync(p, "utf8") !== text) problems.push(`generated/whitepaper-history/${f} differs from git`);
  }
  return problems;
}

/** The committed history against the working tree, without git history (the Vercel build). */
function verify() {
  const problems = [];
  if (!existsSync(OUT)) {
    console.error(`gen-whitepaper-history: generated/whitepaper-history.json is missing; ${STALE}`);
    return false;
  }
  const h = JSON.parse(readFileSync(OUT, "utf8"));
  const paperNow = read(PAPER);
  const version = extractVersion(paperNow);
  if (h.current !== version) problems.push(`the paper is v${version} but the history's current version is v${h.current}`);
  const cur = h.versions.find((v) => v.current);
  if (!cur || cur.version !== version) problems.push(`the history has no current entry for v${version}`);
  else if (cur.snapshot?.sha256 !== sha256(paperNow)) problems.push(`${PAPER} changed since the history was generated`);
  for (const p of TRACKED.filter((x) => x !== PAPER)) {
    const want = h.trackedHashes?.[p];
    const now = existsSync(join(repo, p)) ? sha256(read(p)) : undefined;
    if (want !== now) problems.push(`${p} changed since the history was generated`);
  }
  for (const v of h.versions) {
    if (!v.snapshot) continue;
    const p = join(SNAP_DIR, v.snapshot.file);
    if (!existsSync(p)) problems.push(`missing snapshot generated/whitepaper-history/${v.snapshot.file}`);
    else if (sha256(readFileSync(p, "utf8")) !== v.snapshot.sha256) problems.push(`snapshot ${v.snapshot.file} does not match its recorded hash`);
  }
  const paperLog = extractChangelog(paperNow);
  const appendixLog = existsSync(join(repo, APPENDICES)) ? extractChangelog(read(APPENDICES)) : [];
  const entryOf = (version) =>
    paperLog.find((e) => compareVersions(e.version, version) === 0) ?? appendixLog.find((e) => compareVersions(e.version, version) === 0) ?? null;
  for (const e of [...paperLog, ...appendixLog]) {
    if (!h.versions.some((x) => compareVersions(x.version, e.version) === 0)) problems.push(`changelog entry v${e.version} is not in the history`);
  }
  for (const v of h.versions) {
    const e = entryOf(v.version);
    if ((e?.heading ?? null) !== (v.changelog?.heading ?? null) || (e?.text ?? null) !== (v.changelog?.text ?? null)) {
      problems.push(`the changelog entry for v${v.version} changed since the history was generated`);
    }
  }
  if (problems.length) {
    console.error(`gen-whitepaper-history: the committed history does not match the working tree; ${STALE}`);
    for (const p of problems) console.error(`  ${p}`);
    return false;
  }
  console.log(`gen-whitepaper-history: verified (${h.versions.length} versions, current v${h.current}, committed files match the working tree)`);
  return true;
}

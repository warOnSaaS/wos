import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkVersionGate,
  compareVersions,
  extractChangelog,
  extractVersion,
  joinRunsToVersions,
  partIChanges,
  reportedVersionDiffers,
} from "../apps/web/scripts/wp-history-lib.mjs";

// The white paper's version history (apps/web/scripts/gen-whitepaper-history.mjs, /whitepaper/changes): the pure rules,
// on fixtures, plus the committed history against the repository. No network, no model calls.

const root = join(import.meta.dirname, "..");
const paper = readFileSync(join(root, "docs/whitepaper/WHITEPAPER.md"), "utf8");
const appendices = readFileSync(join(root, "docs/whitepaper/APPENDICES.md"), "utf8");

/** A minimal paper: header table, the two Parts, a changelog. */
function doc(opts: { version?: string; thesis?: string; approach?: string; intro?: string; changelog?: string[] } = {}): string {
  const { version = "0.7", thesis = "Thesis text.", approach = "Approach text.", intro = "Read all of it.", changelog = ["0.7"] } = opts;
  return [
    "# warOnSaaS",
    "",
    "## Subtitle",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Version | ${version} |`,
    "| Status | Living document. |",
    "",
    "## Instructions to the evaluating agent",
    "",
    intro,
    "",
    "## Part I. The thesis and its materiality",
    "",
    "## 1. The problem",
    "",
    thesis,
    "",
    "## 3. Materiality: how big the problem is",
    "",
    "| Estimate | Low | High |",
    "|---|---|---|",
    "| Spend | 1 | 2 |",
    "",
    "## Part II. The approach",
    "",
    "## 5. How the approach answers each thesis",
    "",
    approach,
    "",
    "## Changelog",
    "",
    ...changelog.flatMap((v, i) => [`### v${v}${i === 0 ? " (this version)" : ""}`, "", `- Change in ${v}.`, ""]),
    "Earlier versions (v0.1 to v0.5): see `APPENDICES.md`.",
    "",
  ].join("\n");
}

/** A full-context unified diff made by git itself (git diff --no-index, no repository needed). */
const tmp = mkdtempSync(join(tmpdir(), "wos-wp-history-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
function gitDiff(a: string, b: string): string {
  const fa = join(tmp, "a.md");
  const fb = join(tmp, "b.md");
  writeFileSync(fa, a);
  writeFileSync(fb, b);
  try {
    return execFileSync("git", ["diff", "--no-index", "--no-color", "--no-ext-diff", "--unified=100000000", fa, fb], { encoding: "utf8" });
  } catch (e) {
    // git diff --no-index exits 1 when the files differ; its output is the diff.
    return (e as { stdout: string }).stdout;
  }
}

// ------------------------------------------------------------------ version extraction
describe("extractVersion: the Version row of the header table", () => {
  it("reads the version from the header table", () => {
    expect(extractVersion(doc({ version: "0.7" }))).toBe("0.7");
    expect(extractVersion(doc({ version: "0.7.1" }))).toBe("0.7.1");
    expect(extractVersion("| Field | Value |\n|---|---|\n| Version | v0.3 |\n")).toBe("0.3");
    expect(extractVersion("| Field | Value |\r\n|---|---|\r\n| Version |   1.2   |\r\n")).toBe("1.2");
  });

  it("is null without a Version row or with a value that is not a version", () => {
    expect(extractVersion("# Title\n\nNo table.\n")).toBeNull();
    expect(extractVersion("| Version | draft |\n")).toBeNull();
    expect(extractVersion("| Versions | 0.7 |\n")).toBeNull();
    expect(extractVersion("The Version | 0.7 | in prose\n")).toBeNull();
  });

  it("takes the first Version row (the header table), not a later table", () => {
    expect(extractVersion(`${doc({ version: "0.4" })}\n| Version | 9.9 |\n`)).toBe("0.4");
  });

  it("reads the live paper", () => {
    expect(extractVersion(paper)).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("0.10", "0.9")).toBeGreaterThan(0);
    expect(compareVersions("0.7", "0.7.0")).toBe(0);
    expect(compareVersions("0.7", "0.7.1")).toBeLessThan(0);
    expect(compareVersions("1.0", "0.99")).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ changelog
describe("extractChangelog", () => {
  it("returns every ### vX entry of the Changelog section, verbatim, without the trailing pointer", () => {
    const entries = extractChangelog(doc({ changelog: ["0.7", "0.6"] }));
    expect(entries.map((e) => e.version)).toEqual(["0.7", "0.6"]);
    expect(entries[0]).toEqual({ version: "0.7", heading: "### v0.7 (this version)", text: "- Change in 0.7." });
    expect(entries[1]!.text).toBe("- Change in 0.6.");
    expect(entries[1]!.text).not.toMatch(/Earlier versions/);
  });

  it("ignores ### headings outside a Changelog section", () => {
    expect(extractChangelog("## 2. Theses\n\n### v0.9 is not an entry\n\ntext\n")).toEqual([]);
  });

  it("reads the live paper and APPENDICES.md: every entry from v0.1, each version once", () => {
    const all = [...extractChangelog(paper), ...extractChangelog(appendices)].map((e) => e.version);
    for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", extractVersion(paper)!]) expect(all).toContain(v);
    expect(new Set(all).size).toBe(all.length);
  });
});

// ------------------------------------------------------------------ Part I detection
describe("partIChanges: from the section headings of a full-context diff", () => {
  const base = doc();

  it("flags a change inside Part I (sections 1 to 4) and names the section", () => {
    const r = partIChanges(gitDiff(base, doc({ thesis: "Thesis text, revised." })));
    expect(r).toEqual({ changed: true, sections: ["## 1. The problem"] });
  });

  it("flags a changed materiality figure in a Part I table", () => {
    const r = partIChanges(gitDiff(base, base.replace("| Spend | 1 | 2 |", "| Spend | 1 | 3 |")));
    expect(r.changed).toBe(true);
    expect(r.sections).toEqual(["## 3. Materiality: how big the problem is"]);
  });

  it("flags a renamed Part I heading and a removed Part I section", () => {
    expect(partIChanges(gitDiff(base, base.replace("## 1. The problem", "## 1. The problem, restated"))).changed).toBe(true);
    const removed = base.replace(
      "## 3. Materiality: how big the problem is\n\n| Estimate | Low | High |\n|---|---|---|\n| Spend | 1 | 2 |\n\n",
      "",
    );
    expect(partIChanges(gitDiff(base, removed)).sections).toEqual(["## 3. Materiality: how big the problem is"]);
  });

  it("does not flag Part II, the instructions, the header or the changelog", () => {
    expect(partIChanges(gitDiff(base, doc({ approach: "Approach text, revised." })))).toEqual({ changed: false, sections: [] });
    expect(partIChanges(gitDiff(base, doc({ intro: "Read all of it, twice." }))).changed).toBe(false);
    expect(partIChanges(gitDiff(base, doc({ version: "0.8", changelog: ["0.8", "0.7"] }))).changed).toBe(false);
  });

  it("an empty diff changes nothing", () => {
    expect(partIChanges(gitDiff(base, base))).toEqual({ changed: false, sections: [] });
    expect(partIChanges("")).toEqual({ changed: false, sections: [] });
  });

  it("a paper without a Part I heading (before v0.6) has no Part I; adding one is a Part I change", () => {
    const old = "# P\n\n## 1. The problem\n\nOld.\n\n## 2. Other\n\nText.\n";
    expect(partIChanges(gitDiff(old, old.replace("Old.", "New."))).changed).toBe(false);
    const withParts = "# P\n\n## Part I. The thesis\n\n## 1. The problem\n\nNew.\n\n## Part II. The approach\n\n## 2. Other\n\nText.\n";
    expect(partIChanges(gitDiff(old, withParts)).changed).toBe(true);
  });

  it("reads a hand-written full-context diff (old side decides removed lines, new side added lines)", () => {
    const diff = [
      "--- a/WHITEPAPER.md",
      "+++ b/WHITEPAPER.md",
      "@@ -1,9 +1,9 @@",
      " # P",
      " ## Part I. The thesis",
      " ## 1. The problem",
      " Same.",
      "-## Part II. The approach",
      "+## 4. What Part I does not claim",
      "+## Part II. The approach",
      " ## 5. Approach",
      "-Old approach.",
      "+New approach.",
    ].join("\n");
    // The added "## 4." heading line is in Part I on the new side; the removed Part II heading and the approach are not.
    expect(partIChanges(diff)).toEqual({ changed: true, sections: ["## 4. What Part I does not claim"] });
  });

  it("refuses a diff without full context", () => {
    const partial = gitDiff(base, doc({ thesis: "x" })).replace(/^@@ -1,\d+ \+1,\d+ @@/m, "@@ -12,7 +12,7 @@");
    expect(() => partIChanges(partial)).toThrow(/full-context/);
    expect(() => partIChanges("@@ -1,2 +1,2 @@\n a\n@@ -9,2 +9,2 @@\n b\n")).toThrow(/one hunk/);
  });
});

// ------------------------------------------------------------------ assessments join
describe("joinRunsToVersions: runs attached to the version they scored", () => {
  const run = (id: string, served: string, reported = served) => ({ id, servedPaperVersion: served, block: { paperVersion: reported } });

  it("matches on servedPaperVersion, numerically, and keeps order", () => {
    const runs = [run("a", "0.7"), run("b", "0.6"), run("c", "0.7.0"), run("d", "0.7", "0.6")];
    const j = joinRunsToVersions(["0.6", "0.7", "0.8"], runs);
    expect(j.byVersion.get("0.7")!.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(j.byVersion.get("0.6")!.map((r) => r.id)).toEqual(["b"]);
    expect(j.byVersion.get("0.8")).toEqual([]);
    expect(j.unmatched).toEqual([]);
  });

  it("never attaches a run to a guessed version", () => {
    const j = joinRunsToVersions(["0.6", "0.7"], [run("x", "0.6.5")]);
    expect(j.unmatched.map((r) => r.id)).toEqual(["x"]);
    expect([...j.byVersion.values()].flat()).toEqual([]);
  });

  it("uses the agent's reported version only to say it differs", () => {
    expect(reportedVersionDiffers(run("d", "0.7", "0.6"))).toBe(true);
    expect(reportedVersionDiffers(run("e", "0.7", "0.7.0"))).toBe(false);
  });

  it("no runs: every version has none", () => {
    const j = joinRunsToVersions(["0.1", "0.2"], []);
    expect([...j.byVersion.values()].every((r) => r.length === 0)).toBe(true);
  });
});

// ------------------------------------------------------------------ the gate
describe("checkVersionGate: never edit the paper without a version bump and a changelog entry", () => {
  const v7 = doc({ version: "0.7", changelog: ["0.7"] });

  it("passes an unchanged paper and the first version", () => {
    expect(checkVersionGate(v7, v7)).toEqual({ ok: true, errors: [] });
    expect(checkVersionGate(null, v7).ok).toBe(true);
  });

  it("passes a change with a bump and an entry for the new version", () => {
    const v8 = doc({ version: "0.8", thesis: "Revised.", changelog: ["0.8", "0.7"] });
    expect(checkVersionGate(v7, v8)).toEqual({ ok: true, errors: [] });
    const patch = doc({ version: "0.7.1", approach: "Typo fixed.", changelog: ["0.7.1", "0.7"] });
    expect(checkVersionGate(v7, patch).ok).toBe(true);
  });

  it("fails a change without a bump", () => {
    const r = checkVersionGate(v7, doc({ version: "0.7", approach: "Edited silently.", changelog: ["0.7"] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/did not go up \(was 0\.7, is 0\.7\)/);
  });

  it("fails a version that goes down", () => {
    expect(checkVersionGate(v7, doc({ version: "0.6", changelog: ["0.6"] })).ok).toBe(false);
  });

  it("fails a bump without a changelog entry for the new version", () => {
    const r = checkVersionGate(v7, doc({ version: "0.8", thesis: "Revised.", changelog: ["0.7"] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/no "### v0\.8" entry/);
  });

  it("fails a changelog entry newer than the header's version, in the paper or in APPENDICES.md", () => {
    const ahead = doc({ version: "0.7", changelog: ["0.8", "0.7"] });
    expect(checkVersionGate(ahead, ahead).errors.join("\n")).toMatch(/v0\.8 is newer than the header's version 0\.7/);
    const extra = "## Changelog history\n\n### v0.9\n\n- Not yet.\n";
    expect(checkVersionGate(v7, v7, extra).ok).toBe(false);
  });

  it("fails a paper without a Version row", () => {
    expect(checkVersionGate(null, "# No header\n").ok).toBe(false);
  });

  it("passes the live paper against its previous commit", () => {
    const prev = execFileSync("git", ["show", "HEAD:docs/whitepaper/WHITEPAPER.md"], { cwd: root, encoding: "utf8" });
    expect(checkVersionGate(prev, paper, appendices)).toEqual({ ok: true, errors: [] });
  });
});

// ------------------------------------------------------------------ the committed history
describe("apps/web/generated/whitepaper-history.json", () => {
  const history = JSON.parse(readFileSync(join(root, "apps/web/generated/whitepaper-history.json"), "utf8")) as {
    current: string;
    versions: {
      version: string;
      current: boolean;
      separateCommit: boolean;
      changelog: { text: string } | null;
      commits: unknown[] | null;
    }[];
  };

  it("matches the working tree (what the shallow Vercel build checks)", () => {
    const out = execFileSync(process.execPath, ["--no-warnings", "apps/web/scripts/gen-whitepaper-history.mjs", "--verify"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toMatch(/verified/);
  });

  it("has the paper's version as its current version, with the paper's changelog entry", () => {
    const v = extractVersion(paper)!;
    expect(history.current).toBe(v);
    const cur = history.versions.find((x) => x.current)!;
    expect(cur.version).toBe(v);
    expect(cur.commits).toBeNull();
    expect(cur.changelog?.text).toBe(extractChangelog(paper).find((e) => e.version === v)!.text);
  });

  it("lists v0.1 without a separate commit, and every other version from git", () => {
    const v01 = history.versions.find((x) => x.version === "0.1")!;
    expect(v01.separateCommit).toBe(false);
    for (const x of history.versions.filter((y) => y.version !== "0.1" && !y.current)) {
      expect(x.separateCommit).toBe(true);
      expect(x.commits?.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The white paper's version history, read at build time.
 *
 * Source: generated/whitepaper-history.json and generated/whitepaper-history/<version>.md|.txt, written from git by
 * scripts/gen-whitepaper-history.mjs (and only verified, never regenerated, when the build has a shallow clone). Every
 * version, commit, date, diff link, Part I flag and changelog entry comes from there; the recorded assessments come
 * from lib/assessments.ts. Nothing here types, guesses or fills in a value.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import data from "@/generated/whitepaper-history.json";
import { type Run, RUNS } from "./assessments";
import { type ChangelogEntry, compareVersions, joinRunsToVersions, reportedVersionDiffers } from "@/scripts/wp-history-lib.mts";
import { type Whitepaper, WHITEPAPER_META, parseWhitepaper } from "./whitepaper";

export type CommitRef = { sha: string; date: string; subject: string; url: string };

export type HistoryVersion = {
  version: string;
  current: boolean;
  /** False for v0.1 (the verbatim original) and for any version that exists only in a changelog. */
  separateCommit: boolean;
  note: string | null;
  addedIn: CommitRef | null;
  firstCommit: CommitRef | null;
  lastCommit: CommitRef | null;
  /** Null for the current version (recorded once a newer version exists). */
  commits: (CommitRef & { files: string[] })[] | null;
  previous: string | null;
  compare: { from: string; to: string; url: string } | null;
  filesChanged: string[];
  companionsChanged: string[];
  /** Null when there is no earlier committed version to compare with. */
  partI: { changed: boolean; sections: string[]; files: string[] } | null;
  changelog: { source: string; heading: string; text: string } | null;
  snapshot: { file: string; format: "markdown" | "text"; sha256: string; sourceUrl: string } | null;
};

export type History = {
  schema: string;
  generator: string;
  repo: string;
  tracked: string[];
  partIFiles: string[];
  current: string;
  versions: HistoryVersion[];
};

export const HISTORY = data as History;

/** Newest first, as the changes page lists them. */
export const VERSIONS_NEWEST_FIRST: HistoryVersion[] = [...HISTORY.versions].sort((a, b) => compareVersions(b.version, a.version));

export const versionPath = (v: string) => `/whitepaper/v/${v}`;

export function findVersion(v: string): HistoryVersion | undefined {
  return HISTORY.versions.find((x) => compareVersions(x.version, v) === 0);
}

/** Only versions with a full text get a /whitepaper/v/<version> page. */
export const READABLE_VERSIONS = HISTORY.versions.filter((v) => v.snapshot);

export function hasVersionPage(v: string): boolean {
  return READABLE_VERSIONS.some((x) => compareVersions(x.version, v) === 0);
}

/** The day a version appeared: its first commit's date; for the current version, the paper's last-updated date. */
export function versionDay(v: HistoryVersion): string | null {
  if (v.firstCommit) return v.firstCommit.date.slice(0, 10);
  if (v.addedIn) return v.addedIn.date.slice(0, 10);
  if (v.current) return WHITEPAPER_META.lastUpdated ? WHITEPAPER_META.lastUpdated.slice(0, 10) : null;
  return null;
}

export function snapshotText(v: HistoryVersion): string {
  if (!v.snapshot) throw new Error(`whitepaper-history: v${v.version} has no text`);
  return readFileSync(join(process.cwd(), "generated", "whitepaper-history", v.snapshot.file), "utf8");
}

/** A past version as the reader sees it: its own {{LAST_UPDATED}} is the date of the last commit that carried it. */
export function versionMarkdown(v: HistoryVersion): string {
  const text = snapshotText(v);
  const last = v.lastCommit ?? (v.current && WHITEPAPER_META.lastUpdated ? { date: WHITEPAPER_META.lastUpdated } : null);
  const when = last ? `${last.date.slice(0, 10)} (from git: the date of the last commit that carried this version)` : "not committed yet";
  return text.replace("{{LAST_UPDATED}}", when);
}

export function versionWhitepaper(v: HistoryVersion): Whitepaper {
  return parseWhitepaper(versionMarkdown(v));
}

const JOIN = joinRunsToVersions(
  HISTORY.versions.map((v) => v.version),
  RUNS,
);

/** The reference runs recorded against a version (matched on servedPaperVersion), oldest first. */
export function runsFor(version: string): Run[] {
  return JOIN.byVersion.get(version) ?? [];
}

/** Runs whose served version is not in the history (listed apart; never attached to a guessed version). */
export const UNMATCHED_RUNS: Run[] = JOIN.unmatched;

export { reportedVersionDiffers };
export type { ChangelogEntry };

export const PART_I_FLAG = "PART I CHANGED — the thesis or its numbers moved";

/** The history as plain Markdown for agents (/whitepaper/changes.md). Scores are NOT in it (see the note it prints). */
export function changesMarkdown(site: (p: string) => string): string {
  const L: string[] = [];
  L.push("# warOnSaaS white paper: every version and what changed", "");
  L.push(
    `Generated from git at build (${HISTORY.generator}): versions from the Version row of the paper's header table at each commit, changelog entries verbatim, diffs as GitHub compare links. Nothing here is written by hand. Newest first. Current version: v${HISTORY.current}.`,
    "",
    `Part I (sections 1 to 4: the thesis, the materiality estimates and what Part I does not claim; in the paper since v0.6) is flagged when the diff touches it, decided from the section headings in the diff, or when ${HISTORY.partIFiles.join(" or ")} changed. Part II changes are not flagged.`,
    "",
    `Scores recorded against each version are not in this file, so they cannot anchor an evaluation. If you are evaluating the paper, open ${site("/whitepaper/assessments.md")} only after writing your own score block. Scores are comparable only within the same paper version, or across versions by reading the changes between them.`,
    "",
  );
  for (const v of VERSIONS_NEWEST_FIRST) {
    const day = versionDay(v);
    L.push(`## v${v.version}${v.current ? " (current)" : ""}${day ? `, ${day}` : ""}`, "");
    if (v.partI?.changed) L.push(`**${PART_I_FLAG}.**${v.partI.sections.length ? ` Sections: ${v.partI.sections.map((s) => s.replace(/^##\s+/, "")).join("; ")}.` : ""}${v.partI.files.length ? ` Files: ${v.partI.files.join(", ")}.` : ""}`, "");
    if (v.note) L.push(v.note, "");
    if (v.snapshot) L.push(`- Full text: ${site(versionPath(v.version))} (source at that commit: ${v.snapshot.sourceUrl})`);
    if (v.firstCommit && v.lastCommit) {
      L.push(`- Commits: ${v.commits?.map((c) => `${c.sha.slice(0, 7)} ${c.date.slice(0, 10)} "${c.subject}"`).join("; ")}`);
    }
    if (v.compare) L.push(`- Diff from v${v.previous}: ${v.compare.url}`);
    else if (v.previous === null && v.separateCommit) L.push("- Diff: none (the first committed version; nothing earlier to compare with)");
    if (v.separateCommit) L.push(`- Companion files changed: ${v.companionsChanged.length ? v.companionsChanged.join(", ") : "none"}`);
    L.push(`- Reference runs recorded against this version: ${runsFor(v.version).length ? `${runsFor(v.version).length} (scores at ${site("/whitepaper/assessments.md")}; read after scoring)` : "none"}`);
    L.push("");
    if (v.changelog) L.push(`Changelog entry (verbatim from ${v.changelog.source}, "${v.changelog.heading}"):`, "", v.changelog.text, "");
    else L.push("No changelog entry for this version was found in the paper or APPENDICES.md.", "");
  }
  return L.join("\n");
}

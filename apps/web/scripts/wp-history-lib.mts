/**
 * White paper version history: the pure rules, shared by scripts/gen-whitepaper-history.mjs (generation and
 * verification), scripts/check-whitepaper-version.mjs (the version/changelog gate), lib/whitepaper-history.ts (the
 * pages) and tests/wp-history.test.ts. No I/O, no git, no clock: every function is a function of its arguments.
 *
 * Plain TypeScript with erasable syntax only, so Node runs it directly (type stripping) from the .mjs scripts.
 */

/** A version string as the paper writes it in its header table: 0.7, 0.7.1. */
const VERSION_RE = /^\d+\.\d+(?:\.\d+)?$/;

/**
 * The value of the "Version" row of the paper's header table (the first Markdown table row whose first cell is
 * exactly "Version"), without a leading "v". Null when there is no such row or the value is not a version.
 */
export function extractVersion(md: string): string | null {
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^\|\s*Version\s*\|\s*v?([^|]*?)\s*\|/);
    if (m) return VERSION_RE.test(m[1] ?? "") ? (m[1] as string) : null;
  }
  return null;
}

/** Numeric comparison of two versions: negative when a < b, 0 when equal, positive when a > b. 0.7 === 0.7.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export type ChangelogEntry = {
  version: string;
  /** The heading line exactly as written, e.g. "### v0.7 (this version)". */
  heading: string;
  /** The entry's text, verbatim, without its heading, trimmed. */
  text: string;
};

/**
 * Changelog entries: every "### vX.Y" heading inside a level-2 section whose heading starts with "Changelog"
 * ("## Changelog" in the paper, "## Changelog history (v0.1 to v0.5)" in APPENDICES.md). An entry runs to the next
 * heading of any level, or to a line starting with "Earlier versions" (the paper's pointer to APPENDICES.md, which is
 * a footer of the section, not part of the last entry).
 */
export function extractChangelog(md: string): ChangelogEntry[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: ChangelogEntry[] = [];
  let inSection = false;
  let current: { version: string; heading: string; lines: string[] } | null = null;
  const close = () => {
    if (current) out.push({ version: current.version, heading: current.heading, text: current.lines.join("\n").trim() });
    current = null;
  };
  let fenced = false;
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    if (!fenced && /^#{1,2}\s/.test(line)) {
      close();
      inSection = /^##\s+Changelog\b/.test(line);
      continue;
    }
    if (!inSection) continue;
    if (!fenced && /^#{3,6}\s/.test(line)) {
      close();
      const m = line.match(/^###\s+v(\d+\.\d+(?:\.\d+)?)\b/);
      if (m) current = { version: m[1] as string, heading: line, lines: [] };
      continue;
    }
    if (!fenced && /^Earlier versions\b/.test(line)) {
      close();
      continue;
    }
    if (current) current.lines.push(line);
  }
  close();
  return out;
}

// ------------------------------------------------------------------------------------------------ Part I detection

export type PartIResult = {
  /** True when any added or removed line lies in Part I (sections 1 to 4) of the old or the new text. */
  changed: boolean;
  /** The level-2 headings (as written) of the Part I sections with a changed line, in order, without duplicates. */
  sections: string[];
};

/** A level-2 heading that opens a Part of the paper: "## Part I. …", "## Part II. …". */
const PART_RE = /^##\s+Part\s+([IVX]+)\b/;

/**
 * Whether a unified diff of WHITEPAPER.md touches Part I, decided only from the section headings in the diff.
 *
 * The diff must carry full context (git diff --unified=<more lines than the file>), so every heading of both texts is
 * in it. Part I is every line from a "## Part I" heading up to the next "## Part …" heading (in the paper since v0.6:
 * the thesis, the materiality estimates and what Part I does not claim, sections 1 to 4). The old text's structure
 * decides removed lines, the new text's decides added lines. A paper without a "## Part I" heading (before v0.6) has
 * no Part I, so its lines never count. An empty diff changes nothing.
 */
export function partIChanges(diff: string): PartIResult {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const hunks = lines.filter((l) => l.startsWith("@@"));
  if (hunks.length > 1) throw new Error("partIChanges: needs a full-context diff (one hunk); run git diff with --unified=<a large number>");
  const hunk = hunks[0];
  if (hunk) {
    const m = hunk.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!m || Number(m[1]) > 1 || Number(m[2]) > 1) throw new Error("partIChanges: needs a full-context diff that starts at line 1");
  }
  const side = () => ({ inPartI: false, heading: "" });
  const old = side();
  const neu = side();
  const sections: string[] = [];
  const seen = (s: { inPartI: boolean; heading: string }) => {
    if (s.inPartI && !sections.includes(s.heading)) sections.push(s.heading);
  };
  const advance = (s: { inPartI: boolean; heading: string }, text: string) => {
    if (!/^##\s/.test(text)) return;
    const part = text.match(PART_RE);
    if (part) s.inPartI = part[1] === "I";
    s.heading = text;
  };
  let body = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      body = true;
      continue;
    }
    if (!body || line.startsWith("\\")) continue;
    const mark = line[0];
    const text = line.slice(1);
    if (mark === " ") {
      advance(old, text);
      advance(neu, text);
    } else if (mark === "-") {
      advance(old, text);
      seen(old);
    } else if (mark === "+") {
      advance(neu, text);
      seen(neu);
    }
  }
  return { changed: sections.length > 0, sections };
}

/** Files outside WHITEPAPER.md whose change alone marks Part I as changed: its sources and its model. */
export const PART_I_FILES = ["docs/whitepaper/MATERIALITY.md", "tools/materiality/model.ts"] as const;

// ------------------------------------------------------------------------------------------------ the gate

export type GateResult = { ok: boolean; errors: string[] };

/**
 * The version/changelog gate for one change of the paper, prev -> curr (full texts).
 *  - If the text changed, the Version row must have increased, and the paper's "## Changelog" must have an entry for
 *    the new version.
 *  - A changelog entry (in the paper, or in `extraChangelog`, e.g. APPENDICES.md) for a version newer than the header's
 *    version fails, changed or not.
 * `prev` is null for the first committed version (nothing to compare against).
 */
export function checkVersionGate(prev: string | null, curr: string, extraChangelog = ""): GateResult {
  const errors: string[] = [];
  const v = extractVersion(curr);
  if (!v) return { ok: false, errors: ['WHITEPAPER.md: the header table has no valid "| Version | x.y |" row'] };
  const entries = extractChangelog(curr);
  for (const e of [...entries, ...extractChangelog(extraChangelog)]) {
    if (compareVersions(e.version, v) > 0) errors.push(`changelog entry v${e.version} is newer than the header's version ${v}`);
  }
  const norm = (s: string) => s.replace(/\r\n/g, "\n");
  if (prev !== null && norm(prev) !== norm(curr)) {
    const pv = extractVersion(prev);
    if (pv && compareVersions(v, pv) <= 0) {
      errors.push(`WHITEPAPER.md changed but its version did not go up (was ${pv}, is ${v}): bump the Version row and add a changelog entry`);
    }
    if (!entries.some((e) => compareVersions(e.version, v) === 0)) {
      errors.push(`WHITEPAPER.md changed to version ${v} but "## Changelog" has no "### v${v}" entry`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------------------------------------------ assessments join

/** The two version fields of an assessment record the join reads (packages/contracts/src/assessment.ts). */
export type VersionedRun = { id: string; servedPaperVersion: string; block: { paperVersion: string } };

export type VersionRuns<R> = {
  /** Runs recorded against each version: the version the site served when the run started (servedPaperVersion). */
  byVersion: Map<string, R[]>;
  /** Runs whose served version is not a version in the history (shown apart, never attached to a guess). */
  unmatched: R[];
};

/**
 * Attach each recorded run to the paper version it was scored against. The authority is servedPaperVersion (what
 * waronsaas.com/whitepaper.md served, recorded by the runner); the agent's own block.paperVersion is what it reported
 * and is shown beside it when the two differ, never used to move the run. Versions compare numerically (0.7 = 0.7.0).
 */
export function joinRunsToVersions<R extends VersionedRun>(versions: string[], runs: R[]): VersionRuns<R> {
  const byVersion = new Map<string, R[]>(versions.map((v) => [v, []]));
  const unmatched: R[] = [];
  for (const r of runs) {
    const v = versions.find((x) => compareVersions(x, r.servedPaperVersion) === 0);
    if (v) byVersion.get(v)!.push(r);
    else unmatched.push(r);
  }
  return { byVersion, unmatched };
}

/** True when the agent reported a different version from the one the site served. */
export function reportedVersionDiffers(r: VersionedRun): boolean {
  return compareVersions(r.servedPaperVersion, r.block.paperVersion) !== 0;
}

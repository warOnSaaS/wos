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
 * ("## Changelog" in the paper, "## Changelog history (v0.1 to v0.7)" in APPENDICES.md). An entry runs to the next
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

// ------------------------------------------------------------------------------------------------ the self-assessment rule

/**
 * Versions that shipped before every version had to be assessed (paper v0.9, 2026-09-30). FROZEN: never add to this
 * list. v0.1 to v0.8 were superseded without a recorded reference run, because the rule did not exist yet; from v0.9 on,
 * a version can only be superseded once warOnSaaS has recorded at least one self-assessment of it
 * (.github/workflows/self-assessment.yml records one after every paper change reaches the site).
 */
export const GRANDFATHERED_UNASSESSED: readonly string[] = Object.freeze(["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8"]);

/** What the self-assessment rule reads of a recorded run. */
export type ServedRun = { servedPaperVersion: string };

/** The recorded runs of one version: the version the site served when the run started, compared numerically. */
export function runsOfVersion<R extends ServedRun>(version: string, runs: R[]): R[] {
  return runs.filter((r) => compareVersions(r.servedPaperVersion, version) === 0);
}

/** True while the given version (normally the current one) has no recorded self-assessment. */
export function selfAssessmentPending(version: string, runs: ServedRun[]): boolean {
  return runsOfVersion(version, runs).length === 0;
}

/**
 * No version is superseded unassessed: every known version older than `current` must have at least one recorded run
 * (servedPaperVersion match), unless it is in the frozen grandfather list. `versions` are every version the paper
 * knows (its changelog entries, APPENDICES.md's and the header's); the current version itself is not required to be
 * assessed yet (it cannot be: a run must read the deployed paper).
 */
export function checkAssessedGate(
  current: string,
  versions: string[],
  runs: ServedRun[],
  grandfathered: readonly string[] = GRANDFATHERED_UNASSESSED,
): GateResult {
  const errors: string[] = [];
  const seen: string[] = [];
  for (const v of [...versions].sort(compareVersions)) {
    if (seen.some((s) => compareVersions(s, v) === 0)) continue;
    seen.push(v);
    if (compareVersions(v, current) >= 0) continue;
    if (grandfathered.some((g) => compareVersions(g, v) === 0)) continue;
    if (runsOfVersion(v, runs).length === 0) {
      errors.push(
        `v${v} is superseded by v${current} but has no recorded self-assessment (docs/assessments, servedPaperVersion ${v}): let .github/workflows/self-assessment.yml record one for v${v} (or run tools/assessments/run-reference.ts) before shipping a new version`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------------------------------------------ the gap register

/**
 * The changelog convention for gaps (docs/whitepaper/README.md). Inside a version's changelog entry, one line each:
 *
 *   - Gaps addressed: `gap-id`, `another-gap-id`
 *   - Gap declined: `gap-id`: the reason, in one sentence
 *
 * ("Gap"/"Gaps", a leading "- " and bold markers are optional; ids are the backticked slugs.) A declined line gives one
 * reason for every id on it. Nothing else in an entry counts as a citation: gaps are matched on their exact id, never by
 * similar wording.
 */
export type GapCitation = { version: string; kind: "addressed" | "declined"; id: string; reason: string | null };

const CITE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?gaps?\s+(addressed|declined)\s*:?\s*(?:\*\*)?\s*:?\s*(.*)$/i;
const ID_RE = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g;

export function extractGapCitations(entries: ChangelogEntry[]): GapCitation[] {
  const out: GapCitation[] = [];
  for (const e of entries) {
    for (const line of e.text.split("\n")) {
      const m = line.match(CITE_RE);
      if (!m) continue;
      const kind = (m[1] as string).toLowerCase() as GapCitation["kind"];
      const rest = m[2] as string;
      const ids = [...rest.matchAll(ID_RE)].map((x) => x[1] as string);
      let reason: string | null = null;
      if (kind === "declined") {
        const after = rest.replace(ID_RE, "").replace(/^[\s,:;—–-]+/, "").trim();
        reason = after.length ? after : null;
      }
      for (const id of ids) out.push({ version: e.version, kind, id, reason });
    }
  }
  return out;
}

/** What the register reads of a recorded run (an AssessmentRecord without rawBlock). */
export type GapRun = {
  id: string;
  recordedAt: string;
  servedPaperVersion: string;
  reportFile: string;
  block: {
    schema: string;
    evaluator: { model: string };
    gaps?: { id: string; title: string; concerns: string; part: "I" | "II"; severity: "high" | "medium" | "low" }[];
  };
};

export type GapStatus = "open" | "addressed" | "declined";

export type RegisterGap = {
  id: string;
  title: string;
  concerns: string;
  part: "I" | "II";
  severity: "high" | "medium" | "low";
  /** The version whose latest run reported it (servedPaperVersion). */
  version: string;
  runId: string;
  reportFile: string;
  evaluator: string;
  status: GapStatus;
  /** The version whose changelog addressed or declined it; null while open. */
  statusIn: string | null;
  /** The reason given when declined. */
  reason: string | null;
  /** Other versions whose latest run reported a gap with exactly this id. */
  alsoReportedIn: string[];
};

export type GapRegister = {
  schema: "wos-gap-register/v1";
  current: string;
  /** Every version with a recorded run: the run the register uses (latest with gaps), or null when none has gaps. */
  versions: { version: string; runId: string | null; runs: number; gaps: number }[];
  /** Newest version first, then high to low severity, then by id. */
  gaps: RegisterGap[];
  /** Citations in the changelog that name no gap in the register (typos, or gaps of runs not recorded). */
  unknownCitations: GapCitation[];
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * The latest run of each version that carries gaps (wos-assessment/v2), by recordedAt (then id). A version whose runs
 * are all v1 has no gap list.
 */
export function latestGapRunPerVersion<R extends GapRun>(runs: R[]): Map<string, R> {
  const out = new Map<string, R>();
  for (const r of runs) {
    if (!Array.isArray(r.block.gaps)) continue;
    const key = [...out.keys()].find((k) => compareVersions(k, r.servedPaperVersion) === 0) ?? r.servedPaperVersion;
    const prev = out.get(key);
    if (!prev || prev.recordedAt < r.recordedAt || (prev.recordedAt === r.recordedAt && prev.id < r.id)) out.set(key, r);
  }
  return out;
}

/**
 * The gap register. Each gap of the latest run of each version, with its status:
 *  - addressed in vN / declined in vN: the changelog entry of a LATER version (N > the gap's version) cites its exact id
 *    under the convention above; when several later versions cite it, the newest citation decides;
 *  - open otherwise.
 * Deterministic: exact id match only, no fuzzy or model-based matching of titles.
 */
export function buildGapRegister(runs: GapRun[], changelog: ChangelogEntry[], current: string): GapRegister {
  const citations = extractGapCitations(changelog);
  const latest = latestGapRunPerVersion(runs);
  const versionsWithRuns: string[] = [];
  for (const r of runs) if (!versionsWithRuns.some((v) => compareVersions(v, r.servedPaperVersion) === 0)) versionsWithRuns.push(r.servedPaperVersion);
  versionsWithRuns.sort(compareVersions);

  const gaps: RegisterGap[] = [];
  for (const [version, run] of latest) {
    for (const g of run.block.gaps ?? []) {
      const later = citations
        .filter((c) => c.id === g.id && compareVersions(c.version, version) > 0)
        .sort((a, b) => compareVersions(a.version, b.version));
      const decisive = later.at(-1);
      const alsoReportedIn = [...latest.entries()]
        .filter(([v, r]) => compareVersions(v, version) !== 0 && (r.block.gaps ?? []).some((x) => x.id === g.id))
        .map(([v]) => v)
        .sort(compareVersions);
      gaps.push({
        id: g.id,
        title: g.title,
        concerns: g.concerns,
        part: g.part,
        severity: g.severity,
        version,
        runId: run.id,
        reportFile: run.reportFile,
        evaluator: run.block.evaluator.model,
        status: decisive ? decisive.kind : "open",
        statusIn: decisive ? decisive.version : null,
        reason: decisive?.kind === "declined" ? decisive.reason : null,
        alsoReportedIn,
      });
    }
  }
  gaps.sort(
    (a, b) => compareVersions(b.version, a.version) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const known = new Set(gaps.map((g) => g.id));
  return {
    schema: "wos-gap-register/v1",
    current,
    versions: versionsWithRuns.map((v) => {
      const run = [...latest.entries()].find(([k]) => compareVersions(k, v) === 0)?.[1] ?? null;
      return {
        version: v,
        runId: run ? run.id : null,
        runs: runs.filter((r) => compareVersions(r.servedPaperVersion, v) === 0).length,
        gaps: run ? (run.block.gaps ?? []).length : 0,
      };
    }),
    gaps,
    unknownCitations: citations.filter((c) => !known.has(c.id)),
  };
}

/**
 * The gate's warning (never a failure): high-severity gaps from the latest run of the version before `current` that the
 * current version's changelog entry neither addresses nor declines. Empty when that version has no run with gaps.
 */
export function unmentionedHighGaps(runs: GapRun[], changelog: ChangelogEntry[], current: string): { version: string; ids: string[] } | null {
  const latest = latestGapRunPerVersion(runs);
  // The newest version before `current` that has any recorded run; its latest run with gaps is the one to answer.
  const previous = runs
    .map((r) => r.servedPaperVersion)
    .filter((v) => compareVersions(v, current) < 0)
    .sort(compareVersions)
    .at(-1);
  if (!previous) return null;
  const run = [...latest.entries()].find(([k]) => compareVersions(k, previous) === 0)?.[1];
  if (!run) return null;
  const cited = new Set(
    extractGapCitations(changelog.filter((e) => compareVersions(e.version, current) === 0)).map((c) => c.id),
  );
  const ids = (run.block.gaps ?? []).filter((g) => g.severity === "high" && !cited.has(g.id)).map((g) => g.id);
  return { version: previous, ids };
}

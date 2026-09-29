/**
 * The build log, generated at build time by scripts/gen-log.mjs from the git history of main and
 * the WAVE-*-REPORT.md files. Facts only: shas, commit dates, commit subjects, report titles and counts.
 */
import log from "@/generated/build-log.json";

export type LogCommit = { sha: string; short: string; date: string; day: string; subject: string; url: string };
export type LogReport = {
  file: string;
  title: string;
  date: string | null;
  results: { pass: number; partial: number; pending: number; fail: number };
  url: string;
};
export type BuildLog = { ref: string; head: string | null; complete: boolean; count: number; commits: LogCommit[]; reports: LogReport[] };

export const buildLog = log as BuildLog;

export function lastShipped(): LogCommit | null {
  return buildLog.commits[0] ?? null;
}

/** Commits grouped by day, newest first. */
export function byDay(): { day: string; commits: LogCommit[] }[] {
  const days: { day: string; commits: LogCommit[] }[] = [];
  for (const c of buildLog.commits) {
    const last = days[days.length - 1];
    if (last && last.day === c.day) last.commits.push(c);
    else days.push({ day: c.day, commits: [c] });
  }
  return days;
}

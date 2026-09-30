/**
 * The paper's self-assessment: warOnSaaS's own reference run of the current (or any) paper version.
 *
 * Every version ships with one (paper v0.9, .github/workflows/self-assessment.yml); until its run lands, the version's
 * self-assessment is PENDING. Nothing here invents or fills a score: the latest recorded run of a version is shown as
 * recorded, and a version with no run is pending.
 */
import { selfAssessmentPending } from "@/scripts/wp-history-lib.mts";
import { RUNS, type Run } from "./assessments";
import { HISTORY, runsFor } from "./whitepaper-history";

export const CURRENT_VERSION = HISTORY.current;

/** The latest recorded run against a version (servedPaperVersion), or null. RUNS are oldest first. */
export function latestRunFor(version: string): Run | null {
  return runsFor(version).at(-1) ?? null;
}

export const CURRENT_RUN: Run | null = latestRunFor(CURRENT_VERSION);
export const CURRENT_PENDING: boolean = selfAssessmentPending(CURRENT_VERSION, RUNS);

export const PENDING_LABEL = "SELF-ASSESSMENT PENDING";

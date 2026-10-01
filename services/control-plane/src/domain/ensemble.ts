/**
 * D73 (contracts 5.21.0): an ensemble revision's provenance and stability, for the PR body, its labels and the round
 * comment. The revision's summary names its N shadow runs and their stability (verified at submission).
 */
import type { EnsembleRecord } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";

/** The ensemble record of the latest accepted revision of a document (or of the revision at `headSha`). */
export async function documentEnsemble(tx: Tx, documentId: string, headSha?: string): Promise<EnsembleRecord | null> {
  const rows = headSha
    ? await tx<{ summary: { ensemble?: EnsembleRecord } }[]>`
        select c.summary from wos.changesets c join wos.candidate_commits cc on cc.changeset_id = c.id
         where cc.commit_sha = ${headSha} and c.ok order by c.created_at desc limit 1`
    : await tx<{ summary: { ensemble?: EnsembleRecord } }[]>`
        select c.summary from wos.changesets c join wos.tasks t on t.id = c.task_id
         where t.document_id = ${documentId} and c.ok order by c.created_at desc limit 1`;
  return rows[0]?.summary.ensemble ?? null;
}

/** Markdown lines: the N runs, the majority rule, the stability against the policy's targets. */
export function ensembleBlock(e: EnsembleRecord, deps: Deps): string[] {
  const tg = deps.policy.ensemble?.stabilityTargets;
  const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;
  const row = (name: string, v: string, target: string, below: boolean) => `| ${name} | ${v} | ${target} | ${below ? "BELOW" : "ok"} |`;
  const below = new Set(e.stability.belowTarget);
  return [
    `**Ensemble (D73):** ${e.runs.length} shadow runs on one manifest, merged deterministically (strict majority: ${e.threshold} of ${e.runs.length}); ${e.decisions} decision(s) for the reviewers in the roadmap's DECISIONS.md.`,
    "",
    "| stability across the runs | value | target | |",
    "|---|---|---|---|",
    row("capabilities matched", pct(e.stability.capabilitiesMatchBp), tg ? pct(tg.capabilitiesMatchBp) : "n/a", below.has("capabilities")),
    row("features matched", pct(e.stability.featuresMatchBp), tg ? pct(tg.featuresMatchBp) : "n/a", below.has("features")),
    row(
      "weight rank correlation (Spearman)",
      String(e.stability.weightSpearman ?? "n/a"),
      tg ? String(tg.weightSpearman) : "n/a",
      below.has("weights"),
    ),
    row("sources grounded", pct(e.stability.groundingBp), tg ? pct(tg.groundingBp) : "n/a", below.has("grounding")),
    "",
    `Runs: ${e.runs.map((r) => `\`${r.agentRunId}\``).join(", ")} (each labelled shadow; the trial label applies to all).`,
  ];
}

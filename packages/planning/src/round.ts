/**
 * Round outcome (REVIEW-PROTOCOL.md section 6, step 3). Pure: the control plane has already stored both
 * sealed verdicts and resolved the prior findings every re-checker marked `resolved`.
 */
import type { ReviewVerdict } from "@waronsaas/contracts";

export type RoundOutcome = { outcome: "consensus" } | { outcome: "gaps"; openMaterialFindings: number };

export interface RoundOutcomeInput {
  astra: ReviewVerdict;
  fable: ReviewVerdict;
  /**
   * Prior-round MATERIAL findings of the subject that are still open (or disputed) after this round's
   * re-checks. Minor findings never gate (REVIEW-PROTOCOL.md section 5) and must not be passed here.
   */
  priorOpenFindingIds: string[];
  /** Findings a confirmed ruling overruled; excluded from gating from then on (section 7). */
  overruledFindingIds: string[];
}

/**
 * `consensus` iff neither verdict carries a new material finding and no prior material finding remains
 * open, overruled findings excluded. Open prior findings are the union of `priorOpenFindingIds` and every id
 * either reviewer marked `still_open` (the union guards against a caller that resolved a finding one
 * re-checker still holds open). Because a verdict is `NO_MATERIAL_GAPS` exactly when it has no material
 * finding and no `still_open` prior finding (schema refinement), this is "both verdicts NO_MATERIAL_GAPS",
 * except that a reviewer who still holds an OVERRULED finding open cannot block consensus: the ruling,
 * confirmed by a maintainer, is final for that finding.
 *
 * `openMaterialFindings` counts each reviewer's new material findings (two reviewers reporting the same
 * gap count twice: they are two findings rows) plus the distinct open prior findings.
 */
export function computeRoundOutcome(input: RoundOutcomeInput): RoundOutcome {
  const overruled = new Set(input.overruledFindingIds);
  const newMaterial = [input.astra, input.fable].reduce((n, v) => n + v.findings.filter((f) => f.severity === "material").length, 0);
  const priorOpen = new Set<string>();
  for (const id of input.priorOpenFindingIds) if (!overruled.has(id)) priorOpen.add(id);
  for (const v of [input.astra, input.fable])
    for (const p of v.priorFindings) if (p.status === "still_open" && !overruled.has(p.findingId)) priorOpen.add(p.findingId);
  const open = newMaterial + priorOpen.size;
  return open === 0 ? { outcome: "consensus" } : { outcome: "gaps", openMaterialFindings: open };
}

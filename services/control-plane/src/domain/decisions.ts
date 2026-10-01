/**
 * D73 (contracts 5.20.0): a roadmap revision lists the decisions its reviewers must rule on (Roadmap `decisions`:
 * template deviations, catalog proposals, an ensemble's disagreements). A verdict (agent seat or human seat) on such a
 * round must rule on every one (ReviewVerdict `decisionRulings`); a verdict that leaves one unruled is refused.
 */
import { ARTIFACT_PATHS, type ReviewVerdict } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";

/** The decision ids of the roadmap at the round's head (empty for other subjects, or a roadmap without decisions). */
export async function roundDecisionIds(tx: Tx, deps: Deps, round: { document_id: string | null; head_sha: string }): Promise<string[]> {
  if (!round.document_id) return [];
  const [d] = await tx<{ kind: string; slug: string | null; repo: string }[]>`
    select d.kind, t.slug, d.repo_full_name as repo from wos.documents d left join wos.targets t on t.id = d.target_id where d.id = ${round.document_id}`;
  if (d?.kind !== "roadmap" || !d.slug) return [];
  const bytes = await deps.github.readFileAt(d.repo, round.head_sha, ARTIFACT_PATHS.roadmap(d.slug));
  if (!bytes) return [];
  const parsed = deps.logic.parseRoadmapYaml(Buffer.from(bytes).toString("utf8"));
  return parsed.ok ? (parsed.value.decisions ?? []).map((x) => x.id) : [];
}

/** Decisions of the round that the verdict does not rule on. */
export async function unruledDecisions(
  tx: Tx,
  deps: Deps,
  round: { document_id: string | null; head_sha: string },
  verdict: ReviewVerdict,
): Promise<string[]> {
  const ids = await roundDecisionIds(tx, deps, round);
  const ruled = new Set((verdict.decisionRulings ?? []).map((r) => r.decisionId));
  return ids.filter((id) => !ruled.has(id));
}

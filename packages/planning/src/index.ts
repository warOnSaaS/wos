/**
 * @waronsaas/planning — roadmap / feature-contract / review-round logic (owner: planning workstream).
 * Pure: parse + validate canonical artifacts, compute round outcomes, derive ABU rows from a build graph,
 * compute progress. The control plane calls these and persists the results.
 */
import {
  NotImplementedError,
  type AgentPolicyDocument,
  type BuildGraph,
  type BuildGraphErrorCode,
  type CatalogEntry,
  type FeatureContract,
  type Inventory,
  type RepoManifest,
  type ReviewVerdict,
  type Roadmap,
} from "@waronsaas/contracts";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: Array<{ path: string; message: string }> };

export function parseRoadmapYaml(text: string): ParseResult<Roadmap> {
  void text;
  throw new NotImplementedError("parseRoadmapYaml");
}
export function parseInventoryYaml(text: string): ParseResult<Inventory> {
  void text;
  throw new NotImplementedError("parseInventoryYaml");
}
export function parseFeatureContractYaml(text: string): ParseResult<FeatureContract> {
  void text;
  throw new NotImplementedError("parseFeatureContractYaml");
}
export function parseBuildGraphYaml(text: string): ParseResult<BuildGraph> {
  void text;
  throw new NotImplementedError("parseBuildGraphYaml");
}

/**
 * Deterministic roadmap checks beyond the schema (ROADMAP-PROTOCOL.md "Validation"): every inventory item in
 * exactly one capability or excluded; a mapped capability's feature refs cover its items exactly; every
 * referenced feature exists in the catalog at the PR head or is in newCatalogFeatures with a catalog file;
 * no reference to an aliased catalog feature; version = previous merged version + 1.
 */
export function validateRoadmap(
  roadmap: Roadmap,
  inventory: Inventory,
  catalog: ReadonlyMap<string, CatalogEntry>,
  previousMergedVersion: number | null,
): Array<{ code: string; message: string }> {
  void roadmap;
  void inventory;
  void catalog;
  void previousMergedVersion;
  throw new NotImplementedError("validateRoadmap");
}

export function parseCatalogEntryYaml(text: string): ParseResult<CatalogEntry> {
  void text;
  throw new NotImplementedError("parseCatalogEntryYaml");
}

export interface BuildGraphIssue {
  code: BuildGraphErrorCode;
  abu: string | null;
  message: string;
}

/** Deterministic build-graph validation (BUILD-PROTOCOL.md "Build graph validity"). */
export function validateBuildGraph(
  graph: BuildGraph,
  contract: FeatureContract,
  repo: RepoManifest,
  estimateBuilderContextTokens: (abuKey: string) => number,
  policy: AgentPolicyDocument,
): BuildGraphIssue[] {
  void graph;
  void contract;
  void repo;
  void estimateBuilderContextTokens;
  void policy;
  throw new NotImplementedError("validateBuildGraph");
}

export type RoundOutcome = { outcome: "consensus" } | { outcome: "gaps"; openMaterialFindings: number };

/** Combines the two revealed verdicts plus prior open findings and rulings into the round outcome. */
export function computeRoundOutcome(input: {
  astra: ReviewVerdict;
  fable: ReviewVerdict;
  priorOpenFindingIds: string[];
  overruledFindingIds: string[];
}): RoundOutcome {
  void input;
  throw new NotImplementedError("computeRoundOutcome");
}

/** Progress is NOT computed here: use computeAppProgress from @waronsaas/contracts (progress.ts). */

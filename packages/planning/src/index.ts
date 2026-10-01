/**
 * @waronsaas/planning — roadmap / feature-contract / review-round logic (owner: planning workstream).
 * Pure: parse + validate canonical artifacts, compute round outcomes. The control plane calls these and
 * persists the results. Progress is NOT computed here: use computeAppProgress from @waronsaas/contracts
 * (progress.ts).
 */
import {
  BuildGraph,
  CatalogEntry,
  FeatureContract,
  Inventory,
  type Inventory as InventoryT,
  Roadmap,
  type BuildGraph as BuildGraphT,
  type CatalogEntry as CatalogEntryT,
  type FeatureContract as FeatureContractT,
  type Roadmap as RoadmapT,
} from "@waronsaas/contracts";
import { type ParseResult, parseYamlWith } from "./yaml.js";

export {
  type BuildGraphContext,
  type BuildGraphIssue,
  REPOSITORY_FAMILIES,
  type RepositoryFamily,
  validateBuildGraph,
} from "./build-graph.js";
export { type ArtifactFile, roadmapBundleToFiles } from "./bundle.js";
export { CONTRACT_ERROR_CODES, type ContractErrorCode, type ContractIssue, validateFeatureContract } from "./contract.js";
export { type FixUnitIssue, validateFixUnit } from "./fix-unit.js";
export { globMatches, scopeCanTouchGlob } from "./globs.js";
export { ROADMAP_ERROR_CODES, type RoadmapErrorCode, type RoadmapIssue, rubricWeights, validateRoadmap } from "./roadmap.js";
export { computeRoundOutcome, type RoundOutcome, type RoundOutcomeInput } from "./round.js";
export { formatPath, MAX_YAML_ALIASES, MAX_YAML_BYTES, type ParseError, type ParseResult, parseYamlWith } from "./yaml.js";

export function parseRoadmapYaml(text: string): ParseResult<RoadmapT> {
  return parseYamlWith(Roadmap, text);
}
export function parseInventoryYaml(text: string): ParseResult<InventoryT> {
  return parseYamlWith(Inventory, text);
}
export function parseFeatureContractYaml(text: string): ParseResult<FeatureContractT> {
  return parseYamlWith(FeatureContract, text);
}
export function parseBuildGraphYaml(text: string): ParseResult<BuildGraphT> {
  return parseYamlWith(BuildGraph, text);
}
export function parseCatalogEntryYaml(text: string): ParseResult<CatalogEntryT> {
  return parseYamlWith(CatalogEntry, text);
}

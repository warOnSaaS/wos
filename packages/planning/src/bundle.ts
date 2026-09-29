/**
 * A `RoadmapBundle` (docs/roadmap/waronsaas.roadmap.json, TGT-00) converted to the files a roadmap PR
 * carries in a repository: INVENTORY.yaml, ROADMAP.yaml and one catalog/<key>.yaml per catalog entry
 * (ARTIFACT_PATHS). The bundle's proposed requirements are future Feature Contract content and are not
 * roadmap files, so they are not written.
 */
import { ARTIFACT_PATHS, type RoadmapBundle } from "@waronsaas/contracts";
import { stringify } from "yaml";

export interface ArtifactFile {
  path: string;
  content: string;
}

const toYaml = (value: unknown) => stringify(value, { lineWidth: 0, minContentWidth: 0, aliasDuplicateObjects: false });

/** Deterministic: same bundle, same files in the same (path) order. */
export function roadmapBundleToFiles(bundle: RoadmapBundle): ArtifactFile[] {
  const target = bundle.roadmap.target;
  const files: ArtifactFile[] = [
    { path: ARTIFACT_PATHS.inventory(target), content: toYaml(bundle.inventory) },
    { path: ARTIFACT_PATHS.roadmap(target), content: toYaml(bundle.roadmap) },
    ...bundle.catalog.map((c) => ({ path: ARTIFACT_PATHS.catalogEntry(c.key), content: toYaml(c) })),
  ];
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

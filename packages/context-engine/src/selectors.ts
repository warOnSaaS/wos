import type { AbuSpec, ArtifactSelector } from "@waronsaas/contracts";

export interface BuilderSelectorInput {
  /** The product repo, e.g. "waronsaas/product". */
  repo: string;
  feature: string;
  abu: AbuSpec;
  /** `wos:policy/builder@<policyVersion>` and its sha256 (see renderPolicyDocument). */
  policyDocument: { ref: string; sha256: string };
  /** `wos:task/<taskId>` and its sha256. */
  taskDocument: { ref: string; sha256: string };
  /** On revisions: `wos:findings/<attemptId>@<n>`. */
  findings?: { ref: string; sha256: string } | null;
  /** After `ci_failed`: `wos:ci/<attemptId>@<headSha>`. */
  ci?: { ref: string; sha256: string } | null;
  /** A local repair run: add the optional `local:verification-output` local document (item 7a). */
  localVerificationOutput?: boolean;
}

/** A glob that matches exactly this path (picomatch syntax characters escaped). */
export function literalGlob(path: string): string {
  return path.replace(/[\\*?[\]{}()!+@|]/g, (c) => `\\${c}`);
}

/**
 * The builder's ordered artifact selectors (CONTEXT-PROTOCOL.md section 3, `tpl.builder.v1`):
 * policy, task, contract, wos.json, the existing files of every write scope, the acceptance tests that
 * exist at base, revision documents, then the optional read globs and the build graph.
 * The control plane issues plans from this, and planning measures ABU size with it.
 */
export function builderArtifactSelectors(input: BuilderSelectorInput): ArtifactSelector[] {
  const { repo, feature, abu } = input;
  const serverDoc = (d: { ref: string; sha256: string }, required: boolean): ArtifactSelector => ({
    kind: "server_document",
    ref: d.ref,
    sha256: d.sha256,
    required,
  });
  const selectors: ArtifactSelector[] = [
    serverDoc(input.policyDocument, true),
    serverDoc(input.taskDocument, true),
    { kind: "repo_file", repo, path: `features/${feature}/CONTRACT.yaml`, required: true },
    { kind: "repo_file", repo, path: "wos.json", required: true },
  ];
  // Existing files only: a required glob may match nothing (new files), a required repo_file may not.
  for (const scope of abu.scope.write) {
    const glob = scope.endsWith("/**") ? `${literalGlob(scope.slice(0, -3))}/**` : literalGlob(scope);
    selectors.push({ kind: "repo_glob", repo, glob, required: true });
  }
  for (const test of abu.acceptance.tests) selectors.push({ kind: "repo_glob", repo, glob: literalGlob(test), required: true });
  if (input.findings) selectors.push(serverDoc(input.findings, true));
  if (input.ci) selectors.push(serverDoc(input.ci, true));
  if (input.localVerificationOutput) selectors.push({ kind: "local_document", ref: "local:verification-output", required: false });
  for (const glob of abu.scope.read) selectors.push({ kind: "repo_glob", repo, glob, required: false });
  selectors.push({ kind: "repo_file", repo, path: `features/${feature}/BUILD-GRAPH.yaml`, required: false });
  return selectors;
}

type Doc = { ref: string; sha256: string };
const doc = (d: Doc, required: boolean): ArtifactSelector => ({ kind: "server_document", ref: d.ref, sha256: d.sha256, required });

export interface RoadmapSelectorInput {
  role: "roadmap_author" | "roadmap_reviewer_astra" | "roadmap_reviewer_fable";
  /** The repository holding roadmaps/ and catalog/ (the product repo, or waronsaas/wos for TGT-00). */
  repo: string;
  target: string;
  policyDocument: Doc;
  taskDocument: Doc;
  /** `wos:catalog-index@<sha>`. */
  catalogIndex: Doc;
  /** After round 1: authors get `@<n>`, reviewers `@<n-1>` (revealed rounds only). */
  findings?: Doc | null;
  /** `wos:validator-errors/<taskId>` when present (author). */
  validatorErrors?: Doc | null;
  /** `wos:proposals/<target>` (author). */
  proposals?: Doc | null;
  /** Catalog keys the roadmap already references (optional `catalog/<key>.yaml`, in this order). */
  referencedCatalogKeys?: string[];
}

/**
 * Roadmap author and reviewer selectors (CONTEXT-PROTOCOL.md sections 3 and 9). INVENTORY.yaml and
 * ROADMAP.yaml carry the D13 surfaces (with evidence), per-surface weights and journeys, so they are
 * REQUIRED and never truncated: reviewers read them at the round head (they must exist); an author's first
 * draft has none yet, so for the author they are required globs that may match nothing.
 */
export function roadmapArtifactSelectors(input: RoadmapSelectorInput): ArtifactSelector[] {
  const { repo, target } = input;
  const author = input.role === "roadmap_author";
  const docs = [`roadmaps/${target}/INVENTORY.yaml`, `roadmaps/${target}/ROADMAP.yaml`];
  const selectors: ArtifactSelector[] = [doc(input.policyDocument, true), doc(input.taskDocument, true)];
  for (const path of docs) {
    selectors.push(
      author ? { kind: "repo_glob", repo, glob: literalGlob(path), required: true } : { kind: "repo_file", repo, path, required: true },
    );
  }
  selectors.push(doc(input.catalogIndex, true));
  if (input.findings) selectors.push(doc(input.findings, true));
  if (author && input.validatorErrors) selectors.push(doc(input.validatorErrors, true));
  if (author && input.proposals) selectors.push(doc(input.proposals, true));
  for (const key of input.referencedCatalogKeys ?? [])
    selectors.push({ kind: "repo_file", repo, path: `catalog/${key}.yaml`, required: false });
  return selectors;
}

export interface FeatureSelectorInput {
  role: "feature_author" | "feature_reviewer_astra" | "feature_reviewer_fable";
  /** The repository holding catalog/ and features/ (the contract repo). */
  repo: string;
  feature: string;
  policyDocument: Doc;
  taskDocument: Doc;
  /**
   * `wos:app-refs/<featureKey>`: every referencing app's roadmap ref WITH its surfaces, surface weights and
   * journeys (D13), and for contract version > 1 every app in impactedTargets. Always required.
   */
  appRefs: Doc;
  findings?: Doc | null;
  validatorErrors?: Doc | null;
  proposals?: Doc | null;
  /** Optional `features/<dep>/CONTRACT.yaml` of each dependsOnFeatures entry. */
  dependsOnFeatures?: string[];
}

/**
 * Feature author and reviewer selectors (CONTEXT-PROTOCOL.md section 3, feature_author items 1-10, reviewers
 * the same at the round head, and section 9: the app refs carry surfaces and journeys so requirements can be
 * tagged per surface and journeys checked).
 */
export function featureArtifactSelectors(input: FeatureSelectorInput): ArtifactSelector[] {
  const { repo, feature } = input;
  const selectors: ArtifactSelector[] = [
    doc(input.policyDocument, true),
    doc(input.taskDocument, true),
    { kind: "repo_file", repo, path: `catalog/${feature}.yaml`, required: true },
    doc(input.appRefs, true),
    // At the head, if they exist (a first draft has neither).
    { kind: "repo_glob", repo, glob: literalGlob(`features/${feature}/CONTRACT.yaml`), required: true },
    { kind: "repo_glob", repo, glob: literalGlob(`features/${feature}/BUILD-GRAPH.yaml`), required: true },
    { kind: "repo_file", repo, path: "wos.json", required: true },
  ];
  if (input.findings) selectors.push(doc(input.findings, true));
  if (input.validatorErrors) selectors.push(doc(input.validatorErrors, true));
  if (input.proposals) selectors.push(doc(input.proposals, true));
  for (const dep of input.dependsOnFeatures ?? [])
    selectors.push({ kind: "repo_file", repo, path: `features/${dep}/CONTRACT.yaml`, required: false });
  selectors.push({ kind: "repo_glob", repo, glob: `modules/${literalGlob(feature)}/**`, required: false });
  return selectors;
}

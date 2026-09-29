import type { AbuSpec, ArtifactSelector } from "@waronsaas/contracts";

export interface BuilderSelectorInput {
  /** The product repo, e.g. "waronsaas/suite". */
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

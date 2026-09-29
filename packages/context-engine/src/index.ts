/**
 * @waronsaas/context-engine — deterministic, role-specific context assembly (owner: context-policy workstream).
 * Same inputs => byte-identical prompt and manifest. No clock, no randomness, no environment reads.
 */
import { NotImplementedError, type AgentPolicyDocument, type ContextManifest, type ContextPlan } from "@waronsaas/contracts";

/** Read-only view of the source repo at the plan's source commit, plus server documents. */
export interface SnapshotReader {
  /** Returns null when the path does not exist at the commit. */
  readFile(path: string): Promise<{ bytes: Uint8Array; gitBlobOid: string } | null>;
  /** Sorted list of paths matching a glob at the commit. */
  listFiles(glob: string): Promise<string[]>;
  readServerDocument(ref: string): Promise<Uint8Array>;
}

export interface BuiltContext {
  manifest: ContextManifest;
  /** The full prompt written to the agent CLI's stdin. */
  prompt: string;
}

/** Conservative token estimate used for every budget decision (policy.tokenEstimator). */
export function estimateTokens(text: string, policy: AgentPolicyDocument): number {
  return Math.ceil(text.length / policy.tokenEstimator.charsPerToken) + policy.tokenEstimator.perArtifactOverheadTokens;
}

export async function buildContext(plan: ContextPlan, reader: SnapshotReader, policy: AgentPolicyDocument): Promise<BuiltContext> {
  void plan;
  void reader;
  void policy;
  throw new NotImplementedError("buildContext");
}

/** Server side: checks a posted manifest against the plan it was issued (role/model/reasoning/source/budget/required artifacts). */
export function checkManifestAgainstPlan(manifest: ContextManifest, plan: ContextPlan): { ok: true } | { ok: false; reasons: string[] } {
  void manifest;
  void plan;
  throw new NotImplementedError("checkManifestAgainstPlan");
}

/** RFC 8785 canonical JSON + sha256, shared by manifests, agent runs and provenance. */
export function canonicalSha256(value: unknown): string {
  void value;
  throw new NotImplementedError("canonicalSha256");
}

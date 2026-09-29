import { z } from "zod";
import { AgentRole, ModelRef, OutputSchemaId, ProviderId, ReasoningLevel, ReviewerSlot } from "./agent-policy.js";
import {
  AbuKey,
  FeatureKey,
  GitSha,
  RepoFullName,
  RepoPath,
  RequirementKey,
  Sha256,
  TargetSlug,
  Timestamp,
  ToolName,
  Uuid,
} from "./primitives.js";

// ---------------------------------------------------------------------------------------------
// Task kinds (everything leasable). See DOMAIN-MODEL.md "Task".
// ---------------------------------------------------------------------------------------------

export const TaskKind = z.enum([
  "roadmap_author",
  "roadmap_review",
  "feature_author",
  "feature_review",
  "abu_build",
  "abu_revision",
  "implementation_review",
  "conflict_resolution",
]);
export type TaskKind = z.infer<typeof TaskKind>;

// ---------------------------------------------------------------------------------------------
// Context plan (server -> client) and Context Manifest (client -> server, immutable).
// ---------------------------------------------------------------------------------------------

export const ArtifactSelector = z.discriminatedUnion("kind", [
  /** A file in the source repo at the source commit. */
  z.object({ kind: z.literal("repo_file"), repo: RepoFullName, path: RepoPath, required: z.boolean() }),
  /** Every file matching a glob in the source repo at the source commit (sorted by path). */
  z.object({ kind: z.literal("repo_glob"), repo: RepoFullName, glob: z.string(), required: z.boolean() }),
  /** A server-provided document (finding ledger, task spec, prior round summary), fetched by id. */
  /**
   * A server-provided document fetched by ref with GET /v1/leases/:id/documents/:ref (route getLeaseDocument).
   * Ref forms are listed in CONTEXT-PROTOCOL.md section 2 (e.g. "wos:task/<taskId>",
   * "wos:findings/<subjectId>@<roundNumber>" for revealed rounds only). The form
   * "wos:verdict/<roundId>/<slot>" names a sealed verdict and is NEVER placed in a plan; the server rejects
   * any server_document ref that is not in the lease's plan.
   */
  z.object({ kind: z.literal("server_document"), ref: z.string(), sha256: Sha256, required: z.boolean() }),
  /**
   * A document produced on the contributor's machine. V1 has one: "local:verification-output", the
   * failing local check output a builder's repair run sees (verify_failed_locally). Its sha256 is
   * recorded in the manifest; the server cannot verify its content and treats it as evidence only.
   */
  z.object({ kind: z.literal("local_document"), ref: z.literal("local:verification-output"), required: z.literal(false) }),
]);
export type ArtifactSelector = z.infer<typeof ArtifactSelector>;

export const ContextPlan = z.object({
  schema: z.literal("wos-context-plan.v1"),
  taskId: Uuid,
  /** Copied into ContextManifest.task.kind (contracts 2.0.0, B-0001-context-policy). */
  taskKind: TaskKind,
  leaseId: Uuid,
  role: AgentRole,
  model: ModelRef,
  modelId: z.string(),
  provider: ProviderId,
  reasoning: ReasoningLevel,
  policyVersion: z.string(),
  contextFormatVersion: z.string(),
  /** Exactly one of target (roadmap work) and feature (feature work) is set (contracts 3.0.0, see TaskView). */
  target: TargetSlug.nullable(),
  feature: FeatureKey.nullable(),
  abu: AbuKey.nullable(),
  attemptId: Uuid.nullable(),
  roundId: Uuid.nullable(),
  /**
   * The round number when roundId is set (contracts 3.1.0, B-0003-context-policy). Reviewer plans must
   * carry it; checkManifestAgainstPlan fails closed (ROUND_NUMBER_REQUIRED) when a reviewer plan
   * references wos:findings and it is absent.
   */
  roundNumber: z.number().int().positive().nullable().optional(),
  /**
   * The snapshot the agent works on. For abu_build and abu_revision plans this commit IS the submission's
   * parentCommit: the attempt base for the first build, the current candidate head for a revision, or the
   * new default-branch head after a rebase (B-0004-github-build).
   */
  source: z.object({ repo: RepoFullName, commit: GitSha }),
  /** Ordered: the engine includes artifacts in this order until the budget is exhausted. */
  artifacts: z.array(ArtifactSelector),
  /** Globs that must never be included even if selected (secrets, other slot's current verdict). */
  excludeGlobs: z.array(z.string()),
  promptTemplateId: z.string(),
  budgetTokens: z.number().int().positive(),
  outputSchema: OutputSchemaId,
  /** Shell commands the builder may run (become --allowedTools Bash(...) rules). */
  allowedCommands: z.array(z.array(z.string())).default([]),
});
export type ContextPlan = z.infer<typeof ContextPlan>;

export const ExclusionReason = z.enum([
  "over_budget",
  "policy_excluded",
  "not_in_read_scope",
  "other_slot_current_round",
  "binary",
  "secret_pattern",
  "missing_optional",
]);

export const ManifestArtifact = z.object({
  kind: z.enum(["repo_file", "server_document", "local_document", "task_spec", "policy", "prompt_template"]),
  /** repo path or server ref. */
  ref: z.string(),
  /** git blob oid at the source commit for repo files, so the server can verify via the Trees API. */
  gitBlobOid: GitSha.nullable(),
  sha256: Sha256,
  bytes: z.number().int().nonnegative(),
  estTokens: z.number().int().nonnegative(),
});
export type ManifestArtifact = z.infer<typeof ManifestArtifact>;

export const ContextManifest = z.object({
  schema: z.literal("wos-context-manifest.v1"),
  contextFormatVersion: z.string(),
  contractsVersion: z.string(),
  policyVersion: z.string(),
  role: AgentRole,
  provider: ProviderId,
  model: z.object({ ref: ModelRef, modelId: z.string() }),
  reasoning: ReasoningLevel,
  target: TargetSlug.nullable(),
  feature: FeatureKey.nullable(),
  task: z.object({ id: Uuid, kind: TaskKind }),
  abu: AbuKey.nullable(),
  attemptId: Uuid.nullable(),
  roundId: Uuid.nullable(),
  source: z.object({ repo: RepoFullName, commit: GitSha }),
  promptTemplate: z.object({ id: z.string(), sha256: Sha256 }),
  artifacts: z.array(ManifestArtifact),
  excluded: z.array(z.object({ ref: z.string(), reason: ExclusionReason })),
  budget: z.object({ limitTokens: z.number().int().positive(), estimatedTokens: z.number().int().nonnegative() }),
  outputSchema: OutputSchemaId,
  renderedPromptSha256: Sha256,
  /** sha256 of the canonical JSON (RFC 8785 JCS) of this object without `manifestSha256`. */
  manifestSha256: Sha256,
});
export type ContextManifest = z.infer<typeof ContextManifest>;

// ---------------------------------------------------------------------------------------------
// Agent outputs (the JSON schema passed to --json-schema / --output-schema is generated from these).
// ---------------------------------------------------------------------------------------------

export const FindingCategory = z.enum([
  "missing_scope",
  "incorrect",
  "ambiguous",
  "untestable",
  "unsafe_parallelism",
  "security",
  "data_loss",
  "contract_violation",
  "scope_violation",
  "test_gap",
  "other",
]);

export const Evidence = z.object({
  path: z.string().nullable(),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
  quote: z.string().max(2000).nullable(),
});

export const ReviewVerdict = z
  .object({
    schema: z.literal("review-verdict.v1"),
    verdict: z.enum(["NO_MATERIAL_GAPS", "MATERIAL_GAPS"]),
    summary: z.string().min(1).max(4000),
    findings: z
      .array(
        z.object({
          localId: z.string().regex(/^f\d{1,3}$/),
          severity: z.enum(["material", "minor"]),
          category: FindingCategory,
          title: z.string().min(1).max(200),
          detail: z.string().min(1).max(8000),
          evidence: z.array(Evidence).max(20),
          suggestedResolution: z.string().max(4000),
        }),
      )
      .max(50),
    /** Status of every finding still open from prior rounds (the reviewer re-checks them). */
    priorFindings: z.array(z.object({ findingId: Uuid, status: z.enum(["resolved", "still_open"]), note: z.string().max(2000) })),
  })
  .refine(
    (v) =>
      (v.verdict === "NO_MATERIAL_GAPS") ===
      (!v.findings.some((f) => f.severity === "material") && !v.priorFindings.some((p) => p.status === "still_open")),
    { message: "verdict must be NO_MATERIAL_GAPS iff there are no material findings and no still_open prior findings" },
  );
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const AuthorSummary = z.object({
  schema: z.literal("author-summary.v1"),
  summary: z.string().min(1).max(4000),
  responses: z.array(z.object({ findingId: Uuid, action: z.enum(["fixed", "disputed"]), note: z.string().min(1).max(4000) })),
  proposalsAddressed: z.array(Uuid),
});
export type AuthorSummary = z.infer<typeof AuthorSummary>;

export const BuildSummary = z.object({
  schema: z.literal("build-summary.v1"),
  summary: z.string().min(1).max(4000),
  requirementsCovered: z.array(RequirementKey),
  responses: z.array(z.object({ findingId: Uuid, action: z.enum(["fixed", "disputed"]), note: z.string().min(1).max(4000) })),
  /** Anything the builder believes is wrong with the ABU itself (feeds blockers). */
  abuConcerns: z.array(z.string().max(2000)),
});
export type BuildSummary = z.infer<typeof BuildSummary>;

export const Ruling = z.object({
  schema: z.literal("ruling.v1"),
  rulings: z.array(
    z.object({
      findingId: Uuid,
      decision: z.enum(["upheld", "overruled"]),
      rationale: z.string().min(20).max(8000),
    }),
  ),
  /** For blockers: the minimal contract change proposed, as prose. */
  proposedChange: z.string().max(20000).nullable(),
});
export type Ruling = z.infer<typeof Ruling>;

// ---------------------------------------------------------------------------------------------
// Changeset: the ONLY way code/doc changes reach GitHub. The server builds the commit from it.
// ---------------------------------------------------------------------------------------------

export const ChangesetFile = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    path: RepoPath,
    /** Only regular files. Symlinks (120000) and submodules (160000) are rejected by construction. */
    mode: z.enum(["100644", "100755"]),
    contentBase64: z.string(),
    sha256: Sha256,
    bytes: z.number().int().nonnegative(),
  }),
  z.object({ op: z.literal("delete"), path: RepoPath }),
]);
export type ChangesetFile = z.infer<typeof ChangesetFile>;

/**
 * A signed submission (D9). Contributors never push: the control plane validates this, and the
 * GitHub App turns it into a commit. `submissionSha256` is the "diff hash": sha256 of the JCS
 * canonical JSON of { parentCommit, files: [{path, op, mode, sha256}] sorted by path }. Reviews are
 * bound to it and to the resulting candidate head sha; qualification checks both are unchanged.
 */
export const Changeset = z.object({
  schema: z.literal("wos-changeset.v1"),
  taskId: Uuid,
  leaseId: Uuid,
  deviceId: Uuid,
  /** Commit the changes apply to: the lease's immutable base, or the current candidate head for revisions. */
  parentCommit: GitSha,
  /** The accepted Context Manifest of the agent run that produced this submission. */
  manifestSha256: Sha256,
  /** The diff hash, exactly canonical.ts submissionSha256 (C-3). */
  submissionSha256: Sha256,
  files: z.array(ChangesetFile).min(1).max(500),
  /** The agent's structured output for this submission. */
  summary: z.union([AuthorSummary, BuildSummary]),
  localVerification: z
    .array(z.object({ id: z.string(), exitCode: z.number().int(), durationMs: z.number().int().nonnegative(), outputSha256: Sha256 }))
    .default([]),
  /** Ed25519 signature, base64 of 64 bytes, over changesetSigningPayload (canonical.ts C-4) with the device key (C-5). */
  signature: z.string().min(1),
});
export type Changeset = z.infer<typeof Changeset>;

export const ChangesetErrorCode = z.enum([
  "PATH_INVALID",
  "OUT_OF_SCOPE",
  "PROTECTED_PATH",
  "WORKFLOW_FILE",
  "LOCKFILE_WITHOUT_RESOURCE",
  "MIGRATION_WITHOUT_RESOURCE",
  "TOOLCHAIN_WITHOUT_RESOURCE",
  "CASE_COLLISION",
  "HASH_MISMATCH",
  "TOO_LARGE",
  "PARENT_MISMATCH",
  "GENERATED_PATH",
  "SYMLINK_OR_SPECIAL_FILE",
  "SUBMISSION_HASH_MISMATCH",
  "MANIFEST_MISMATCH",
  "SIGNATURE_INVALID",
  "SECRET_DETECTED",
  "DELETE_MISSING_FILE",
  "EMPTY_DIFF",
]);
export type ChangesetErrorCode = z.infer<typeof ChangesetErrorCode>;

export const ChangesetValidation = z.object({
  ok: z.boolean(),
  errors: z.array(z.object({ code: ChangesetErrorCode, path: z.string().nullable(), message: z.string() })),
});
export type ChangesetValidation = z.infer<typeof ChangesetValidation>;

// ---------------------------------------------------------------------------------------------
// Agent run attestation (client-signed; see SECURITY.md "What attestation proves").
// ---------------------------------------------------------------------------------------------

export const AgentRunRecord = z.object({
  schema: z.literal("wos-agent-run.v1"),
  leaseId: Uuid,
  deviceId: Uuid,
  manifestSha256: Sha256,
  provider: ProviderId,
  cliVersion: z.string(),
  authMethod: z.string().nullable(),
  modelIdRequested: z.string(),
  /** As reported by the CLI's own event stream; null if the CLI did not report it. */
  modelIdReported: z.string().nullable(),
  reasoningRequested: ReasoningLevel,
  /** sha256 of the argv (prompt excluded, placeholders filled). */
  argvSha256: Sha256,
  startedAt: Timestamp,
  endedAt: Timestamp,
  exitCode: z.number().int(),
  transcriptSha256: Sha256,
  outputSha256: Sha256,
  usage: z.object({ inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable() }),
  /** Ed25519 signature, base64 of 64 bytes, over agentRunSigningPayload (canonical.ts C-4) with the device key (C-5). */
  signature: z.string(),
});
export type AgentRunRecord = z.infer<typeof AgentRunRecord>;

/** Provider readiness reported by `wos status` / Desktop and stored as an attestation. */
export const ProviderAttestation = z.object({
  provider: ProviderId,
  installed: z.boolean(),
  cliVersion: z.string().nullable(),
  signedIn: z.boolean(),
  authMethod: z.string().nullable(),
  models: z.array(ModelRef),
  checkedAt: Timestamp,
});
export type ProviderAttestation = z.infer<typeof ProviderAttestation>;

/**
 * The device's toolchain, reported by `wos status` / Desktop (D13). Matched against a repo's path-based
 * `toolchainRequirements` at claim time: e.g. an ABU touching apps/mobile/ios/** needs os "macos" and
 * tool "xcode" >= the repo's minVersion. An attestation, like ProviderAttestation (SECURITY.md S-13).
 */
export const ToolchainAttestation = z.object({
  os: z.enum(["macos", "linux", "windows"]),
  osVersion: z.string().min(1),
  tools: z.array(z.object({ name: ToolName, version: z.string().min(1) })),
  checkedAt: Timestamp,
});
export type ToolchainAttestation = z.infer<typeof ToolchainAttestation>;

export const ReviewIndependence = z.enum(["independent", "bootstrap_maintainer", "bootstrap_self"]);
export type ReviewIndependence = z.infer<typeof ReviewIndependence>;

// ---------------------------------------------------------------------------------------------
// Provenance record (one per official PR; also embedded in the PR body and commit trailers).
// ---------------------------------------------------------------------------------------------

export const ProvenanceRecord = z.object({
  schema: z.literal("wos-provenance.v1"),
  contractsVersion: z.string(),
  subject: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("implementation"), attemptId: Uuid, abu: AbuKey }),
    z.object({ kind: z.literal("roadmap"), documentId: Uuid, target: TargetSlug }),
    z.object({ kind: z.literal("feature_contract"), documentId: Uuid, feature: FeatureKey }),
  ]),
  repo: RepoFullName,
  /**
   * The real PR number. The App opens the PR first, then fills this field, renders the provenance section
   * and PATCHes the PR body; the control plane stores the record with the number returned by
   * openPullRequest, so the hash in the PR body and in wos.provenance_records agree (B-0002-github-build).
   */
  prNumber: z.number().int().positive(),
  headSha: GitSha,
  baseSha: GitSha,
  authors: z.array(z.object({ accountId: Uuid, githubLogin: z.string(), role: AgentRole })),
  agentRuns: z.array(
    z.object({
      id: Uuid,
      role: AgentRole,
      model: z.string(),
      /** D15: which CLI ran it (a builder may be Opus via claude or Astra via codex). Optional for 4.0 producers. */
      provider: ProviderId.optional(),
      reasoning: ReasoningLevel,
      manifestSha256: Sha256,
    }),
  ),
  reviews: z.array(
    z.object({
      slot: ReviewerSlot,
      reviewerLogin: z.string(),
      model: z.string(),
      reasoning: ReasoningLevel,
      verdict: z.enum(["NO_MATERIAL_GAPS", "MATERIAL_GAPS"]),
      headSha: GitSha,
      roundNumber: z.number().int().positive(),
      independence: ReviewIndependence,
    }),
  ),
  ci: z.array(z.object({ checkSuiteId: z.number().int(), conclusion: z.string(), headSha: GitSha })),
  qualifiedAt: Timestamp,
});
export type ProvenanceRecord = z.infer<typeof ProvenanceRecord>;

/** Commit trailers the GitHub App writes on every official commit. */
export const COMMIT_TRAILERS = {
  task: "wOS-Task",
  attempt: "wOS-Attempt",
  abu: "wOS-Abu",
  manifest: "wOS-Manifest",
  contributor: "wOS-Contributor",
} as const;

import { z } from "zod";
import { SemVer } from "./primitives.js";

/**
 * Agent Policy: machine-readable rules for every agent role (spec Agent 6: "Reviewer
 * requirements must be represented as machine-readable Agent Policies rather than
 * hard-coded prompt prose"). The V1 document is src/data/agent-policy.v1.json.
 *
 * The policy is evaluated in two places with the same code (@waronsaas/agent-policy):
 *   - control plane, at claim time (eligibility + independence) and at start time
 *     (the posted context manifest must match what the policy requires);
 *   - the local orchestrator, to build the exact CLI invocation.
 */

export const AgentRole = z.enum([
  "roadmap_author",
  "roadmap_reviewer_astra",
  "roadmap_reviewer_fable",
  "feature_author",
  "feature_reviewer_astra",
  "feature_reviewer_fable",
  "builder",
  "implementation_reviewer_astra",
  "implementation_reviewer_fable",
  "conflict_resolver",
]);
export type AgentRole = z.infer<typeof AgentRole>;

/** Reviewer slot: every review round needs exactly one verdict per slot. */
export const ReviewerSlot = z.enum(["astra", "fable"]);
export type ReviewerSlot = z.infer<typeof ReviewerSlot>;

export const ProviderId = z.enum(["claude_cli", "codex_cli"]);
export type ProviderId = z.infer<typeof ProviderId>;

/** Stable model reference used everywhere in wOS; mapped to a provider model id in the policy. */
/** "sol" (gpt-6-sol) is allowed for builders only (D15 addition); the per-role lists are policy data. */
export const ModelRef = z.enum(["fable", "opus", "astra", "sol"]);
export type ModelRef = z.infer<typeof ModelRef>;

/**
 * Union of reasoning level names across providers. Each model lists which it supports, in
 * ascending order. Verified locally 2026-09-29:
 *   claude 2.1.284  `--effort <level>`: low, medium, high, xhigh, max
 *   codex-cli 0.155.0 `codex debug models`, gpt-6-astra: low, medium, high, xhigh, max, ultra
 */
export const ReasoningLevel = z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]);
export type ReasoningLevel = z.infer<typeof ReasoningLevel>;

export const ModelSpec = z.object({
  ref: ModelRef,
  provider: ProviderId,
  /** Exact id passed to the CLI (`--model` for claude, `--model`/`-m` for codex). */
  modelId: z.string().min(1),
  displayName: z.string(),
  /** Ascending. */
  reasoningLevels: z.array(ReasoningLevel).min(1),
  /** What "maximum available reasoning" means for this model in wOS. */
  maxReasoning: ReasoningLevel,
  /** Levels wOS never uses for this model, with the reason in `notes`. */
  forbiddenReasoning: z.array(ReasoningLevel).default([]),
  /** Context window assumed for budget maths. Conservative; UNVERIFIED values are marked in notes. */
  contextWindowTokens: z.number().int().positive(),
  notes: z.string().default(""),
});
export type ModelSpec = z.infer<typeof ModelSpec>;

/** One argv token template. `{name}` placeholders are filled by @waronsaas/agent-policy. */
export const ArgTemplate = z.string();

export const ProviderSpec = z.object({
  id: ProviderId,
  binary: z.string(),
  /** Minimum CLI version wOS was verified against. */
  minVersion: SemVer,
  versionCommand: z.array(z.string()),
  /** How to detect the user is signed in without reading credentials. */
  authCheckCommand: z.array(z.string()).nullable(),
  /**
   * Base argv for a non-interactive run; mode-specific args are appended. The prompt is written to stdin.
   * Expansion rules: a scalar placeholder fills one element; `{allowedCommandRules}` expands to ONE element
   * per rule (the flag is variadic); a flag whose list placeholder expands to nothing is dropped together
   * with the placeholder (B-0002-context-policy).
   */
  baseArgs: z.array(ArgTemplate),
  /** Args for read-only roles (reviewers, resolver). */
  readOnlyArgs: z.array(ArgTemplate),
  /** Args for roles that write files in their worktree (authors, builder). */
  workspaceWriteArgs: z.array(ArgTemplate),
  /** How to request a reasoning level. */
  reasoningArgs: z.array(ArgTemplate),
  /** How to pin the output to a JSON schema file. */
  outputSchemaArgs: z.array(ArgTemplate),
  /**
   * Appended LAST. Final argv = baseArgs + (readOnlyArgs | workspaceWriteArgs) + reasoningArgs +
   * outputSchemaArgs + trailingArgs. codex needs its stdin marker "-" here, after every option.
   */
  trailingArgs: z.array(ArgTemplate).default([]),
  /** Environment variables wOS sets. It never sets credentials. */
  env: z.record(z.string(), z.string()).default({}),
  /** Flags verified present by running `--help` locally, vs assumed. */
  verification: z.object({ verifiedFlags: z.array(z.string()), unverified: z.array(z.string()) }),
});
export type ProviderSpec = z.infer<typeof ProviderSpec>;

export const SandboxMode = z.enum(["read_only", "workspace_write"]);
export type SandboxMode = z.infer<typeof SandboxMode>;

export const OutputSchemaId = z.enum(["review-verdict.v1", "author-summary.v1", "build-summary.v1", "ruling.v1"]);
export type OutputSchemaId = z.infer<typeof OutputSchemaId>;

export const IndependenceRules = z.object({
  /** Never assign to anyone who authored any commit of the subject revision under review. */
  excludeSubjectAuthors: z.boolean(),
  /** The Astra and Fable reviewers of one round must be different contributors. */
  distinctReviewersPerRound: z.boolean(),
  /** Reviewer may not have reviewed the same author more than N times in the trailing 7 days (collusion damping). 0 = no limit. */
  maxReviewsOfSameAuthorPer7d: z.number().int().min(0),
  /** Reviewer sees the other slot's verdict for the current round? Must be false. */
  mayViewOtherSlotCurrentRound: z.literal(false),
  /** Reviewer sees prior rounds' revealed findings and author responses (to check fixes). */
  mayViewPriorRounds: z.boolean(),
});
export type IndependenceRules = z.infer<typeof IndependenceRules>;

export const RolePolicy = z.object({
  role: AgentRole,
  description: z.string(),
  /** Allowed models in preference order. Reviewer roles allow exactly one. */
  allowedModels: z.array(ModelRef).min(1),
  reviewerSlot: ReviewerSlot.nullable(),
  /** "max" resolves to the model's maxReasoning. A lower minimum lets contributors choose higher. */
  reasoning: z.object({
    required: z.union([ReasoningLevel, z.literal("max")]),
    /** When true the client may not run below `required`; when false it is a floor. */
    exact: z.boolean(),
  }),
  sandbox: SandboxMode,
  /** Claude Code built-in tool names made available (`--tools`). */
  claudeTools: z.array(z.string()),
  /** Whether the agent may use the network (web fetch/search). V1: always false. */
  network: z.literal(false),
  outputSchema: OutputSchemaId,
  /**
   * Obligations rendered VERBATIM into the role's prompt template, in order (CONTEXT-PROTOCOL.md).
   * For reviewer roles, `materialFindingRules` lists what MUST be reported as a material finding.
   */
  obligations: z.array(z.string().min(10)).min(1),
  materialFindingRules: z.array(z.string().min(10)).default([]),
  /** Input context budget in estimated tokens (see CONTEXT-PROTOCOL.md for the estimator). */
  contextBudgetTokens: z.number().int().positive(),
  /** Tokens reserved for the agent's own work inside the model window. */
  workingReserveTokens: z.number().int().nonnegative(),
  /**
   * Per-model budget overrides (contracts 4.1.0, D15): e.g. an Astra builder has a smaller window than an Opus
   * builder. The effective budget for a model is its override, else the role default; it must fit the model's
   * window (budget + reserve <= contextWindowTokens).
   */
  budgetOverrides: z
    .array(
      z.object({ model: ModelRef, contextBudgetTokens: z.number().int().positive(), workingReserveTokens: z.number().int().nonnegative() }),
    )
    .default([]),
  lease: z.object({
    ttlMinutes: z.number().int().positive(),
    heartbeatSeconds: z.number().int().positive(),
    /** Absolute maximum wall-clock from claim, regardless of heartbeats. */
    hardDeadlineMinutes: z.number().int().positive(),
  }),
  independence: IndependenceRules.nullable(),
  /** Minimum account requirements to claim. */
  eligibility: z.object({
    minGithubAccountAgeDays: z.number().int().nonnegative(),
    minAcceptedContributions: z.number().int().nonnegative(),
    requiresMaintainer: z.boolean(),
    /** Maintainers skip minAcceptedContributions (someone has to review first). */
    maintainersExempt: z.boolean(),
  }),
});
export type RolePolicy = z.infer<typeof RolePolicy>;

export const WorkflowLimits = z.object({
  roadmapMaxRounds: z.number().int().positive(),
  featureContractMaxRounds: z.number().int().positive(),
  implementationMaxRepairRounds: z.number().int().positive(),
  maxLocalRepairLoops: z.number().int().nonnegative(),
  maxFailedAttemptsPerAbu: z.number().int().positive(),
  revisionWindowHours: z.number().int().positive(),
  maxConcurrentBuildLeasesPerContributor: z.number().int().positive(),
  /** D15: at most this many build leases per provider (claude_cli, codex_cli) per contributor at once. */
  maxConcurrentBuildLeasesPerProvider: z.number().int().positive(),
  maxConcurrentReviewLeasesPerContributor: z.number().int().positive(),
  /** roadmap_author, feature_author and conflict_resolution leases together (B-0001-context-policy note). */
  maxConcurrentAuthorLeasesPerContributor: z.number().int().positive(),
  /** A finding disputed by the author in this many consecutive rounds escalates. */
  disputeEscalationRounds: z.number().int().positive(),
});
export type WorkflowLimits = z.infer<typeof WorkflowLimits>;

export const BootstrapPolicy = z.object({
  /** Bootstrap ends automatically when, for EACH reviewer slot, at least this many distinct
   *  non-maintainer contributors hold a valid attestation and completed a lease in the window. */
  exitDistinctReviewersPerSlot: z.number().int().positive(),
  exitActivityWindowDays: z.number().int().positive(),
  /** In bootstrap, a review task open this long with no independent claimant may be claimed by a maintainer even if they authored the subject. */
  selfReviewAfterHours: z.number().int().nonnegative(),
  /** Public label for work reviewed under relaxed independence. */
  publicLabel: z.string(),
  /** Awards for self-reviewed work stay held until an independent re-review passes. */
  holdSelfReviewedAwards: z.literal(true),
  /** While bootstrap is on, minAcceptedContributions is not enforced for anyone (seed reviewers start at zero). */
  waiveMinAcceptedContributions: z.boolean(),
  /** bootstrap_self reviews do not count toward maxReviewsOfSameAuthorPer7d (a solo founder reviews only themself). */
  exemptSelfReviewFromSameAuthorCap: z.boolean(),
});
export type BootstrapPolicy = z.infer<typeof BootstrapPolicy>;

export const AgentPolicyDocument = z.object({
  policyVersion: z.string().regex(/^agent-policy\.v\d+$/),
  contractsVersion: SemVer,
  effectiveFrom: z.string(),
  providers: z.array(ProviderSpec).min(1),
  models: z.array(ModelSpec).min(1),
  roles: z.array(RolePolicy).length(AgentRole.options.length),
  limits: WorkflowLimits,
  bootstrap: BootstrapPolicy,
  /** Characters-per-token ratio for the deterministic token estimator (conservative). */
  tokenEstimator: z.object({ charsPerToken: z.number().positive(), perArtifactOverheadTokens: z.number().int().nonnegative() }),
});
export type AgentPolicyDocument = z.infer<typeof AgentPolicyDocument>;

/**
 * The ONE role-to-prompt-template map (contracts 4.2.0, B-0002-planning). Context-engine and the control plane
 * import it; a template revision (v2) is a change here plus the template file, nowhere else.
 */
export const PROMPT_TEMPLATE_BY_ROLE: Readonly<Record<AgentRole, string>> = {
  roadmap_author: "tpl.roadmap_author.v1",
  roadmap_reviewer_astra: "tpl.roadmap_reviewer.v1",
  roadmap_reviewer_fable: "tpl.roadmap_reviewer.v1",
  feature_author: "tpl.feature_author.v1",
  feature_reviewer_astra: "tpl.feature_reviewer.v1",
  feature_reviewer_fable: "tpl.feature_reviewer.v1",
  builder: "tpl.builder.v1",
  implementation_reviewer_astra: "tpl.implementation_reviewer.v1",
  implementation_reviewer_fable: "tpl.implementation_reviewer.v1",
  conflict_resolver: "tpl.conflict_resolver.v1",
};

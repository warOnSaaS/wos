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

/** "opencode_cli" (contracts 5.17.0, D69): the opencode CLI (`opencode run`), for candidate models such as glm on OpenCode Go. */
export const ProviderId = z.enum(["claude_cli", "codex_cli", "opencode_cli"]);
export type ProviderId = z.infer<typeof ProviderId>;

/** Stable model reference used everywhere in wOS; mapped to a provider model id in the policy. */
/** "sol" (gpt-6-sol) is allowed for builders only (D15 addition); the per-role lists are policy data. */
/**
 * "glm" (contracts 5.17.0, D52 + D69): GLM-5.3 run by the opencode CLI on the contributor's OpenCode Go subscription
 * (model `opencode-go/glm-5.3`). A CANDIDATE model: the control plane refuses it for every claim except a task a
 * maintainer designated for it (AdminAction `assign_candidate_trial`; capability-policy.v3 `candidates`, rule
 * `modelClaimRefusals`).
 */
export const ModelRef = z.enum(["fable", "opus", "astra", "sol", "glm"]);
export type ModelRef = z.infer<typeof ModelRef>;

/**
 * contracts 5.17.0 (D52, D69): how a contributor's CLI reaches a model, AS DECLARED by that CLI (identity is always
 * self_reported: wOS cannot see which model an endpoint really runs). V1 knows one non-default launch: the claude CLI
 * pointed at Z.ai's Anthropic-compatible endpoint (provider "zai"). Never carries a key.
 */
export const LaunchDeclaration = z.object({
  /** "opencode-go": OpenCode's own subscription via the opencode CLI; "zai": the claude CLI pointed at Z.ai (documented alternative). */
  provider: z.enum(["anthropic", "openai", "zai", "opencode-go"]),
  /** The endpoint the CLI was given (e.g. ANTHROPIC_BASE_URL); null = the CLI's own default for that provider. */
  baseUrl: z.url().nullable(),
  identity: z.literal("self_reported"),
});
export type LaunchDeclaration = z.infer<typeof LaunchDeclaration>;

/** contracts 5.17.0 (D69): the public label of a candidate trial's round, PR, commits and contributions. */
export const CandidateTrialLabel = z.string().regex(/^candidate_trial:[a-z][a-z0-9-]{0,30}$/);
export type CandidateTrialLabel = z.infer<typeof CandidateTrialLabel>;
export const candidateTrialLabel = (candidate: string): string => `candidate_trial:${candidate}`;

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
  /**
   * contracts 5.17.0 (D69): claude tools added to a role's `claudeTools` when THIS model runs it. Only a candidate model
   * uses it (it runs only in a maintainer-designated candidate trial): e.g. glm may use the sub-agent tool `Agent` as
   * roadmap author, within the same sandbox, permission mode and context budget. Absent = the role's tools only.
   */
  roleToolAdditions: z.partialRecord(AgentRole, z.array(z.string().min(1))).optional(),
  /**
   * contracts 5.17.0 (D69): the most sub-agents this model may run at once (the lead run excluded). Enforced where the
   * CLI can; otherwise stated in the run's instructions and measured from its event stream (AgentRunRecord).
   */
  maxConcurrentSubagents: z.number().int().min(0).optional(),
  /** contracts 5.17.0 (D69): extra instructions for this model in a role, passed with the run (hashed with its argv). */
  roleInstructions: z.partialRecord(AgentRole, z.string().min(1)).optional(),
  /**
   * contracts 5.19.0 (agent-policy.v3): environment the CLI needs for THIS model, e.g. opencode's output cap raised to the
   * model's output limit (`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`; opencode otherwise caps every step at 32000 tokens,
   * reasoning included). Never credentials.
   */
  launchEnv: z.record(z.string(), z.string()).optional(),
  /**
   * contracts 5.19.0: the reasoning level this model runs a role at, instead of the role's requirement (policy data, so
   * high and max can be compared). Must be one of the model's levels; for a role whose requirement is a floor it becomes
   * the floor. Absent = the role's requirement.
   */
  roleReasoning: z.partialRecord(AgentRole, ReasoningLevel).optional(),
  /**
   * contracts 5.19.0 (D72): sampling for author roles where the CLI exposes it (opencode: the agent's temperature and
   * top_p, sent when the model declares temperature support). Absent = the CLI's defaults.
   */
  authorSampling: z.object({ temperature: z.number().min(0).max(2).optional(), topP: z.number().gt(0).max(1).optional() }).optional(),
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
  /**
   * contracts 5.17.0 (D69), opencode: where to look for the binary when it is not on PATH (`~` = the home directory,
   * `*` = one path segment), e.g. an opencode installed under another Node version's nvm tree.
   */
  binarySearchPaths: z.array(z.string()).optional(),
  /** contracts 5.17.0: a CLI only some contributors use (opencode, for candidate trials): its absence is not a problem. */
  optional: z.boolean().optional(),
  /** contracts 5.17.0: how `authCheckCommand` output says the CLI is signed in (a regex; ANSI codes stripped), and the method it names. */
  authSignedIn: z.object({ pattern: z.string(), method: z.string() }).optional(),
  /**
   * contracts 5.17.0 (D69), for CLIs without a JSON-schema flag: the agent writes its final output (the role's output
   * schema) to this worktree-relative file; the orchestrator reads it, removes it before capturing changes, and
   * validates it (fail closed).
   */
  outputFile: z.string().optional(),
  /**
   * contracts 5.17.0 (D69), opencode: the per-run configuration passed in `envVar` (JSON): `base` merged with the
   * permission set of the role's sandbox, plus `toolPermissions` for each tool a model adds to the role
   * (`roleToolAdditions`), plus bash rules for the plan's allowed commands. Every permission is allow or deny (never
   * ask), so a headless run never waits. `configHomeEnv` names the variable pointed at an empty per-run directory so the
   * contributor's own global configuration (agents, plugins, MCP servers) is not loaded.
   */
  runConfig: z
    .object({
      envVar: z.string(),
      configHomeEnv: z.string(),
      base: z.record(z.string(), z.unknown()),
      permission: z.object({
        read_only: z.record(z.string(), z.enum(["allow", "deny"])),
        workspace_write: z.record(z.string(), z.enum(["allow", "deny"])),
      }),
      toolPermissions: z.record(z.string(), z.record(z.string(), z.enum(["allow", "deny"]))),
      /** The CLI's sub-agents (opencode: general, explore) and their permissions: read-only, no web, no nesting. */
      subagents: z.object({ agents: z.array(z.string()), permission: z.record(z.string(), z.enum(["allow", "deny"])) }).optional(),
    })
    .optional(),
  /** contracts 5.17.0 (D70): args that enable the CLI's web search for a research plan (codex). */
  webSearchArgs: z.array(ArgTemplate).optional(),
  /** contracts 5.17.0 (D70): args that open the network for a registry-exception build (codex). */
  registryArgs: z.array(ArgTemplate).optional(),
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
  /** Whether the agent's commands may use the network. Always false: research roles get `web` instead (D70). */
  network: z.literal(false),
  /**
   * contracts 5.17.0, agent-policy.v2 (D70 network by role): READ-ONLY web access for research roles (roadmap and feature
   * authors and reviewers). `domains`: "target" = the plan's target vendor domains, "contract_targets" = the vendor
   * domains of every target named in the contract; plus `sharedDomains` of the policy. `search`: the CLI's web search.
   * Every fetch is logged in the agent run (URL, time, sha256 of what the agent received) and shown to the reviewers;
   * a fetch off the plan's allowlist refuses the submission. Absent = offline (builder, implementation reviewers,
   * resolver).
   */
  web: z.object({ access: z.literal("read_only"), domains: z.enum(["target", "contract_targets"]), search: z.boolean() }).optional(),
  /**
   * agent-policy.v2 (D70): a unit that claims one of these resource prefixes EXCLUSIVE (e.g. `lockfile:`, `dep:`) may
   * reach only these hosts (the package registry). Absent = never.
   */
  registryException: z.object({ resourcePrefixes: z.array(z.string().min(1)).min(1), hosts: z.array(z.string().min(1)).min(1) }).optional(),
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
  /**
   * agent-policy.v2 (D70): the public web domains of each target vendor, from docs/scans (a host matches a domain when it
   * equals it or is a subdomain of it). Read-only; no login-walled content; robots.txt respected.
   */
  targetDomains: z.record(z.string(), z.array(z.string().min(3)).min(1)).optional(),
  /** agent-policy.v2 (D70): domains every research role may read besides its targets' (app store listings: D13 surface evidence). */
  sharedDomains: z.array(z.string().min(3)).optional(),
  /**
   * agent-policy.v3 (D72): the roadmap method, the same for every roadmap author (Opus and GLM alike). Per target, from
   * its scan (generated by scripts/gen-roadmap-method.mjs): the scan capability ids every roadmap must account for, the
   * required reading (fetched first), and the fixed partition of scan ids into sub-agent clusters. The weight rubric
   * and the step order are in the role obligations; planning `validateRoadmap` checks scan coverage and rubric weights.
   */
  roadmapMethod: z
    .object({
      version: z.literal("wos-roadmap-method.v1"),
      rubric: z.object({ version: z.literal("wos-weight-rubric.v1"), criteria: z.array(z.string()).length(4), weightFunction: z.string() }),
      steps: z.array(z.string()).min(1),
      partitionRule: z.string(),
      targets: z.record(
        z.string(),
        z.object({
          scanCapabilityIds: z.array(z.string()).min(1),
          requiredReading: z.array(
            z.object({
              kind: z.enum(["editions_pricing", "feature_docs", "app_store", "google_play", "api_docs", "export_api"]),
              url: z.url(),
            }),
          ),
          partition: z.array(z.object({ helper: z.number().int().positive(), groups: z.array(z.string()), scanIds: z.array(z.string()) })),
        }),
      ),
    })
    .optional(),
});
export type AgentPolicyDocument = z.infer<typeof AgentPolicyDocument>;

/** D70: true when `host` equals `domain` or is a subdomain of it (case-insensitive). */
export function hostInDomains(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => {
    const x = d.toLowerCase();
    return h === x || h.endsWith(`.${x}`);
  });
}

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

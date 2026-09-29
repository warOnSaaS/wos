/**
 * @waronsaas/agent-policy — evaluates the Agent Policy document (owner: context-policy workstream).
 *
 * Pure: no clock, no environment, no network, no filesystem (ARCHITECTURE.md rule 4). Everything
 * time-dependent is passed in. The same functions run on the control plane (claim time, manifest
 * check) and in the local orchestrator (building the CLI invocation), so they cannot disagree.
 */
import {
  AGENT_POLICY_V1,
  AuthorSummary,
  BuildSummary,
  ReviewVerdict,
  Ruling,
  type AgentPolicyDocument,
  type AgentRole,
  type ContextPlan,
  type ModelRef,
  type ModelSpec,
  type OutputSchemaId,
  type ProviderAttestation,
  type ProviderId,
  type ProviderSpec,
  type ReasoningLevel,
  type RolePolicy,
  type TaskKind,
} from "@waronsaas/contracts";

export { canonicalJson } from "@waronsaas/contracts/canonical";

export const DEFAULT_POLICY: AgentPolicyDocument = AGENT_POLICY_V1;

/** Thrown when a plan or a request contradicts the policy. `reasons` are stable machine codes with detail. */
export class PolicyViolationError extends Error {
  readonly reasons: string[];
  constructor(what: string, reasons: string[]) {
    super(`${what}: ${reasons.join("; ")}`);
    this.name = "PolicyViolationError";
    this.reasons = reasons;
  }
}

export function getRolePolicy(role: AgentRole, policy: AgentPolicyDocument = DEFAULT_POLICY): RolePolicy {
  const found = policy.roles.find((r) => r.role === role);
  if (!found) throw new Error(`role ${role} missing from ${policy.policyVersion}`);
  return found;
}

export function getModelSpec(ref: ModelRef, policy: AgentPolicyDocument = DEFAULT_POLICY): ModelSpec {
  const found = policy.models.find((m) => m.ref === ref);
  if (!found) throw new Error(`model ${ref} missing from ${policy.policyVersion}`);
  return found;
}

export function getProviderSpec(id: ProviderId, policy: AgentPolicyDocument = DEFAULT_POLICY): ProviderSpec {
  const found = policy.providers.find((p) => p.id === id);
  if (!found) throw new Error(`provider ${id} missing from ${policy.policyVersion}`);
  return found;
}

/** Roles whose leases count against `maxConcurrentBuildLeasesPerContributor`. */
export const BUILD_ROLES: readonly AgentRole[] = ["builder"];
/** Roles whose leases count against `maxConcurrentReviewLeasesPerContributor`. */
/** Roles whose leases count against `maxConcurrentAuthorLeasesPerContributor` (roadmap_author, feature_author, conflict_resolution). */
export const AUTHOR_ROLES: readonly AgentRole[] = ["roadmap_author", "feature_author", "conflict_resolver"];
export const REVIEW_ROLES: readonly AgentRole[] = [
  "roadmap_reviewer_astra",
  "roadmap_reviewer_fable",
  "feature_reviewer_astra",
  "feature_reviewer_fable",
  "implementation_reviewer_astra",
  "implementation_reviewer_fable",
];

// ---------------------------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------------------------

/**
 * Resolves the role's required reasoning to a concrete level for the chosen model: "max" becomes
 * the model's `maxReasoning`; a named level is used as is. The result is always a level the model
 * supports and never a forbidden one (so Astra's `ultra` can never come out of here).
 * For `exact: false` roles this is the floor; see `isReasoningAllowed` for levels above it.
 */
export function resolveReasoning(role: RolePolicy, model: ModelSpec): ReasoningLevel {
  if (!role.allowedModels.includes(model.ref)) {
    throw new PolicyViolationError("resolveReasoning", [`MODEL_NOT_ALLOWED: ${model.ref} is not allowed for ${role.role}`]);
  }
  const level: ReasoningLevel = role.reasoning.required === "max" ? model.maxReasoning : role.reasoning.required;
  const problems = reasoningProblems(model, level);
  if (problems.length > 0) throw new PolicyViolationError("resolveReasoning", problems);
  return level;
}

function reasoningProblems(model: ModelSpec, level: ReasoningLevel): string[] {
  const problems: string[] = [];
  if (!model.reasoningLevels.includes(level)) problems.push(`REASONING_UNSUPPORTED: ${model.ref} has no level ${level}`);
  if (model.forbiddenReasoning.includes(level)) problems.push(`REASONING_FORBIDDEN: ${level} is forbidden for ${model.ref}`);
  return problems;
}

/**
 * True when `level` may be used for this role and model: supported, not forbidden, and either
 * exactly the resolved level (`exact`) or at least the resolved floor (not `exact`).
 */
export function isReasoningAllowed(role: RolePolicy, model: ModelSpec, level: ReasoningLevel): boolean {
  return reasoningLevelProblems(role, model, level).length === 0;
}

function reasoningLevelProblems(role: RolePolicy, model: ModelSpec, level: ReasoningLevel): string[] {
  const problems = reasoningProblems(model, level);
  if (problems.length > 0) return problems;
  let resolved: ReasoningLevel;
  try {
    resolved = resolveReasoning(role, model);
  } catch (e) {
    return e instanceof PolicyViolationError ? e.reasons : [String(e)];
  }
  if (role.reasoning.exact) {
    if (level !== resolved) problems.push(`REASONING_NOT_EXACT: ${role.role} must run at ${resolved}, got ${level}`);
  } else if (model.reasoningLevels.indexOf(level) < model.reasoningLevels.indexOf(resolved)) {
    problems.push(`REASONING_BELOW_FLOOR: ${role.role} needs at least ${resolved}, got ${level}`);
  }
  return problems;
}

/** The task kinds a role may run (ContextPlan.taskKind is issued by the server and checked, never inferred). */
export const TASK_KINDS_BY_ROLE: Readonly<Record<AgentRole, readonly TaskKind[]>> = {
  roadmap_author: ["roadmap_author"],
  roadmap_reviewer_astra: ["roadmap_review"],
  roadmap_reviewer_fable: ["roadmap_review"],
  feature_author: ["feature_author"],
  feature_reviewer_astra: ["feature_review"],
  feature_reviewer_fable: ["feature_review"],
  builder: ["abu_build", "abu_revision"],
  implementation_reviewer_astra: ["implementation_review"],
  implementation_reviewer_fable: ["implementation_review"],
  conflict_resolver: ["conflict_resolution"],
};

// ---------------------------------------------------------------------------------------------
// Plan vs policy
// ---------------------------------------------------------------------------------------------

/**
 * Every way a ContextPlan can contradict the policy it names. Empty = consistent. Used by the control
 * plane before issuing a plan and by `buildInvocation` before launching anything.
 */
export function checkPlanAgainstPolicy(plan: ContextPlan, policy: AgentPolicyDocument = DEFAULT_POLICY): string[] {
  const reasons: string[] = [];
  if (plan.policyVersion !== policy.policyVersion) {
    reasons.push(`POLICY_VERSION_MISMATCH: plan ${plan.policyVersion}, policy ${policy.policyVersion}`);
  }
  const role = policy.roles.find((r) => r.role === plan.role);
  const model = policy.models.find((m) => m.ref === plan.model);
  if (!role) return [...reasons, `UNKNOWN_ROLE: ${plan.role}`];
  if (!model) return [...reasons, `UNKNOWN_MODEL: ${plan.model}`];
  if (!role.allowedModels.includes(model.ref)) reasons.push(`MODEL_NOT_ALLOWED: ${model.ref} is not allowed for ${role.role}`);
  if (plan.modelId !== model.modelId) reasons.push(`MODEL_ID_MISMATCH: ${model.ref} is ${model.modelId}, plan says ${plan.modelId}`);
  if (plan.provider !== model.provider)
    reasons.push(`PROVIDER_MISMATCH: ${model.ref} runs on ${model.provider}, plan says ${plan.provider}`);
  if (!policy.providers.some((p) => p.id === plan.provider)) reasons.push(`UNKNOWN_PROVIDER: ${plan.provider}`);
  reasons.push(...reasoningLevelProblems(role, model, plan.reasoning));
  if (plan.budgetTokens !== role.contextBudgetTokens) {
    reasons.push(`BUDGET_MISMATCH: ${role.role} budget is ${role.contextBudgetTokens}, plan says ${plan.budgetTokens}`);
  }
  if (plan.outputSchema !== role.outputSchema) {
    reasons.push(`OUTPUT_SCHEMA_MISMATCH: ${role.role} outputs ${role.outputSchema}, plan says ${plan.outputSchema}`);
  }
  if (!TASK_KINDS_BY_ROLE[role.role].includes(plan.taskKind)) {
    reasons.push(`TASK_KIND_MISMATCH: ${role.role} runs ${TASK_KINDS_BY_ROLE[role.role].join(" or ")}, plan says ${plan.taskKind}`);
  }
  if ((plan.target === null) === (plan.feature === null)) {
    reasons.push("SUBJECT_SCOPE_INVALID: exactly one of target (roadmap work) and feature (feature work) must be set");
  }
  if (plan.allowedCommands.length > 0 && !role.claudeTools.includes("Bash")) {
    reasons.push(`COMMANDS_NOT_ALLOWED: ${role.role} may not run commands`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------

export interface EligibilityInput {
  role: AgentRole;
  account: { id: string; githubAccountCreatedAt: string; acceptedContributions: number; isMaintainer: boolean; suspended: boolean };
  attestations: ProviderAttestation[];
  /** Account ids who authored the subject revision (for reviewer independence). */
  subjectAuthorIds: string[];
  /** Account id already holding/holding-sealed the other slot in this round, if any. */
  otherSlotReviewerId: string | null;
  reviewsOfSameAuthorLast7d: number;
  activeLeasesOfKind: number;
  bootstrapMode: boolean;
  /** Hours the review task has been open without an independent claimant (bootstrap self-review rule). */
  taskOpenHours: number;
  /**
   * Evaluation instant (ISO-8601 with offset): the caller's transaction clock. REQUIRED (contracts 2.0.0,
   * B-0001-context-policy); the package never reads a clock (ARCHITECTURE.md rule 4). A missing or
   * unreadable value fails closed with `CLOCK_REQUIRED`.
   */
  now: string;
  /** The task's `excluded_account_ids` (AGENT-POLICY.md step 7). */
  excludedAccountIds?: string[];
  /** The task's `restricted_to_account_id` (AGENT-POLICY.md step 7). */
  restrictedToAccountId?: string | null;
}

export type EligibilityResult =
  | { eligible: true; independence: "independent" | "bootstrap_maintainer" | "bootstrap_self"; model: ModelSpec; reasoning: ReasoningLevel }
  | { eligible: false; reasons: string[] };

/** Stable reason codes returned by `checkEligibility` (each reason string starts with one). */
export const ELIGIBILITY_REASONS = [
  "ACCOUNT_SUSPENDED",
  "REQUIRES_MAINTAINER",
  "CLOCK_REQUIRED",
  "GITHUB_ACCOUNT_TOO_NEW",
  "NOT_ENOUGH_ACCEPTED_CONTRIBUTIONS",
  "TOO_MANY_ACTIVE_LEASES",
  "NO_ATTESTED_MODEL",
  "REASONING_UNAVAILABLE",
  "SUBJECT_AUTHOR",
  "BOOTSTRAP_SELF_REVIEW_TOO_EARLY",
  "SAME_REVIEWER_BOTH_SLOTS",
  "SAME_AUTHOR_REVIEW_LIMIT",
  "EXCLUDED_FROM_TASK",
  "TASK_RESTRICTED_TO_OTHER_ACCOUNT",
] as const;
export type EligibilityReasonCode = (typeof ELIGIBILITY_REASONS)[number];

const DAY_MS = 86_400_000;

/**
 * Pure. Used by the control plane at claim time and by clients to pre-filter.
 * Implements AGENT-POLICY.md section 5; every step is evaluated and failing reasons accumulate.
 */
export function checkEligibility(input: EligibilityInput, policy: AgentPolicyDocument = DEFAULT_POLICY): EligibilityResult {
  const role = getRolePolicy(input.role, policy);
  const { account } = input;
  const reasons: string[] = [];
  const reason = (code: EligibilityReasonCode, detail: string) => reasons.push(`${code}: ${detail}`);

  // 1. Account active. (GitHub linkage is enforced at the route layer: GITHUB_REQUIRED.)
  if (account.suspended) reason("ACCOUNT_SUSPENDED", "the account is suspended");

  // 2. Maintainer requirement.
  if (role.eligibility.requiresMaintainer && !account.isMaintainer) reason("REQUIRES_MAINTAINER", `${role.role} is maintainers only`);

  // 3. Thresholds. Maintainers are exempt from both when maintainersExempt; bootstrap waives contributions.
  // The clock is required for every evaluation, exempt or not, so a caller that forgets it always fails closed.
  const now = typeof input.now === "string" ? Date.parse(input.now) : Number.NaN;
  if (Number.isNaN(now)) reason("CLOCK_REQUIRED", "the evaluation time `now` (the transaction clock) is required");
  const exempt = role.eligibility.maintainersExempt && account.isMaintainer;
  if (!exempt && role.eligibility.minGithubAccountAgeDays > 0 && !Number.isNaN(now)) {
    const created = Date.parse(account.githubAccountCreatedAt);
    if (Number.isNaN(created)) {
      reason("GITHUB_ACCOUNT_TOO_NEW", `unreadable GitHub creation time ${JSON.stringify(account.githubAccountCreatedAt)}`);
    } else if (now - created < role.eligibility.minGithubAccountAgeDays * DAY_MS) {
      reason("GITHUB_ACCOUNT_TOO_NEW", `GitHub account must be at least ${role.eligibility.minGithubAccountAgeDays} days old`);
    }
  }
  const contributionsWaived = exempt || (input.bootstrapMode && policy.bootstrap.waiveMinAcceptedContributions);
  if (!contributionsWaived && account.acceptedContributions < role.eligibility.minAcceptedContributions) {
    reason(
      "NOT_ENOUGH_ACCEPTED_CONTRIBUTIONS",
      `${role.role} needs ${role.eligibility.minAcceptedContributions} accepted contributions, account has ${account.acceptedContributions}`,
    );
  }

  // 4. Concurrent leases of this family.
  const leaseLimit = BUILD_ROLES.includes(role.role)
    ? policy.limits.maxConcurrentBuildLeasesPerContributor
    : REVIEW_ROLES.includes(role.role)
      ? policy.limits.maxConcurrentReviewLeasesPerContributor
      : policy.limits.maxConcurrentAuthorLeasesPerContributor;
  if (input.activeLeasesOfKind >= leaseLimit) {
    reason("TOO_MANY_ACTIVE_LEASES", `at most ${leaseLimit} active leases of this kind`);
  }

  // 5. Model choice: first allowed model with a ready provider attestation.
  const model = chooseModel(role, input.attestations, policy);
  if (!model) reason("NO_ATTESTED_MODEL", `no installed, signed-in, recent-enough CLI attests any of ${role.allowedModels.join(", ")}`);

  // 6. Reasoning.
  let reasoning: ReasoningLevel | null = null;
  if (model) {
    try {
      reasoning = resolveReasoning(role, model);
    } catch (e) {
      reason("REASONING_UNAVAILABLE", e instanceof Error ? e.message : String(e));
    }
  }

  // 7. Independence and task restrictions.
  if (input.excludedAccountIds?.includes(account.id)) reason("EXCLUDED_FROM_TASK", "the account is excluded from this task");
  if (input.restrictedToAccountId != null && input.restrictedToAccountId !== account.id) {
    reason("TASK_RESTRICTED_TO_OTHER_ACCOUNT", "the task is restricted to another account");
  }

  let independence: "independent" | "bootstrap_maintainer" | "bootstrap_self" = "independent";
  const rules = role.independence;
  if (rules) {
    const isAuthor = rules.excludeSubjectAuthors && input.subjectAuthorIds.includes(account.id);
    const isOtherSlot = rules.distinctReviewersPerRound && input.otherSlotReviewerId === account.id;
    // bootstrap_self reviews are neither counted nor capped (bootstrap.exemptSelfReviewFromSameAuthorCap):
    // a solo founder reviews only themself. Counting is the caller's; here the cap is not applied to them.
    const selfReviewCandidate = input.bootstrapMode && account.isMaintainer && isAuthor;
    const capExempt = selfReviewCandidate && policy.bootstrap.exemptSelfReviewFromSameAuthorCap;
    const overAuthorCap =
      !capExempt && rules.maxReviewsOfSameAuthorPer7d > 0 && input.reviewsOfSameAuthorLast7d >= rules.maxReviewsOfSameAuthorPer7d;

    if (overAuthorCap) {
      reason("SAME_AUTHOR_REVIEW_LIMIT", `at most ${rules.maxReviewsOfSameAuthorPer7d} reviews of the same author in 7 days`);
    }

    // 8. Labels. Bootstrap self-review: a maintainer who fails only the author rule, after the task
    // has waited selfReviewAfterHours for an independent claimant. The one extra exception
    // (REVIEW-PROTOCOL.md section 9, SECURITY.md S-12) is a solo founder holding both slots, which is
    // only possible when both reviews are bootstrap_self, i.e. the other slot's reviewer is this author.
    const selfWindowOpen = input.taskOpenHours >= policy.bootstrap.selfReviewAfterHours;
    const bootstrapSelf = selfReviewCandidate;
    if (isAuthor) {
      if (!bootstrapSelf) {
        reason("SUBJECT_AUTHOR", "the account authored the subject");
      } else if (!selfWindowOpen) {
        reason(
          "BOOTSTRAP_SELF_REVIEW_TOO_EARLY",
          `a maintainer may self-review only after the task has been open ${policy.bootstrap.selfReviewAfterHours} h without an independent claimant`,
        );
      } else {
        independence = "bootstrap_self";
      }
    }
    if (isOtherSlot && !(bootstrapSelf && selfWindowOpen)) {
      reason("SAME_REVIEWER_BOTH_SLOTS", "the account holds the other slot of this round");
    }
    if (!isAuthor && input.bootstrapMode && account.isMaintainer) independence = "bootstrap_maintainer";
  }

  if (reasons.length > 0 || !model || reasoning === null) return { eligible: false, reasons };
  return { eligible: true, independence, model, reasoning };
}

function chooseModel(role: RolePolicy, attestations: ProviderAttestation[], policy: AgentPolicyDocument): ModelSpec | null {
  for (const ref of role.allowedModels) {
    const model = policy.models.find((m) => m.ref === ref);
    if (!model) continue;
    const provider = policy.providers.find((p) => p.id === model.provider);
    if (!provider) continue;
    const latest = latestAttestation(attestations, model.provider);
    if (!latest) continue;
    if (!latest.installed || !latest.signedIn || !latest.models.includes(ref)) continue;
    const version = latest.cliVersion === null ? null : parseVersion(latest.cliVersion);
    const min = parseVersion(provider.minVersion);
    if (!version || !min || compareVersions(version, min) < 0) continue;
    return model;
  }
  return null;
}

/** Latest attestation for a provider by `checkedAt`; on equal times the later array entry wins. */
function latestAttestation(attestations: ProviderAttestation[], provider: ProviderId): ProviderAttestation | null {
  let best: ProviderAttestation | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const a of attestations) {
    if (a.provider !== provider) continue;
    const at = Date.parse(a.checkedAt);
    const t = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
    if (best === null || t >= bestAt) {
      best = a;
      bestAt = t;
    }
  }
  return best;
}

/** First `x.y.z` in a CLI version string such as "2.1.284 (Claude Code)" or "codex-cli 0.155.0". */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Output schemas
// ---------------------------------------------------------------------------------------------

const OUTPUT_SCHEMAS = {
  "review-verdict.v1": ReviewVerdict,
  "author-summary.v1": AuthorSummary,
  "build-summary.v1": BuildSummary,
  "ruling.v1": Ruling,
} as const satisfies Record<OutputSchemaId, unknown>;

/**
 * The JSON Schema passed to `--json-schema` / `--output-schema`, generated from the zod output schema
 * (output shape, draft 2020-12). Refinements such as the ReviewVerdict iff rule cannot be expressed
 * in JSON Schema and are enforced by zod after the run (orchestrator and server).
 */
export function outputJsonSchema(id: OutputSchemaId): string {
  const schema = OUTPUT_SCHEMAS[id].toJSONSchema({ io: "output" });
  return JSON.stringify({ ...schema, title: id });
}

// ---------------------------------------------------------------------------------------------
// Invocation
// ---------------------------------------------------------------------------------------------

export interface Invocation {
  binary: string;
  argv: string[];
  env: Record<string, string>;
  /** Written by the orchestrator to a temp file when the provider needs a schema path. */
  outputSchemaJson: string;
}

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;
const KNOWN_PLACEHOLDERS = new Set([
  "modelId",
  "reasoning",
  "sessionId",
  "tools",
  "allowedCommandRules",
  "schemaJson",
  "schemaPath",
  "lastMessagePath",
  "cwd",
]);

/** Control characters (C0, DEL) and parentheses would let one argument end a rule early or start another. */
function hasUnsafeChar(arg: string): boolean {
  for (const ch of arg) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || ch === "(" || ch === ")") return true;
  }
  return false;
}

/** Rendering of one allowed command as a Claude permission rule: `Bash(<argv joined by spaces>)`. */
export function allowedCommandRule(command: string[]): string {
  if (command.length === 0) throw new PolicyViolationError("allowedCommandRule", ["EMPTY_COMMAND"]);
  for (const arg of command) {
    if (arg.length === 0 || hasUnsafeChar(arg)) {
      throw new PolicyViolationError("allowedCommandRule", [`UNSAFE_COMMAND_ARG: ${JSON.stringify(arg)}`]);
    }
  }
  return `Bash(${command.join(" ")})`;
}

/**
 * Pure. Builds the exact CLI invocation for a context plan (AGENT-POLICY.md section 4):
 * argv = baseArgs + (readOnlyArgs | workspaceWriteArgs) + reasoningArgs + outputSchemaArgs + trailingArgs,
 * placeholders filled. The prompt is not in argv; the orchestrator writes it to stdin.
 *
 * Throws PolicyViolationError when the plan contradicts the policy (wrong model, wrong provider, a
 * reasoning level that is forbidden, not exact, or below the floor), so a forbidden level such as
 * Astra's `ultra` can never reach a CLI.
 *
 * `{allowedCommandRules}` expands to one argv element per allowed command. When there are none, the
 * flag that introduces it (`--allowedTools`) is dropped too: a variadic flag with no value is a CLI
 * usage error, and no rule means no command may run (see B-0002-context-policy).
 */
export function buildInvocation(
  plan: ContextPlan,
  paths: { cwd: string; schemaPath: string; lastMessagePath: string; sessionId: string },
  policy: AgentPolicyDocument = DEFAULT_POLICY,
): Invocation {
  const problems = checkPlanAgainstPolicy(plan, policy);
  if (problems.length > 0) throw new PolicyViolationError("buildInvocation", problems);
  const role = getRolePolicy(plan.role, policy);
  const model = getModelSpec(plan.model, policy);
  const provider = getProviderSpec(plan.provider, policy);

  const schemaJson = outputJsonSchema(plan.outputSchema);
  const scalars: Record<string, string> = {
    modelId: model.modelId,
    reasoning: plan.reasoning,
    sessionId: paths.sessionId,
    tools: role.claudeTools.join(","),
    schemaJson,
    schemaPath: paths.schemaPath,
    lastMessagePath: paths.lastMessagePath,
    cwd: paths.cwd,
  };
  const commandRules = plan.allowedCommands.map(allowedCommandRule);

  const modeArgs = role.sandbox === "read_only" ? provider.readOnlyArgs : provider.workspaceWriteArgs;
  const templates = [...provider.baseArgs, ...modeArgs, ...provider.reasoningArgs, ...provider.outputSchemaArgs, ...provider.trailingArgs];

  const argv: string[] = [];
  for (const template of templates) {
    if (template === "{allowedCommandRules}") {
      if (commandRules.length === 0) {
        const previous = argv[argv.length - 1];
        if (previous?.startsWith("-") && previous !== "-") argv.pop();
      } else {
        argv.push(...commandRules);
      }
      continue;
    }
    argv.push(
      template.replace(PLACEHOLDER, (whole, name: string) => {
        if (!KNOWN_PLACEHOLDERS.has(name)) throw new PolicyViolationError("buildInvocation", [`UNKNOWN_PLACEHOLDER: ${whole}`]);
        const value = scalars[name];
        if (value === undefined) throw new PolicyViolationError("buildInvocation", [`PLACEHOLDER_NOT_SCALAR: ${whole}`]);
        return value;
      }),
    );
  }

  return { binary: provider.binary, argv, env: { ...provider.env }, outputSchemaJson: schemaJson };
}

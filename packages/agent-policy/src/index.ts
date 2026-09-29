/**
 * @waronsaas/agent-policy — evaluates the Agent Policy document (owner: context-policy workstream).
 * Public API below is frozen at contracts 1.0.0; bodies are Phase 0 stubs.
 */
import {
  AGENT_POLICY_V1,
  NotImplementedError,
  type AgentPolicyDocument,
  type AgentRole,
  type ContextPlan,
  type ModelSpec,
  type ProviderAttestation,
  type ReasoningLevel,
  type RolePolicy,
} from "@waronsaas/contracts";

export const DEFAULT_POLICY: AgentPolicyDocument = AGENT_POLICY_V1;

export function getRolePolicy(role: AgentRole, policy: AgentPolicyDocument = DEFAULT_POLICY): RolePolicy {
  const found = policy.roles.find((r) => r.role === role);
  if (!found) throw new Error(`role ${role} missing from ${policy.policyVersion}`);
  return found;
}

/** Resolves "max" and floors to a concrete level for the chosen model. */
export function resolveReasoning(role: RolePolicy, model: ModelSpec): ReasoningLevel {
  void role;
  void model;
  throw new NotImplementedError("resolveReasoning");
}

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
}

export type EligibilityResult =
  | { eligible: true; independence: "independent" | "bootstrap_maintainer" | "bootstrap_self"; model: ModelSpec; reasoning: ReasoningLevel }
  | { eligible: false; reasons: string[] };

/** Pure. Used by the control plane at claim time and by clients to pre-filter. */
export function checkEligibility(input: EligibilityInput, policy: AgentPolicyDocument = DEFAULT_POLICY): EligibilityResult {
  void input;
  void policy;
  throw new NotImplementedError("checkEligibility");
}

export interface Invocation {
  binary: string;
  argv: string[];
  env: Record<string, string>;
  /** Written by the orchestrator to a temp file when the provider needs a schema path. */
  outputSchemaJson: string;
}

/** Pure. Builds the exact CLI invocation for a context plan (placeholders from ProviderSpec filled). */
export function buildInvocation(
  plan: ContextPlan,
  paths: { cwd: string; schemaPath: string; lastMessagePath: string; sessionId: string },
  policy: AgentPolicyDocument = DEFAULT_POLICY,
): Invocation {
  void plan;
  void paths;
  void policy;
  throw new NotImplementedError("buildInvocation");
}

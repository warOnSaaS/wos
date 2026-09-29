import { AGENT_POLICY_V1, type AgentRole, type ContextPlan, type ReasoningLevel } from "@waronsaas/contracts";

const policy = AGENT_POLICY_V1;

export const TEMPLATE_BY_ROLE: Record<AgentRole, string> = {
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

/** A plan for `role` that is consistent with agent-policy.v1 (first allowed model, resolved reasoning). */
export function planFor(role: AgentRole, overrides: Partial<ContextPlan> = {}): ContextPlan {
  const rp = policy.roles.find((r) => r.role === role)!;
  const model = policy.models.find((m) => m.ref === rp.allowedModels[0])!;
  const reasoning: ReasoningLevel = rp.reasoning.required === "max" ? model.maxReasoning : rp.reasoning.required;
  return {
    schema: "wos-context-plan.v1",
    taskId: "0190f000-0000-7000-8000-000000000001",
    leaseId: "0190f000-0000-7000-8000-000000000002",
    role,
    model: model.ref,
    modelId: model.modelId,
    provider: model.provider,
    reasoning,
    policyVersion: policy.policyVersion,
    contextFormatVersion: "ctx-1",
    target: "salesforce",
    feature: "contacts",
    abu: role === "builder" || role.startsWith("implementation_") ? "contacts#04" : null,
    attemptId: role === "builder" || role.startsWith("implementation_") ? "0190f000-0000-7000-8000-000000000003" : null,
    roundId: rp.reviewerSlot ? "0190f000-0000-7000-8000-000000000004" : null,
    source: { repo: "waronsaas/suite", commit: "1111111111111111111111111111111111111111" },
    artifacts: [],
    excludeGlobs: [],
    promptTemplateId: TEMPLATE_BY_ROLE[role],
    budgetTokens: rp.contextBudgetTokens,
    outputSchema: rp.outputSchema,
    allowedCommands:
      role === "builder"
        ? [
            ["npm", "run", "typecheck"],
            ["npx", "vitest", "run", "modules/contacts/test/contacts.test.ts"],
          ]
        : [],
    ...overrides,
  };
}

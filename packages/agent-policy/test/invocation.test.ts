import { createHash } from "node:crypto";
import { AGENT_POLICY_V1, AgentRole, ReviewVerdict } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { allowedCommandRule, buildInvocation, checkPlanAgainstPolicy, outputJsonSchema, PolicyViolationError } from "../src/index.js";
import { planFor } from "./fixtures.js";

const policy = AGENT_POLICY_V1;
const paths = {
  cwd: "/work/wos/attempt-3",
  schemaPath: "/tmp/wos/schema.json",
  lastMessagePath: "/tmp/wos/last-message.json",
  sessionId: "0190f000-0000-7000-8000-00000000abcd",
};
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

/** The argv with the (large) JSON Schema argument replaced by a short marker, for readable snapshots. */
function readable(argv: string[], schemaJson: string): string[] {
  return argv.map((a) => (a === schemaJson ? `<schemaJson ${JSON.parse(schemaJson).title} ${sha(schemaJson)}>` : a));
}

describe("agent-policy buildInvocation: argv snapshots for all ten roles", () => {
  for (const role of AgentRole.options) {
    it(`agent-policy ${role} matches the provider template`, () => {
      const plan = planFor(role);
      const inv = buildInvocation(plan, paths);
      expect({ binary: inv.binary, argv: readable(inv.argv, inv.outputSchemaJson), env: inv.env }).toMatchSnapshot();
    });
  }
});

describe("agent-policy buildInvocation: structure", () => {
  it("equals baseArgs + mode + reasoning + schema + trailing, placeholders filled, for every role", () => {
    for (const role of AgentRole.options) {
      const plan = planFor(role);
      const rp = policy.roles.find((r) => r.role === role)!;
      const provider = policy.providers.find((p) => p.id === plan.provider)!;
      const inv = buildInvocation(plan, paths);
      const mode = rp.sandbox === "read_only" ? provider.readOnlyArgs : provider.workspaceWriteArgs;
      const expected = [...provider.baseArgs, ...mode, ...provider.reasoningArgs, ...provider.outputSchemaArgs, ...provider.trailingArgs]
        .flatMap((t) => (t === "{allowedCommandRules}" ? plan.allowedCommands.map((c) => `Bash(${c.join(" ")})`) : [t]))
        // B-0002: with no allowed commands the variadic --allowedTools flag is dropped with its (empty) value.
        .filter((t) => plan.allowedCommands.length > 0 || t !== "--allowedTools")
        .map((t) =>
          t
            .replace("{modelId}", plan.modelId)
            .replace("{reasoning}", plan.reasoning)
            .replace("{sessionId}", paths.sessionId)
            .replace("{tools}", rp.claudeTools.join(","))
            .replace("{schemaJson}", inv.outputSchemaJson)
            .replace("{schemaPath}", paths.schemaPath)
            .replace("{lastMessagePath}", paths.lastMessagePath)
            .replace("{cwd}", paths.cwd),
        );
      expect(inv.argv, role).toEqual(expected);
      expect(
        inv.argv.some((a) => /\{[A-Za-z]+\}/.test(a)),
        role,
      ).toBe(false);
      expect(inv.env).toEqual(provider.env);
    }
  });

  it("never produces ultra, in any argv element, for any role", () => {
    for (const role of AgentRole.options) {
      const inv = buildInvocation(planFor(role), paths);
      expect(inv.argv.filter((a) => a !== inv.outputSchemaJson).join(" "), role).not.toMatch(/ultra/);
    }
  });

  it("refuses a plan asking Astra for ultra (forbidden), and any reviewer below max (exact)", () => {
    const astra = planFor("roadmap_reviewer_astra", { reasoning: "ultra" });
    expect(() => buildInvocation(astra, paths)).toThrow(PolicyViolationError);
    expect(checkPlanAgainstPolicy(astra).join(" ")).toMatch(/REASONING_FORBIDDEN/);
    for (const role of AgentRole.options.filter((r) => r.includes("reviewer") || r === "conflict_resolver")) {
      expect(() => buildInvocation(planFor(role, { reasoning: "high" }), paths), role).toThrow(/REASONING_NOT_EXACT/);
    }
  });

  it("builder reasoning is a floor: high, xhigh and max run; medium is refused", () => {
    for (const level of ["high", "xhigh", "max"] as const) {
      const inv = buildInvocation(planFor("builder", { reasoning: level }), paths);
      expect(inv.argv.slice(inv.argv.indexOf("--effort"), inv.argv.indexOf("--effort") + 2)).toEqual(["--effort", level]);
    }
    expect(() => buildInvocation(planFor("builder", { reasoning: "medium" }), paths)).toThrow(/REASONING_BELOW_FLOOR/);
  });

  it("claude roles: --restricted, --safe-mode, --effort <level>, explicit --tools, never --bare or skip-permissions", () => {
    for (const role of AgentRole.options) {
      const plan = planFor(role);
      if (plan.provider !== "claude_cli") continue;
      const { argv, env } = buildInvocation(plan, paths);
      expect(argv[0]).toBe("-p");
      expect(argv).toEqual(expect.arrayContaining(["--restricted", "--safe-mode", "--strict-mcp-config", "--no-session-persistence"]));
      expect(argv[argv.indexOf("--effort") + 1]).toBe(plan.reasoning);
      expect(argv[argv.indexOf("--model") + 1]).toBe(plan.modelId);
      expect(argv[argv.indexOf("--permission-prompts") + 1]).toBe("none");
      const rp = policy.roles.find((r) => r.role === role)!;
      expect(argv[argv.indexOf("--tools") + 1]).toBe(rp.claudeTools.join(","));
      expect(argv[argv.indexOf("--permission-mode") + 1]).toBe(rp.sandbox === "read_only" ? "dontAsk" : "acceptEdits");
      expect(argv.join(" ")).not.toMatch(/--bare|--dangerously/);
      expect(env).toEqual({ CLAUDE_CODE_SAFE_MODE: "1" });
    }
  });

  it('codex reviewers: -c model_reasoning_effort="max", --sandbox read-only, stdin marker last', () => {
    for (const role of AgentRole.options) {
      const plan = planFor(role);
      if (plan.provider !== "codex_cli") continue;
      const { argv, binary } = buildInvocation(plan, paths);
      expect(binary).toBe("codex");
      expect(argv[0]).toBe("exec");
      expect(argv).toContain('model_reasoning_effort="max"');
      expect(argv[argv.indexOf('model_reasoning_effort="max"') - 1]).toBe("-c");
      expect(argv[argv.indexOf("--sandbox") + 1]).toBe("read-only");
      expect(argv[argv.indexOf("--output-schema") + 1]).toBe(paths.schemaPath);
      expect(argv[argv.indexOf("-o") + 1]).toBe(paths.lastMessagePath);
      expect(argv[argv.indexOf("-C") + 1]).toBe(paths.cwd);
      expect(argv.at(-1)).toBe("-");
      expect(argv.join(" ")).not.toMatch(/danger-full-access|--dangerously/);
    }
  });

  it("builder gets one Bash(...) rule per allowed command; authors (no commands) get no --allowedTools at all", () => {
    const builder = buildInvocation(planFor("builder"), paths).argv;
    const i = builder.indexOf("--allowedTools");
    expect(builder.slice(i + 1, i + 3)).toEqual(["Bash(npm run typecheck)", "Bash(npx vitest run modules/contacts/test/contacts.test.ts)"]);
    expect(builder[i + 3]).toBe("--effort");
    for (const role of ["roadmap_author", "feature_author"] as const) {
      const argv = buildInvocation(planFor(role), paths).argv;
      expect(argv, role).not.toContain("--allowedTools");
      expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    }
  });

  it("refuses commands for roles without Bash and unsafe command arguments", () => {
    expect(() => buildInvocation(planFor("roadmap_reviewer_fable", { allowedCommands: [["ls"]] }), paths)).toThrow(/COMMANDS_NOT_ALLOWED/);
    expect(() => allowedCommandRule(["sh", "-c", "a) Bash(rm -rf /"])).toThrow(/UNSAFE_COMMAND_ARG/);
    expect(() => allowedCommandRule(["echo", "a\nb"])).toThrow(/UNSAFE_COMMAND_ARG/);
  });

  it("refuses model, provider, budget and schema mismatches", () => {
    expect(checkPlanAgainstPolicy(planFor("builder", { model: "fable", modelId: "claude-fable-5-1" })).join()).toMatch(/MODEL_NOT_ALLOWED/);
    expect(checkPlanAgainstPolicy(planFor("builder", { modelId: "claude-opus-4" })).join()).toMatch(/MODEL_ID_MISMATCH/);
    expect(checkPlanAgainstPolicy(planFor("roadmap_reviewer_astra", { provider: "claude_cli" })).join()).toMatch(/PROVIDER_MISMATCH/);
    expect(checkPlanAgainstPolicy(planFor("builder", { budgetTokens: 999_999 })).join()).toMatch(/BUDGET_MISMATCH/);
    expect(checkPlanAgainstPolicy(planFor("builder", { outputSchema: "review-verdict.v1" })).join()).toMatch(/OUTPUT_SCHEMA_MISMATCH/);
    expect(checkPlanAgainstPolicy(planFor("builder", { policyVersion: "agent-policy.v9" })).join()).toMatch(/POLICY_VERSION_MISMATCH/);
    for (const role of AgentRole.options) expect(checkPlanAgainstPolicy(planFor(role)), role).toEqual([]);
  });

  it("is pure: the same plan and paths give the same invocation", () => {
    for (const role of AgentRole.options) {
      expect(buildInvocation(planFor(role), paths)).toEqual(buildInvocation(planFor(role), paths));
    }
  });
});

describe("agent-policy outputJsonSchema", () => {
  it("generates strict object schemas (all properties required, no additional properties) for codex --output-schema", () => {
    for (const id of ["review-verdict.v1", "author-summary.v1", "build-summary.v1", "ruling.v1"] as const) {
      const schema = JSON.parse(outputJsonSchema(id));
      expect(schema.title).toBe(id);
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!node || typeof node !== "object") return;
        const n = node as Record<string, unknown>;
        if (n.type === "object" && n.properties) {
          expect(n.additionalProperties, id).toBe(false);
          expect([...(n.required as string[])].sort(), id).toEqual(Object.keys(n.properties as object).sort());
        }
        Object.values(n).forEach(walk);
      };
      walk(schema);
    }
  });

  it("a verdict that fits the JSON Schema still has to pass the zod iff refinement", () => {
    const bad = {
      schema: "review-verdict.v1",
      verdict: "NO_MATERIAL_GAPS",
      summary: "x",
      findings: [
        { localId: "f1", severity: "material", category: "other", title: "t", detail: "d", evidence: [], suggestedResolution: "" },
      ],
      priorFindings: [],
    };
    expect(ReviewVerdict.safeParse(bad).success).toBe(false);
  });
});

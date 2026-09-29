import { describe, expect, it } from "vitest";
import { AGENT_POLICY_V1, AgentRole, REWARD_SCHEDULE_V1, TOKEN_DISCLAIMER } from "../src/index.js";

const policy = AGENT_POLICY_V1;
const model = (ref: string) => policy.models.find((m) => m.ref === ref)!;

describe("agent-policy.v1", () => {
  it("defines every role exactly once", () => {
    expect(policy.roles.map((r) => r.role).sort()).toEqual([...AgentRole.options].sort());
  });

  it("maps Fable/Opus to claude and Astra to codex with the founder's model ids (D1)", () => {
    expect(model("fable")).toMatchObject({ provider: "claude_cli", modelId: "claude-fable-5-1", maxReasoning: "max" });
    expect(model("opus")).toMatchObject({ provider: "claude_cli", modelId: "claude-opus-5-5", maxReasoning: "max" });
    expect(model("astra")).toMatchObject({ provider: "codex_cli", modelId: "gpt-6-astra", maxReasoning: "max" });
    expect(model("astra").forbiddenReasoning).toContain("ultra");
  });

  it("maxReasoning is a supported, non-forbidden level of each model", () => {
    for (const m of policy.models) {
      expect(m.reasoningLevels).toContain(m.maxReasoning);
      expect(m.forbiddenReasoning).not.toContain(m.maxReasoning);
    }
  });

  it("reviewers run at max, read-only, one model per slot, never see the other slot", () => {
    for (const r of policy.roles.filter((x) => x.reviewerSlot !== null)) {
      expect(r.reasoning).toEqual({ required: "max", exact: true });
      expect(r.sandbox).toBe("read_only");
      expect(r.allowedModels).toEqual([r.reviewerSlot]);
      expect(r.independence?.mayViewOtherSlotCurrentRound).toBe(false);
      expect(r.independence?.excludeSubjectAuthors).toBe(true);
      expect(r.materialFindingRules.length).toBeGreaterThan(0);
      expect(r.claudeTools.filter((t) => !["Read", "Grep", "Glob"].includes(t))).toEqual([]);
    }
  });

  it("D12: the roadmap author must reason about weights and reviewers must treat mis-weighting as material", () => {
    const author = policy.roles.find((r) => r.role === "roadmap_author")!;
    expect(author.obligations.join(" ")).toMatch(/weightRationale/);
    for (const slot of ["roadmap_reviewer_astra", "roadmap_reviewer_fable"]) {
      const r = policy.roles.find((x) => x.role === slot)!;
      expect(r.materialFindingRules.join(" ")).toMatch(/MIS-WEIGHTING/);
      expect(r.materialFindingRules.join(" ")).toMatch(/duplicates an existing catalog feature/);
    }
  });

  it("D13: authors must cover surfaces, journeys and surface weights; reviewers treat gaps and trade-dress copying as material", () => {
    const author = policy.roles.find((r) => r.role === "roadmap_author")!;
    const text = author.obligations.join(" ");
    expect(text).toMatch(/SURFACES \(D13\)/);
    expect(text).toMatch(/EXPERIENCE \(D13\)/);
    expect(text).toMatch(/SURFACE WEIGHTS/);
    expect(text).toMatch(/trade dress/);
    for (const slot of ["roadmap_reviewer_astra", "roadmap_reviewer_fable"]) {
      const rules = policy.roles.find((x) => x.role === slot)!.materialFindingRules.join(" ");
      expect(rules).toMatch(/client surface the vendor ships/);
      expect(rules).toMatch(/without a journey/);
      expect(rules).toMatch(/SURFACE MIS-WEIGHTING/);
      expect(rules).toMatch(/trade dress/);
    }
    for (const slot of ["feature_reviewer_astra", "feature_reviewer_fable"]) {
      expect(policy.roles.find((x) => x.role === slot)!.materialFindingRules.join(" ")).toMatch(/browser of the matrix/);
    }
  });

  it("context budget + working reserve fits every allowed model's window", () => {
    for (const r of policy.roles) {
      for (const ref of r.allowedModels) {
        expect(r.contextBudgetTokens + r.workingReserveTokens, `${r.role}/${ref}`).toBeLessThanOrEqual(model(ref).contextWindowTokens);
      }
    }
  });

  it("builder is Opus with Bash only through allowed commands; no role has network", () => {
    const b = policy.roles.find((r) => r.role === "builder")!;
    expect(b.allowedModels).toEqual(["opus"]);
    expect(b.claudeTools).toContain("Bash");
    const claude = policy.providers.find((p) => p.id === "claude_cli")!;
    expect(claude.workspaceWriteArgs).toContain("--allowedTools");
    expect(claude.baseArgs).toEqual(expect.arrayContaining(["--restricted", "--safe-mode", "--strict-mcp-config", "--permission-prompts"]));
    for (const r of policy.roles) expect(r.network).toBe(false);
  });

  it("every CLI flag used in args templates was verified locally", () => {
    for (const p of policy.providers) {
      const used = [
        ...p.baseArgs,
        ...p.readOnlyArgs,
        ...p.workspaceWriteArgs,
        ...p.reasoningArgs,
        ...p.outputSchemaArgs,
        ...p.trailingArgs,
      ].filter((a) => a.startsWith("-") && a !== "-");
      for (const flag of used) expect(p.verification.verifiedFlags, `${p.id} ${flag}`).toContain(flag);
    }
  });

  it("codex runs without user config or project docs (prompt-injection surface) and at the policy's effort", () => {
    const codex = policy.providers.find((p) => p.id === "codex_cli")!;
    expect(codex.baseArgs).toEqual(
      expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "project_doc_max_bytes=0", "--ephemeral"]),
    );
    expect(codex.reasoningArgs.join(" ")).toContain("model_reasoning_effort");
    expect(codex.baseArgs).not.toContain("-");
    expect(codex.trailingArgs).toEqual(["-"]);
  });
});

describe("reward schedule", () => {
  it("is a proposal until the founder activates it, and the disclaimer is exact (D3)", () => {
    expect(REWARD_SCHEDULE_V1.status).toBe("proposal");
    expect(TOKEN_DISCLAIMER).toBe("WOS tokens are in-app credits with no cash value.");
  });
});

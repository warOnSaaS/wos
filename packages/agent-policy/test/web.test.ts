/**
 * agent-policy.v2 in buildInvocation: D70 network by role (claude WebFetch domain rules and WebSearch; codex web search;
 * opencode webfetch/websearch permissions; offline roles; the registry exception) and the opencode adapter for glm (D69).
 */
import { AGENT_POLICY, type ContextPlan } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { buildInvocation, checkPlanAgainstPolicy } from "../src/index.js";
import { planFor } from "./fixtures.js";

const paths = { cwd: "/w", schemaPath: "/t/s.json", lastMessagePath: "/t/l.json", sessionId: "sid", configHome: "/t/config-home" };
const WEB = { domains: ["salesforce.com", "force.com"], search: true, registry: [] };
const glmPlan = (over: Partial<ContextPlan> = {}): ContextPlan => {
  const m = AGENT_POLICY.models.find((x) => x.ref === "glm")!;
  return planFor("roadmap_author", { model: "glm", modelId: m.modelId, provider: m.provider, reasoning: "max", ...over });
};

describe("D70: claude research roles read the allowlist and search; nothing else changes", () => {
  it("roadmap author on claude: WebFetch per domain and subdomains, WebSearch, in --tools and --allowedTools", () => {
    const inv = buildInvocation(planFor("roadmap_author", { web: WEB }), paths);
    const tools = inv.argv[inv.argv.indexOf("--tools") + 1]!;
    expect(tools.split(",")).toEqual(expect.arrayContaining(["Read", "Edit", "Write", "WebFetch", "WebSearch"]));
    expect(tools).not.toContain("Bash");
    const i = inv.argv.indexOf("--allowedTools");
    expect(inv.argv.slice(i + 1, i + 6)).toEqual([
      "WebFetch(domain:salesforce.com)",
      "WebFetch(domain:*.salesforce.com)",
      "WebFetch(domain:force.com)",
      "WebFetch(domain:*.force.com)",
      "WebSearch",
    ]);
  });

  it("a roadmap reviewer on claude (read-only, dontAsk) gets the same rules; without web it keeps no --allowedTools", () => {
    const withWeb = buildInvocation(planFor("roadmap_reviewer_fable", { web: WEB }), paths);
    expect(withWeb.argv).toEqual(
      expect.arrayContaining(["--permission-mode", "dontAsk", "--allowedTools", "WebFetch(domain:salesforce.com)"]),
    );
    const offline = buildInvocation(planFor("roadmap_reviewer_fable"), paths);
    expect(offline.argv).not.toContain("--allowedTools");
    expect(offline.argv[offline.argv.indexOf("--tools") + 1]).not.toContain("Web");
  });

  it("codex research roles get live web search; codex builders stay without network unless the registry exception applies", () => {
    const rev = buildInvocation(planFor("roadmap_reviewer_astra", { web: WEB }), paths);
    expect(rev.argv.join(" ")).toContain('-c web_search="live"');
    const off = buildInvocation(planFor("roadmap_reviewer_astra"), paths);
    expect(off.argv.join(" ")).not.toContain("web_search");
    const astra = AGENT_POLICY.models.find((m) => m.ref === "astra")!;
    const builder = planFor("builder", {
      model: "astra",
      modelId: astra.modelId,
      provider: "codex_cli",
      reasoning: "high",
      budgetTokens: 120000,
    });
    const plain = buildInvocation(builder, paths).argv.join(" ");
    expect(plain).toContain("sandbox_workspace_write.network_access=false");
    expect(plain).not.toContain("network_access=true");
    const reg = buildInvocation({ ...builder, web: { domains: [], search: false, registry: ["registry.npmjs.org"] } }, paths).argv.join(
      " ",
    );
    expect(reg).toContain("sandbox_workspace_write.network_access=true");
  });

  it("the policy refuses web on offline roles, unknown domains, search a role lacks, and registries a role has not", () => {
    expect(checkPlanAgainstPolicy(planFor("builder", { web: { domains: ["salesforce.com"], search: false, registry: [] } }))).toContain(
      "WEB_NOT_ALLOWED: builder runs offline (D70)",
    );
    expect(checkPlanAgainstPolicy(planFor("roadmap_author", { web: { domains: ["example.org"], search: true, registry: [] } }))).toContain(
      `WEB_DOMAIN_UNKNOWN: example.org is not a target or shared domain of ${AGENT_POLICY.policyVersion}`,
    );
    expect(
      checkPlanAgainstPolicy(planFor("conflict_resolver", { web: { domains: [], search: false, registry: ["evil.example"] } })),
    ).toContain("REGISTRY_NOT_ALLOWED: evil.example is not a registry host of conflict_resolver (D70)");
    expect(checkPlanAgainstPolicy(planFor("builder", { web: { domains: [], search: false, registry: ["registry.npmjs.org"] } }))).toEqual(
      [],
    );
    expect(checkPlanAgainstPolicy(planFor("roadmap_author", { web: WEB }))).toEqual([]);
  });
});

describe("D69: glm on the opencode CLI", () => {
  it("argv: run -m opencode-go/glm-5.3 --format json --pure --dir --title --variant max, then the instruction message", () => {
    const inv = buildInvocation(glmPlan({ web: WEB }), paths);
    expect(inv.binary).toBe("opencode");
    expect(inv.argv.slice(0, 12)).toEqual([
      "run",
      "-m",
      "opencode-go/glm-5.3",
      "--format",
      "json",
      "--pure",
      "--dir",
      "/w",
      "--title",
      "sid",
      "--variant",
      "max",
    ]);
    expect(inv.argv).toHaveLength(13);
    expect(inv.argv[12]).toMatch(/standard input.*author-summary\.v1.*\.wos-agent-output\.json.*You lead this roadmap.*at most 4/s);
    expect(inv.outputFile).toBe(".wos-agent-output.json");
    expect(inv.argv.join(" ")).not.toMatch(/--auto|dangerously|yolo/);
  });

  it("env: an isolated config home and a per-run permission config (allow or deny only, catch-all first, sub-agents read-only)", () => {
    const inv = buildInvocation(glmPlan({ web: WEB }), paths);
    expect(inv.env.XDG_CONFIG_HOME).toBe("/t/config-home");
    expect(inv.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    const cfg = JSON.parse(inv.env.OPENCODE_CONFIG_CONTENT!);
    expect(cfg).toMatchObject({ share: "disabled", autoupdate: false, mcp: {}, plugin: [] });
    expect(Object.keys(cfg.permission)[0]).toBe("*");
    expect(cfg.permission).toMatchObject({ "*": "deny", read: "allow", edit: "allow", bash: "deny", task: "allow", websearch: "allow" });
    // opencode 1.18.31 accepts only an action for webfetch: the allowlist is enforced after the run (orchestrator).
    expect(cfg.permission.webfetch).toBe("allow");
    for (const a of ["general", "explore"])
      expect(cfg.agent[a].permission).toMatchObject({ webfetch: "deny", task: "deny", edit: "deny", bash: "deny" });
    expect(JSON.stringify(cfg)).not.toContain('"ask"');
  });

  it("without web the opencode run cannot fetch or search; the invocation is pure and needs a config home", () => {
    const cfg = JSON.parse(buildInvocation(glmPlan(), paths).env.OPENCODE_CONFIG_CONTENT!);
    expect(cfg.permission).toMatchObject({ webfetch: "deny", websearch: "deny" });
    expect(buildInvocation(glmPlan(), paths)).toEqual(buildInvocation(glmPlan(), paths));
    const { configHome: _c, ...noHome } = paths;
    expect(() => buildInvocation(glmPlan(), noHome)).toThrow(/CONFIG_HOME_REQUIRED/);
  });

  it("glm is only a roadmap author", () => {
    const m = AGENT_POLICY.models.find((x) => x.ref === "glm")!;
    const fa = planFor("feature_author", { model: "glm", modelId: m.modelId, provider: m.provider, reasoning: "max" });
    expect(checkPlanAgainstPolicy(fa).join(" ")).toMatch(/MODEL_NOT_ALLOWED: glm is not allowed for feature_author/);
  });
});

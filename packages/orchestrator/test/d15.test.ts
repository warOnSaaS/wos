/**
 * D15: a contributor with both subscriptions is two agents. The builder runs on whatever model its plan
 * names: Opus through claude, Astra or Sol through `codex exec --sandbox workspace-write` with network
 * access off. (Choosing the model on the claim waits on B-0010-github-build.)
 */
import type { OrchestratorEvent } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ABU_KEY, TARGET } from "./support/fake-control-plane.js";
import { type Harness, harness } from "./support/harness.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe("D15 builder models", () => {
  for (const [model, modelId] of [
    ["astra", "gpt-6-astra"],
    ["sol", "gpt-6-sol"],
  ] as const) {
    it(`builds on ${model} through codex exec in a workspace-write sandbox with network off`, async () => {
      h = harness();
      h.server.builderModel = model;
      const events: OrchestratorEvent[] = [];
      const res = await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, detachAfterSubmit: true }, (e) => events.push(e));
      expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
      const agent = h.processes.invocations.find((i) => i.binary === "codex" || i.binary === "claude")!;
      expect(agent.binary).toBe("codex");
      expect(agent.argv[0]).toBe("exec");
      expect(agent.argv[agent.argv.indexOf("--model") + 1]).toBe(modelId);
      expect(agent.argv).toEqual(expect.arrayContaining(["--sandbox", "workspace-write", "sandbox_workspace_write.network_access=false"]));
      expect(agent.argv).not.toContain("read-only");
      expect(agent.argv.at(-1)).toBe("-");
      expect(events.find((e) => e.type === "agent_started")).toMatchObject({ provider: "codex_cli", model: modelId });
      // The signed run record names provider and model; the changeset came from the codex agent's edit.
      const run = (h.server.agentRuns as Array<{ provider: string; modelIdRequested: string; modelIdReported: string | null }>)[0]!;
      expect(run).toMatchObject({ provider: "codex_cli", modelIdRequested: modelId, modelIdReported: modelId });
      expect(h.server.submissions[0]!.files.map((f) => f.path)).toEqual(["modules/contacts/list.ts"]);
      // The manifest was built for the model's own budget override.
      expect((h.server.manifestBodies[0] as unknown as { budget: { limitTokens: number } }).budget.limitTokens).toBe(120000);
    });
  }

  it("Opus stays the default builder through claude", async () => {
    h = harness();
    await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, detachAfterSubmit: true }, () => undefined);
    const agent = h.processes.invocations.find((i) => i.binary === "codex" || i.binary === "claude")!;
    expect(`${agent.binary} ${agent.argv[agent.argv.indexOf("--model") + 1]}`).toBe("claude claude-opus-5-5");
  });

  it("build({model}) sends the choice on claimBuild and runs that model; revisions keep it", async () => {
    h = harness();
    h.server.outcomes = { ci: ["failure", "success"], review: ["pass"], merge: ["merged"] };
    const res = await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, model: "sol" }, () => undefined);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(h.server.claimBodies.map((b) => b.model)).toEqual(["sol", "sol"]);
    const models = h.processes.invocations
      .filter((i) => i.binary === "codex" || i.binary === "claude")
      .map((i) => i.argv[i.argv.indexOf("--model") + 1]);
    expect(models).toEqual(["gpt-6-sol", "gpt-6-sol"]);
  });

  it("build() without a model sends none (policy default)", async () => {
    h = harness();
    await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, detachAfterSubmit: true }, () => undefined);
    expect(h.server.claimBodies[0]).not.toHaveProperty("model");
  });

  for (const code of ["LIMIT_REACHED", "NOT_ELIGIBLE"] as const) {
    it(`a ${code} claim refusal surfaces as a failed RunResult and an error event`, async () => {
      h = harness();
      h.server.claimRefusals.push(code);
      const events: OrchestratorEvent[] = [];
      const res = await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, model: "astra" }, (e) => events.push(e));
      expect(res).toMatchObject({ ok: false, code });
      expect(events.at(-1)).toMatchObject({ type: "error", code });
      expect(h.processes.invocations.filter((i) => i.binary === "codex" || i.binary === "claude")).toEqual([]);
    });
  }

  it("a model the builder role does not allow is refused by the server as NOT_ELIGIBLE", async () => {
    h = harness();
    const res = await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, model: "fable" }, () => undefined);
    expect(res).toMatchObject({ ok: false, code: "NOT_ELIGIBLE" });
  });

  it("author({model}) sends the choice on claimTask", async () => {
    h = harness();
    const t = h.server.openAuthorTask("roadmap_author");
    const res = await h.make("cli").author({ taskId: t.id, model: "astra" }, () => undefined);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(h.server.claimBodies.at(-1)).toMatchObject({ model: "astra" });
    const agent = h.processes.invocations.find((i) => i.binary === "codex" || i.binary === "claude")!;
    expect(`${agent.binary} ${agent.argv[agent.argv.indexOf("--model") + 1]}`).toBe("codex gpt-6-astra");
  });
});

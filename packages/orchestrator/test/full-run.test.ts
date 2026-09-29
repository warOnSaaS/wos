/**
 * DONE (4): one full LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR run where every agent run goes
 * through an orchestrator: the builder (claude, Opus) and the two reviewers on other contributors'
 * machines (codex for the Astra slot, claude for Fable), with the REAL context-engine, agent-policy and
 * verification packages, against the contract-faithful fake control plane.
 */
import type { OrchestratorEvent, RunResult } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ABU_KEY, TARGET } from "./support/fake-control-plane.js";
import { type Harness, harness } from "./support/harness.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const steps = (events: OrchestratorEvent[]) => events.flatMap((e) => (e.type === "step" ? [`${e.step}:${e.status}`] : []));

describe("full run with orchestrator reviewers", () => {
  it("local-orchestrator builds, is reviewed by codex (Astra) and claude (Fable) through review(), qualifies and merges", async () => {
    h = harness();
    h.server.reviewMode = "orchestrators";
    const reviews: RunResult[] = [];
    const reviewer = h.make("cli", { root: `${h.root}-reviewers` });
    h.idle.push(async () => {
      for (const slot of ["astra", "fable"] as const) {
        if (h!.server.reviewTasks.some((t) => t.slot === slot && t.state === "open"))
          reviews.push(await reviewer.review({ slot }, () => undefined));
      }
    });
    const events: OrchestratorEvent[] = [];
    const res = await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}` }, (e) => events.push(e));
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(reviews.map((r) => r.ok)).toEqual([true, true]);
    expect(h.server.verdicts.map((v) => `${v.slot}:${v.verdict}`)).toEqual(["astra:NO_MATERIAL_GAPS", "fable:NO_MATERIAL_GAPS"]);
    const a = [...h.server.attempts.values()][0]!;
    expect(h.server.verdicts.every((v) => v.headSha === a.headSha)).toBe(true);
    expect(steps(events)).toEqual([
      "LEASE:started",
      "LEASE:passed",
      "BUILD:started",
      "BUILD:passed",
      "VERIFY:started",
      "VERIFY:passed",
      "REVIEW:waiting",
      "REVIEW:waiting",
      "REVIEW:passed",
      "QUALIFY:passed",
      "PR:passed",
    ]);
    // Which binary ran each role, with the policy's model and reasoning.
    const agents = h.processes.invocations.filter((i) => i.binary === "claude" || i.binary === "codex");
    const launched = agents.map((i) => `${i.binary} ${i.argv[i.argv.indexOf("--model") + 1]}`);
    expect(launched).toEqual(["claude claude-opus-5-5", "codex gpt-6-astra", "claude claude-fable-5-1"]);
    const codex = agents[1]!;
    expect(codex.argv[0]).toBe("exec");
    expect(codex.argv.at(-1)).toBe("-");
    expect(codex.argv).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
    expect(codex.argv).not.toContain("ultra");
    // Every run posted its own manifest, built by the real context engine, and a signed run record.
    expect(h.server.manifestBodies).toHaveLength(3);
    expect(h.server.agentRuns).toHaveLength(3);
  });

  it("local-orchestrator R-002 describeInvocation equals the launched argv for the builder and both reviewer slots", async () => {
    h = harness();
    h.server.reviewMode = "orchestrators";
    const reviewer = h.make("cli", { root: `${h.root}-reviewers` });
    h.idle.push(async () => {
      for (const slot of ["astra", "fable"] as const) {
        if (h!.server.reviewTasks.some((t) => t.slot === slot && t.state === "open")) await reviewer.review({ slot }, () => undefined);
      }
    });
    await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}` }, () => undefined);
    const o = h.make("cli");
    const agents = h.processes.invocations.filter((i) => i.binary === "claude" || i.binary === "codex");
    const plans = [...h.server.leases.keys()].map((id) => h!.server.planOf(id)).filter((p) => p !== undefined);
    expect(plans.map((p) => p.role)).toEqual(["builder", "implementation_reviewer_astra", "implementation_reviewer_fable"]);
    plans.forEach((plan, i) => {
      const shown = o.describeInvocation(plan);
      const ran = agents[i]!;
      expect(shown.binary).toBe(ran.binary);
      // Same argv except the per-run placeholders (session id, temp paths, worktree).
      const norm = (argv: string[]) => argv.map((x) => (/^<.*>$|^[0-9a-f-]{36}$|^\//.test(x) ? "<p>" : x));
      const schemaFree = (argv: string[]) => norm(argv).map((x) => (x.startsWith("{") ? "<schema>" : x));
      expect(schemaFree(shown.argv)).toEqual(schemaFree(ran.argv));
    });
  });
});

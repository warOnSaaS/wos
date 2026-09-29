import { createPublicKey, verify } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorEvent } from "@waronsaas/contracts";
import { canonicalJson, submissionSha256 } from "@waronsaas/contracts/canonical";
import { afterEach, describe, expect, it } from "vitest";
import { DEVICE_KEY } from "../src/session.js";
import { ABU_KEY, git, TARGET } from "./support/fake-control-plane.js";
import { type Harness, harness } from "./support/harness.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const ABU_REF = `${TARGET}/${ABU_KEY}`;
const steps = (events: OrchestratorEvent[]) =>
  events.filter((e) => e.type === "step").map((e) => (e.type === "step" ? `${e.step}:${e.status}` : ""));
const attemptStates = (events: OrchestratorEvent[]) => {
  const out: string[] = [];
  for (const e of events) if (e.type === "attempt" && out.at(-1) !== e.attempt.state) out.push(e.attempt.state);
  return out;
};

describe("orchestrator build (fake control plane, fake claude)", () => {
  it("local-orchestrator drives LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR to merged", async () => {
    h = harness();
    const events: OrchestratorEvent[] = [];
    const res = await h.make("cli").build({ abu: ABU_REF }, (e) => events.push(e));
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
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
    const a = [...h.server.attempts.values()][0]!;
    expect(a.events).toEqual([
      "claim->leased",
      "leased->building",
      "building->verifying",
      "verifying->submitted",
      "submitted->candidate_pushed",
      "candidate_pushed->in_review",
      "in_review->qualified",
      "qualified->pr_open",
      "pr_open->merged",
    ]);
    // The submission: parent = the lease's base, the agent's file, a correct diff hash and a valid device signature.
    const cs = h.server.submissions[0]!;
    expect(cs.parentCommit).toBe(h.upstream.base);
    expect(cs.files.map((f) => `${f.op} ${f.path}`)).toEqual(["upsert modules/contacts/list.ts"]);
    expect(cs.submissionSha256).toBe(submissionSha256(cs.parentCommit, cs.files));
    expect(cs.localVerification.map((v) => `${v.id}:${v.exitCode}`)).toEqual(["install:0", "unit:0", "acceptance:list:0"]);
    const pem = (await h.secrets.get(DEVICE_KEY))!;
    const { signature, ...unsigned } = cs;
    const signedView = { ...unsigned, files: unsigned.files.map((f) => (f.op === "upsert" ? { ...f, contentBase64: f.sha256 } : f)) };
    expect(verify(null, Buffer.from(canonicalJson(signedView)), createPublicKey(pem), Buffer.from(signature, "base64"))).toBe(true);
    // The agent ran in the worktree, at the pinned base, with the policy's argv and no inherited secrets.
    const agent = h.processes.invocations.find((i) => i.binary === "claude")!;
    expect(agent.argv).toEqual(["-p", "--model", "claude-opus-5-5", "--effort", "high", "--output-format", "stream-json"]);
    expect(agent.env).toEqual({ PATH: "/usr/bin:/bin", CLAUDE_CODE_SAFE_MODE: "1" });
    expect(agent.cwd.startsWith(join(realpathSync(h.root), "worktrees"))).toBe(true);
    // Every idempotent call carried a key; the agent run record was posted and signed.
    expect(
      h.server.calls
        .filter((c) => ["claimBuild", "postManifest", "postAgentRun", "submitChangeset"].includes(c.route))
        .every((c) => c.idempotencyKey),
    ).toBe(true);
    expect(h.server.agentRuns).toHaveLength(1);
    // Terminal: worktree removed and local state dropped.
    expect(readdirSync(join(h.root, "worktrees"))).toEqual([]);
    expect(readdirSync(join(h.root, "state"))).toEqual([]);
  });

  it("local-orchestrator goes through local repair, CI failure, changes requested and a rebase after merge_blocked", async () => {
    h = harness();
    h.processes.script.push("broken", "ok");
    h.server.outcomes = {
      ci: ["failure", "success", "success", "success"],
      review: ["gaps", "pass", "pass"],
      merge: ["blocked", "merged"],
    };
    const events: OrchestratorEvent[] = [];
    const res = await h.make("cli").build({ abu: ABU_REF }, (e) => events.push(e));
    expect(res).toMatchObject({ ok: true });
    const a = [...h.server.attempts.values()][0]!;
    const visited = new Set(a.events.map((e) => e.split("->")[1]));
    for (const s of [
      "leased",
      "building",
      "verifying",
      "submitted",
      "candidate_pushed",
      "in_review",
      "changes_requested",
      "qualified",
      "pr_open",
      "merged",
    ]) {
      expect(visited.has(s), s).toBe(true);
    }
    expect(a.events.filter((e) => e === "verifying->building")).toHaveLength(1); // one local repair
    expect(a.repairCount).toBe(3); // CI failure, review gaps, merge blocked
    const subs = h.server.submissions;
    expect(subs).toHaveLength(4);
    expect(subs[0]!.parentCommit).toBe(h.upstream.base);
    // Revisions build on the previous candidate head.
    expect(subs[1]!.parentCommit).not.toBe(h.upstream.base);
    expect(git(h.upstream.dir, "cat-file", "-t", subs[1]!.parentCommit)).toBe("commit");
    // The rebase revision starts from the moved default branch.
    expect(subs[3]!.parentCommit).toBe(git(h.upstream.dir, "rev-parse", "main"));
    expect(events.some((e) => e.type === "verify" && e.status === "failed")).toBe(true);
    expect(events.filter((e) => e.type === "step" && e.step === "REVIEW" && e.status === "failed")).toHaveLength(3);
  }, 30_000); // integration glue: real git work; 5 s default times out under full-suite load

  it("fails with LIMIT_REACHED when local verification keeps failing after the repair limit", async () => {
    h = harness();
    h.processes.script.push("broken", "broken", "broken", "broken");
    const res = await h.make("cli").build({ abu: ABU_REF }, () => undefined);
    expect(res).toMatchObject({ ok: false, code: "LIMIT_REACHED" });
    expect(h.processes.runs).toBe(4); // first run + maxLocalRepairLoops (3)
    expect(h.server.submissions).toHaveLength(0);
  });

  it("refuses to submit out-of-scope changes and repairs locally", async () => {
    h = harness();
    h.processes.script.push("out-of-scope", "ok");
    const events: OrchestratorEvent[] = [];
    const res = await h.make("cli").build({ abu: ABU_REF, detachAfterSubmit: true }, (e) => events.push(e));
    expect(res).toMatchObject({ ok: true });
    const scope = events.find((e) => e.type === "scope" && !e.validation.ok);
    expect(scope).toMatchObject({ validation: { errors: [{ code: "OUT_OF_SCOPE", path: "README.md" }] } });
    expect(h.server.submissions).toHaveLength(1);
  });

  it("refuses the submission when the CLI reports a different model than the policy requested", async () => {
    h = harness();
    h.processes.script.push("wrong-model");
    const res = await h.make("cli").build({ abu: ABU_REF }, () => undefined);
    expect(res).toMatchObject({ ok: false, code: "MODEL_MISMATCH" });
    expect(h.server.agentRuns).toHaveLength(1); // the run is still recorded
    expect(h.server.submissions).toHaveLength(0);
  });
});

describe("resume after a process restart", () => {
  it("re-attaches to an active lease after the process died mid-build", async () => {
    h = harness();
    h.processes.script.push("crash");
    const first = await h.make("cli").build({ abu: ABU_REF }, () => undefined);
    expect(first).toMatchObject({ ok: false });
    expect(readdirSync(join(h.root, "state"))).toHaveLength(1);
    // A new process: new orchestrator instance, same workspace and keychain.
    const events: OrchestratorEvent[] = [];
    const results = await h.make("cli").resume((e) => events.push(e));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true });
    expect([...h.server.attempts.values()][0]!.state).toBe("merged");
    expect(steps(events)[0]).toBe("LEASE:passed");
  });

  it("waits for CI, reviews and merge after a detached submit", async () => {
    h = harness();
    const first = await h.make("desktop").build({ abu: ABU_REF }, () => undefined); // Desktop detaches by default
    expect(first).toMatchObject({ ok: true });
    expect([...h.server.attempts.values()][0]!.state).toBe("submitted");
    const events: OrchestratorEvent[] = [];
    const results = await h.make("desktop").resume((e) => events.push(e));
    expect(results[0]).toMatchObject({ ok: true });
    expect(attemptStates(events)).toEqual(["submitted", "candidate_pushed", "in_review", "qualified", "pr_open", "merged"]);
    expect(await h.make("desktop").resume(() => undefined)).toEqual([]);
  });

  it("release gives the lease back and removes the worktree", async () => {
    h = harness();
    h.processes.script.push("crash");
    await h.make("cli").build({ abu: ABU_REF }, () => undefined);
    const lease = [...h.server.leases.values()].find((l) => l.state === "active")!;
    await h.make("cli").release(lease.id, "changed my mind");
    expect(h.server.leases.get(lease.id)!.state).toBe("released");
    expect(readdirSync(join(h.root, "worktrees"))).toEqual([]);
    expect(existsSync(join(h.root, "state")) ? readdirSync(join(h.root, "state")) : []).toEqual([]);
  });
});

describe("one orchestrator for CLI and Desktop", () => {
  it("local-orchestrator R-001 the same fake run through CLI and Desktop produces identical event streams", async () => {
    const run = async (kind: "cli" | "desktop") => {
      const hh = harness();
      try {
        hh.processes.script.push("broken", "ok");
        hh.server.outcomes = { ci: ["failure", "success"], review: ["pass"], merge: ["merged"] };
        const events: OrchestratorEvent[] = [];
        await hh.make(kind).build({ abu: ABU_REF, detachAfterSubmit: false }, (e) => events.push(e));
        return JSON.stringify(events).replaceAll(hh.root, "<ws>");
      } finally {
        hh.dispose();
      }
    };
    const cli = await run("cli");
    const desktop = await run("desktop");
    expect(cli.length).toBeGreaterThan(1000);
    expect(desktop).toBe(cli);
  });

  it("describeInvocation is pure and matches what build launches", () => {
    h = harness();
    const o = h.make("cli");
    const plan = {
      schema: "wos-context-plan.v1",
      modelId: "claude-opus-5-5",
      reasoning: "high",
    } as Parameters<typeof o.describeInvocation>[0];
    expect(o.describeInvocation(plan)).toEqual({
      binary: "claude",
      argv: ["-p", "--model", "claude-opus-5-5", "--effort", "high", "--output-format", "stream-json"],
      env: { CLAUDE_CODE_SAFE_MODE: "1" },
    });
  });
});

describe("api client", () => {
  it("maps API errors and refuses to call authenticated routes when signed out", async () => {
    h = harness();
    await h.secrets.delete("wos.session.v1");
    const res = await h.make("cli").build({ abu: ABU_REF }, () => undefined);
    expect(res).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    const bad = await harness();
    try {
      const r = await bad.make("cli").build({ abu: `${TARGET}/contacts#99` }, () => undefined);
      expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
    } finally {
      bad.dispose();
    }
  });

  it("propose goes through the API with an idempotency key", async () => {
    h = harness();
    const r = await h
      .make("cli")
      .propose({ target: TARGET, feature: null, title: "Add a contacts export", body: "Contacts should export to CSV like Salesforce." });
    expect(r.issueUrl).toBe("https://github.com/waronsaas/product/issues/1");
    expect(h.server.calls.at(-1)).toMatchObject({ route: "createProposal" });
    expect(h.server.calls.at(-1)!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/**
 * Real processes: fake `claude` and `codex` binaries (node scripts) and the repo's check command found on
 * PATH, launched by createNodeProcessRunner with the argv the REAL agent-policy builds. Also `status()`
 * probing the same binaries.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthorSummary, OrchestratorEvent } from "@waronsaas/contracts";
import { roadmapFiles } from "../../../services/control-plane/test/support/roadmap-fixture.js";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeProcessRunner, createOrchestrator } from "../src/index.js";
import { ABU_KEY, TARGET } from "./support/fake-control-plane.js";
import { type Harness, harness, testEngines } from "./support/harness.js";

let h: Harness | null = null;
let bin: string | null = null;
afterEach(() => {
  h?.dispose();
  if (bin) rmSync(bin, { recursive: true, force: true });
  h = null;
  bin = null;
});

// Shared by both fakes: answers --version and the login check, otherwise runs as an agent.
const AGENT = (provider: "claude" | "codex") => `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
const provider = ${JSON.stringify(provider)};
if (argv[0] === "--version") { console.log(provider === "claude" ? "2.1.284 (Claude Code)" : "codex-cli 0.155.0"); process.exit(0); }
if (provider === "claude" && argv[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); process.exit(0); }
if (provider === "codex" && argv[0] === "login") { console.log("Logged in using ChatGPT"); process.exit(0); }
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
  if (prompt.length < 100) { console.error("no prompt on stdin"); process.exit(2); }
  const model = argv[argv.indexOf("--model") + 1];
  const readOnly = argv.includes("read-only") || argv.includes("dontAsk");
  const output = readOnly
    ? { schema: "review-verdict.v1", verdict: "NO_MATERIAL_GAPS", summary: "No material gaps.", findings: [], priorFindings: [] }
    : { schema: "build-summary.v1", summary: provider + " did it", requirementsCovered: ["R-001"], responses: [], abuConcerns: [] };
  if (!readOnly) fs.writeFileSync("modules/contacts/list.ts", "export const list = () => ['from fake " + provider + "'];\\n");
  if (provider === "claude") {
    console.log(JSON.stringify({ type: "system", subtype: "init", model }));
    console.log(JSON.stringify({ type: "result", subtype: "success", structured_output: output }));
  } else {
    console.log(JSON.stringify({ type: "thread.started", model }));
    fs.writeFileSync(argv[argv.indexOf("-o") + 1], JSON.stringify(output));
  }
});
`;
/**
 * Fake `opencode` (1.18.31 shapes): --version, `providers list` (ANSI, names only), and `run` reading the task from stdin,
 * writing ROADMAP.yaml and the output file, and printing json events: sub-agents (task), a fetch, a search, tokens.
 * WOS_FAKE_OPENCODE (written into the fake itself by the test) picks the scenario.
 */
const OPENCODE = (scenario: "ok" | "off-allowlist" | "no-output" | "files", filesJson = "") => `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("1.18.31"); process.exit(0); }
if (argv[0] === "providers" && argv[1] === "list") {
  const esc = String.fromCharCode(27);
  console.log([esc + "[0m", "┌  Credentials " + esc + "[90m~/.local/share/opencode/auth.json", "│", "●  OpenCode Go " + esc + "[90mapi", "│", "└  1 credentials"].join(String.fromCharCode(10)));
  process.exit(0);
}
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
  if (argv[0] !== "run" || prompt.length < 100) { console.error("no task on stdin"); process.exit(2); }
  const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}");
  if (!process.env.XDG_CONFIG_HOME || fs.readdirSync(process.env.XDG_CONFIG_HOME).length !== 0) { console.error("config home"); process.exit(3); }
  if (config.permission?.task !== "allow" || config.agent?.general?.permission?.webfetch !== "deny") { console.error("config"); process.exit(4); }
  fs.mkdirSync("roadmaps/salesforce", { recursive: true });
  fs.writeFileSync("roadmaps/salesforce/ROADMAP.yaml", ["schema: wos-roadmap.v1", "target: salesforce", ""].join(String.fromCharCode(10)));
  if (${JSON.stringify(scenario)} === "files")
    for (const f of JSON.parse(fs.readFileSync(${JSON.stringify(filesJson)}, "utf8"))) {
      fs.mkdirSync(require("node:path").dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.content);
    }
  const out = { schema: "author-summary.v1", summary: "drafted by fake opencode", responses: [], proposalsAddressed: [] };
  if (${JSON.stringify(scenario)} !== "no-output") fs.writeFileSync(".wos-agent-output.json", JSON.stringify(out));
  const ev = (type, part) => console.log(JSON.stringify({ type, timestamp: 1, sessionID: "ses_1", part }));
  ev("step_start", { type: "step-start" });
  for (const [i, s, e] of [[1, 1000, 5000], [2, 1100, 4000], [3, 1200, 3000], [4, 6000, 7000], [5, 6100, 6500]])
    ev("tool_use", { type: "tool", tool: "task", state: { status: "completed", input: { description: "cluster " + i }, output: "done", time: { start: s, end: e } } });
  const url = ${JSON.stringify(scenario)} === "off-allowlist" ? "https://example.org/salesforce" : "https://help.salesforce.com/s/articleView?id=sf.exporting_data.htm";
  ev("tool_use", { type: "tool", tool: "webfetch", state: { status: "completed", input: { url }, output: "Data Export Service", time: { start: 8000, end: 9000 } } });
  ev("tool_use", { type: "tool", tool: "websearch", state: { status: "completed", input: { query: "salesforce bulk api 2.0" }, output: "results", time: { start: 9100, end: 9200 } } });
  ev("step_finish", { type: "step-finish", tokens: { input: 1200, output: 340, reasoning: 50, cache: { read: 0, write: 0 } }, cost: 0 });
  const reason = ${JSON.stringify(scenario)} === "no-output" ? "length" : "stop";
  ev("step_finish", { type: "step-finish", reason, tokens: { input: 800, output: 60, reasoning: 0, cache: { read: 97673, write: 0 } }, cost: 0.47 });
});
`;

const FAKE_CHECK = `#!/bin/sh
[ "$1" = install ] && exit 0
grep -q BROKEN modules/contacts/list.ts && { echo "FAIL"; exit 1; }
echo PASS
`;

function installBinaries(
  opencode: "ok" | "off-allowlist" | "no-output" | "files" = "ok",
  files: Array<{ path: string; content: string }> = [],
): string {
  const dir = mkdtempSync(join(tmpdir(), "wos-bin-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "files.json"), JSON.stringify(files));
  for (const [name, text] of [
    ["claude", AGENT("claude")],
    ["codex", AGENT("codex")],
    ["opencode", OPENCODE(opencode, join(dir, "files.json"))],
    ["wos-fake-check", FAKE_CHECK],
  ] as const) {
    writeFileSync(join(dir, name), text);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function orchestrator(harnessed: Harness, binDir: string, extra: Partial<Parameters<typeof createOrchestrator>[0]> = {}) {
  return createOrchestrator({
    apiBaseUrl: "https://api.waronsaas.test",
    workspaceRoot: harnessed.root,
    secrets: harnessed.secrets,
    processes: createNodeProcessRunner(),
    fetch: harnessed.server.fetch,
    clientKind: "cli",
    clientVersion: "0.0.0-test",
    engines: testEngines,
    now: () => new Date("2026-09-29T12:00:00Z"),
    sleep: async () => {
      for (const f of harnessed.idle) await f();
    },
    pollIntervalMs: 0,
    baseEnv: { PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin` },
    ...extra,
  });
}

it("local-orchestrator runs real processes: fake claude builds, fake codex and claude review, found on PATH", async () => {
  h = harness();
  h.server.reviewMode = "orchestrators";
  bin = installBinaries();
  const o = orchestrator(h, bin);
  h.idle.push(async () => {
    for (const slot of ["astra", "fable"] as const) {
      if (h!.server.reviewTasks.some((t) => t.slot === slot && t.state === "open")) {
        const r = await o.review({ slot }, () => undefined);
        expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
      }
    }
  });
  const events: OrchestratorEvent[] = [];
  const res = await o.build({ abu: `${TARGET}/${ABU_KEY}` }, (e) => events.push(e));
  expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
  const started = events.find((e) => e.type === "agent_started");
  expect(started).toMatchObject({ provider: "claude_cli", model: "claude-opus-5-5" });
  expect((started as { pid: number }).pid).toBeGreaterThan(0);
  const cs = h.server.submissions[0]!;
  expect(Buffer.from((cs.files[0] as { contentBase64: string }).contentBase64, "base64").toString()).toContain("from fake claude");
  expect(h.server.verdicts.map((v) => v.slot)).toEqual(["astra", "fable"]);
  const runs = h.server.agentRuns as Array<{ provider: string; modelIdReported: string | null }>;
  expect(runs.map((r) => `${r.provider}:${r.modelIdReported}`)).toEqual([
    "claude_cli:claude-opus-5-5",
    "codex_cli:gpt-6-astra",
    "claude_cli:claude-fable-5-1",
  ]);
  expect([...h.server.attempts.values()][0]!.state).toBe("merged");
});

it("status() probes the real fake binaries on PATH", async () => {
  h = harness();
  bin = installBinaries();
  const s = await orchestrator(h, bin).status();
  expect(s.providers.map((p) => [p.provider, p.installed, p.signedIn, p.cliVersion, p.authMethod])).toEqual([
    ["claude_cli", true, true, "2.1.284", "claude.ai"],
    ["codex_cli", true, true, "0.155.0", "ChatGPT"],
    // contracts 5.17.0: the opencode listing names the provider and method only; ANSI codes are stripped.
    ["opencode_cli", true, true, "1.18.31", "opencode-go"],
  ]);
  expect(s.providers.find((p) => p.provider === "opencode_cli")!.models).toEqual(["glm"]);
});

describe("glm on the opencode CLI (D69 candidate trial, D70 web), with a fake opencode", () => {
  const WEB = {
    domains: ["apps.apple.com", "force.com", "play.google.com", "salesforce.com", "salesforce.org"],
    search: true,
    registry: [],
  };
  const LAUNCH = { provider: "opencode-go", baseUrl: null, identity: "self_reported" } as const;
  const FETCHED = "https://help.salesforce.com/s/articleView?id=sf.exporting_data.htm";
  const recorded = () => {
    const calls: Array<{ binary: string; argv: string[]; env: Record<string, string> }> = [];
    const real = createNodeProcessRunner();
    return {
      calls,
      runner: {
        run(input: Parameters<ReturnType<typeof createNodeProcessRunner>["run"]>[0]) {
          calls.push({ binary: input.binary, argv: input.argv, env: input.env });
          return real.run(input);
        },
      },
    };
  };

  it("runs `opencode run -m opencode-go/glm-5.3 --variant high` (policy data), reads and removes the output file, records launch, sub-agents, fetches, tokens", async () => {
    h = harness();
    h.server.authorWeb = WEB;
    bin = installBinaries("ok");
    const rec = recorded();
    const o = orchestrator(h, bin, { processes: rec.runner, modelLaunch: { glm: LAUNCH } });
    const t = h.server.openAuthorTask("roadmap_author");
    const events: OrchestratorEvent[] = [];
    const res = await o.author({ taskId: t.id, model: "glm" }, (e) => events.push(e));
    expect(res, JSON.stringify(res)).toMatchObject({
      ok: true,
      output: { schema: "author-summary.v1", summary: "drafted by fake opencode" },
    });
    expect(h.server.claimBodies.at(-1)).toMatchObject({ model: "glm", launch: LAUNCH });
    // The output file is not part of the changeset.
    expect(h.server.submissions[0]!.files.map((f) => f.path)).toEqual(["roadmaps/salesforce/ROADMAP.yaml"]);
    const run = rec.calls.find((c) => c.binary === "opencode")!;
    expect(run.argv.slice(0, 11)).toEqual([
      "run",
      "-m",
      "opencode-go/glm-5.3",
      "--format",
      "json",
      "--pure",
      "--dir",
      run.argv[7],
      "--title",
      run.argv[9],
      "--variant",
    ]);
    expect(run.argv[11]).toBe("high"); // agent-policy.v3: glm authors at high (roleReasoning)
    // agent-policy.v3: opencode's per-step output cap raised to glm-5.3's 131072-token limit; temperature 0 for authors.
    expect(run.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX).toBe("131072");
    expect(run.argv.at(-1)).toMatch(
      /Write your final output LAST.*author-summary\.v1.*\.wos-agent-output\.json.*at most 4 running at the same time/s,
    );
    const config = JSON.parse(run.env.OPENCODE_CONFIG_CONTENT!);
    expect(config.permission).toMatchObject({
      "*": "deny",
      edit: "allow",
      bash: "deny",
      task: "allow",
      websearch: "allow",
      external_directory: "deny",
    });
    expect(Object.keys(config.permission)[0]).toBe("*");
    expect(config.permission.webfetch).toBe("allow"); // opencode cannot limit domains: the allowlist is checked after the run (D70)
    expect(config.agent.general.permission).toMatchObject({ webfetch: "deny", websearch: "deny", task: "deny", edit: "deny" });
    expect(config.agent.build).toEqual({ temperature: 0 }); // D72: author sampling on opencode's default agent
    expect(run.env.XDG_CONFIG_HOME).toContain("config-home");
    expect(Object.keys(run.env).some((k) => /API_KEY|AUTH_TOKEN|SECRET|PASSWORD/.test(k))).toBe(false);
    const agentRun = h.server.agentRuns.at(-1) as Record<string, unknown>;
    expect(agentRun).toMatchObject({
      provider: "opencode_cli",
      modelIdRequested: "opencode-go/glm-5.3",
      reasoningRequested: "high",
      launch: LAUNCH,
      subagentCount: 5,
      maxConcurrentSubagents: 3,
      usage: { inputTokens: 2000, outputTokens: 400 },
    });
    expect(agentRun.fetches).toEqual([
      {
        kind: "fetch",
        target: "https://help.salesforce.com/s/articleView?id=sf.exporting_data.htm",
        at: "1970-01-01T00:00:08.000Z",
        contentSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        tool: "webfetch",
      },
      { kind: "search", target: "salesforce bulk api 2.0", at: "1970-01-01T00:00:09.100Z", contentSha256: null, tool: "websearch" },
    ]);
    expect(events.some((e) => e.type === "warning" && e.code === "SUBAGENT_CAP_EXCEEDED")).toBe(false);
    // contracts 5.19.0: the run's token accounting as opencode reported it, in the exit event and the signed record.
    const usage = {
      inputTokens: 2000,
      outputTokens: 400,
      reasoningTokens: 50,
      cacheReadTokens: 97673,
      cacheWriteTokens: 0,
      costUsd: 0.47,
      steps: 2,
      lastFinishReason: "stop",
    };
    expect(events.find((e) => e.type === "agent_exited")).toMatchObject({ exitCode: 0, usage });
    expect(agentRun.usageDetail).toEqual(usage);
  });

  it("shadow: same claim and context, validated and archived under shadow/<task>/<run>/, lease released, nothing submitted", async () => {
    h = harness();
    h.server.authorWeb = WEB;
    bin = installBinaries("ok");
    const o = orchestrator(h, bin, { modelLaunch: { glm: LAUNCH } });
    const t = h.server.openAuthorTask("roadmap_author");
    const res = await o.author({ taskId: t.id, model: "glm", shadow: true }, () => undefined);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, output: { schema: "author-summary.v1" } });
    expect(h.server.submissions).toHaveLength(0);
    expect([...h.server.leases.values()].at(-1)!.state).toBe("released");
    expect((h.server.agentRuns.at(-1) as { mode?: string }).mode).toBe("shadow");
    const base = join(h.root, "shadow", t.id);
    const [runDir] = readdirSync(base);
    const run = JSON.parse(readFileSync(join(base, runDir!, "run.json"), "utf8"));
    expect(run).toMatchObject({
      mode: "shadow",
      taskId: t.id,
      modelId: "opencode-go/glm-5.3",
      reasoning: "high",
      files: ["roadmaps/salesforce/ROADMAP.yaml"],
    });
    expect(run.manifestSha256).toMatch(/^sha256:/);
    expect(run.fetches).toHaveLength(2);
    expect(run.usage.costUsd).toBe(0.47);
    // The fake's ROADMAP.yaml is no valid roadmap: the local validation says so (nothing was submitted anyway).
    expect(run.validation.ok).toBe(false);
    expect(readFileSync(join(base, runDir!, "roadmaps/salesforce/ROADMAP.yaml"), "utf8")).toContain("wos-roadmap.v1");
    expect(readFileSync(join(base, runDir!, "transcript.jsonl"), "utf8")).toContain("step_finish");
  });

  it("D73 ensemble: N shadow runs on one manifest, merged, validated and submitted once with the runs as provenance", async () => {
    h = harness();
    h.server.authorWeb = WEB;
    // The fixture roadmap, citing the one page the fake fetches (grounding).
    const files = roadmapFiles({ target: "salesforce" }).map((f) => ({
      ...f,
      content: f.content.replaceAll("https://example.com/docs", FETCHED).replaceAll("https://example.com/export", FETCHED),
    }));
    bin = installBinaries("files", files);
    const o = orchestrator(h, bin, { modelLaunch: { glm: LAUNCH } });
    const t = h.server.openAuthorTask("roadmap_author");
    const res = await o.author({ taskId: t.id, model: "glm", ensemble: 3 }, () => undefined);
    const archived = join(h.root, "ensemble", t.id);
    expect(res, `${JSON.stringify(res)} ${existsSync(archived) ? readdirSync(archived) : ""}`).toMatchObject({ ok: true });
    const shadows = h.server.agentRuns.filter((r) => (r as { mode?: string }).mode === "shadow") as Array<Record<string, string>>;
    expect(shadows).toHaveLength(3);
    expect(h.server.submissions).toHaveLength(1);
    const cs = h.server.submissions[0] as { summary: AuthorSummary; files: Array<{ path: string }> };
    expect(cs.summary.ensemble).toMatchObject({
      threshold: 2,
      majority: "strict_majority",
      decisions: 0,
      stability: { capabilitiesMatchBp: 10_000, featuresMatchBp: 10_000, groundingBp: 10_000, belowTarget: [] },
    });
    expect(cs.summary.ensemble!.runs.map((r) => r.leaseId)).toEqual(shadows.map((r) => r.leaseId));
    expect(new Set(cs.summary.ensemble!.runs.map((r) => r.manifestSha256)).size).toBe(1);
    expect(cs.files.map((f) => f.path)).toContain("roadmaps/salesforce/DECISIONS.md");
  });

  it("D73 ensemble: a run whose roadmap does not parse stops the merge; nothing is submitted and the lease is released", async () => {
    h = harness();
    h.server.authorWeb = WEB;
    bin = installBinaries("ok");
    const o = orchestrator(h, bin, { modelLaunch: { glm: LAUNCH } });
    const t = h.server.openAuthorTask("roadmap_author");
    const res = await o.author({ taskId: t.id, model: "glm", ensemble: 2 }, () => undefined);
    expect(res, JSON.stringify(res)).toMatchObject({ ok: false, code: "ENSEMBLE_RUN_INVALID" });
    expect(h.server.submissions).toHaveLength(0);
    expect([...h.server.leases.values()].every((l) => l.state === "released")).toBe(true);
    expect(await o.author({ taskId: t.id, model: "glm", ensemble: 9 }, () => undefined)).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
  });

  it("wos resubmit (contracts 5.20.0): a failed submission's archived output is re-sent on a fresh lease without a model run", async () => {
    h = harness();
    h.server.authorWeb = WEB;
    bin = installBinaries("ok");
    const o = orchestrator(h, bin, { modelLaunch: { glm: LAUNCH } });
    const t = h.server.openAuthorTask("roadmap_author");
    h.server.failNextSubmission = { status: 502, code: "UPSTREAM_GITHUB", message: "GitHub commit failed: INVALID_INPUT: refused" };
    const first = await o.author({ taskId: t.id, model: "glm" }, () => undefined);
    expect(first).toMatchObject({ ok: false, code: "UPSTREAM_GITHUB" });
    const oldLease = [...h.server.leases.values()].at(-1)!;
    expect(oldLease.state).toBe("active"); // the submission reached the control plane: the lease is not given back
    const base = join(h.root, "failed", t.id);
    const [runDir] = readdirSync(base);
    const dir = join(base, runDir!);
    const runsBefore = h.server.agentRuns.length;
    const claimsBefore = h.server.claimBodies.length;
    const events: OrchestratorEvent[] = [];
    const res = await o.author({ taskId: t.id, resubmitFrom: dir }, (e) => events.push(e));
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true, output: { schema: "author-summary.v1" } });
    expect(h.server.agentRuns).toHaveLength(runsBefore); // no model ran
    expect(events.some((e) => e.type === "agent_started")).toBe(false);
    expect(oldLease.state).toBe("released");
    // Claimed again with the archived run's model and launch.
    expect(h.server.claimBodies.slice(claimsBefore)).toEqual([expect.objectContaining({ model: "glm", launch: LAUNCH })]);
    const sent = h.server.submissions.at(-1)!;
    expect(sent.resubmission).toEqual({ fromLeaseId: oldLease.id, reason: expect.stringContaining("no model ran on this lease") });
    expect(sent.leaseId).not.toBe(oldLease.id);
    expect(sent.files.map((f) => f.path)).toEqual(["roadmaps/salesforce/ROADMAP.yaml"]);
    const archived = readFileSync(join(dir, "roadmaps/salesforce/ROADMAP.yaml"));
    expect(Buffer.from((sent.files[0] as { contentBase64: string }).contentBase64, "base64").equals(archived)).toBe(true);
    // The archived output as parsed (contracts 5.21.0: an absent `ensemble` parses as null).
    expect(sent.summary).toEqual({ ensemble: null, ...JSON.parse(readFileSync(join(dir, "output.json"), "utf8")) });
    // Another task's archive is refused before anything is claimed.
    const other = h.server.openAuthorTask("roadmap_author");
    const wrong = await o.author({ taskId: other.id, resubmitFrom: dir }, () => undefined);
    expect(wrong).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  it("D70: a fetch off the plan's allowlist refuses the submission (after the run is recorded)", async () => {
    h = harness();
    h.server.authorWeb = WEB;
    bin = installBinaries("off-allowlist");
    const o = orchestrator(h, bin, { modelLaunch: { glm: LAUNCH } });
    const t = h.server.openAuthorTask("roadmap_author");
    const res = await o.author({ taskId: t.id, model: "glm" }, () => undefined);
    expect(res).toMatchObject({ ok: false, code: "NETWORK_POLICY" });
    expect((res as { message: string }).message).toContain("https://example.org/salesforce");
    expect(h.server.agentRuns).toHaveLength(1);
    expect(h.server.submissions).toHaveLength(0);
  });

  it("fails closed without the output file", async () => {
    h = harness();
    h.server.authorWeb = WEB;
    bin = installBinaries("no-output");
    const o = orchestrator(h, bin, { modelLaunch: { glm: LAUNCH } });
    const t = h.server.openAuthorTask("roadmap_author");
    const events: OrchestratorEvent[] = [];
    const res = await o.author({ taskId: t.id, model: "glm" }, (e) => events.push(e));
    expect(res).toMatchObject({ ok: false, code: "AGENT_OUTPUT_INVALID" });
    expect(h.server.submissions).toHaveLength(0);
    // contracts 5.19.0: the cap is named, the partial files are archived, and the lease is given back for a retry.
    expect(events.some((e) => e.type === "warning" && e.code === "OUTPUT_CAP_REACHED")).toBe(true);
    expect([...h.server.leases.values()].at(-1)!.state).toBe("released");
    const base = join(h.root, "failed", t.id);
    const [runDir] = readdirSync(base);
    expect(readFileSync(join(base, runDir!, "roadmaps/salesforce/ROADMAP.yaml"), "utf8")).toContain("wos-roadmap.v1");
    const run = JSON.parse(readFileSync(join(base, runDir!, "run.json"), "utf8"));
    expect(run).toMatchObject({ mode: "failed", error: { code: "AGENT_OUTPUT_INVALID" }, usage: { lastFinishReason: "length" } });
  });
});

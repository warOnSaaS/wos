/**
 * Real processes: fake `claude` and `codex` binaries (node scripts) and the repo's check command found on
 * PATH, launched by createNodeProcessRunner with the argv the REAL agent-policy builds. Also `status()`
 * probing the same binaries.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OrchestratorEvent } from "@waronsaas/contracts";
import { afterEach, expect, it } from "vitest";
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
const FAKE_CHECK = `#!/bin/sh
[ "$1" = install ] && exit 0
grep -q BROKEN modules/contacts/list.ts && { echo "FAIL"; exit 1; }
echo PASS
`;

function installBinaries(): string {
  const dir = mkdtempSync(join(tmpdir(), "wos-bin-"));
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of [
    ["claude", AGENT("claude")],
    ["codex", AGENT("codex")],
    ["wos-fake-check", FAKE_CHECK],
  ] as const) {
    writeFileSync(join(dir, name), text);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function orchestrator(harnessed: Harness, binDir: string) {
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
  ]);
});

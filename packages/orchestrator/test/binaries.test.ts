import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { OrchestratorEvent } from "@waronsaas/contracts";
import { afterEach, expect, it } from "vitest";
import { createNodeProcessRunner, createOrchestrator } from "../src/index.js";
import { ABU_KEY, TARGET } from "./support/fake-control-plane.js";
import { fakeEngines, type Harness, harness } from "./support/harness.js";

let h: Harness | null = null;
let bin: string | null = null;
afterEach(() => {
  h?.dispose();
  if (bin) rmSync(bin, { recursive: true, force: true });
  h = null;
  bin = null;
});

const FAKE_CLAUDE = `#!/usr/bin/env node
// Fake claude CLI: reads the prompt on stdin, edits the worktree (cwd), prints stream-json.
const fs = require("node:fs");
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
  if (!prompt.startsWith("Build ")) { console.error("no prompt on stdin"); process.exit(2); }
  const model = process.argv[process.argv.indexOf("--model") + 1];
  fs.writeFileSync("modules/contacts/list.ts", "export const list = () => ['from fake claude'];\\n");
  console.log(JSON.stringify({ type: "system", subtype: "init", model }));
  console.log(JSON.stringify({ type: "result", subtype: "success", structured_output: {
    schema: "build-summary.v1", summary: "fake claude did it", requirementsCovered: ["R-001"], responses: [], abuConcerns: [] } }));
});
`;
const FAKE_CHECK = `#!/bin/sh
[ "$1" = install ] && exit 0
grep -q BROKEN modules/contacts/list.ts && { echo "FAIL"; exit 1; }
echo PASS
`;

it("local-orchestrator runs real processes: a fake claude and check command found on PATH", async () => {
  h = harness();
  bin = mkdtempSync(join(tmpdir(), "wos-bin-"));
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  writeFileSync(join(bin, "wos-fake-check"), FAKE_CHECK);
  chmodSync(join(bin, "claude"), 0o755);
  chmodSync(join(bin, "wos-fake-check"), 0o755);
  const o = createOrchestrator({
    apiBaseUrl: "https://api.waronsaas.test",
    workspaceRoot: h.root,
    secrets: h.secrets,
    processes: createNodeProcessRunner(),
    fetch: h.server.fetch,
    clientKind: "cli",
    clientVersion: "0.0.0-test",
    engines: fakeEngines,
    now: () => new Date("2026-09-29T12:00:00Z"),
    sleep: async () => undefined,
    pollIntervalMs: 0,
    baseEnv: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` },
  });
  const events: OrchestratorEvent[] = [];
  const res = await o.build({ abu: `${TARGET}/${ABU_KEY}` }, (e) => events.push(e));
  expect(res).toMatchObject({ ok: true });
  const started = events.find((e) => e.type === "agent_started");
  expect(started).toMatchObject({ provider: "claude_cli", model: "claude-opus-5-5" });
  expect((started as { pid: number }).pid).toBeGreaterThan(0);
  const cs = h.server.submissions[0]!;
  expect(Buffer.from((cs.files[0] as { contentBase64: string }).contentBase64, "base64").toString()).toContain("from fake claude");
  expect([...h.server.attempts.values()][0]!.state).toBe("merged");
});

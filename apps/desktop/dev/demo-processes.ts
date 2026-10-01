/**
 * Fake `git`-adjacent probes, fake `claude` / `codex` and the fixture repo's `wos-fake-check`, for the
 * FAKE control plane (development, screenshots and tests; never shipped). Behaves like the orchestrator
 * package's test FakeProcesses (same output formats: claude stream-json, codex --json plus the -o file)
 * but streams a few lines with a delay so the activity pane shows a live run.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildSummary, ReviewVerdict } from "@waronsaas/contracts";
import type { ProcessRunner } from "@waronsaas/orchestrator";

type RunInput = Parameters<ProcessRunner["run"]>[0];

export class DemoProcesses implements ProcessRunner {
  runs = 0;
  constructor(
    readonly machine: "macos" | "linux",
    readonly delayMs = 0,
  ) {}

  private wait(ms = this.delayMs): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  private probe(binary: string, argv: string[]): string | null {
    const table: Record<string, string> = {
      "git --version": "git version 2.47.1\n",
      "node --version": "v22.23.1\n",
      "claude --version": "2.1.284 (Claude Code)\n",
      "claude auth status": '{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}\n',
      "codex --version": "codex-cli 0.155.0\n",
      "codex login status": "Logged in using ChatGPT\n",
      ...(this.machine === "macos"
        ? { "sw_vers -productVersion": "15.6.1\n", "xcodebuild -version": "Xcode 26.0.1\nBuild version 17A400\n" }
        : { "uname -r": "6.8.0-85-generic\n" }),
    };
    return table[[binary, ...argv].join(" ")] ?? null;
  }

  private schemaOf(binary: string, argv: string[]): string | null {
    const i = binary === "claude" ? argv.indexOf("--json-schema") : argv.indexOf("--output-schema");
    const v = i >= 0 ? (argv[i + 1] ?? "") : "";
    const text = binary === "claude" ? v : existsSync(v) ? readFileSync(v, "utf8") : "";
    for (const id of ["review-verdict.v1", "author-summary.v1", "ruling.v1", "build-summary.v1"]) if (text.includes(id)) return id;
    return null;
  }

  async run(input: RunInput): Promise<{ exitCode: number; durationMs: number }> {
    const probe = this.probe(input.binary, input.argv);
    if (probe !== null) {
      input.onStdout(probe);
      return { exitCode: 0, durationMs: 1 };
    }
    if (input.binary === "wos-fake-check") {
      if (input.argv[0] === "install") {
        input.onStdout("installed 0 packages (fixture)\n");
        return { exitCode: 0, durationMs: 1 };
      }
      await this.wait();
      const src = readFileSync(join(input.cwd, "modules/contacts/list.ts"), "utf8");
      if (src.includes("BROKEN")) {
        input.onStdout("FAIL unit: list() is broken\n");
        return { exitCode: 1, durationMs: 1 };
      }
      input.onStdout("PASS unit  modules/contacts/list.test.ts (3 tests)\n");
      return { exitCode: 0, durationMs: 1 };
    }
    if (input.binary !== "claude" && input.binary !== "codex") return { exitCode: 127, durationMs: 1 };
    const modelId = input.argv[input.argv.indexOf("--model") + 1] ?? "unknown";
    const schema = this.schemaOf(input.binary, input.argv);
    input.onSpawn?.(40_000 + this.runs);
    if (schema === "review-verdict.v1") {
      const verdict: ReviewVerdict = {
        schema: "review-verdict.v1",
        verdict: "NO_MATERIAL_GAPS",
        summary: "No material gaps.",
        findings: [],
        priorFindings: [],
        decisionRulings: [],
      };
      return this.emit(input, modelId, verdict, ["Reading the diff against the Feature Contract.", "Checking R-001 coverage."]);
    }
    this.runs += 1;
    writeFileSync(
      join(input.cwd, "modules/contacts/list.ts"),
      `export const list = (page = 0) => [].slice(page * 50, page * 50 + 50); // v${this.runs}\n`,
    );
    const summary: BuildSummary = {
      schema: "build-summary.v1",
      summary: "Implemented the paginated contact list (R-001).",
      requirementsCovered: ["R-001"],
      responses: [],
      abuConcerns: [],
    };
    return this.emit(input, modelId, summary, [
      "Reading features/contacts/CONTRACT.yaml and the unit's scope.",
      "Editing modules/contacts/list.ts: 50 per page, newest first.",
      "Running the acceptance check `list`.",
    ]);
  }

  private async emit(input: RunInput, model: string, output: unknown, lines: string[]) {
    if (input.binary === "claude") {
      input.onStdout(`${JSON.stringify({ type: "system", subtype: "init", model })}\n`);
      for (const text of lines) {
        await this.wait();
        input.onStdout(`${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`);
      }
      input.onStdout(
        `${JSON.stringify({ type: "result", subtype: "success", structured_output: output, usage: { input_tokens: 10, output_tokens: 5 } })}\n`,
      );
    } else {
      input.onStdout(`${JSON.stringify({ type: "thread.started", model })}\n`);
      for (const text of lines) {
        await this.wait();
        input.onStdout(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } })}\n`);
      }
      const o = input.argv[input.argv.indexOf("-o") + 1]!;
      writeFileSync(o, JSON.stringify(output));
      input.onStdout(`${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } })}\n`);
    }
    return { exitCode: 0, durationMs: 7 };
  }
}

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  AGENT_POLICY,
  BuildGraph,
  type AuthorSummary,
  type BuildSummary,
  type Ruling,
  type ReviewVerdict,
  type Orchestrator,
  type OrchestratorEvent,
} from "@waronsaas/contracts";
import { configureLocalGit } from "@waronsaas/github/local";
import { vi } from "vitest";
import { createOrchestrator, type Engines, type ProcessRunner, type SecretStore } from "../../src/index.js";
import { SESSION_KEY } from "../../src/session.js";
import { ABU_KEY, FakeControlPlane, FIXED_DATE, makeUpstream } from "./fake-control-plane.js";

export type AgentAction = "ok" | "broken" | "crash" | "wrong-model" | "out-of-scope";

export class MemorySecrets implements SecretStore {
  readonly map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async delete(k: string) {
    this.map.delete(k);
  }
}

// Every scenario does real git work (mirrors, worktrees, candidate commits); 5 s is too tight under full-suite load.
vi.setConfig({ testTimeout: 30_000 });

export type Machine = "macos" | "linux";

/** Version and login probes answered like the real tools on a macOS or Linux machine (status snapshots). */
export function probeOutput(machine: Machine, binary: string, argv: string[]): { exitCode: number; out: string } | null {
  const cmd = [binary, ...argv].join(" ");
  const table: Record<string, string> = {
    "git --version": "git version 2.47.1\n",
    "node --version": "v22.23.1\n",
    "claude --version": "2.1.284 (Claude Code)\n",
    "claude auth status": '{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}\n',
    "codex --version": "codex-cli 0.155.0\n",
    "codex login status": "Logged in using ChatGPT\n",
    ...(machine === "macos"
      ? { "sw_vers -productVersion": "15.6.1\n", "xcodebuild -version": "Xcode 26.0.1\nBuild version 17A400\n" }
      : { "uname -r": "6.8.0-85-generic\n", "sdkmanager --version": "12.0\n" }),
  };
  const out = table[cmd];
  return out === undefined ? null : { exitCode: 0, out };
}

/** Which output schema the real agent-policy argv pins: claude --json-schema <json>, codex --output-schema <file>. */
export function outputSchemaOf(binary: string, argv: string[]): string | null {
  const text =
    binary === "claude"
      ? (argv[argv.indexOf("--json-schema") + 1] ?? "")
      : existsSync(argv[argv.indexOf("--output-schema") + 1] ?? "")
        ? readFileSync(argv[argv.indexOf("--output-schema") + 1]!, "utf8")
        : "";
  for (const id of ["review-verdict.v1", "author-summary.v1", "ruling.v1", "build-summary.v1"]) if (text.includes(id)) return id;
  return null;
}

/** Fake `claude`, fake `codex` and the repo's fake check command. Agents edit the worktree like real ones. */
export class FakeProcesses implements ProcessRunner {
  runs = 0;
  machine: Machine = "linux";
  readonly script: AgentAction[] = [];
  reviewVerdict: "NO_MATERIAL_GAPS" | "MATERIAL_GAPS" = "NO_MATERIAL_GAPS";
  readonly invocations: Array<{ binary: string; argv: string[]; cwd: string; env: Record<string, string> }> = [];

  async run(input: Parameters<ProcessRunner["run"]>[0]): Promise<{ exitCode: number; durationMs: number }> {
    this.invocations.push({ binary: input.binary, argv: input.argv, cwd: input.cwd, env: input.env });
    const probe = probeOutput(this.machine, input.binary, input.argv);
    if (probe) {
      input.onStdout(probe.out);
      return { exitCode: probe.exitCode, durationMs: 1 };
    }
    if (input.binary === "wos-fake-check") {
      if (input.argv[0] === "install") return { exitCode: 0, durationMs: 1 };
      const src = readFileSync(join(input.cwd, "modules/contacts/list.ts"), "utf8");
      if (src.includes("BROKEN")) {
        input.onStdout("FAIL unit: list() is broken\n");
        return { exitCode: 1, durationMs: 1 };
      }
      input.onStdout("PASS unit\n");
      return { exitCode: 0, durationMs: 1 };
    }
    if (input.binary !== "claude" && input.binary !== "codex") return { exitCode: 127, durationMs: 1 };
    const modelId = input.argv[input.argv.indexOf("--model") + 1]!;
    const schema = outputSchemaOf(input.binary, input.argv);
    if (schema === "review-verdict.v1") return this.review(input, modelId);
    if (schema === "author-summary.v1") return this.author(input, modelId);
    if (schema === "ruling.v1") return this.rule(input, modelId);
    this.runs += 1;
    const action = this.script.shift() ?? "ok";
    if (action === "crash") throw new Error("the machine went to sleep");
    input.onSpawn?.(4242);
    const content = action === "broken" ? "export const list = () => BROKEN;\n" : `export const list = () => ['v${this.runs}'];\n`;
    writeFileSync(join(input.cwd, "modules/contacts/list.ts"), content);
    if (action === "out-of-scope") writeFileSync(join(input.cwd, "README.md"), "not mine\n");
    else if (existsSync(join(input.cwd, "README.md")) && readFileSync(join(input.cwd, "README.md"), "utf8") === "not mine\n") {
      rmSync(join(input.cwd, "README.md")); // a repair run undoes its out-of-scope edit
    }
    const summary: BuildSummary = {
      schema: "build-summary.v1",
      summary: `implemented ${ABU_KEY} (run ${this.runs})`,
      requirementsCovered: ["R-001"],
      responses: [],
      abuConcerns: [],
    };
    const model = action === "wrong-model" ? "claude-haiku-9" : modelId;
    return this.emit(input, model, summary);
  }

  /** What author runs write (relative to the worktree) and with which content. */
  authorFile = { path: "roadmaps/salesforce/ROADMAP.yaml", content: "schema: wos-roadmap.v1\ntarget: salesforce\n" };

  private author(input: Parameters<ProcessRunner["run"]>[0], modelId: string) {
    input.onSpawn?.(4444);
    mkdirSync(dirname(join(input.cwd, this.authorFile.path)), { recursive: true });
    writeFileSync(join(input.cwd, this.authorFile.path), this.authorFile.content);
    const summary: AuthorSummary = {
      schema: "author-summary.v1",
      summary: `drafted ${this.authorFile.path}`,
      responses: [],
      proposalsAddressed: [],
    };
    return this.emit(input, modelId, summary);
  }

  private rule(input: Parameters<ProcessRunner["run"]>[0], modelId: string) {
    input.onSpawn?.(4545);
    const ruling: Ruling = { schema: "ruling.v1", rulings: [], proposedChange: "Split contacts#04 into list and pagination units." };
    return this.emit(input, modelId, ruling);
  }

  private review(input: Parameters<ProcessRunner["run"]>[0], modelId: string) {
    input.onSpawn?.(4343);
    const verdict: ReviewVerdict = {
      schema: "review-verdict.v1",
      verdict: this.reviewVerdict,
      summary: this.reviewVerdict === "NO_MATERIAL_GAPS" ? "No material gaps." : "One material gap.",
      findings:
        this.reviewVerdict === "MATERIAL_GAPS"
          ? [
              {
                localId: "f1",
                severity: "material",
                category: "test_gap",
                title: "Missing test",
                detail: "No test for the empty list.",
                evidence: [],
                suggestedResolution: "Add one.",
              },
            ]
          : [],
      priorFindings: [],
    };
    return this.emit(input, modelId, verdict);
  }

  /** claude: stream-json on stdout. codex: --json events on stdout and the final message in the -o file. */
  private emit(input: Parameters<ProcessRunner["run"]>[0], model: string, output: unknown) {
    if (input.binary === "claude") {
      input.onStdout(`${JSON.stringify({ type: "system", subtype: "init", model })}\n`);
      input.onStdout(
        `${JSON.stringify({ type: "result", subtype: "success", structured_output: output, usage: { input_tokens: 10, output_tokens: 5 } })}\n`,
      );
    } else {
      input.onStdout(`${JSON.stringify({ type: "thread.started", model })}\n`);
      const o = input.argv[input.argv.indexOf("-o") + 1]!;
      writeFileSync(o, JSON.stringify(output));
      input.onStdout(`${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } })}\n`);
    }
    return { exitCode: 0, durationMs: 7 };
  }
}

/**
 * Engines: the REAL context-engine, agent-policy and verification packages (defaults). Only planning's
 * parseBuildGraphYaml is still a stub on main (planning is Wave 2), so tests parse the JSON-in-YAML
 * fixture with the contract's own zod schema.
 */
export const testEngines: Partial<Engines> = {
  policy: AGENT_POLICY,
  parseBuildGraphYaml(text) {
    const r = BuildGraph.safeParse(JSON.parse(text));
    return r.success
      ? { ok: true, value: r.data }
      : { ok: false, errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  },
};
export interface Harness {
  server: FakeControlPlane;
  processes: FakeProcesses;
  secrets: MemorySecrets;
  upstream: { dir: string; base: string };
  root: string;
  events: OrchestratorEvent[];
  make: (clientKind?: "cli" | "desktop", opts?: { platform?: "darwin" | "linux"; root?: string }) => Orchestrator;
  /** Run while the orchestrator waits between polls (e.g. other contributors reviewing). */
  idle: Array<() => Promise<void>>;
  dispose: () => void;
}

export const DEVICE_ID = "0192ab3c-0000-7000-8000-0000000000dd";

export function harness(opts: { root?: string } = {}): Harness {
  const upstream = makeUpstream();
  const clock = () => new Date(FIXED_DATE);
  const server = new FakeControlPlane(upstream, clock);
  const processes = new FakeProcesses();
  const secrets = new MemorySecrets();
  secrets.map.set(
    SESSION_KEY,
    JSON.stringify({
      accessToken: "test-access",
      accessExpiresAt: "2026-09-29T13:00:00Z",
      refreshToken: "test-refresh",
      refreshExpiresAt: "2026-10-29T12:00:00Z",
      deviceId: DEVICE_ID,
    }),
  );
  const root = opts.root ?? mkdtempSync(join(tmpdir(), "wos-orch-ws-"));
  configureLocalGit({ remoteUrl: () => upstream.dir });
  const events: OrchestratorEvent[] = [];
  const idle: Array<() => Promise<void>> = [];
  return {
    idle,
    server,
    processes,
    secrets,
    upstream,
    root,
    events,
    make: (clientKind = "cli", opts = {}) =>
      createOrchestrator({
        apiBaseUrl: "https://api.waronsaas.test",
        workspaceRoot: opts.root ?? root,
        platform: opts.platform ?? "linux",
        secrets,
        processes,
        fetch: server.fetch,
        clientKind,
        clientVersion: "0.0.0-test",
        engines: testEngines,
        now: clock,
        sleep: async () => {
          for (const f of idle) await f();
        },
        pollIntervalMs: 0,
        baseEnv: { PATH: "/usr/bin:/bin" },
      }),
    dispose: () => {
      configureLocalGit({});
      rmSync(upstream.dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

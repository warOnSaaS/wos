import { computeManifestSha256, sha256Of } from "@waronsaas/contracts/canonical";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_POLICY_V1,
  type AbuSpec,
  type BuildSummary,
  type ContextManifest,
  type ContextPlan,
  type Orchestrator,
  type OrchestratorEvent,
} from "@waronsaas/contracts";
import { configureLocalGit } from "@waronsaas/github/local";
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

/** Fake `claude` and the repo's fake check command. The agent edits the worktree like a real one would. */
export class FakeProcesses implements ProcessRunner {
  runs = 0;
  readonly script: AgentAction[] = [];
  readonly invocations: Array<{ binary: string; argv: string[]; cwd: string; env: Record<string, string> }> = [];

  async run(input: Parameters<ProcessRunner["run"]>[0]): Promise<{ exitCode: number; durationMs: number }> {
    this.invocations.push({ binary: input.binary, argv: input.argv, cwd: input.cwd, env: input.env });
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
    if (input.binary !== "claude") return { exitCode: 127, durationMs: 1 };
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
    const model = action === "wrong-model" ? "claude-haiku-9" : "claude-opus-5-5";
    input.onStdout(`${JSON.stringify({ type: "system", subtype: "init", model })}\n`);
    input.onStdout(
      `${JSON.stringify({ type: "result", subtype: "success", structured_output: summary, usage: { input_tokens: 10, output_tokens: 5 } })}\n`,
    );
    return { exitCode: 0, durationMs: 7 };
  }
}

const ABU_SPEC: AbuSpec = {
  repo: "waronsaas/product",
  key: ABU_KEY,
  title: "Contact list endpoint",
  objective: "Return the contact list for the signed-in tenant, paginated.",
  requirements: ["R-001"],
  dependsOn: [],
  sizePoints: 3,
  scope: { write: ["modules/contacts/**"], read: [] },
  resources: [],
  acceptance: { checks: [{ id: "list", run: ["wos-fake-check", "unit"] }], tests: [] },
};

/** Stand-ins for the Wave 1 packages whose frozen signatures exist but are implemented elsewhere. */
export const fakeEngines: Partial<Engines> = {
  policy: AGENT_POLICY_V1,
  async buildContext(plan: ContextPlan, reader) {
    const artifacts: ContextManifest["artifacts"] = [];
    const excluded: ContextManifest["excluded"] = [];
    const file = await reader.readFile("modules/contacts/list.ts");
    if (file) {
      artifacts.push({
        kind: "repo_file",
        ref: "modules/contacts/list.ts",
        gitBlobOid: file.gitBlobOid,
        sha256: sha256Of(file.bytes),
        bytes: file.bytes.byteLength,
        estTokens: 10,
      });
    }
    for (const a of plan.artifacts) {
      if (a.kind === "repo_file" || a.kind === "repo_glob") continue;
      if (a.kind === "local_document") {
        // contracts 3.1.0: local documents come only from readLocalDocument (null = absent).
        const bytes = reader.readLocalDocument ? await reader.readLocalDocument(a.ref) : null;
        if (bytes === null) excluded.push({ ref: a.ref, reason: "missing_optional" });
        else
          artifacts.push({
            kind: "local_document",
            ref: a.ref,
            gitBlobOid: null,
            sha256: sha256Of(bytes),
            bytes: bytes.byteLength,
            estTokens: 10,
          });
        continue;
      }
      try {
        const bytes = await reader.readServerDocument(a.ref);
        artifacts.push({ kind: a.kind, ref: a.ref, gitBlobOid: null, sha256: sha256Of(bytes), bytes: bytes.byteLength, estTokens: 10 });
      } catch (e) {
        if (a.required) throw e;
        excluded.push({ ref: a.ref, reason: "missing_optional" });
      }
    }
    const unhashed: Omit<ContextManifest, "manifestSha256"> = {
      schema: "wos-context-manifest.v1",
      contextFormatVersion: plan.contextFormatVersion,
      contractsVersion: "3.0.0",
      policyVersion: plan.policyVersion,
      role: plan.role,
      provider: plan.provider,
      model: { ref: plan.model, modelId: plan.modelId },
      reasoning: plan.reasoning,
      target: plan.target,
      feature: plan.feature,
      task: { id: plan.taskId, kind: plan.taskKind },
      abu: plan.abu,
      attemptId: plan.attemptId,
      roundId: plan.roundId,
      source: plan.source,
      promptTemplate: { id: plan.promptTemplateId, sha256: `sha256:${"1".repeat(64)}` },
      artifacts,
      excluded,
      budget: { limitTokens: plan.budgetTokens, estimatedTokens: 100 },
      outputSchema: plan.outputSchema,
      renderedPromptSha256: `sha256:${"2".repeat(64)}`,
    };
    const manifest: ContextManifest = { ...unhashed, manifestSha256: computeManifestSha256(unhashed) };
    return { manifest, prompt: `Build ${plan.abu} at ${plan.source.commit}` };
  },
  buildInvocation(plan) {
    return {
      binary: "claude",
      argv: ["-p", "--model", plan.modelId, "--effort", plan.reasoning, "--output-format", "stream-json"],
      env: { CLAUDE_CODE_SAFE_MODE: "1" },
      outputSchemaJson: "{}",
    };
  },
  validateChangeset(cs) {
    const errors = cs.files
      .filter((f) => !f.path.startsWith("modules/contacts/"))
      .map((f) => ({ code: "OUT_OF_SCOPE" as const, path: f.path, message: "outside modules/contacts/**" }));
    return { ok: errors.length === 0, errors };
  },
  parseBuildGraphYaml() {
    return { ok: true, value: { schema: "wos-build-graph.v1", feature: "contacts", contractVersion: 1, abus: [ABU_SPEC] } };
  },
};

export interface Harness {
  server: FakeControlPlane;
  processes: FakeProcesses;
  secrets: MemorySecrets;
  upstream: { dir: string; base: string };
  root: string;
  events: OrchestratorEvent[];
  make: (clientKind?: "cli" | "desktop") => Orchestrator;
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
  return {
    server,
    processes,
    secrets,
    upstream,
    root,
    events,
    make: (clientKind = "cli") =>
      createOrchestrator({
        apiBaseUrl: "https://api.waronsaas.test",
        workspaceRoot: root,
        secrets,
        processes,
        fetch: server.fetch,
        clientKind,
        clientVersion: "0.0.0-test",
        engines: fakeEngines,
        now: clock,
        sleep: async () => undefined,
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

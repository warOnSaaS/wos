/**
 * @waronsaas/orchestrator — the single LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR driver
 * used by both apps/cli and apps/desktop (owner: github-build workstream).
 * Implements the `Orchestrator` interface frozen in @waronsaas/contracts (src/orchestrator.ts).
 */
import type { buildInvocation } from "@waronsaas/agent-policy";
import type { buildContext } from "@waronsaas/context-engine";
import type { AgentPolicyDocument, Orchestrator, RouteBody, RouteName, RouteParams, RouteQuery, RouteResponse } from "@waronsaas/contracts";
import type { parseBuildGraphYaml } from "@waronsaas/planning";
import type { validateChangeset } from "@waronsaas/verification";
import { OrchestratorImpl } from "./orchestrator.js";

export { ApiCallError, createApiClient } from "./api-client.js";
export { createNodeProcessRunner } from "./process-runner.js";
export {
  createSessionReader,
  idempotencyKey,
  type RefreshedTokens,
  SESSION_KEY,
  type SessionReader,
  type StoredSession,
  sessionAccessToken,
} from "./session.js";

/** Where the session lives: OS keychain (Electron safeStorage in Desktop, @napi-rs/keyring in CLI). */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Process spawning is injected so Desktop and CLI share logic and tests can fake it. */
export interface ProcessRunner {
  run(input: {
    binary: string;
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: string;
    timeoutMs: number;
    signal?: AbortSignal;
    onStdout: (chunk: string) => void;
    onStderr: (chunk: string) => void;
    /** Additive: called with the child pid once spawned (the `agent_started` event carries it). */
    onSpawn?: (pid: number) => void;
  }): Promise<{ exitCode: number; durationMs: number }>;
}

/** The pure engines the orchestrator composes. Defaults are the real packages; tests inject fakes. */
export interface Engines {
  buildContext: typeof buildContext;
  buildInvocation: typeof buildInvocation;
  validateChangeset: typeof validateChangeset;
  parseBuildGraphYaml: typeof parseBuildGraphYaml;
  policy: AgentPolicyDocument;
}

export interface OrchestratorDeps {
  apiBaseUrl: string;
  workspaceRoot: string;
  secrets: SecretStore;
  processes: ProcessRunner;
  fetch: typeof fetch;
  clientKind: "desktop" | "cli";
  clientVersion: string;
  /** Additive, optional: engine overrides (tests, the Wave 2 fake end-to-end run). */
  engines?: Partial<Engines>;
  /** Additive, optional: clock and sleep, so fake runs are deterministic. */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Additive, optional: attempt polling interval while waiting for CI, reviews and merge. Default 5000. */
  pollIntervalMs?: number;
  /** Additive, optional: the OS to attest (D13). Default: process.platform. Lets tests fake macOS and Linux. */
  platform?: "darwin" | "linux" | "win32";
  /** Additive, optional: environment passed to agent and verify processes. Default: PATH, HOME, USER, LANG, TMPDIR. */
  baseEnv?: Record<string, string>;
}

/** Typed client over the route map; the only way the orchestrator talks to the control plane. */
export interface ApiClient {
  call<N extends RouteName>(
    name: N,
    input: { params?: RouteParams<N>; query?: RouteQuery<N>; body?: RouteBody<N>; idempotencyKey?: string },
  ): Promise<RouteResponse<N>>;
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  return new OrchestratorImpl(deps);
}

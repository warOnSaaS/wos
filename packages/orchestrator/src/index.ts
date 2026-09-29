/**
 * @waronsaas/orchestrator — the single LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR driver
 * used by both apps/cli and apps/desktop (owner: github-build workstream).
 * Implements the `Orchestrator` interface frozen in @waronsaas/contracts (src/orchestrator.ts).
 */
import {
  NotImplementedError,
  type Orchestrator,
  type RouteBody,
  type RouteName,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
} from "@waronsaas/contracts";

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
  }): Promise<{ exitCode: number; durationMs: number }>;
}

export interface OrchestratorDeps {
  apiBaseUrl: string;
  workspaceRoot: string;
  secrets: SecretStore;
  processes: ProcessRunner;
  fetch: typeof fetch;
  clientKind: "desktop" | "cli";
  clientVersion: string;
}

/** Typed client over the route map; the only way the orchestrator talks to the control plane. */
export interface ApiClient {
  call<N extends RouteName>(
    name: N,
    input: { params?: RouteParams<N>; query?: RouteQuery<N>; body?: RouteBody<N>; idempotencyKey?: string },
  ): Promise<RouteResponse<N>>;
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  void deps;
  throw new NotImplementedError("createOrchestrator");
}

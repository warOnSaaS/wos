/** Test wiring: the REAL orchestrator (real context-engine, agent-policy, verification, planning) against the fake backend. */
import { AGENT_POLICY_V1, CONTRACTS_VERSION, type Orchestrator, TOKEN_DISCLAIMER } from "@waronsaas/contracts";
import { createOrchestrator } from "@waronsaas/orchestrator";
import { createFakeBackend, FAKE_API, type FakeBackend, tempWorkspace } from "../dev/fake-backend.js";
import { createDesktopCore, type DesktopCore } from "../src/main/core.js";
import { createPublicApi } from "../src/main/public-api.js";
import { defaultSettings, memorySettingsStore, type SettingsStore } from "../src/main/settings.js";
import type { AppInfo, DesktopEvent } from "../src/shared/ipc.js";

export interface Rig {
  core: DesktopCore;
  backend: FakeBackend;
  orchestrator: Orchestrator;
  events: DesktopEvent[];
  opened: string[];
  settings: SettingsStore;
  /** Every BuildOptions the core passed to orchestrator.build (D15: the model must reach it). */
  buildCalls: Array<Parameters<Orchestrator["build"]>[0]>;
  dispose(): void;
}

export const APP_INFO: AppInfo = {
  productName: "wOS",
  version: "0.0.0-test",
  contractsVersion: CONTRACTS_VERSION,
  platform: "linux",
  fakeControlPlane: true,
  apiBaseUrl: FAKE_API,
  tokenDisclaimer: TOKEN_DISCLAIMER,
};

export function rig(opts: { githubLinked?: boolean; wrap?: (o: Orchestrator) => Orchestrator } = {}): Rig {
  const backend = createFakeBackend({ githubLinked: opts.githubLinked ?? false });
  const ws = tempWorkspace();
  const events: DesktopEvent[] = [];
  const opened: string[] = [];
  const buildCalls: Rig["buildCalls"] = [];
  const real = createOrchestrator({
    apiBaseUrl: FAKE_API,
    workspaceRoot: ws.dir,
    secrets: backend.secrets,
    processes: backend.processes,
    fetch: backend.fetch,
    clientKind: "desktop",
    clientVersion: "0.0.0-test",
    platform: "linux",
    pollIntervalMs: 0,
    sleep: async () => undefined,
    baseEnv: { PATH: "/usr/bin:/bin" },
  });
  const spied = new Proxy(real, {
    get(target, prop) {
      if (prop === "build") {
        return (options: Parameters<Orchestrator["build"]>[0], observer: Parameters<Orchestrator["build"]>[1]) => {
          buildCalls.push(options);
          return target.build(options, observer);
        };
      }
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const orchestrator = opts.wrap ? opts.wrap(spied) : spied;
  const settings = memorySettingsStore(defaultSettings("test-device"));
  const core = createDesktopCore({
    orchestrator,
    publicApi: createPublicApi(backend.fetch, FAKE_API, "0.0.0-test"),
    settings,
    policy: AGENT_POLICY_V1,
    appInfo: APP_INFO,
    emit: (e) => events.push(e),
    openExternal: async (url) => {
      opened.push(url);
    },
  });
  return {
    core,
    backend,
    orchestrator,
    events,
    opened,
    settings,
    buildCalls,
    dispose() {
      backend.dispose();
      ws.dispose();
    },
  };
}

export async function until(pred: () => boolean, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Signs in with the fake's code through the same path the renderer uses. */
export async function signIn(r: Rig, email = "dev@example.com") {
  const pending = r.core.invoke("wos:sign-in", { email });
  await until(() => r.events.some((e) => e.kind === "orchestrator" && e.event.type === "sign_in" && e.event.status === "waiting_for_code"));
  await r.core.invoke("wos:sign-in-code", { code: "abcd-efgh" });
  return pending;
}

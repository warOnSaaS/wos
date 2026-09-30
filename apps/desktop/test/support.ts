/**
 * Test wiring: the REAL orchestrator (real context-engine, agent-policy, verification, planning) and the REAL shell
 * (platform client over the orchestrator's session reader, environment manager, module installer with a THROWAWAY
 * pinned key) against the fake backend (dev/fake-backend.ts, dev/fake-apps.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_POLICY_V1, CONTRACTS_VERSION, type Orchestrator, TOKEN_DISCLAIMER } from "@waronsaas/contracts";
import { createApiClient, createOrchestrator, createSessionReader } from "@waronsaas/orchestrator";
import { FAKE_CORE } from "../dev/fake-apps.js";
import { createFakeBackend, FAKE_API, type FakeBackend, tempWorkspace } from "../dev/fake-backend.js";
import { createDesktopCore, type DesktopCore, type ModuleHost } from "../src/main/core.js";
import { createEnvironmentManager, type EnvironmentManager } from "../src/main/environment.js";
import { createModuleInstaller, type ModuleInstaller } from "../src/main/module-installer.js";
import { createPlatformApi, type PlatformApi } from "../src/main/platform-api.js";
import { createPublicApi } from "../src/main/public-api.js";
import { defaultSettings, memorySettingsStore, type SettingsStore } from "../src/main/settings.js";
import type { AppInfo, DesktopEvent, LocalSettings } from "../src/shared/ipc.js";

export interface Rig {
  core: DesktopCore;
  backend: FakeBackend;
  orchestrator: Orchestrator;
  platform: PlatformApi;
  environment: EnvironmentManager;
  installer: ModuleInstaller;
  events: DesktopEvent[];
  opened: string[];
  settings: SettingsStore;
  /** Every S-40 gate change the core reported (start.ts adds or removes Build's handlers on each). */
  gate: boolean[];
  /** The module host's calls. */
  shown: Array<{ app: string; version: string; route: string }>;
  modulesDir: string;
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

export function rig(
  opts: {
    githubLinked?: boolean;
    wrap?: (o: Orchestrator) => Orchestrator;
    /** S-40 device switch; default on so Build's flow tests run. */
    buildOnDevice?: boolean;
    /** Build entitled on the personal org; default true. */
    buildEnabled?: boolean;
    settings?: Partial<LocalSettings>;
  } = {},
): Rig {
  const backend = createFakeBackend({ githubLinked: opts.githubLinked ?? false, buildEnabled: opts.buildEnabled ?? true });
  const ws = tempWorkspace();
  const modulesDir = mkdtempSync(join(tmpdir(), "wos-desktop-modules-"));
  const events: DesktopEvent[] = [];
  const opened: string[] = [];
  const gate: boolean[] = [];
  const shownLog: Rig["shown"] = [];
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
  const settings = memorySettingsStore({
    ...defaultSettings("test-device"),
    environmentUrl: FAKE_CORE,
    buildOnDevice: opts.buildOnDevice ?? true,
    ...opts.settings,
  });
  const refreshClient = createApiClient({
    baseUrl: FAKE_API,
    fetch: backend.fetch,
    clientKind: "desktop",
    clientVersion: "0.0.0-test",
    accessToken: async () => null,
  });
  const session = createSessionReader({
    secrets: backend.secrets,
    refresh: (refreshToken) => refreshClient.call("refreshSession", { body: { refreshToken } }),
  });
  const platform = createPlatformApi({ baseUrl: FAKE_API, fetch: backend.fetch, session, clientVersion: "0.0.0-test" });
  const environment = createEnvironmentManager(settings.get().environmentUrl, {
    fetch: backend.fetch,
    secrets: backend.secrets,
    platform,
    cloudCoreUrl: FAKE_CORE,
    cloudIssuer: FAKE_API,
    clientVersion: "0.0.0-test",
  });
  const installer = createModuleInstaller({
    root: modulesDir,
    platform: "linux",
    pinnedKeys: { [backend.apps.moduleKey.keyId]: backend.apps.moduleKey.publicKey },
    registry: platform,
  });
  let shown: { app: string; version: string } | null = null;
  const moduleHost: ModuleHost = {
    async show(m, route) {
      shown = { app: m.app, version: m.version };
      shownLog.push({ ...shown, route });
    },
    async hide() {
      shown = null;
    },
    current: () => shown,
  };
  const core = createDesktopCore({
    orchestrator,
    publicApi: createPublicApi(backend.fetch, FAKE_API, "0.0.0-test"),
    platform,
    environment,
    cloudCoreUrl: FAKE_CORE,
    installer,
    settings,
    policy: AGENT_POLICY_V1,
    appInfo: APP_INFO,
    emit: (e) => events.push(e),
    openExternal: async (url) => {
      opened.push(url);
    },
    onBuildGate: (open) => gate.push(open),
    moduleHost,
  });
  return {
    core,
    backend,
    orchestrator,
    platform,
    environment,
    installer,
    events,
    opened,
    settings,
    gate,
    shown: shownLog,
    modulesDir,
    buildCalls,
    dispose() {
      backend.dispose();
      ws.dispose();
      rmSync(modulesDir, { recursive: true, force: true });
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

/** Signs in with the fake's code through the same path the renderer uses (the shell refreshes after it). */
export async function signIn(r: Rig, email = "dev@example.com") {
  const pending = r.core.invoke("wos:sign-in", { email });
  await until(() => r.events.some((e) => e.kind === "orchestrator" && e.event.type === "sign_in" && e.event.status === "waiting_for_code"));
  await r.core.invoke("wos:sign-in-code", { code: "abcd-efgh" });
  return pending;
}

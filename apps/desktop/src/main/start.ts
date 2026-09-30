/**
 * Electron wiring for the ONE wOS Desktop (D16): the orchestrator (packages/orchestrator/README.md), the app shell
 * (core.ts), the window, the IPC handlers, the wos:// deep link handler and the wos-module:// module view, all under
 * SECURITY.md S-29, S-37..S-40. The production entry is src/main/index.ts; dev/main-fake.ts starts the same code
 * against the fake control plane and a fake environment.
 */
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AGENT_POLICY_V1, CONTRACTS_VERSION, HOSTS, TOKEN_DISCLAIMER } from "@waronsaas/contracts";
import {
  createApiClient,
  createNodeProcessRunner,
  createOrchestrator,
  createSessionReader,
  type OrchestratorDeps,
  type SecretStore,
} from "@waronsaas/orchestrator";
import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain, protocol, safeStorage, session, shell } from "electron";
import { type AppInfo, type DesktopEvent, IPC_CHANNELS, type InvokeChannel, MODULE_CHANNELS, type LocalSettings } from "../shared/ipc.js";
import { bridgeErrorMessage, createDesktopCore, type DesktopCore, REFRESH_EVERY_MS } from "./core.js";
import { createEnvironmentManager } from "./environment.js";
import { createHandlerRegistry } from "./handlers.js";
import { createModuleInstaller } from "./module-installer.js";
import { PINNED_MODULE_KEYS } from "./module-keys.js";
import { createModuleView, MODULE_SCHEME, MODULE_SCHEME_PRIVILEGES, parseModuleUrl } from "./module-view.js";
import { modulesRootFor, workspaceRootFor } from "./paths.js";
import { createPlatformApi } from "./platform-api.js";
import { createPublicApi } from "./public-api.js";
import { SafeStorageSecrets } from "./secrets.js";
import { DEEP_LINK_SCHEME, deepLinkFromArgv, hardenContents, isTrustedSender, WEB_PREFERENCES } from "./security.js";
import { defaultSettings, fileSettingsStore } from "./settings.js";
import { isInvokeChannel, validateModuleManifestPayload, validateModuleRequestPayload } from "./validate.js";

/** The product's name everywhere the OS shows it (menu bar, About, Dock, taskbar, Start menu). */
export const PRODUCT_NAME = "wOS" as const;
/** Windows AppUserModelID: must equal electron-builder's appId so the taskbar groups the window with its shortcut. */
export const APP_USER_MODEL_ID = "com.waronsaas.wos" as const;

export interface StartOptions {
  /** Directory holding main.mjs, preload.cjs, module-preload.cjs, icon.png and renderer/ (the vite output). */
  appDir: string;
  /** Development only: replace the network and the process runner (the fake control plane and environment). */
  backend?: {
    fetch: typeof fetch;
    publicFetch?: typeof fetch;
    secrets?: SecretStore;
    processes?: OrchestratorDeps["processes"];
    engines?: OrchestratorDeps["engines"];
    sleep?: OrchestratorDeps["sleep"];
    pollIntervalMs?: number;
    apiBaseUrl?: string;
    /** The fake's wOS Cloud Core. */
    cloudCoreUrl?: string;
    /** Throwaway module-signing keys of the fake registry. Production always uses PINNED_MODULE_KEYS. */
    moduleKeys?: Readonly<Record<string, string>>;
    /** Local settings to start from (the fake turns Build on for the device). */
    settings?: Partial<LocalSettings>;
  };
  fakeControlPlane?: boolean;
  /** Development only: replaces shell.openExternal (still behind the allowlist). */
  openExternal?: (url: string) => Promise<void>;
  /** Called once the window has loaded (dev scripts: smoke test, screenshots). */
  onReady?: (ctx: {
    window: BrowserWindow;
    core: DesktopCore;
    registered: () => string[];
    moduleContents: () => Electron.WebContents | null;
  }) => void | Promise<void>;
  windowSize?: { width: number; height: number };
  show?: boolean;
}

export function appDirOf(metaUrl: string): string {
  return dirname(fileURLToPath(metaUrl));
}

/** The version in the bundled app manifest (dist/app/package.json); Electron reports its own when run from a path. */
function appVersion(appDir: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function startDesktop(opts: StartOptions): void {
  const log = (msg: string) => {
    if (process.env.WOS_DESKTOP_DEBUG) console.log(`[wOS] ${msg}`);
  };

  app.setName(PRODUCT_NAME);
  if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
  // wos-module:// must be privileged before the app is ready (S-38).
  protocol.registerSchemesAsPrivileged([{ scheme: MODULE_SCHEME, privileges: MODULE_SCHEME_PRIVILEGES }]);

  // wos:// deep links (D8). Single instance so a link opened from the browser reaches this process.
  if (!opts.fakeControlPlane && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  if (!opts.fakeControlPlane) {
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [process.argv[1]]);
    else app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  const rendererFile = join(opts.appDir, "renderer", "index.html");
  const rendererUrl = pathToFileURL(rendererFile).toString();
  let win: BrowserWindow | null = null;
  let core: DesktopCore | null = null;
  const pendingLinks: string[] = [];
  const deliver = (url: string) => {
    if (core) core.handleDeepLink(url);
    else pendingLinks.push(url);
  };

  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliver(url);
  });
  app.on("second-instance", (_event, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) deliver(link);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  const initial = deepLinkFromArgv(process.argv);
  if (initial) pendingLinks.push(initial);

  // Every webContents, including any the renderer or a module might try to create, is hardened.
  app.on("web-contents-created", (_e, contents) => hardenContents(contents, log));

  app.whenReady().then(async () => {
    // No permission (camera, notifications, clipboard-read, ...) is ever granted to the renderer.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "clipboard-sanitized-write"));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "clipboard-sanitized-write");
    // The renderer is served from the packaged bundle only; nothing else may load, in any frame.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const ok = details.url.startsWith("file://")
        ? details.url.startsWith(pathToFileURL(opts.appDir).toString())
        : details.url.startsWith("devtools://");
      if (!ok) log(`request blocked: ${details.url.slice(0, 200)}`);
      callback({ cancel: !ok });
    });

    const platform = (["darwin", "linux", "win32"].includes(process.platform) ? process.platform : "linux") as AppInfo["platform"];
    const apiBaseUrl = opts.backend?.apiBaseUrl ?? HOSTS.api;
    const cloudCoreUrl = opts.backend?.cloudCoreUrl ?? HOSTS.core;
    const version = appVersion(opts.appDir) ?? app.getVersion();
    const userData = app.getPath("userData");
    const netFetch = opts.backend?.fetch ?? globalThis.fetch.bind(globalThis);
    const secrets = opts.backend?.secrets ?? new SafeStorageSecrets(safeStorage, join(userData, "secrets"));
    const settings = fileSettingsStore(join(userData, "settings.json"), {
      ...defaultSettings(hostname().slice(0, 64) || "wOS Desktop"),
      ...(opts.backend?.cloudCoreUrl ? { environmentUrl: opts.backend.cloudCoreUrl } : {}),
      ...opts.backend?.settings,
    });
    const orchestrator = createOrchestrator({
      apiBaseUrl,
      // S-42: a short per-user root on Windows.
      workspaceRoot: workspaceRootFor(platform, { userData, home: homedir() }),
      secrets,
      processes: opts.backend?.processes ?? createNodeProcessRunner(),
      fetch: netFetch,
      clientKind: "desktop",
      clientVersion: version,
      ...(opts.backend?.engines ? { engines: opts.backend.engines } : {}),
      ...(opts.backend?.sleep ? { sleep: opts.backend.sleep } : {}),
      ...(opts.backend?.pollIntervalMs !== undefined ? { pollIntervalMs: opts.backend.pollIntervalMs } : {}),
      platform,
    });
    // The shell shares the orchestrator's session through its exported reader (one refresh in flight, S-4).
    const refreshClient = createApiClient({
      baseUrl: apiBaseUrl,
      fetch: netFetch,
      clientKind: "desktop",
      clientVersion: version,
      accessToken: async () => null,
    });
    const sessionReader = createSessionReader({
      secrets,
      refresh: (refreshToken) => refreshClient.call("refreshSession", { body: { refreshToken } }),
    });
    const platformApi = createPlatformApi({ baseUrl: apiBaseUrl, fetch: netFetch, session: sessionReader, clientVersion: version });
    const environment = createEnvironmentManager(settings.get().environmentUrl, {
      fetch: netFetch,
      secrets,
      platform: platformApi,
      cloudCoreUrl,
      cloudIssuer: apiBaseUrl,
      clientVersion: version,
      log,
    });
    const installer = createModuleInstaller({
      root: modulesRootFor(platform, userData),
      platform,
      pinnedKeys: opts.backend?.moduleKeys ?? PINNED_MODULE_KEYS,
      registry: platformApi,
      log,
    });
    const moduleView = createModuleView({
      window: () => win,
      preload: join(opts.appDir, "module-preload.cjs"),
      installer,
      onLoadFailed: (a, v, reason) => void core?.moduleLoadFailed(a, v, reason),
      log,
    });
    const appInfo: AppInfo = {
      productName: "wOS",
      version,
      contractsVersion: CONTRACTS_VERSION,
      platform,
      fakeControlPlane: Boolean(opts.fakeControlPlane),
      apiBaseUrl,
      tokenDisclaimer: TOKEN_DISCLAIMER,
    };
    const emit = (event: DesktopEvent) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC_CHANNELS.events, event);
    };

    const listener = (channel: InvokeChannel) => async (event: IpcMainInvokeEvent, payload: unknown) => {
      if (!win || !isTrustedSender(event.senderFrame, win.webContents.mainFrame, rendererUrl)) {
        log(`IPC from an untrusted sender refused on ${channel}`);
        throw new Error("FORBIDDEN: untrusted sender");
      }
      if (!isInvokeChannel(channel)) throw new Error("VALIDATION_FAILED: unknown channel");
      try {
        return await core!.invoke(channel, payload);
      } catch (e) {
        throw new Error(bridgeErrorMessage(e));
      }
    };
    // S-40: shell channels always; Build's only while the gate is open (added and removed by the core).
    const handlers = createHandlerRegistry(ipcMain, listener);

    core = createDesktopCore({
      orchestrator,
      publicApi: createPublicApi(opts.backend?.publicFetch ?? netFetch, apiBaseUrl, version),
      platform: platformApi,
      environment,
      cloudCoreUrl,
      installer,
      settings,
      policy: AGENT_POLICY_V1,
      appInfo,
      emit,
      openExternal: opts.openExternal ?? ((url) => shell.openExternal(url)),
      onBuildGate: (open) => handlers.setBuild(open),
      moduleHost: moduleView,
      log,
    });
    handlers.registerShell();

    // The module host bridge (S-38): only the shown module's own view, only for its own app.
    const moduleSender = (event: IpcMainInvokeEvent): string => {
      const wc = moduleView.contents();
      const shown = moduleView.current();
      const frame = parseModuleUrl(event.senderFrame?.url ?? "");
      if (!wc || !shown || event.sender !== wc || event.senderFrame !== wc.mainFrame || !frame)
        throw new Error("FORBIDDEN: not the shown module");
      if (frame.app !== shown.app || frame.version !== shown.version) throw new Error("FORBIDDEN: not the shown module");
      return shown.app;
    };
    ipcMain.handle(MODULE_CHANNELS.manifest, async (event: IpcMainInvokeEvent, payload: unknown) => {
      const sender = moduleSender(event);
      try {
        return core!.moduleManifest(sender, validateModuleManifestPayload(payload).app);
      } catch (e) {
        throw new Error(bridgeErrorMessage(e));
      }
    });
    ipcMain.handle(MODULE_CHANNELS.request, async (event: IpcMainInvokeEvent, payload: unknown) => {
      const sender = moduleSender(event);
      try {
        const r = validateModuleRequestPayload(payload);
        return await core!.moduleRequest(sender, r.app, r.method, r.path, r.body);
      } catch (e) {
        throw new Error(bridgeErrorMessage(e));
      }
    });

    win = new BrowserWindow({
      width: opts.windowSize?.width ?? 1360,
      height: opts.windowSize?.height ?? 860,
      minWidth: 980,
      minHeight: 640,
      show: false,
      backgroundColor: "#0b0b0b",
      title: PRODUCT_NAME,
      // macOS takes the icon from the app bundle (icon.icns); Windows and Linux windows take this PNG.
      ...(platform === "darwin" ? {} : { icon: join(opts.appDir, "icon.png") }),
      autoHideMenuBar: true,
      webPreferences: { ...WEB_PREFERENCES, preload: join(opts.appDir, "preload.cjs") },
    });
    win.on("closed", () => {
      win = null;
    });
    // Clients re-read ActiveApps on start, on focus and every 60 seconds (WORKSTREAMS 12.4); the Build gate too (S-40).
    win.on("focus", () => void core?.refresh());
    const timer = setInterval(() => void core?.refresh(), REFRESH_EVERY_MS);
    app.on("before-quit", () => clearInterval(timer));
    if (opts.show !== false) win.once("ready-to-show", () => win?.show());
    await win.loadFile(rendererFile);
    for (const link of pendingLinks.splice(0)) core.handleDeepLink(link);
    await core.refresh();
    await opts.onReady?.({ window: win, core, registered: () => handlers.registered(), moduleContents: () => moduleView.contents() });
  });

  app.on("window-all-closed", () => app.quit());
}

/**
 * Electron wiring: creates the ONE orchestrator (packages/orchestrator/README.md), the window, the IPC
 * handlers and the wos:// deep link handler, all under SECURITY.md S-29. The production entry is
 * src/main/index.ts; dev/main-fake.ts starts the same code against the fake control plane.
 */
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AGENT_POLICY_V1, CONTRACTS_VERSION, HOSTS, TOKEN_DISCLAIMER } from "@waronsaas/contracts";
import { createNodeProcessRunner, createOrchestrator, type OrchestratorDeps, type SecretStore } from "@waronsaas/orchestrator";
import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain, safeStorage, session, shell } from "electron";
import { type AppInfo, type DesktopEvent, IPC_CHANNELS, type InvokeChannel } from "../shared/ipc.js";
import { bridgeErrorMessage, createDesktopCore, type DesktopCore } from "./core.js";
import { createPublicApi } from "./public-api.js";
import { SafeStorageSecrets } from "./secrets.js";
import { DEEP_LINK_SCHEME, deepLinkFromArgv, hardenContents, isTrustedSender, WEB_PREFERENCES } from "./security.js";
import { defaultSettings, fileSettingsStore } from "./settings.js";
import { isInvokeChannel } from "./validate.js";

export interface StartOptions {
  /** Directory holding main.mjs, preload.cjs and renderer/ (the vite output). */
  appDir: string;
  /** Development only: replace the network and the process runner (the fake control plane). */
  backend?: {
    fetch: typeof fetch;
    publicFetch?: typeof fetch;
    secrets?: SecretStore;
    processes?: OrchestratorDeps["processes"];
    engines?: OrchestratorDeps["engines"];
    sleep?: OrchestratorDeps["sleep"];
    pollIntervalMs?: number;
    apiBaseUrl?: string;
  };
  fakeControlPlane?: boolean;
  /** Development only: replaces shell.openExternal (still behind the allowlist). */
  openExternal?: (url: string) => Promise<void>;
  /** Called once the window has loaded (dev scripts: smoke test, screenshots). */
  onReady?: (ctx: { window: BrowserWindow; core: DesktopCore }) => void | Promise<void>;
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

  // Every webContents, including any the renderer might try to create, is hardened.
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
    const version = appVersion(opts.appDir) ?? app.getVersion();
    const secrets = opts.backend?.secrets ?? new SafeStorageSecrets(safeStorage, join(app.getPath("userData"), "secrets"));
    const settings = fileSettingsStore(
      join(app.getPath("userData"), "settings.json"),
      defaultSettings(hostname().slice(0, 64) || "wOS Desktop"),
    );
    const orchestrator = createOrchestrator({
      apiBaseUrl,
      workspaceRoot: join(app.getPath("userData"), "workspace"),
      secrets,
      processes: opts.backend?.processes ?? createNodeProcessRunner(),
      fetch: opts.backend?.fetch ?? globalThis.fetch.bind(globalThis),
      clientKind: "desktop",
      clientVersion: version,
      ...(opts.backend?.engines ? { engines: opts.backend.engines } : {}),
      ...(opts.backend?.sleep ? { sleep: opts.backend.sleep } : {}),
      ...(opts.backend?.pollIntervalMs !== undefined ? { pollIntervalMs: opts.backend.pollIntervalMs } : {}),
      platform,
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
    core = createDesktopCore({
      orchestrator,
      publicApi: createPublicApi(
        opts.backend?.publicFetch ?? opts.backend?.fetch ?? globalThis.fetch.bind(globalThis),
        apiBaseUrl,
        version,
      ),
      settings,
      policy: AGENT_POLICY_V1,
      appInfo,
      emit,
      openExternal: opts.openExternal ?? ((url) => shell.openExternal(url)),
      log,
    });

    const channels = Object.values(IPC_CHANNELS).filter((c) => c !== IPC_CHANNELS.events) as InvokeChannel[];
    for (const channel of channels) {
      ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
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
      });
    }

    win = new BrowserWindow({
      width: opts.windowSize?.width ?? 1360,
      height: opts.windowSize?.height ?? 860,
      minWidth: 980,
      minHeight: 640,
      show: false,
      backgroundColor: "#0b0b0b",
      title: "wOS",
      autoHideMenuBar: true,
      webPreferences: { ...WEB_PREFERENCES, preload: join(opts.appDir, "preload.cjs") },
    });
    win.on("closed", () => {
      win = null;
    });
    if (opts.show !== false) win.once("ready-to-show", () => win?.show());
    await win.loadFile(rendererFile);
    for (const link of pendingLinks.splice(0)) core.handleDeepLink(link);
    await opts.onReady?.({ window: win, core });
  });

  app.on("window-all-closed", () => app.quit());
}

/**
 * The desktop module view (S-38; WOS-APP-PROTOCOL section 6, loading rules).
 *
 * A module's page runs in its own sandboxed `WebContentsView` over the main window's content area, in an in-memory
 * session partition of its own (no storage shared with the shell), under the custom origin
 * `wos-module://<app>/<version>/`. That session:
 *   - serves ONLY files of the module currently shown, from its verified package, each re-hashed on read
 *     (`ModuleInstaller.readFile`), with a CSP that allows scripts from that origin only: no eval, no remote script;
 *   - cancels every other request (no network at all; the page reaches its environment only through the host bridge);
 *   - grants no permission (camera, notifications, clipboard read...).
 * The page's preload exposes exactly `window.wos.app(<id>)` (src/preload/module.ts); it never sees the shell's bridge,
 * Build's channels, Node, the filesystem, processes or git. No module code runs in the main process.
 *
 * A page that fails to load, or whose renderer dies, is reported so the installer fails that version and rolls back.
 */
import { type BrowserWindow, session as electronSession, type Session, WebContentsView } from "electron";
import type { ModuleBounds } from "../shared/ipc.js";
import type { ModuleHost } from "./core.js";
import type { ActiveModule, ModuleInstaller } from "./module-installer.js";
import { MODULE_PARTITION, MODULE_SCHEME, moduleUrl, parseModuleUrl, serveModuleRequest } from "./module-protocol.js";
import { WEB_PREFERENCES } from "./security.js";

export { MODULE_SCHEME, MODULE_SCHEME_PRIVILEGES, parseModuleUrl } from "./module-protocol.js";

export interface ModuleViewOptions {
  window: () => BrowserWindow | null;
  /** dist/app/module-preload.cjs */
  preload: string;
  installer: ModuleInstaller;
  onLoadFailed: (app: string, version: string, reason: string) => void;
  log?: (msg: string) => void;
}

export interface ModuleViewHost extends ModuleHost {
  /** The webContents of the shown module (the host bridge's sender check). */
  contents(): Electron.WebContents | null;
}

export function createModuleView(opts: ModuleViewOptions): ModuleViewHost {
  const log = opts.log ?? (() => undefined);
  let view: WebContentsView | null = null;
  let shown: { app: string; version: string; route: string } | null = null;
  let configured: Session | null = null;

  const moduleSession = (): Session => {
    if (configured) return configured;
    const ses = electronSession.fromPartition(MODULE_PARTITION, { cache: false });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.webRequest.onBeforeRequest((details, callback) => {
      const p = parseModuleUrl(details.url);
      const ok =
        details.url.startsWith("devtools://") || (p !== null && shown !== null && p.app === shown.app && p.version === shown.version);
      if (!ok) log(`module request blocked: ${details.url.slice(0, 200)}`);
      callback({ cancel: !ok });
    });
    ses.protocol.handle(MODULE_SCHEME, (request) => {
      const r = serveModuleRequest(request.url, shown, opts.installer);
      return new Response(r.body ? Buffer.from(r.body) : null, { status: r.status, headers: r.headers });
    });
    configured = ses;
    return ses;
  };

  const close = () => {
    const win = opts.window();
    if (view) {
      if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    view = null;
    shown = null;
  };

  return {
    current: () => (shown ? { app: shown.app, version: shown.version } : null),
    contents: () => (view && !view.webContents.isDestroyed() ? view.webContents : null),
    async show(m: ActiveModule, route: string, bounds: ModuleBounds) {
      const win = opts.window();
      if (!win || win.isDestroyed()) return;
      if (!view || !shown || shown.app !== m.app || shown.version !== m.version) {
        close();
        shown = { app: m.app, version: m.version, route };
        view = new WebContentsView({
          webPreferences: { ...WEB_PREFERENCES, preload: opts.preload, session: moduleSession() },
        });
        view.setBackgroundColor("#0b0b0b");
        const failed = (reason: string) => {
          const s = shown;
          if (!s) return;
          log(`module ${s.app}@${s.version} failed: ${reason}`);
          opts.onLoadFailed(s.app, s.version, reason);
        };
        view.webContents.on("did-fail-load", (_e, code, description, _url, isMainFrame) => {
          if (isMainFrame && code !== -3) failed(`${description} (${code})`);
        });
        view.webContents.on("render-process-gone", (_e, details) => failed(`the page stopped: ${details.reason}`));
        view.webContents.on("preload-error", (_e, _path, error) => failed(`the host bridge failed: ${error.message}`));
        win.contentView.addChildView(view);
        view.setBounds(bounds);
        await view.webContents.loadURL(moduleUrl(m, route)).catch((e: unknown) => failed(e instanceof Error ? e.message : String(e)));
        return;
      }
      view.setBounds(bounds);
      if (shown.route !== route) {
        shown.route = route;
        await view.webContents.loadURL(moduleUrl(m, route)).catch(() => undefined);
      }
    },
    async hide() {
      close();
    },
  };
}

/**
 * The desktop module page's preload (S-38): runs sandboxed in the module's own view and exposes exactly
 * `window.wos.app(<id>)`, the host bridge. The page never sees the shell's `window.wos` (sign-in, apps, Build),
 * `ipcRenderer`, Node, the filesystem, processes or git. Main checks the sender is the shown module's view and that
 * `<id>` is that module's own app; requests go only under the app's declared `routes.api`.
 */
import { contextBridge, ipcRenderer } from "electron";
import { MODULE_CHANNELS, type ModuleHostBridge } from "../shared/ipc.js";

const bridge: ModuleHostBridge = {
  app(id) {
    const app = String(id);
    return Object.freeze({
      manifest: () => ipcRenderer.invoke(MODULE_CHANNELS.manifest, { app }) as Promise<unknown>,
      request: (method, path, body) =>
        ipcRenderer.invoke(MODULE_CHANNELS.request, { app, method, path, body: body === undefined ? null : body }) as Promise<{
          status: number;
          body: unknown;
        }>,
    });
  },
};

contextBridge.exposeInMainWorld("wos", Object.freeze(bridge));

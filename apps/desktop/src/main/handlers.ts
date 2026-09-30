/**
 * Which IPC handlers exist in the main process (S-40). The shell's channels are registered once. Build's channels are
 * registered only while the Build gate is open and REMOVED when it closes, so with Build off a renderer (or anything
 * else) invoking them reaches no handler at all. Electron-free, so the rule is unit-tested.
 */
import { BUILD_CHANNEL_LIST, type InvokeChannel, SHELL_CHANNEL_LIST } from "../shared/ipc.js";

/** The subset of Electron's ipcMain the registry uses. */
export interface IpcLike {
  // biome-ignore lint/suspicious/noExplicitAny: Electron's listener signature.
  handle(channel: string, listener: (event: any, payload: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

export interface HandlerRegistry {
  registerShell(): void;
  setBuild(open: boolean): void;
  registered(): string[];
}

export function createHandlerRegistry(
  ipc: IpcLike,
  // biome-ignore lint/suspicious/noExplicitAny: Electron's listener signature.
  listener: (channel: InvokeChannel) => (event: any, payload: unknown) => Promise<unknown>,
): HandlerRegistry {
  const registered = new Set<string>();
  const add = (c: InvokeChannel) => {
    if (registered.has(c)) return;
    ipc.handle(c, listener(c));
    registered.add(c);
  };
  return {
    registerShell() {
      for (const c of SHELL_CHANNEL_LIST) add(c);
    },
    setBuild(open) {
      for (const c of BUILD_CHANNEL_LIST) {
        if (open) add(c);
        else if (registered.has(c)) {
          ipc.removeHandler(c);
          registered.delete(c);
        }
      }
    },
    registered: () => [...registered].sort(),
  };
}

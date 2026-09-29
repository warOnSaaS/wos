/** Preload (owner: desktop workstream): exposes exactly `window.wos: WosBridge` via contextBridge. Phase 0 stub. */
import type { WosBridge } from "../shared/ipc.js";

export type ExposedApi = { wos: WosBridge };

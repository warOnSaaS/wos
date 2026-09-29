/**
 * wOS Desktop main process (owner: desktop workstream). Phase 0 skeleton: states the security posture
 * the implementation must keep. Owns processes, git, worktrees, Claude Code/Codex, fs, verification —
 * all through @waronsaas/orchestrator.
 */
import { IPC_CHANNELS } from "../shared/ipc.js";

export const BROWSER_WINDOW_SECURITY = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  /** Renderer is loaded from the packaged file:// bundle only; navigation and window.open are denied. */
  denyNavigation: true,
} as const;

export const DEEP_LINK_SCHEME = "wos" as const;

export function channels(): readonly string[] {
  return Object.values(IPC_CHANNELS);
}

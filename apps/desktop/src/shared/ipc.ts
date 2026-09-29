/**
 * Desktop IPC contract (owner: desktop workstream). The renderer sees ONLY `window.wos`, typed by
 * `WosBridge`; it has no Node, no fs, no child_process. Every channel is invoke/handle (request ->
 * response) or a main->renderer event stream of OrchestratorEvent. Main validates every payload.
 */
import type { LocalStatus, OrchestratorEvent } from "@waronsaas/contracts";

export const IPC_CHANNELS = {
  status: "wos:status",
  login: "wos:login",
  build: "wos:build",
  review: "wos:review",
  release: "wos:release",
  events: "wos:events",
  openExternal: "wos:open-external",
} as const;

export interface WosBridge {
  status(): Promise<LocalStatus>;
  login(email: string): Promise<{ requestId: string }>;
  build(abu: string): Promise<{ started: true }>;
  review(slot: "astra" | "fable"): Promise<{ started: true }>;
  release(leaseId: string): Promise<void>;
  onEvent(listener: (event: OrchestratorEvent) => void): () => void;
  /** Only https://waronsaas.com, https://github.com/waronsaas/* URLs; main enforces the allowlist. */
  openExternal(url: string): Promise<void>;
}

/** Renderer entry (owner: desktop workstream). React UI; talks only to window.wos. Phase 0 stub. */
import type { WosBridge } from "../shared/ipc.js";

declare global {
  interface Window {
    wos: WosBridge;
  }
}

export function App() {
  return <main>wOS</main>;
}

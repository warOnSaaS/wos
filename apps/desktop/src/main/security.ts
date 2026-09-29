/**
 * SECURITY.md S-29 (Electron hardening), as data and pure functions so they are unit-tested without
 * Electron. src/main/start.ts applies them to every BrowserWindow and every webContents.
 */

/** webPreferences for every window. The renderer is sandboxed and has no Node. */
export const WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
  navigateOnDragDrop: false,
  spellcheck: false,
  safeDialogs: true,
} as const;

/** Kept for callers of the Wave 0 skeleton. */
export const BROWSER_WINDOW_SECURITY = { ...WEB_PREFERENCES, denyNavigation: true } as const;

export const DEEP_LINK_SCHEME = "wos" as const;

/**
 * Strict CSP for the packaged renderer (also written as a meta tag in index.html and asserted by a test).
 * The renderer talks to nothing but `window.wos`: no network at all.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join("; ");

/**
 * openExternal allowlist (S-29): https://waronsaas.com/... and https://github.com/waronsaas/... only.
 * No other scheme, host, port, credentials or look-alike host passes.
 */
export function isAllowedExternalUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.hostname === "waronsaas.com") return true;
  if (url.hostname === "github.com") {
    const [first, org] = url.pathname.split("/");
    return first === "" && org === "waronsaas" && (url.pathname === "/waronsaas" || url.pathname.startsWith("/waronsaas/"));
  }
  return false;
}

export interface AuthDeepLink {
  requestId: string;
  linkToken: string;
  /** The URL exactly as the orchestrator's SignInPrompt.deepLinks expects it. */
  url: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{8,256}$/;

/**
 * The `wos://` handler accepts ONLY `wos://auth?r=<uuid>&t=<token>` (S-29): no other host, no path,
 * no fragment, no extra or repeated parameters. Anything else returns null and is ignored.
 */
export function parseAuthDeepLink(raw: unknown): AuthDeepLink | null {
  if (typeof raw !== "string" || raw.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:` || url.hostname !== "auth") return null;
  if ((url.pathname !== "" && url.pathname !== "/") || url.hash || url.username || url.password || url.port) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes("r") || !keys.includes("t")) return null;
  const requestId = url.searchParams.get("r")!;
  const linkToken = url.searchParams.get("t")!;
  if (!UUID.test(requestId) || !TOKEN.test(linkToken)) return null;
  return {
    requestId,
    linkToken,
    url: `${DEEP_LINK_SCHEME}://auth?r=${encodeURIComponent(requestId)}&t=${encodeURIComponent(linkToken)}`,
  };
}

/** Finds the deep link in a second instance's argv (Linux, Windows) — only an exact `wos://auth` argument. */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  for (const a of argv) if (typeof a === "string" && a.startsWith(`${DEEP_LINK_SCHEME}://`)) return a;
  return null;
}

/** The minimal shape of Electron's WebFrameMain the sender check needs. */
export interface FrameLike {
  url: string;
  parent: unknown;
}

/**
 * S-29: every IPC handler checks the sender. Only the top frame of our own window, showing our own
 * packaged renderer, may call main.
 */
export function isTrustedSender(frame: FrameLike | null | undefined, mainFrame: unknown, rendererUrl: string): boolean {
  if (!frame || frame !== mainFrame || frame.parent) return false;
  try {
    const got = new URL(frame.url);
    const want = new URL(rendererUrl);
    return got.protocol === want.protocol && got.host === want.host && got.pathname === want.pathname;
  } catch {
    return false;
  }
}

/** The subset of Electron's WebContents the hardening touches (so it is testable with a fake). */
export interface HardenableContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  on(event: "will-navigate" | "will-redirect", listener: (event: { preventDefault(): void }, url: string) => void): unknown;
  on(event: "will-attach-webview", listener: (event: { preventDefault(): void }) => void): unknown;
}

/**
 * Navigation and window.open are denied outright (S-29). A link the user clicks inside the app never
 * navigates the window; allowed external links go through `wos:open-external` and the allowlist.
 */
export function hardenContents(contents: HardenableContents, log: (msg: string) => void = () => undefined): void {
  contents.setWindowOpenHandler(({ url }) => {
    log(`window.open denied: ${url.slice(0, 200)}`);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    event.preventDefault();
    log(`navigation denied: ${String(url).slice(0, 200)}`);
  });
  contents.on("will-redirect", (event, url) => {
    event.preventDefault();
    log(`redirect denied: ${String(url).slice(0, 200)}`);
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
    log("webview denied");
  });
}

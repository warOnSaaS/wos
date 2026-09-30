/**
 * The wos-module:// protocol as pure functions (S-38), used by module-view.ts and unit-tested without Electron:
 * the URL shape, the scheme's privileges, the CSP every module file is served with, and which request is served.
 */
import type { ModuleInstaller } from "./module-installer.js";

export const MODULE_SCHEME = "wos-module" as const;
export const MODULE_PARTITION = "wos-modules" as const;

/** The CSP every module file is served with (S-38): its own origin only, no network, no eval. */
export const MODULE_CONTENT_SECURITY_POLICY = [
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
  "frame-ancestors 'none'",
  "worker-src 'none'",
].join("; ");

/** The privileges `protocol.registerSchemesAsPrivileged` gives wos-module (before app ready). */
export const MODULE_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: false,
  corsEnabled: false,
  bypassCSP: false,
  allowServiceWorkers: false,
  stream: false,
  codeCache: false,
} as const;

/** `wos-module://<app>/<version>/<entry>#<route>`: the only kind of URL a module view ever loads. */
export function moduleUrl(m: { app: string; version: string; entry: string }, route: string): string {
  return `${MODULE_SCHEME}://${m.app}/${m.version}/${m.entry}#${route}`;
}

/** Parses a wos-module URL into app, version and package path; null for anything else. */
export function parseModuleUrl(raw: string): { app: string; version: string; path: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${MODULE_SCHEME}:` || u.username || u.password || u.port || u.search) return null;
  const m = /^\/(\d+\.\d+\.\d+)\/([A-Za-z0-9._/-]+)$/.exec(u.pathname);
  if (!m || !/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(u.hostname)) return null;
  return { app: u.hostname, version: m[1]!, path: m[2]! };
}

/** Serves one module request: only the shown module's version, only files in its verified package. */
export function serveModuleRequest(
  url: string,
  shown: { app: string; version: string } | null,
  installer: Pick<ModuleInstaller, "readFile">,
): { status: number; body: Uint8Array | null; headers: Record<string, string> } {
  const headers = {
    "content-security-policy": MODULE_CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  };
  const parsed = parseModuleUrl(url);
  if (!parsed || !shown || parsed.app !== shown.app || parsed.version !== shown.version) return { status: 404, body: null, headers };
  const file = installer.readFile(parsed.app, parsed.version, parsed.path);
  if (!file) return { status: 404, body: null, headers };
  return { status: 200, body: file.bytes, headers: { ...headers, "content-type": file.contentType } };
}

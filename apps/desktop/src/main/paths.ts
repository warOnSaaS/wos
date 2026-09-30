/**
 * Filesystem paths for wOS Desktop on macOS, Linux and Windows (D17, S-42), as pure functions over an explicit
 * `path` flavour so the Windows rules are tested on every OS.
 *
 * - Build's workspace (worktrees, the git mirror) lives under a SHORT per-user root on Windows, because a worktree
 *   path plus a deep repository path overflows MAX_PATH long before Git's `core.longpaths` helps every tool that
 *   touches it (S-42; `packages/github` sets `core.longpaths` and `core.autocrlf=false`).
 * - Module package files are addressed by their `/`-separated package path and joined segment by segment, so a
 *   package path never carries a separator the OS would read differently. Names Windows cannot store (reserved
 *   device names, trailing dot or space, `:` and friends) and paths that differ only in case are refused before
 *   anything is written: a package must install identically on every OS.
 */
import { posix, win32 } from "node:path";

export type DesktopPlatform = "darwin" | "linux" | "win32";

export function pathFlavour(platform: DesktopPlatform): typeof posix {
  return platform === "win32" ? win32 : posix;
}

/**
 * Where Build keeps its workspace. macOS and Linux: `<userData>/workspace` (unchanged). Windows: `<home>\wos-w`, which
 * keeps `<root>\<worktree>\<repo path>` short; `userData` (`%APPDATA%\wOS`) is long and roams.
 */
export function workspaceRootFor(platform: DesktopPlatform, dirs: { userData: string; home: string }): string {
  const p = pathFlavour(platform);
  return platform === "win32" ? p.join(dirs.home, "wos-w") : p.join(dirs.userData, "workspace");
}

/** Where installed desktop modules live: `<userData>/modules`. */
export function modulesRootFor(platform: DesktopPlatform, userData: string): string {
  return pathFlavour(platform).join(userData, "modules");
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Why a package-relative path cannot be installed on every OS, or null when it can. The `ModulePackage` schema already
 * limits the characters to `[A-Za-z0-9._/-]` and refuses `..`; this adds the rest of the portable-name rules.
 */
export function packagePathProblem(rel: string): string | null {
  if (rel.length === 0 || rel.length > 240) return "empty or too long";
  if (rel.startsWith("/") || rel.includes("\\")) return "absolute or backslash";
  const segs = rel.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === "..") return "empty, '.' or '..' segment";
    if (!SEGMENT.test(s)) return "a character outside [A-Za-z0-9._-]";
    if (WINDOWS_RESERVED.test(s)) return `"${s}" is a reserved name on Windows`;
    if (s.endsWith(".") || s.endsWith(" ")) return `"${s}" ends with a dot`;
  }
  return null;
}

/** Paths equal ignoring case collide on Windows and default macOS volumes: the first collision, or null. */
export function caseCollision(paths: readonly string[]): [string, string] | null {
  const seen = new Map<string, string>();
  for (const p of paths) {
    const k = p.toLowerCase();
    const prior = seen.get(k);
    if (prior !== undefined && prior !== p) return [prior, p];
    seen.set(k, p);
  }
  return null;
}

/** Joins a checked `/`-separated package path under `dir`, segment by segment, in the platform's flavour. */
export function joinPackagePath(platform: DesktopPlatform, dir: string, rel: string): string {
  const problem = packagePathProblem(rel);
  if (problem) throw new Error(`package path ${JSON.stringify(rel)}: ${problem}`);
  return pathFlavour(platform).join(dir, ...rel.split("/"));
}

import { RepoPath, type WriteScope } from "@waronsaas/contracts";

/**
 * Path rules on top of the contracts' `RepoPath`. RepoPath is the minimum; a changeset path must also be
 * safe to check out on macOS, Windows and Linux, because contributors run wOS on all three.
 */

// C0/C1 controls and DEL; bidi overrides/isolates and zero-width characters (visual spoofing of paths).
const isControlOrInvisible = (s: string) =>
  [...s].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return (
      c <= 0x1f ||
      (c >= 0x7f && c <= 0x9f) ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2069) ||
      c === 0xfeff
    );
  });
// Characters Windows refuses in file names (':' also opens NTFS alternate data streams).
const WINDOWS_RESERVED_CHARS = /[<>:"|?*]/;
// Windows device names, with or without an extension.
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

/** Returns why `path` is not an acceptable changeset path, or null when it is. */
export function pathProblem(path: unknown): string | null {
  if (typeof path !== "string") return "path is not a string";
  const parsed = RepoPath.safeParse(path);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid RepoPath";
  if (isControlOrInvisible(path)) return "control or invisible character";
  for (const seg of path.split("/")) {
    if (WINDOWS_RESERVED_CHARS.test(seg)) return `segment "${seg}" contains a character Windows refuses`;
    if (/[. ]$/.test(seg)) return `segment "${seg}" ends with a dot or space (aliases another name on Windows)`;
    if (WINDOWS_DEVICE.test(seg)) return `segment "${seg}" is a Windows device name`;
    // ".git" spelled so that some file system resolves it to .git (case, trailing dots/spaces, 8.3 name).
    const bare = fold(seg).replace(/[. ]+$/, "");
    if (bare === ".git" || bare === "git~1") return `segment "${seg}" aliases .git`;
  }
  return null;
}

/**
 * Folds a path the way the most permissive checkout does: Unicode NFC (macOS normalises) and full
 * case folding (macOS and Windows are case-insensitive; toUpperCase first so "ß" and "SS" meet).
 */
export function fold(path: string): string {
  return path.normalize("NFC").toUpperCase().toLowerCase();
}

const scopeBase = (s: WriteScope) => (s.endsWith("/**") ? { base: s.slice(0, -3), tree: true } : { base: s, tree: false });

/** Allow check: exact, case-sensitive. A tree scope contains the paths below the directory. */
export function inScope(path: string, scope: WriteScope): boolean {
  const { base, tree } = scopeBase(scope);
  return tree ? path.startsWith(`${base}/`) : path === base;
}

/**
 * Deny check: folded, and a tree pattern also matches the directory name itself, so a file cannot take
 * the place of a protected directory (a file named ".github" would block the workflows directory).
 */
export function matchesDeny(path: string, pattern: WriteScope | string): boolean {
  const { base, tree } = scopeBase(pattern);
  const p = fold(path);
  const b = fold(base);
  return p === b || (tree && p.startsWith(`${b}/`));
}

/** Every proper directory prefix of a path: "a/b/c.ts" -> ["a", "a/b"]. */
export function parentDirs(path: string): string[] {
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join("/"));
  return out;
}

/**
 * Write-scope vs glob questions the build-graph validator asks before any code exists: "can this write
 * scope touch a path that matches this `wos.json` glob?".
 *
 * `toolchainPaths` and `toolchainRequirements[].paths` are picomatch globs (dot: true). This package has no
 * picomatch dependency (the lockfile is frozen), so it carries a small segment matcher for the subset those
 * files use: `*`, `?`, `**` and `{a,b}`. Anything else is matched literally, which can only make a scope look
 * LESS dangerous than picomatch would; the changeset validator (verification, picomatch) still checks every
 * concrete path at submission time.
 */
import type { WriteScope } from "@waronsaas/contracts";

const GLOB_CHARS = /[*?{}[\]!]/;

export const isLiteralGlob = (glob: string) => !GLOB_CHARS.test(glob);

const segmentCache = new Map<string, RegExp>();

function segmentRegExp(seg: string): RegExp {
  let re = segmentCache.get(seg);
  if (re) return re;
  let src = "";
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i] as string;
    if (ch === "*") src += "[^/]*";
    else if (ch === "?") src += "[^/]";
    else if (ch === "{") {
      const end = seg.indexOf("}", i);
      if (end === -1) {
        src += "\\{";
        continue;
      }
      const alts = seg
        .slice(i + 1, end)
        .split(",")
        .map((a) =>
          a
            .replace(/[.+^$()|[\]\\]/g, "\\$&")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]"),
        );
      src += `(?:${alts.join("|")})`;
      i = end;
    } else src += ch.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
  }
  re = new RegExp(`^${src}$`, "i");
  segmentCache.set(seg, re);
  return re;
}

const split = (p: string) => p.split("/").filter((s) => s.length > 0);

/** Full match of a repo path against a glob (case-insensitive, like the changeset validator's nocase). */
export function globMatches(glob: string, path: string): boolean {
  const g = split(glob);
  const p = split(path);
  const walk = (gi: number, pi: number): boolean => {
    if (gi === g.length) return pi === p.length;
    const seg = g[gi] as string;
    if (seg === "**") {
      for (let k = pi; k <= p.length; k++) if (walk(gi + 1, k)) return true;
      return false;
    }
    if (pi === p.length) return false;
    return segmentRegExp(seg).test(p[pi] as string) && walk(gi + 1, pi + 1);
  };
  return walk(0, 0);
}

/**
 * Can some path inside `scope` match `glob`? An exact scope is one path. A tree scope `<dir>/**` holds every
 * path below `<dir>`, with any names, so the glob only has to match `<dir>`'s segments as a prefix and still
 * have at least one segment left for the file.
 */
export function scopeCanTouchGlob(scope: WriteScope, glob: string): boolean {
  if (!scope.endsWith("/**")) return globMatches(glob, scope);
  const dir = split(scope.slice(0, -3));
  const g = split(glob);
  const walk = (gi: number, di: number): boolean => {
    if (di === dir.length) return gi < g.length;
    if (gi === g.length) return false;
    const seg = g[gi] as string;
    if (seg === "**") return true;
    return segmentRegExp(seg).test(dir[di] as string) && walk(gi + 1, di + 1);
  };
  return walk(0, 0);
}

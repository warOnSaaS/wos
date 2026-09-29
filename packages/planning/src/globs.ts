/**
 * Write-scope vs glob questions the build-graph validator asks before any code exists: "can this write
 * scope touch a path that matches this `wos.json` glob?".
 *
 * `toolchainPaths` and `toolchainRequirements[].paths` are picomatch globs. Matching uses picomatch with the
 * changeset validator's options (dot files matched, case-insensitive), so a graph and its submissions agree
 * (contracts 4.2.0, FEATURE-CONTRACT.md section 9).
 */
import type { WriteScope } from "@waronsaas/contracts";
import picomatch from "picomatch";

const OPTIONS = { dot: true, nocase: true } as const;

export const isLiteralGlob = (glob: string) => !picomatch.scan(glob).isGlob;

const matchers = new Map<string, (path: string) => boolean>();
function matcher(glob: string): (path: string) => boolean {
  let m = matchers.get(glob);
  if (!m) {
    m = picomatch(glob, OPTIONS);
    matchers.set(glob, m);
  }
  return m;
}

/** Full match of a repo path against a glob (picomatch, dot: true, nocase: true). */
export function globMatches(glob: string, path: string): boolean {
  return matcher(glob)(path);
}

const split = (p: string) => p.split("/").filter((s) => s.length > 0);

/**
 * Can some path inside `scope` match `glob`? An exact scope is one path. A tree scope `<dir>/**` holds every
 * path below `<dir>`, with any names, so the glob's leading segments only have to match `<dir>`'s segments
 * (each segment matched by picomatch) and the glob must still have a segment left for the file; a `**`
 * segment matches any remainder.
 */
export function scopeCanTouchGlob(scope: WriteScope, glob: string): boolean {
  if (!scope.endsWith("/**")) return globMatches(glob, scope);
  const dir = split(scope.slice(0, -3));
  const g = split(glob);
  for (let i = 0; i < dir.length; i++) {
    const seg = g[i];
    if (seg === undefined) return false;
    if (seg === "**") return true;
    if (!matcher(seg)(dir[i] as string)) return false;
  }
  return g.length > dir.length;
}

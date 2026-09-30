/**
 * contracts 5.17.0: finds a provider's CLI binary. On PATH it is returned as the bare name (the spawn resolves it);
 * otherwise the first existing, executable match of the provider's `binarySearchPaths` (policy data), where `~` is the
 * home directory and `*` matches one path segment, newest-looking match first (reverse lexical order, so
 * `node/v22.x` comes before `node/v20.x`). Nothing found: the bare name, so the spawn fails as "not installed".
 */
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

function executable(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expand(pattern: string, home: string | null): string[] {
  if (pattern.startsWith("~/") && !home) return []; // no HOME in the agent environment: home paths are not searched
  const abs = pattern.startsWith("~/") ? join(home!, pattern.slice(2)) : pattern;
  const segs = abs.split("/");
  let paths = [segs[0] === "" ? "/" : segs[0]!];
  for (const seg of segs.slice(1)) {
    if (seg === "") continue;
    if (seg === "*") {
      const next: string[] = [];
      for (const p of paths) {
        let names: string[] = [];
        try {
          names = readdirSync(p).sort().reverse();
        } catch {
          names = [];
        }
        for (const n of names) next.push(join(p, n));
      }
      paths = next;
    } else paths = paths.map((p) => join(p, seg));
  }
  return paths;
}

export function resolveBinary(binary: string, searchPaths: readonly string[], pathEnv: string, home: string | null): string {
  for (const dir of pathEnv.split(delimiter)) if (dir && executable(join(dir, binary))) return binary;
  for (const pattern of searchPaths) for (const p of expand(pattern, home)) if (executable(p)) return p;
  return binary;
}

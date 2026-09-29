/**
 * Toolchain eligibility at claim (D13, BUILD-PROTOCOL.md "Toolchain eligibility"): the repository's
 * path-based `toolchainRequirements` whose paths can intersect the ABU's write scopes must each be satisfied
 * by the device's latest `ToolchainAttestation`, otherwise the claim is NOT_ELIGIBLE.
 */
import { matchesGlob } from "node:path";
import { compareToolVersions, type RepoManifest } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";

/** The literal directory prefix of a glob, up to its first wildcard segment. */
function literalPrefix(glob: string): string {
  const segs = glob.split("/");
  const out: string[] = [];
  for (const s of segs) {
    if (/[*?[\]{}]/.test(s)) break;
    out.push(s);
  }
  return out.join("/");
}

const within = (a: string, b: string) => a === "" || b === "" || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** True when some path inside the write scope (an exact file or `<dir>/**`) can match the glob. */
export function scopeCanTouch(writeScope: string, glob: string): boolean {
  if (!writeScope.endsWith("/**")) return matchesGlob(writeScope, glob);
  return within(writeScope.slice(0, -3), literalPrefix(glob));
}

export function applicableRequirements(manifest: RepoManifest | null, write: readonly string[]) {
  return (manifest?.toolchainRequirements ?? []).filter((r) => r.paths.some((p) => write.some((w) => scopeCanTouch(w, p))));
}

export async function assertToolchain(
  tx: Tx,
  _deps: Deps,
  input: { accountId: string; deviceId: string; repo: string; commit: string; write: readonly string[]; manifest: RepoManifest | null },
): Promise<void> {
  const reqs = applicableRequirements(input.manifest, input.write);
  if (reqs.length === 0) return;
  const [att] = await tx<{ os: string; tools: Array<{ name: string; version: string }> }[]>`
    select os, tools from wos.toolchain_attestations where account_id = ${input.accountId} and device_id = ${input.deviceId}
     order by created_at desc limit 1`;
  const reasons: string[] = [];
  for (const r of reqs) {
    if (!att) {
      reasons.push(`TOOLCHAIN_REQUIRED ${r.id}: no toolchain attestation for this device`);
      continue;
    }
    if (!r.os.includes(att.os as "macos")) reasons.push(`TOOLCHAIN_REQUIRED ${r.id}: needs ${r.os.join(" or ")}, device is ${att.os}`);
    for (const t of r.tools) {
      const have = att.tools.find((x) => x.name === t.name);
      if (!have || compareToolVersions(have.version, t.minVersion) < 0) {
        reasons.push(`TOOLCHAIN_REQUIRED ${r.id}: needs ${t.name} >= ${t.minVersion}${have ? `, device has ${have.version}` : ""}`);
      }
    }
  }
  if (reasons.length > 0) throw new ApiFailure("NOT_ELIGIBLE", "this device's toolchain cannot build this ABU", { reasons });
}

/**
 * Toolchain eligibility at claim (D13, BUILD-PROTOCOL.md "Toolchain eligibility"): the repository's
 * path-based `toolchainRequirements` whose paths can intersect the ABU's write scopes must each be satisfied
 * by the device's latest `ToolchainAttestation`, otherwise the claim is NOT_ELIGIBLE.
 */
import { scopeCanTouchGlob } from "@waronsaas/agent-policy";
import { compareToolVersions, type RepoManifest } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";

/**
 * True when some path inside the write scope (an exact file or `<dir>/**`) can match the glob. One matcher for
 * the platform (integration glue at the Wave 2 gate): agent-policy's segment-wise check. The earlier literal-prefix
 * version here treated `apps/mobile/app.config.*` as the directory `apps/mobile`, so `apps/mobile/ios/**`
 * picked up the expo-native-config requirement.
 */
export const scopeCanTouch = scopeCanTouchGlob;

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

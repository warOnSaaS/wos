/**
 * Declared permissions (WOS-APP-PROTOCOL section 3). A permission an app does not declare cannot be checked, so it
 * is refused. Grants are the manifest defaults per org role; per-organization overrides are not built yet.
 */
import type { OrgRole, WosAppManifest } from "../../core-contracts/src/index.js";

export function isDeclared(manifest: WosAppManifest, key: string): boolean {
  return manifest.permissions.some((p) => p.key === key);
}

/** Does `role` hold `key` in `manifest`? Undeclared keys are never granted. */
export function roleHas(manifest: WosAppManifest, role: OrgRole, key: string): boolean {
  const p = manifest.permissions.find((x) => x.key === key);
  return p?.grantedTo.includes(role) === true;
}

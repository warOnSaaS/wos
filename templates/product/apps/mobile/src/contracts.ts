/**
 * The contracts wOS Mobile imports: the mobile-runtime row of WORKSTREAMS 12.4 (contracts 5.2.0), plus the wOS Cloud
 * account routes named in blockers/B-0001-mobile-runtime.md. Nothing here defines or changes a schema: every name is
 * re-exported from the generated, byte-identical copy of `packages/contracts/src` in `modules/core-contracts/src/vendor`
 * (suite-shell's `vendor.mjs`).
 *
 * It imports the vendor files directly, not `modules/core-contracts/src/index.ts`, because that index also re-exports
 * the Node-only signing helpers (`canonical.ts`, node:crypto), which cannot run on a phone. wOS Mobile never verifies or
 * signs a token itself: it only carries it.
 */

// ---- WORKSTREAMS 12.4, mobile-runtime
export { AppRoutes, HOSTS } from "../../../modules/core-contracts/src/vendor/api.js";
export {
  ACTIVE_APPS_REFRESH_SECONDS,
  ActiveApps,
  CoreRoutes,
  EnvironmentAuth,
  EnvironmentDescriptor,
  MobileScreen,
  ScreenAction,
  ScreenFormBody,
  ScreenInvokeResult,
  ScreenListData,
  ScreenRecordData,
  ScreenSection,
  WOS_CLOUD_ENVIRONMENT_ID,
  WosAppManifest,
} from "../../../modules/core-contracts/src/vendor/wos-app.js";

// ---- Used with them. Local sign-in (B-0001-suite-shell ruling: "desktop and mobile-runtime: use them for `local`
// environments"), the error envelope, the pure range check for `requires.wos`, and the account routes a phone needs to
// reach `issueEnvironmentToken` (listed in B-0001-mobile-runtime for the 12.4 row).
export { ApiError, Routes } from "../../../modules/core-contracts/src/vendor/api.js";
export {
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  LocalSignInRedeemBody,
  LocalSignInRedeemResponse,
  LocalSignInStartBody,
  LocalSignInStartResponse,
  OrganizationView,
  OrgRole,
  satisfiesRange,
  WOS_APP_PROTOCOL,
} from "../../../modules/core-contracts/src/vendor/wos-app.js";

import type { z } from "zod";
import type {
  ActiveApps as ActiveAppsSchema,
  EnvironmentDescriptor as EnvironmentDescriptorSchema,
  MobileScreen as MobileScreenSchema,
  ScreenAction as ScreenActionSchema,
  ScreenRecord as ScreenRecordSchema,
  ScreenSection as ScreenSectionSchema,
  WosAppManifest as WosAppManifestSchema,
} from "../../../modules/core-contracts/src/vendor/wos-app.js";

export type ActiveAppsT = z.infer<typeof ActiveAppsSchema>;
export type ActiveAppT = ActiveAppsT["apps"][number];
export type EnvironmentDescriptorT = z.infer<typeof EnvironmentDescriptorSchema>;
export type MobileScreenT = z.infer<typeof MobileScreenSchema>;
export type ScreenActionT = z.infer<typeof ScreenActionSchema>;
export type ScreenSectionT = z.infer<typeof ScreenSectionSchema>;
export type ScreenRecordT = z.infer<typeof ScreenRecordSchema>;
export type WosAppManifestT = z.infer<typeof WosAppManifestSchema>;
export type OrgRoleT = WosAppManifestT["permissions"][number]["grantedTo"][number];
export type ScreenValueT = string | number | boolean | null;

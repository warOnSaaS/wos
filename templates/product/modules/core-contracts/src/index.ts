/**
 * The contracts wOS Core, wOS Web and the bundled applications import. The schemas live in `./vendor/`, a generated
 * byte-identical copy of `packages/contracts/src` from waronsaas/wos (`vendor.mjs`); nothing here redefines them.
 *
 * Section A is exactly the suite-shell row of WORKSTREAMS 12.4 (contracts 5.2.0). Section B names further
 * existing exports the shell needs; they are listed in blockers/B-0001-suite-shell.md for the architect to add to
 * 12.4 (no schema is copied or changed).
 */

// ---- A. WORKSTREAMS 12.4, suite-shell
export { HOSTS } from "./vendor/api.js";
export { verifyEnvironmentToken } from "./vendor/canonical.js";
export {
  ActivationSource,
  ActiveApps,
  activeAppIds,
  CoreRoutes,
  EnvironmentAuth,
  EnvironmentDescriptor,
  EnvironmentKey,
  EnvironmentTokenClaims,
  MobileScreen,
  OrgApps,
  OrgAppView,
  ScreenFormBody,
  ScreenInvokeResult,
  ScreenListData,
  ScreenRecordData,
  satisfiesRange,
  WOS_CLOUD_ENVIRONMENT_ID,
  WosAppManifest,
} from "./vendor/wos-app.js";

// ---- B. Further existing exports (B-0001-suite-shell)
export { ApiErrorCode, AppRoutes, Routes } from "./vendor/api.js";
export { encodeDevicePublicKey, signEnvironmentToken } from "./vendor/canonical.js";
export { CONTRACTS_VERSION } from "./vendor/version.js";
export {
  ACTIVE_APPS_REFRESH_SECONDS,
  CORE_APP_ID,
  ENVIRONMENT_TOKEN_SKEW_SECONDS,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  OrganizationView,
  OrgRole,
} from "./vendor/wos-app.js";

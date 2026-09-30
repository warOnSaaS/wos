/**
 * The contracts wOS Core, wOS Web and the bundled applications import. The schemas live in `./vendor/`, a generated
 * byte-identical copy of `packages/contracts/src` from waronsaas/wos (`vendor.mjs`); nothing here redefines them.
 *
 * Section A is the suite-shell row of WORKSTREAMS 12.4 as of contracts 5.2.0; section B the names the row gained at
 * 5.6.0 (B-0001-suite-shell: local sign-in, and the wOS Cloud calls of the web shell as clientKind web_app, S-43).
 * No schema is copied or changed here.
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

// ---- B. Added to 12.4 at contracts 5.6.0 (B-0001-suite-shell)
export { ApiErrorCode, AppRoutes, Routes, WEB_APP_SIGNIN_CODE_PATH } from "./vendor/api.js";
export { encodeDevicePublicKey, signEnvironmentToken } from "./vendor/canonical.js";
export { CONTRACTS_VERSION } from "./vendor/version.js";
export {
  ACTIVE_APPS_REFRESH_SECONDS,
  CORE_APP_ID,
  ENVIRONMENT_TOKEN_SKEW_SECONDS,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  LocalSignInRedeemBody,
  LocalSignInRedeemResponse,
  LocalSignInStartBody,
  LocalSignInStartResponse,
  OrganizationView,
  OrgRole,
} from "./vendor/wos-app.js";

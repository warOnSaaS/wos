/**
 * The app modules compiled into this build of wOS Mobile (WOS-APP-PROTOCOL section 5: app code is bundled in the store
 * build and activated at runtime by `ActiveApps`; nothing executable is downloaded, S-38). Adding an app to wOS Mobile
 * means adding its entry here; whether it SHOWS is decided by the environment, never here.
 *
 * Each entry maps the app's navigation routes (from its manifest) to the screen they open, and carries the app's
 * `wos-screen.v1` files as the offline fallback. CRM has no built feature yet, so its only screen is the list of
 * features this version ships, which is empty: the phone shows 0, never sample records.
 */
import crmFeatures from "../../../../applications/crm/mobile/screens/features.json" with { type: "json" };
import { MobileScreen } from "../contracts.js";
import type { BundledMobileModule } from "../runtime/navigation.js";

export const BUNDLED_MOBILE_MODULES: ReadonlyMap<string, BundledMobileModule> = new Map([
  ["crm", { app: "crm", entries: { "/crm": "crm.features.list" }, screens: [MobileScreen.parse(crmFeatures)] }],
]);

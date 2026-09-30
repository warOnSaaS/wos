/**
 * Build's WOS-APP manifest (D16), committed next to this file and published to the registry with a null desktop
 * package (Build is bundled in the Desktop binary, WORKSTREAMS 12.4). The shell registers its navigation and the
 * `build.contribute` permission only under S-40; this module only parses it.
 */
import { BUILD_APP_ID, type WosAppManifest, WosAppManifest as ManifestSchema } from "@waronsaas/contracts";
import raw from "./wos-app.json" with { type: "json" };

export const BUILD_MANIFEST: WosAppManifest = ManifestSchema.parse(raw);

if (BUILD_MANIFEST.app.id !== BUILD_APP_ID) throw new Error("apps/build/wos-app.json is not Build's manifest");

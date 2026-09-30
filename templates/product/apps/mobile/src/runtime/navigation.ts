/**
 * Mobile navigation from the active manifests (WOS-APP-PROTOCOL sections 3, 5 and 9): every active app's navigation
 * entries for this platform (`ios` or `android`), filtered by the caller's role through the manifest's declared
 * permissions, ordered by `order`. Shell code never lists apps by name; it renders this.
 *
 * App code on a phone is bundled in the store build (S-38). An app can be active on the environment but missing from
 * this build (released after it): its entry is still shown, marked as needing a wOS Mobile update, never faked.
 */
import type { ActiveAppT, MobileScreenT, OrgRoleT, WosAppManifestT } from "../contracts.js";

export type MobilePlatform = "ios" | "android";

/** One app's mobile module compiled into this build: which screen each navigation route opens, and its screens. */
export type BundledMobileModule = {
  app: string;
  /** navigation `route` -> the screen id it opens. */
  entries: Readonly<Record<string, string>>;
  /** The app's `wos-screen.v1` files, used when the environment's screens cannot be read (offline fallback). */
  screens: readonly MobileScreenT[];
};

export type NavEntry = {
  app: string;
  appName: string;
  id: string;
  title: string;
  route: string;
  order: number;
  /** The screen the entry opens; null when this build has no module for the app (`needsUpdate`). */
  screen: string | null;
  needsUpdate: boolean;
};

export function roleHas(manifest: WosAppManifestT, role: OrgRoleT, permission: string): boolean {
  return manifest.permissions.some((p) => p.key === permission && p.grantedTo.includes(role));
}

export function mobileNavigation(
  active: readonly ActiveAppT[],
  platform: MobilePlatform,
  role: OrgRoleT | null,
  modules: ReadonlyMap<string, BundledMobileModule>,
): NavEntry[] {
  if (role === null) return [];
  const out: NavEntry[] = [];
  for (const { manifest } of active) {
    if (!manifest.surfaces[platform].supported) continue;
    const bundled = modules.get(manifest.app.id);
    for (const n of manifest.navigation) {
      if (!n.surfaces.includes(platform)) continue;
      if (n.permission !== null && !roleHas(manifest, role, n.permission)) continue;
      const screen = bundled?.entries[n.route] ?? null;
      out.push({
        app: manifest.app.id,
        appName: manifest.app.name,
        id: n.id,
        title: n.title,
        route: n.route,
        order: n.order,
        screen,
        needsUpdate: screen === null,
      });
    }
  }
  return out.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Is `app` still active? Used to leave an app's screens when it is disabled while open (V1 proof step 7). */
export function isActive(active: readonly ActiveAppT[] | null, app: string): boolean {
  return active?.some((a) => a.id === app) === true;
}

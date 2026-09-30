/**
 * The navigation registry (WOS-APP-PROTOCOL section 3): the navigation of every active app, merged, filtered by
 * surface and by the caller's role, ordered by `order`. Shells render this; apps never edit shell navigation.
 */
import type { OrgRole, WosAppManifest } from "../../core-contracts/src/index.js";
import { roleHas } from "./permissions.js";

export type NavSurface = "web" | "desktop" | "ios" | "android";
export type NavItem = { app: string; id: string; title: string; route: string; order: number };

export function navigationFor(active: readonly { manifest: WosAppManifest }[], surface: NavSurface, role: OrgRole): NavItem[] {
  const items: NavItem[] = [];
  for (const { manifest } of active) {
    if (!manifest.surfaces[surface].supported) continue;
    for (const n of manifest.navigation) {
      if (!n.surfaces.includes(surface)) continue;
      if (n.permission !== null && !roleHas(manifest, role, n.permission)) continue;
      items.push({ app: manifest.app.id, id: n.id, title: n.title, route: n.route, order: n.order });
    }
  }
  return items.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The active app whose `routes.ui` owns `path` ("/crm" and "/crm/..." belong to crm). */
export function appForUiPath<T extends { manifest: WosAppManifest }>(active: readonly T[], path: string): T | null {
  return active.find((a) => path === a.manifest.routes.ui || path.startsWith(`${a.manifest.routes.ui}/`)) ?? null;
}

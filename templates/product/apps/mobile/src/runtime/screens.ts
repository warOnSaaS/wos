/**
 * An app's `wos-screen.v1` screens: served by the environment (`GET /v1/core/apps/:app/screens`, already filtered by
 * the caller's role) and bundled in the store build as a fallback for when the environment cannot be reached
 * (WOS-APP-PROTOCOL section 9). Screens are data: nothing in them is executed (S-38).
 */
import { CoreRoutes, MobileScreen, type MobileScreenT } from "../contracts.js";
import { HttpError } from "./http.js";
import type { BundledMobileModule } from "./navigation.js";
import type { EnvironmentSession } from "./session.js";

export type AppScreens = { app: string; version: string | null; screens: MobileScreenT[]; source: "environment" | "bundled" };

export async function loadScreens(session: EnvironmentSession, app: string, bundled: BundledMobileModule | undefined): Promise<AppScreens> {
  try {
    const r = await session.authorized({ method: "GET", path: CoreRoutes.screens.path.replace(":app", encodeURIComponent(app)) });
    const parsed = CoreRoutes.screens.response.safeParse(r.json);
    if (!parsed.success || parsed.data.app !== app)
      throw new HttpError(r.status, "PROTOCOL", "the environment sent screens wOS Mobile does not understand");
    return { app, version: parsed.data.version, screens: parsed.data.screens.filter((s) => s.app === app), source: "environment" };
  } catch (err) {
    if (err instanceof HttpError && err.code === "NETWORK" && bundled)
      return { app, version: null, screens: bundled.screens.map((s) => MobileScreen.parse(s)), source: "bundled" };
    throw err;
  }
}

export function findScreen(screens: AppScreens, id: string): MobileScreenT | null {
  return screens.screens.find((s) => s.id === id) ?? null;
}

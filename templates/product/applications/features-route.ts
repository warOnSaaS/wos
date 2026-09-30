/**
 * `GET /apps/<id>/features`: the catalog features (D10) this version of the app ships, read from its own manifest,
 * as `ScreenListData`. It is the only data CRM and Contacts serve until the roadmap builds more, so an app with no
 * built features answers an empty list: the screens show 0, never sample records.
 */
import { ScreenListData } from "../modules/core-contracts/src/index.js";
import type { AppRouteDef } from "../modules/core/src/app-module.js";

export function featuresRoute(permission: string): AppRouteDef {
  return {
    method: "GET",
    path: "/features",
    permission,
    handler: ({ manifest }) => ({
      body: ScreenListData.parse({ items: manifest.features.map((f) => ({ id: f, name: f })), nextCursor: null }),
    }),
  };
}

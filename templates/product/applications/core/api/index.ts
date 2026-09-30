/** wOS Core's own app routes under /apps/core. */
import type { AppServerModule } from "../../../modules/core/src/app-module.js";

export const server: AppServerModule = {
  routes: [
    {
      method: "GET",
      path: "/me",
      permission: "core.profile.read",
      handler: ({ principal }) => ({
        body: { userId: principal.userId, organizationId: principal.organizationId, role: principal.role, via: principal.kind },
      }),
    },
  ],
};

/** wOS CRM's API under /apps/crm. No CRM feature is built yet, so it serves only the features in this version. */
import type { AppServerModule } from "../../../modules/core/src/app-module.js";
import { featuresRoute } from "../../features-route.js";

export const server: AppServerModule = { routes: [featuresRoute("crm.status.read")] };

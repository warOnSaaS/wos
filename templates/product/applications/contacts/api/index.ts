/** wOS Contacts' API under /apps/contacts. Nothing of the contacts feature is built yet, so it serves only its status. */
import type { AppServerModule } from "../../../modules/core/src/app-module.js";
import { featuresRoute } from "../../features-route.js";

export const server: AppServerModule = { routes: [featuresRoute("contacts.status.read")] };

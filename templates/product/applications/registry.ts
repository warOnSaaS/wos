/**
 * The applications compiled into this build of wOS Core and wOS Web (Amendment 01, A10). Adding an app means
 * adding its entry here; whether it is ACTIVE is decided at runtime (environment token or WOS_APPS), never here.
 */
/// <reference path="../modules/core/src/sql.d.ts" />
import type { BundledAppInput } from "../modules/core/src/app-module.js";
import { server as contactsServer } from "./contacts/api/index.js";
import contactsManifest from "./contacts/wos-app.json" with { type: "json" };
import { server as coreServer } from "./core/api/index.js";
import core0001 from "./core/migrations/0001_core.sql?raw";
import coreManifest from "./core/wos-app.json" with { type: "json" };
import { server as crmServer } from "./crm/api/index.js";
import crmFeaturesScreen from "./crm/mobile/screens/features.json" with { type: "json" };
import { web as crmWeb } from "./crm/web/index.js";
import crmManifest from "./crm/wos-app.json" with { type: "json" };

export const BUNDLED_APPS: readonly BundledAppInput[] = [
  { manifest: coreManifest, server: coreServer, migrations: [{ file: "0001_core.sql", sql: core0001 }] },
  { manifest: contactsManifest, server: contactsServer },
  { manifest: crmManifest, server: crmServer, web: crmWeb, screens: [crmFeaturesScreen] },
];

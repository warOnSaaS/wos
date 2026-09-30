/** Assembles wOS Core from the environment: bundle, config, database, migrations, the HTTP app. */
import postgres from "postgres";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import { selfHostedActiveApps } from "../../../modules/core/src/active-apps.js";
import { type Bundle, loadBundle } from "../../../modules/core/src/bundle.js";
import { type MigrationDriver, MemoryMigrationDriver, planMigrations, runMigrations } from "../../../modules/core/src/migrations.js";
import { PostgresMigrationDriver } from "../../../modules/core/src/pg.js";
import { createCoreApp } from "./app.js";
import { type CoreConfig, loadConfig } from "./config.js";
import { mailerFromEnv } from "./mail.js";
import { PostgresStore } from "./pg-store.js";
import { type CoreStore, MemoryStore } from "./store.js";

type Env = Readonly<Record<string, string | undefined>>;
const log = (msg: string, fields?: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), msg, ...fields })}\n`);

/** The app ids whose schemas this environment migrates: the active set (self-hosted) or every hosted app (cloud). */
export function migratedAppIds(config: CoreConfig, bundle: Bundle): string[] {
  if (config.mode === "self_hosted") return selfHostedActiveApps(bundle, config.apps).map((a) => a.id);
  return [...bundle.apps.values()].filter((a) => a.manifest.hosting.hosted.supported).map((a) => a.manifest.app.id);
}

export type Core = { app: ReturnType<typeof createCoreApp>; config: CoreConfig; close: () => Promise<void> };

export async function bootCore(env: Env): Promise<Core> {
  const bundle = loadBundle(BUNDLED_APPS);
  const config = loadConfig(env, bundle);
  let store: CoreStore | null = null;
  let driver: MigrationDriver | null = null;
  let close = async () => {};
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 5, onnotice: () => {} });
    store = new PostgresStore(sql);
    driver = new PostgresMigrationDriver(sql);
    close = () => sql.end({ timeout: 5 });
  } else if (env.WOS_DEV_MEMORY === "true") {
    log("WOS_DEV_MEMORY=true: accounts and sessions are kept in memory and lost on restart");
    store = new MemoryStore();
    driver = new MemoryMigrationDriver();
  } else if (config.mode === "self_hosted") {
    throw new Error("CORE_DATABASE_URL is required (or WOS_DEV_MEMORY=true for a throwaway evaluation)");
  }
  if (driver) {
    const ids = migratedAppIds(config, bundle);
    if (config.migrateOnStart || driver instanceof MemoryMigrationDriver) {
      const applied = await runMigrations(bundle, ids, driver);
      if (applied.length > 0) log("migrations applied", { applied });
    } else {
      const plan = await planMigrations(bundle, ids, driver);
      const pending = plan.apps.flatMap((a) => a.pending.map((m) => `${a.app}/${m.file}`));
      if (plan.problems.length > 0 || pending.length > 0)
        throw new Error(
          `database not ready (pending: ${pending.join(", ") || "none"}; problems: ${plan.problems.join("; ") || "none"}): run the migrate command`,
        );
    }
  }
  const app = createCoreApp({
    config,
    bundle,
    store,
    mailer: config.mode === "self_hosted" ? mailerFromEnv(env, { log }) : null,
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    log,
  });
  log("wOS Core ready", { mode: config.mode, coreVersion: bundle.coreVersion, apps: config.apps });
  return { app, config, close };
}

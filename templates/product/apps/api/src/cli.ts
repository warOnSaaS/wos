/**
 * `node dist/cli.mjs migrate [--check]`: runs (or with --check only lists) the per-app schema migrations for this
 * environment against CORE_DATABASE_URL. On wOS Cloud the coordinator runs --check first, then migrate; nothing
 * migrates the hosted database silently.
 */
import postgres from "postgres";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import { loadBundle } from "../../../modules/core/src/bundle.js";
import { planMigrations, runMigrations } from "../../../modules/core/src/migrations.js";
import { PostgresMigrationDriver } from "../../../modules/core/src/pg.js";
import { migratedAppIds } from "./boot.js";
import { loadConfig } from "./config.js";

const [command, ...flags] = process.argv.slice(2);
if (command !== "migrate") {
  process.stderr.write("usage: cli.mjs migrate [--check]\n");
  process.exit(2);
}
const bundle = loadBundle(BUNDLED_APPS);
const config = loadConfig(process.env, bundle);
if (!config.databaseUrl) throw new Error("CORE_DATABASE_URL is required");
const sql = postgres(config.databaseUrl, { max: 1, onnotice: () => {} });
try {
  const driver = new PostgresMigrationDriver(sql);
  const ids = migratedAppIds(config, bundle);
  if (flags.includes("--check")) {
    const plan = await planMigrations(bundle, ids, driver);
    for (const a of plan.apps)
      process.stdout.write(`${a.app} (${a.schema}) ${a.version}: ${a.pending.map((m) => m.file).join(", ") || "up to date"}\n`);
    for (const p of plan.problems) process.stdout.write(`PROBLEM ${p}\n`);
    process.exitCode = plan.problems.length > 0 ? 1 : 0;
  } else {
    const applied = await runMigrations(bundle, ids, driver);
    process.stdout.write(applied.length > 0 ? `applied ${applied.join(", ")}\n` : "nothing to apply\n");
  }
} finally {
  await sql.end({ timeout: 5 });
}

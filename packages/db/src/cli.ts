#!/usr/bin/env node
/**
 * `wos-migrate [--check] [--dir <migrationsDir>] [--include-marked]` — the migration runner as a command, used by the
 * ship gate (D7). Connects with DATABASE_MIGRATION_URL only (never the app role).
 * Exit codes: 0 up to date / applied; 1 pending migrations in --check mode; 2 refused or failed; 64 usage.
 */
import { fileURLToPath } from "node:url";
import { isExcludedFromProduction, MigrationError, readMigrations, runMigrations } from "./index.js";

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: { log(line: string): void; error(line: string): void } = console,
): Promise<number> {
  let checkOnly = false;
  let includeMarked = false;
  let migrationsDir = DEFAULT_MIGRATIONS_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") checkOnly = true;
    else if (arg === "--dir" && argv[i + 1]) migrationsDir = argv[++i]!;
    else if (arg === "--include-marked") includeMarked = true;
    else {
      out.error(`usage: wos-migrate [--check] [--dir <migrationsDir>] [--include-marked] (unknown argument ${arg})`);
      return 64;
    }
  }
  const databaseUrl = env.DATABASE_MIGRATION_URL;
  if (!databaseUrl) {
    out.error("wOS migrate: DATABASE_MIGRATION_URL is not set (the owner connection; never the app role)");
    return 64;
  }
  try {
    // Files marked DO NOT APPLY TO PRODUCTION (0007, 0010: the draft protocol) are left out unless --include-marked.
    const report = await runMigrations({ databaseUrl, migrationsDir, checkOnly, excludeMarked: !includeMarked });
    if (!includeMarked) {
      for (const f of await readMigrations(migrationsDir))
        if (isExcludedFromProduction(f)) out.log(`excluded  ${f.version}_${f.name} (marked DO NOT APPLY TO PRODUCTION)`);
    }
    for (const v of report.alreadyApplied) out.log(`applied   ${v}`);
    for (const v of report.applied) out.log(`migrated  ${v}`);
    for (const v of report.pending) out.log(`pending   ${v}`);
    if (checkOnly && report.pending.length > 0) {
      out.log(`wOS migrate: ${report.pending.length} pending migration(s)`);
      return 1;
    }
    out.log(checkOnly ? "wOS migrate: up to date" : `wOS migrate: ${report.applied.length} migration(s) applied`);
    return 0;
  } catch (err) {
    if (err instanceof MigrationError) out.error(`wOS migrate refused (${err.code}): ${err.message}`);
    else out.error(`wOS migrate failed: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2), process.env).then((code) => process.exit(code));
}

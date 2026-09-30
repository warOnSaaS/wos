import { createHash } from "node:crypto";
/**
 * `@waronsaas/db/testing` (control-plane workstream). Scratch databases for tests that need Postgres. Tests run only when WOS_TEST_DATABASE_URL points at a
 * throwaway server's maintenance database (e.g. `postgres://postgres:test@localhost:55441/postgres`,
 * a Docker `postgres:17-alpine`). Never point it at a real project: every test creates and drops databases.
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { readMigrations, runMigrations } from "./index.js";

export const ADMIN_URL = process.env.WOS_TEST_DATABASE_URL ?? "";
export const HAS_DB = ADMIN_URL.length > 0;
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
export const APP_PASSWORD = "wos_app_test_password";
/**
 * Advisory lock taken on the maintenance database while the migrated template is checked, built and cloned (files run
 * in parallel). Only that needs it: creating an empty database or dropping a uniquely named one touches no shared
 * template. Holding it for every drop queued afterAll hooks behind every other file's create and drop (each DROP
 * DATABASE waits for an immediate checkpoint), past the hook timeout under a loaded full run: the file-level
 * "Hook timed out" failures.
 */
const CREATE_LOCK = 7_313_399;

export function urlFor(database: string, user?: { name: string; password: string }): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
}

async function withAdmin<T>(fn: (sql: postgres.Sql) => Promise<T>, options: { lock: boolean } = { lock: true }): Promise<T> {
  const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    if (options.lock) await sql`select pg_advisory_lock(${CREATE_LOCK})`;
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface ScratchDb {
  name: string;
  ownerUrl: string;
  drop(): Promise<void>;
}

/** An empty database (no migrations). */
export async function createEmptyDb(prefix = "wos_t"): Promise<ScratchDb> {
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  await withAdmin((sql) => sql.unsafe(`create database ${name}`), { lock: false });
  return { name, ownerUrl: urlFor(name), drop: () => dropDb(name) };
}

export async function dropDb(name: string): Promise<void> {
  await withAdmin(
    async (sql) => {
      await sql.unsafe(`drop database if exists ${name} with (force)`);
    },
    { lock: false },
  );
}

export interface MigratedDb extends ScratchDb {
  /** Connection as wos_app (NOBYPASSRLS, not the owner): what the control plane uses. */
  appUrl: string;
}

/** A database with every migration applied, cloned from a per-checksum template, plus wos_app able to log in. */
export async function createMigratedDb(prefix = "wos_t"): Promise<MigratedDb> {
  const files = await readMigrations(MIGRATIONS_DIR);
  // Integration glue: fingerprint EVERY migration (the old slice kept only the first four, so a fifth
  // migration silently reused a stale template database).
  const fingerprint = createHash("sha256")
    .update(files.map((f) => f.sha256).join(","))
    .digest("hex")
    .slice(0, 32);
  const template = `wos_tpl_${fingerprint}`;
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  await withAdmin(async (sql) => {
    const [exists] = await sql`select 1 as x from pg_database where datname = ${template}`;
    if (!exists) {
      const building = `${template}_build`;
      await sql.unsafe(`drop database if exists ${building} with (force)`);
      await sql.unsafe(`create database ${building}`);
      await runMigrations({ databaseUrl: urlFor(building), migrationsDir: MIGRATIONS_DIR, checkOnly: false });
      await sql.unsafe(`alter database ${building} rename to ${template}`);
    }
    await sql.unsafe(`create database ${name} template ${template}`);
    await sql.unsafe(`alter role wos_app with login password '${APP_PASSWORD}'`);
  });
  return {
    name,
    ownerUrl: urlFor(name),
    appUrl: urlFor(name, { name: "wos_app", password: APP_PASSWORD }),
    drop: () => dropDb(name),
  };
}

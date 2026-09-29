/**
 * @waronsaas/db — PostgreSQL schema (migrations/*.sql, owned by the Lead Architect) and the
 * migration runner (owned by the control-plane workstream). See docs/architecture/ARCHITECTURE.md "Database".
 *
 * Runner contract (implement exactly):
 *  1. Connect with DATABASE_MIGRATION_URL (role wos_owner). Never with the app role.
 *  2. Take pg_advisory_lock(7_313_370) so two runners cannot interleave.
 *  3. Ensure wos_meta.schema_migrations exists (created by 0000_meta.sql, which is idempotent).
 *  4. For every file migrations/NNNN_name.sql in lexical order:
 *       - sha256 the exact bytes; if a row exists with a different checksum -> abort (edited migration).
 *       - if absent: run the file inside one transaction together with the INSERT of its ledger row.
 *  5. Refuse to run if any applied version has no file (deleted migration).
 *  6. `--check` mode: exit 1 if anything is pending (used by the ship gate), apply nothing.
 * Production is migrated ONLY by the ship gate (D7), never by hand.
 */
import { NotImplementedError } from "@waronsaas/contracts";

export const MIGRATION_LOCK_KEY = 7_313_370 as const;
export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  version: string;
  name: string;
  sha256: string;
  sql: string;
}

export interface MigrationReport {
  applied: string[];
  pending: string[];
  alreadyApplied: string[];
}

export async function runMigrations(input: { databaseUrl: string; migrationsDir: string; checkOnly: boolean }): Promise<MigrationReport> {
  void input;
  throw new NotImplementedError("runMigrations");
}

/** Per-request connection helper contract: every transaction first runs
 *  `select set_config('wos.actor_id', $1, true), set_config('wos.actor_kind', $2, true)`
 *  so RLS policies can see who is acting (see SECURITY.md "Row-level security"). */
export type ActorKind = "account" | "maintainer" | "system" | "github" | "anonymous";

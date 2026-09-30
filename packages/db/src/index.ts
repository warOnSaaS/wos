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
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

export const MIGRATION_LOCK_KEY = 7_313_370 as const;
export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
/** The ledger migration. It is idempotent and executed on every (non-check) run before anything else. */
export const META_MIGRATION_VERSION = "0000" as const;

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

/** Why the runner refused to run. Every refusal names the offending migration(s). */
export class MigrationError extends Error {
  constructor(
    readonly code: "EDITED_MIGRATION" | "DELETED_MIGRATION" | "RENAMED_MIGRATION" | "BAD_FILENAME" | "DUPLICATE_VERSION",
    message: string,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export function sha256Checksum(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Reads and checksums every migration file in lexical order. Any other `.sql` file is a refusal. */
export async function readMigrations(migrationsDir: string): Promise<MigrationFile[]> {
  const names = (await readdir(migrationsDir)).filter((n) => n.endsWith(".sql")).sort();
  const files: MigrationFile[] = [];
  const seen = new Set<string>();
  for (const fileName of names) {
    const m = MIGRATION_FILE_PATTERN.exec(fileName);
    if (!m) throw new MigrationError("BAD_FILENAME", `migration file ${fileName} does not match NNNN_name.sql`);
    const version = m[1]!;
    if (seen.has(version)) throw new MigrationError("DUPLICATE_VERSION", `two migration files share version ${version}`);
    seen.add(version);
    const bytes = await readFile(join(migrationsDir, fileName));
    files.push({ version, name: m[2]!, sha256: sha256Checksum(bytes), sql: bytes.toString("utf8") });
  }
  return files;
}

interface LedgerRow {
  version: string;
  name: string;
  checksum: string;
}

/**
 * Applies pending migrations (or, with checkOnly, only reports them). Throws MigrationError when an
 * applied migration was edited, renamed or deleted; nothing is applied in that case.
 */
/** A migration whose header says it must never reach production (the draft protocol migrations 0007 and 0010). */
export const PRODUCTION_EXCLUSION_MARKER = "DO NOT APPLY TO PRODUCTION";

/** True when the marker appears in the file's leading comment block (the first 10 lines). */
export function isExcludedFromProduction(file: MigrationFile): boolean {
  return file.sql.split("\n", 10).some((line) => line.startsWith("--") && line.includes(PRODUCTION_EXCLUSION_MARKER));
}

export async function runMigrations(input: {
  databaseUrl: string;
  migrationsDir: string;
  checkOnly: boolean;
  /** Leave out files marked DO NOT APPLY TO PRODUCTION (the production CLI's default). */
  excludeMarked?: boolean;
}): Promise<MigrationReport> {
  const all = await readMigrations(input.migrationsDir);
  const files = input.excludeMarked ? all.filter((f) => !isExcludedFromProduction(f)) : all;
  // One connection: the session-level advisory lock must be held by the connection that migrates.
  const sql = postgres(input.databaseUrl, { max: 1, onnotice: () => {}, idle_timeout: 5, connect_timeout: 15 });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      return await migrateLocked(sql, files, input.checkOnly);
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function readLedger(sql: postgres.Sql): Promise<LedgerRow[] | null> {
  const [exists] = await sql<{ t: string | null }[]>`select to_regclass('wos_meta.schema_migrations')::text as t`;
  if (!exists?.t) return null;
  return sql<LedgerRow[]>`select version, name, checksum from wos_meta.schema_migrations order by version`;
}

async function migrateLocked(sql: postgres.Sql, files: MigrationFile[], checkOnly: boolean): Promise<MigrationReport> {
  const meta = files.find((f) => f.version === META_MIGRATION_VERSION);
  // Step 3: make sure the ledger exists. In check mode nothing is executed: a missing ledger means everything is pending.
  if (!checkOnly && meta) await sql.unsafe(meta.sql);
  const ledger = (await readLedger(sql)) ?? [];

  // Refusals come before any change: an edited, renamed or deleted migration stops the runner.
  const byVersion = new Map(files.map((f) => [f.version, f]));
  for (const row of ledger) {
    const file = byVersion.get(row.version);
    if (!file) throw new MigrationError("DELETED_MIGRATION", `applied migration ${row.version}_${row.name} has no file`);
    if (file.name !== row.name) {
      throw new MigrationError(
        "RENAMED_MIGRATION",
        `migration ${row.version} was applied as ${row.name} but the file is named ${file.name}`,
      );
    }
    if (file.sha256 !== row.checksum) {
      throw new MigrationError(
        "EDITED_MIGRATION",
        `migration ${row.version}_${row.name} was edited after it was applied (ledger ${row.checksum}, file ${file.sha256})`,
      );
    }
  }

  const appliedVersions = new Set(ledger.map((r) => r.version));
  const pending = files.filter((f) => !appliedVersions.has(f.version));
  const report: MigrationReport = {
    applied: [],
    pending: pending.map((f) => `${f.version}_${f.name}`),
    alreadyApplied: files.filter((f) => appliedVersions.has(f.version)).map((f) => `${f.version}_${f.name}`),
  };
  if (checkOnly) return report;

  for (const file of pending) {
    const started = performance.now();
    await sql.begin(async (tx) => {
      // 0000 already ran above (it is idempotent); running it again inside the ledger transaction is harmless.
      await tx.unsafe(file.sql);
      const executionMs = Math.max(0, Math.round(performance.now() - started));
      await tx`insert into wos_meta.schema_migrations (version, name, checksum, execution_ms)
               values (${file.version}, ${file.name}, ${file.sha256}, ${executionMs})`;
    });
    report.applied.push(`${file.version}_${file.name}`);
  }
  report.pending = [];
  return report;
}

/** Per-request connection helper contract: every transaction first runs
 *  `select set_config('wos.actor_id', $1, true), set_config('wos.actor_kind', $2, true)`
 *  so RLS policies can see who is acting (see SECURITY.md "Row-level security"). */
/** Mirrors the SQL: wos.is_privileged() is true for system, github and maintainer; events.actor_kind uses the first four. */
export type ActorKind = "contributor" | "maintainer" | "system" | "github" | "anonymous";

export interface ActorContext {
  kind: ActorKind;
  /** The acting account, or null for system/github/anonymous. */
  accountId: string | null;
}

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/**
 * Runs `fn` in one transaction whose first statement sets the transaction-local actor settings the
 * RLS policies read (`wos.actor_id()`, `wos.actor_kind()`). Transaction-local is what the Supabase
 * transaction pooler requires.
 */
export async function inTransaction<T>(sql: Sql, actor: ActorContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('wos.actor_id', ${actor.accountId ?? ""}, true), set_config('wos.actor_kind', ${actor.kind}, true)`;
    return fn(tx);
  });
  return result as T;
}

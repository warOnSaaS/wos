/**
 * Per-app schema migrations with a ledger (WOS-APP-PROTOCOL section 3). Each app owns one Postgres schema
 * (`core`, `app_<id>`); its forward-only files `NNNN_name.sql` run in file order, once, inside a transaction with
 * `search_path` set to that schema, and are recorded in `wos_meta.schema_migrations` with their sha256. A changed or
 * removed applied file stops the runner. Core runs this server-side for the apps active on this environment, never
 * from a client; `--check` lists what would run and changes nothing.
 */
import { createHash } from "node:crypto";
import { CORE_APP_ID } from "../../core-contracts/src/index.js";
import type { Migration } from "./app-module.js";
import type { Bundle } from "./bundle.js";

export type LedgerRow = { app: string; file: string; checksum: string; appVersion: string; appliedAt: string };

/** The database side, so the runner is the same against Postgres and in tests. */
export interface MigrationDriver {
  applied(): Promise<LedgerRow[]>;
  /** Creates the schema if needed. Idempotent. */
  ensureSchema(schema: string): Promise<void>;
  /** One transaction: search_path = schema, run the SQL, insert the ledger row (unique on app+file). */
  apply(schema: string, migration: Migration, row: Omit<LedgerRow, "appliedAt">): Promise<void>;
}

export type PlannedApp = { app: string; schema: string; version: string; pending: Migration[] };
export type MigrationPlan = { apps: PlannedApp[]; problems: string[] };

export const checksumOf = (sql: string) => `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`;

const FORBIDDEN: [RegExp, string][] = [
  [/\b(?:create|alter|drop)\s+schema\b/i, "creates or changes a schema (Core owns schemas)"],
  [/\b(?:create|alter|drop)\s+extension\b/i, "manages an extension (the operator's job)"],
  [/\bsearch_path\b/i, "changes search_path"],
  [/\bset\s+(?:local\s+)?(?:role|session\s+authorization)\b/i, "changes role"],
];
const QUALIFIED =
  /\b(?:table|index|view|sequence|function|procedure|type|trigger|domain|on|references|from|join|into|update)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?[a-z_]/gi;

/** Problems with one app's migration SQL: it may touch only its own schema (and read `core`). */
export function lintMigration(schema: string, m: Migration): string[] {
  const text = m.sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const [re, why] of FORBIDDEN) if (re.test(text)) out.push(`${m.file} ${why}`);
  for (const match of text.matchAll(QUALIFIED)) {
    const s = match[1]!.toLowerCase();
    if (s !== schema && s !== "core" && s !== "pg_catalog") out.push(`${m.file} reaches schema ${s}`);
  }
  return out;
}

/** Core first, then every app after the apps it requires. */
function activationOrder(bundle: Bundle, ids: readonly string[]): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    if (out.includes(id) || !ids.includes(id)) return;
    for (const d of bundle.apps.get(id)?.manifest.requires.apps ?? []) visit(d.id);
    out.push(id);
  };
  if (ids.includes(CORE_APP_ID)) visit(CORE_APP_ID);
  for (const id of [...ids].sort()) visit(id);
  return out;
}

export async function planMigrations(bundle: Bundle, activeIds: readonly string[], driver: MigrationDriver): Promise<MigrationPlan> {
  const ledger = await driver.applied();
  const problems: string[] = [];
  const apps: PlannedApp[] = [];
  for (const id of activationOrder(bundle, activeIds)) {
    const app = bundle.apps.get(id)!;
    const schema = app.manifest.data.schema;
    const done = new Map(ledger.filter((r) => r.app === id).map((r) => [r.file, r]));
    const files = new Set(app.migrations.map((m) => m.file));
    for (const f of done.keys()) if (!files.has(f)) problems.push(`${id}: applied migration ${f} is no longer shipped`);
    const pending: Migration[] = [];
    for (const m of app.migrations) {
      const row = done.get(m.file);
      if (row && row.checksum !== checksumOf(m.sql)) problems.push(`${id}: applied migration ${m.file} was edited (checksum differs)`);
      else if (!row) {
        problems.push(...lintMigration(schema, m).map((p) => `${id}: ${p}`));
        pending.push(m);
      }
    }
    apps.push({ app: id, schema, version: app.manifest.app.version, pending });
  }
  return { apps, problems };
}

/** Applies the plan; refuses to start while any problem exists. Returns the files applied. */
export async function runMigrations(bundle: Bundle, activeIds: readonly string[], driver: MigrationDriver): Promise<string[]> {
  const plan = await planMigrations(bundle, activeIds, driver);
  if (plan.problems.length > 0) throw new Error(`migrations refused:\n  ${plan.problems.join("\n  ")}`);
  const applied: string[] = [];
  for (const a of plan.apps) {
    await driver.ensureSchema(a.schema);
    for (const m of a.pending) {
      await driver.apply(a.schema, m, { app: a.app, file: m.file, checksum: checksumOf(m.sql), appVersion: a.version });
      applied.push(`${a.app}/${m.file}`);
    }
  }
  return applied;
}

/** An in-memory driver: records what ran. For tests and for a Core started without a database. */
export class MemoryMigrationDriver implements MigrationDriver {
  readonly schemas = new Set<string>();
  readonly rows: LedgerRow[] = [];
  readonly executed: { schema: string; file: string; sql: string }[] = [];
  async applied() {
    return [...this.rows];
  }
  async ensureSchema(schema: string) {
    this.schemas.add(schema);
  }
  async apply(schema: string, m: Migration, row: Omit<LedgerRow, "appliedAt">) {
    if (this.rows.some((r) => r.app === row.app && r.file === row.file)) throw new Error(`duplicate ledger row ${row.app}/${row.file}`);
    this.executed.push({ schema, file: m.file, sql: m.sql });
    this.rows.push({ ...row, appliedAt: new Date().toISOString() });
  }
}

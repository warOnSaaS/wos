/** The Postgres migration driver. The ledger lives in `wos_meta.schema_migrations`, created on first use. */
import type { Sql } from "postgres";
import type { Migration } from "./app-module.js";
import type { LedgerRow, MigrationDriver } from "./migrations.js";

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad identifier ${name}`);
  return `"${name}"`;
};

export class PostgresMigrationDriver implements MigrationDriver {
  constructor(private readonly sql: Sql) {}

  private async ensureLedger() {
    await this.sql.unsafe(`
      create schema if not exists wos_meta;
      create table if not exists wos_meta.schema_migrations (
        app text not null,
        file text not null,
        checksum text not null,
        app_version text not null,
        applied_at timestamptz not null default now(),
        primary key (app, file)
      );`);
  }

  async applied(): Promise<LedgerRow[]> {
    await this.ensureLedger();
    const rows = await this.sql<{ app: string; file: string; checksum: string; app_version: string; applied_at: Date }[]>`
      select app, file, checksum, app_version, applied_at from wos_meta.schema_migrations order by app, file`;
    return rows.map((r) => ({
      app: r.app,
      file: r.file,
      checksum: r.checksum,
      appVersion: r.app_version,
      appliedAt: r.applied_at.toISOString(),
    }));
  }

  async ensureSchema(schema: string) {
    await this.sql.unsafe(`create schema if not exists ${ident(schema)}`);
  }

  async apply(schema: string, m: Migration, row: Omit<LedgerRow, "appliedAt">) {
    await this.ensureLedger();
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('wos_meta.schema_migrations'))`;
      const done = await tx`select 1 from wos_meta.schema_migrations where app = ${row.app} and file = ${row.file}`;
      if (done.length > 0) return; // another Core applied it while this one waited for the lock
      await tx.unsafe(`set local search_path to ${ident(schema)}`);
      await tx.unsafe(m.sql);
      await tx`insert into wos_meta.schema_migrations (app, file, checksum, app_version)
               values (${row.app}, ${row.file}, ${row.checksum}, ${row.appVersion})`;
    });
  }
}

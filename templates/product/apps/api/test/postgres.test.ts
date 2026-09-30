/**
 * Against a real Postgres when WOS_TEST_DATABASE_URL is set (the full-suite command in AGENTS.md); skipped otherwise.
 * Uses its own throwaway database, dropped afterwards.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import { loadBundle } from "../../../modules/core/src/bundle.js";
import { planMigrations, runMigrations } from "../../../modules/core/src/migrations.js";
import { PostgresMigrationDriver } from "../../../modules/core/src/pg.js";
import { createCoreApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryMailer } from "../src/mail.js";
import { PostgresStore } from "../src/pg-store.js";
import { bearer, forbiddenFetch, SECRET, signInLocal } from "./support.js";

const adminUrl = process.env.WOS_TEST_DATABASE_URL;

describe.skipIf(!adminUrl)("suite-shell Core on Postgres", () => {
  const name = `wos_core_test_${randomBytes(4).toString("hex")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${name}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${name}`;
    sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin?.unsafe(`drop database if exists ${name} with (force)`);
    await admin?.end({ timeout: 5 });
  });

  const crm = BUNDLED_APPS.find((a) => (a.manifest as { app: { id: string } }).app.id === "crm")!;
  const m = crm.manifest as { data: object };
  const withCrmMigration = loadBundle(
    BUNDLED_APPS.map((a) =>
      a === crm
        ? {
            ...crm,
            manifest: { ...m, data: { ...m.data, migrations: "./migrations" } },
            migrations: [
              {
                file: "0001_probe.sql",
                sql: "create table probe (id uuid primary key, organization_id uuid not null references core.organizations (id));",
              },
            ],
          }
        : a,
    ),
  );

  it("applies core and app migrations into their own schemas, records the ledger, and is idempotent", async () => {
    const driver = new PostgresMigrationDriver(sql);
    expect(await runMigrations(withCrmMigration, ["core", "contacts", "crm"], driver)).toEqual([
      "core/0001_core.sql",
      "crm/0001_probe.sql",
    ]);
    const tables = await sql<{ s: string; t: string }[]>`
      select table_schema as s, table_name as t from information_schema.tables
       where table_schema in ('core', 'app_crm', 'app_contacts') order by 1, 2`;
    expect(tables.map((r) => `${r.s}.${r.t}`)).toEqual([
      "app_crm.probe",
      "core.environment",
      "core.memberships",
      "core.organizations",
      "core.sessions",
      "core.signin_requests",
      "core.users",
    ]);
    const [{ n }] = (await sql`select count(*)::int as n from wos_meta.schema_migrations`) as unknown as [{ n: number }];
    expect(n).toBe(2);
    expect(await runMigrations(withCrmMigration, ["core", "contacts", "crm"], driver)).toEqual([]);
    expect((await planMigrations(withCrmMigration, ["core", "contacts", "crm"], driver)).problems).toEqual([]);
  });

  it("serves local sign-in and ActiveApps from the Postgres store", async () => {
    const bundle = loadBundle(BUNDLED_APPS);
    const config = loadConfig(
      { WOS_PUBLIC_URL: "https://wos.example.test", WOS_CORE_SECRET: SECRET, WOS_OWNER_EMAIL: "owner@example.test", WOS_APPS: "crm" },
      bundle,
    );
    const mailer = new MemoryMailer();
    const app = createCoreApp({
      config,
      bundle,
      store: new PostgresStore(sql),
      mailer,
      fetch: forbiddenFetch([]),
      now: () => new Date(),
      log: () => {},
    });
    const owner = await signInLocal(app, mailer, "owner@example.test");
    expect(owner.role).toBe("owner");
    const res = await app.request("/v1/core/apps", bearer(owner.token));
    expect(((await res.json()) as { apps: { id: string }[] }).apps.map((a) => a.id)).toEqual(["contacts", "core", "crm"]);
    const d1 = (await (await app.request("/.well-known/wos-environment")).json()) as { environmentId: string };
    const [row] = await sql<{ id: string }[]>`select id from core.environment`;
    expect(d1.environmentId).toBe(row!.id);
  });
});

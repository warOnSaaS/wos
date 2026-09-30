import { describe, expect, it } from "vitest";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import { selfHostedActiveApps } from "../../../modules/core/src/active-apps.js";
import { loadBundle } from "../../../modules/core/src/bundle.js";
import { checksumOf, lintMigration, MemoryMigrationDriver, planMigrations, runMigrations } from "../../../modules/core/src/migrations.js";
import { appForUiPath, navigationFor } from "../../../modules/core/src/navigation.js";

const bundle = loadBundle(BUNDLED_APPS);

describe("suite-shell Core: navigation registry", () => {
  it("merges active manifests, filtered by surface and role, ordered by `order`", () => {
    const active = selfHostedActiveApps(bundle, ["crm"]);
    expect(navigationFor(active, "web", "member").map((n) => [n.id, n.route])).toEqual([
      ["core.apps", "/core/apps"],
      ["crm.home", "/crm"],
    ]);
    expect(navigationFor(active, "desktop", "member").map((n) => n.id)).toEqual(["crm.home"]);
    expect(navigationFor(selfHostedActiveApps(bundle, []), "web", "member").map((n) => n.id)).toEqual(["core.apps"]);
  });

  it("hides entries whose permission the role lacks", () => {
    const active = selfHostedActiveApps(bundle, ["crm"]).map((a) =>
      a.id === "crm"
        ? { ...a, manifest: { ...a.manifest, permissions: a.manifest.permissions.map((p) => ({ ...p, grantedTo: ["owner" as const] })) } }
        : a,
    );
    expect(navigationFor(active, "web", "member").map((n) => n.id)).toEqual(["core.apps"]);
    expect(navigationFor(active, "web", "owner").map((n) => n.id)).toEqual(["core.apps", "crm.home"]);
  });

  it("maps a UI path to the active app that owns it", () => {
    const active = selfHostedActiveApps(bundle, ["crm"]);
    expect(appForUiPath(active, "/crm")?.id).toBe("crm");
    expect(appForUiPath(active, "/crm/anything")?.id).toBe("crm");
    expect(appForUiPath(active, "/crmx")).toBeNull();
  });
});

describe("suite-shell Core: per-app schema migrations with a ledger", () => {
  const withMigrations = (sqls: Record<string, string>) => {
    const crm = BUNDLED_APPS.find((a) => (a.manifest as { app: { id: string } }).app.id === "crm")!;
    const m = crm.manifest as { data: object };
    const next = {
      ...crm,
      manifest: { ...m, data: { ...m.data, migrations: "./migrations" } },
      migrations: Object.entries(sqls).map(([file, sql]) => ({ file, sql })),
    };
    return loadBundle(BUNDLED_APPS.map((a) => (a === crm ? next : a)));
  };

  it("runs core first, then each app in its own schema, once, and records the ledger", async () => {
    const b = withMigrations({ "0002_b.sql": "create table b (id int);", "0001_a.sql": "create table a (id int);" });
    const driver = new MemoryMigrationDriver();
    const applied = await runMigrations(b, ["core", "contacts", "crm"], driver);
    expect(applied).toEqual(["core/0001_core.sql", "crm/0001_a.sql", "crm/0002_b.sql"]);
    expect(driver.executed.map((x) => [x.schema, x.file])).toEqual([
      ["core", "0001_core.sql"],
      ["app_crm", "0001_a.sql"],
      ["app_crm", "0002_b.sql"],
    ]);
    expect([...driver.schemas].sort()).toEqual(["app_contacts", "app_crm", "core"]);
    expect(driver.rows.find((r) => r.file === "0001_a.sql")).toMatchObject({
      app: "crm",
      appVersion: "0.1.0",
      checksum: checksumOf("create table a (id int);"),
    });
    expect(await runMigrations(b, ["core", "contacts", "crm"], driver)).toEqual([]);
  });

  it("only active apps are migrated", async () => {
    const driver = new MemoryMigrationDriver();
    await runMigrations(withMigrations({ "0001_a.sql": "create table a (id int);" }), ["core"], driver);
    expect(driver.executed.map((x) => x.file)).toEqual(["0001_core.sql"]);
  });

  it("refuses an edited or removed applied migration", async () => {
    const driver = new MemoryMigrationDriver();
    await runMigrations(withMigrations({ "0001_a.sql": "create table a (id int);" }), ["core", "contacts", "crm"], driver);
    const edited = withMigrations({ "0001_a.sql": "create table a (id bigint);" });
    await expect(runMigrations(edited, ["core", "contacts", "crm"], driver)).rejects.toThrow(/edited/);
    const removed = withMigrations({ "0002_b.sql": "create table b (id int);" });
    const plan = await planMigrations(removed, ["core", "contacts", "crm"], driver);
    expect(plan.problems).toContain("crm: applied migration 0001_a.sql is no longer shipped");
  });

  it("an app's migration may touch only its own schema", () => {
    const lint = (sql: string) => lintMigration("app_crm", { file: "0001_x.sql", sql });
    expect(lint("create table deals (id uuid primary key, org uuid references core.organizations (id));")).toEqual([]);
    expect(lint("create table app_contacts.people (id int);")).toEqual(["0001_x.sql reaches schema app_contacts"]);
    expect(lint("insert into app_contacts.people values (1);")).toEqual(["0001_x.sql reaches schema app_contacts"]);
    expect(lint("create schema x;")).toHaveLength(1);
    expect(lint("set search_path to public;")).toHaveLength(1);
    expect(lint("-- create table app_contacts.x\ncreate table y (id int);")).toEqual([]);
  });
});

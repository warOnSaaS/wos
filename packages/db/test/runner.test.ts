import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm, unlink, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { MigrationError, readMigrations, runMigrations } from "../src/index.js";
import { runCli } from "../src/cli.js";
import { createEmptyDb, HAS_DB, MIGRATIONS_DIR, type ScratchDb } from "./support/pg.js";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function copyMigrations(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wos-migrations-"));
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  return dir;
}

async function query<T extends Record<string, unknown>>(url: string, text: string): Promise<T[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const silent = { log: () => {}, error: () => {} };
// Integration glue: the list follows the migrations directory (0004 was added at the Wave 1 gate).
const ALL = [
  "0000_meta",
  "0001_init",
  "0002_backstops",
  "0003_subjects_and_runs",
  "0004_manifest_per_lease",
  "0005_surfaces",
  "0006_one_product",
  "0007_proof_of_contribution",
  // 0008 is B-0007-control-plane.
  "0008_build_release",
  // 0009 is B-0009-control-plane (web_app client kind; bundle hash exactly with a package).
  "0009_web_app_client",
  // 0010 is ws/protocol's versioned additions (D61 economy side, D60 delta, D63).
  "0010_bugs_and_maintenance",
  // 0011 is B-0001-mobile-runtime (production).
  "0011_mobile_client",
  // 0012 is Amendment 04 (production).
  "0012_identity_and_organizations",
  // 0013 is the first-run fixes (production): repository case, D53 human seat, versions after an abandon.
  "0013_review_fallback_and_first_run",
  // 0014 is D67 (production): the bootstrap founder's human seat under review-policy.v2.
  "0014_bootstrap_founder_human_seat",
  // 0015 is D69 candidate trials and the opencode provider (production).
  "0015_candidate_trials",
  // 0016 is D71 (production): solo bootstrap under review-policy.v3.
  "0016_solo_bootstrap",
];

/** The first number after the last real migration: the runner tests add throwaway files there. */
const NEXT = String(Number(ALL.at(-1)!.slice(0, 4)) + 1).padStart(4, "0");

describe("migration files", () => {
  it("are named NNNN_name.sql and checksummed as sha256", async () => {
    const files = await readMigrations(MIGRATIONS_DIR);
    expect(files.map((f) => f.version)).toEqual(ALL.map((n) => n.slice(0, 4)));
    for (const f of files) expect(f.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe.skipIf(!HAS_DB)("ship-gate-and-migrations: migration runner (Docker Postgres)", () => {
  const dbs: ScratchDb[] = [];
  const dirs: string[] = [];
  const fresh = async () => {
    const db = await createEmptyDb("wos_runner");
    dbs.push(db);
    return db;
  };
  const dir = async () => {
    const d = await copyMigrations();
    dirs.push(d);
    return d;
  };
  // Dropped together: each DROP DATABASE waits for an immediate checkpoint, and concurrent drops share one; one by one
  // they outlasted the hook timeout under a loaded full run.
  afterAll(async () => {
    await Promise.all(dbs.map((db) => db.drop()));
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  }, 120_000);

  it("ship-gate-and-migrations R-001 applies 0000 and 0001 to an empty database, each with a ledger row, and is idempotent", async () => {
    const db = await fresh();
    const first = await runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: MIGRATIONS_DIR, checkOnly: false });
    expect(first.applied).toEqual(ALL);
    expect(first.pending).toEqual([]);
    const ledger = await query<{ version: string; checksum: string }>(
      db.ownerUrl,
      "select version, checksum from wos_meta.schema_migrations order by version",
    );
    const files = await readMigrations(MIGRATIONS_DIR);
    expect(ledger.map((r) => [r.version, r.checksum])).toEqual(files.map((f) => [f.version, f.sha256]));
    const targets = await query<{ n: string }>(db.ownerUrl, "select count(*)::text as n from wos.targets");
    expect(targets[0]!.n).toBe("11");

    const second = await runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: MIGRATIONS_DIR, checkOnly: false });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(ALL);
  });

  it("check mode reports pending migrations and changes nothing", async () => {
    const db = await fresh();
    const report = await runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: MIGRATIONS_DIR, checkOnly: true });
    expect(report.pending).toEqual(ALL);
    const rows = await query<{ t: string | null }>(db.ownerUrl, "select to_regclass('wos_meta.schema_migrations')::text as t");
    expect(rows[0]!.t).toBeNull();
  });

  it("refuses an edited migration and applies nothing", async () => {
    const db = await fresh();
    const d = await dir();
    await runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: d, checkOnly: false });
    await appendFile(join(d, "0001_init.sql"), "\n-- edited after it was applied\n");
    await writeFile(join(d, `${NEXT}_more.sql`), "create table wos.never_created (id int);\n");
    const err = await runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: d, checkOnly: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).code).toBe("EDITED_MIGRATION");
    const rows = await query<{ t: string | null }>(db.ownerUrl, "select to_regclass('wos.never_created')::text as t");
    expect(rows[0]!.t).toBeNull();
    // Check mode refuses too (the ship gate must stop), and the CLI exits 2.
    await expect(runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: d, checkOnly: true })).rejects.toThrow(/edited/);
    expect(await runCli(["--check", "--dir", d], { DATABASE_MIGRATION_URL: db.ownerUrl }, silent)).toBe(2);
  });

  it("refuses when an applied migration's file was deleted", async () => {
    const db = await fresh();
    const d = await dir();
    await writeFile(join(d, `${NEXT}_extra.sql`), "create table wos.extra (id int);\n");
    await runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: d, checkOnly: false });
    await unlink(join(d, `${NEXT}_extra.sql`));
    await expect(runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: d, checkOnly: false })).rejects.toMatchObject({
      code: "DELETED_MIGRATION",
    });
  });

  it("runs each migration in one transaction with its ledger row: a failing migration leaves no trace", async () => {
    const db = await fresh();
    const d = await dir();
    await writeFile(join(d, `${NEXT}_broken.sql`), "create table wos.half_done (id int);\nselect * from wos.does_not_exist;\n");
    await expect(runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: d, checkOnly: false })).rejects.toThrow();
    const rows = await query<{ t: string | null; n: string }>(
      db.ownerUrl,
      `select to_regclass('wos.half_done')::text as t, (select count(*)::text from wos_meta.schema_migrations where version = '${NEXT}') as n`,
    );
    expect(rows[0]).toEqual({ t: null, n: "0" });
  });

  it("serialises concurrent runners with the advisory lock: each migration is applied exactly once", async () => {
    const db = await fresh();
    const reports = await Promise.all(
      [1, 2, 3].map(() => runMigrations({ databaseUrl: db.ownerUrl, migrationsDir: MIGRATIONS_DIR, checkOnly: false })),
    );
    expect(reports.flatMap((r) => r.applied).sort()).toEqual(ALL);
  });

  describe("the CLI (built dist/cli.js)", () => {
    let db: ScratchDb;
    beforeAll(async () => {
      db = await fresh();
    });
    const run = (args: string[]) =>
      spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, DATABASE_MIGRATION_URL: db.ownerUrl }, encoding: "utf8" });

    it("ship-gate-and-migrations R-001 --check exits 1 while migrations are pending, 0 once applied", () => {
      const pending = run(["--check"]);
      expect(pending.stdout).toContain("pending   0001_init");
      expect(pending.status).toBe(1);
      const apply = run([]);
      expect(apply.status).toBe(0);
      expect(apply.stdout).toContain("migrated  0001_init");
      const clean = run(["--check"]);
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain("up to date");
    });

    it("refuses to run without DATABASE_MIGRATION_URL", async () => {
      expect(await runCli(["--check"], {}, silent)).toBe(64);
    });
  });
});

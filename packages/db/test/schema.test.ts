import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AbuStates,
  AgentRole,
  AppFeatureStates,
  AttemptStates,
  BlockerStates,
  ContributionStates,
  DocumentStates,
  LeaseStates,
  LedgerEntryKind,
  ProposalStates,
  RewardCategory,
  RoundStates,
  Surface,
  TaskKind,
  TaskStates,
} from "../../contracts/src/index.js";

const sql = readFileSync(fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)), "utf8");

/** The CHECK (...) value list that follows `create table wos.<table> (` ... `<column> text not null check (<column> in (`. */
function checkValues(table: string, column: string): string[] {
  const start = sql.indexOf(`create table wos.${table} (`);
  expect(start, `table ${table}`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n);", start);
  const body = sql.slice(start, end);
  const m = new RegExp(`\\n\\s+${column}\\s+text[^\\n]*check \\(${column} in \\(([^)]*)\\)`).exec(body);
  expect(m, `${table}.${column} check`).not.toBeNull();
  return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

const same = (a: readonly string[]) => [...a].sort();

describe("SQL CHECK lists mirror the contracts", () => {
  it.each([
    ["tasks", "state", TaskStates],
    ["tasks", "kind", TaskKind.options],
    ["tasks", "role", AgentRole.options],
    ["leases", "state", LeaseStates],
    ["documents", "state", DocumentStates],
    ["rounds", "state", RoundStates],
    ["abus", "state", AbuStates],
    ["attempts", "state", AttemptStates],
    ["app_features", "state", AppFeatureStates],
    ["contributions", "state", ContributionStates],
    ["contributions", "category", RewardCategory.options],
    ["ledger_entries", "kind", LedgerEntryKind.options],
    ["proposals", "state", ProposalStates],
    ["blockers", "state", BlockerStates],
  ] as const)("%s.%s", (table, column, values) => {
    expect(checkValues(table, column)).toEqual(same(values));
  });

  it("every append-only table has triggers and no UPDATE grant", () => {
    const list = /foreach t in array array\[([\s\S]*?)\] loop\s+execute format\('create trigger %I before update or delete/.exec(sql);
    expect(list).not.toBeNull();
    const appendOnly = [...list![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    expect(appendOnly).toEqual(
      expect.arrayContaining(["ledger_entries", "events", "context_manifests", "reviews", "provenance_records", "progress_snapshots"]),
    );
    const updateGrant = /grant select, insert, update on([\s\S]*?)to wos_app;/.exec(sql)![1]!;
    for (const t of appendOnly) expect(updateGrant.includes(`wos.${t},`) || updateGrant.includes(`wos.${t}\n`), t).toBe(false);
  });

  it("surface CHECK lists in 0005 mirror Surface (D13)", () => {
    const s5 = readFileSync(fileURLToPath(new URL("../migrations/0005_surfaces.sql", import.meta.url)), "utf8");
    const lists = [...s5.matchAll(/surface in \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort());
    expect(lists.length).toBeGreaterThanOrEqual(4);
    for (const l of lists) expect(l).toEqual([...Surface.options].sort());
  });

  it("enables RLS on every table", () => {
    expect(sql).toMatch(
      /for t in select tablename from pg_tables where schemaname = 'wos' loop\s+execute format\('alter table wos\.%I enable row level security'/,
    );
  });
});

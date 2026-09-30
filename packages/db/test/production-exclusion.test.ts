import { describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_DIR } from "../src/cli.js";
import { isExcludedFromProduction, readMigrations } from "../src/index.js";

describe("production exclusion marker", () => {
  it("excludes exactly the draft protocol migrations 0007 and 0010 from the production runner", async () => {
    const files = await readMigrations(DEFAULT_MIGRATIONS_DIR);
    const excluded = files.filter(isExcludedFromProduction).map((f) => f.version);
    expect(excluded).toEqual(["0007", "0010"]);
  });

  it("only reads the marker from the leading comment block", () => {
    const f = (sql: string) => ({ version: "9999", name: "x", sha256: "sha256:0", sql });
    expect(isExcludedFromProduction(f("-- header\n-- DO NOT APPLY TO PRODUCTION\nselect 1;"))).toBe(true);
    expect(isExcludedFromProduction(f("-- header\nselect 'DO NOT APPLY TO PRODUCTION';"))).toBe(false);
  });
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeOverlap, crossCheck, SCAN_LABEL, Scan, TARGETS, Vocabulary } from "../tools/scans/schema.js";

// Target scans (docs/scans): a table of contents per Sniper List target, never a roadmap, never reviewed,
// never part of any progress number. See docs/scans/README.md.
const root = join(import.meta.dirname, "..");
const dir = join(root, "docs/scans");
const readJson = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("docs/scans", () => {
  const vocabulary = Vocabulary.parse(readJson("vocabulary.json"));
  const ids = new Set(vocabulary.capabilities.map((c) => c.id));

  it.each(TARGETS.map((t) => t.slug))("%s.json is a valid, unreviewed scan using only vocabulary ids", (slug) => {
    const scan = Scan.parse(readJson(`${slug}.json`));
    expect(scan.target.slug).toBe(slug);
    expect(scan.label).toBe(SCAN_LABEL);
    expect(scan.reviewed).toBe(false);
    expect(scan.countsTowardProgress).toBe(false);
    for (const c of scan.capabilities) {
      expect(ids.has(c.id), `${slug}: ${c.id} not in vocabulary`).toBe(true);
      expect(c.sources.length, `${slug}: ${c.id} has no source`).toBeGreaterThanOrEqual(1);
    }
    expect(crossCheck(scan, vocabulary)).toEqual([]);
    // Getting data out: every recorded fact carries a source.
    const d = scan.dataExport;
    for (const item of [...d.exportOptions, ...d.apis, ...d.hardToExtract, ...d.migrationTools, d.auth])
      expect(item.sources.length, `${slug}: data-out item without a source`).toBeGreaterThanOrEqual(1);
    if (d.rateLimits.summary !== null) expect(d.rateLimits.sources.length).toBeGreaterThanOrEqual(1);
    const md = readFileSync(join(dir, `${slug}.md`), "utf8");
    expect(md).toContain(SCAN_LABEL);
    expect(md).toContain("## Getting data out");
  });

  it("vocabulary ids are unique kebab-case", () => {
    expect(ids.size).toBe(vocabulary.capabilities.length);
  });

  it("overlap.json is the matrix of the committed scans, marked unreviewed and outside progress", () => {
    const scans = TARGETS.map((t) => Scan.parse(readJson(`${t.slug}.json`)));
    const overlap = readJson("overlap.json");
    expect(overlap).toEqual(computeOverlap(scans, vocabulary));
    expect(overlap).toMatchObject({ reviewed: false, countsTowardProgress: false, label: SCAN_LABEL });
    expect(readFileSync(join(dir, "OVERLAP.md"), "utf8")).toContain("## Getting data out: across targets");
  });

  it("every generated file matches tools/scans/build.ts output", () => {
    // Throws (non-zero exit) if any generated .md or overlap.json is stale.
    execFileSync(process.execPath, [join(root, "tools/scans/build.ts"), "--check"], { cwd: root, encoding: "utf8" });
  });

  it("the schema refuses a capability without a source or outside the vocabulary", () => {
    const scan = Scan.parse(readJson(`${TARGETS[0].slug}.json`));
    const first = scan.capabilities[0]!;
    const noSource = { ...scan, capabilities: [{ ...first, sources: [] }, ...scan.capabilities.slice(1)] };
    expect(Scan.safeParse(noSource).success).toBe(false);
    const unknown = { ...scan, capabilities: [{ ...first, id: "not-a-vocabulary-id" }, ...scan.capabilities.slice(1)] };
    expect(crossCheck(Scan.parse(unknown), vocabulary)).not.toEqual([]);
    expect(Scan.safeParse({ ...scan, reviewed: true }).success).toBe(false);
    expect(Scan.safeParse({ ...scan, countsTowardProgress: true }).success).toBe(false);
    const noExportSource = { ...scan, dataExport: { ...scan.dataExport, auth: { ...scan.dataExport.auth, sources: [] } } };
    expect(Scan.safeParse(noExportSource).success).toBe(false);
  });
});

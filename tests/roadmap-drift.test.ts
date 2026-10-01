/** tools/experiments/roadmap-drift/compare.ts: deterministic comparison of two roadmaps (no model judging). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_POLICY } from "@waronsaas/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { roadmapFiles } from "../services/control-plane/test/support/roadmap-fixture.js";
import { compareSides, loadSide, renderCompareMd, spearman } from "../tools/experiments/roadmap-drift/compare.js";

const root = mkdtempSync(join(tmpdir(), "wos-drift-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const write = (base: string, files: Array<{ path: string; content: string }>) => {
  for (const f of files) {
    mkdirSync(dirname(join(base, f.path)), { recursive: true });
    writeFileSync(join(base, f.path), f.content);
  }
  return base;
};
const side = (name: string, files: Array<{ path: string; content: string }>) => write(join(root, name), files);

describe("roadmap drift compare", () => {
  it("identical roadmaps match fully, with the D72 scan coverage, rubric and weight statistics", () => {
    const a = side("a", roadmapFiles({ target: "salesforce" }));
    const b = side("b", roadmapFiles({ target: "salesforce" }));
    const c = compareSides(loadSide(a, "salesforce", "A"), loadSide(b, "salesforce", "B"), "salesforce");
    expect(c.a.schemaViolations).toEqual([]);
    expect(c.a.validation).toEqual([]);
    expect(c.a.methodValidation).toEqual([]);
    expect(c.a.scanCoverage).toEqual({ total: 52, placed: 52, excluded: 0, unaccounted: [] });
    expect(c.a.rubric).toEqual({ declared: "wos-weight-rubric.v1", scored: 1, weightsFollow: true });
    expect(c.overlap.inventoryBySourceUrlAndTitle).toEqual({ both: 2, onlyA: [], onlyB: [] });
    expect(c.overlap.scanIdsInMatchedCapabilities).toEqual({ comparable: 52, same: 52 });
    expect(c.weights).toMatchObject({ matchedCapabilities: 1, meanAbsDeltaBp: 0, perScanId: { comparable: 52, meanAbsDeltaBp: 0 } });
    expect(c.a.migration.classes.every((m) => m.present && m.complete)).toBe(true);
    expect(c.a.inventory.placeholderSourceUrls).toEqual(["https://example.com/docs"]);
    expect(c.a.fetchLog).toBeNull();
    const md = renderCompareMd(c);
    expect(md).toContain("A textual difference is not");
    expect(renderCompareMd(c)).toBe(md);
  });

  it("a shadow run's fetch log: inventory sources fetched and the required reading read", () => {
    const required = AGENT_POLICY.roadmapMethod!.targets.salesforce!.requiredReading;
    const dir = side("shadow", roadmapFiles({ target: "salesforce" }));
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({
        fetches: [
          { kind: "fetch", target: "https://example.com/docs/" },
          { kind: "fetch", target: required[0]!.url },
          { kind: "search", target: "q" },
        ],
      }),
    );
    const c = compareSides(loadSide(dir, "salesforce"), loadSide(dir, "salesforce"), "salesforce");
    expect(c.a.fetchLog).toMatchObject({ fetches: 2, searches: 1, inventorySourcesFetched: 1, inventorySources: 1 });
    expect(c.a.fetchLog!.requiredReadingFetched).toEqual([required[0]!.kind]);
  });

  it("reads a side from a git ref of a product checkout (<repo>@<ref>)", () => {
    const repo = join(root, "product");
    mkdirSync(repo);
    const git = (...a: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { stdio: "pipe" });
    git("init", "-q", "-b", "main");
    write(repo, roadmapFiles({ target: "salesforce" }));
    git("add", "-A");
    git("commit", "-qm", "roadmap");
    git("branch", "wos/roadmap/salesforce/v1");
    const s = loadSide(`${repo}@wos/roadmap/salesforce/v1`, "salesforce");
    expect(s.schemaViolations).toEqual([]);
    expect(s.roadmap?.capabilities).toHaveLength(1);
    expect(s.catalog.size).toBe(2);
    expect(s.label).toBe("wos/roadmap/salesforce/v1");
  });

  it("a broken side reports its schema violations; Spearman handles ties and refuses too few pairs", () => {
    const a = side("a2", roadmapFiles({ target: "salesforce" }));
    const broken = side("broken", [{ path: "roadmaps/salesforce/ROADMAP.yaml", content: "schema: wos-roadmap.v1\n" }]);
    const d = compareSides(loadSide(a, "salesforce"), loadSide(broken, "salesforce"), "salesforce");
    expect(d.b.schemaViolations).toContain("INVENTORY.yaml: missing");
    expect(d.b.validation).toBeNull();
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 2], [1, 2, 3])).toBeCloseTo(0.866, 3);
  });
});

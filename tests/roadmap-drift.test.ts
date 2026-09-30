/** tools/experiments/roadmap-drift/compare.ts: deterministic comparison of two roadmaps (no model judging). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { roadmapFiles } from "../services/control-plane/test/support/roadmap-fixture.js";
import { compareSides, loadSide, renderCompareMd } from "../tools/experiments/roadmap-drift/compare.js";

const root = mkdtempSync(join(tmpdir(), "wos-drift-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const side = (name: string, files: Array<{ path: string; content: string }>) => {
  for (const f of files) {
    mkdirSync(dirname(join(root, name, f.path)), { recursive: true });
    writeFileSync(join(root, name, f.path), f.content);
  }
  return join(root, name);
};

describe("roadmap drift compare", () => {
  it("identical roadmaps match fully; a broken one reports its schema violations", () => {
    const a = side("a", roadmapFiles({ target: "salesforce" }));
    const b = side("b", roadmapFiles({ target: "salesforce" }));
    const c = compareSides(loadSide(a, "salesforce"), loadSide(b, "salesforce"), "salesforce");
    expect(c.a.schemaViolations).toEqual([]);
    expect(c.a.validation).toEqual([]);
    expect(c.overlap.inventoryBySourceUrlAndTitle).toEqual({ both: 2, onlyA: [], onlyB: [] });
    expect(c.overlap.capabilitiesByKey.onlyA).toEqual([]);
    expect(c.a.migration.classes.every((m) => m.present && m.complete)).toBe(true);
    expect(c.a.inventory.placeholderSourceUrls).toEqual(["https://example.com/docs"]);
    const md = renderCompareMd(c);
    expect(md).toContain("A textual difference is not");
    expect(renderCompareMd(c)).toBe(md);
    const broken = side("broken", [{ path: "roadmaps/salesforce/ROADMAP.yaml", content: "schema: wos-roadmap.v1\n" }]);
    const d = compareSides(loadSide(a, "salesforce"), loadSide(broken, "salesforce"), "salesforce");
    expect(d.b.schemaViolations).toContain("INVENTORY.yaml: missing");
    expect(d.b.validation).toBeNull();
  });
});

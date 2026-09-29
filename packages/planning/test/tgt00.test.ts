import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACT_PATHS, type CatalogEntry, RoadmapBundle } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { parseCatalogEntryYaml, parseInventoryYaml, parseRoadmapYaml, roadmapBundleToFiles, validateRoadmap } from "../src/index.js";

const BUNDLE_PATH = join(import.meta.dirname, "..", "..", "..", "docs", "roadmap", "waronsaas.roadmap.json");
const bundle = RoadmapBundle.parse(JSON.parse(readFileSync(BUNDLE_PATH, "utf8")));

describe("TGT-00 warOnSaaS roadmap bundle converted to files (DONE 2, D13 row)", () => {
  const files = roadmapBundleToFiles(bundle);
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const target = bundle.roadmap.target;

  it("writes INVENTORY.yaml, ROADMAP.yaml and one catalog file per entry, deterministically", () => {
    expect(byPath.has(ARTIFACT_PATHS.inventory(target))).toBe(true);
    expect(byPath.has(ARTIFACT_PATHS.roadmap(target))).toBe(true);
    for (const c of bundle.catalog) expect(byPath.has(ARTIFACT_PATHS.catalogEntry(c.key))).toBe(true);
    expect(files).toHaveLength(2 + bundle.catalog.length);
    expect(roadmapBundleToFiles(bundle)).toEqual(files);
  });

  it("feature-catalog R-001 the converted files parse, round-trip and pass validateRoadmap with no issues", () => {
    const roadmap = parseRoadmapYaml(byPath.get(ARTIFACT_PATHS.roadmap(target))!);
    const inventory = parseInventoryYaml(byPath.get(ARTIFACT_PATHS.inventory(target))!);
    expect(roadmap.ok && inventory.ok, JSON.stringify([roadmap, inventory].flatMap((r) => (r.ok ? [] : r.errors)))).toBe(true);
    if (!roadmap.ok || !inventory.ok) return;
    expect(roadmap.value).toEqual(bundle.roadmap);
    expect(inventory.value).toEqual(bundle.inventory);
    const catalog = new Map<string, CatalogEntry>();
    for (const c of bundle.catalog) {
      const entry = parseCatalogEntryYaml(byPath.get(ARTIFACT_PATHS.catalogEntry(c.key))!);
      expect(entry.ok).toBe(true);
      if (entry.ok) catalog.set(c.key, entry.value);
    }
    expect(validateRoadmap(roadmap.value, inventory.value, catalog, null)).toEqual([]);
  });

  it("D13: every inventory surface of TGT-00 is decided in the roadmap", () => {
    const decided = new Set(bundle.roadmap.surfaces.map((s) => s.surface));
    for (const s of bundle.inventory.surfaces) expect(decided.has(s.surface), s.surface).toBe(true);
  });

  it("the converted TGT-00 roadmap still fails when a surface decision is removed", () => {
    const broken = structuredClone(bundle.roadmap);
    broken.surfaces = broken.surfaces.filter((s) => s.surface !== "cli");
    const catalog = new Map(bundle.catalog.map((c) => [c.key, c]));
    const codes = new Set(validateRoadmap(broken, bundle.inventory, catalog, null).map((i) => i.code));
    expect(codes.has("SURFACE_MISSING")).toBe(true);
  });
});

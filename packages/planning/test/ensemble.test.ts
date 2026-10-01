/** D73 ensemble merge (contracts 5.21.0): deterministic majority, median rubric, decisions, stability. */
import type { Inventory, Roadmap } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import {
  citedUrls,
  ensembleStability,
  majorityThreshold,
  mergeRoadmapRuns,
  parseInventoryYaml,
  parseRoadmapYaml,
  renderDecisionsMd,
  rubricWeights,
  toYaml,
  validateRoadmap,
} from "../src/index.js";
import { catalog, clone, inventory, roadmap } from "./fixtures.js";

const score = (n: number) => ({ score: n, basis: "https://help.example.com/" });
const rub = (a: number, b: number, c: number, d: number) => ({
  editionBreadth: score(a),
  coreDailyUse: score(b),
  surfaceParity: score(c),
  migrationGravity: score(d),
});
const VOCAB = ["s-contacts", "s-import", "s-deals", "s-reports"].map((id) => ({ id, group: "CRM", definition: `The ${id} capability.` }));

function run(mut: (r: Roadmap, i: Inventory) => void = () => undefined) {
  const r = clone(roadmap());
  const i = clone(inventory());
  r.capabilities[0]!.rubric = rub(5, 5, 4, 4);
  r.capabilities[1]!.rubric = rub(3, 3, 2, 2);
  r.capabilities[2]!.rubric = rub(2, 1, 1, 1);
  const ids: Record<string, string | null> = {
    "INV-0001": "s-contacts",
    "INV-0002": "s-import",
    "INV-0003": "s-deals",
    "INV-0004": null,
    "INV-0005": "s-reports",
  };
  for (const it of i.items) it.scanId = ids[it.key] ?? null;
  mut(r, i);
  const w = rubricWeights(r.capabilities)!;
  r.capabilities.forEach((c, k) => {
    c.weightBp = w[k]!;
  });
  r.weightRubric = "wos-weight-rubric.v1";
  return { inventory: i, roadmap: r, catalog: catalog(), fetchedUrls: citedUrls(r, i) };
}

const existingCatalog = new Set([...catalog().keys()].filter((k) => k !== "csv-import"));

describe("D73 ensemble merge", () => {
  it("strict majority: 2 of 3, 3 of 4 and 5, 4 of 6", () => {
    expect([2, 3, 4, 5, 6].map(majorityThreshold)).toEqual([2, 2, 3, 3, 4]);
  });

  it("identical runs merge to the same roadmap with no decisions and full stability", () => {
    const runs = [run(), run(), run()];
    const m = mergeRoadmapRuns(runs, { vocabulary: VOCAB, existingCatalog });
    expect(m.decisions).toEqual([]);
    expect(m.inventory.items.map((x) => x.title)).toEqual(runs[0]!.inventory.items.map((x) => x.title));
    expect(m.roadmap.capabilities.map((c) => [c.key, c.weightBp])).toEqual(runs[0]!.roadmap.capabilities.map((c) => [c.key, c.weightBp]));
    expect(m.roadmap.newCatalogFeatures).toEqual(["csv-import"]); // import-engine and acme-import are already in the catalog
    const st = ensembleStability(runs, [], { capabilitiesMatchBp: 9000, featuresMatchBp: 8000, weightSpearman: 0.85, groundingBp: 10_000 });
    expect(st).toEqual({ capabilitiesMatchBp: 10_000, featuresMatchBp: 10_000, weightSpearman: 1, groundingBp: 10_000, belowTarget: [] });
    expect(
      validateRoadmap(m.roadmap, m.inventory, new Map([...catalog(), ...m.catalogFiles.map((c) => [c.key, c] as const)]), null),
    ).toEqual([]);
  });

  it("a minority item is left out as a decision; rubric scores take the median; migration takes the majority variant", () => {
    const extra = (r: Roadmap, i: Inventory) => {
      i.items.push({
        key: "INV-0006",
        area: "Deals",
        title: "Lead scoring",
        description: "Scores leads",
        source: 0,
        weight: 1,
        scanId: "s-deals",
      });
      r.capabilities[1]!.inventoryItems.push("INV-0006");
    };
    const runs = [
      run((r) => (r.capabilities[1]!.rubric = rub(4, 4, 2, 2))),
      run((r, i) => {
        extra(r, i);
        r.capabilities[1]!.rubric = rub(2, 2, 2, 2);
      }),
      run((r) => {
        r.capabilities[1]!.rubric = rub(3, 5, 2, 2);
        r.migration!.classes[0]!.extraction = { method: "Acme bulk export to CSV files", source: "https://help.example.com/export" };
      }),
    ];
    const m = mergeRoadmapRuns(runs, { vocabulary: VOCAB, existingCatalog });
    expect(m.threshold).toBe(2);
    expect(m.inventory.items.some((x) => x.title === "Lead scoring")).toBe(false);
    const d = m.decisions.find((x) => x.subject === "Lead scoring")!;
    expect(d).toMatchObject({
      kind: "ensemble_disagreement",
      chosen: "omitted",
      options: [
        { label: "include", runs: [2] },
        { label: "omit", runs: [1, 3] },
      ],
    });
    // Deals: medians of (4,2,3), (4,2,5), (2,2,2), (2,2,2) = 3, 4, 2, 2.
    const deals = m.roadmap.capabilities.find((c) => c.key === "deals")!;
    expect([
      deals.rubric!.editionBreadth.score,
      deals.rubric!.coreDailyUse.score,
      deals.rubric!.surfaceParity.score,
      deals.rubric!.migrationGravity.score,
    ]).toEqual([3, 4, 2, 2]);
    expect(m.roadmap.capabilities.map((c) => c.weightBp)).toEqual(rubricWeights(m.roadmap.capabilities));
    // The records class: runs 1 and 2 agree (the majority), run 3's variant is not taken and needs no decision.
    expect(m.roadmap.migration!.classes[0]!.extraction!.method).toBe("Acme REST API, paginated list endpoints");
    expect(m.decisions.map((x) => x.id)).toEqual(m.decisions.map((_, k) => `DEC-${String(k + 1).padStart(3, "0")}`));
    expect(m.roadmap.decisions).toEqual(m.decisions);
  });

  it("is deterministic, and the YAML it writes parses back to the same documents", () => {
    const runs = [run(), run((r) => (r.capabilities[2]!.rubric = rub(1, 1, 1, 1))), run()];
    const a = mergeRoadmapRuns(runs, { vocabulary: VOCAB, existingCatalog });
    const b = mergeRoadmapRuns(runs, { vocabulary: VOCAB, existingCatalog });
    expect(a).toEqual(b);
    const inv = parseInventoryYaml(toYaml(a.inventory));
    const rm = parseRoadmapYaml(toYaml(a.roadmap));
    expect(inv.ok && rm.ok).toBe(true);
    if (rm.ok) expect(rm.value.capabilities.map((c) => c.weightBp)).toEqual(a.roadmap.capabilities.map((c) => c.weightBp));
    const md = renderDecisionsMd("acme-crm", a.decisions, "Merged from 3 runs.");
    expect(md).toBe(renderDecisionsMd("acme-crm", a.decisions, "Merged from 3 runs."));
    expect(md).toContain("rules on every decision");
  });

  it("stability: capability keys, feature Jaccard, weight Spearman and grounding, against the targets", () => {
    const a = run();
    const b = run((r) => {
      r.capabilities[0]!.features = [r.capabilities[0]!.features[0]!];
      r.capabilities[0]!.features[0]!.weightBp = 10_000;
      r.capabilities[0]!.features[0]!.inventoryItems = ["INV-0001", "INV-0002"];
      r.capabilities[2]!.rubric = rub(5, 5, 5, 5);
    });
    const ungrounded = { ...a, fetchedUrls: [] as string[] };
    const st = ensembleStability([ungrounded, b], [], {
      capabilitiesMatchBp: 9000,
      featuresMatchBp: 8000,
      weightSpearman: 0.85,
      groundingBp: 10_000,
    });
    expect(st.capabilitiesMatchBp).toBe(10_000);
    expect(st.featuresMatchBp).toBe(5000);
    expect(st.groundingBp).toBe(0);
    expect(st.belowTarget).toEqual(expect.arrayContaining(["features", "grounding"]));
  });
});

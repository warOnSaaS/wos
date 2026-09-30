import { Inventory, Roadmap } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { ROADMAP_ERROR_CODES, type RoadmapErrorCode, validateRoadmap } from "../src/index.js";
import { catalog, clone, inventory, roadmap } from "./fixtures.js";

type R = ReturnType<typeof roadmap>;
type I = ReturnType<typeof inventory>;
type Cat = ReturnType<typeof catalog>;

function run(mut: { r?: (r: R) => void; i?: (i: I) => void; c?: (c: Cat) => void; prev?: number | null } = {}) {
  const r = clone(roadmap());
  const i = clone(inventory());
  const c = catalog();
  mut.r?.(r);
  mut.i?.(i);
  mut.c?.(c);
  return validateRoadmap(r, i, c, mut.prev === undefined ? null : mut.prev);
}
const codes = (xs: ReturnType<typeof run>) => [...new Set(xs.map((x) => x.code))].sort();
const contacts = (r: R) => r.capabilities[0]!.features[0]!;

/** One failing fixture per validateRoadmap rule; each breaks exactly one rule of the valid baseline. */
const CASES: Record<RoadmapErrorCode, { why: string; mut: Parameters<typeof run>[0]; req?: string }> = {
  TARGET_MISMATCH: { why: "roadmap and inventory are for different apps", mut: { i: (i) => (i.target = "other-crm") } },
  INVENTORY_VERSION_MISMATCH: { why: "roadmap names inventory v2, file is v1", mut: { r: (r) => (r.inventoryVersion = 2) } },
  VERSION_NOT_NEXT: { why: "version 3 after merged version 1", mut: { r: (r) => (r.version = 3), prev: 1 } },
  INVENTORY_DUPLICATE_ITEM: {
    why: "an inventory key is used twice",
    mut: { i: (i) => i.items.push({ ...i.items[0]!, title: "again" }) },
  },
  INVENTORY_SOURCE_UNKNOWN: { why: "an item cites source 7 of 2", mut: { i: (i) => (i.items[0]!.source = 7) } },
  SURFACE_MISSING: {
    why: "the inventory ships android, the roadmap does not decide it",
    mut: {
      r: (r) => {
        r.surfaces = r.surfaces.filter((s) => s.surface !== "android");
        const f = contacts(r);
        f.surfaces = f.surfaces.filter((s) => s.surface !== "android");
        f.surfaces[0]!.weightBp = 7000;
        f.journeys = f.journeys.filter((j) => j.surface !== "android");
      },
    },
  },
  SURFACE_NOT_IN_INVENTORY: {
    why: "an excluded desktop surface with no evidence in the inventory",
    mut: {
      r: (r) =>
        r.surfaces.push({ surface: "desktop", status: "excluded", reason: "The vendor has no desktop app.", repo: null, path: null }),
    },
  },
  SURFACE_DUPLICATE: { why: "web listed twice", mut: { r: (r) => r.surfaces.push({ ...r.surfaces[0]! }) } },
  SURFACE_EXCLUDED_WITHOUT_REASON: {
    why: "android excluded without a reason (and its feature weights moved to web)",
    mut: {
      r: (r) => {
        r.surfaces[2] = { surface: "android", status: "excluded", reason: null, repo: null, path: null };
        const f = contacts(r);
        f.surfaces = f.surfaces.filter((s) => s.surface !== "android");
        f.surfaces[0]!.weightBp = 7000;
        f.journeys = f.journeys.filter((j) => j.surface !== "android");
      },
    },
  },
  SURFACE_IN_SCOPE_WITHOUT_LOCATION: { why: "in-scope iOS with no app shell path", mut: { r: (r) => (r.surfaces[1]!.path = null) } },
  FEATURE_SURFACE_NOT_IN_SCOPE: {
    why: "a feature weighted on an excluded surface",
    mut: {
      r: (r) =>
        (r.surfaces[2] = { surface: "android", status: "excluded", reason: "Not needed by this vendor's users.", repo: null, path: null }),
    },
  },
  FEATURE_SURFACE_DUPLICATE: {
    why: "web weighted twice for one feature",
    mut: {
      r: (r) => {
        const f = contacts(r);
        f.surfaces = [
          { ...f.surfaces[0]!, weightBp: 5000 },
          { ...f.surfaces[0]!, weightBp: 5000 },
        ];
        f.journeys = f.journeys.filter((j) => j.surface === "web");
      },
    },
  },
  JOURNEY_MISSING: {
    why: "iOS is weighted but has no journey",
    mut: { r: (r) => (contacts(r).journeys = contacts(r).journeys.filter((j) => j.surface !== "ios")) },
  },
  CAPABILITY_DUPLICATE: {
    why: "two capabilities share a key",
    mut: { r: (r) => (r.capabilities[2]!.key = "deals") },
  },
  ITEM_UNKNOWN: {
    why: "a capability cites INV-0099",
    mut: { r: (r) => r.capabilities[1]!.inventoryItems.push("INV-0099") },
    req: "feature-catalog",
  },
  ITEM_UNPLACED: { why: "INV-0004 is in no capability and no longer excluded", mut: { r: (r) => (r.excluded = []) } },
  ITEM_PLACED_TWICE: {
    why: "INV-0004 is excluded and also in Deals",
    mut: { r: (r) => r.capabilities[1]!.inventoryItems.push("INV-0004") },
  },
  EXCLUSION_REASON_TOO_SHORT: { why: "an exclusion reason of 3 characters", mut: { r: (r) => (r.excluded[0]!.reason = "old") } },
  FEATURE_ITEM_OUTSIDE_CAPABILITY: {
    why: "a feature claims an item of another capability",
    mut: { r: (r) => contacts(r).inventoryItems.push("INV-0003") },
  },
  CAPABILITY_ITEM_UNMAPPED: {
    why: "a mapped capability's item is covered by no feature",
    mut: { r: (r) => (r.capabilities[0]!.features[1]!.inventoryItems = ["INV-0001"]) },
  },
  FEATURE_DUPLICATE_IN_CAPABILITY: {
    why: "contacts listed twice in one capability",
    mut: { r: (r) => (r.capabilities[0]!.features[1]!.feature = "contacts") },
  },
  FEATURE_IN_TWO_CAPABILITIES: {
    why: "contacts mapped in Contacts and again in Deals",
    mut: {
      r: (r) => {
        r.capabilities[1]!.features = [{ ...clone(contacts(r)), weightBp: 10_000, inventoryItems: ["INV-0003"] }];
      },
    },
  },
  FEATURE_NOT_IN_CATALOG: {
    why: "a feature that is neither in the catalog nor new",
    mut: { r: (r) => (r.capabilities[0]!.features[1]!.feature = "bulk-import") },
    req: "feature-catalog R-001",
  },
  FEATURE_ALIASED: {
    why: "a reference to the aliased catalog key people",
    mut: { r: (r) => (contacts(r).feature = "people") },
    req: "feature-catalog R-001",
  },
  NEW_CATALOG_FEATURE_WITHOUT_FILE: {
    why: "csv-import is new but catalog/csv-import.yaml is missing",
    mut: { c: (c) => c.delete("csv-import") },
  },
  CATALOG_KEY_MISMATCH: {
    why: "catalog/csv-import.yaml declares another key",
    mut: { c: (c) => c.set("csv-import", { ...c.get("csv-import")!, key: "csv-imports" }) },
  },
  WEIGHT_OUT_OF_RANGE: {
    why: "a capability weight of 0 (sums kept at 10000)",
    mut: {
      r: (r) => {
        r.capabilities[2]!.weightBp = 0;
        r.capabilities[1]!.weightBp = 4000;
      },
    },
    req: "roadmap-consensus R-003",
  },
  RATIONALE_TOO_SHORT: {
    why: "a boilerplate one-word rationale",
    mut: { r: (r) => (r.capabilities[1]!.weightRationale = "important") },
    req: "roadmap-consensus R-003",
  },
  CAPABILITY_WEIGHTS_SUM: {
    why: "capabilities sum to 9001",
    mut: { r: (r) => (r.capabilities[2]!.weightBp = 1) },
    req: "roadmap-consensus R-003",
  },
  FEATURE_WEIGHTS_SUM: {
    why: "features of Contacts sum to 9000",
    mut: { r: (r) => (r.capabilities[0]!.features[1]!.weightBp = 2000) },
    req: "roadmap-consensus R-003",
  },
  SURFACE_WEIGHTS_SUM: {
    why: "surface weights of contacts sum to 9999",
    mut: { r: (r) => (contacts(r).surfaces[2]!.weightBp = 1999) },
    req: "roadmap-consensus R-003",
  },
  MIGRATION_MISSING: {
    req: "D59",
    why: "a target roadmap with no plan for getting customers off the target",
    mut: { r: (r) => delete r.migration },
  },
  MIGRATION_CLASS_MISSING: {
    req: "D59",
    why: "files and attachments are not accounted for",
    mut: { r: (r) => (r.migration!.classes = r.migration!.classes.filter((c) => c.dataClass !== "files_attachments")) },
  },
  MIGRATION_CLASS_DUPLICATE: {
    req: "D59",
    why: "records are planned twice",
    mut: { r: (r) => r.migration!.classes.push(clone(r.migration!.classes[0]!)) },
  },
  MIGRATION_CLASS_UNACCOUNTED: {
    req: "D59",
    why: "history has no connector and no sourced not-extractable list: silently dropped",
    mut: { r: (r) => (r.migration!.classes[3]!.notExtractable = []) },
  },
  MIGRATION_EXTRACTION_MISSING: {
    req: "D59",
    why: "an imported class does not say how its data is read",
    mut: { r: (r) => (r.migration!.classes[0]!.extraction = null) },
  },
  MIGRATION_FEATURE_NOT_IN_CATALOG: {
    req: "D59",
    why: "the connector is neither in the catalog nor proposed",
    mut: { c: (c) => c.delete("acme-import") },
  },
};

describe("validateRoadmap", () => {
  it("the valid baseline passes the schema and every rule", () => {
    expect(Inventory.safeParse(inventory()).success).toBe(true);
    expect(Roadmap.safeParse(roadmap()).success).toBe(true);
    expect(run()).toEqual([]);
  });

  it("covers every roadmap error code with a fixture", () => {
    expect(Object.keys(CASES).sort()).toEqual([...ROADMAP_ERROR_CODES].sort());
  });

  for (const code of ROADMAP_ERROR_CODES) {
    const c = CASES[code];
    it(`${c.req ? `${c.req} ` : ""}${code}: ${c.why}`, () => {
      const issues = run(c.mut);
      expect(codes(issues)).toEqual([code]);
      for (const i of issues) expect(i.message.length).toBeGreaterThan(10);
    });
  }

  it("TGT-00 warOnSaaS has no customers to move and is exempt from the migration section (D59)", () => {
    const tgt00 = (x: { target: string }) => (x.target = "waronsaas");
    expect(run({ r: (r) => (tgt00(r), delete r.migration), i: tgt00 })).toEqual([]);
  });

  it("version 1 is required when nothing has merged, previous + 1 afterwards", () => {
    expect(run({ prev: null })).toEqual([]);
    expect(run({ r: (r) => (r.version = 2), prev: 1 })).toEqual([]);
    expect(codes(run({ r: (r) => (r.version = 1), prev: 1 }))).toEqual(["VERSION_NOT_NEXT"]);
  });

  it("an unmapped capability needs no features (capability-at-a-time)", () => {
    expect(run({ r: (r) => (r.capabilities[0]!.features = []) })).toEqual([]);
  });

  it("errors name the capability and feature they are about", () => {
    const [issue] = run(CASES.SURFACE_WEIGHTS_SUM.mut);
    expect(issue!.message).toContain("capabilities[0] (contacts).features[0] (contacts)");
  });
});

/**
 * Deterministic roadmap validation (ROADMAP-PROTOCOL.md section 2 "Validation", step 3, plus D12 and D13).
 *
 * The input is typed but untrusted: `validateRoadmap` re-checks every weight, rationale and surface rule the
 * `Roadmap` schema enforces, so a caller that skipped the schema (or a hand-built object) still gets coded
 * errors. When the schema already passed those checks are silent, so the control plane never sees a rule
 * reported twice.
 */
import type { CatalogEntry, Inventory, Roadmap } from "@waronsaas/contracts";

export const ROADMAP_ERROR_CODES = [
  // identity and versions
  "TARGET_MISMATCH",
  "INVENTORY_VERSION_MISMATCH",
  "VERSION_NOT_NEXT",
  // inventory integrity
  "INVENTORY_DUPLICATE_ITEM",
  "INVENTORY_SOURCE_UNKNOWN",
  // surfaces (D13)
  "SURFACE_MISSING",
  "SURFACE_NOT_IN_INVENTORY",
  "SURFACE_DUPLICATE",
  "SURFACE_EXCLUDED_WITHOUT_REASON",
  "SURFACE_IN_SCOPE_WITHOUT_LOCATION",
  "FEATURE_SURFACE_NOT_IN_SCOPE",
  "FEATURE_SURFACE_DUPLICATE",
  "JOURNEY_MISSING",
  // coverage
  "CAPABILITY_DUPLICATE",
  "ITEM_UNKNOWN",
  "ITEM_UNPLACED",
  "ITEM_PLACED_TWICE",
  "EXCLUSION_REASON_TOO_SHORT",
  "FEATURE_ITEM_OUTSIDE_CAPABILITY",
  "CAPABILITY_ITEM_UNMAPPED",
  // catalog (D10)
  "FEATURE_DUPLICATE_IN_CAPABILITY",
  "FEATURE_IN_TWO_CAPABILITIES",
  "FEATURE_NOT_IN_CATALOG",
  "FEATURE_ALIASED",
  "NEW_CATALOG_FEATURE_WITHOUT_FILE",
  "CATALOG_KEY_MISMATCH",
  // weights (D12, D13)
  "WEIGHT_OUT_OF_RANGE",
  "RATIONALE_TOO_SHORT",
  "CAPABILITY_WEIGHTS_SUM",
  "FEATURE_WEIGHTS_SUM",
  "SURFACE_WEIGHTS_SUM",
] as const;
export type RoadmapErrorCode = (typeof ROADMAP_ERROR_CODES)[number];
export interface RoadmapIssue {
  code: RoadmapErrorCode;
  message: string;
}

const BP_TOTAL = 10_000;
const MIN_RATIONALE = 40;
const MIN_REASON = 10;

/**
 * ROADMAP-PROTOCOL.md "Validation" step 3. `catalog` is the catalog at the PR head for the roadmap's own
 * repository (GAPS G-54), including the entries this PR adds for `newCatalogFeatures`.
 */
export function validateRoadmap(
  roadmap: Roadmap,
  inventory: Inventory,
  catalog: ReadonlyMap<string, CatalogEntry>,
  previousMergedVersion: number | null,
): RoadmapIssue[] {
  const out: RoadmapIssue[] = [];
  const add = (code: RoadmapErrorCode, message: string) => out.push({ code, message });

  // --- identity and versions ---
  if (roadmap.target !== inventory.target)
    add("TARGET_MISMATCH", `roadmap target ${roadmap.target} does not match inventory target ${inventory.target}`);
  if (roadmap.inventoryVersion !== inventory.version)
    add("INVENTORY_VERSION_MISMATCH", `inventoryVersion is ${roadmap.inventoryVersion} but INVENTORY.yaml is version ${inventory.version}`);
  const expected = (previousMergedVersion ?? 0) + 1;
  if (roadmap.version !== expected)
    add(
      "VERSION_NOT_NEXT",
      `version is ${roadmap.version}; expected ${expected} (${previousMergedVersion === null ? "no merged version yet" : `last merged is ${previousMergedVersion}`})`,
    );

  // --- inventory integrity ---
  const items = new Set<string>();
  inventory.items.forEach((it, i) => {
    if (items.has(it.key)) add("INVENTORY_DUPLICATE_ITEM", `inventory items[${i}]: ${it.key} is listed twice`);
    items.add(it.key);
    if (!Number.isInteger(it.source) || it.source < 0 || it.source >= inventory.sources.length)
      add("INVENTORY_SOURCE_UNKNOWN", `inventory items[${i}] (${it.key}) cites source ${it.source}, which does not exist`);
  });
  inventory.surfaces.forEach((s, i) => {
    if (!Number.isInteger(s.source) || s.source < 0 || s.source >= inventory.sources.length)
      add("INVENTORY_SOURCE_UNKNOWN", `inventory surfaces[${i}] (${s.surface}) cites source ${s.source}, which does not exist`);
  });

  // --- surfaces (D13) ---
  const roadmapSurfaces = new Map<string, Roadmap["surfaces"][number]>();
  roadmap.surfaces.forEach((s, i) => {
    if (roadmapSurfaces.has(s.surface)) add("SURFACE_DUPLICATE", `surfaces[${i}]: ${s.surface} is listed twice`);
    else roadmapSurfaces.set(s.surface, s);
    if (s.status === "excluded" && (s.reason ?? "").trim().length < MIN_REASON)
      add(
        "SURFACE_EXCLUDED_WITHOUT_REASON",
        `surfaces[${i}]: excluded surface ${s.surface} needs a reason of at least ${MIN_REASON} characters`,
      );
    if (s.status === "in_scope" && (!s.repo || !s.path))
      add(
        "SURFACE_IN_SCOPE_WITHOUT_LOCATION",
        `surfaces[${i}]: in-scope surface ${s.surface} needs the repo and app shell path that serve it`,
      );
  });
  const inventorySurfaces = new Set(inventory.surfaces.map((s) => s.surface));
  for (const s of inventory.surfaces)
    if (!roadmapSurfaces.has(s.surface))
      add("SURFACE_MISSING", `the inventory lists surface ${s.surface}; the roadmap must mark it in_scope or excluded with a reason`);
  roadmap.surfaces.forEach((s, i) => {
    if (!inventorySurfaces.has(s.surface))
      add("SURFACE_NOT_IN_INVENTORY", `surfaces[${i}]: ${s.surface} has no cited evidence in the inventory's surfaces`);
  });
  const inScope = new Set(roadmap.surfaces.filter((s) => s.status === "in_scope").map((s) => s.surface));

  // --- weights, capability by capability ---
  const weight = (where: string, w: { weightBp: number; weightRationale: string }) => {
    if (!Number.isInteger(w.weightBp) || w.weightBp < 1 || w.weightBp > BP_TOTAL)
      add("WEIGHT_OUT_OF_RANGE", `${where}: weightBp ${w.weightBp} is not an integer in 1..${BP_TOTAL}`);
    if (typeof w.weightRationale !== "string" || w.weightRationale.trim().length < MIN_RATIONALE)
      add("RATIONALE_TOO_SHORT", `${where}: weightRationale must explain the weight in at least ${MIN_RATIONALE} characters (D12)`);
  };
  const total = (xs: ReadonlyArray<{ weightBp: number }>) => xs.reduce((n, x) => n + x.weightBp, 0);
  const capTotal = total(roadmap.capabilities);
  if (capTotal !== BP_TOTAL)
    add("CAPABILITY_WEIGHTS_SUM", `capability weights sum to ${capTotal} bp; they must sum to exactly ${BP_TOTAL}`);

  // --- placement of inventory items (exactly once) ---
  const placedAt = new Map<string, string>();
  const place = (item: string, where: string) => {
    if (!items.has(item)) {
      add("ITEM_UNKNOWN", `${where}: ${item} is not an item of inventory version ${inventory.version}`);
      return;
    }
    const prior = placedAt.get(item);
    if (prior !== undefined) add("ITEM_PLACED_TWICE", `${item} is placed in ${prior} and again in ${where}`);
    else placedAt.set(item, where);
  };

  const capKeys = new Set<string>();
  const featureHome = new Map<string, string>();
  roadmap.capabilities.forEach((c, i) => {
    const at = `capabilities[${i}] (${c.key})`;
    if (capKeys.has(c.key)) add("CAPABILITY_DUPLICATE", `${at}: capability key ${c.key} is used twice`);
    capKeys.add(c.key);
    weight(at, c);
    const capItems = new Set(c.inventoryItems);
    for (const item of c.inventoryItems) place(item, at);
    if (c.features.length === 0) return; // unmapped capability: skeleton only

    const fTotal = total(c.features);
    if (fTotal !== BP_TOTAL)
      add(
        "FEATURE_WEIGHTS_SUM",
        `${at}: feature weights sum to ${fTotal} bp; a mapped capability's features must sum to exactly ${BP_TOTAL}`,
      );
    const covered = new Set<string>();
    const seen = new Set<string>();
    c.features.forEach((f, j) => {
      const fat = `${at}.features[${j}] (${f.feature})`;
      weight(fat, f);
      if (seen.has(f.feature)) add("FEATURE_DUPLICATE_IN_CAPABILITY", `${fat}: ${f.feature} is listed twice in ${c.key}`);
      seen.add(f.feature);
      const home = featureHome.get(f.feature);
      if (home !== undefined && home !== c.key)
        add(
          "FEATURE_IN_TWO_CAPABILITIES",
          `${fat}: ${f.feature} is already mapped in capability ${home}; an app tracks each catalog feature once (app_features is unique per target and feature)`,
        );
      else featureHome.set(f.feature, c.key);

      for (const item of f.inventoryItems) {
        covered.add(item);
        if (!capItems.has(item))
          add("FEATURE_ITEM_OUTSIDE_CAPABILITY", `${fat}: ${item} is not one of capability ${c.key}'s inventory items`);
      }

      // catalog (D10)
      const entry = catalog.get(f.feature);
      if (!entry) {
        // A key listed in newCatalogFeatures without its file is reported once, as NEW_CATALOG_FEATURE_WITHOUT_FILE.
        if (!roadmap.newCatalogFeatures.includes(f.feature))
          add("FEATURE_NOT_IN_CATALOG", `${fat}: ${f.feature} is not in the catalog at the PR head and not in newCatalogFeatures`);
      } else if (entry.aliasOf)
        add("FEATURE_ALIASED", `${fat}: ${f.feature} is an alias of ${entry.aliasOf}; reference ${entry.aliasOf} instead`);

      // surfaces, surface weights and journeys (D12 + D13)
      const sTotal = total(f.surfaces);
      if (sTotal !== BP_TOTAL)
        add("SURFACE_WEIGHTS_SUM", `${fat}: surface weights sum to ${sTotal} bp; they must sum to exactly ${BP_TOTAL}`);
      const fSurfaces = new Set<string>();
      f.surfaces.forEach((s, k) => {
        const sat = `${fat}.surfaces[${k}] (${s.surface})`;
        weight(sat, s);
        if (fSurfaces.has(s.surface)) add("FEATURE_SURFACE_DUPLICATE", `${sat}: surface listed twice`);
        fSurfaces.add(s.surface);
        if (!inScope.has(s.surface)) add("FEATURE_SURFACE_NOT_IN_SCOPE", `${sat}: surface ${s.surface} is not in scope for this roadmap`);
        if (!f.journeys.some((jr) => jr.surface === s.surface))
          add("JOURNEY_MISSING", `${sat}: no journey describes ${f.feature} on ${s.surface}`);
      });
    });
    for (const item of c.inventoryItems)
      if (!covered.has(item)) add("CAPABILITY_ITEM_UNMAPPED", `${at}: ${item} is mapped but no feature of the capability covers it`);
  });

  roadmap.excluded.forEach((e, i) => {
    const at = `excluded[${i}]`;
    place(e.item, at);
    if (e.reason.trim().length < MIN_REASON)
      add("EXCLUSION_REASON_TOO_SHORT", `${at} (${e.item}): the reason must be at least ${MIN_REASON} characters a customer would accept`);
  });
  for (const it of inventory.items)
    if (!placedAt.has(it.key)) add("ITEM_UNPLACED", `${it.key} (${it.title}) is in no capability and not excluded`);

  // --- new catalog features ---
  for (const key of roadmap.newCatalogFeatures) {
    if (!catalog.has(key)) add("NEW_CATALOG_FEATURE_WITHOUT_FILE", `newCatalogFeatures: ${key} needs catalog/${key}.yaml in the same PR`);
  }
  for (const [key, entry] of catalog)
    if (entry.key !== key) add("CATALOG_KEY_MISMATCH", `catalog/${key}.yaml declares key ${entry.key}; the file name and key must match`);

  return out;
}

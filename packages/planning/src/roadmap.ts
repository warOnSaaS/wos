/**
 * Deterministic roadmap validation (ROADMAP-PROTOCOL.md section 2 "Validation", step 3, plus D12 and D13).
 *
 * The input is typed but untrusted: `validateRoadmap` re-checks every weight, rationale and surface rule the
 * `Roadmap` schema enforces, so a caller that skipped the schema (or a hand-built object) still gets coded
 * errors. When the schema already passed those checks are silent, so the control plane never sees a rule
 * reported twice.
 */
import {
  type CatalogEntry,
  IMPORT_ENGINE_FEATURE,
  type Inventory,
  MIGRATION_DATA_CLASSES,
  PLATFORM_TARGET,
  type Roadmap,
} from "@waronsaas/contracts";

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
  // migration: getting customers off the target (D59, contracts 5.4.0)
  "MIGRATION_MISSING",
  "MIGRATION_CLASS_MISSING",
  "MIGRATION_CLASS_DUPLICATE",
  "MIGRATION_CLASS_UNACCOUNTED",
  "MIGRATION_EXTRACTION_MISSING",
  "MIGRATION_FEATURE_NOT_IN_CATALOG",
  // roadmap method (D72, contracts 5.19.0): scan skeleton and weight rubric
  "SCAN_CAPABILITY_UNACCOUNTED",
  "SCAN_ID_UNKNOWN",
  "SCAN_ADDITION_UNSOURCED",
  "RUBRIC_MISSING",
  "RUBRIC_WEIGHT_MISMATCH",
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
  /**
   * contracts 5.19.0 (D72): the roadmap method, when the document was authored under a policy that has one: the
   * target scan's capability ids (every one must be placed or excluded with a source) and the weight rubric (scores
   * present and weights derived from them). Omitted = no method checks (documents authored before agent-policy.v3).
   */
  method?: { scanCapabilityIds: readonly string[] | null; requireRubric: boolean },
): RoadmapIssue[] {
  const out: RoadmapIssue[] = [];
  const add = (code: RoadmapErrorCode, message: string) => out.push({ code, message });
  if (method) validateMethod(roadmap, method, add);

  // --- migration (D59): every target roadmap plans how customers leave the target ---
  validateMigration(roadmap, catalog, add);

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

/**
 * D59: a target roadmap (every roadmap except TGT-00's) has a migration section accounting for each data class:
 * imported by a connector (with how it is read and whether delta sync is possible), or declared not extractable
 * with a source. The engine and every connector must be catalog features (existing or proposed in this PR).
 */
function validateMigration(
  roadmap: Roadmap,
  catalog: ReadonlyMap<string, CatalogEntry>,
  add: (code: RoadmapErrorCode, message: string) => void,
): void {
  if (roadmap.target === PLATFORM_TARGET) return;
  const m = roadmap.migration;
  if (!m) {
    add("MIGRATION_MISSING", `a target roadmap needs a migration section: how customers get their data OFF ${roadmap.target} (D59)`);
    return;
  }
  const known = (key: string) => catalog.has(key) || roadmap.newCatalogFeatures.includes(key);
  if (!known(m.engine))
    add(
      "MIGRATION_FEATURE_NOT_IN_CATALOG",
      `migration.engine ${m.engine} is not in the catalog; every importer is built on ${IMPORT_ENGINE_FEATURE}`,
    );
  const seen = new Set<string>();
  m.classes.forEach((c, i) => {
    const where = `migration.classes[${i}] (${c.dataClass})`;
    if (seen.has(c.dataClass)) add("MIGRATION_CLASS_DUPLICATE", `${where} is listed twice`);
    seen.add(c.dataClass);
    if (c.connector === null && c.notExtractable.length === 0)
      add(
        "MIGRATION_CLASS_UNACCOUNTED",
        `${where}: name the connector that imports it, or list what is not extractable with a source; nothing is silently dropped`,
      );
    if (c.connector !== null) {
      if (!known(c.connector)) add("MIGRATION_FEATURE_NOT_IN_CATALOG", `${where}: connector ${c.connector} is not in the catalog`);
      if (c.extraction === null || c.deltaSync === null || c.objects.length === 0)
        add(
          "MIGRATION_EXTRACTION_MISSING",
          `${where}: an imported class needs its objects, how they are read (with a source) and whether delta sync is available (with a source)`,
        );
    }
  });
  for (const dc of MIGRATION_DATA_CLASSES)
    if (!seen.has(dc))
      add("MIGRATION_CLASS_MISSING", `migration has no entry for data class ${dc} (import it or list it as not extractable)`);
}

/**
 * D72 weight rubric (`wos-weight-rubric.v1`): each capability's points are the sum of its four scores; its weight is its
 * share of all points times 10000, apportioned by largest remainder (ties: capability order), so the total is exactly
 * 10000. Null when a capability has no rubric.
 */
export function rubricWeights(capabilities: ReadonlyArray<Pick<Roadmap["capabilities"][number], "rubric">>): number[] | null {
  if (capabilities.length === 0 || capabilities.some((c) => !c.rubric)) return null;
  const points = capabilities.map(
    (c) => c.rubric!.editionBreadth.score + c.rubric!.coreDailyUse.score + c.rubric!.surfaceParity.score + c.rubric!.migrationGravity.score,
  );
  const total = points.reduce((a, b) => a + b, 0);
  const exact = points.map((p) => (p * BP_TOTAL) / total);
  const floors = exact.map(Math.floor);
  let left = BP_TOTAL - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]!++;
    left--;
  }
  return floors;
}

function validateMethod(
  roadmap: Roadmap,
  method: { scanCapabilityIds: readonly string[] | null; requireRubric: boolean },
  add: (code: RoadmapErrorCode, message: string) => void,
): void {
  if (method.scanCapabilityIds) {
    const scan = new Set(method.scanCapabilityIds);
    const placed = new Set<string>();
    for (const c of roadmap.capabilities) {
      for (const id of c.scanIds ?? []) {
        if (!scan.has(id)) add("SCAN_ID_UNKNOWN", `capability ${c.key} lists scan id ${id}, which is not in the target's scan`);
        placed.add(id);
      }
      if ((c.scanIds ?? []).length === 0 && (c.sources ?? []).length === 0)
        add("SCAN_ADDITION_UNSOURCED", `capability ${c.key} covers no scan id: list the public sources that show it (D72)`);
    }
    for (const e of roadmap.scanExcluded ?? []) {
      if (!scan.has(e.scanId)) add("SCAN_ID_UNKNOWN", `scanExcluded lists ${e.scanId}, which is not in the target's scan`);
      placed.add(e.scanId);
    }
    for (const id of method.scanCapabilityIds)
      if (!placed.has(id))
        add("SCAN_CAPABILITY_UNACCOUNTED", `scan capability ${id} is in no capability's scanIds and not in scanExcluded (D72)`);
  }
  if (method.requireRubric) {
    const missing = roadmap.capabilities.filter((c) => !c.rubric).map((c) => c.key);
    if (roadmap.weightRubric !== "wos-weight-rubric.v1" || missing.length > 0) {
      add(
        "RUBRIC_MISSING",
        `capability weights must come from the rubric (weightRubric: wos-weight-rubric.v1 and scores on every capability)${missing.length ? `; no scores: ${missing.join(", ")}` : ""}`,
      );
      return;
    }
    const derived = rubricWeights(roadmap.capabilities)!;
    roadmap.capabilities.forEach((c, i) => {
      if (Math.abs(c.weightBp - derived[i]!) > 1)
        add("RUBRIC_WEIGHT_MISMATCH", `capability ${c.key} has weightBp ${c.weightBp}; its rubric scores give ${derived[i]} (D72)`);
    });
  }
}

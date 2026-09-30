/**
 * `compare A B`: a deterministic comparison of two roadmap outputs (INVENTORY.yaml, ROADMAP.yaml, catalog/*.yaml).
 * No model judges anything. A textual difference is not an error by itself, and neither side is ground truth: the
 * Opus roadmap becomes a reference only after it passes Astra and human review.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type CatalogEntry, type Inventory, MIGRATION_DATA_CLASSES, type Roadmap } from "@waronsaas/contracts";
import { parseCatalogEntryYaml, parseInventoryYaml, parseRoadmapYaml, validateRoadmap } from "@waronsaas/planning";

export interface Side {
  label: string;
  dir: string;
  inventory: Inventory | null;
  roadmap: Roadmap | null;
  catalog: Map<string, CatalogEntry>;
  schemaViolations: string[];
}

function findFile(dir: string, target: string, name: string): string | null {
  for (const p of [join(dir, name), join(dir, "roadmaps", target, name)]) if (existsSync(p)) return p;
  return null;
}

export function loadSide(dir: string, target: string, label: string = basename(dir)): Side {
  const side: Side = { label, dir, inventory: null, roadmap: null, catalog: new Map(), schemaViolations: [] };
  const inv = findFile(dir, target, "INVENTORY.yaml");
  const rm = findFile(dir, target, "ROADMAP.yaml");
  if (!inv) side.schemaViolations.push("INVENTORY.yaml: missing");
  else {
    const r = parseInventoryYaml(readFileSync(inv, "utf8"));
    if (r.ok) side.inventory = r.value;
    else for (const e of r.errors) side.schemaViolations.push(`INVENTORY.yaml ${e.path}: ${e.message}`);
  }
  if (!rm) side.schemaViolations.push("ROADMAP.yaml: missing");
  else {
    const r = parseRoadmapYaml(readFileSync(rm, "utf8"));
    if (r.ok) side.roadmap = r.value;
    else for (const e of r.errors) side.schemaViolations.push(`ROADMAP.yaml ${e.path}: ${e.message}`);
  }
  const cat = join(dir, "catalog");
  if (existsSync(cat))
    for (const f of readdirSync(cat)
      .filter((n) => n.endsWith(".yaml"))
      .sort()) {
      const r = parseCatalogEntryYaml(readFileSync(join(cat, f), "utf8"));
      if (r.ok) side.catalog.set(f.slice(0, -5), r.value);
      else for (const e of r.errors) side.schemaViolations.push(`catalog/${f} ${e.path}: ${e.message}`);
    }
  return side;
}

export const normTitle = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    const path = x.pathname.replace(/\/+$/, "");
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${path}${x.search}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|invalid|test|example)$/;
export function isPlaceholderUrl(u: string): boolean {
  try {
    const x = new URL(u);
    if (PLACEHOLDER_HOSTS.test(x.hostname.toLowerCase())) return true;
    return /(placeholder|todo|tbd|lorem|xxx|your-?url)/i.test(u);
  } catch {
    return true;
  }
}

const sorted = <T>(xs: Iterable<T>) => [...xs].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));

function stats(ws: number[]) {
  if (ws.length === 0) return { count: 0, min: null, max: null, median: null, top3ShareBp: null };
  const s = [...ws].sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
  const top3 = [...s]
    .reverse()
    .slice(0, 3)
    .reduce((n, x) => n + x, 0);
  return { count: s.length, min: s[0]!, max: s[s.length - 1]!, median: mid, top3ShareBp: top3 };
}

function sideFacts(s: Side, target: string) {
  const inv = s.inventory;
  const rm = s.roadmap;
  const validation = inv && rm ? validateRoadmap(rm, inv, s.catalog, null).map((i) => ({ code: i.code, message: i.message })) : null;
  const items = inv?.items ?? [];
  const sources = inv?.sources ?? [];
  const citing = items.filter((it) => Number.isInteger(it.source) && it.source >= 0 && it.source < sources.length).length;
  const urlCounts = new Map<string, number>();
  for (const src of sources) urlCounts.set(normUrl(src.url), (urlCounts.get(normUrl(src.url)) ?? 0) + 1);
  const migration = MIGRATION_DATA_CLASSES.map((dc) => {
    const c = rm?.migration?.classes.find((x) => x.dataClass === dc);
    if (!c)
      return {
        dataClass: dc,
        present: false,
        connector: null,
        objects: 0,
        extraction: false,
        deltaSync: null,
        notExtractable: 0,
        complete: false,
      };
    const imported = c.connector !== null;
    const complete = imported ? c.extraction !== null && c.deltaSync !== null && c.objects.length > 0 : c.notExtractable.length > 0;
    return {
      dataClass: dc,
      present: true,
      connector: c.connector,
      objects: c.objects.length,
      extraction: c.extraction !== null,
      deltaSync: c.deltaSync?.status ?? null,
      notExtractable: c.notExtractable.length,
      complete,
    };
  });
  return {
    label: s.label,
    dir: s.dir,
    target,
    schemaViolations: s.schemaViolations,
    validation,
    inventory: {
      items: items.length,
      sources: sources.length,
      surfaces: inv?.surfaces.length ?? 0,
      itemsCitingValidSourceBp: items.length ? Math.round((citing * 10_000) / items.length) : null,
      duplicateSourceUrls: sorted([...urlCounts].filter(([, n]) => n > 1).map(([u]) => u)),
      placeholderSourceUrls: sorted(sources.filter((x) => isPlaceholderUrl(x.url)).map((x) => x.url)),
      distinctSourcesCited: new Set(items.map((it) => it.source)).size,
    },
    capabilities: rm?.capabilities.length ?? 0,
    mappedCapabilities: rm?.capabilities.filter((c) => c.features.length > 0).length ?? 0,
    features: rm?.capabilities.reduce((n, c) => n + c.features.length, 0) ?? 0,
    excludedItems: rm?.excluded.length ?? 0,
    capabilityWeights: stats(rm?.capabilities.map((c) => c.weightBp) ?? []),
    newCatalogFeatures: sorted(rm?.newCatalogFeatures ?? []),
    migration: { present: rm?.migration !== undefined, engine: rm?.migration?.engine ?? null, classes: migration },
  };
}

function itemKeys(s: Side) {
  const inv = s.inventory;
  const byUrlTitle = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const it of inv?.items ?? []) {
    const url = inv!.sources[it.source]?.url ?? "";
    byUrlTitle.set(`${normUrl(url)}|${normTitle(it.title)}`, it.key);
    byTitle.set(normTitle(it.title), it.key);
  }
  return { byUrlTitle, byTitle };
}

function overlap(a: Iterable<string>, b: Iterable<string>) {
  const A = new Set(a);
  const B = new Set(b);
  const both = sorted([...A].filter((x) => B.has(x)));
  return { both: both.length, onlyA: sorted([...A].filter((x) => !B.has(x))), onlyB: sorted([...B].filter((x) => !A.has(x))) };
}

export function compareSides(a: Side, b: Side, target: string) {
  const fa = sideFacts(a, target);
  const fb = sideFacts(b, target);
  const ka = itemKeys(a);
  const kb = itemKeys(b);
  const itemsUrlTitle = overlap(ka.byUrlTitle.keys(), kb.byUrlTitle.keys());
  const itemsTitle = overlap(ka.byTitle.keys(), kb.byTitle.keys());
  const capKey = (s: Side) => (s.roadmap?.capabilities ?? []).map((c) => c.key);
  const capTitle = (s: Side) => (s.roadmap?.capabilities ?? []).map((c) => normTitle(c.title));
  const featKey = (s: Side) => (s.roadmap?.capabilities ?? []).flatMap((c) => c.features.map((f) => f.feature));
  // Weight disagreements on capabilities matched by key (else by normalised title).
  const wa = new Map((a.roadmap?.capabilities ?? []).map((c) => [c.key, c] as const));
  const wbTitle = new Map((b.roadmap?.capabilities ?? []).map((c) => [normTitle(c.title), c] as const));
  const wb = new Map((b.roadmap?.capabilities ?? []).map((c) => [c.key, c] as const));
  const disagreements: Array<{ capability: string; matchedBy: "key" | "title"; aBp: number; bBp: number; deltaBp: number }> = [];
  for (const [k, c] of wa) {
    const m = wb.get(k) ?? wbTitle.get(normTitle(c.title));
    if (!m) continue;
    disagreements.push({
      capability: k,
      matchedBy: wb.has(k) ? "key" : "title",
      aBp: c.weightBp,
      bBp: m.weightBp,
      deltaBp: m.weightBp - c.weightBp,
    });
  }
  disagreements.sort((x, y) => Math.abs(y.deltaBp) - Math.abs(x.deltaBp) || (x.capability < y.capability ? -1 : 1));
  return {
    schema: "wos-drift-compare.v1",
    target,
    a: fa,
    b: fb,
    overlap: {
      inventoryBySourceUrlAndTitle: itemsUrlTitle,
      inventoryByTitleOnly: itemsTitle,
      capabilitiesByKey: overlap(capKey(a), capKey(b)),
      capabilitiesByTitle: overlap(capTitle(a), capTitle(b)),
      featuresByKey: overlap(featKey(a), featKey(b)),
      newCatalogFeatures: overlap(fa.newCatalogFeatures, fb.newCatalogFeatures),
    },
    largestWeightDisagreements: disagreements.slice(0, 10),
  };
}

export type Comparison = ReturnType<typeof compareSides>;

const list = (xs: string[], max = 25) =>
  xs.length === 0 ? "none" : xs.slice(0, max).join(", ") + (xs.length > max ? `, … (${xs.length - max} more)` : "");
const bp = (v: number | null) => (v === null ? "n/a" : `${(v / 100).toFixed(2)}%`);

export function renderCompareMd(c: Comparison): string {
  const L: string[] = [];
  const { a, b } = c;
  L.push(`# Roadmap drift: ${c.target}, ${a.label} vs ${b.label}`, "");
  L.push(
    "Deterministic comparison (tools/experiments/roadmap-drift). No model judged anything. A textual difference is not",
    "an error by itself, and neither side is ground truth: the Opus roadmap is a reference only after it passes Astra and",
    "human review.",
    "",
  );
  L.push("## Validity", "", `| | ${a.label} | ${b.label} |`, "|---|---|---|");
  L.push(`| schema violations | ${a.schemaViolations.length} | ${b.schemaViolations.length} |`);
  L.push(`| validateRoadmap errors | ${a.validation?.length ?? "not run (schema)"} | ${b.validation?.length ?? "not run (schema)"} |`, "");
  for (const s of [a, b]) {
    L.push(`### ${s.label}`, "");
    if (s.schemaViolations.length) L.push("Schema violations:", "", ...s.schemaViolations.slice(0, 50).map((x) => `- ${x}`), "");
    if (s.validation?.length) {
      const codes = new Map<string, number>();
      for (const v of s.validation) codes.set(v.code, (codes.get(v.code) ?? 0) + 1);
      L.push("validateRoadmap errors by code:", "", ...sorted(codes.keys()).map((k) => `- ${k}: ${codes.get(k)}`), "");
    }
    if (!s.schemaViolations.length && !s.validation?.length) L.push("No schema violations and no validateRoadmap errors.", "");
  }
  L.push("## Inventory", "", `| | ${a.label} | ${b.label} |`, "|---|---|---|");
  L.push(`| items | ${a.inventory.items} | ${b.inventory.items} |`);
  L.push(`| sources | ${a.inventory.sources} | ${b.inventory.sources} |`);
  L.push(`| distinct sources cited by items | ${a.inventory.distinctSourcesCited} | ${b.inventory.distinctSourcesCited} |`);
  L.push(`| surfaces | ${a.inventory.surfaces} | ${b.inventory.surfaces} |`);
  L.push(`| items citing a valid source | ${bp(a.inventory.itemsCitingValidSourceBp)} | ${bp(b.inventory.itemsCitingValidSourceBp)} |`);
  L.push(`| duplicate source URLs | ${a.inventory.duplicateSourceUrls.length} | ${b.inventory.duplicateSourceUrls.length} |`);
  L.push(`| placeholder source URLs | ${a.inventory.placeholderSourceUrls.length} | ${b.inventory.placeholderSourceUrls.length} |`, "");
  const o = c.overlap;
  L.push(
    `Items matched by source URL and normalised title: ${o.inventoryBySourceUrlAndTitle.both}; only in ${a.label}: ${o.inventoryBySourceUrlAndTitle.onlyA.length}; only in ${b.label}: ${o.inventoryBySourceUrlAndTitle.onlyB.length}.`,
    `Items matched by normalised title alone: ${o.inventoryByTitleOnly.both}.`,
    "",
    `Only in ${a.label} (title): ${list(o.inventoryByTitleOnly.onlyA)}`,
    "",
    `Only in ${b.label} (title): ${list(o.inventoryByTitleOnly.onlyB)}`,
    "",
  );
  for (const s of [a, b]) {
    if (s.inventory.duplicateSourceUrls.length) L.push(`${s.label} duplicate source URLs: ${list(s.inventory.duplicateSourceUrls)}`, "");
    if (s.inventory.placeholderSourceUrls.length)
      L.push(`${s.label} placeholder source URLs: ${list(s.inventory.placeholderSourceUrls)}`, "");
  }
  L.push("## Capabilities and features", "", `| | ${a.label} | ${b.label} |`, "|---|---|---|");
  L.push(`| capabilities | ${a.capabilities} | ${b.capabilities} |`);
  L.push(`| mapped capabilities | ${a.mappedCapabilities} | ${b.mappedCapabilities} |`);
  L.push(`| feature refs | ${a.features} | ${b.features} |`);
  L.push(`| excluded items | ${a.excludedItems} | ${b.excludedItems} |`, "");
  L.push(
    `Capabilities in both by key: ${o.capabilitiesByKey.both}; by normalised title: ${o.capabilitiesByTitle.both}. Feature keys in both: ${o.featuresByKey.both}.`,
    "",
    `Capability keys only in ${a.label}: ${list(o.capabilitiesByKey.onlyA)}`,
    "",
    `Capability keys only in ${b.label}: ${list(o.capabilitiesByKey.onlyB)}`,
    "",
  );
  L.push("## Weights", "", `| capability weights | ${a.label} | ${b.label} |`, "|---|---|---|");
  for (const k of ["count", "min", "median", "max", "top3ShareBp"] as const)
    L.push(`| ${k} | ${a.capabilityWeights[k] ?? "n/a"} | ${b.capabilityWeights[k] ?? "n/a"} |`);
  L.push("");
  if (c.largestWeightDisagreements.length) {
    L.push(
      "Largest disagreements on matched capabilities (bp):",
      "",
      `| capability | matched by | ${a.label} | ${b.label} | delta |`,
      "|---|---|---|---|---|",
    );
    for (const d of c.largestWeightDisagreements)
      L.push(`| ${d.capability} | ${d.matchedBy} | ${d.aBp} | ${d.bBp} | ${d.deltaBp > 0 ? "+" : ""}${d.deltaBp} |`);
    L.push("");
  } else L.push("No matched capabilities to compare weights on.", "");
  L.push(
    "## Catalog proposals",
    "",
    `newCatalogFeatures: ${a.label} ${a.newCatalogFeatures.length}, ${b.label} ${b.newCatalogFeatures.length}, in both ${o.newCatalogFeatures.both}.`,
    "",
    `Only in ${a.label}: ${list(o.newCatalogFeatures.onlyA)}`,
    "",
    `Only in ${b.label}: ${list(o.newCatalogFeatures.onlyB)}`,
    "",
  );
  L.push("## Migration (D59)", "", `| data class | ${a.label} | ${b.label} |`, "|---|---|---|");
  const cell = (m: (typeof a.migration.classes)[number]) =>
    !m.present
      ? "MISSING"
      : `${m.complete ? "complete" : "INCOMPLETE"}; ${m.connector ?? "no connector"}; ${m.objects} objects; delta ${m.deltaSync ?? "n/a"}; ${m.notExtractable} not extractable`;
  for (let i = 0; i < a.migration.classes.length; i++)
    L.push(`| ${a.migration.classes[i]!.dataClass} | ${cell(a.migration.classes[i]!)} | ${cell(b.migration.classes[i]!)} |`);
  L.push("");
  return `${L.join("\n")}\n`;
}

/**
 * node tools/experiments/roadmap-drift/compare.ts <dirA> <dirB> [--target salesforce] [--out <dir>]
 * Each dir holds INVENTORY.yaml and ROADMAP.yaml (or roadmaps/<target>/…) and optional catalog/*.yaml, e.g. a checkout
 * of each document's branch in warOnSaaS/product. Writes COMPARE.md and compare.json to --out (default: stdout only).
 */
if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const target = opt("--target") ?? "salesforce";
  const out = opt("--out");
  const [a, b] = args;
  if (!a || !b) {
    process.stderr.write("usage: compare.ts <dirA> <dirB> [--target salesforce] [--out <dir>]\n");
    process.exit(2);
  }
  const c = compareSides(loadSide(a, target), loadSide(b, target), target);
  const md = renderCompareMd(c);
  if (out) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "COMPARE.md"), md);
    writeFileSync(join(out, "compare.json"), `${JSON.stringify(c, null, 2)}\n`);
  }
  process.stdout.write(md);
}

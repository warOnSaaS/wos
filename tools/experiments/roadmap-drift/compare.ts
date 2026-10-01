/**
 * `compare A B`: a deterministic comparison of two roadmaps of one target (GLM vs GLM, or GLM vs Opus). No model judges
 * anything. A textual difference is not an error by itself, and neither side is ground truth: a roadmap becomes a
 * reference only after it passes Astra and human review.
 *
 * A side is a folder (INVENTORY.yaml and ROADMAP.yaml at its root or under roadmaps/<target>/, optional catalog/*.yaml,
 * and, for a shadow or failed run archived by `wos roadmap --shadow`, its run.json with the fetch log), or a git ref of a
 * product checkout written `<repo dir>@<ref>` (e.g. ~/product@origin/wos/roadmap/salesforce/v1).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { AGENT_POLICY, type CatalogEntry, type Inventory, MIGRATION_DATA_CLASSES, type Roadmap } from "@waronsaas/contracts";
import {
  ensembleStability,
  parseCatalogEntryYaml,
  parseInventoryYaml,
  parseRoadmapYaml,
  rubricWeights,
  validateRoadmap,
} from "@waronsaas/planning";

export interface Side {
  label: string;
  source: string;
  inventory: Inventory | null;
  roadmap: Roadmap | null;
  catalog: Map<string, CatalogEntry>;
  schemaViolations: string[];
  /** The run's fetch log (run.json `fetches`), when the side is an archived run. */
  fetches: Array<{ kind: string; target: string }> | null;
}

type Reader = { read(path: string): string | null; list(dir: string): string[] };

function folderReader(dir: string): Reader {
  return {
    read: (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : null),
    list: (d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)) : []),
  };
}

function gitReader(repo: string, ref: string): Reader {
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return {
    read: (p) => {
      try {
        return git("show", `${ref}:${p}`);
      } catch {
        return null;
      }
    },
    list: (d) => {
      try {
        return git("ls-tree", "--name-only", `${ref}:${d}`).split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

export function loadSide(spec: string, target: string, label?: string): Side {
  const at = spec.lastIndexOf("@");
  const isGit = at > 0 && !existsSync(spec) && existsSync(join(spec.slice(0, at), ".git"));
  const r = isGit ? gitReader(spec.slice(0, at), spec.slice(at + 1)) : folderReader(spec);
  const side: Side = {
    label: label ?? (isGit ? spec.slice(at + 1) : basename(spec)),
    source: spec,
    inventory: null,
    roadmap: null,
    catalog: new Map(),
    schemaViolations: [],
    fetches: null,
  };
  const file = (name: string) => r.read(name) ?? r.read(`roadmaps/${target}/${name}`);
  const inv = file("INVENTORY.yaml");
  const rm = file("ROADMAP.yaml");
  if (inv === null) side.schemaViolations.push("INVENTORY.yaml: missing");
  else {
    const p = parseInventoryYaml(inv);
    if (p.ok) side.inventory = p.value;
    else for (const e of p.errors) side.schemaViolations.push(`INVENTORY.yaml ${e.path}: ${e.message}`);
  }
  if (rm === null) side.schemaViolations.push("ROADMAP.yaml: missing");
  else {
    const p = parseRoadmapYaml(rm);
    if (p.ok) side.roadmap = p.value;
    else for (const e of p.errors) side.schemaViolations.push(`ROADMAP.yaml ${e.path}: ${e.message}`);
  }
  for (const f of r
    .list("catalog")
    .filter((n) => n.endsWith(".yaml"))
    .sort()) {
    const p = parseCatalogEntryYaml(r.read(`catalog/${f}`) ?? "");
    if (p.ok) side.catalog.set(f.slice(0, -5), p.value);
    else for (const e of p.errors) side.schemaViolations.push(`catalog/${f} ${e.path}: ${e.message}`);
  }
  const run = r.read("run.json");
  if (run) {
    try {
      const j = JSON.parse(run) as { fetches?: Array<{ kind: string; target: string }> };
      side.fetches = j.fetches ?? [];
    } catch {
      side.fetches = null;
    }
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
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`;
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
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

function stats(ws: number[]) {
  if (ws.length === 0) return { count: 0, min: null, max: null, median: null, top3ShareBp: null };
  const s = [...ws].sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
  return {
    count: s.length,
    min: s[0]!,
    max: s[s.length - 1]!,
    median: mid,
    top3ShareBp: [...s]
      .reverse()
      .slice(0, 3)
      .reduce((n, x) => n + x, 0),
  };
}

/** Spearman's rank correlation (average ranks for ties); null below 3 pairs or with no variance. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]!.x === idx[i]!.x) j++;
      for (let k = i; k <= j; k++) r[idx[k]!.i] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : round(num / Math.sqrt(dx * dy));
}

function sideFacts(s: Side, target: string) {
  const inv = s.inventory;
  const rm = s.roadmap;
  const scanIds = AGENT_POLICY.roadmapMethod?.targets[target]?.scanCapabilityIds ?? null;
  const validation = inv && rm ? validateRoadmap(rm, inv, s.catalog, null).map((i) => ({ code: i.code, message: i.message })) : null;
  const methodValidation =
    inv && rm && AGENT_POLICY.roadmapMethod
      ? validateRoadmap(rm, inv, s.catalog, null, { scanCapabilityIds: scanIds, requireRubric: true })
          .filter((i) => /^(SCAN_|RUBRIC_)/.test(i.code))
          .map((i) => ({ code: i.code, message: i.message }))
      : null;
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
  // Scan coverage (D72): which of the target's scan capability ids the roadmap places or excludes.
  const placed = new Set((rm?.capabilities ?? []).flatMap((c) => c.scanIds ?? []));
  const excluded = new Set((rm?.scanExcluded ?? []).map((e) => e.scanId));
  const scanCoverage = scanIds
    ? {
        total: scanIds.length,
        placed: scanIds.filter((id) => placed.has(id)).length,
        excluded: scanIds.filter((id) => excluded.has(id)).length,
        unaccounted: scanIds.filter((id) => !placed.has(id) && !excluded.has(id)),
      }
    : null;
  // Citations vs the run's fetch log: inventory source URLs the run actually fetched, and the required reading read.
  const fetched = s.fetches ? new Set(s.fetches.filter((f) => f.kind === "fetch").map((f) => normUrl(f.target))) : null;
  const required = AGENT_POLICY.roadmapMethod?.targets[target]?.requiredReading ?? [];
  const fetchLog = fetched
    ? {
        fetches: s.fetches!.filter((f) => f.kind === "fetch").length,
        searches: s.fetches!.filter((f) => f.kind === "search").length,
        inventorySourcesFetched: sources.filter((x) => fetched.has(normUrl(x.url))).length,
        inventorySources: sources.length,
        requiredReadingFetched: required.filter((r) => fetched.has(normUrl(r.url))).map((r) => r.kind),
        requiredReadingMissed: required.filter((r) => !fetched.has(normUrl(r.url))).map((r) => r.kind),
      }
    : null;
  const derived = rm ? rubricWeights(rm.capabilities) : null;
  return {
    label: s.label,
    source: s.source,
    target,
    schemaViolations: s.schemaViolations,
    validation,
    methodValidation,
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
    rubric: rm
      ? {
          declared: rm.weightRubric ?? null,
          scored: rm.capabilities.filter((c) => c.rubric).length,
          weightsFollow: derived ? rm.capabilities.every((c, i) => Math.abs(c.weightBp - derived[i]!) <= 1) : null,
        }
      : null,
    newCatalogFeatures: sorted(rm?.newCatalogFeatures ?? []),
    migration: { present: rm?.migration !== undefined, engine: rm?.migration?.engine ?? null, classes: migration },
    scanCoverage,
    fetchLog,
  };
}

function itemKeys(s: Side) {
  const inv = s.inventory;
  const byUrlTitle = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const it of inv?.items ?? []) {
    byUrlTitle.set(`${normUrl(inv!.sources[it.source]?.url ?? "")}|${normTitle(it.title)}`, it.key);
    byTitle.set(normTitle(it.title), it.key);
  }
  return { byUrlTitle, byTitle };
}

function overlap(a: Iterable<string>, b: Iterable<string>) {
  const A = new Set(a);
  const B = new Set(b);
  return {
    both: [...A].filter((x) => B.has(x)).length,
    onlyA: sorted([...A].filter((x) => !B.has(x))),
    onlyB: sorted([...B].filter((x) => !A.has(x))),
  };
}

type Cap = Roadmap["capabilities"][number];
/** Capability pairs: by key, else by normalised title, else by the largest shared set of scan ids (Jaccard >= 0.5). */
function matchCapabilities(a: Cap[], b: Cap[]) {
  const pairs: Array<{ a: Cap; b: Cap; by: "key" | "title" | "scanIds" }> = [];
  const used = new Set<Cap>();
  for (const ca of a) {
    let m: Cap | undefined = b.find((cb) => !used.has(cb) && cb.key === ca.key);
    let by: "key" | "title" | "scanIds" = "key";
    if (!m) {
      m = b.find((cb) => !used.has(cb) && normTitle(cb.title) === normTitle(ca.title));
      by = "title";
    }
    if (!m && (ca.scanIds ?? []).length > 0) {
      let best = 0;
      for (const cb of b) {
        if (used.has(cb)) continue;
        const A = new Set(ca.scanIds);
        const B = new Set(cb.scanIds ?? []);
        const inter = [...A].filter((x) => B.has(x)).length;
        const j = inter / new Set([...A, ...B]).size;
        if (j >= 0.5 && j > best) {
          best = j;
          m = cb;
        }
      }
      by = "scanIds";
    }
    if (m) {
      used.add(m);
      pairs.push({ a: ca, b: m, by });
    }
  }
  return pairs;
}

export function compareSides(a: Side, b: Side, target: string) {
  const fa = sideFacts(a, target);
  const fb = sideFacts(b, target);
  const ka = itemKeys(a);
  const kb = itemKeys(b);
  const capsA = a.roadmap?.capabilities ?? [];
  const capsB = b.roadmap?.capabilities ?? [];
  const pairs = matchCapabilities(capsA, capsB);
  const deltas = pairs.map((p) => ({
    capability: p.a.key,
    other: p.b.key,
    matchedBy: p.by,
    aBp: p.a.weightBp,
    bBp: p.b.weightBp,
    deltaBp: p.b.weightBp - p.a.weightBp,
  }));
  deltas.sort((x, y) => Math.abs(y.deltaBp) - Math.abs(x.deltaBp) || (x.capability < y.capability ? -1 : 1));
  // Weight agreement per scan id: the weight of the capability each side placed it in (shares, so comparable).
  const scanIds = AGENT_POLICY.roadmapMethod?.targets[target]?.scanCapabilityIds ?? [];
  const weightOf = (caps: Cap[], id: string) => caps.find((c) => (c.scanIds ?? []).includes(id))?.weightBp ?? null;
  const perScan = scanIds.map((id) => ({ id, a: weightOf(capsA, id), b: weightOf(capsB, id) })).filter((x) => x.a !== null && x.b !== null);
  const scanIdsSameCapability = (() => {
    const home = (caps: Cap[]) => new Map(caps.flatMap((c) => (c.scanIds ?? []).map((id) => [id, c] as const)));
    const ha = home(capsA);
    const hb = home(capsB);
    const pairOf = new Map(pairs.map((p) => [p.a, p.b]));
    const both = scanIds.filter((id) => ha.has(id) && hb.has(id));
    return { comparable: both.length, same: both.filter((id) => pairOf.get(ha.get(id)!) === hb.get(id)).length };
  })();
  // D73: the policy's stability targets (capabilities, features, weights, grounding), measured the way an ensemble is.
  const targets = AGENT_POLICY.ensemble?.stabilityTargets ?? null;
  const ms = AGENT_POLICY.roadmapMethod?.targets[target]?.scanSources ?? [];
  const asRun = (s: Side) => ({
    inventory: s.inventory!,
    roadmap: s.roadmap!,
    catalog: s.catalog,
    fetchedUrls: (s.fetches ?? []).filter((f) => f.kind === "fetch").map((f) => f.target),
  });
  const stability =
    targets && a.inventory && a.roadmap && b.inventory && b.roadmap
      ? { ...ensembleStability([asRun(a), asRun(b)], ms, targets), targets, groundingMeasured: a.fetches !== null && b.fetches !== null }
      : null;
  return {
    schema: "wos-drift-compare.v2",
    stability,
    target,
    a: fa,
    b: fb,
    overlap: {
      inventoryBySourceUrlAndTitle: overlap(ka.byUrlTitle.keys(), kb.byUrlTitle.keys()),
      inventoryByTitleOnly: overlap(ka.byTitle.keys(), kb.byTitle.keys()),
      capabilitiesByKey: overlap(
        capsA.map((c) => c.key),
        capsB.map((c) => c.key),
      ),
      capabilitiesByTitle: overlap(
        capsA.map((c) => normTitle(c.title)),
        capsB.map((c) => normTitle(c.title)),
      ),
      capabilitiesMatched: pairs.length,
      featuresByKey: overlap(
        capsA.flatMap((c) => c.features.map((f) => f.feature)),
        capsB.flatMap((c) => c.features.map((f) => f.feature)),
      ),
      newCatalogFeatures: overlap(fa.newCatalogFeatures, fb.newCatalogFeatures),
      scanIdsInMatchedCapabilities: scanIdsSameCapability,
    },
    weights: {
      matchedCapabilities: deltas.length,
      meanAbsDeltaBp: deltas.length ? round(deltas.reduce((n, d) => n + Math.abs(d.deltaBp), 0) / deltas.length, 1) : null,
      spearmanMatchedCapabilities: spearman(
        deltas.map((d) => d.aBp),
        deltas.map((d) => d.bBp),
      ),
      perScanId: {
        comparable: perScan.length,
        meanAbsDeltaBp: perScan.length ? round(perScan.reduce((n, x) => n + Math.abs(x.a! - x.b!), 0) / perScan.length, 1) : null,
        spearman: spearman(
          perScan.map((x) => x.a!),
          perScan.map((x) => x.b!),
        ),
      },
      largestDisagreements: deltas.slice(0, 10),
    },
  };
}

export type Comparison = ReturnType<typeof compareSides>;

const list = (xs: string[], max = 25) =>
  xs.length === 0 ? "none" : xs.slice(0, max).join(", ") + (xs.length > max ? `, … (${xs.length - max} more)` : "");
const bp = (v: number | null) => (v === null ? "n/a" : `${(v / 100).toFixed(2)}%`);
const v = (x: unknown) => (x === null || x === undefined ? "n/a" : String(x));

export function renderCompareMd(c: Comparison): string {
  const L: string[] = [];
  const { a, b } = c;
  const row = (name: string, x: unknown, y: unknown) => L.push(`| ${name} | ${v(x)} | ${v(y)} |`);
  L.push(`# Roadmap drift: ${c.target}, ${a.label} vs ${b.label}`, "");
  L.push(
    "Deterministic comparison (tools/experiments/roadmap-drift). No model judged anything. A textual difference is not",
    "an error by itself, and neither side is ground truth: a roadmap is a reference only after it passes Astra and",
    "human review.",
    "",
    `Sources: \`${a.source}\` and \`${b.source}\`.`,
    "",
  );
  L.push("## Validity", "", `| | ${a.label} | ${b.label} |`, "|---|---|---|");
  row("schema violations", a.schemaViolations.length, b.schemaViolations.length);
  row("validateRoadmap errors", a.validation?.length ?? "not run (schema)", b.validation?.length ?? "not run (schema)");
  row("D72 method errors (scan, rubric)", a.methodValidation?.length ?? "n/a", b.methodValidation?.length ?? "n/a");
  L.push("");
  for (const s of [a, b]) {
    L.push(`### ${s.label}`, "");
    if (s.schemaViolations.length) L.push("Schema violations:", "", ...s.schemaViolations.slice(0, 50).map((x) => `- ${x}`), "");
    const all = [...(s.validation ?? []), ...(s.methodValidation ?? [])];
    if (all.length) {
      const codes = new Map<string, number>();
      for (const x of all) codes.set(x.code, (codes.get(x.code) ?? 0) + 1);
      L.push("Errors by code:", "", ...sorted(codes.keys()).map((k) => `- ${k}: ${codes.get(k)}`), "");
    } else if (!s.schemaViolations.length) L.push("No schema violations and no validator errors.", "");
  }
  if (c.stability) {
    const st = c.stability;
    const t = st.targets;
    const ok = (k: string) => (st.belowTarget.includes(k) ? "BELOW TARGET" : "meets target");
    L.push(
      "## Stability against the D73 targets",
      "",
      "| measure | value | target | |",
      "|---|---|---|---|",
      `| capabilities matched (by key) | ${bp(st.capabilitiesMatchBp)} | ${bp(t.capabilitiesMatchBp)} | ${ok("capabilities")} |`,
      `| features matched (Jaccard) | ${bp(st.featuresMatchBp)} | ${bp(t.featuresMatchBp)} | ${ok("features")} |`,
      `| weight rank correlation (Spearman, common capabilities) | ${v(st.weightSpearman)} | ${t.weightSpearman} | ${ok("weights")} |`,
      `| sources grounded (fetch log or scan) | ${bp(st.groundingBp)} | ${bp(t.groundingBp)} | ${st.groundingMeasured ? ok("grounding") : "no fetch log on a side"} |`,
      "",
    );
  }
  L.push("## Scan coverage (D72)", "", `| | ${a.label} | ${b.label} |`, "|---|---|---|");
  row(
    "scan ids placed",
    a.scanCoverage ? `${a.scanCoverage.placed}/${a.scanCoverage.total}` : null,
    b.scanCoverage ? `${b.scanCoverage.placed}/${b.scanCoverage.total}` : null,
  );
  row("scan ids excluded", a.scanCoverage?.excluded, b.scanCoverage?.excluded);
  row("scan ids unaccounted", a.scanCoverage?.unaccounted.length, b.scanCoverage?.unaccounted.length);
  row(
    "scan ids in matching capabilities",
    `${c.overlap.scanIdsInMatchedCapabilities.same}/${c.overlap.scanIdsInMatchedCapabilities.comparable}`,
    "",
  );
  L.push("");
  L.push("## Inventory", "", `| | ${a.label} | ${b.label} |`, "|---|---|---|");
  row("items", a.inventory.items, b.inventory.items);
  row("sources", a.inventory.sources, b.inventory.sources);
  row("distinct sources cited by items", a.inventory.distinctSourcesCited, b.inventory.distinctSourcesCited);
  row("surfaces", a.inventory.surfaces, b.inventory.surfaces);
  row("items citing a valid source", bp(a.inventory.itemsCitingValidSourceBp), bp(b.inventory.itemsCitingValidSourceBp));
  row("duplicate source URLs", a.inventory.duplicateSourceUrls.length, b.inventory.duplicateSourceUrls.length);
  row("placeholder source URLs", a.inventory.placeholderSourceUrls.length, b.inventory.placeholderSourceUrls.length);
  row(
    "inventory sources in the run's fetch log",
    a.fetchLog ? `${a.fetchLog.inventorySourcesFetched}/${a.fetchLog.inventorySources}` : "no fetch log",
    b.fetchLog ? `${b.fetchLog.inventorySourcesFetched}/${b.fetchLog.inventorySources}` : "no fetch log",
  );
  row(
    "required reading fetched",
    a.fetchLog ? list(a.fetchLog.requiredReadingFetched) : null,
    b.fetchLog ? list(b.fetchLog.requiredReadingFetched) : null,
  );
  row(
    "required reading missed",
    a.fetchLog ? list(a.fetchLog.requiredReadingMissed) : null,
    b.fetchLog ? list(b.fetchLog.requiredReadingMissed) : null,
  );
  L.push("");
  const o = c.overlap;
  L.push(
    `Items matched by source URL and normalised title: ${o.inventoryBySourceUrlAndTitle.both}; only in ${a.label}: ${o.inventoryBySourceUrlAndTitle.onlyA.length}; only in ${b.label}: ${o.inventoryBySourceUrlAndTitle.onlyB.length}. By normalised title alone: ${o.inventoryByTitleOnly.both}.`,
    "",
    `Only in ${a.label} (title): ${list(o.inventoryByTitleOnly.onlyA)}`,
    "",
    `Only in ${b.label} (title): ${list(o.inventoryByTitleOnly.onlyB)}`,
    "",
  );
  L.push("## Capabilities and features", "", `| | ${a.label} | ${b.label} |`, "|---|---|---|");
  row("capabilities", a.capabilities, b.capabilities);
  row("mapped capabilities", a.mappedCapabilities, b.mappedCapabilities);
  row("feature refs", a.features, b.features);
  row("excluded items", a.excludedItems, b.excludedItems);
  L.push("");
  L.push(
    `Capabilities matched (key, title or shared scan ids): ${o.capabilitiesMatched}; by key: ${o.capabilitiesByKey.both}; by title: ${o.capabilitiesByTitle.both}. Feature keys in both: ${o.featuresByKey.both}.`,
    "",
  );
  const w = c.weights;
  L.push("## Weights", "", `| capability weights | ${a.label} | ${b.label} |`, "|---|---|---|");
  for (const k of ["count", "min", "median", "max", "top3ShareBp"] as const) row(k, a.capabilityWeights[k], b.capabilityWeights[k]);
  row(
    "rubric (declared / scored / weights follow)",
    a.rubric ? `${v(a.rubric.declared)} / ${a.rubric.scored} / ${v(a.rubric.weightsFollow)}` : null,
    b.rubric ? `${v(b.rubric.declared)} / ${b.rubric.scored} / ${v(b.rubric.weightsFollow)}` : null,
  );
  L.push(
    "",
    `Matched capabilities: ${w.matchedCapabilities}; mean absolute weight difference ${v(w.meanAbsDeltaBp)} bp; Spearman rank correlation ${v(w.spearmanMatchedCapabilities)}.`,
    `Per scan id (the weight of the capability each side placed it in): ${w.perScanId.comparable} comparable; mean absolute difference ${v(w.perScanId.meanAbsDeltaBp)} bp; Spearman ${v(w.perScanId.spearman)}.`,
    "",
  );
  if (w.largestDisagreements.length) {
    L.push(
      "Largest disagreements (bp):",
      "",
      `| ${a.label} | ${b.label} | matched by | ${a.label} bp | ${b.label} bp | delta |`,
      "|---|---|---|---|---|---|",
    );
    for (const d of w.largestDisagreements)
      L.push(`| ${d.capability} | ${d.other} | ${d.matchedBy} | ${d.aBp} | ${d.bBp} | ${d.deltaBp > 0 ? "+" : ""}${d.deltaBp} |`);
    L.push("");
  }
  L.push(
    "## Catalog proposals",
    "",
    `newCatalogFeatures: ${a.label} ${a.newCatalogFeatures.length}, ${b.label} ${b.newCatalogFeatures.length}, in both ${o.newCatalogFeatures.both}.`,
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
 * node tools/experiments/roadmap-drift/compare.ts <A> <B> [--target salesforce] [--out <dir>]
 * A and B: folders (e.g. ~/.wos/shadow/<task>/<run>) or `<product checkout>@<ref>`. Writes COMPARE.md and compare.json
 * to --out when given, and prints COMPARE.md.
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
    process.stderr.write("usage: compare.ts <A> <B> [--target salesforce] [--out <dir>]   (A, B: a folder or <repo>@<ref>)\n");
    process.exit(2);
  }
  const c = compareSides(loadSide(a, target, "A"), loadSide(b, target, "B"), target);
  const md = renderCompareMd(c);
  if (out) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "COMPARE.md"), md);
    writeFileSync(join(out, "compare.json"), `${JSON.stringify(c, null, 2)}\n`);
  }
  process.stdout.write(md);
}

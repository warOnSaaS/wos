/**
 * D73 ensemble authoring (contracts 5.20.0): N runs of one roadmap_author context merged DETERMINISTICALLY into one
 * revision. No model is involved in the merge.
 *
 * Majority: an element is accepted when at least `threshold(N) = floor(N/2) + 1` runs have it (strict majority).
 * - Inventory items match across runs by normalised title. Accepted items are renumbered INV-0001.. in order of
 *   first appearance (run order, then item order). Each takes its fields from the first run that has it, and its
 *   scanId and feature from the majority of the runs that have it.
 * - Capabilities: those present (by key) in a majority of runs. Each item goes to the capability the majority of
 *   runs put it in, else to the first run's choice (a decision). Rubric scores are the median of each criterion over
 *   the runs that score the capability (the lower median for an even count); weights follow `rubricWeights`.
 * - Feature references: per capability, the features a majority of runs reference. A feature's weight is the median of
 *   its weights, renormalised in the capability by largest remainder. Its surfaces and journeys come from the first
 *   run that has it.
 * - Migration: per data class, the variant (canonical JSON) a majority of runs wrote, else the first run's (a decision).
 * - Every element that misses the majority is recorded as a decision (`ensemble_disagreement`): what each run said,
 *   with its sources. The runs' own template and catalog decisions are kept. Decisions are renumbered DEC-001.
 */
import { type CatalogEntry, type Inventory, MIGRATION_DATA_CLASSES, type Roadmap, type RoadmapDecision } from "@waronsaas/contracts";
import { stringify } from "yaml";
import { citedUrls, defaultCatalogEntry, groundingKey, rubricWeights } from "./roadmap.js";

export interface EnsembleRun {
  inventory: Inventory;
  roadmap: Roadmap;
  catalog: ReadonlyMap<string, CatalogEntry>;
  /** URLs the run fetched (its fetch log). */
  fetchedUrls: readonly string[];
}

export const majorityThreshold = (n: number) => Math.floor(n / 2) + 1;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, (x as Record<string, unknown>)[k]]),
        )
      : x,
  );
const lowerMedian = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!;

/** The value most runs chose (ties: the first in run order) and whether it reached `threshold`. */
function vote<T>(values: Array<{ run: number; value: T }>, key: (v: T) => string, threshold: number) {
  const counts = new Map<string, { value: T; runs: number[] }>();
  for (const v of values) {
    const k = key(v.value);
    const e = counts.get(k) ?? { value: v.value, runs: [] };
    e.runs.push(v.run);
    counts.set(k, e);
  }
  const ranked = [...counts.values()].sort((a, b) => b.runs.length - a.runs.length || a.runs[0]! - b.runs[0]!);
  return { winner: ranked[0]!, majority: (ranked[0]?.runs.length ?? 0) >= threshold, all: ranked };
}

/** Largest-remainder apportionment of 10000 proportional to `parts` (ties: order). */
function apportion(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0) || 1;
  const exact = parts.map((p) => (p * 10_000) / total);
  const out = exact.map(Math.floor);
  let left = 10_000 - out.reduce((a, b) => a + b, 0);
  for (const { i } of exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i)) {
    if (left-- <= 0) break;
    out[i]!++;
  }
  return out;
}

export interface EnsembleMerge {
  inventory: Inventory;
  roadmap: Roadmap;
  /** Catalog files the merged revision adds (vocabulary defaults rendered from the vocabulary; proposals from a run). */
  catalogFiles: CatalogEntry[];
  decisions: RoadmapDecision[];
  threshold: number;
}

export function mergeRoadmapRuns(
  runs: readonly EnsembleRun[],
  opts: { vocabulary: ReadonlyArray<{ id: string; group: string; definition: string }>; existingCatalog: ReadonlySet<string> },
): EnsembleMerge {
  if (runs.length < 2) throw new Error("an ensemble merges at least 2 runs");
  const N = runs.length;
  const t = majorityThreshold(N);
  const R = (i: number) => i + 1; // runs are numbered 1..N in decisions
  const decisions: Array<Omit<RoadmapDecision, "id">> = [];
  const sourceOf = (run: EnsembleRun, idx: number) => run.inventory.sources[idx]?.url ?? "";

  // ---- inventory items, by normalised title
  type Seen = { run: number; item: Inventory["items"][number] };
  const byTitle = new Map<string, Seen[]>();
  runs.forEach((r, i) => {
    for (const it of r.inventory.items) {
      const k = norm(it.title);
      if (!byTitle.has(k)) byTitle.set(k, []);
      if (!byTitle.get(k)!.some((s) => s.run === i)) byTitle.get(k)!.push({ run: i, item: it });
    }
  });
  const accepted: Array<{ key: string; title: string; seen: Seen[] }> = [];
  for (const [k, seen] of byTitle) {
    if (seen.length >= t) accepted.push({ key: k, title: seen[0]!.item.title, seen });
    else
      decisions.push({
        kind: "ensemble_disagreement",
        subject: seen[0]!.item.title,
        summary: `Inventory item in ${seen.length} of ${N} runs (below the majority of ${t}): left out.`,
        options: [
          {
            label: "include",
            runs: seen.map((s) => R(s.run)),
            detail: seen[0]!.item.description,
            sources: [...new Set(seen.map((s) => sourceOf(runs[s.run]!, s.item.source)))],
          },
          { label: "omit", runs: runs.map((_, i) => R(i)).filter((r) => !seen.some((s) => R(s.run) === r)), detail: "", sources: [] },
        ],
        chosen: "omitted",
      });
  }
  const sources: Inventory["sources"] = [];
  const sourceIndex = (url: string, from: Inventory["sources"][number] | undefined) => {
    let i = sources.findIndex((s) => s.url === url);
    if (i < 0) {
      sources.push({ title: from?.title ?? url, url, retrievedOn: from?.retrievedOn ?? "2026-01-01" });
      i = sources.length - 1;
    }
    return i;
  };
  const itemKey = new Map<string, string>(); // normalised title -> merged INV key
  const items: Inventory["items"] = accepted.map((a, n) => {
    const rep = a.seen[0]!;
    const repRun = runs[rep.run]!;
    const key = `INV-${String(n + 1).padStart(4, "0")}`;
    itemKey.set(a.key, key);
    const scan = vote(
      a.seen.map((s) => ({ run: s.run, value: s.item.scanId ?? null })),
      (v) => String(v),
      t,
    );
    if (!scan.majority && scan.all.length > 1)
      decisions.push({
        kind: "ensemble_disagreement",
        subject: a.title,
        summary: `No majority on the item's scan id; the first run's choice is kept.`,
        options: scan.all.map((o) => ({ label: `scanId ${o.value ?? "null"}`, runs: o.runs.map(R), detail: "", sources: [] })),
        chosen: `scanId ${scan.winner.value ?? "null"}`,
      });
    return {
      key,
      area: rep.item.area,
      title: rep.item.title,
      description: rep.item.description,
      source: sourceIndex(sourceOf(repRun, rep.item.source), repRun.inventory.sources[rep.item.source]),
      weight: 1,
      scanId: scan.winner.value,
    };
  });
  // Inventory surfaces: by surface, majority.
  const surf = new Map<string, Array<{ run: number; s: Inventory["surfaces"][number] }>>();
  runs.forEach((r, i) => {
    for (const s of r.inventory.surfaces) surf.set(s.surface, [...(surf.get(s.surface) ?? []), { run: i, s }]);
  });
  const invSurfaces: Inventory["surfaces"] = [];
  for (const [surface, xs] of surf) {
    if (xs.length < t) continue;
    const rep = xs[0]!;
    invSurfaces.push({
      ...rep.s,
      surface: rep.s.surface,
      source: sourceIndex(sourceOf(runs[rep.run]!, rep.s.source), runs[rep.run]!.inventory.sources[rep.s.source]),
    });
    void surface;
  }
  const inventory: Inventory = {
    schema: "wos-inventory.v1",
    target: runs[0]!.inventory.target,
    version: runs[0]!.inventory.version,
    sources,
    surfaces: invSurfaces,
    items,
  };

  // ---- placements: run item (by title) -> capability key, feature key; or excluded
  const placement = runs.map((r) => {
    const titleOf = new Map(r.inventory.items.map((i) => [i.key, norm(i.title)]));
    const cap = new Map<string, string>();
    const feat = new Map<string, string>();
    for (const c of r.roadmap.capabilities) {
      for (const k of c.inventoryItems) cap.set(titleOf.get(k) ?? k, c.key);
      for (const f of c.features) for (const k of f.inventoryItems) feat.set(titleOf.get(k) ?? k, f.feature);
    }
    const excluded = new Map(r.roadmap.excluded.map((e) => [titleOf.get(e.item) ?? e.item, e.reason]));
    return { cap, feat, excluded };
  });

  // ---- capabilities: present in a majority of runs, in first-appearance order
  const capRuns = new Map<string, Array<{ run: number; c: Roadmap["capabilities"][number] }>>();
  runs.forEach((r, i) => {
    for (const c of r.roadmap.capabilities) capRuns.set(c.key, [...(capRuns.get(c.key) ?? []), { run: i, c }]);
  });
  const capKeys = [...capRuns].filter(([, xs]) => xs.length >= t).map(([k]) => k);
  for (const [k, xs] of capRuns)
    if (xs.length < t)
      decisions.push({
        kind: "ensemble_disagreement",
        subject: k,
        summary: `Capability in ${xs.length} of ${N} runs (below the majority of ${t}): left out; its items go where the majority put them.`,
        options: [{ label: "capability", runs: xs.map((x) => R(x.run)), detail: xs[0]!.c.summary, sources: xs[0]!.c.sources ?? [] }],
        chosen: "left out",
      });

  const itemCap = new Map<string, string | null>(); // normalised title -> capability key (null = excluded)
  const excludedReason = new Map<string, string>();
  for (const a of accepted) {
    const votes = a.seen.map((s) => {
      const p = placement[s.run]!;
      return { run: s.run, value: p.excluded.has(a.key) ? "__excluded__" : (p.cap.get(a.key) ?? "__none__") };
    });
    const live = votes.filter((v) => v.value === "__excluded__" || capKeys.includes(v.value));
    const v = vote(live.length ? live : votes, (x) => x, t);
    let choice = v.winner.value;
    if (!capKeys.includes(choice) && choice !== "__excluded__") choice = capKeys[0]!;
    if (!v.majority)
      decisions.push({
        kind: "ensemble_disagreement",
        subject: a.title,
        summary: "No majority on where this item belongs; the most common choice (first run on a tie) is kept.",
        options: v.all.map((o) => ({
          label: o.value === "__excluded__" ? "excluded" : `in ${o.value}`,
          runs: o.runs.map(R),
          detail: "",
          sources: [],
        })),
        chosen: choice === "__excluded__" ? "excluded" : `in ${choice}`,
      });
    if (choice === "__excluded__") {
      itemCap.set(a.key, null);
      const rep = a.seen.find((s) => placement[s.run]!.excluded.has(a.key))!;
      excludedReason.set(a.key, placement[rep.run]!.excluded.get(a.key)!);
    } else itemCap.set(a.key, choice);
  }

  // ---- feature membership per item (majority of runs that have the item)
  const itemFeat = new Map<string, string | null>();
  for (const a of accepted) {
    const votes = a.seen.map((s) => ({ run: s.run, value: placement[s.run]!.feat.get(a.key) ?? "__none__" }));
    const v = vote(votes, (x) => x, t);
    itemFeat.set(a.key, v.winner.value === "__none__" ? null : v.winner.value);
  }

  // ---- capabilities with rubric medians, features
  const capabilities: Roadmap["capabilities"] = capKeys.map((key) => {
    const xs = capRuns.get(key)!;
    const rep = xs[0]!.c;
    const scored = xs.filter((x) => x.c.rubric);
    const crit = ["editionBreadth", "coreDailyUse", "surfaceParity", "migrationGravity"] as const;
    const rubric = scored.length
      ? (Object.fromEntries(
          crit.map((k) => {
            const med = lowerMedian(scored.map((x) => x.c.rubric![k].score));
            const basis = scored.find((x) => x.c.rubric![k].score === med)!.c.rubric![k].basis;
            return [k, { score: med, basis }];
          }),
        ) as NonNullable<Roadmap["capabilities"][number]["rubric"]>)
      : undefined;
    const members = accepted.filter((a) => itemCap.get(a.key) === key).map((a) => a);
    const memberKeys = members.map((a) => itemKey.get(a.key)!);
    // Features referenced by a majority of runs, in this capability.
    const fRuns = new Map<string, Array<{ run: number; f: Roadmap["capabilities"][number]["features"][number] }>>();
    for (const x of xs) for (const f of x.c.features) fRuns.set(f.feature, [...(fRuns.get(f.feature) ?? []), { run: x.run, f }]);
    const fKeys = [...fRuns].filter(([, ys]) => ys.length >= t).map(([k]) => k);
    for (const [k, ys] of fRuns)
      if (ys.length < t)
        decisions.push({
          kind: "ensemble_disagreement",
          subject: `${key}/${k}`,
          summary: `Feature reference in ${ys.length} of ${N} runs (below the majority of ${t}): left out of ${key}.`,
          options: [{ label: "reference", runs: ys.map((y) => R(y.run)), detail: ys[0]!.f.appNotes, sources: [] }],
          chosen: "left out",
        });
    const featItems = new Map<string, string[]>(fKeys.map((k) => [k, []]));
    for (const a of members) {
      const want = itemFeat.get(a.key);
      const scanId = items.find((i) => i.key === itemKey.get(a.key))!.scanId;
      const target = want && featItems.has(want) ? want : scanId && featItems.has(scanId) ? scanId : fKeys[0];
      if (target) featItems.get(target)!.push(itemKey.get(a.key)!);
      if (target && target !== want)
        decisions.push({
          kind: "ensemble_disagreement",
          subject: a.title,
          summary: `The item's feature (${want ?? "none"}) did not reach the majority in ${key}; the merge rule put it in ${target}.`,
          options: [],
          chosen: `in feature ${target}`,
        });
    }
    const kept = fKeys.filter((k) => featItems.get(k)!.length > 0);
    const weights = apportion(kept.map((k) => lowerMedian(fRuns.get(k)!.map((y) => y.f.weightBp))));
    const features = kept.map((k, i) => {
      const f = fRuns.get(k)![0]!.f;
      return { ...f, weightBp: weights[i]!, inventoryItems: featItems.get(k)! };
    });
    return {
      ...rep,
      inventoryItems: memberKeys,
      features: memberKeys.length ? features : [],
      ...(rubric ? { rubric } : {}),
      weightRationale: rubric
        ? `Rubric medians over ${scored.length} runs: edition breadth ${rubric.editionBreadth.score}, core daily use ${rubric.coreDailyUse.score}, surface parity ${rubric.surfaceParity.score}, migration gravity ${rubric.migrationGravity.score}.`
        : rep.weightRationale,
    };
  });
  // A capability that ends with no items cannot stand (every capability needs an item): dropped, a decision.
  const live = capabilities.filter((c) => {
    if (c.inventoryItems.length > 0) return true;
    decisions.push({
      kind: "ensemble_disagreement",
      subject: c.key,
      summary: "Capability kept by the majority but left with no items: dropped.",
      options: [],
      chosen: "dropped",
    });
    return false;
  });
  const weights = rubricWeights(live);
  if (weights)
    live.forEach((c, i) => {
      c.weightBp = weights[i]!;
    });
  else {
    const w = apportion(live.map((c) => lowerMedian((capRuns.get(c.key) ?? []).map((x) => x.c.weightBp))));
    live.forEach((c, i) => {
      c.weightBp = w[i]!;
    });
  }

  // ---- roadmap surfaces, migration, header
  const rs = new Map<string, Array<{ run: number; s: Roadmap["surfaces"][number] }>>();
  runs.forEach((r, i) => {
    for (const s of r.roadmap.surfaces) rs.set(s.surface, [...(rs.get(s.surface) ?? []), { run: i, s }]);
  });
  const roadmapSurfaces = [...rs]
    .filter(([sf, xs]) => xs.length >= t && invSurfaces.some((x) => x.surface === sf))
    .map(
      ([, xs]) =>
        vote(
          xs.map((x) => ({ run: x.run, value: x.s })),
          (s) => s.status,
          t,
        ).winner.value,
    );
  const inScope = new Set(roadmapSurfaces.filter((s) => s.status === "in_scope").map((s) => s.surface));
  for (const c of live)
    c.features = c.features
      .map((f) => {
        const surfaces = f.surfaces.filter((s) => inScope.has(s.surface));
        const w = apportion(surfaces.map((s) => s.weightBp));
        return {
          ...f,
          surfaces: surfaces.map((s, i) => ({ ...s, weightBp: w[i]! })),
          journeys: f.journeys.filter((j) => inScope.has(j.surface)),
        };
      })
      .filter((f) => f.surfaces.length > 0);
  const migrationClasses = MIGRATION_DATA_CLASSES.flatMap((dc) => {
    const vs = runs.flatMap((r, i) => {
      const c = r.roadmap.migration?.classes.find((x) => x.dataClass === dc);
      return c ? [{ run: i, value: c }] : [];
    });
    if (!vs.length) return [];
    const v = vote(vs, canon, t);
    if (!v.majority)
      decisions.push({
        kind: "ensemble_disagreement",
        subject: `migration ${dc}`,
        summary: "No majority on this data class's migration plan; the most common variant (first run on a tie) is kept.",
        options: v.all.map((o, i) => ({
          label: `variant ${i + 1}`,
          runs: o.runs.map(R),
          detail: `${o.value.connector ?? "no connector"}: ${o.value.extraction?.method ?? "not extractable"}`,
          sources: [o.value.extraction?.source, o.value.deltaSync?.source, ...o.value.notExtractable.map((n) => n.source)].filter(
            (s): s is string => !!s,
          ),
        })),
        chosen: "variant 1",
      });
    return [v.winner.value];
  });
  const header = (f: (r: Roadmap) => string) =>
    vote(
      runs.map((r, i) => ({ run: i, value: f(r.roadmap) })),
      (x) => x,
      t,
    ).winner.value;
  // The runs' own decisions (template deviations, catalog proposals) on what survived the merge.
  const keptSubjects = new Set([...live.map((c) => c.key), ...live.flatMap((c) => c.features.map((f) => f.feature))]);
  const own = new Map<string, Omit<RoadmapDecision, "id">>();
  for (const r of runs)
    for (const d of r.roadmap.decisions ?? [])
      if (d.kind !== "ensemble_disagreement" && keptSubjects.has(d.subject) && !own.has(`${d.kind}:${d.subject}`))
        own.set(`${d.kind}:${d.subject}`, d);

  // ---- catalog: features referenced that the catalog does not have yet
  const vocab = new Map(opts.vocabulary.map((v) => [v.id, v]));
  const referenced = [...new Set(live.flatMap((c) => c.features.map((f) => f.feature)))];
  const migrationFeatures = [...new Set(migrationClasses.flatMap((c) => (c.connector ? [c.connector] : [])))];
  const newKeys = [...new Set([...referenced, ...migrationFeatures, "import-engine"])].filter((k) => !opts.existingCatalog.has(k)).sort();
  const catalogFiles: CatalogEntry[] = [];
  for (const k of newKeys) {
    const v = vocab.get(k);
    const fromRun = runs.find((r) => r.catalog.has(k))?.catalog.get(k);
    if (v) catalogFiles.push(defaultCatalogEntry(v));
    else if (fromRun) catalogFiles.push(fromRun);
  }
  const all = [...own.values(), ...decisions].map((d, i) => ({ ...d, id: `DEC-${String(i + 1).padStart(3, "0")}` }));
  const r0 = runs[0]!.roadmap;
  const proposals = vote(
    runs.map((r, i) => ({ run: i, value: [...r.roadmap.proposals].sort() })),
    (x) => x.join(","),
    t,
  ).winner.value;
  const roadmap: Roadmap = {
    ...r0,
    productName: header((r) => r.productName),
    surfaces: roadmapSurfaces,
    capabilities: live,
    excluded: accepted
      .filter((a) => itemCap.get(a.key) === null)
      .map((a) => ({ item: itemKey.get(a.key)!, reason: excludedReason.get(a.key)! })),
    newCatalogFeatures: catalogFiles.map((c) => c.key),
    proposals,
    migration: { engine: "import-engine", classes: migrationClasses },
    ...(weights ? { weightRubric: "wos-weight-rubric.v1" as const } : {}),
    decisions: all,
  };
  return { inventory, roadmap, catalogFiles, decisions: all, threshold: t };
}

/** Pairwise stability of N runs (the minimum over pairs), and grounding (the minimum over runs), in basis points. */
export function ensembleStability(
  runs: readonly EnsembleRun[],
  scanSources: readonly string[],
  targets: { capabilitiesMatchBp: number; featuresMatchBp: number; weightSpearman: number; groundingBp: number },
) {
  let caps = 10_000;
  let feats = 10_000;
  let rho: number | null = null;
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i]!.roadmap.capabilities;
      const b = runs[j]!.roadmap.capabilities;
      const ka = new Set(a.map((c) => c.key));
      const kb = new Set(b.map((c) => c.key));
      const both = [...ka].filter((k) => kb.has(k));
      caps = Math.min(caps, Math.round((both.length * 10_000) / Math.max(ka.size, kb.size, 1)));
      const fa = new Set(a.flatMap((c) => c.features.map((f) => f.feature)));
      const fb = new Set(b.flatMap((c) => c.features.map((f) => f.feature)));
      const fu = new Set([...fa, ...fb]);
      feats = Math.min(feats, fu.size ? Math.round(([...fa].filter((k) => fb.has(k)).length * 10_000) / fu.size) : 10_000);
      const r = spearmanRank(
        both.map((k) => a.find((c) => c.key === k)!.weightBp),
        both.map((k) => b.find((c) => c.key === k)!.weightBp),
      );
      if (r !== null) rho = rho === null ? r : Math.min(rho, r);
    }
  let grounding = 10_000;
  for (const r of runs) {
    const ok = new Set([...r.fetchedUrls, ...scanSources].map(groundingKey));
    const srcs = citedUrls(r.roadmap, r.inventory);
    if (srcs.length)
      grounding = Math.min(grounding, Math.round((srcs.filter((u) => ok.has(groundingKey(u))).length * 10_000) / srcs.length));
  }
  const belowTarget = [
    ...(caps < targets.capabilitiesMatchBp ? ["capabilities"] : []),
    ...(feats < targets.featuresMatchBp ? ["features"] : []),
    ...(rho !== null && rho < targets.weightSpearman ? ["weights"] : []),
    ...(grounding < targets.groundingBp ? ["grounding"] : []),
  ];
  return { capabilitiesMatchBp: caps, featuresMatchBp: feats, weightSpearman: rho, groundingBp: grounding, belowTarget };
}

/** Spearman's rank correlation with average ranks for ties; null below 3 pairs or without variance. */
export function spearmanRank(xs: number[], ys: number[]): number | null {
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
  const m = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = m(rx);
  const my = m(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : Math.round((num / Math.sqrt(dx * dy)) * 10_000) / 10_000;
}

/** roadmaps/<target>/DECISIONS.md: the decisions for people (ROADMAP.yaml `decisions` is the record). */
export function renderDecisionsMd(target: string, decisions: readonly RoadmapDecision[], note: string): string {
  const L = [
    `# Decisions for the reviewers: ${target}`,
    "",
    note,
    "",
    "Each reviewer rules on every decision (`decisionRulings` in the verdict). An unruled decision is material.",
    "",
  ];
  if (!decisions.length) L.push("No decisions.", "");
  for (const d of decisions) {
    L.push(`## ${d.id} (${d.kind}): ${d.subject}`, "", d.summary, "", `Chosen in this revision: ${d.chosen}.`, "");
    for (const o of d.options) {
      L.push(`- **${o.label}**${o.runs.length ? ` (runs ${o.runs.join(", ")})` : ""}${o.detail ? `: ${o.detail}` : ""}`);
      for (const s of o.sources) L.push(`  - ${s}`);
    }
    if (d.options.length) L.push("");
  }
  return `${L.join("\n")}\n`;
}

/** YAML for canonical files written by the merge (YAML 1.2, no anchors). */
export const toYaml = (v: unknown) => stringify(v, { aliasDuplicateObjects: false, lineWidth: 0 });

/**
 * THE data source for every number and record the site renders.
 *
 * It returns the public API's contract types (packages/contracts/src/domain.ts), so pages are
 * written against the shapes of GET /v1/public/*. Today it reads only real sources:
 *   - data/targets.ts                      the Sniper List (names, ranks; every number 0)
 *   - generated/waronsaas.roadmap.json     TGT-00's PROPOSED roadmap bundle, copied verbatim from
 *                                          docs/roadmap/waronsaas.roadmap.json by scripts/sync-shared.mjs
 * When the control plane is live, each function body becomes a fetch of its route (named on each
 * function) with ISR; the signatures stay. Nothing here invents a number: every progress value is 0
 * because nothing has merged, and every weight is copied from the roadmap file.
 */

import type { RoadmapBundle } from "@contracts/artifacts";
import type {
  AbuSummary,
  AppFeatureDetail,
  AppFeatureSummary,
  Progress,
  TargetDetail,
  TargetSummary,
} from "@contracts/domain";
import type { Surface } from "@contracts/primitives";
import bundleJson from "@/generated/waronsaas.roadmap.json";
import { formatPercent } from "@/generated/contracts-progress";
import { targets, type Target } from "@/data/targets";
import { wosTarget } from "@/data/wos-roadmap";

export { formatPercent };

export type Capability = TargetDetail["capabilities"][number];
export type RequirementView = AppFeatureDetail["requirements"][number];
export type TargetSurface = TargetDetail["surfaces"][number];
export type FeatureSurface = AppFeatureSummary["surfaces"][number];

/** Where a record came from. Pages print this so every number is traceable. */
export type SourceNote = {
  kind: "targets-file" | "roadmap-file";
  path: string;
  /** Human-readable status of the source, e.g. the roadmap's PROPOSED status. */
  status: string;
};

export type Sourced<T> = { data: T; source: SourceNote };

const bundle = bundleJson as unknown as RoadmapBundle;

export const ROADMAP_SOURCE: SourceNote = {
  kind: "roadmap-file",
  path: "docs/roadmap/waronsaas.roadmap.json",
  status: `${bundle.status}: not reviewed by Fable or Astra, not merged`,
};
const TARGETS_SOURCE: SourceNote = { kind: "targets-file", path: "apps/web/data/targets.ts", status: "No roadmap opened" };

/** D14: the suite is one web app and one phone app (iPhone and Android). These are the surfaces
 *  every replacement target is tracked on until its roadmap inventories the vendor's surfaces. */
export const SUITE_SURFACES: Surface[] = ["web", "ios", "android"];

export const SURFACE_LABEL: Record<Surface, string> = {
  web: "Web",
  ios: "iPhone",
  android: "Android",
  desktop: "Desktop",
  cli: "CLI",
  browser_extension: "Browser extension",
  email_addin: "Email add-in",
  other: "Other",
};

const ZERO: Progress = {
  mappedBp: 0,
  specifiedBp: 0,
  builtBp: 0,
  roadmapVersion: null,
  inventoryVersion: null,
  inventoryItems: null,
  excludedItems: 0,
  computedAt: null,
};

/** Whole percent (targets.ts) to basis points. */
const bp = (pct: number) => Math.round(pct * 100);

/**
 * Display-only casing fix for three generated phrases in the roadmap file that break the naming
 * rule ("wos CLI", "wos cli", "wos desktop"). Raised as blockers/B-0001-web.md; remove when the file is fixed.
 */
export function displayCasing(s: string): string {
  return s.replace(/\bwos CLI\b/g, "wOS CLI").replace(/\bwos cli\b/g, "wOS CLI").replace(/\bwos desktop\b/g, "wOS Desktop");
}

function summaryOf(t: Target, rank: number): TargetSummary {
  return {
    slug: t.slug,
    name: t.name,
    rank,
    whatItIs: t.whatItIs,
    productName: null,
    repo: "waronsaas/product",
    progress: { ...ZERO, mappedBp: bp(t.mapped), specifiedBp: bp(t.specified), builtBp: bp(t.built) },
    roadmap: null,
    hosted: { available: t.hosted, url: null },
    selfHostable: t.selfHosted,
  };
}

function wosSummary(): TargetSummary {
  return {
    slug: wosTarget.slug,
    name: "warOnSaaS",
    rank: 0,
    whatItIs: wosTarget.whatItIs,
    productName: bundle.roadmap.productName ?? "wOS",
    repo: "waronsaas/wos",
    // PROPOSED roadmap: nothing merged, so no roadmap version and every number 0.
    progress: { ...ZERO },
    roadmap: null,
    hosted: { available: false, url: null },
    selfHostable: false,
  };
}

/** GET /v1/public/targets — rank 0 is warOnSaaS itself, then the ten in order. */
export function listTargets(): TargetSummary[] {
  return [wosSummary(), ...targets.map((t, i) => summaryOf(t, i + 1))];
}

/** Sniper List totals over ranks 1..10 (not TGT-00): the floor of the mean of each measure, in bp. */
export function sniperListTotals() {
  const ten = listTargets().filter((t) => t.rank > 0);
  const mean = (k: "mappedBp" | "specifiedBp" | "builtBp") => Math.floor(ten.reduce((n, t) => n + t.progress[k], 0) / ten.length);
  return {
    targets: ten.length,
    roadmapsOpen: ten.filter((t) => t.roadmap).length,
    mappedBp: mean("mappedBp"),
    specifiedBp: mean("specifiedBp"),
    builtBp: mean("builtBp"),
  };
}

/** Site-only display fields (TGT code, category, provisional outline) that the API does not carry. */
export function siteFields(slug: string): Target | undefined {
  return slug === wosTarget.slug ? wosTarget : targets.find((t) => t.slug === slug);
}

function catalogEntry(key: string) {
  return bundle.catalog.find((c) => c.key === key);
}

function wosFeatures(): { cap: (typeof bundle.roadmap.capabilities)[number]; summary: AppFeatureSummary }[] {
  return bundle.roadmap.capabilities.flatMap((cap) =>
    cap.features.map((f) => {
      const entry = catalogEntry(f.feature);
      const summary: AppFeatureSummary = {
        key: f.feature,
        capability: cap.key,
        title: displayCasing(entry?.title ?? f.feature),
        summary: displayCasing(entry?.summary ?? ""),
        // The contract has no state for a feature of an unmerged (PROPOSED) roadmap; pages do not
        // render this field while the source is the roadmap file. See blockers/B-0001-web.md.
        state: "mapped",
        weightBp: f.weightBp,
        weightRationale: displayCasing(f.weightRationale),
        // progress.ts: effective weight of f toward the app = W_c * w_f / 10000.
        effectiveAppWeightBp: Math.floor((cap.weightBp * f.weightBp) / 10000),
        specifiedBp: 0,
        builtBp: 0,
        relevantPoints: 0,
        mergedPoints: 0,
        surfaces: (f.surfaces ?? []).map((s) => ({
          surface: s.surface,
          weightBp: s.weightBp,
          weightRationale: displayCasing(s.weightRationale),
          specifiedBp: 0,
          builtBp: 0,
          relevantPoints: 0,
          mergedPoints: 0,
          acceptancePassed: false,
        })),
        journeys: (f.journeys ?? []).map((j) => ({
          ...j,
          title: displayCasing(j.title),
          steps: j.steps.map(displayCasing),
          entryPoints: j.entryPoints.map(displayCasing),
          platformBehaviour: displayCasing(j.platformBehaviour),
        })),
        sharedWith: [],
        contract: null,
      };
      return { cap, summary };
    }),
  );
}

function wosDetail(): TargetDetail {
  const feats = wosFeatures();
  return {
    ...wosSummary(),
    surfaces: bundle.roadmap.surfaces.map((s) => ({
      surface: s.surface,
      status: s.status,
      reason: s.reason ?? null,
      repo: s.repo ?? null,
      specifiedBp: 0,
      builtBp: 0,
    })),
    capabilities: bundle.roadmap.capabilities.map((cap) => ({
      key: cap.key,
      title: displayCasing(cap.title),
      summary: displayCasing(cap.summary),
      weightBp: cap.weightBp,
      weightRationale: displayCasing(cap.weightRationale),
      // "mapped" means on a MERGED roadmap version. This one is PROPOSED.
      mapped: false,
      specifiedBp: 0,
      builtBp: 0,
      features: feats.filter((f) => f.cap.key === cap.key).map((f) => f.summary),
    })),
    excluded: bundle.roadmap.excluded.map((e) => ({
      item: e.item,
      title: bundle.inventory.items.find((i) => i.key === e.item)?.title ?? e.item,
      reason: e.reason,
    })),
  };
}

/** GET /v1/public/targets/:slug */
export function getTarget(slug: string): Sourced<TargetDetail> | null {
  if (slug === wosTarget.slug) return { data: wosDetail(), source: ROADMAP_SOURCE };
  const i = targets.findIndex((t) => t.slug === slug);
  if (i < 0) return null;
  return {
    data: { ...summaryOf(targets[i], i + 1), surfaces: [], capabilities: [], excluded: [] },
    source: TARGETS_SOURCE,
  };
}

/** Per-surface progress of a replacement target on the suite's surfaces (D14). Every value comes
 *  from the target's detail; with no roadmap, there are no requirements, so every surface is 0. */
export function suiteSurfaceProgress(detail: TargetDetail): { surface: Surface; specifiedBp: number; builtBp: number }[] {
  return SUITE_SURFACES.map((surface) => {
    const s = detail.surfaces.find((x) => x.surface === surface);
    return { surface, specifiedBp: s?.specifiedBp ?? 0, builtBp: s?.builtBp ?? 0 };
  });
}

/** GET /v1/public/targets/:slug/features/:feature */
export function getFeature(slug: string, feature: string): Sourced<AppFeatureDetail> | null {
  if (slug !== wosTarget.slug) return null;
  const f = wosFeatures().find((x) => x.summary.key === feature);
  if (!f) return null;
  const reqs = bundle.requirements.find((r) => r.feature === feature)?.requirements ?? [];
  const abus: AbuSummary[] = [];
  return {
    data: {
      ...f.summary,
      target: slug,
      requirements: reqs.map((r) => ({
        key: r.key,
        kind: r.kind,
        statement: displayCasing(r.statement),
        abus: [],
        built: false,
        // A profile exists only once a Feature Contract merges.
        profiles: [],
        surfaces: r.surfaces,
      })),
      abus,
    },
    source: ROADMAP_SOURCE,
  };
}

/** Acceptance criteria of a proposed requirement. Not part of RequirementView; read from the same file. */
export function proposedAcceptance(feature: string, requirement: string): string[] {
  const r = bundle.requirements.find((x) => x.feature === feature)?.requirements.find((x) => x.key === requirement);
  return (r?.acceptance ?? []).map(displayCasing);
}

export const ROADMAP_META = {
  status: bundle.status,
  targetCode: bundle.targetCode,
  note: displayCasing(bundle.note),
  version: bundle.roadmap.version,
  inventoryItems: bundle.inventory.items.length,
  catalogFeatures: bundle.catalog.length,
  requirements: bundle.requirements.reduce((n, r) => n + r.requirements.length, 0),
};

/** Everything this module returns, for the /data-source.json snapshot the number check reads. */
export function snapshot() {
  const list = listTargets();
  return {
    targets: list,
    totals: sniperListTotals(),
    details: list.map((t) => getTarget(t.slug)?.data),
    features: wosFeatures().map((f) => getFeature(wosTarget.slug, f.summary.key)?.data),
    roadmapMeta: ROADMAP_META,
  };
}

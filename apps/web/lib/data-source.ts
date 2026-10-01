/**
 * THE data source for every number and record the site renders.
 *
 * It returns the public API's contract types (packages/contracts/src/domain.ts). Sources:
 *   - the live public API (API_BASE/v1/public/*), fetched with ISR (revalidate 60 s): the Sniper
 *     List, every target's progress and detail. If the API fails at build time the build fails; at
 *     runtime a failed revalidation keeps the last good page. There is no fallback data.
 *   - generated/waronsaas.roadmap.json: TGT-00's PROPOSED roadmap bundle, copied verbatim from
 *     docs/roadmap/waronsaas.roadmap.json at build by scripts/sync-shared.mjs (the API does not
 *     serve unmerged roadmaps; blockers/B-0001-web.md).
 *   - data/targets.ts: site-only display fields (TGT code, category, provisional outline). No numbers
 *     from that file are rendered.
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
import type { ShadowReceipt, ShadowReceiptSummary } from "@contracts/shadow";
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
  kind: "api" | "roadmap-file";
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
/** Public API base (D5). Overridable for local testing against a fake control plane. */
export const API_BASE = process.env.WOS_API_URL ?? "https://api.waronsaas.com";
export const REVALIDATE_SECONDS = 60;

const API_SOURCE = (slug: string): SourceNote => ({
  kind: "api",
  path: `${API_BASE.replace(/^https?:\/\//, "")}/v1/public/targets/${slug}`,
  status: `live, refreshed every ${REVALIDATE_SECONDS} s`,
});

/** GET a public route. Throws on any non-2xx or malformed body: never substitutes data. */
async function apiGet<T>(path: string, check: (body: unknown) => body is T): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, { next: { revalidate: REVALIDATE_SECONDS } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`public API ${path}: HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!check(body)) throw new Error(`public API ${path}: response does not match the contract shape`);
  return body;
}

const isBp = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10000;
/** Minimal runtime guard for TargetSummary (full zod validation needs @waronsaas/contracts as a dependency of apps/web). */
function isSummary(t: unknown): t is TargetSummary {
  const x = t as TargetSummary;
  return !!x && typeof x.slug === "string" && typeof x.name === "string" && Number.isInteger(x.rank) &&
    !!x.progress && isBp(x.progress.mappedBp) && isBp(x.progress.specifiedBp) && isBp(x.progress.builtBp);
}
const isList = (b: unknown): b is { items: TargetSummary[] } =>
  !!b && Array.isArray((b as { items: unknown }).items) && (b as { items: unknown[] }).items.every(isSummary);
const isDetail = (b: unknown): b is TargetDetail =>
  isSummary(b) && Array.isArray((b as TargetDetail).surfaces) && Array.isArray((b as TargetDetail).capabilities) &&
  (b as TargetDetail).surfaces.every((s) => isBp(s.specifiedBp) && isBp(s.builtBp));

// P1 shadow receipts (contracts 5.20.0): the same minimal-guard discipline, one guard per route.
const isCount = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
function isReceiptSummary(x: unknown): x is ShadowReceiptSummary {
  const r = x as ShadowReceiptSummary;
  return !!r && typeof r.id === "string" && typeof r.kind === "string" && typeof r.outcome === "object" && r.outcome !== null &&
    typeof r.outcome.state === "string" && isCount(r.runCount) && isCount(r.roundCount) && isCount(r.reviewCount);
}
const isReceiptsPage = (b: unknown): b is { items: ShadowReceiptSummary[]; nextCursor: string | null } =>
  !!b && Array.isArray((b as { items: unknown }).items) &&
  (b as { items: unknown[] }).items.every(isReceiptSummary) &&
  ((b as { nextCursor: unknown }).nextCursor === null || typeof (b as { nextCursor: unknown }).nextCursor === "string");
const isReceipt = (b: unknown): b is ShadowReceipt =>
  isReceiptSummary(b) && Array.isArray((b as ShadowReceipt).runs) && Array.isArray((b as ShadowReceipt).rounds) &&
  typeof (b as ShadowReceipt).receiptSha256 === "string";

/** GET /v1/public/receipts — shadow receipts of real agent contributions, newest first. Null while the receipts
 *  route is not deployed yet (404): the page then says so, never "no receipts". */
export async function listReceipts(cursor?: string): Promise<{ items: ShadowReceiptSummary[]; nextCursor: string | null } | null> {
  return apiGet(`/v1/public/receipts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, isReceiptsPage);
}

/** GET /v1/public/receipts/:id — one receipt in full. Null when the route is not deployed yet or the id is unknown. */
export async function getReceipt(id: string): Promise<ShadowReceipt | null> {
  return apiGet(`/v1/public/receipts/${encodeURIComponent(id)}`, isReceipt);
}

/** Amendment 01 (contracts 5.0.0): the one wOS product ships on web, desktop, iPhone, Android and an API.
 *  Every replacement target is tracked on these until its roadmap inventories the vendor's surfaces. */
export const SUITE_SURFACES: Surface[] = ["web", "desktop", "ios", "android", "api"];

export const SURFACE_LABEL: Record<Surface, string> = {
  web: "Web",
  ios: "iPhone",
  android: "Android",
  desktop: "Desktop",
  api: "API",
  cli: "CLI",
  browser_extension: "Browser extension",
  email_addin: "Email add-in",
  other: "Other",
};

/**
 * Display-only casing fix for three generated phrases in the roadmap file that break the naming
 * rule ("wos CLI", "wos cli", "wos desktop"). Raised as blockers/B-0001-web.md; remove when the file is fixed.
 */
export function displayCasing(s: string): string {
  return s.replace(/\bwos CLI\b/g, "wOS CLI").replace(/\bwos cli\b/g, "wOS CLI").replace(/\bwos desktop\b/g, "wOS Desktop");
}

/** GET /v1/public/targets — rank 0 is warOnSaaS itself, then the Sniper List in order. */
export async function listTargets(): Promise<TargetSummary[]> {
  const body = await apiGet("/v1/public/targets", isList);
  if (!body) throw new Error("public API /v1/public/targets: 404");
  return [...body.items].sort((a, b) => a.rank - b.rank);
}

/** Sniper List totals over ranks >= 1 (not TGT-00): the floor of the mean of each measure, in bp. */
export async function sniperListTotals() {
  const ten = (await listTargets()).filter((t) => t.rank > 0);
  const mean = (k: "mappedBp" | "specifiedBp" | "builtBp") =>
    ten.length ? Math.floor(ten.reduce((n, t) => n + t.progress[k], 0) / ten.length) : 0;
  return {
    targets: ten.length,
    roadmapsOpen: ten.filter((t) => t.roadmap).length,
    mappedBp: mean("mappedBp"),
    specifiedBp: mean("specifiedBp"),
    builtBp: mean("builtBp"),
  };
}

/** Site-only display fields (TGT code, category, provisional outline) that the API does not carry.
 *  A target the API lists but the site does not know yet still renders, with its rank as its code. */
export function siteFields(slug: string, rank?: number): Target | undefined {
  const known = slug === wosTarget.slug ? wosTarget : targets.find((t) => t.slug === slug);
  if (known || rank === undefined) return known;
  return {
    name: slug, id: `TGT-${String(rank).padStart(2, "0")}`, slug, category: "—", whatItIs: "", replacementCovers: [],
    mapped: 0, specified: 0, built: 0, roadmapPr: null, hosted: false, selfHosted: false,
  };
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

function wosDetail(summary: TargetSummary): TargetDetail {
  const feats = wosFeatures();
  return {
    ...summary,
    productName: summary.productName ?? bundle.roadmap.productName ?? "wOS",
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

/** TGT-00's proposed capabilities, straight from the roadmap file (no API call). Used by the drilldown
 *  below the target level, where every number comes from the file. */
export function proposedCapabilities(): TargetDetail["capabilities"] {
  return wosDetail({
    slug: wosTarget.slug, name: "warOnSaaS", rank: 0, whatItIs: wosTarget.whatItIs, productName: null, repo: "waronsaas/wos",
    progress: { mappedBp: 0, specifiedBp: 0, builtBp: 0, roadmapVersion: null, inventoryVersion: null, inventoryItems: null, excludedItems: 0, computedAt: null },
    roadmap: null, hosted: { available: false, url: null }, selfHostable: false,
  }).capabilities;
}

/** GET /v1/public/targets/:slug. TGT-00's capabilities come from its proposed roadmap file. */
export async function getTarget(slug: string): Promise<Sourced<TargetDetail> | null> {
  const detail = await apiGet(`/v1/public/targets/${encodeURIComponent(slug)}`, isDetail);
  if (!detail) return null;
  if (slug === wosTarget.slug && detail.capabilities.length === 0) {
    return { data: wosDetail(detail), source: ROADMAP_SOURCE };
  }
  return { data: detail, source: API_SOURCE(slug) };
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
export async function snapshot() {
  const list = await listTargets();
  return {
    api: API_BASE,
    targets: list,
    totals: await sniperListTotals(),
    details: await Promise.all(list.map(async (t) => (await getTarget(t.slug))?.data)),
    features: wosFeatures().map((f) => getFeature(wosTarget.slug, f.summary.key)?.data),
    roadmapMeta: ROADMAP_META,
  };
}

/**
 * Progress calculation (D10, D11, D12, D13). Pure, deterministic, integer-only. This file is the contract:
 * the control plane's progress consumer calls `computeAppProgress` on every relevant merge event and
 * appends the result as snapshots; the web renders the result verbatim with `formatPercent`.
 * ROADMAP-PROTOCOL.md "Progress" is the prose version of this file.
 *
 *  Weights (D12) — reasoned by the Roadmap Agent, reviewed at consensus, frozen per merged roadmap version:
 *    W_c    capability c's share of the app (bp); all capabilities of the app sum to 10000.
 *    w_f    feature f's share of its capability (bp); a mapped capability's features sum to 10000.
 *    v_f,s  surface s's share of feature f for this app (bp, D13); the feature's surfaces sum to 10000.
 *    Effective weight of f toward the app = W_c * w_f / 10000 (published on the feature page).
 *
 *  Per surface s of feature f, for app A (latest MERGED contract of the catalog feature, D10 + D13)
 *    P_s = requirements in A's profile that are tagged with surface s.
 *    SPECIFIED_s = 10000 if P_s is non-empty, else 0 (the surface is not specified until the merged contract
 *                  says what A needs there).
 *    relevant_s  = non-superseded ABUs whose requirements intersect P_s (shared-module ABUs count for every
 *                  surface whose requirements they cover).
 *    BUILT_s     = 0 if not specified; else floor(10000 * mergedPoints_s / relevantPoints_s), capped at 9999
 *                  until complete_s: every relevant ABU merged, every requirement in P_s built, AND the surface's
 *                  acceptance check wos-acceptance/<feature>/<A>/<s> passed on the default branch. The split
 *                  inside a surface is mechanical by ABU size points (G-30).
 *
 *  Feature level: SPECIFIED_f = floor(sum_s v_f,s * SPECIFIED_s / 10000); BUILT_f likewise.
 *    => 10000 only when every in-scope surface of the feature is specified / complete (D13 item 3).
 *
 *  Capability level: unmapped => 0/0. Mapped: SPECIFIED_c = floor(sum_f w_f * SPECIFIED_f / 10000), BUILT_c likewise.
 *  App level:  MAPPED = sum of W_c over mapped capabilities;
 *              SPECIFIED = floor(sum_c sum_f W_c * w_f * SPECIFIED_f / 10^8); BUILT likewise.
 *  App per surface (the web drilldown's per-surface view): over the features that include s,
 *              SPECIFIED_s(app) = floor(sum W_c*w_f*v_f,s*SPECIFIED_s / sum W_c*w_f*v_f,s); BUILT likewise.
 *    => BUILT <= SPECIFIED <= MAPPED always, and 10000 only when literally everything is complete.
 */

import type { AbuKey, BasisPoints, CapabilityKey, FeatureKey, RequirementKey, Surface, TargetSlug } from "./primitives.js";

export interface ProgressAbuInput {
  key: AbuKey;
  sizePoints: 1 | 2 | 3 | 5 | 8;
  requirements: RequirementKey[];
  merged: boolean;
  superseded: boolean;
  /** Merged PR, for traceability. */
  prUrl: string | null;
}

export interface ProgressFeatureInput {
  feature: FeatureKey;
  capability: CapabilityKey;
  /** w_f: the feature's reasoned share of its capability (bp), from the merged roadmap version. */
  weightBp: number;
  /** v_f,s: the feature's reasoned surface weights for this app (bp, sum 10000), from the roadmap (D13). */
  surfaces: Array<{ surface: Surface; weightBp: number }>;
  /** Latest merged contract of the catalog feature, or null if none has merged. */
  contract: null | {
    version: number;
    /** This app's profile requirement ids; empty when the merged contract has no profile for the app. */
    profile: RequirementKey[];
    /** Surface tags of every requirement of the contract (D13). */
    requirementSurfaces: Record<RequirementKey, Surface[]>;
    abus: ProgressAbuInput[];
    /** Per surface: the profile's acceptance check passed on the default branch after the last relevant merge. */
    acceptancePassed: Partial<Record<Surface, boolean>>;
  };
}

export interface ProgressInput {
  target: TargetSlug;
  /** Null until the first roadmap version merges. */
  roadmap: null | {
    version: number;
    inventoryVersion: number;
    inventoryItems: number;
    excludedItems: number;
    capabilities: ProgressCapabilityInput[];
  };
}

export interface ProgressCapabilityInput {
  capability: CapabilityKey;
  /** W_c: the capability's reasoned share of the app (bp). */
  weightBp: number;
  /** Empty when the capability is not mapped in this roadmap version. */
  features: ProgressFeatureInput[];
}

export interface RequirementProgress {
  key: RequirementKey;
  surfaces: Surface[];
  /** Relevant ABUs covering it. */
  abus: AbuKey[];
  built: boolean;
}

export interface SurfaceProgress {
  surface: Surface;
  weightBp: number;
  specifiedBp: BasisPoints;
  builtBp: BasisPoints;
  relevantPoints: number;
  mergedPoints: number;
  acceptancePassed: boolean;
  complete: boolean;
}

export interface FeatureProgress {
  feature: FeatureKey;
  capability: CapabilityKey;
  weightBp: number;
  /** W_c * w_f / 10000, floored: the feature's share of the whole app. */
  effectiveAppWeightBp: number;
  contractVersion: number | null;
  specifiedBp: BasisPoints;
  builtBp: BasisPoints;
  complete: boolean;
  /** Size points of the distinct ABUs relevant to any surface of this app's profile, and of those merged. */
  relevantPoints: number;
  mergedPoints: number;
  surfaces: SurfaceProgress[];
  requirements: RequirementProgress[];
}

export interface CapabilityProgress {
  capability: CapabilityKey;
  weightBp: number;
  mapped: boolean;
  specifiedBp: BasisPoints;
  builtBp: BasisPoints;
}

export interface AppSurfaceProgress {
  surface: Surface;
  specifiedBp: BasisPoints;
  builtBp: BasisPoints;
}

export interface AppProgress {
  target: TargetSlug;
  roadmapVersion: number | null;
  inventoryVersion: number | null;
  inventoryItems: number | null;
  excludedItems: number;
  mappedBp: BasisPoints;
  specifiedBp: BasisPoints;
  builtBp: BasisPoints;
  surfaces: AppSurfaceProgress[];
  capabilities: CapabilityProgress[];
  features: FeatureProgress[];
}

const FULL = 10_000;

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a non-negative integer, got ${n}`);
}

function assertBp(n: number, what: string): void {
  assertInt(n, what);
  if (n < 1 || n > FULL) throw new RangeError(`${what} must be 1..10000 bp, got ${n}`);
}

const bySurface = (a: { surface: string }, b: { surface: string }) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0);

/** Progress of one feature for one app. `capabilityWeightBp` only feeds the published effective weight. */
export function computeFeatureProgress(input: ProgressFeatureInput, capabilityWeightBp: number): FeatureProgress {
  assertBp(input.weightBp, `weightBp of ${input.feature}`);
  const surfaceTotal = input.surfaces.reduce((n, s) => n + s.weightBp, 0);
  if (surfaceTotal !== FULL) throw new RangeError(`surface weights of ${input.feature} must sum to 10000, got ${surfaceTotal}`);
  for (const s of input.surfaces) assertBp(s.weightBp, `surface ${s.surface} of ${input.feature}`);
  const c = input.contract;
  const profile = new Set(c?.profile ?? []);
  const tags = (key: RequirementKey): Surface[] => c?.requirementSurfaces[key] ?? [];

  const surfaces: SurfaceProgress[] = [...input.surfaces].sort(bySurface).map(({ surface, weightBp }) => {
    const ps = [...profile].filter((k) => tags(k).includes(surface));
    const acceptancePassed = c?.acceptancePassed[surface] === true;
    if (c === null || ps.length === 0) {
      return { surface, weightBp, specifiedBp: 0, builtBp: 0, relevantPoints: 0, mergedPoints: 0, acceptancePassed, complete: false };
    }
    const psSet = new Set(ps);
    const relevant = c.abus.filter((a) => !a.superseded && a.requirements.some((r) => psSet.has(r)));
    let relevantPoints = 0;
    let mergedPoints = 0;
    for (const a of relevant) {
      relevantPoints += a.sizePoints;
      if (a.merged) mergedPoints += a.sizePoints;
    }
    const allBuilt = ps.every((k) => {
      const covering = relevant.filter((a) => a.requirements.includes(k));
      return covering.length > 0 && covering.every((a) => a.merged);
    });
    const complete = relevant.length > 0 && allBuilt && acceptancePassed;
    let builtBp = relevantPoints === 0 ? 0 : Math.floor((FULL * mergedPoints) / relevantPoints);
    if (complete) builtBp = FULL;
    else if (builtBp >= FULL) builtBp = FULL - 1;
    return { surface, weightBp, specifiedBp: FULL, builtBp, relevantPoints, mergedPoints, acceptancePassed, complete };
  });

  const requirements: RequirementProgress[] = [...profile].sort().map((key) => {
    const covering = (c?.abus ?? []).filter((a) => !a.superseded && a.requirements.includes(key));
    return {
      key,
      surfaces: [...tags(key)].sort(),
      abus: covering.map((a) => a.key).sort(),
      built: covering.length > 0 && covering.every((a) => a.merged),
    };
  });

  const union = (c?.abus ?? []).filter((a) => !a.superseded && a.requirements.some((r) => profile.has(r)));
  const relevantPoints = union.reduce((n, a) => n + a.sizePoints, 0);
  const mergedPoints = union.filter((a) => a.merged).reduce((n, a) => n + a.sizePoints, 0);
  const specNum = surfaces.reduce((n, s) => n + s.weightBp * s.specifiedBp, 0);
  const builtNum = surfaces.reduce((n, s) => n + s.weightBp * s.builtBp, 0);
  return {
    feature: input.feature,
    capability: input.capability,
    weightBp: input.weightBp,
    effectiveAppWeightBp: Math.floor((capabilityWeightBp * input.weightBp) / FULL),
    contractVersion: c?.version ?? null,
    specifiedBp: Math.floor(specNum / FULL),
    builtBp: Math.floor(builtNum / FULL),
    complete: surfaces.every((s) => s.complete),
    relevantPoints,
    mergedPoints,
    surfaces,
    requirements,
  };
}

/** Progress of one app: features, capabilities, surfaces and the app triple. Throws on inputs that violate D12/D13. */
export function computeAppProgress(input: ProgressInput): AppProgress {
  const r = input.roadmap;
  if (r === null) {
    return {
      target: input.target,
      roadmapVersion: null,
      inventoryVersion: null,
      inventoryItems: null,
      excludedItems: 0,
      mappedBp: 0,
      specifiedBp: 0,
      builtBp: 0,
      surfaces: [],
      capabilities: [],
      features: [],
    };
  }
  assertInt(r.inventoryItems, "inventoryItems");
  assertInt(r.excludedItems, "excludedItems");
  const capTotal = r.capabilities.reduce((n, c) => n + c.weightBp, 0);
  if (capTotal !== FULL) throw new RangeError(`capability weights must sum to 10000, got ${capTotal}`);

  const capabilities: CapabilityProgress[] = [];
  const features: FeatureProgress[] = [];
  const perSurface = new Map<string, { weight: bigint; spec: bigint; built: bigint }>();
  let mappedBp = 0;
  let specNum = 0;
  let builtNum = 0;
  for (const cap of [...r.capabilities].sort((a, b) => a.capability.localeCompare(b.capability))) {
    assertBp(cap.weightBp, `weightBp of capability ${cap.capability}`);
    if (cap.features.length === 0) {
      capabilities.push({ capability: cap.capability, weightBp: cap.weightBp, mapped: false, specifiedBp: 0, builtBp: 0 });
      continue;
    }
    const featTotal = cap.features.reduce((n, f) => n + f.weightBp, 0);
    if (featTotal !== FULL) throw new RangeError(`feature weights in ${cap.capability} must sum to 10000, got ${featTotal}`);
    let capSpec = 0;
    let capBuilt = 0;
    for (const f of [...cap.features].sort((a, b) => a.feature.localeCompare(b.feature))) {
      const fp = computeFeatureProgress(f, cap.weightBp);
      features.push(fp);
      capSpec += f.weightBp * fp.specifiedBp;
      capBuilt += f.weightBp * fp.builtBp;
      for (const s of fp.surfaces) {
        // BigInt: weight products reach 1e12 and times 1e4 exceed 2^53.
        const w = BigInt(cap.weightBp) * BigInt(f.weightBp) * BigInt(s.weightBp);
        const acc = perSurface.get(s.surface) ?? { weight: 0n, spec: 0n, built: 0n };
        acc.weight += w;
        acc.spec += w * BigInt(s.specifiedBp);
        acc.built += w * BigInt(s.builtBp);
        perSurface.set(s.surface, acc);
      }
    }
    mappedBp += cap.weightBp;
    specNum += cap.weightBp * capSpec;
    builtNum += cap.weightBp * capBuilt;
    capabilities.push({
      capability: cap.capability,
      weightBp: cap.weightBp,
      mapped: true,
      specifiedBp: Math.floor(capSpec / FULL),
      builtBp: Math.floor(capBuilt / FULL),
    });
  }
  const surfaces: AppSurfaceProgress[] = [...perSurface.entries()]
    .map(([surface, a]) => ({
      surface: surface as Surface,
      specifiedBp: a.weight === 0n ? 0 : Number(a.spec / a.weight),
      builtBp: a.weight === 0n ? 0 : Number(a.built / a.weight),
    }))
    .sort(bySurface);
  return {
    target: input.target,
    roadmapVersion: r.version,
    inventoryVersion: r.inventoryVersion,
    inventoryItems: r.inventoryItems,
    excludedItems: r.excludedItems,
    mappedBp,
    specifiedBp: Math.floor(specNum / (FULL * FULL)),
    builtBp: Math.floor(builtNum / (FULL * FULL)),
    surfaces,
    capabilities,
    features,
  };
}

/** Display rule for every surface: floor to whole percent; "<1%" for 1..99 bp; never round up to 100. */
export function formatPercent(bp: BasisPoints): string {
  if (bp === 0) return "0%";
  if (bp < 100) return "<1%";
  if (bp < FULL) return `${Math.min(99, Math.floor(bp / 100))}%`;
  return "100%";
}

// ---------------------------------------------------------------------------------------------
// Application progress (Amendment 01; WOS-APP-PROTOCOL section 11; contracts 5.2.0)
// ---------------------------------------------------------------------------------------------

/**
 * Application progress: "wOS CRM, overall 31%, desktop 48%, ...". The target (Sniper List) is what we replace; the
 * application is what we ship, and the two are computed separately from the same records:
 *
 *  Input: the application's manifest `features` (catalog features, D10) and the surfaces its manifest supports.
 *  For each feature, the latest MERGED contract's requirement surface tags, its merged build graph's ABUs and, per
 *  surface, whether that feature's acceptance check passed on the default branch for at least one profile.
 *
 *  Per supported surface S:
 *    relevant_S = non-superseded ABUs of the app's features that cover at least one requirement tagged S.
 *    BUILT_S    = floor(10000 * mergedPoints_S / relevantPoints_S) (0 when nothing is relevant), capped at 9999
 *                 until complete_S: relevant_S non-empty, every relevant ABU merged, every feature of the app has
 *                 a merged contract, and every feature with an S-tagged requirement passed acceptance on S.
 *  Overall:     size-point-weighted mean of BUILT_S over supported surfaces
 *               = floor(sum_S relevantPoints_S * BUILT_S / sum_S relevantPoints_S), capped at 9999 until every
 *               supported surface is complete.
 *
 *  No weights of its own (it uses size points only) and no invented numbers: an app with no merged work is 0%.
 *
 *  Independence (V1 proof step 9): this function and `computeAppProgress` take disjoint inputs. Neither takes an
 *  organization, an entitlement or an install state, and `ProgressInput` (a target's) has no application field,
 *  so enabling, disabling or installing an application can never move a target's progress.
 */

/**
 * The product surfaces an application supports; the same set as `ProductSurface` in wos-app.ts, spelled here so this
 * file keeps its single import (apps/web vendors it verbatim, scripts/sync-shared.mjs).
 */
export type ApplicationSurface = Extract<Surface, "web" | "desktop" | "ios" | "android" | "api">;

/** One catalog feature the application ships (manifest `features`). */
export interface ApplicationFeatureInput {
  feature: FeatureKey;
  /** Latest merged contract of the catalog feature, or null if none has merged. */
  contract: null | {
    version: number;
    /** Surface tags of every requirement of the contract (D13). */
    requirementSurfaces: Record<RequirementKey, Surface[]>;
    /** ABUs of the contract's merged build graph. */
    abus: ProgressAbuInput[];
    /** Per surface: the feature's acceptance check passed on the default branch for at least one profile. */
    acceptancePassed: Partial<Record<Surface, boolean>>;
  };
}

export interface ApplicationProgressInput {
  /** Application id (WOS-APP `app.id`), e.g. "crm". */
  app: string;
  /** Surfaces the application's manifest supports (`surfaces.<s>.supported`). */
  surfaces: ApplicationSurface[];
  features: ApplicationFeatureInput[];
}

export interface ApplicationFeatureProgress {
  feature: FeatureKey;
  contractVersion: number | null;
  /** Size points of its non-superseded ABUs tagged with any supported surface, and of those merged. */
  relevantPoints: number;
  mergedPoints: number;
}

export interface ApplicationSurfaceProgress {
  surface: ApplicationSurface;
  relevantPoints: number;
  mergedPoints: number;
  builtBp: BasisPoints;
  /** Every feature with a requirement tagged with this surface passed acceptance on it (false when none has one). */
  acceptancePassed: boolean;
  complete: boolean;
}

export interface ApplicationProgress {
  app: string;
  /** Overall: size-point-weighted mean across supported surfaces. */
  builtBp: BasisPoints;
  /** Sums of the per-surface points (the weights of the mean): an ABU covering two surfaces counts on each. */
  relevantPoints: number;
  mergedPoints: number;
  complete: boolean;
  surfaces: ApplicationSurfaceProgress[];
  features: ApplicationFeatureProgress[];
}

/** Progress of one application from its features' merged records. Pure; throws on duplicate features or surfaces. */
export function computeApplicationProgress(input: ApplicationProgressInput): ApplicationProgress {
  const surfaceSet = new Set<ApplicationSurface>(input.surfaces);
  if (surfaceSet.size !== input.surfaces.length) throw new RangeError(`duplicate surface in application ${input.app}`);
  const featureSet = new Set(input.features.map((f) => f.feature));
  if (featureSet.size !== input.features.length) throw new RangeError(`duplicate feature in application ${input.app}`);

  const features = [...input.features].sort((a, b) => a.feature.localeCompare(b.feature));
  const allContracts = features.every((f) => f.contract !== null);
  const live = (f: ApplicationFeatureInput) => (f.contract?.abus ?? []).filter((a) => !a.superseded);
  const tagged = (f: ApplicationFeatureInput, a: ProgressAbuInput, s: Surface) =>
    a.requirements.some((r) => (f.contract?.requirementSurfaces[r] ?? []).includes(s));
  const hasRequirementOn = (f: ApplicationFeatureInput, s: Surface) =>
    Object.values(f.contract?.requirementSurfaces ?? {}).some((tags) => tags.includes(s));

  const surfaces: ApplicationSurfaceProgress[] = [...surfaceSet].sort().map((surface) => {
    let relevantPoints = 0;
    let mergedPoints = 0;
    let allMerged = true;
    for (const f of features)
      for (const a of live(f))
        if (tagged(f, a, surface)) {
          relevantPoints += a.sizePoints;
          if (a.merged) mergedPoints += a.sizePoints;
          else allMerged = false;
        }
    const onSurface = features.filter((f) => hasRequirementOn(f, surface));
    const acceptancePassed = onSurface.length > 0 && onSurface.every((f) => f.contract?.acceptancePassed[surface] === true);
    const complete = relevantPoints > 0 && allMerged && allContracts && acceptancePassed;
    let builtBp = relevantPoints === 0 ? 0 : Math.floor((FULL * mergedPoints) / relevantPoints);
    if (complete) builtBp = FULL;
    else if (builtBp >= FULL) builtBp = FULL - 1;
    return { surface, relevantPoints, mergedPoints, builtBp, acceptancePassed, complete };
  });

  const featureProgress: ApplicationFeatureProgress[] = features.map((f) => {
    const abus = live(f).filter((a) => [...surfaceSet].some((s) => tagged(f, a, s)));
    return {
      feature: f.feature,
      contractVersion: f.contract?.version ?? null,
      relevantPoints: abus.reduce((n, a) => n + a.sizePoints, 0),
      mergedPoints: abus.filter((a) => a.merged).reduce((n, a) => n + a.sizePoints, 0),
    };
  });

  const relevantPoints = surfaces.reduce((n, s) => n + s.relevantPoints, 0);
  const mergedPoints = surfaces.reduce((n, s) => n + s.mergedPoints, 0);
  const complete = surfaces.length > 0 && surfaces.every((s) => s.complete);
  let builtBp = relevantPoints === 0 ? 0 : Math.floor(surfaces.reduce((n, s) => n + s.relevantPoints * s.builtBp, 0) / relevantPoints);
  if (!complete && builtBp >= FULL) builtBp = FULL - 1;
  return { app: input.app, builtBp, relevantPoints, mergedPoints, complete, surfaces, features: featureProgress };
}

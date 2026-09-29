/**
 * Progress calculation (D10, D11, D12). Pure, deterministic, integer-only. This file is the contract:
 * the control plane's progress consumer calls `computeAppProgress` on every relevant merge event and
 * appends the result as snapshots; the web renders the result verbatim with `formatPercent`.
 * ROADMAP-PROTOCOL.md "Progress" is the prose version of this file.
 *
 *  Weights (D12) — reasoned by the Roadmap Agent, reviewed at consensus, frozen per merged roadmap version:
 *    W_c  capability c's share of the app, basis points; all capabilities of the app sum to 10000.
 *    w_f  feature f's share of its capability, basis points; a mapped capability's features sum to 10000.
 *    Effective weight of f toward the app = W_c * w_f / 10000 (published on the feature page).
 *
 *  Feature level (per app, using the latest MERGED contract of the catalog feature, D10)
 *    SPECIFIED_f = 10000 if that contract contains a profile for this app, else 0. Binary by design:
 *                  the profile is the complete list of requirements the app needs, and D10 says the
 *                  feature is specified for the app only when all of them are.
 *    relevant ABUs = non-superseded ABUs whose requirements intersect the app's profile.
 *    BUILT_f     = 0 if not specified; else floor(10000 * mergedPoints / relevantPoints), capped at
 *                  9999 until complete (all relevant ABUs merged AND the profile's acceptance suite
 *                  passed on the default branch), then 10000.
 *                  The split inside a feature is MECHANICAL by ABU size points (1,2,3,5,8) fixed in the
 *                  consensus build graph. V1 allows no per-requirement weight override: a second weighting
 *                  layer adds a gaming surface without making the number more honest (GAPS.md G-30).
 *
 *  Capability level: unmapped capability => 0/0/0. Mapped:
 *    MAPPED_c = 10000, SPECIFIED_c = floor(sum_f(w_f * SPECIFIED_f) / 10000), BUILT_c likewise.
 *
 *  App level (sums over capabilities)
 *    MAPPED    = sum of W_c over mapped capabilities
 *    SPECIFIED = floor(sum_c sum_f (W_c * w_f * SPECIFIED_f) / 10^8)
 *    BUILT     = floor(sum_c sum_f (W_c * w_f * BUILT_f) / 10^8)
 *    => BUILT <= SPECIFIED <= MAPPED always, and 10000 only when literally everything is complete.
 *
 *  The inventory (roadmaps/<target>/INVENTORY.yaml) is the completeness evidence reviewers check the
 *  roadmap against; it is reported alongside (items, excluded) but does not weight anything.
 */

import type { AbuKey, BasisPoints, CapabilityKey, FeatureKey, RequirementKey, TargetSlug } from "./primitives.js";

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
  /** Latest merged contract of the catalog feature, or null if none has merged. */
  contract: null | {
    version: number;
    /** This app's profile requirement ids; empty when the merged contract has no profile for the app. */
    profile: RequirementKey[];
    abus: ProgressAbuInput[];
    /** Profile acceptance suite passed on the default branch at or after the last relevant merge. */
    profileAcceptancePassed: boolean;
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
  /** Relevant ABUs covering it. */
  abus: AbuKey[];
  built: boolean;
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
  relevantPoints: number;
  mergedPoints: number;
  complete: boolean;
  requirements: RequirementProgress[];
}

export interface CapabilityProgress {
  capability: CapabilityKey;
  weightBp: number;
  mapped: boolean;
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

/** Progress of one feature for one app. `capabilityWeightBp` only feeds the published effective weight. */
export function computeFeatureProgress(input: ProgressFeatureInput, capabilityWeightBp: number): FeatureProgress {
  assertBp(input.weightBp, `weightBp of ${input.feature}`);
  const base = {
    feature: input.feature,
    capability: input.capability,
    weightBp: input.weightBp,
    effectiveAppWeightBp: Math.floor((capabilityWeightBp * input.weightBp) / FULL),
    contractVersion: input.contract?.version ?? null,
  };
  const c = input.contract;
  if (c === null || c.profile.length === 0) {
    return { ...base, specifiedBp: 0, builtBp: 0, relevantPoints: 0, mergedPoints: 0, complete: false, requirements: [] };
  }
  const profile = new Set(c.profile);
  const relevant = c.abus.filter((a) => !a.superseded && a.requirements.some((r) => profile.has(r)));
  let relevantPoints = 0;
  let mergedPoints = 0;
  for (const a of relevant) {
    relevantPoints += a.sizePoints;
    if (a.merged) mergedPoints += a.sizePoints;
  }
  const requirements: RequirementProgress[] = [...profile].sort().map((key) => {
    const covering = relevant.filter((a) => a.requirements.includes(key));
    return { key, abus: covering.map((a) => a.key).sort(), built: covering.length > 0 && covering.every((a) => a.merged) };
  });
  const complete = relevant.length > 0 && requirements.every((r) => r.built) && c.profileAcceptancePassed;
  let builtBp = relevantPoints === 0 ? 0 : Math.floor((FULL * mergedPoints) / relevantPoints);
  if (complete) builtBp = FULL;
  else if (builtBp >= FULL) builtBp = FULL - 1;
  return { ...base, specifiedBp: FULL, builtBp, relevantPoints, mergedPoints, complete, requirements };
}

/** Progress of one app: features, capabilities and the app triple. Throws on inputs that violate D12. */
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
  return {
    target: input.target,
    roadmapVersion: r.version,
    inventoryVersion: r.inventoryVersion,
    inventoryItems: r.inventoryItems,
    excludedItems: r.excludedItems,
    mappedBp,
    specifiedBp: Math.floor(specNum / (FULL * FULL)),
    builtBp: Math.floor(builtNum / (FULL * FULL)),
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

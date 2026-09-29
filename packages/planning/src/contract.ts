/**
 * Deterministic Feature Contract checks that are not about the build graph (FEATURE-CONTRACT.md sections 2
 * and 5): version sequence, unique keys, one profile per app, and the shared-contract versioning rule
 * ("changing a requirement that appears in an unlisted app's profile is a validation error").
 *
 * Ratified in contracts 4.2.0 (B-0002-planning); the control plane calls it beside validateBuildGraph.
 */
import { type FeatureContract, FeatureContractErrorCode } from "@waronsaas/contracts";
import { canonicalJson } from "@waronsaas/contracts/canonical";

/** The ratified codes (contracts 4.2.0 `FeatureContractErrorCode`, B-0002-planning). */
export const CONTRACT_ERROR_CODES = FeatureContractErrorCode.options;
export type ContractErrorCode = FeatureContractErrorCode;
export interface ContractIssue {
  code: ContractErrorCode;
  message: string;
}

/**
 * `previous` is the latest MERGED version of the same feature, or null for version 1.
 */
export function validateFeatureContract(contract: FeatureContract, previous: FeatureContract | null): ContractIssue[] {
  const out: ContractIssue[] = [];
  const add = (code: ContractErrorCode, message: string) => out.push({ code, message });

  const expected = (previous?.version ?? 0) + 1;
  if (contract.version !== expected) add("VERSION_NOT_NEXT", `version is ${contract.version}; expected ${expected}`);
  if (previous && previous.feature !== contract.feature)
    add("FEATURE_MISMATCH", `previous merged version is for ${previous.feature}, this one for ${contract.feature}`);

  const dup = (code: ContractErrorCode, what: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) add(code, `${what} ${k} is listed twice`);
      seen.add(k);
    }
  };
  dup(
    "REQUIREMENT_DUPLICATE",
    "requirement",
    contract.requirements.map((r) => r.key),
  );
  dup(
    "JOURNEY_DUPLICATE",
    "journey",
    contract.journeys.map((j) => j.key),
  );
  dup(
    "PROFILE_DUPLICATE",
    "profile for",
    contract.profiles.map((p) => p.target),
  );

  if (contract.version > 1 && contract.impactedTargets.length === 0)
    add(
      "IMPACTED_TARGETS_MISSING",
      `version ${contract.version} must list impactedTargets: every app whose profile or shared requirements changed`,
    );

  if (previous) {
    const listed = new Set(contract.impactedTargets);
    const before = new Map(previous.requirements.map((r) => [r.key, canonicalJson(r)]));
    const after = new Map(contract.requirements.map((r) => [r.key, canonicalJson(r)]));
    const changedReq = (k: string) => before.get(k) !== after.get(k);
    const prevProfiles = new Map(previous.profiles.map((p) => [p.target, p]));
    const nextProfiles = new Map(contract.profiles.map((p) => [p.target, p]));
    const targets = [...new Set([...prevProfiles.keys(), ...nextProfiles.keys()])].sort();
    for (const t of targets) {
      const a = prevProfiles.get(t);
      const b = nextProfiles.get(t);
      let why: string | null = null;
      if (!a) why = "its profile is new in this version";
      else if (!b) why = "its profile was removed";
      else if (canonicalJson([...a.requirements].sort()) !== canonicalJson([...b.requirements].sort()))
        why = "its requirement list changed";
      else if (canonicalJson(a.acceptance) !== canonicalJson(b.acceptance)) why = "its acceptance suites changed";
      else {
        const changed = b.requirements.filter(changedReq);
        if (changed.length > 0) why = `requirements it lists changed (${changed.join(", ")})`;
      }
      if (why && !listed.has(t)) add("PROFILE_CHANGED_UNLISTED", `${t} is affected (${why}) but is not in impactedTargets`);
    }
  }
  return out;
}

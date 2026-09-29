import { describe, expect, it } from "vitest";
import { CONTRACT_ERROR_CODES, type ContractErrorCode, validateFeatureContract } from "../src/index.js";
import { clone, contract } from "./fixtures.js";

type C = ReturnType<typeof contract>;
const v1 = contract();
/** v2 that changes nothing, listing one impacted app (so the version rule holds). */
const v2 = (mut: (c: C) => void = () => {}): C => {
  const c = clone(v1);
  c.version = 2;
  c.impactedTargets = ["acme-crm"];
  mut(c);
  return c;
};
const codes = (xs: ReturnType<typeof validateFeatureContract>) => [...new Set(xs.map((x) => x.code))].sort();

const CASES: Record<ContractErrorCode, { why: string; run: () => ReturnType<typeof validateFeatureContract> }> = {
  VERSION_NOT_NEXT: {
    why: "v3 after merged v1",
    run: () =>
      validateFeatureContract(
        v2((c) => (c.version = 3)),
        v1,
      ),
  },
  FEATURE_MISMATCH: {
    why: "previous version belongs to another feature",
    run: () => validateFeatureContract(v2(), { ...clone(v1), feature: "people" }),
  },
  REQUIREMENT_DUPLICATE: {
    why: "R-001 twice",
    run: () => validateFeatureContract({ ...clone(v1), requirements: [...v1.requirements, v1.requirements[0]!] }, null),
  },
  JOURNEY_DUPLICATE: {
    why: "J-001 twice",
    run: () => validateFeatureContract({ ...clone(v1), journeys: [...v1.journeys, v1.journeys[0]!] }, null),
  },
  PROFILE_DUPLICATE: {
    why: "two acme-crm profiles",
    run: () => validateFeatureContract({ ...clone(v1), profiles: [...v1.profiles, v1.profiles[0]!] }, null),
  },
  IMPACTED_TARGETS_MISSING: {
    why: "a version > 1 with no impactedTargets",
    run: () =>
      validateFeatureContract(
        v2((c) => (c.impactedTargets = [])),
        v1,
      ),
  },
  PROFILE_CHANGED_UNLISTED: {
    why: "R-001 (in other-crm's profile) changes but only acme-crm is listed",
    run: () =>
      validateFeatureContract(
        v2((c) => (c.requirements[0]!.statement = "The system MUST do R-001 differently.")),
        v1,
      ),
  },
};

describe("validateFeatureContract (additive; B-0001-planning item 4)", () => {
  it("feature-contract-consensus R-001 two apps may hold profiles with different requirement ids of one contract", () => {
    expect(v1.profiles.map((p) => p.requirements.length)).toEqual([3, 2]);
    expect(validateFeatureContract(v1, null)).toEqual([]);
  });

  it("covers every contract error code", () => {
    expect(Object.keys(CASES).sort()).toEqual([...CONTRACT_ERROR_CODES].sort());
  });

  for (const code of CONTRACT_ERROR_CODES) {
    const c = CASES[code];
    const req = code === "IMPACTED_TARGETS_MISSING" || code === "PROFILE_CHANGED_UNLISTED" ? "feature-contract-consensus R-002 " : "";
    it(`${req}${code}: ${c.why}`, () => {
      expect(codes(c.run())).toEqual([code]);
    });
  }

  it("a change only to acme-crm's own requirement, listing acme-crm, passes", () => {
    expect(
      validateFeatureContract(
        v2((c) => (c.requirements[2]!.statement = "The system MUST do R-003 better.")),
        v1,
      ),
    ).toEqual([]);
  });

  it("adding a profile for a new app requires listing it", () => {
    const next = v2((c) => c.profiles.push({ ...clone(c.profiles[1]!), target: "third-crm" }));
    expect(validateFeatureContract(next, v1).map((i) => i.message)).toEqual([expect.stringContaining("third-crm")]);
    next.impactedTargets.push("third-crm");
    expect(validateFeatureContract(next, v1)).toEqual([]);
  });

  it("a removed profile and a changed acceptance suite both count as impact", () => {
    const removed = v2((c) => (c.profiles = [c.profiles[0]!]));
    expect(validateFeatureContract(removed, v1).map((i) => i.message)).toEqual([expect.stringContaining("other-crm")]);
    const suite = v2((c) => (c.profiles[1]!.acceptance[0]!.run = ["npm", "run", "e2e"]));
    expect(validateFeatureContract(suite, v1).map((i) => i.message)).toEqual([expect.stringContaining("acceptance")]);
  });
});

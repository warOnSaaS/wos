import { describe, expect, it } from "vitest";
import { computeAppProgress, computeFeatureProgress, formatPercent, type ProgressFeatureInput, type ProgressInput } from "../src/index.js";

const abu = (key: string, sizePoints: 1 | 2 | 3 | 5 | 8, requirements: string[], merged: boolean) => ({
  key,
  sizePoints,
  requirements,
  merged,
  superseded: false,
  prUrl: merged ? `https://github.com/waronsaas/suite/pull/${key.length}` : null,
});

/** "contacts": R-001/R-002 shared, R-003 Salesforce-only, R-004 HubSpot-only. */
const contactsContract = (profile: string[], merged: { [k: string]: boolean }, acceptance = false) => ({
  version: 1,
  profile,
  profileAcceptancePassed: acceptance,
  abus: [
    abu("contacts#01", 3, ["R-001"], merged["contacts#01"] ?? false),
    abu("contacts#02", 5, ["R-002"], merged["contacts#02"] ?? false),
    abu("contacts#03", 2, ["R-003"], merged["contacts#03"] ?? false),
    abu("contacts#04", 8, ["R-004"], merged["contacts#04"] ?? false),
  ],
});

const feature = (over: Partial<ProgressFeatureInput>): ProgressFeatureInput => ({
  feature: "contacts",
  capability: "crm",
  weightBp: 10_000,
  contract: null,
  ...over,
});

describe("feature progress (D10)", () => {
  it("is 0/0 before a contract merges and when the merged contract has no profile for the app", () => {
    expect(computeFeatureProgress(feature({}), 10_000)).toMatchObject({ specifiedBp: 0, builtBp: 0 });
    expect(computeFeatureProgress(feature({ contract: contactsContract([], {}) }), 10_000)).toMatchObject({ specifiedBp: 0, builtBp: 0 });
  });

  it("building HubSpot's slice does not move Salesforce's BUILT", () => {
    const merged = { "contacts#04": true };
    const sf = computeFeatureProgress(feature({ contract: contactsContract(["R-001", "R-002", "R-003"], merged) }), 10_000);
    const hs = computeFeatureProgress(feature({ contract: contactsContract(["R-001", "R-002", "R-004"], merged) }), 10_000);
    expect(sf.builtBp).toBe(0);
    expect(hs.builtBp).toBe(Math.floor((10_000 * 8) / 16));
  });

  it("a shared ABU counts for every app whose profile it covers (built once, D10)", () => {
    const merged = { "contacts#01": true };
    const sf = computeFeatureProgress(feature({ contract: contactsContract(["R-001", "R-002", "R-003"], merged) }), 10_000);
    const hs = computeFeatureProgress(feature({ contract: contactsContract(["R-001", "R-002", "R-004"], merged) }), 10_000);
    expect(sf.mergedPoints).toBe(3);
    expect(hs.mergedPoints).toBe(3);
    expect(sf.builtBp).toBe(3000); // 3 of 10 points
  });

  it("caps at 9999 until every relevant ABU is merged AND the profile acceptance suite passed", () => {
    const all = { "contacts#01": true, "contacts#02": true, "contacts#03": true };
    const noAcceptance = computeFeatureProgress(feature({ contract: contactsContract(["R-001", "R-002", "R-003"], all, false) }), 10_000);
    expect(noAcceptance.builtBp).toBe(9_999);
    expect(noAcceptance.complete).toBe(false);
    const done = computeFeatureProgress(feature({ contract: contactsContract(["R-001", "R-002", "R-003"], all, true) }), 10_000);
    expect(done.builtBp).toBe(10_000);
    expect(done.requirements.every((r) => r.built)).toBe(true);
  });

  it("ignores superseded ABUs", () => {
    const c = contactsContract(["R-001"], {});
    c.abus[0] = { ...c.abus[0]!, superseded: true };
    expect(computeFeatureProgress(feature({ contract: c }), 10_000).relevantPoints).toBe(0);
  });
});

describe("app progress (D11/D12)", () => {
  const input = (capabilities: NonNullable<ProgressInput["roadmap"]>["capabilities"]): ProgressInput => ({
    target: "salesforce",
    roadmap: { version: 1, inventoryVersion: 1, inventoryItems: 120, excludedItems: 4, capabilities },
  });

  it("is all zero before the first roadmap merges", () => {
    expect(computeAppProgress({ target: "salesforce", roadmap: null })).toMatchObject({
      mappedBp: 0,
      specifiedBp: 0,
      builtBp: 0,
      roadmapVersion: null,
    });
  });

  it("MAPPED is the reasoned weight of mapped capabilities; unmapped capabilities contribute nothing", () => {
    const p = computeAppProgress(
      input([
        { capability: "crm", weightBp: 6_000, features: [feature({ weightBp: 10_000 })] },
        { capability: "service", weightBp: 4_000, features: [] },
      ]),
    );
    expect(p.mappedBp).toBe(6_000);
    expect(p.specifiedBp).toBe(0);
    expect(p.capabilities.find((c) => c.capability === "service")).toMatchObject({ mapped: false, specifiedBp: 0 });
  });

  it("rolls feature numbers up by W_c * w_f and keeps BUILT <= SPECIFIED <= MAPPED", () => {
    const all = { "contacts#01": true, "contacts#02": true, "contacts#03": true };
    const p = computeAppProgress(
      input([
        {
          capability: "crm",
          weightBp: 5_000,
          features: [
            feature({ feature: "contacts", weightBp: 7_000, contract: contactsContract(["R-001", "R-002", "R-003"], all, true) }),
            feature({ feature: "deals", weightBp: 3_000 }),
          ],
        },
        { capability: "analytics", weightBp: 5_000, features: [] },
      ]),
    );
    expect(p.mappedBp).toBe(5_000);
    expect(p.specifiedBp).toBe(3_500); // 5000 * 7000 * 10000 / 1e8
    expect(p.builtBp).toBe(3_500);
    expect(p.features.find((f) => f.feature === "contacts")?.effectiveAppWeightBp).toBe(3_500);
    expect(p.builtBp).toBeLessThanOrEqual(p.specifiedBp);
    expect(p.specifiedBp).toBeLessThanOrEqual(p.mappedBp);
  });

  it("never reports 100% unless everything is complete", () => {
    const almost = { "contacts#01": true, "contacts#02": true, "contacts#03": true };
    const p = computeAppProgress(
      input([
        {
          capability: "crm",
          weightBp: 10_000,
          features: [feature({ contract: contactsContract(["R-001", "R-002", "R-003"], almost, false) })],
        },
      ]),
    );
    expect(p.builtBp).toBe(9_999);
    expect(formatPercent(p.builtBp)).toBe("99%");
  });

  it("rejects weights that do not sum to 10000 (D12)", () => {
    expect(() => computeAppProgress(input([{ capability: "crm", weightBp: 9_000, features: [] }]))).toThrow(/sum to 10000/);
    expect(() => computeAppProgress(input([{ capability: "crm", weightBp: 10_000, features: [feature({ weightBp: 5_000 })] }]))).toThrow(
      /sum to 10000/,
    );
  });

  it("formats honestly", () => {
    expect([0, 1, 99, 100, 5_050, 9_999, 10_000].map(formatPercent)).toEqual(["0%", "<1%", "<1%", "1%", "50%", "99%", "100%"]);
  });
});

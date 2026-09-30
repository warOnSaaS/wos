/**
 * Application progress (contracts 5.2.0, WOS-APP-PROTOCOL section 11) and its independence from target progress
 * (Amendment 01 V1 proof step 9).
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ApplicationFeatureInput,
  type ApplicationProgressInput,
  type ApplicationSurface,
  ApplicationProgressView,
  computeApplicationProgress,
  computeAppProgress,
  formatPercent,
  type ProductSurface,
  type ProgressInput,
  type Surface,
} from "../src/index.js";

const abu = (key: string, sizePoints: 1 | 2 | 3 | 5 | 8, requirements: string[], merged: boolean, superseded = false) => ({
  key,
  sizePoints,
  requirements,
  merged,
  superseded,
  prUrl: merged ? `https://github.com/waronsaas/product/pull/${key.length}` : null,
});

/** contacts: R-001 on web + mobile, R-002 web only, R-003 phones only. */
const TAGS: Record<string, Surface[]> = { "R-001": ["web", "ios", "android"], "R-002": ["web"], "R-003": ["ios", "android"] };
const contacts = (merged: Record<string, boolean>, acceptance: Partial<Record<Surface, boolean>> = {}): ApplicationFeatureInput => ({
  feature: "contacts",
  contract: {
    version: 2,
    requirementSurfaces: TAGS,
    acceptancePassed: acceptance,
    abus: [
      abu("contacts#01", 3, ["R-001"], merged["01"] ?? false),
      abu("contacts#02", 5, ["R-002"], merged["02"] ?? false),
      abu("contacts#03", 2, ["R-003"], merged["03"] ?? false),
      abu("contacts#04", 8, ["R-002"], false, true),
    ],
  },
});
const crm = (features: ApplicationFeatureInput[], surfaces: ApplicationProgressInput["surfaces"] = ["web", "ios"]) => ({
  app: "crm",
  surfaces,
  features,
});

describe("computeApplicationProgress", () => {
  it("is 0% with nothing merged, with no contract, and with no features — nothing is invented", () => {
    for (const input of [crm([contacts({})]), crm([{ feature: "contacts", contract: null }]), crm([])]) {
      const p = computeApplicationProgress(input);
      expect(p.builtBp).toBe(0);
      expect(formatPercent(p.builtBp)).toBe("0%");
      expect(p.complete).toBe(false);
      expect(p.surfaces.every((s) => s.builtBp === 0 && !s.complete)).toBe(true);
    }
    expect(computeApplicationProgress(crm([])).surfaces.map((s) => s.surface)).toEqual(["ios", "web"]);
  });

  it("weights each surface by size points and the overall by the surfaces' points; superseded ABUs never count", () => {
    const p = computeApplicationProgress(crm([contacts({ "01": true })]));
    // web: #01 (3) + #02 (5) relevant, 3 merged -> 3750; ios: #01 (3) + #03 (2), 3 merged -> 6000.
    expect(p.surfaces).toEqual([
      { surface: "ios", relevantPoints: 5, mergedPoints: 3, builtBp: 6000, acceptancePassed: false, complete: false },
      { surface: "web", relevantPoints: 8, mergedPoints: 3, builtBp: 3750, acceptancePassed: false, complete: false },
    ]);
    // overall = floor((5*6000 + 8*3750) / 13)
    expect(p.builtBp).toBe(Math.floor((5 * 6000 + 8 * 3750) / 13));
    expect(p.features).toEqual([{ feature: "contacts", contractVersion: 2, relevantPoints: 10, mergedPoints: 3 }]);
  });

  it("ignores ABUs only on surfaces the manifest does not support", () => {
    const p = computeApplicationProgress(crm([contacts({ "03": true })], ["web"]));
    expect(p.surfaces).toHaveLength(1);
    expect(p.surfaces[0]).toMatchObject({ surface: "web", relevantPoints: 8, mergedPoints: 0, builtBp: 0 });
    expect(p.features[0]).toMatchObject({ relevantPoints: 8, mergedPoints: 0 });
  });

  it("caps a surface at 99% until its acceptance passed, and the overall until every surface is complete", () => {
    const all = { "01": true, "02": true, "03": true };
    const noAcceptance = computeApplicationProgress(crm([contacts(all)]));
    expect(noAcceptance.surfaces.map((s) => s.builtBp)).toEqual([9999, 9999]);
    expect(formatPercent(noAcceptance.builtBp)).toBe("99%");

    const webOnly = computeApplicationProgress(crm([contacts(all, { web: true })]));
    expect(webOnly.surfaces.find((s) => s.surface === "web")).toMatchObject({ builtBp: 10_000, complete: true });
    expect(webOnly.complete).toBe(false);
    expect(webOnly.builtBp).toBeLessThan(10_000);

    const done = computeApplicationProgress(crm([contacts(all, { web: true, ios: true })]));
    expect(done).toMatchObject({ builtBp: 10_000, complete: true });
  });

  it("is never complete while one of the app's features has no merged contract", () => {
    const all = { "01": true, "02": true, "03": true };
    const p = computeApplicationProgress(crm([contacts(all, { web: true, ios: true }), { feature: "pipelines", contract: null }]));
    expect(p.complete).toBe(false);
    expect(p.surfaces.every((s) => s.builtBp === 9999)).toBe(true);
    expect(p.features.map((f) => f.feature)).toEqual(["contacts", "pipelines"]);
  });

  it("is never complete with a supported surface that has no work, even when the others are", () => {
    const all = { "01": true, "02": true, "03": true };
    const p = computeApplicationProgress(crm([contacts(all, { web: true, ios: true, desktop: true })], ["web", "ios", "desktop"]));
    expect(p.surfaces.find((s) => s.surface === "desktop")).toMatchObject({ relevantPoints: 0, builtBp: 0, complete: false });
    expect(p.complete).toBe(false);
    expect(p.builtBp).toBe(9999);
  });

  it("rejects duplicate features and surfaces", () => {
    expect(() => computeApplicationProgress(crm([contacts({}), contacts({})]))).toThrow(RangeError);
    expect(() => computeApplicationProgress(crm([], ["web", "web"]))).toThrow(RangeError);
  });

  it("produces what ApplicationProgressView publishes", () => {
    const p = computeApplicationProgress(crm([contacts({ "01": true })]));
    const view = {
      ...p,
      basis: "release",
      manifestVersion: "0.1.0",
      targets: ["hubspot", "salesforce"],
      computedAt: "2026-09-30T00:00:00.000Z",
    };
    expect(ApplicationProgressView.safeParse(view).error?.issues ?? []).toEqual([]);
  });
});

describe("V1 proof step 9: a target's progress is independent of CRM entitlement and install state", () => {
  it("takes structurally different inputs: nothing about apps, organizations, entitlements or installs", () => {
    expectTypeOf<keyof ProgressInput>().toEqualTypeOf<"target" | "roadmap">();
    expectTypeOf<keyof NonNullable<ProgressInput["roadmap"]>>().toEqualTypeOf<
      "version" | "inventoryVersion" | "inventoryItems" | "excludedItems" | "capabilities"
    >();
    expectTypeOf<ApplicationSurface>().toEqualTypeOf<ProductSurface>();
    expectTypeOf<keyof ApplicationProgressInput>().toEqualTypeOf<"app" | "surfaces" | "features">();
    expectTypeOf(computeAppProgress).parameters.toEqualTypeOf<[ProgressInput]>();
    expectTypeOf(computeApplicationProgress).parameters.toEqualTypeOf<[ApplicationProgressInput]>();
  });

  it("toggling CRM (enabled, disabled, installed, removed) leaves the Salesforce snapshot unchanged", () => {
    const salesforce: ProgressInput = {
      target: "salesforce",
      roadmap: {
        version: 1,
        inventoryVersion: 1,
        inventoryItems: 40,
        excludedItems: 2,
        capabilities: [
          {
            capability: "crm",
            weightBp: 10_000,
            features: [
              {
                feature: "contacts",
                capability: "crm",
                weightBp: 10_000,
                surfaces: [{ surface: "web", weightBp: 10_000 }],
                contract: {
                  version: 2,
                  profile: ["R-001", "R-002"],
                  requirementSurfaces: TAGS,
                  acceptancePassed: {},
                  abus: contacts({ "01": true }).contract!.abus,
                },
              },
            ],
          },
        ],
      },
    };
    const snapshot = JSON.stringify(computeAppProgress(structuredClone(salesforce)));
    // Everything an organization can change about CRM, applied to the one world the functions could see.
    const world = { input: salesforce, crm: { entitlement: "available", installed: false } };
    for (const [entitlement, installed] of [
      ["enabled", true],
      ["disabled", true],
      ["enabled", false],
      ["suspended", false],
    ] as const) {
      world.crm = { entitlement, installed };
      expect(JSON.stringify(computeAppProgress(world.input))).toBe(snapshot);
    }
    expect(JSON.parse(snapshot)).toMatchObject({ target: "salesforce", builtBp: 3750 });
  });
});

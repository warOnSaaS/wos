import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  Changeset,
  Roadmap,
  RoadmapBundle,
  ReviewVerdict,
  Routes,
  WriteScope,
  computeAppProgress,
  type Roadmap as RoadmapT,
} from "../src/index.js";

const bundlePath = fileURLToPath(new URL("../../../docs/roadmap/waronsaas.roadmap.json", import.meta.url));

const baseRoadmap = (): RoadmapT => ({
  schema: "wos-roadmap.v1",
  target: "salesforce",
  version: 1,
  inventoryVersion: 1,
  productName: "Pipeline",
  apps: ["crm"],
  summary: "An open-source CRM.",
  architecture: { overview: "o", composition: "c", appSpecificData: "d", selfHosting: "s" },
  surfaces: [
    { surface: "web", status: "in_scope", reason: null, repo: "waronsaas/product", path: "products/salesforce/web" },
    { surface: "ios", status: "in_scope", reason: null, repo: "waronsaas/product", path: "products/salesforce/mobile" },
    { surface: "desktop", status: "excluded", reason: "The vendor's desktop app is a wrapper around the web app.", repo: null, path: null },
  ],
  capabilities: [
    {
      key: "crm",
      title: "CRM",
      summary: "Sales CRM",
      weightBp: 10_000,
      weightRationale: "The whole of this test roadmap; nothing else is mapped so it carries all weight.",
      inventoryItems: ["INV-0001", "INV-0002"],
      features: [
        {
          feature: "contacts",
          weightBp: 6_000,
          weightRationale: "Contacts are the core record every other CRM screen hangs off, so the larger share.",
          surfaces: [
            { surface: "web", weightBp: 6_000, weightRationale: "Most contact editing and bulk work happens at a desk in the browser." },
            {
              surface: "ios",
              weightBp: 4_000,
              weightRationale: "Reps look up and call contacts from the phone between meetings, often offline.",
            },
          ],
          journeys: [
            {
              key: "J-001",
              surface: "web",
              title: "Find and update a contact",
              steps: ["Open Contacts from the main navigation", "Search by name", "Edit the phone number and save"],
              entryPoints: ["main navigation"],
              platformBehaviour: "Responsive down to phone width; keyboard shortcuts on desktop.",
              nativeCapabilities: [],
            },
            {
              key: "J-002",
              surface: "ios",
              title: "Call a contact before a meeting",
              steps: ["Open the app from a meeting notification", "Tap the contact", "Tap call"],
              entryPoints: ["push notification", "home tab"],
              platformBehaviour: "Recently viewed contacts are available offline.",
              nativeCapabilities: ["push", "offline_storage"],
            },
          ],
          inventoryItems: ["INV-0001"],
          appNotes: "",
          phase: "core",
        },
        {
          feature: "deals",
          weightBp: 4_000,
          weightRationale: "Deals are central to sales but depend on contacts and have a smaller surface here.",
          surfaces: [
            {
              surface: "web",
              weightBp: 10_000,
              weightRationale: "Pipeline management is a desk task; the vendor's phone app only shows deals.",
            },
          ],
          journeys: [
            {
              key: "J-003",
              surface: "web",
              title: "Move a deal to the next stage",
              steps: ["Open the pipeline board", "Drag the deal to the next column"],
              entryPoints: ["main navigation"],
              platformBehaviour: "none",
              nativeCapabilities: [],
            },
          ],
          inventoryItems: ["INV-0002"],
          appNotes: "",
          phase: "core",
        },
      ],
    },
  ],
  excluded: [],
  newCatalogFeatures: [],
  proposals: [],
});

describe("roadmap schema: reasoned weights (D12)", () => {
  it("accepts a roadmap with weights, rationales and correct sums", () => {
    expect(Roadmap.safeParse(baseRoadmap()).success).toBe(true);
  });

  it("rejects a feature without a weight", () => {
    const r = baseRoadmap() as unknown as { capabilities: Array<{ features: Array<Record<string, unknown>> }> };
    delete r.capabilities[0]!.features[0]!.weightBp;
    expect(Roadmap.safeParse(r).success).toBe(false);
  });

  it("rejects a missing or boilerplate rationale", () => {
    const r = baseRoadmap();
    r.capabilities[0]!.features[1]!.weightRationale = "because";
    expect(Roadmap.safeParse(r).success).toBe(false);
    const r2 = baseRoadmap() as unknown as { capabilities: Array<Record<string, unknown>> };
    delete r2.capabilities[0]!.weightRationale;
    expect(Roadmap.safeParse(r2).success).toBe(false);
  });

  it("rejects weights that do not sum to 10000 at either level", () => {
    const r = baseRoadmap();
    r.capabilities[0]!.features[1]!.weightBp = 3_000;
    expect(Roadmap.safeParse(r).error?.issues[0]?.message).toMatch(/sum to 10000/);
    const r2 = baseRoadmap();
    r2.capabilities[0]!.weightBp = 9_000;
    expect(Roadmap.safeParse(r2).error?.issues[0]?.message).toMatch(/sum to 10000/);
  });
});

describe("roadmap schema: surfaces and journeys (D13)", () => {
  it("rejects a feature on a surface without a journey", () => {
    const r = baseRoadmap();
    r.capabilities[0]!.features[0]!.journeys = r.capabilities[0]!.features[0]!.journeys.filter((j) => j.surface !== "ios");
    expect(
      Roadmap.safeParse(r)
        .error?.issues.map((i) => i.message)
        .join(" "),
    ).toMatch(/no journey for surface ios/);
  });

  it("rejects a feature weighted on a surface that is not in scope", () => {
    const r = baseRoadmap();
    r.capabilities[0]!.features[1]!.surfaces = [{ surface: "desktop", weightBp: 10_000, weightRationale: "x".repeat(40) }];
    expect(
      Roadmap.safeParse(r)
        .error?.issues.map((i) => i.message)
        .join(" "),
    ).toMatch(/desktop of deals is not in scope/);
  });

  it("rejects surface weights that do not sum to 10000, or without a rationale", () => {
    const r = baseRoadmap();
    r.capabilities[0]!.features[0]!.surfaces[1]!.weightBp = 3_000;
    expect(Roadmap.safeParse(r).success).toBe(false);
    const r2 = baseRoadmap();
    r2.capabilities[0]!.features[0]!.surfaces[1]!.weightRationale = "phones";
    expect(Roadmap.safeParse(r2).success).toBe(false);
  });

  it("rejects an excluded surface without a reason and an in-scope surface without a repo", () => {
    const r = baseRoadmap();
    r.surfaces[2]!.reason = null;
    expect(Roadmap.safeParse(r).success).toBe(false);
    const r2 = baseRoadmap();
    r2.surfaces[0]!.repo = null;
    expect(Roadmap.safeParse(r2).success).toBe(false);
  });
});

describe("TGT-00 warOnSaaS roadmap (docs/roadmap/waronsaas.roadmap.json)", () => {
  const raw = JSON.parse(readFileSync(bundlePath, "utf8"));
  const parsed = RoadmapBundle.safeParse(raw);

  it("validates against the roadmap bundle schema and is marked PROPOSED", () => {
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));
    expect(parsed.data.status).toBe("PROPOSED");
    expect(parsed.data.targetCode).toBe("TGT-00");
    expect(parsed.data.roadmap.target).toBe("waronsaas");
  });

  it("places every inventory item in exactly one capability and, when mapped, exactly one feature", () => {
    const b = RoadmapBundle.parse(raw);
    const inCaps = b.roadmap.capabilities.flatMap((c) => c.inventoryItems);
    const excluded = b.roadmap.excluded.map((e) => e.item);
    expect([...inCaps, ...excluded].sort()).toEqual(b.inventory.items.map((i) => i.key).sort());
    for (const c of b.roadmap.capabilities) {
      if (c.features.length === 0) continue;
      expect(c.features.flatMap((f) => f.inventoryItems).sort()).toEqual([...c.inventoryItems].sort());
    }
  });

  it("references only catalog features, proposes all of them, and gives each requirements", () => {
    const b = RoadmapBundle.parse(raw);
    const catalog = new Set(b.catalog.map((c) => c.key));
    const refs = b.roadmap.capabilities.flatMap((c) => c.features.map((f) => f.feature));
    expect(new Set(refs).size).toBe(refs.length);
    for (const f of refs) expect(catalog.has(f), f).toBe(true);
    expect([...b.roadmap.newCatalogFeatures].sort()).toEqual([...catalog].sort());
    expect(b.requirements.map((r) => r.feature).sort()).toEqual([...refs].sort());
  });

  it("computes to 0% built (nothing merged) and 100% mapped (every capability mapped)", () => {
    const b = RoadmapBundle.parse(raw);
    const p = computeAppProgress({
      target: "waronsaas",
      roadmap: {
        version: b.roadmap.version,
        inventoryVersion: b.inventory.version,
        inventoryItems: b.inventory.items.length,
        excludedItems: b.roadmap.excluded.length,
        capabilities: b.roadmap.capabilities.map((c) => ({
          capability: c.key,
          weightBp: c.weightBp,
          features: c.features.map((f) => ({
            feature: f.feature,
            capability: c.key,
            weightBp: f.weightBp,
            surfaces: f.surfaces.map((s) => ({ surface: s.surface, weightBp: s.weightBp })),
            contract: null,
          })),
        })),
      },
    });
    expect(p.mappedBp).toBe(10_000);
    expect(p.specifiedBp).toBe(0);
    expect(p.builtBp).toBe(0);
  });
});

describe("other contracts", () => {
  it("route map: unique method+path, idempotency only on POST", () => {
    const seen = new Set<string>();
    for (const [name, r] of Object.entries(Routes)) {
      const k = `${r.method} ${r.path}`;
      expect(seen.has(k), `${name}: duplicate ${k}`).toBe(false);
      seen.add(k);
      if (r.idempotent) expect(r.method, name).toBe("POST");
    }
  });

  it("every contributor/maintainer route that creates work requires GitHub (D8): no 'account' auth on claims", () => {
    for (const [name, r] of Object.entries(Routes)) {
      if (/^claim|^submit|^create(Proposal|Blocker)|^post(Manifest|AgentRun|Attestation)/.test(name))
        expect(r.auth, name).toBe("contributor");
    }
  });

  it("a verdict must be consistent with its findings", () => {
    const v = { schema: "review-verdict.v1", summary: "s", priorFindings: [] } as const;
    const material = {
      localId: "f1",
      severity: "material",
      category: "incorrect",
      title: "t",
      detail: "d",
      evidence: [],
      suggestedResolution: "",
    } as const;
    expect(ReviewVerdict.safeParse({ ...v, verdict: "NO_MATERIAL_GAPS", findings: [material] }).success).toBe(false);
    expect(ReviewVerdict.safeParse({ ...v, verdict: "MATERIAL_GAPS", findings: [material] }).success).toBe(true);
    expect(ReviewVerdict.safeParse({ ...v, verdict: "MATERIAL_GAPS", findings: [] }).success).toBe(false);
  });

  it("write scopes are restricted to exact paths or <dir>/**", () => {
    for (const ok of ["modules/contacts/**", "modules/contacts/list.ts", "products/salesforce/nav.ts"])
      expect(WriteScope.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["modules/*/x.ts", "../x", "/abs", "a/**/b", "modules/{a,b}/**", ".git/config", "x/./y"])
      expect(WriteScope.safeParse(bad).success, bad).toBe(false);
  });

  it("changesets cannot carry symlinks or submodules by construction", () => {
    const base = {
      schema: "wos-changeset.v1",
      taskId: "0192f000-0000-7000-8000-000000000001",
      leaseId: "0192f000-0000-7000-8000-000000000002",
      deviceId: "0192f000-0000-7000-8000-000000000003",
      parentCommit: "a".repeat(40),
      manifestSha256: `sha256:${"1".repeat(64)}`,
      submissionSha256: `sha256:${"2".repeat(64)}`,
      signature: "sig",
      summary: { schema: "build-summary.v1", summary: "s", requirementsCovered: [], responses: [], abuConcerns: [] },
    };
    const file = { op: "upsert", path: "modules/contacts/a.ts", contentBase64: "", sha256: `sha256:${"3".repeat(64)}`, bytes: 0 };
    expect(Changeset.safeParse({ ...base, files: [{ ...file, mode: "100644" }] }).success).toBe(true);
    expect(Changeset.safeParse({ ...base, files: [{ ...file, mode: "120000" }] }).success).toBe(false);
    expect(Changeset.safeParse({ ...base, files: [{ ...file, mode: "160000" }] }).success).toBe(false);
  });
});

describe("product surfaces in roadmaps (contracts 5.0.0)", () => {
  it("a product-repo roadmap cannot put a vendor-only surface in scope; excluding it is fine", () => {
    const r = baseRoadmap();
    r.surfaces.push({ surface: "browser_extension", status: "in_scope", reason: null, repo: "waronsaas/product", path: "apps/web" });
    expect(
      Roadmap.safeParse(r)
        .error?.issues.map((i) => i.message)
        .join(" "),
    ).toMatch(/not a wOS product surface/);
    r.surfaces[r.surfaces.length - 1] = {
      surface: "browser_extension",
      status: "excluded",
      reason: "Post-V1: wOS ships no extension yet.",
      repo: null,
      path: null,
    };
    expect(Roadmap.safeParse(r).success).toBe(true);
  });
});

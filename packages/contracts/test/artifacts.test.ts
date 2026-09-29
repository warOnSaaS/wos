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
  summary: "An open-source CRM.",
  architecture: { overview: "o", composition: "c", appSpecificData: "d", selfHosting: "s" },
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
          inventoryItems: ["INV-0001"],
          appNotes: "",
          phase: "core",
        },
        {
          feature: "deals",
          weightBp: 4_000,
          weightRationale: "Deals are central to sales but depend on contacts and have a smaller surface here.",
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
          features: c.features.map((f) => ({ feature: f.feature, capability: c.key, weightBp: f.weightBp, contract: null })),
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

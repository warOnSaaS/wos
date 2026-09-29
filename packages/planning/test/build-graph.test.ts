import { BuildGraph, BuildGraphErrorCode, FeatureContract, type RepoManifest } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { type BuildGraphContext, scopeCanTouchGlob, validateBuildGraph } from "../src/index.js";
import { clone, contract, estimate, graph, policy, repoManifest } from "./fixtures.js";

type G = ReturnType<typeof graph>;
type C = ReturnType<typeof contract>;

function run(
  mut: { g?: (g: G) => void; c?: (c: C) => void; r?: (r: RepoManifest) => void; est?: (k: string) => number; ctx?: BuildGraphContext } = {},
) {
  const g = clone(graph());
  const c = clone(contract());
  const r = clone(repoManifest());
  mut.g?.(g);
  mut.c?.(c);
  mut.r?.(r);
  return validateBuildGraph(g, c, r, mut.est ?? estimate, policy, mut.ctx);
}
const codes = (issues: ReturnType<typeof run>) => [...new Set(issues.map((i) => i.code))].sort();

/** One failing fixture per BuildGraphErrorCode; each breaks exactly one rule of the valid baseline. */
const CASES: Record<BuildGraphErrorCode, { why: string; mut: Parameters<typeof run>[0]; abu?: string | null }> = {
  DUPLICATE_KEY: {
    why: "two ABUs share a key",
    mut: { g: (g) => g.abus.push({ ...clone(g.abus[1]!), scope: { write: ["modules/contacts/web2/**"], read: [] } }) },
    abu: "contacts#02",
  },
  KEY_NOT_IN_FEATURE: {
    why: "a key outside the feature",
    mut: {
      g: (g) => {
        g.abus[4]!.key = "people#05";
      },
    },
    abu: "people#05",
  },
  CONTRACT_VERSION_MISMATCH: {
    why: "the graph names another contract version (integration glue, contracts 4.2.0)",
    mut: {
      g: (g) => {
        g.contractVersion += 1;
      },
    },
    abu: null,
  },
  UNKNOWN_DEPENDENCY: { why: "depends on a missing ABU", mut: { g: (g) => g.abus[4]!.dependsOn.push("contacts#99") }, abu: "contacts#05" },
  CYCLE: { why: "01 depends on 05 which depends on 01", mut: { g: (g) => g.abus[0]!.dependsOn.push("contacts#05") }, abu: "contacts#01" },
  UNKNOWN_REQUIREMENT: { why: "an ABU implements R-009", mut: { g: (g) => g.abus[1]!.requirements.push("R-009") }, abu: "contacts#02" },
  REQUIREMENT_UNCOVERED: {
    why: "R-002 is in two profiles but no ABU implements it",
    mut: { g: (g) => (g.abus[1]!.requirements = ["R-001"]) },
    abu: null,
  },
  WRITE_SCOPE_PROTECTED: {
    why: "a scope overlaps generated dist/**",
    mut: { r: (r) => r.generatedPaths.push("modules/contacts/web/dist/**") },
    abu: "contacts#02",
  },
  PARALLEL_WRITE_OVERLAP: {
    why: "02 and 03 are unordered and both write modules/contacts/shared.ts",
    mut: {
      g: (g) => {
        g.abus[1]!.scope.write.push("modules/contacts/shared.ts");
        g.abus[2]!.scope.write.push("modules/contacts/shared.ts");
      },
    },
    abu: "contacts#03",
  },
  PARALLEL_EXCLUSIVE_RESOURCE: {
    why: "02 and 03 are unordered; one claims a route exclusive, the other shared",
    mut: {
      g: (g) => {
        g.abus[1]!.resources.push({ key: "api:route:GET /v1/contacts", mode: "exclusive" });
        g.abus[2]!.resources.push({ key: "api:route:GET /v1/contacts", mode: "shared" });
      },
    },
    abu: "contacts#03",
  },
  LOCKFILE_WITHOUT_RESOURCE: {
    why: "04 now writes all of native/ which holds a lockfile",
    mut: { g: (g) => (g.abus[3]!.scope.write = ["modules/contacts/native/**"]) },
    abu: "contacts#04",
  },
  TOOLCHAIN_WITHOUT_RESOURCE: {
    why: "04 writes a package.json without toolchain:<path>",
    mut: { g: (g) => (g.abus[3]!.resources = []) },
    abu: "contacts#04",
  },
  MIGRATION_WITHOUT_RESOURCE: {
    why: "01 writes a migration without db:migrations",
    mut: { g: (g) => (g.abus[0]!.resources = []) },
    abu: "contacts#01",
  },
  TEST_OUTSIDE_SCOPE: {
    why: "02 names a test outside its scope",
    mut: { g: (g) => g.abus[1]!.acceptance.tests.push("modules/contacts/api/web.test.ts") },
    abu: "contacts#02",
  },
  OVER_CONTEXT_BUDGET: {
    why: "03's builder context is over the builder budget",
    mut: { est: (k) => (k === "contacts#03" ? policy.roles.find((r) => r.role === "builder")!.contextBudgetTokens + 1 : 10_000) },
    abu: "contacts#03",
  },
  WRITE_OUTSIDE_MODULE_OR_PRODUCT: {
    why: "02 writes another feature's module",
    mut: { g: (g) => (g.abus[1]!.scope.write = ["modules/people/web/**"]) },
    abu: "contacts#02",
  },
  ABU_REPO_UNKNOWN: {
    why: "an ABU in an unregistered repository",
    mut: { g: (g) => (g.abus[2]!.repo = "someone/fork") },
    abu: "contacts#03",
  },
  SHARED_API_MISSING: { why: "multi-surface contract without sharedApi", mut: { c: (c) => (c.sharedApi = null) }, abu: null },
  JOURNEY_UNCOVERED: {
    why: "the android journey is removed although requirements are tagged android",
    mut: { c: (c) => (c.journeys = c.journeys.filter((j) => j.surface !== "android")) },
    abu: null,
  },
  REQUIREMENT_SURFACE_NOT_IN_SCOPE: {
    why: "R-002 is tagged android but its only profile (other-crm) has no android acceptance",
    mut: {
      c: (c) => {
        c.requirements[1]!.surfaces.push("android");
        c.profiles[0]!.requirements = ["R-001", "R-003"];
      },
    },
    abu: null,
  },
  NATIVE_CAPABILITY_UNPLANNED: {
    why: "the iOS push journey has no native ABU",
    mut: { g: (g) => (g.abus[3]!.scope.write = ["modules/contacts/mobile-push/**", "modules/contacts/native/package.json"]) },
    abu: null,
  },
};

describe("validateBuildGraph", () => {
  it("build-graph-validation R-001 the valid baseline graph has no issues", () => {
    expect(BuildGraph.safeParse(graph()).success).toBe(true);
    expect(FeatureContract.safeParse(contract()).success).toBe(true);
    expect(run()).toEqual([]);
  });

  it("covers every BuildGraphErrorCode with a fixture", () => {
    expect(Object.keys(CASES).sort()).toEqual([...BuildGraphErrorCode.options].sort());
  });

  for (const code of BuildGraphErrorCode.options) {
    const c = CASES[code];
    it(`build-graph-validation R-001 ${code}: ${c.why}`, () => {
      const issues = run(c.mut);
      expect(codes(issues)).toEqual([code]);
      if (c.abu !== undefined) expect(issues.find((i) => i.code === code)!.abu).toBe(c.abu);
      for (const i of issues) expect(i.message.length).toBeGreaterThan(10);
    });
  }

  it("dependency order makes overlapping scopes safe (no PARALLEL_* when one ABU transitively depends on the other)", () => {
    const issues = run({
      g: (g) => {
        g.abus[0]!.scope.write.push("modules/contacts/shared.ts");
        g.abus[4]!.scope.write.push("modules/contacts/shared.ts"); // 05 -> 02 -> 01
        g.abus[0]!.resources.push({ key: "db:table:contacts", mode: "exclusive" });
        g.abus[4]!.resources.push({ key: "db:table:contacts", mode: "exclusive" });
      },
    });
    expect(issues).toEqual([]);
  });

  it("two shared claims of one resource may run in parallel", () => {
    const issues = run({
      g: (g) => {
        g.abus[1]!.resources.push({ key: "event:contact.created", mode: "shared" });
        g.abus[2]!.resources.push({ key: "event:contact.created", mode: "shared" });
      },
    });
    expect(issues).toEqual([]);
  });

  it("write overlap is case-folded (macOS and Windows checkouts)", () => {
    const issues = run({
      g: (g) => {
        g.abus[1]!.scope.write.push("modules/contacts/Shared.ts");
        g.abus[2]!.scope.write.push("modules/contacts/shared.ts");
      },
    });
    expect(codes(issues)).toEqual(["PARALLEL_WRITE_OVERLAP"]);
  });

  it("a self-dependency is a cycle, reported once", () => {
    const issues = run({ g: (g) => g.abus[1]!.dependsOn.push("contacts#02") });
    expect(issues.filter((i) => i.code === "CYCLE")).toHaveLength(1);
  });

  it("multi-repo-products R-001 an ABU in another registered family is rejected, same family is accepted", () => {
    expect(codes(run({ g: (g) => (g.abus[2]!.repo = "waronsaas/wos") }))).toEqual(["ABU_REPO_UNKNOWN"]);
    expect(
      run({
        g: (g) => {
          for (const a of g.abus) a.repo = "waronsaas/product";
        },
      }),
    ).toEqual([]);
  });

  it("REQUIREMENT_SURFACE_NOT_IN_SCOPE also when wos.json has no app shell for the surface", () => {
    const issues = run({ r: (r) => (r.apps = r.apps.filter((x) => x.surface !== "android")) });
    expect(codes(issues)).toEqual(["REQUIREMENT_SURFACE_NOT_IN_SCOPE"]);
    expect(issues.every((i) => i.message.includes("android"))).toBe(true);
  });

  it("JOURNEY_UNCOVERED when a journey links no requirement of its own surface", () => {
    const issues = run({ c: (c) => (c.journeys[2]!.requirements = ["R-002"]) });
    expect(codes(issues)).toEqual(["JOURNEY_UNCOVERED"]);
  });

  it("NATIVE_CAPABILITY_UNPLANNED ignores web journeys (offline storage in a browser needs no native module)", () => {
    expect(run({ c: (c) => (c.journeys[0]!.nativeCapabilities = ["offline_storage"]) })).toEqual([]);
  });

  it("a single-surface contract may leave sharedApi null", () => {
    const issues = run({
      c: (c) => {
        c.sharedApi = null;
        c.requirements = c.requirements.map((r) => ({ ...r, surfaces: ["web"] }));
        c.journeys = c.journeys.filter((j) => j.surface === "web");
        c.profiles = c.profiles.map((p) => ({
          ...p,
          requirements: p.requirements.filter((r) => r !== "R-003"),
          acceptance: p.acceptance.slice(0, 1),
        }));
      },
      g: (g) => {
        g.abus = g.abus.filter((a) => !a.requirements.includes("R-003"));
        g.abus.at(-1)!.dependsOn = ["contacts#02"];
      },
    });
    expect(issues).toEqual([]);
  });

  it("is deterministic: same input, same issues in the same order", () => {
    const mut = CASES.PARALLEL_WRITE_OVERLAP.mut;
    expect(run(mut)).toEqual(run(mut));
  });
});

const REGISTRY = new Map<string, "platform" | "product">([
  ["waronsaas/wos", "platform"],
  ["waronsaas/product", "product"],
  ["waronsaas/product-native", "product"],
]);
const ctx = (over: Partial<BuildGraphContext> = {}): BuildGraphContext => ({
  repositories: REGISTRY,
  contractRepo: "waronsaas/product",
  ...over,
});

describe("validateBuildGraph with the context argument (contracts 4.2.0, B-0001-planning)", () => {
  it("the valid baseline passes with a context", () => {
    expect(run({ ctx: ctx() })).toEqual([]);
  });

  it("multi-repo-products R-001 the graph's family is the contract repository's, from the passed registry", () => {
    // A third registered product-family repo is accepted (the fallback registry does not know it).
    expect(run({ g: (g) => (g.abus[3]!.repo = "waronsaas/product-native"), ctx: ctx() })).toEqual([]);
    expect(codes(run({ g: (g) => (g.abus[3]!.repo = "waronsaas/product-native") }))).toEqual(["ABU_REPO_UNKNOWN"]);
    // Every ABU in the platform repo while the contract lives in the product repo: all flagged. Without the
    // context the graph is merely consistent, so the fallback cannot see it.
    const allWos = (g: G) => {
      for (const a of g.abus) a.repo = "waronsaas/wos";
    };
    const issues = run({ g: allWos, ctx: ctx() });
    expect(issues.filter((i) => i.code === "ABU_REPO_UNKNOWN").map((i) => i.abu)).toEqual(graph().abus.map((a) => a.key));
    expect(run({ g: allWos }).filter((i) => i.code === "ABU_REPO_UNKNOWN")).toEqual([]);
  });

  it("an unregistered contract repository is ABU_REPO_UNKNOWN on the graph", () => {
    const issues = run({ ctx: ctx({ contractRepo: "someone/fork" }) });
    expect(issues).toEqual([{ code: "ABU_REPO_UNKNOWN", abu: null, message: expect.stringContaining("someone/fork") }]);
  });

  it("reading 6: a platform-family graph may write any non-protected path; protected paths still fail", () => {
    const platform = (extra: string) => (g: G) => {
      for (const a of g.abus) a.repo = "waronsaas/wos";
      g.abus[1]!.scope.write = [extra];
    };
    expect(run({ g: platform("packages/contacts/**"), ctx: ctx({ contractRepo: "waronsaas/wos" }) })).toEqual([]);
    expect(codes(run({ g: platform(".github/workflows/x.yml"), ctx: ctx({ contractRepo: "waronsaas/wos" }) }))).toEqual([
      "WRITE_SCOPE_PROTECTED",
    ]);
    // The same scope in a product-family graph is outside the module.
    expect(codes(run({ g: (g) => (g.abus[1]!.scope.write = ["packages/contacts/**"]), ctx: ctx() }))).toEqual([
      "WRITE_OUTSIDE_MODULE_OR_PRODUCT",
    ]);
  });

  it("REQUIREMENT_SURFACE_NOT_IN_SCOPE uses each app's roadmap surfaces when given", () => {
    // acme-crm's roadmap does not have android in scope, even though its profile has an android suite.
    const surfacesInScope = new Map([
      ["acme-crm", ["web", "ios"] as const],
      ["other-crm", ["web"] as const],
    ]);
    const issues = run({ ctx: ctx({ surfacesInScope }) });
    expect(codes(issues)).toEqual(["REQUIREMENT_SURFACE_NOT_IN_SCOPE"]);
    expect(issues.map((i) => i.message.split(" ")[0])).toEqual(["R-001", "R-003"]);
    expect(issues.every((i) => i.message.includes("android") && i.message.includes("in its roadmap"))).toBe(true);
    // The fallback (acceptance suites) accepts the same contract.
    expect(run({ ctx: ctx() })).toEqual([]);
  });
});

describe("scopeCanTouchGlob (picomatch)", () => {
  const rows: Array<[string, string, boolean]> = [
    ["modules/contacts/native/package.json", "**/package.json", true],
    ["modules/contacts/**", "modules/*/native/ios/**", true],
    ["modules/contacts/native/ios/**", "modules/*/native/ios/**", true],
    ["modules/contacts/web/**", "modules/*/native/ios/**", false],
    ["apps/mobile/**", "apps/mobile/{ios,android}/**", true],
    ["apps/web/**", "apps/mobile/{ios,android}/**", false],
    ["modules/contacts/tsconfig.build.json", "**/tsconfig*.json", true],
    ["modules/contacts/.eslintrc.json", "**/.eslintrc*", true],
    ["Modules/Contacts/Package.json", "**/package.json", true],
    ["modules/contacts/api/**", "biome.json", false],
  ];
  for (const [scope, glob, want] of rows)
    it(`${scope} vs ${glob} -> ${want}`, () => {
      expect(scopeCanTouchGlob(scope, glob)).toBe(want);
    });
});

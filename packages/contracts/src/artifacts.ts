import { z } from "zod";
import {
  AbuKey,
  CapabilityKey,
  FeatureKey,
  InventoryItemKey,
  ReadGlob,
  RepoPath,
  RequirementKey,
  TargetSlug,
  Uuid,
  WriteScope,
} from "./primitives.js";

/**
 * Canonical artifacts that live as files in the PRODUCT repo (waronsaas/suite, D10).
 * GitHub is the public record; the control plane ingests these on merge.
 * Humans and agents author them as YAML; they are validated with these schemas after parsing.
 *
 * Product repo layout (see ARCHITECTURE.md "The product repository"):
 *   wos.json                                  RepoManifest
 *   catalog/<featureKey>.yaml                 CatalogEntry       (the global Feature Catalog, D10)
 *   roadmaps/<target>/INVENTORY.yaml          Inventory          (MAPPED % denominator for that app)
 *   roadmaps/<target>/ROADMAP.yaml            Roadmap            (maps capabilities -> catalog features)
 *   features/<featureKey>/CONTRACT.yaml       FeatureContract    (one per catalog feature, app-independent)
 *   features/<featureKey>/BUILD-GRAPH.yaml    BuildGraph
 *   features/<featureKey>/acceptance/**       feature acceptance tests (per-app profile suites)
 *   modules/<featureKey>/**                   shared implementation of the feature
 *   products/<target>/**                      per-app product surface (navigation, branding, composition)
 */

export const ARTIFACT_PATHS = {
  repoManifest: "wos.json",
  catalogEntry: (feature: string) => `catalog/${feature}.yaml`,
  inventory: (target: string) => `roadmaps/${target}/INVENTORY.yaml`,
  roadmap: (target: string) => `roadmaps/${target}/ROADMAP.yaml`,
  featureDir: (feature: string) => `features/${feature}`,
  featureContract: (feature: string) => `features/${feature}/CONTRACT.yaml`,
  buildGraph: (feature: string) => `features/${feature}/BUILD-GRAPH.yaml`,
  acceptanceDir: (feature: string) => `features/${feature}/acceptance`,
  module: (feature: string) => `modules/${feature}`,
  product: (target: string) => `products/${target}`,
} as const;

// ---------------------------------------------------------------------------------------------
// wos.json: product-repo manifest. Changing it requires a maintainer-approved PR.
// ---------------------------------------------------------------------------------------------

export const CommandArgv = z.array(z.string().min(1)).min(1);

export const VerifyStep = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  run: CommandArgv,
  timeoutSeconds: z.number().int().positive().max(3600),
});

/** The minimum toolchain set every wos.json must list (it may add more). */
export const DEFAULT_TOOLCHAIN_PATHS = [
  "wos.json",
  "**/package.json",
  "package-lock.json",
  "**/tsconfig*.json",
  "biome.json",
  "biome.jsonc",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/vite.config.*",
  "**/eslint.config.*",
  "**/.eslintrc*",
  "**/.prettierrc*",
  ".npmrc",
  ".nvmrc",
] as const;

export const RepoManifest = z.object({
  schema: z.literal("wos-repo.v1"),
  displayName: z.string(),
  /** Every app whose product surface lives here, with its path (products/<slug>). */
  products: z.array(z.object({ target: TargetSlug, path: RepoPath })).default([]),
  defaultBranch: z.string().default("main"),
  stack: z.object({
    language: z.string(),
    runtime: z.string(),
    packageManager: z.enum(["npm"]),
    nodeVersion: z.string().optional(),
  }),
  /** Install must not run lifecycle scripts (SECURITY.md S-7). */
  install: CommandArgv,
  /** Deterministic verification, run locally (untrusted) and in GitHub Actions (trusted). */
  verify: z.array(VerifyStep).min(1),
  /** Paths no builder may write, regardless of ABU scope. Always includes .github/** and wos.json. */
  protectedPaths: z.array(WriteScope).min(2),
  /** Files that change only when an ABU holds the matching `lockfile:<path>` resource. */
  lockfiles: z.array(RepoPath),
  /**
   * Files that define HOW verification runs (contracts 2.0.0, B-0005-verification): package.json files,
   * lockfiles, tsconfig*, biome/vitest/eslint/prettier configs, .npmrc, .nvmrc, wos.json. A submission may
   * change one only when its ABU holds the exclusive resource `toolchain:<path>` (error
   * TOOLCHAIN_WITHOUT_RESOURCE otherwise), and such a PR needs a maintainer's CODEOWNERS approval. CI always
   * runs the verify steps of the BASE commit's wos.json with every toolchain path restored from the base
   * (BUILD-PROTOCOL.md "Trusted verification"). Picomatch globs; must include DEFAULT_TOOLCHAIN_PATHS.
   */
  toolchainPaths: z
    .array(z.string().min(1))
    .refine((xs) => DEFAULT_TOOLCHAIN_PATHS.every((d) => xs.includes(d)), "toolchainPaths must include DEFAULT_TOOLCHAIN_PATHS"),
  /** Build outputs and generated files no submission may contain (D9), e.g. "dist/**", "src/generated/**". */
  generatedPaths: z.array(WriteScope).default([]),
  /** Directory whose files require the `db:migrations` resource. Null if the stack has none. */
  migrationsDir: RepoPath.nullable(),
  /** Max bytes of one changeset (hard cap 4_000_000 because of the API body limit). */
  maxChangesetBytes: z.number().int().positive().max(4_000_000),
});
export type RepoManifest = z.infer<typeof RepoManifest>;

// ---------------------------------------------------------------------------------------------
// Inventory: the enumerated public surface of the rented product (the denominator).
// ---------------------------------------------------------------------------------------------

export const InventoryItem = z.object({
  key: InventoryItemKey,
  /** Product area as the vendor names it, e.g. "Sales Cloud > Opportunities". */
  area: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  /** Index into `sources`. Every item must cite a public source. */
  source: z.number().int().nonnegative(),
  /** V1: every weight is 1 (REWARD/ROADMAP protocol). Kept as a field so weighting can change by version. */
  weight: z.literal(1),
});

export const Inventory = z.object({
  schema: z.literal("wos-inventory.v1"),
  target: TargetSlug,
  version: z.number().int().positive(),
  /** Public vendor documentation the inventory was built from. No logins, no scraped private data. */
  sources: z.array(z.object({ title: z.string(), url: z.url(), retrievedOn: z.iso.date() })).min(1),
  items: z.array(InventoryItem).min(1),
});
export type Inventory = z.infer<typeof Inventory>;

// ---------------------------------------------------------------------------------------------
// Feature Catalog (D10): global, app-independent features.
// ---------------------------------------------------------------------------------------------

export const CatalogEntry = z.object({
  schema: z.literal("wos-catalog-entry.v1"),
  key: FeatureKey,
  title: z.string().min(1),
  /** What the feature is, in app-neutral words (no vendor names). */
  summary: z.string().min(10),
  /** Set when this entry was found to duplicate another (alias procedure, FEATURE-CONTRACT.md). */
  aliasOf: FeatureKey.nullable().default(null),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

// ---------------------------------------------------------------------------------------------
// Roadmap (one per application, versioned; one active roadmap PR per application at a time)
// ---------------------------------------------------------------------------------------------

/** Weight in basis points with the reasoning behind it (D12). */
export const ReasonedWeight = z.object({
  /** Share of the parent (capability -> app, feature -> capability) in basis points, 1..10000. */
  weightBp: z.number().int().min(1).max(10_000),
  /** Why this share: relative size, user importance, complexity, share of the product's value. */
  weightRationale: z.string().trim().min(40, "every weight needs a written rationale (>= 40 chars)"),
});
export type ReasonedWeight = z.infer<typeof ReasonedWeight>;

/** A roadmap's reference to a catalog feature, for this app. */
export const RoadmapFeatureRef = ReasonedWeight.extend({
  feature: FeatureKey,
  /** Inventory items (of this app) this feature replaces; together the capability's refs cover its items exactly. */
  inventoryItems: z.array(InventoryItemKey).min(1),
  /** App-specific expectations the feature contract must cover in this app's profile (plain language). */
  appNotes: z.string().default(""),
  phase: z.enum(["core", "later"]),
});
export type RoadmapFeatureRef = z.infer<typeof RoadmapFeatureRef>;

/**
 * A capability of the app. Every capability is listed from the first version with its weight and
 * inventory items (the skeleton); `features` is filled when the capability is mapped. A roadmap
 * version may map capabilities one at a time (ROADMAP-PROTOCOL.md "Capability-at-a-time").
 */
export const RoadmapCapability = ReasonedWeight.extend({
  key: CapabilityKey,
  title: z.string().min(1),
  summary: z.string().min(1),
  /** Every inventory item of this app belongs to exactly one capability or to `excluded`. */
  inventoryItems: z.array(InventoryItemKey).min(1),
  /** Empty = not mapped yet in this version. When non-empty, feature weights sum to 10000. */
  features: z.array(RoadmapFeatureRef).default([]),
});
export type RoadmapCapability = z.infer<typeof RoadmapCapability>;

const sum = (xs: ReadonlyArray<{ weightBp: number }>) => xs.reduce((n, x) => n + x.weightBp, 0);

export const Roadmap = z
  .object({
    schema: z.literal("wos-roadmap.v1"),
    target: TargetSlug,
    /** 1 for the first merged roadmap; each later merged revision is +1 (ROADMAP-PROTOCOL.md "Versions"). */
    version: z.number().int().positive(),
    inventoryVersion: z.number().int().positive(),
    /** Name of the replacement product (never the vendor's trademark). */
    productName: z.string().min(1),
    summary: z.string().min(1),
    /** The app's product surface in products/<target>: how it composes shared modules. */
    architecture: z.object({
      overview: z.string().min(1),
      composition: z.string().min(1),
      appSpecificData: z.string().min(1),
      selfHosting: z.string().min(1),
    }),
    /** ALL capabilities of the app, with weights summing to 10000; mapped ones list their features. */
    capabilities: z.array(RoadmapCapability).min(1),
    /** Items deliberately not replaced, with a reason. Removed from the denominator, shown publicly. */
    excluded: z.array(z.object({ item: InventoryItemKey, reason: z.string().min(10) })).default([]),
    /** New catalog entries this roadmap proposes (files under catalog/ in the same PR). */
    newCatalogFeatures: z.array(FeatureKey).default([]),
    /** Proposal ids (wos propose) this version incorporates. */
    proposals: z.array(Uuid).default([]),
  })
  .superRefine((r, ctx) => {
    // D12 sum constraints. Item coverage and catalog checks live in @waronsaas/planning validateRoadmap.
    const capTotal = sum(r.capabilities);
    if (capTotal !== 10_000) {
      ctx.addIssue({ code: "custom", path: ["capabilities"], message: `capability weights must sum to 10000 bp, got ${capTotal}` });
    }
    r.capabilities.forEach((c, i) => {
      if (c.features.length > 0 && sum(c.features) !== 10_000) {
        ctx.addIssue({
          code: "custom",
          path: ["capabilities", i, "features"],
          message: `feature weights in capability ${c.key} must sum to 10000 bp, got ${sum(c.features)}`,
        });
      }
      const keys = new Set<string>();
      for (const f of c.features) {
        if (keys.has(f.feature))
          ctx.addIssue({ code: "custom", path: ["capabilities", i, "features"], message: `feature ${f.feature} listed twice in ${c.key}` });
        keys.add(f.feature);
      }
    });
  });
export type Roadmap = z.infer<typeof Roadmap>;

// ---------------------------------------------------------------------------------------------
// Feature Contract
// ---------------------------------------------------------------------------------------------

export const Requirement = z.object({
  key: RequirementKey,
  kind: z.enum(["functional", "data", "api", "ui", "security", "performance", "operability"]),
  /** One testable statement using MUST / MUST NOT. */
  statement: z.string().min(10),
  acceptance: z.array(z.string().min(5)).min(1),
});

/**
 * Per-app parity profile (D10): the requirement ids app `target` needs. The feature is SPECIFIED for
 * that app when a merged contract contains its profile, BUILT when every ABU covering those
 * requirements is merged and the profile's acceptance suite passes.
 */
export const RequirementProfile = z.object({
  target: TargetSlug,
  requirements: z.array(RequirementKey).min(1),
  /** Acceptance suite for this profile (subset of the feature's acceptance tests). */
  acceptance: z.object({ dir: RepoPath, run: CommandArgv }),
});
export type RequirementProfile = z.infer<typeof RequirementProfile>;

export const FeatureContract = z.object({
  schema: z.literal("wos-feature-contract.v1"),
  feature: FeatureKey,
  version: z.number().int().positive(),
  title: z.string().min(1),
  summary: z.string().min(1),
  requirements: z.array(Requirement).min(1),
  /** One profile per app that references this feature and has been specified. */
  profiles: z.array(RequirementProfile).min(1),
  /**
   * Apps whose profile or shared requirements change in this version compared with the previous merged
   * version. Required (non-empty) for every version > 1; review contexts include these apps' roadmap refs
   * and profiles (FEATURE-CONTRACT.md "Versioning a shared contract").
   */
  impactedTargets: z.array(TargetSlug).default([]),
  /** Interfaces this feature defines or consumes. Free text per entry, but every entry is named. */
  interfaces: z.object({
    data: z.array(z.object({ name: z.string(), definition: z.string() })).default([]),
    api: z.array(z.object({ name: z.string(), definition: z.string() })).default([]),
    ui: z.array(z.object({ name: z.string(), definition: z.string() })).default([]),
    events: z.array(z.object({ name: z.string(), definition: z.string() })).default([]),
  }),
  dependsOnFeatures: z.array(FeatureKey).default([]),
  /** Must be empty for consensus (reviewers treat any entry as a material gap). */
  openQuestions: z.array(z.string()).default([]),
});
export type FeatureContract = z.infer<typeof FeatureContract>;

// ---------------------------------------------------------------------------------------------
// Build Graph (Atomic Build Units)
// ---------------------------------------------------------------------------------------------

/**
 * Logical resource key. Path resources are derived from write scopes automatically; declare the
 * others explicitly. Examples: "db:migrations", "db:table:contacts", "api:route:GET /v1/contacts",
 * "lockfile:package-lock.json", "config:env", "event:contact.created".
 */
export const ResourceKey = z.string().regex(/^(db|api|schema|lockfile|toolchain|config|event|ui|dep):[A-Za-z0-9 ._/:{}*-]+$/);
export type ResourceKey = z.infer<typeof ResourceKey>;

export const ResourceClaim = z.object({ key: ResourceKey, mode: z.enum(["exclusive", "shared"]) });
export type ResourceClaim = z.infer<typeof ResourceClaim>;

export const AbuSizePoints = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]);

export const AbuSpec = z.object({
  key: AbuKey,
  title: z.string().min(1),
  /** What "done" means for this unit, in one paragraph the builder can act on. */
  objective: z.string().min(20),
  requirements: z.array(RequirementKey).min(1),
  dependsOn: z.array(AbuKey).default([]),
  sizePoints: AbuSizePoints,
  scope: z.object({
    /** Exact files or "<dir>/**" only. Creating files counts as writing. */
    write: z.array(WriteScope).min(1),
    /** Extra read globs beyond the default (the contract, the ABU, the repo manifest). */
    read: z.array(ReadGlob).default([]),
  }),
  resources: z.array(ResourceClaim).default([]),
  acceptance: z.object({
    /** Commands that must exit 0; run locally by the builder and in CI. */
    checks: z.array(z.object({ id: z.string(), run: CommandArgv })).min(1),
    /** Test files this ABU adds or must make pass. Must be inside scope.write. */
    tests: z.array(RepoPath).default([]),
  }),
});
export type AbuSpec = z.infer<typeof AbuSpec>;

export const BuildGraph = z.object({
  schema: z.literal("wos-build-graph.v1"),
  feature: FeatureKey,
  contractVersion: z.number().int().positive(),
  abus: z.array(AbuSpec).min(1).max(60),
});
export type BuildGraph = z.infer<typeof BuildGraph>;

/** Codes emitted by the deterministic build-graph validator (@waronsaas/planning). */
export const BuildGraphErrorCode = z.enum([
  "DUPLICATE_KEY",
  "KEY_NOT_IN_FEATURE",
  "UNKNOWN_DEPENDENCY",
  "CYCLE",
  "UNKNOWN_REQUIREMENT",
  "REQUIREMENT_UNCOVERED",
  "WRITE_SCOPE_PROTECTED",
  "PARALLEL_WRITE_OVERLAP",
  "PARALLEL_EXCLUSIVE_RESOURCE",
  "LOCKFILE_WITHOUT_RESOURCE",
  "TOOLCHAIN_WITHOUT_RESOURCE",
  "MIGRATION_WITHOUT_RESOURCE",
  "TEST_OUTSIDE_SCOPE",
  "OVER_CONTEXT_BUDGET",
  "WRITE_OUTSIDE_MODULE_OR_PRODUCT",
]);
export type BuildGraphErrorCode = z.infer<typeof BuildGraphErrorCode>;

// ---------------------------------------------------------------------------------------------
// Roadmap bundle: a roadmap with its inventory, the catalog entries it references and the proposed
// requirements per feature, in one file. Used for TGT-00 warOnSaaS (docs/roadmap/waronsaas.roadmap.json)
// before the product repo and control plane exist; later bundles are generated from the repo.
// ---------------------------------------------------------------------------------------------

export const RoadmapBundle = z.object({
  schema: z.literal("wos-roadmap-bundle.v1"),
  status: z.enum(["PROPOSED", "CONSENSUS"]),
  targetCode: z.string().regex(/^TGT-\d{2}$/),
  note: z.string(),
  inventory: Inventory,
  roadmap: Roadmap,
  catalog: z.array(CatalogEntry).min(1),
  /** Proposed requirements per feature: the future contract's requirements and this app's profile. */
  requirements: z.array(z.object({ feature: FeatureKey, requirements: z.array(Requirement).min(1) })),
});
export type RoadmapBundle = z.infer<typeof RoadmapBundle>;

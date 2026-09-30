import { z } from "zod";
import { AppId, ProductSurface } from "./wos-app.js";
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
  RepoFullName,
  Surface,
  PRODUCT_REPO,
  Browser,
  MINIMUM_BROWSERS,
  ToolName,
} from "./primitives.js";

/**
 * Canonical artifacts that live as files in the PRODUCT repo (waronsaas/product, D10).
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
 *   apps/web/**                               the ONE web app shell of the suite (D14)
 *   apps/mobile/**                            the ONE React Native/Expo app (iPhone and Android) of the suite (D14)
 *
 * D14: the product is ONE modular suite (one account, one navigation, one data model); every module ships its
 * web and mobile UI inside the two app shells. Targets are parity PROFILES, not codebases or store listings.
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
  webApp: "apps/web",
  mobileApp: "apps/mobile",
  /** Amendment 01 (contracts 5.0.0): the suite's API server (wOS Core + app servers), the `api` surface. */
  apiApp: "apps/api",
  /** The desktop surface's renderer bundles (no Electron here: the one wOS Desktop shell is waronsaas/wos apps/desktop). */
  desktopApp: "apps/desktop",
  /** One WOS-APP manifest per application or shared module (WOS-APP-PROTOCOL.md). */
  appManifest: (app: string) => `applications/${app}/wos-app.json`,
  appDir: (app: string) => `applications/${app}`,
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

/**
 * Profile acceptance results (D10/D11, contracts 3.0.0). The wos-verify workflow, on every push to the
 * default branch, runs each profile's acceptance suite PER SURFACE (D13) as its own check run named by this function. The
 * control plane records each concluded check run as verification_runs(subject 'profile_acceptance',
 * catalog_feature_id, profile_target_id, head_sha, conclusion) and emits verification.recorded.
 * ProgressFeatureInput.contract.acceptancePassed[surface] = the latest recorded run for (feature, target, surface)
 * on a default-branch commit that contains the last merged relevant ABU concluded "success".
 */
export const profileAcceptanceCheckName = (feature: string, target: string, surface: string) =>
  `wos-acceptance/${feature}/${target}/${surface}`;

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
  /** The suite's app shells in this repo, one per surface (D14): e.g. web -> apps/web, ios and android -> apps/mobile. */
  apps: z.array(z.object({ surface: Surface, path: RepoPath })).default([]),
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
  /**
   * contracts 5.6.0 (B-0003-suite-shell): per-app migrations (WOS-APP-PROTOCOL section 3), a path with exactly one `*`
   * standing for the app id, e.g. "applications/*\/migrations". Writing under `applications/<id>/migrations` needs
   * `db:migrations:<id>` exclusive (apps migrate their own schema through their own ledger, so apps never contend).
   */
  appMigrationsDir: z
    .string()
    .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/\*(?:\/[A-Za-z0-9._-]+)+$/)
    .optional(),
  /** Max bytes of one changeset (hard cap 4_000_000 because of the API body limit). */
  maxChangesetBytes: z.number().int().positive().max(4_000_000),
  /**
   * Path-based toolchain requirements (D13). An ABU needs a requirement when one of its write scopes can
   * touch one of `paths`; the claim is then eligible only for a device whose ToolchainAttestation satisfies
   * it. JS/TS-only mobile ABUs need nothing special; ABUs touching ios/, android/, app config plugins or
   * native modules need macOS + Xcode (or the Android SDK).
   */
  toolchainRequirements: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]*$/),
        /**
         * Anchored globs (contracts 4.4.0): no leading "**" or "*", so a requirement applies only to ABUs whose
         * write scopes can reach that directory. "**\/app.plugin.*" would match every ABU and force macOS on
         * JS-only work; write "apps/mobile/app.plugin.*" instead.
         */
        paths: z
          .array(
            z
              .string()
              .min(1)
              .refine((p) => !p.startsWith("*"), "toolchainRequirements paths must be anchored (no leading * or **)"),
          )
          .min(1),
        os: z.array(z.enum(["macos", "linux", "windows"])).min(1),
        tools: z.array(z.object({ name: ToolName, minVersion: z.string().min(1) })).default([]),
      }),
    )
    .default([]),
  /** Browser matrix for web acceptance (D13); must include MINIMUM_BROWSERS. */
  browsers: z
    .array(Browser)
    .default([...MINIMUM_BROWSERS])
    .refine((xs) => MINIMUM_BROWSERS.every((b) => xs.includes(b)), "browsers must include every MINIMUM_BROWSERS entry"),
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
  /**
   * Client surfaces the vendor ships (D13), each with cited public evidence (index into `sources`). A surface
   * listed here is in scope for the roadmap unless the roadmap excludes it with a reason.
   */
  surfaces: z
    .array(
      z.object({
        surface: Surface,
        title: z.string().min(1),
        source: z.number().int().nonnegative(),
        /** e.g. ["iPhone", "iPad"], ["macOS", "Windows"]. */
        platforms: z.array(z.string()).default([]),
        /** Web only: browsers the vendor supports. */
        browsers: z.array(Browser).default([]),
      }),
    )
    .min(1),
  items: z.array(InventoryItem).min(1),
});
export type Inventory = z.infer<typeof Inventory>;

/**
 * A key user journey on one surface (D13: experience parity, not only capability). Describes what the user
 * does, never how the vendor's product looks: our visual design is the warOnSaaS monochrome system, and
 * copying the vendor's trade dress, logos or visual design is forbidden.
 */
export const Journey = z.object({
  key: z.string().regex(/^J-\d{3}$/),
  surface: Surface,
  title: z.string().min(1),
  /** The steps a user takes to do the job, in order. */
  steps: z.array(z.string().min(3)).min(2),
  /** Where the journey starts: navigation item, deep link, notification, share sheet... */
  entryPoints: z.array(z.string().min(2)).min(1),
  /** Offline, notification, background and responsive behaviour on this surface (write "none" if none). */
  platformBehaviour: z.string().min(4),
  /** Native capabilities the journey needs (push, background_audio, callkit, share_sheet, offline_storage, camera...). */
  nativeCapabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default([]),
});
export type Journey = z.infer<typeof Journey>;

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
/** A feature's reasoned share per surface (D12 applied to D13); sums to 10000 across the feature's surfaces. */
export const SurfaceWeight = ReasonedWeight.extend({ surface: Surface });
export type SurfaceWeight = z.infer<typeof SurfaceWeight>;

export const RoadmapFeatureRef = ReasonedWeight.extend({
  /** In-scope surfaces this feature exists on for this app, with reasoned weights summing to 10000 (D13). */
  surfaces: z.array(SurfaceWeight).min(1),
  /** Key user journeys, at least one per listed surface (D13). */
  journeys: z.array(Journey).min(1),
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

/**
 * D59 (contracts 5.4.0): getting customers OFF the target. The data classes every target roadmap's migration
 * section must account for, each either imported by a connector or declared not extractable with a source.
 */
export const MIGRATION_DATA_CLASSES = [
  "records",
  "custom_objects_fields",
  "files_attachments",
  "history_activity",
  "users_permissions",
] as const;
export const MigrationDataClass = z.enum(MIGRATION_DATA_CLASSES);
export type MigrationDataClass = z.infer<typeof MigrationDataClass>;

/**
 * The shared catalog feature every importer is built on (D59): mapping, dry run, verification report (per-object
 * counts and checksums, nothing silently dropped), idempotent re-runs and delta sync. Built once, stewarded by
 * TGT-00 warOnSaaS, catalogued in the product repo (`catalog/import-engine.yaml`) because it runs on customer data
 * in wOS Core; per-target connectors are small catalog features that depend on it.
 */
export const IMPORT_ENGINE_FEATURE = "import-engine" as const;

/** TGT-00 warOnSaaS's target slug: the one roadmap exempt from the migration section (no customers to move off). */
export const PLATFORM_TARGET = "waronsaas" as const;

/** Something the target does not let a customer take out, with the public source that says so. */
export const NotExtractable = z.object({
  item: z.string().min(1),
  reason: z.string().min(10),
  source: z.url(),
});

/**
 * One data class of the target. Either `connector` names the catalog feature that imports it (with how the data is
 * read and whether an incremental API allows delta sync during cutover), or `connector` is null and
 * `notExtractable` says, with sources, why nothing of that class can leave the target. Partial classes use both.
 */
export const MigrationClassPlan = z.object({
  dataClass: MigrationDataClass,
  connector: FeatureKey.nullable(),
  /** The target's objects this class covers (e.g. Account, Contact); empty only when nothing is extractable. */
  objects: z.array(z.string().min(1)).default([]),
  /** How the data is read (export, bulk or REST API), with a public source; null when nothing is extractable. */
  extraction: z.object({ method: z.string().min(10), source: z.url() }).nullable(),
  /** Delta sync during cutover: supported when the target exposes an incremental API; the source says which. */
  deltaSync: z.object({ status: z.enum(["supported", "not_available"]), source: z.url() }).nullable(),
  notExtractable: z.array(NotExtractable).default([]),
});
export type MigrationClassPlan = z.infer<typeof MigrationClassPlan>;

/** The roadmap's migration section (D59). Input facts: `docs/scans/<target>.md` "Getting data out". */
export const RoadmapMigration = z.object({
  engine: z.literal(IMPORT_ENGINE_FEATURE),
  classes: z.array(MigrationClassPlan).min(1),
});
export type RoadmapMigration = z.infer<typeof RoadmapMigration>;

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
    /**
     * The wOS applications that replace this target (Amendment 01: Salesforce -> crm; HubSpot -> crm, marketing,
     * helpdesk). The Sniper List tracks the TARGET; the apps are the PRODUCT. Progress stays profile based.
     */
    apps: z.array(AppId).default([]),
    /** How this target's parity profile maps onto the suite's modules and app shells (D14): no per-target codebase. */
    architecture: z.object({
      overview: z.string().min(1),
      composition: z.string().min(1),
      appSpecificData: z.string().min(1),
      selfHosting: z.string().min(1),
    }),
    /**
     * The app's surfaces (D13). Every surface in the inventory appears here: in_scope (with the repository and
     * path that implement it) or excluded (with a reason a customer would accept).
     */
    surfaces: z
      .array(
        z.object({
          surface: Surface,
          status: z.enum(["in_scope", "excluded"]),
          reason: z.string().min(10).nullable(),
          repo: RepoFullName.nullable(),
          /**
           * The suite app shell that serves this surface (D14): "apps/web", "apps/mobile", "apps/desktop" or "apps/api"
           * in waronsaas/product. Product-repo surfaces in scope must be product surfaces (contracts 5.0.0).
           */
          path: z.string().nullable(),
        }),
      )
      .min(1),
    /** ALL capabilities of the app, with weights summing to 10000; mapped ones list their features. */
    capabilities: z.array(RoadmapCapability).min(1),
    /** Items deliberately not replaced, with a reason. Removed from the denominator, shown publicly. */
    excluded: z.array(z.object({ item: InventoryItemKey, reason: z.string().min(10) })).default([]),
    /** New catalog entries this roadmap proposes (files under catalog/ in the same PR). */
    newCatalogFeatures: z.array(FeatureKey).default([]),
    /** Proposal ids (wos propose) this version incorporates. */
    proposals: z.array(Uuid).default([]),
    /**
     * D59 (contracts 5.4.0): how customers move OFF the target. Optional in the schema so earlier documents still
     * parse; `@waronsaas/planning` validateRoadmap refuses a target roadmap without it (MIGRATION_MISSING). TGT-00
     * warOnSaaS, which has no customers to move, is exempt.
     */
    migration: RoadmapMigration.optional(),
  })
  .superRefine((r, ctx) => {
    // D12 sum constraints. Item coverage and catalog checks live in @waronsaas/planning validateRoadmap.
    for (const [k, s] of r.surfaces.entries()) {
      if (s.status === "excluded" && !s.reason)
        ctx.addIssue({ code: "custom", path: ["surfaces", k, "reason"], message: `excluded surface ${s.surface} needs a reason` });
      if (s.status === "in_scope" && (!s.repo || !s.path))
        ctx.addIssue({ code: "custom", path: ["surfaces", k], message: `in-scope surface ${s.surface} needs repo and path` });
    }
    for (const [k, s] of r.surfaces.entries()) {
      if (s.status === "in_scope" && s.repo === PRODUCT_REPO && !ProductSurface.safeParse(s.surface).success)
        ctx.addIssue({
          code: "custom",
          path: ["surfaces", k, "surface"],
          message: `${s.surface} is not a wOS product surface (web, desktop, ios, android, api); exclude it with a reason`,
        });
    }
    const inScope = new Set(r.surfaces.filter((s) => s.status === "in_scope").map((s) => s.surface));
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
      c.features.forEach((f, j) => {
        const here = ["capabilities", i, "features", j];
        if (keys.has(f.feature))
          ctx.addIssue({ code: "custom", path: ["capabilities", i, "features"], message: `feature ${f.feature} listed twice in ${c.key}` });
        keys.add(f.feature);
        // D13: reasoned surface weights sum to 10000; each surface is in scope and has at least one journey.
        if (sum(f.surfaces) !== 10_000)
          ctx.addIssue({
            code: "custom",
            path: [...here, "surfaces"],
            message: `surface weights of ${f.feature} must sum to 10000 bp, got ${sum(f.surfaces)}`,
          });
        const seen = new Set<string>();
        for (const s of f.surfaces) {
          if (seen.has(s.surface))
            ctx.addIssue({ code: "custom", path: [...here, "surfaces"], message: `surface ${s.surface} listed twice for ${f.feature}` });
          seen.add(s.surface);
          if (!inScope.has(s.surface))
            ctx.addIssue({ code: "custom", path: [...here, "surfaces"], message: `surface ${s.surface} of ${f.feature} is not in scope` });
          if (!f.journeys.some((jr) => jr.surface === s.surface))
            ctx.addIssue({
              code: "custom",
              path: [...here, "journeys"],
              message: `feature ${f.feature} has no journey for surface ${s.surface}`,
            });
        }
      });
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
  /** Surfaces this requirement applies to (D13). A requirement on the shared API lists every surface consuming it. */
  surfaces: z.array(Surface).min(1),
});

/** A per-surface acceptance suite of one app profile (D13); its check run is profileAcceptanceCheckName(feature, target, surface). */
export const SurfaceAcceptance = z.object({
  surface: Surface,
  dir: RepoPath,
  run: CommandArgv,
  /** Web: the browser matrix (must include MINIMUM_BROWSERS). Mobile: Maestro flows run per platform. */
  browsers: z.array(Browser).default([]),
  /** CI runner class; only native iOS builds and E2E use macOS runners (Apple minutes are expensive). */
  runner: z.enum(["linux", "macos"]),
});
export type SurfaceAcceptance = z.infer<typeof SurfaceAcceptance>;

/**
 * Per-app parity profile (D10): the requirement ids app `target` needs. The feature is SPECIFIED for
 * that app when a merged contract contains its profile, BUILT when every ABU covering those
 * requirements is merged and the profile's acceptance suite passes.
 */
export const RequirementProfile = z.object({
  target: TargetSlug,
  requirements: z.array(RequirementKey).min(1),
  /** One acceptance suite per surface this profile's requirements touch (D13). */
  acceptance: z
    .array(SurfaceAcceptance)
    .min(1)
    .refine(
      (xs) => xs.filter((x) => x.surface === "web").every((x) => MINIMUM_BROWSERS.every((b) => x.browsers.includes(b))),
      "web acceptance must run every MINIMUM_BROWSERS entry",
    ),
});
export type RequirementProfile = z.infer<typeof RequirementProfile>;

/**
 * What a feature must do on one surface (Amendment 01, contracts 5.0.0). Parity is not identical UX: mobile may
 * view/edit/create/call a contact while desktop adds bulk import. Capabilities are snake_case verbs-objects.
 */
export const ContractSurface = z.object({
  required: z.boolean(),
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,60}$/)).default([]),
});
export type ContractSurface = z.infer<typeof ContractSurface>;

export const FeatureContract = z
  .object({
    schema: z.literal("wos-feature-contract.v1"),
    feature: FeatureKey,
    version: z.number().int().positive(),
    title: z.string().min(1),
    summary: z.string().min(1),
    requirements: z.array(Requirement).min(1),
    /**
     * Key user journeys per surface (D13), each linked to the requirements that implement it; acceptance tests
     * journeys, not only endpoints. Journeys needing native capabilities name them (the contract must then
     * include the ABUs that add the native modules).
     */
    journeys: z.array(Journey.extend({ requirements: z.array(RequirementKey).min(1) })).min(1),
    /**
     * The API every surface consumes (D13). Required when the contract's requirements span more than one
     * surface: web and mobile use the same typed client from modules/<feature>. Null for single-surface features.
     */
    sharedApi: z.string().min(20).nullable(),
    /**
     * D60 (contracts 5.5.0): the architectural elements (`arch:<name>`, defined by merged architecture records) this
     * feature relies on. Every `arch:` resource of its ABUs must be listed here (ARCH_NOT_IN_CONTRACT).
     */
    architecture: z.array(z.string().regex(/^arch:[a-z][a-z0-9-]{1,48}[a-z0-9]$/)).optional(),
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
    /**
     * Required surfaces and their accepted end state (Amendment 01, contracts 5.0.0). Product-family contracts use
     * product surfaces only (web, desktop, ios, android, api; planning checks the family); a feature is not
     * complete until every required surface's requirements are built and accepted.
     */
    surfaces: z.partialRecord(Surface, ContractSurface),
  })
  .superRefine((c, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const required = new Set(
      Object.entries(c.surfaces)
        .filter(([, v]) => v?.required)
        .map(([k]) => k),
    );
    if (required.size === 0) issue(["surfaces"], "at least one surface is required");
    for (const [k, v] of Object.entries(c.surfaces))
      if (v?.required && v.capabilities.length === 0)
        issue(["surfaces", k, "capabilities"], `required surface ${k} lists its capabilities`);
    for (const [i, r] of c.requirements.entries())
      for (const s of r.surfaces)
        if (!required.has(s)) issue(["requirements", i, "surfaces"], `${s} is not a required surface of this contract`);
    for (const s of required) {
      if (!c.requirements.some((r) => r.surfaces.includes(s as Surface)))
        issue(["surfaces", s], `required surface ${s} has no requirement`);
      if (s !== "api" && !c.journeys.some((j) => j.surface === s)) issue(["surfaces", s], `required surface ${s} has no journey`);
    }
    for (const [i, j] of c.journeys.entries())
      if (!required.has(j.surface)) issue(["journeys", i, "surface"], `${j.surface} is not a required surface`);
  });
export type FeatureContract = z.infer<typeof FeatureContract>;

// ---------------------------------------------------------------------------------------------
// Build Graph (Atomic Build Units)
// ---------------------------------------------------------------------------------------------

/**
 * Logical resource key. Path resources are derived from write scopes automatically; declare the
 * others explicitly. Examples: "db:migrations", "db:table:contacts", "api:route:GET /v1/contacts",
 * "lockfile:package-lock.json", "config:env", "event:contact.created".
 * D60 (contracts 5.5.0): "arch:<element>" declares an architectural element (architecture.ts): `shared` = the ABU
 * relies on it, `exclusive` = the ABU changes it (only an architecture record's migration ABUs may).
 */
export const ResourceKey = z.string().regex(/^(db|api|schema|lockfile|toolchain|config|event|ui|dep|arch):[A-Za-z0-9 ._/:{}*-]+$/);
export type ResourceKey = z.infer<typeof ResourceKey>;

export const ResourceClaim = z.object({ key: ResourceKey, mode: z.enum(["exclusive", "shared"]) });
export type ResourceClaim = z.infer<typeof ResourceClaim>;

export const AbuSizePoints = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]);

export const AbuSpec = z.object({
  /**
   * The ONE repository this ABU writes to (D13). A graph may span repos; cross-repo dependencies use global ABU
   * keys in dependsOn.
   */
  repo: RepoFullName,
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
  /**
   * D61 (contracts 5.7.0): set on a FIX unit, created from a TriageDecision at the feature's current merged contract
   * version (no version bump). `regressionTest` is under a profile acceptance dir at `regressions/BUG-<n>.*`, fails on
   * the parent commit and passes on the head (red then green), and stays in the feature's acceptance for good.
   */
  fix: z
    .object({
      bug: z.string().regex(/^BUG-\d{1,9}$/),
      regressionTest: RepoPath,
    })
    .optional(),
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
  "ABU_REPO_UNKNOWN",
  "SHARED_API_MISSING",
  "JOURNEY_UNCOVERED",
  "REQUIREMENT_SURFACE_NOT_IN_SCOPE",
  "NATIVE_CAPABILITY_UNPLANNED",
  "CONTRACT_VERSION_MISMATCH",
  // D60 (contracts 5.5.0): architectural elements; checked when the caller passes the live registry.
  "ARCH_ELEMENT_UNKNOWN",
  "ARCH_PATH_WITHOUT_RESOURCE",
  "ARCH_CHANGE_OUTSIDE_RECORD",
  "ARCH_NOT_IN_CONTRACT",
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

/** Contract-level validator codes (planning.validateFeatureContract, contracts 4.2.0, B-0002-planning). */
export const FeatureContractErrorCode = z.enum([
  "VERSION_NOT_NEXT",
  "FEATURE_MISMATCH",
  "REQUIREMENT_DUPLICATE",
  "JOURNEY_DUPLICATE",
  "PROFILE_DUPLICATE",
  "IMPACTED_TARGETS_MISSING",
  "PROFILE_CHANGED_UNLISTED",
]);
export type FeatureContractErrorCode = z.infer<typeof FeatureContractErrorCode>;

/** D61 (contracts 5.7.0): codes of planning.validateFixUnit (fix ABUs created from a triage decision). */
export const FixUnitErrorCode = z.enum([
  "FIX_NOT_MARKED",
  "FIX_KEY_NOT_IN_FEATURE",
  "FIX_SCOPE_OUTSIDE_FEATURE",
  "FIX_REQUIREMENT_UNKNOWN",
  "FIX_REGRESSION_TEST_OUTSIDE_ACCEPTANCE",
  "FIX_REGRESSION_TEST_NOT_DECLARED",
  "FIX_CHANGES_ARCHITECTURE",
]);
export type FixUnitErrorCode = z.infer<typeof FixUnitErrorCode>;

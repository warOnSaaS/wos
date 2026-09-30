/**
 * WOS-APP: the one-product layer (Amendment 01, D16, D17; contracts 5.0.0).
 *
 * wOS is ONE product. Users install one wOS Desktop, one wOS Mobile and use one wOS Web; an organization
 * enables applications (CRM, Chat, Build...) and every surface shows the same set. This module holds the
 * machine-readable parts of docs/architecture/WOS-APP-PROTOCOL.md:
 *
 *   WosAppManifest      applications/<appId>/wos-app.json in waronsaas/product (Build's lives in waronsaas/wos)
 *   ModulePackage       the signed desktop package of one app version (renderer-only code, S-37..S-39)
 *   AppRegistryEntry    what the registry knows about an app (control plane, public)
 *   Organization, Membership, AppEntitlement, OrgAppView    hosted (wOS Cloud) tenancy and entitlements
 *   EnvironmentDescriptor, EnvironmentTokenClaims, ActiveApps    the environment an app client talks to
 *   MobileScreen        the minimal declarative screen for wOS Mobile (V1: list, detail, form)
 *   CoreRoutes          what every environment (wOS Cloud or self-hosted) serves to clients
 *
 * Node-free on purpose: wOS Web, wOS Mobile and self-hosted servers import it. Signing helpers are in
 * `@waronsaas/contracts/canonical`.
 */
import { z } from "zod";
import { FeatureKey, RepoFullName, SemVer, Sha256, TargetSlug, Timestamp, Uuid } from "./primitives.js";

export const WOS_APP_PROTOCOL = "wos-app/v1" as const;

// ---------------------------------------------------------------------------------------------
// Identity, versions, surfaces
// ---------------------------------------------------------------------------------------------

/** Application id: lowercase, stable forever (it prefixes permissions, events, routes and the data schema). */
export const AppId = z.string().regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/, "lowercase app id, 3-32 chars");
export type AppId = z.infer<typeof AppId>;

/** The first-party ids with fixed meaning. `core` is wOS Core (always on); `build` is contributing (D16). */
export const CORE_APP_ID = "core" as const;
export const BUILD_APP_ID = "build" as const;

/** A semver range: one or more comparators ("^1.2.0", ">=0.1.0 <2.0.0", "1.0.0"). */
export const SemVerRange = z
  .string()
  .regex(/^\s*(?:(?:>=|<=|>|<|=|\^|~)?\d+\.\d+\.\d+\s*)+$/, "semver range of comparators like >=1.2.0 or ^1.2.0");
export type SemVerRange = z.infer<typeof SemVerRange>;

/**
 * The product's surfaces (Amendment 01): the shells wOS itself ships. `desktop` is the one wOS Desktop (D16),
 * `ios`/`android` the one wOS Mobile (D13: separate surfaces for journeys, acceptance and progress), `api`
 * the suite's public API. A subset of `Surface`, which also names vendor surfaces for inventories.
 */
export const ProductSurface = z.enum(["web", "desktop", "ios", "android", "api"]);
export type ProductSurface = z.infer<typeof ProductSurface>;
export const UI_SURFACES = ["web", "desktop", "ios", "android"] as const satisfies readonly ProductSurface[];

/** A path inside the app's directory: "./desktop", "./mobile/screens". Never absolute, never "..". */
export const AppRelativePath = z
  .string()
  .regex(/^\.\/[A-Za-z0-9._/-]+$/)
  .refine((p) => !p.split("/").includes(".."), "no '..' segments");

/** `<appId>.<resource>[.<action>]`, e.g. crm.contacts.read. */
export const PermissionKey = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_]*){1,3}$/);
export type PermissionKey = z.infer<typeof PermissionKey>;

/** `<appId>.<entity>.<past-tense verb>`, e.g. crm.contact.created. */
export const AppEventName = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
export type AppEventName = z.infer<typeof AppEventName>;

/** A capability an app provides to others ("contacts", "opportunities"); unique across the registry. */
export const AppCapability = z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/);

/**
 * core    wOS Core: identity, organizations, permissions, notifications, search, files, audit, entitlements,
 *         registries, event infrastructure. Always active; the membership base price covers it.
 * app     an application an organization enables (CRM, Chat, Build). The only kind with an entitlement.
 * module  a shared business module several apps require (Contacts). Never entitled or priced: it is
 *         active while any active app requires it.
 */
export const AppKind = z.enum(["core", "app", "module"]);
export type AppKind = z.infer<typeof AppKind>;

/** Hosted pricing class (architecture only; no production billing in V1). */
export const AppBilling = z.enum(["base", "addon", "free"]);
export type AppBilling = z.infer<typeof AppBilling>;

export const DEFAULT_MEMBER_ROLES = ["owner", "admin", "member"] as const;
export const OrgRole = z.enum(DEFAULT_MEMBER_ROLES);
export type OrgRole = z.infer<typeof OrgRole>;

// ---------------------------------------------------------------------------------------------
// The WOS-APP manifest (applications/<appId>/wos-app.json)
// ---------------------------------------------------------------------------------------------

const SurfaceSupport = z.object({ supported: z.boolean() });

export const WosAppManifest = z
  .object({
    protocol: z.literal(WOS_APP_PROTOCOL),
    app: z.object({
      id: AppId,
      /** Display name, e.g. "wOS CRM" (naming rule: wOS casing). */
      name: z.string().min(3).max(60),
      version: SemVer,
      kind: AppKind,
      billing: AppBilling,
      summary: z.string().min(10).max(280),
    }),
    requires: z.object({
      /** wOS Core versions this app works with. */
      wos: SemVerRange,
      /** Other apps or modules this app needs active (Contacts for CRM). Core is implicit. */
      apps: z.array(z.object({ id: AppId, version: SemVerRange })).default([]),
    }),
    provides: z.array(AppCapability).default([]),
    /** Catalog features (D10) whose modules/<featureKey> code this app ships. The link to roadmaps and progress. */
    features: z.array(FeatureKey).default([]),
    /** Sniper List targets this app answers (Salesforce -> CRM). Informative: progress stays target-profile based. */
    replaces: z.array(TargetSlug).default([]),
    surfaces: z.object({
      web: SurfaceSupport.extend({ entry: AppRelativePath.optional() }),
      desktop: SurfaceSupport.extend({ entry: AppRelativePath.optional() }),
      ios: SurfaceSupport,
      android: SurfaceSupport,
      api: SurfaceSupport,
    }),
    /** Declarative mobile screens (MobileScreen JSON files); required when ios or android is supported. */
    mobile: z.object({ screens: AppRelativePath }).nullable().default(null),
    data: z.object({
      /** The app's own Postgres schema; always app_<id with - as _>. Core's is `core`. */
      schema: z.string().regex(/^(?:core|app_[a-z][a-z0-9_]*)$/),
      migrations: AppRelativePath.nullable(),
      /** Entities the app owns (canonical in this app's schema); other apps reach them only through its API and events. */
      owns: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default([]),
    }),
    permissions: z
      .array(
        z.object({
          key: PermissionKey,
          description: z.string().min(5),
          /** Org roles granted this permission when the app is enabled; admins can change it per org. */
          grantedTo: z.array(OrgRole).default(["owner", "admin"]),
        }),
      )
      .default([]),
    events: z.object({
      publishes: z.array(AppEventName).default([]),
      consumes: z.array(AppEventName).default([]),
    }),
    routes: z.object({
      /** Web and desktop route prefix, e.g. "/crm". */
      ui: z.string().regex(/^\/[a-z][a-z0-9-]*$/),
      /** API prefix, e.g. "/apps/crm"; null when the api surface is unsupported. */
      api: z
        .string()
        .regex(/^\/apps\/[a-z][a-z0-9-]*$/)
        .nullable(),
    }),
    navigation: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_.-]*$/),
          title: z.string().min(1).max(40),
          route: z.string().regex(/^\/[a-z0-9/_-]*$/),
          surfaces: z.array(z.enum(UI_SURFACES)).min(1),
          permission: PermissionKey.nullable(),
          order: z.number().int().min(0).max(1000),
        }),
      )
      .default([]),
    hosting: z.object({
      /** Self-hostable with the open-source code alone; never gated by a wOS entitlement (S-41). */
      selfHost: z.object({ supported: z.boolean(), services: z.array(z.enum(["postgres", "object_storage", "smtp", "turn"])).default([]) }),
      hosted: z.object({ supported: z.boolean() }),
    }),
  })
  .superRefine((m, ctx) => {
    const id = m.app.id;
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if ((m.app.kind === "core") !== (id === CORE_APP_ID)) issue(["app", "kind"], "kind core is exactly the app id core");
    if (m.app.kind === "core" && m.app.billing !== "base") issue(["app", "billing"], "core is billed as the base membership");
    if (m.app.kind === "module" && m.app.billing !== "free") issue(["app", "billing"], "modules are never priced");
    if (m.app.kind !== "core" && m.app.billing === "base") issue(["app", "billing"], "only core is billing base");
    if (id === BUILD_APP_ID && m.app.billing !== "free") issue(["app", "billing"], "Build (contributing) is free (D16)");
    const schema = id === CORE_APP_ID ? "core" : `app_${id.replace(/-/g, "_")}`;
    if (m.data.schema !== schema) issue(["data", "schema"], `data schema must be ${schema}`);
    for (const [k, p] of m.permissions.entries())
      if (!p.key.startsWith(`${id}.`)) issue(["permissions", k, "key"], `must start with ${id}.`);
    for (const [k, e] of m.events.publishes.entries())
      if (!e.startsWith(`${id}.`)) issue(["events", "publishes", k], `an app publishes only ${id}.* events`);
    for (const [k, e] of m.events.consumes.entries())
      if (e.startsWith(`${id}.`)) issue(["events", "consumes", k], "an app does not consume its own events");
    for (const [k, r] of m.requires.apps.entries()) if (r.id === id) issue(["requires", "apps", k], "an app cannot require itself");
    if (m.surfaces.web.supported && !m.surfaces.web.entry) issue(["surfaces", "web", "entry"], "a supported web surface needs an entry");
    if (m.surfaces.desktop.supported && !m.surfaces.desktop.entry)
      issue(["surfaces", "desktop", "entry"], "a supported desktop surface needs an entry");
    if ((m.surfaces.ios.supported || m.surfaces.android.supported) && !m.mobile)
      issue(["mobile"], "a supported mobile surface needs mobile.screens");
    if (m.surfaces.api.supported !== (m.routes.api !== null))
      issue(["routes", "api"], "routes.api is set exactly when the api surface is supported");
    if (m.routes.api !== null && m.routes.api !== `/apps/${id}`) issue(["routes", "api"], `api prefix must be /apps/${id}`);
    const perms = new Set(m.permissions.map((p) => p.key));
    for (const [k, n] of m.navigation.entries()) {
      if (!n.id.startsWith(`${id}.`)) issue(["navigation", k, "id"], `must start with ${id}.`);
      if (!(n.route === m.routes.ui || n.route.startsWith(`${m.routes.ui}/`)))
        issue(["navigation", k, "route"], `must be under ${m.routes.ui}`);
      if (n.permission && !perms.has(n.permission)) issue(["navigation", k, "permission"], "undeclared permission");
      for (const s of n.surfaces) if (!m.surfaces[s].supported) issue(["navigation", k, "surfaces"], `surface ${s} is not supported`);
    }
  });
export type WosAppManifest = z.infer<typeof WosAppManifest>;

// ---------------------------------------------------------------------------------------------
// Signed desktop module package (S-37..S-39)
// ---------------------------------------------------------------------------------------------

export const ModuleSignature = z.object({
  alg: z.literal("ed25519"),
  /** Id of the module-signing key; Desktop pins the public keys in its signed binary (never fetched). */
  keyId: z.string().regex(/^wos-module-\d{4}(?:-[a-z0-9]+)?$/),
  /** base64 Ed25519 signature over canonicalJson(package without `signature`). */
  value: z.string().min(80).max(100),
});

export const ModulePackage = z
  .object({
    schema: z.literal("wos-module-package.v1"),
    app: AppId,
    version: SemVer,
    surface: z.literal("desktop"),
    manifest: WosAppManifest,
    manifestSha256: Sha256,
    /** HTML entry inside the package, loaded in the sandboxed renderer under wos-module://<app>/<version>/. */
    entry: z.string().regex(/^[A-Za-z0-9._/-]+\.html$/),
    /** Every file with its hash; nothing outside this list is ever loaded. No .node, .exe, .dll, .dylib or .so. */
    files: z
      .array(z.object({ path: z.string().regex(/^[A-Za-z0-9._/-]+$/), sha256: Sha256, bytes: z.number().int().positive() }))
      .min(1)
      .refine(
        (fs) => fs.every((f) => !/\.(?:node|exe|dll|dylib|so|sh|bat|cmd|ps1)$/i.test(f.path)),
        "native or script executables are never packaged",
      )
      .refine((fs) => fs.every((f) => !f.path.split("/").includes("..")), "no '..' segments"),
    /** Built from a tag of waronsaas/product by the wos release workflow (the only holder of the signing key). */
    source: z.object({
      repo: RepoFullName,
      tag: z.string().regex(/^v\d+\.\d+\.\d+$|^[a-z0-9-]+@\d+\.\d+\.\d+$/),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
    }),
    builtAt: Timestamp,
    signature: ModuleSignature,
  })
  .superRefine((p, ctx) => {
    if (p.manifest.app.id !== p.app || p.manifest.app.version !== p.version)
      ctx.addIssue({ code: "custom", path: ["manifest"], message: "package app/version must equal the manifest's" });
    if (!p.manifest.surfaces.desktop.supported)
      ctx.addIssue({ code: "custom", path: ["manifest"], message: "the app does not support desktop" });
    if (!p.files.some((f) => f.path === p.entry)) ctx.addIssue({ code: "custom", path: ["entry"], message: "entry is not in files" });
  });
export type ModulePackage = z.infer<typeof ModulePackage>;

/**
 * contracts 5.2.0: the ONE file Desktop downloads for a desktop module (`AppRegistryEntry.surfaces.desktop.package.url`,
 * `AppReleaseView.desktopPackage.url`). JSON, so no archive parser is needed: the signed `ModulePackage` plus every
 * file's bytes as standard base64. `package.sha256` in the registry is sha256Of(the downloaded bytes) (transport check);
 * trust comes only from `verifyModulePackage` against pinned keys and each file's sha256 in the package (S-37).
 * The installer rejects a bundle whose `contents` paths differ from `package.files` in any way.
 */
export const ModuleBundle = z
  .object({
    schema: z.literal("wos-module-bundle.v1"),
    package: ModulePackage,
    contents: z.array(z.object({ path: z.string().regex(/^[A-Za-z0-9._/-]+$/), base64: z.string() })).min(1),
  })
  .superRefine((b, ctx) => {
    const listed = b.package.files.map((f) => f.path).sort();
    const got = b.contents.map((c) => c.path).sort();
    if (listed.length !== got.length || listed.some((p, i) => p !== got[i]))
      ctx.addIssue({ code: "custom", path: ["contents"], message: "contents must list exactly the package's files" });
  });
export type ModuleBundle = z.infer<typeof ModuleBundle>;

// ---------------------------------------------------------------------------------------------
// App registry (control plane; public)
// ---------------------------------------------------------------------------------------------

const Availability = z.object({ available: z.boolean(), version: SemVer.nullable() });

/**
 * One registry entry, built from the app's current (latest published, not yanked) release manifest. Apps with no
 * such release (e.g. `core` and `build` right after migration 0006, whose registry rows have no current version)
 * are not listed by `listApps`, not returned by `getApp` (404) and not in `OrgApps`; their entitlements still exist
 * and still gate (contracts 5.2.0 clarification).
 */
export const AppRegistryEntry = z.object({
  id: AppId,
  name: z.string(),
  kind: AppKind,
  billing: AppBilling,
  summary: z.string(),
  currentVersion: SemVer,
  protocol: z.literal(WOS_APP_PROTOCOL),
  capabilities: z.array(AppCapability),
  dependencies: z.array(z.object({ id: AppId, version: SemVerRange })),
  features: z.array(FeatureKey),
  replaces: z.array(TargetSlug),
  surfaces: z.object({
    web: Availability,
    /** The signed package (a `ModuleBundle` file) for the current version; null when desktop is unsupported and for Build (bundled in Desktop, D16). */
    desktop: Availability.extend({
      package: z.object({ url: z.url(), sha256: Sha256, keyId: z.string() }).nullable(),
    }),
    /** Mobile modules are bundled in the store build (no code download, S-38); `version` is the first store build carrying it. */
    ios: Availability,
    android: Availability,
    api: Availability,
  }),
  selfHost: z.object({ compatible: z.boolean() }),
  hosted: z.object({ compatible: z.boolean() }),
  publishedAt: Timestamp,
});
export type AppRegistryEntry = z.infer<typeof AppRegistryEntry>;

/**
 * contracts 5.2.0: one released version (`GET /v1/public/apps/:app/releases/:version`). Desktop resolves the package
 * of the version `ActiveApps` names (which may be older than `currentVersion`) and learns whether its active version
 * was yanked. `desktopPackage` is null when the version has no desktop package: desktop unsupported, or Build, which
 * is bundled in the Desktop binary and never downloaded (D16, S-40).
 */
export const AppReleaseView = z.object({
  app: AppId,
  version: SemVer,
  state: z.enum(["published", "yanked"]),
  manifest: WosAppManifest,
  manifestSha256: Sha256,
  desktopPackage: z.object({ url: z.url(), sha256: Sha256, keyId: z.string() }).nullable(),
  source: z.object({ repo: RepoFullName, tag: z.string(), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  publishedAt: Timestamp,
  yankedAt: Timestamp.nullable(),
  yankReason: z.string().nullable(),
});
export type AppReleaseView = z.infer<typeof AppReleaseView>;

/**
 * contracts 5.2.0: `GET /v1/public/apps/:app/progress`, the public view of `computeApplicationProgress` (progress.ts).
 * The features and surfaces come from the app's current release manifest (`basis: "release"`), else from
 * `applications/<app>/wos-app.json` on the product repo's default branch (`"default_branch"`), else there are none
 * (`"none"`, everything 0). Any app id named by the registry or by `target_apps` answers; others are 404.
 * Never cached per organization: it is the same for everyone and independent of entitlements.
 */
const Bp = z.number().int().min(0).max(10_000);
const Points = z.number().int().nonnegative();
export const ApplicationProgressView = z.object({
  app: AppId,
  basis: z.enum(["release", "default_branch", "none"]),
  /** The manifest version the features were read from; null for basis none. */
  manifestVersion: SemVer.nullable(),
  builtBp: Bp,
  relevantPoints: Points,
  mergedPoints: Points,
  complete: z.boolean(),
  surfaces: z.array(
    z.object({
      surface: ProductSurface,
      relevantPoints: Points,
      mergedPoints: Points,
      builtBp: Bp,
      acceptancePassed: z.boolean(),
      complete: z.boolean(),
    }),
  ),
  features: z.array(
    z.object({
      feature: FeatureKey,
      contractVersion: z.number().int().positive().nullable(),
      relevantPoints: Points,
      mergedPoints: Points,
    }),
  ),
  /** Targets that map to this app (`target_apps`), for links back to the Sniper List. */
  targets: z.array(TargetSlug),
  computedAt: Timestamp,
});
export type ApplicationProgressView = z.infer<typeof ApplicationProgressView>;

// ---------------------------------------------------------------------------------------------
// Organizations and entitlements (wOS Cloud)
// ---------------------------------------------------------------------------------------------

/** personal: created with every account (its owner can enable Build for themselves, D16). team: a business org. */
export const OrganizationKind = z.enum(["personal", "team"]);
export const OrganizationSlug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/);

export const Organization = z.object({
  id: Uuid,
  slug: OrganizationSlug,
  name: z.string().min(1).max(80),
  kind: OrganizationKind,
  createdAt: Timestamp,
});
export type Organization = z.infer<typeof Organization>;

export const OrganizationView = Organization.extend({ role: OrgRole });
export type OrganizationView = z.infer<typeof OrganizationView>;

/** Persisted entitlement states (EntitlementMachine); "available" = no row yet. */
export const EntitlementState = z.enum(["available", "enabled", "disabled", "suspended"]);
export type EntitlementState = z.infer<typeof EntitlementState>;

export const AppEntitlement = z.object({
  organizationId: Uuid,
  app: AppId,
  state: EntitlementState,
  changedAt: Timestamp.nullable(),
  rowVersion: z.number().int().min(0),
});
export type AppEntitlement = z.infer<typeof AppEntitlement>;

/** One row of "Your Apps" / "Available Apps": the registry entry plus this org's entitlement. */
export const OrgAppView = z.object({ app: AppRegistryEntry, entitlement: AppEntitlement });
export type OrgAppView = z.infer<typeof OrgAppView>;

export const OrgApps = z.object({
  organizationId: Uuid,
  /** kind app with state enabled, plus core and the modules they need (always shown as part of wOS). */
  yourApps: z.array(OrgAppView),
  /** kind app not enabled (available, disabled or suspended), hosted-compatible. */
  availableApps: z.array(OrgAppView),
});
export type OrgApps = z.infer<typeof OrgApps>;

// ---------------------------------------------------------------------------------------------
// Environments (wOS Cloud or self-hosted) and what they serve
// ---------------------------------------------------------------------------------------------

export const EnvironmentAuth = z.discriminatedUnion("kind", [
  /** Sign in with the wOS account (D8) at the issuer; the client exchanges its session for an environment token. */
  z.object({ kind: z.literal("wos_cloud"), issuer: z.url() }),
  /** The self-hosted server's own sign-in (email link from wOS Core); no wOS account involved. */
  z.object({ kind: z.literal("local") }),
  /** An OpenID Connect provider the operator chose. */
  z.object({ kind: z.literal("oidc"), issuer: z.url(), clientId: z.string().min(1) }),
]);
export type EnvironmentAuth = z.infer<typeof EnvironmentAuth>;

/** GET /.well-known/wos-environment on every environment. Clients store sessions per environmentId. */
export const EnvironmentDescriptor = z.object({
  schema: z.literal("wos-environment.v1"),
  environmentId: Uuid,
  name: z.string().min(1).max(80),
  kind: z.enum(["cloud", "self_hosted"]),
  protocol: z.literal(WOS_APP_PROTOCOL),
  coreVersion: SemVer,
  apiBase: z.url(),
  auth: EnvironmentAuth,
});
export type EnvironmentDescriptor = z.infer<typeof EnvironmentDescriptor>;

/** wOS Cloud environment id (fixed; migration 0006 seeds it). */
export const WOS_CLOUD_ENVIRONMENT_ID = "0192f000-0000-7000-8000-00000000c10d" as const;

/**
 * Claims of an environment token: a compact JWS (EdDSA) minted by the control plane for ONE hosted
 * environment and ONE organization, 15 minutes. Hosted wOS Core verifies it with the control plane's
 * published keys and activates exactly `apps`. Self-hosted environments never see one (S-41).
 */
export const EnvironmentTokenClaims = z.object({
  iss: z.url(),
  aud: Uuid,
  sub: Uuid,
  org: Uuid,
  role: OrgRole,
  /** Active app ids for this org at issue time: core, enabled apps and the modules they require. */
  apps: z.array(AppId),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type EnvironmentTokenClaims = z.infer<typeof EnvironmentTokenClaims>;

/**
 * contracts 5.2.0: the environment token's wire format, fixed so the control plane (mints), hosted wOS Core
 * (verifies) and clients (refresh) agree. A compact JWS: base64url(canonicalJson(header)) "." base64url(canonicalJson
 * (claims)) "." base64url(Ed25519 signature over the first two parts), no padding. `signEnvironmentToken` and
 * `verifyEnvironmentToken` in `@waronsaas/contracts/canonical` are the only implementation.
 *
 * Hosted Core accepts it as `Authorization: Bearer <token>` on every `CoreRoutes` call (`auth: "environment_session"`);
 * a self-hosted Core accepts its own local session token the same way. Clients refresh it before `exp` and re-read
 * `ActiveApps` on every refresh.
 */
export const ENVIRONMENT_TOKEN_TYP = "wos-env+jwt" as const;
/** Lifetime of an environment token: exactly 15 minutes (exp - iat). */
export const ENVIRONMENT_TOKEN_TTL_SECONDS = 900 as const;
/** Clock skew a verifier tolerates on iat and exp. */
export const ENVIRONMENT_TOKEN_SKEW_SECONDS = 60 as const;
/** Clients re-read `ActiveApps` at least this often while open (and on start, focus and token refresh). */
export const ACTIVE_APPS_REFRESH_SECONDS = 60 as const;

export const EnvironmentTokenHeader = z.object({
  alg: z.literal("EdDSA"),
  typ: z.literal(ENVIRONMENT_TOKEN_TYP),
  /** Id of the control plane's signing key, listed by `getEnvironmentKeys`. */
  kid: z.string().regex(/^wos-env-\d{4}(?:-[a-z0-9]+)?$/),
});
export type EnvironmentTokenHeader = z.infer<typeof EnvironmentTokenHeader>;

/** One entry of `GET /v1/public/environment-keys`. `publicKey` is C-5 encoded: standard base64 of the raw 32 bytes. */
export const EnvironmentKey = z.object({
  kid: EnvironmentTokenHeader.shape.kid,
  alg: z.literal("EdDSA"),
  publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "base64 of a raw 32-byte Ed25519 key"),
});
export type EnvironmentKey = z.infer<typeof EnvironmentKey>;

/** Where an active app's activation comes from; self-hosted activation never consults wOS Cloud. */
export const ActivationSource = z.enum(["core", "entitlement", "dependency", "self_host_config"]);

/** GET /v1/core/apps on an environment: the apps this org has active HERE, with their manifests. */
export const ActiveApps = z.object({
  environmentId: Uuid,
  organizationId: Uuid,
  apps: z.array(
    z.object({
      id: AppId,
      version: SemVer,
      source: ActivationSource,
      manifest: WosAppManifest,
    }),
  ),
});
export type ActiveApps = z.infer<typeof ActiveApps>;

/**
 * contracts 5.6.0 (B-0001-suite-shell): `local` sign-in on a self-hosted Core (EnvironmentAuth kind `local`).
 * start: always 202 with the same shape for any address (no enumeration); only addresses the operator allows receive
 * a code, through the operator's SMTP. redeem: single use, 15 minutes, 5 tries, 401 UNAUTHENTICATED otherwise. The
 * returned token is the Bearer for every CoreRoutes call on that Core, until `expiresAt` or logout.
 */
export const LocalSignInStartBody = z.object({ email: z.email().max(254) });
export const LocalSignInStartResponse = z.object({ requestId: Uuid, expiresAt: Timestamp });
export const LocalSignInRedeemBody = z.object({ requestId: Uuid, code: z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/) });
export const LocalSignInRedeemResponse = z.object({
  token: z.string().min(20),
  expiresAt: Timestamp,
  userId: Uuid,
  organizationId: Uuid,
  role: OrgRole,
});

/** Routes every environment (wOS Core, hosted or self-hosted) serves to wOS clients. */
export const CoreRoutes = {
  environment: { method: "GET", path: "/.well-known/wos-environment", auth: "public", response: EnvironmentDescriptor },
  activeApps: { method: "GET", path: "/v1/core/apps", auth: "environment_session", response: ActiveApps },
  screens: {
    method: "GET",
    path: "/v1/core/apps/:app/screens",
    auth: "environment_session",
    response: z.object({ app: AppId, version: SemVer, screens: z.lazy(() => z.array(MobileScreen)) }),
  },
  /** contracts 5.6.0: self-hosted `local` sign-in (a wOS Cloud Core answers 404: its clients use environment tokens). */
  localSignInStart: {
    method: "POST",
    path: "/v1/core/auth/local/start",
    auth: "public",
    body: LocalSignInStartBody,
    status: 202,
    response: LocalSignInStartResponse,
  },
  localSignInRedeem: {
    method: "POST",
    path: "/v1/core/auth/local/redeem",
    auth: "public",
    body: LocalSignInRedeemBody,
    response: LocalSignInRedeemResponse,
  },
  /** Ends the Bearer's local session; with an environment token it is a no-op answering { ok: true }. */
  logout: { method: "POST", path: "/v1/core/auth/logout", auth: "environment_session", response: z.object({ ok: z.literal(true) }) },
} as const;

// ---------------------------------------------------------------------------------------------
// Mobile declarative screens (V1 minimum: list, detail, form)
// ---------------------------------------------------------------------------------------------

const FieldName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const ScreenId = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);

export const ScreenAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("call"), id: z.string(), field: FieldName }),
  z.object({ kind: z.literal("email"), id: z.string(), field: FieldName }),
  z.object({ kind: z.literal("open_screen"), id: z.string(), screen: ScreenId }),
  z.object({ kind: z.literal("create"), id: z.string(), screen: ScreenId, permission: PermissionKey }),
  z.object({ kind: z.literal("edit"), id: z.string(), screen: ScreenId, permission: PermissionKey }),
  z.object({ kind: z.literal("delete"), id: z.string(), permission: PermissionKey }),
  /** POST to the app's own API (path under /apps/<app>/); the runtime shows the result, no code runs. */
  z.object({
    kind: z.literal("invoke"),
    id: z.string(),
    endpoint: z.string().regex(/^\/apps\/[a-z][a-z0-9-]*\/[a-z0-9/_:-]+$/),
    permission: PermissionKey,
  }),
]);

const FieldSpec = z
  .object({
    field: FieldName,
    label: z.string().max(60).optional(),
    input: z.enum(["text", "email", "phone", "number", "date", "select", "readonly"]).default("readonly"),
    required: z.boolean().default(false),
    /** contracts 5.2.0: the fixed choices of a `select` input (required for, and only for, select). */
    options: z
      .array(z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(60) }))
      .min(1)
      .max(50)
      .optional(),
  })
  .superRefine((f, ctx) => {
    if ((f.input === "select") !== (f.options !== undefined))
      ctx.addIssue({ code: "custom", path: ["options"], message: "a select input (and only a select) has options" });
  });

export const ScreenSection = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fields"), fields: z.array(FieldSpec).min(1) }),
  z.object({ type: z.literal("related_list"), relationship: FieldName, screen: ScreenId }),
]);

export const MobileScreen = z
  .object({
    schema: z.literal("wos-screen.v1"),
    id: ScreenId,
    app: AppId,
    kind: z.enum(["list", "detail", "form"]),
    /** The API resource the runtime reads, e.g. "/apps/crm/contacts" (list) or "/apps/crm/contacts/:id". */
    resource: z.string().regex(/^\/apps\/[a-z][a-z0-9-]*\/[a-z0-9/_:-]+$/),
    title: z.union([z.object({ field: FieldName }), z.object({ text: z.string().min(1).max(60) })]),
    permission: PermissionKey,
    list: z
      .object({ fields: z.array(FieldName).min(1).max(4), search: z.boolean().default(false), onTap: ScreenId.nullable() })
      .nullable()
      .default(null),
    sections: z.array(ScreenSection).default([]),
    actions: z.array(ScreenAction).default([]),
  })
  .superRefine((s, ctx) => {
    const issue = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (!s.id.startsWith(`${s.app}.`)) issue(["id"], `must start with ${s.app}.`);
    if (!s.resource.startsWith(`/apps/${s.app}/`)) issue(["resource"], `must be under /apps/${s.app}/`);
    if (!s.permission.startsWith(`${s.app}.`)) issue(["permission"], `must be a ${s.app} permission`);
    if ((s.kind === "list") !== (s.list !== null)) issue(["list"], "list screens (and only they) have `list`");
    if (s.kind !== "list" && s.sections.length === 0) issue(["sections"], "detail and form screens need sections");
    if (s.kind === "form")
      for (const sec of s.sections)
        if (sec.type === "fields" && sec.fields.every((f) => f.input === "readonly"))
          issue(["sections"], "a form needs at least one input field");
  });
export type MobileScreen = z.infer<typeof MobileScreen>;

/**
 * contracts 5.2.0: the data a `wos-screen.v1` runtime exchanges with the app's API. Every screen reads only its own
 * `resource` under `/apps/<app>/`, with the environment session as bearer:
 *
 *   list     GET <resource>[?q=<search>][&cursor=<nextCursor>]          -> ScreenListData
 *   detail   GET <resource> with `:id` replaced by the tapped record's id -> ScreenRecordData
 *   related  GET <detail resource>/<relationship>                         -> ScreenListData, rendered with the
 *            related_list's `screen` (a list screen)
 *   create   POST <form screen resource> with ScreenFormBody              -> ScreenRecordData
 *   edit     PATCH <form screen resource, :id replaced> with ScreenFormBody -> ScreenRecordData
 *   delete   DELETE <detail resource>                                     -> 204
 *   invoke   POST <endpoint, :id replaced> with {}                        -> ScreenInvokeResult
 *
 * Records are flat objects keyed by FieldName with an `id`. Values are strings, numbers, booleans or null; dates are
 * ISO 8601 strings. Errors use the wOS `ApiError` envelope. Nothing in a screen or a response is executed.
 */
const ScreenValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const ScreenRecord = z.record(FieldName, ScreenValue).and(z.object({ id: z.string().min(1) }));
export type ScreenRecord = z.infer<typeof ScreenRecord>;
export const ScreenListData = z.object({ items: z.array(ScreenRecord), nextCursor: z.string().min(1).nullable() });
export type ScreenListData = z.infer<typeof ScreenListData>;
export const ScreenRecordData = z.object({ item: ScreenRecord });
export type ScreenRecordData = z.infer<typeof ScreenRecordData>;
export const ScreenFormBody = z.object({ values: z.record(FieldName, ScreenValue) });
export type ScreenFormBody = z.infer<typeof ScreenFormBody>;
/** What the runtime shows after an `invoke` action (plain text, never markup). */
export const ScreenInvokeResult = z.object({ message: z.string().max(280).nullable() });
export type ScreenInvokeResult = z.infer<typeof ScreenInvokeResult>;

// ---------------------------------------------------------------------------------------------
// Pure helpers shared by every client and the control plane
// ---------------------------------------------------------------------------------------------

/** 1, 0, -1 for semver a vs b. */
export function compareSemVer(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

/** Does `version` satisfy every comparator of `range`? (^ = same major, ~ = same major.minor). */
export function satisfiesRange(version: string, range: string): boolean {
  const comps = range.trim().split(/\s+/);
  return comps.every((c) => {
    const m = /^(>=|<=|>|<|=|\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(c);
    if (!m) return false;
    const base = `${m[2]}.${m[3]}.${m[4]}`;
    const cmp = compareSemVer(version, base);
    const [maj, min] = version.split(".").map(Number);
    switch (m[1]) {
      case ">=":
        return cmp >= 0;
      case "<=":
        return cmp <= 0;
      case ">":
        return cmp > 0;
      case "<":
        return cmp < 0;
      case "^":
        return cmp >= 0 && maj === Number(m[2]);
      case "~":
        return cmp >= 0 && maj === Number(m[2]) && min === Number(m[3]);
      default:
        return cmp === 0;
    }
  });
}

/**
 * The apps active for an organization: core, every enabled app, and (transitively) every app or module they
 * require. `enabled` is the set of kind-app ids with an enabled entitlement (hosted) or the operator's
 * configuration (self-hosted). Throws on a requirement missing from the registry.
 */
export function activeAppIds(
  registry: ReadonlyMap<string, { kind: AppKind; dependencies: readonly { id: string }[] }>,
  enabled: Iterable<string>,
): string[] {
  const out = new Set<string>([CORE_APP_ID]);
  const stack = [...enabled];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    const entry = registry.get(id);
    if (!entry) throw new Error(`app ${id} is not in the registry`);
    out.add(id);
    for (const d of entry.dependencies) stack.push(d.id);
  }
  return [...out].sort();
}

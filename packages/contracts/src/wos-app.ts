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

// ---------------------------------------------------------------------------------------------
// App registry (control plane; public)
// ---------------------------------------------------------------------------------------------

const Availability = z.object({ available: z.boolean(), version: SemVer.nullable() });

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
    /** The signed package to download for the current version (null when desktop is unsupported). */
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

const FieldSpec = z.object({
  field: FieldName,
  label: z.string().max(60).optional(),
  input: z.enum(["text", "email", "phone", "number", "date", "select", "readonly"]).default("readonly"),
  required: z.boolean().default(false),
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

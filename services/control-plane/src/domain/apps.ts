/**
 * The one-product layer on the control plane (Amendment 01, WOS-APP-PROTOCOL sections 4-8 and 11): the AppRegistry
 * built from current releases, organization apps and entitlements (EntitlementMachine), active app ids, and
 * application progress (`computeApplicationProgress`). Pure reads and helpers; the handlers own the transactions.
 */
import {
  activeAppIds,
  type AppEntitlement,
  type AppKind,
  type AppRegistryEntry,
  type AppReleaseView,
  type ApplicationFeatureInput,
  type ApplicationProgressView,
  type ApplicationSurface,
  CORE_APP_ID,
  computeApplicationProgress,
  ModuleBundle,
  type ModulePackage,
  type OrgAppView,
  type OrgApps,
  ProductSurface,
  satisfiesRange,
  type Surface,
  WOS_APP_PROTOCOL,
  WosAppManifest,
} from "@waronsaas/contracts";
import { canonicalJson, sha256Of } from "@waronsaas/contracts/canonical";
import type { Tx } from "@waronsaas/db";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";
import { isoReq } from "../views.js";

export interface ReleaseRow {
  app_id: string;
  version: string;
  state: "published" | "yanked";
  manifest: WosAppManifest;
  manifest_sha256: string;
  surfaces: string[];
  desktop_package: ModulePackage | null;
  desktop_package_url: string | null;
  source_repo: string;
  source_tag: string;
  source_commit: string;
  published_at: Date;
  yanked_at: Date | null;
  yank_reason: string | null;
}

/** The manifest's supported product surfaces, in ProductSurface order. */
export function supportedSurfaces(m: WosAppManifest): ApplicationSurface[] {
  return ProductSurface.options.filter((s) => m.surfaces[s].supported);
}

// ---------------------------------------------------------------------------------------------- bundles

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Default download: https only, bounded size and time. */
export async function fetchHttpsBytes(url: string): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new Error("module bundles are downloaded over https only");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`bundle download answered ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BUNDLE_BYTES) throw new Error("bundle is larger than 64 MiB");
  return buf;
}

/**
 * sha256Of(bundle bytes) per (app, version, url). Migration 0006 has no column for it (B-0007-control-plane), so it is
 * computed at publish and, after a cold start, from one download; the pair is immutable, so the cache never goes stale.
 */
const bundleShaCache = new Map<string, string>();
const bundleKey = (app: string, version: string, url: string) => `${app}@${version} ${url}`;

export function rememberBundleSha(app: string, version: string, url: string, sha: string): void {
  bundleShaCache.set(bundleKey(app, version, url), sha);
}

async function bundleSha(deps: Deps, r: ReleaseRow): Promise<string> {
  const key = bundleKey(r.app_id, r.version, r.desktop_package_url!);
  const hit = bundleShaCache.get(key);
  if (hit) return hit;
  let bytes: Uint8Array;
  try {
    bytes = await (deps.fetchBytes ?? fetchHttpsBytes)(r.desktop_package_url!);
  } catch (err) {
    deps.log("error", "module bundle download failed", {
      app: r.app_id,
      version: r.version,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ApiFailure("INTERNAL", "the module bundle could not be read");
  }
  const reasons = verifyBundleBytes(bytes, r.desktop_package!);
  if (reasons.length > 0) {
    deps.log("error", "a published module bundle no longer matches its release", { app: r.app_id, version: r.version, reasons });
    throw new ApiFailure("INTERNAL", "the module bundle does not match its release");
  }
  const sha = sha256Of(bytes);
  bundleShaCache.set(key, sha);
  return sha;
}

/** Checks a downloaded `ModuleBundle` against the signed package (WOS-APP-PROTOCOL section 6). Returns the reasons it fails. */
export function verifyBundleBytes(bytes: Uint8Array, pkg: ModulePackage): string[] {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return ["bundle: not UTF-8 JSON"];
  }
  const parsed = ModuleBundle.safeParse(json);
  if (!parsed.success) return parsed.error.issues.map((i) => `bundle: ${i.path.join(".")}: ${i.message}`);
  const bundle = parsed.data;
  const reasons: string[] = [];
  if (canonicalJson(bundle.package) !== canonicalJson(pkg)) reasons.push("bundle: package differs from the published desktopPackage");
  const files = new Map(pkg.files.map((f) => [f.path, f]));
  for (const c of bundle.contents) {
    const f = files.get(c.path);
    if (!f) continue; // ModuleBundle already refused contents that differ from the file list
    const data = Buffer.from(c.base64, "base64");
    if (data.toString("base64") !== c.base64.replace(/\s/g, "")) reasons.push(`bundle: ${c.path}: not standard base64`);
    else if (data.byteLength !== f.bytes || sha256Of(data) !== f.sha256)
      reasons.push(`bundle: ${c.path}: bytes do not match the package hash`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------------------------- registry

export async function currentReleases(tx: Tx): Promise<ReleaseRow[]> {
  return tx<ReleaseRow[]>`
    select r.* from wos.app_registry g join wos.app_releases r on r.app_id = g.app_id and r.version = g.current_version
     order by g.app_id`;
}

async function desktopPackageView(deps: Deps, r: ReleaseRow) {
  if (!r.desktop_package || !r.desktop_package_url) return null;
  return { url: r.desktop_package_url, sha256: await bundleSha(deps, r), keyId: r.desktop_package.signature.keyId };
}

/** An `AppRegistryEntry` from the app's current release (contracts 5.2.0: the registry is built from releases). */
export async function registryEntry(deps: Deps, r: ReleaseRow): Promise<AppRegistryEntry> {
  const m = r.manifest;
  const v = r.version;
  const pkg = await desktopPackageView(deps, r);
  // Build is bundled in the Desktop binary (D16), so its desktop surface is available without a package.
  const desktopAvailable = m.surfaces.desktop.supported && (pkg !== null || m.app.id === "build");
  return {
    id: m.app.id,
    name: m.app.name,
    kind: m.app.kind,
    billing: m.app.billing,
    summary: m.app.summary,
    currentVersion: v,
    protocol: WOS_APP_PROTOCOL,
    capabilities: m.provides,
    dependencies: m.requires.apps,
    features: m.features,
    replaces: m.replaces,
    surfaces: {
      web: { available: m.surfaces.web.supported, version: m.surfaces.web.supported ? v : null },
      desktop: { available: desktopAvailable, version: desktopAvailable ? v : null, package: pkg },
      // Mobile code ships in store builds (S-38) and no store build is recorded yet: never claimed available.
      ios: { available: false, version: null },
      android: { available: false, version: null },
      api: { available: m.surfaces.api.supported, version: m.surfaces.api.supported ? v : null },
    },
    selfHost: { compatible: m.hosting.selfHost.supported },
    hosted: { compatible: m.hosting.hosted.supported },
    publishedAt: isoReq(r.published_at),
  };
}

export async function releaseView(deps: Deps, r: ReleaseRow): Promise<AppReleaseView> {
  return {
    app: r.app_id,
    version: r.version,
    state: r.state,
    manifest: r.manifest,
    manifestSha256: r.manifest_sha256,
    desktopPackage: await desktopPackageView(deps, r),
    source: { repo: r.source_repo, tag: r.source_tag, commit: r.source_commit },
    publishedAt: isoReq(r.published_at),
    yankedAt: r.yanked_at ? isoReq(r.yanked_at) : null,
    yankReason: r.yank_reason,
  };
}

// ---------------------------------------------------------------------------------------------- organizations

export type RegistryMap = ReadonlyMap<string, { kind: AppKind; version: string; dependencies: readonly { id: string; version: string }[] }>;

export function registryMap(rows: readonly ReleaseRow[]): RegistryMap {
  return new Map(rows.map((r) => [r.app_id, { kind: r.manifest.app.kind, version: r.version, dependencies: r.manifest.requires.apps }]));
}

/** Every app `ids` need, transitively (without core), and the requirements missing from the registry. */
export function requirementClosure(registry: RegistryMap, ids: Iterable<string>): { ids: Set<string>; missing: string[] } {
  const out = new Set<string>();
  const missing = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id) || id === CORE_APP_ID) continue;
    const e = registry.get(id);
    if (!e) {
      missing.add(id);
      continue;
    }
    out.add(id);
    for (const d of e.dependencies) stack.push(d.id);
  }
  return { ids: out, missing: [...missing].sort() };
}

export interface EntitlementRow {
  organization_id: string;
  app_id: string;
  state: "enabled" | "disabled" | "suspended";
  changed_at: Date;
  row_version: number;
}

export function entitlementView(orgId: string, app: string, row: EntitlementRow | undefined): AppEntitlement {
  return row
    ? { organizationId: orgId, app, state: row.state, changedAt: isoReq(row.changed_at), rowVersion: row.row_version }
    : { organizationId: orgId, app, state: "available", changedAt: null, rowVersion: 0 };
}

export async function entitlementsOf(tx: Tx, orgId: string): Promise<Map<string, EntitlementRow>> {
  const rows = await tx<EntitlementRow[]>`
    select organization_id, app_id, state, changed_at, row_version from wos.app_entitlements where organization_id = ${orgId}`;
  return new Map(rows.map((r) => [r.app_id, r]));
}

/**
 * The org's active app ids (WOS-APP-PROTOCOL section 7): core, every enabled kind-app with a current release, and what
 * they require. An enabled app whose requirements are missing from the registry is left out (and logged), never guessed.
 */
export function activeFor(deps: Deps, registry: RegistryMap, entitlements: ReadonlyMap<string, EntitlementRow>): string[] {
  const enabled: string[] = [];
  for (const [app, e] of entitlements) {
    if (e.state !== "enabled" || registry.get(app)?.kind !== "app") continue;
    const { missing } = requirementClosure(registry, [app]);
    if (missing.length > 0) {
      deps.log("warn", "enabled app has requirements missing from the registry; not activated", { app, missing });
      continue;
    }
    enabled.push(app);
  }
  return activeAppIds(registry, enabled);
}

export async function orgApps(deps: Deps, tx: Tx, orgId: string): Promise<OrgApps> {
  const releases = await currentReleases(tx);
  const registry = registryMap(releases);
  const ents = await entitlementsOf(tx, orgId);
  const active = new Set(activeFor(deps, registry, ents));
  const kindOrder: Record<AppKind, number> = { core: 0, app: 1, module: 2 };
  const sorted = [...releases].sort(
    (a, b) => kindOrder[a.manifest.app.kind] - kindOrder[b.manifest.app.kind] || a.app_id.localeCompare(b.app_id),
  );
  const yourApps: OrgAppView[] = [];
  const availableApps: OrgAppView[] = [];
  for (const r of sorted) {
    const kind = r.manifest.app.kind;
    if (active.has(r.app_id)) {
      // Core and modules have no entitlement row: they are active as part of wOS (enabled, never changed by anyone).
      const ent = kind === "app" ? entitlementView(orgId, r.app_id, ents.get(r.app_id)) : entitlementView(orgId, r.app_id, undefined);
      if (kind !== "app") ent.state = "enabled";
      yourApps.push({ app: await registryEntry(deps, r), entitlement: ent });
    } else if (kind === "app" && r.manifest.hosting.hosted.supported) {
      availableApps.push({ app: await registryEntry(deps, r), entitlement: entitlementView(orgId, r.app_id, ents.get(r.app_id)) });
    }
  }
  return { organizationId: orgId, yourApps, availableApps };
}

// ---------------------------------------------------------------------------------------------- application progress

async function manifestFromDefaultBranch(deps: Deps, app: string): Promise<WosAppManifest | null> {
  let bytes: Uint8Array | null;
  try {
    const head = await deps.github.getBranchHead(deps.config.productRepo, "main");
    bytes = await deps.github.readFileAt(deps.config.productRepo, head, `applications/${app}/wos-app.json`);
  } catch (err) {
    deps.log("error", "reading the product default branch failed", { app, error: err instanceof Error ? err.message : String(err) });
    throw new ApiFailure("INTERNAL", "the product repository could not be read");
  }
  if (!bytes) return null;
  try {
    const parsed = WosAppManifest.safeParse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    if (parsed.success && parsed.data.app.id === app) return parsed.data;
  } catch {
    // an unparsable manifest is treated as none
  }
  deps.log("warn", "applications/<app>/wos-app.json on the default branch is not a valid manifest for this app", { app });
  return null;
}

/** One feature's input from the records: its latest merged contract, merged build graph ABUs and acceptance runs. */
async function featureInput(tx: Tx, feature: string): Promise<ApplicationFeatureInput> {
  const [f] = await tx<{ id: string; doc: string | null; version: number | null }[]>`
    select f.id, d.id as doc, d.version from wos.catalog_features f
      left join wos.documents d on d.id = f.current_contract_document_id and d.state = 'merged'
     where f.key = ${feature}`;
  if (!f?.doc) return { feature, contract: null };
  const tags = await tx<{ key: string; surfaces: Surface[] }[]>`
    select r.key, coalesce(array_agg(rs.surface order by rs.surface) filter (where rs.surface is not null), '{}') as surfaces
      from wos.requirements r left join wos.requirement_surfaces rs on rs.requirement_id = r.id
     where r.document_id = ${f.doc} group by r.key order by r.key`;
  const abus = await tx<{ key: string; size_points: 1 | 2 | 3 | 5 | 8; state: string; requirements: string[]; pr_url: string | null }[]>`
    select a.key, a.size_points, a.state,
           coalesce((select array_agg(distinct r.key order by r.key) from wos.abu_requirements ar join wos.requirements r on r.id = ar.requirement_id
                      where ar.abu_id = a.id), '{}') as requirements,
           (select p.url from wos.pull_requests p join wos.attempts at on at.id = p.attempt_id where at.abu_id = a.id and p.state = 'merged' limit 1) as pr_url
      from wos.abus a where a.catalog_feature_id = ${f.id} and a.state <> 'superseded' order by a.key`;
  // Per surface: for at least one profile, the latest acceptance run after the feature's last merge concluded success.
  const acc = await tx<{ surface: Surface; passed: boolean }[]>`
    select surface, bool_or(passed) as passed from (
      select distinct on (v.surface, v.profile_target_id) v.surface, v.conclusion = 'success' as passed from wos.verification_runs v
       where v.subject = 'profile_acceptance' and v.catalog_feature_id = ${f.id}
         and v.created_at >= coalesce((select max(p.merged_at) from wos.pull_requests p join wos.attempts at on at.id = p.attempt_id
                                        join wos.abus a on a.id = at.abu_id where a.catalog_feature_id = ${f.id}), '-infinity')
       order by v.surface, v.profile_target_id, v.created_at desc, v.id desc) latest
     group by surface`;
  return {
    feature,
    contract: {
      version: f.version ?? 1,
      requirementSurfaces: Object.fromEntries(tags.map((t) => [t.key, t.surfaces])),
      abus: abus.map((a) => ({
        key: a.key,
        sizePoints: a.size_points,
        requirements: a.requirements,
        merged: a.state === "merged",
        superseded: false,
        prUrl: a.pr_url,
      })),
      acceptancePassed: Object.fromEntries(acc.map((a) => [a.surface, a.passed])),
    },
  };
}

/**
 * `getApplicationProgress`: features from the current release manifest, else the product default branch's
 * `applications/<app>/wos-app.json`, else none. Independent of every organization, entitlement and install.
 */
export async function applicationProgress(deps: Deps, tx: Tx, app: string): Promise<ApplicationProgressView> {
  const [reg] = await tx<{ current_version: string | null }[]>`select current_version from wos.app_registry where app_id = ${app}`;
  const targets = await tx<{ slug: string }[]>`
    select t.slug from wos.target_apps ta join wos.targets t on t.id = ta.target_id where ta.app_id = ${app} order by t.rank, t.slug`;
  if (!reg && targets.length === 0) throw new ApiFailure("NOT_FOUND", `app ${app} is neither in the registry nor mapped to a target`);
  const known = { current_version: reg?.current_version ?? null };
  let basis: ApplicationProgressView["basis"] = "none";
  let manifest: WosAppManifest | null = null;
  if (known.current_version) {
    const [r] = await tx<{ manifest: WosAppManifest }[]>`
      select manifest from wos.app_releases where app_id = ${app} and version = ${known.current_version}`;
    manifest = r?.manifest ?? null;
    if (manifest) basis = "release";
  }
  if (!manifest) {
    manifest = await manifestFromDefaultBranch(deps, app);
    if (manifest) basis = "default_branch";
  }
  const surfaces = manifest ? supportedSurfaces(manifest) : [];
  const features: ApplicationFeatureInput[] = [];
  for (const key of manifest ? [...new Set(manifest.features)] : []) features.push(await featureInput(tx, key));
  const p = computeApplicationProgress({ app, surfaces, features });
  return {
    app,
    basis,
    manifestVersion: manifest?.app.version ?? null,
    builtBp: p.builtBp,
    relevantPoints: p.relevantPoints,
    mergedPoints: p.mergedPoints,
    complete: p.complete,
    surfaces: p.surfaces,
    features: p.features,
    targets: targets.map((t) => t.slug),
    computedAt: new Date().toISOString(),
  };
}

/** Checks the requirements of `app` for an enable: required apps enabled, modules present, versions in range. */
export function missingRequirements(registry: RegistryMap, entitlements: ReadonlyMap<string, EntitlementRow>, app: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    const e = registry.get(id);
    for (const d of e?.dependencies ?? []) {
      if (d.id === CORE_APP_ID || seen.has(d.id)) continue;
      seen.add(d.id);
      const dep = registry.get(d.id);
      if (!dep) problems.push(`${d.id} is not in the registry`);
      else if (!satisfiesRange(dep.version, d.version)) problems.push(`${d.id}@${dep.version} does not satisfy ${d.version}`);
      else if (dep.kind === "app" && entitlements.get(d.id)?.state !== "enabled") problems.push(`${d.id} is not enabled`);
      else visit(d.id);
    }
  };
  visit(app);
  return problems;
}

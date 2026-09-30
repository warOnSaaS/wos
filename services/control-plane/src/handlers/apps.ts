/**
 * `AppRoutes` (contracts 5.2.0, WORKSTREAMS 12.4): the AppRegistry, organizations, entitlements, environment tokens
 * and application progress. Entitlements decide what wOS Cloud hosts and shows; they never touch target progress
 * (V1 proof step 9) and are never consulted by a self-hosted wOS (S-41).
 */
import {
  AppReleaseMachine,
  BUILD_APP_ID,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  type EntitlementEvent,
  EntitlementMachine,
  type EntitlementStateName,
  type EnvironmentTokenClaims,
  findTransition,
  type OrgRole,
  RepoFullName,
} from "@waronsaas/contracts";
import { canonicalJson, canonicalSha256, sha256Of, signEnvironmentToken, verifyModulePackage } from "@waronsaas/contracts/canonical";
import { inTransaction, type Tx } from "@waronsaas/db";
import { insertEvent } from "../db/events.js";
import {
  activeFor,
  applicationProgress,
  currentReleases,
  type EntitlementRow,
  entitlementsOf,
  entitlementView,
  fetchHttpsBytes,
  missingRequirements,
  orgApps,
  type ReleaseRow,
  registryEntry,
  registryMap,
  releaseView,
  requirementClosure,
  supportedSurfaces,
  verifyBundleBytes,
} from "../domain/apps.js";
import { ApiFailure } from "../errors.js";
import type { Caller, Handlers, HandlerCtx } from "../http/router.js";

const ANON = { kind: "anonymous", accountId: null } as const;
const SYSTEM = { kind: "system", accountId: null } as const;
const asAccount = (c: Caller) => ({ kind: "contributor" as const, accountId: c.accountId });
const asMaintainer = (c: Caller) => ({ kind: "maintainer" as const, accountId: c.accountId });
const eventActor = (c: Caller) => (c.isMaintainer ? ("maintainer" as const) : ("contributor" as const));

/** Team organizations one account may own (createOrganization answers LIMIT_REACHED beyond it). */
export const MAX_OWNED_TEAM_ORGS = 10;

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  kind: "personal" | "team";
  created_at: Date;
  role: OrgRole;
}

const orgView = (o: OrgRow) => ({
  id: o.id,
  slug: o.slug,
  name: o.name,
  kind: o.kind,
  createdAt: o.created_at.toISOString(),
  role: o.role,
});

/** The caller's role in an organization: NOT_FOUND when it does not exist, FORBIDDEN when the caller is no member. */
async function roleIn(deps: HandlerCtx<"listOrgApps">["deps"], caller: Caller, orgId: string): Promise<OrgRole> {
  const [m] = await inTransaction(
    deps.sql,
    asAccount(caller),
    (tx) => tx<{ role: OrgRole }[]>`select role from wos.memberships where organization_id = ${orgId} and account_id = ${caller.accountId}`,
  );
  if (m) return m.role;
  const [exists] = await inTransaction(
    deps.sql,
    SYSTEM,
    (tx) => tx<{ x: number }[]>`select 1 as x from wos.organizations where id = ${orgId}`,
  );
  if (!exists) throw new ApiFailure("NOT_FOUND", "organization not found");
  throw new ApiFailure("FORBIDDEN", "you are not a member of this organization");
}

async function currentRelease(tx: Tx, app: string): Promise<ReleaseRow | undefined> {
  const [r] = await tx<ReleaseRow[]>`
    select r.* from wos.app_registry g join wos.app_releases r on r.app_id = g.app_id and r.version = g.current_version
     where g.app_id = ${app}`;
  return r;
}

/** One EntitlementMachine step for (org, app) with optimistic concurrency and the entitlement.changed event. */
async function changeEntitlement(ctx: HandlerCtx<"enableApp" | "disableApp">, event: EntitlementEvent) {
  const { deps } = ctx;
  const caller = ctx.caller!;
  const { id: orgId, app } = ctx.params;
  const role = await roleIn(deps, caller, orgId);
  if (role !== "owner" && role !== "admin")
    throw new ApiFailure("FORBIDDEN", "only an owner or admin of the organization changes its apps");
  return inTransaction(deps.sql, asAccount(caller), async (tx) => {
    // One entitlement change per organization at a time: the dependency and dependent checks read the org's other rows.
    await tx`select 1 from wos.organizations where id = ${orgId} for update`;
    const releases = await currentReleases(tx);
    const release = releases.find((r) => r.app_id === app);
    if (!release) throw new ApiFailure("NOT_FOUND", `app ${app} has no published release`);
    if (release.manifest.app.kind !== "app")
      throw new ApiFailure("VALIDATION_FAILED", `${app} is a ${release.manifest.app.kind}; only applications are enabled or disabled`);
    const registry = registryMap(releases);
    const ents = await entitlementsOf(tx, orgId);
    const row = ents.get(app);
    const from: EntitlementStateName = row?.state ?? "available";
    const expected = ctx.body.expectedRowVersion;
    if ((row === undefined) !== (expected === null) || (row && row.row_version !== expected))
      throw new ApiFailure("CONFLICT", "the entitlement changed since you read it; re-read and decide", {
        current: entitlementView(orgId, app, row),
      });
    const t = findTransition(EntitlementMachine, from, event);
    if (!t) throw new ApiFailure("CONFLICT", `${app} is ${from}; it cannot ${event}`, { current: entitlementView(orgId, app, row) });
    if (event === "enable") {
      if (!release.manifest.hosting.hosted.supported)
        throw new ApiFailure("VALIDATION_FAILED", `${app} is not hosted-compatible; run it self-hosted instead`);
      const missing = missingRequirements(registry, ents, app);
      if (missing.length > 0)
        throw new ApiFailure("DEPENDENCY_NOT_ENABLED", `enable what ${app} requires first: ${missing.join("; ")}`, { missing });
    } else {
      const dependents = [...ents]
        .filter(([other, e]) => other !== app && e.state === "enabled" && registry.get(other)?.kind === "app")
        .filter(([other]) => requirementClosure(registry, [other]).ids.has(app))
        .map(([other]) => other)
        .sort();
      if (dependents.length > 0)
        throw new ApiFailure("DEPENDENT_ENABLED", `disable the apps that require ${app} first: ${dependents.join(", ")}`, { dependents });
    }
    let updated: EntitlementRow | undefined;
    if (!row) {
      [updated] = await tx<EntitlementRow[]>`
        insert into wos.app_entitlements (organization_id, app_id, state, changed_by)
        values (${orgId}, ${app}, ${t.to}, ${caller.accountId})
        returning organization_id, app_id, state, changed_at, row_version`;
    } else {
      [updated] = await tx<EntitlementRow[]>`
        update wos.app_entitlements
           set state = ${t.to}, suspended_reason = null, changed_at = now(), changed_by = ${caller.accountId}, row_version = row_version + 1
         where organization_id = ${orgId} and app_id = ${app} and state = ${from} and row_version = ${row.row_version}
        returning organization_id, app_id, state, changed_at, row_version`;
    }
    if (!updated) throw new ApiFailure("CONFLICT", "a concurrent change won; re-read and decide");
    await insertEvent(
      tx,
      {
        type: "entitlement.changed",
        v: 1,
        visibility: "private",
        payload: { organizationId: orgId, app, from, to: t.to as "enabled" | "disabled" | "suspended" },
      },
      { aggregateKind: "entitlement", aggregateId: `${orgId}:${app}`, actor: eventActor(caller), actorAccountId: caller.accountId },
    );
    return { app: await registryEntry(deps, release), entitlement: entitlementView(orgId, app, updated) };
  });
}

/** Re-verifies a desktop package exactly like Desktop does (S-37) plus the downloaded bundle; returns its sha256. */
async function verifyDesktopRelease(ctx: HandlerCtx<"publishAppRelease">): Promise<string | null> {
  const { manifest, desktopPackage: pkg, desktopPackageUrl: url, source } = ctx.body;
  const app = manifest.app.id;
  const fail = (reasons: string[]): never => {
    throw new ApiFailure("VALIDATION_FAILED", `release rejected: ${reasons[0]}`, { reasons });
  };
  if (app === BUILD_APP_ID) {
    // Build is bundled in the Desktop binary (D16, S-40): no package, source waronsaas/wos.
    const reasons = [];
    if (pkg !== null || url !== null) reasons.push("build has no desktop package (it is bundled in wOS Desktop)");
    if (source.repo.toLowerCase() !== ctx.deps.config.platformRepo.toLowerCase())
      reasons.push(`build is released from ${ctx.deps.config.platformRepo}`);
    if (reasons.length > 0) fail(reasons);
    return null;
  }
  if (!manifest.surfaces.desktop.supported) {
    if (pkg !== null || url !== null) fail(["the manifest does not support desktop, so there is no desktop package"]);
    return null;
  }
  if (pkg === null || url === null) return fail(["a desktop surface needs desktopPackage and desktopPackageUrl"]);
  if (!url.startsWith("https://")) fail(["desktopPackageUrl must be https"]);
  const keys = ctx.deps.appKeys?.modulePublicKeys ?? {};
  if (Object.keys(keys).length === 0) fail(["no module-signing public keys are configured on the control plane (WOS_MODULE_PUBLIC_KEYS)"]);
  const reasons = verifyModulePackage(pkg, keys);
  if (canonicalJson(pkg.manifest) !== canonicalJson(manifest)) reasons.push("desktopPackage.manifest differs from manifest");
  if (pkg.manifestSha256 !== canonicalSha256(manifest)) reasons.push("desktopPackage.manifestSha256 is not the manifest's hash");
  if (pkg.source.repo !== source.repo || pkg.source.tag !== source.tag || pkg.source.commit !== source.commit)
    reasons.push("desktopPackage.source differs from source");
  if (reasons.length > 0) fail(reasons);
  let bytes: Uint8Array;
  try {
    bytes = await (ctx.deps.fetchBytes ?? fetchHttpsBytes)(url);
  } catch (err) {
    return fail([`desktopPackageUrl could not be downloaded: ${err instanceof Error ? err.message : String(err)}`]);
  }
  const bundleReasons = verifyBundleBytes(bytes, pkg);
  if (bundleReasons.length > 0) fail(bundleReasons);
  return sha256Of(bytes);
}

export const appHandlers: Pick<
  Handlers,
  | "listApps"
  | "getApp"
  | "getAppRelease"
  | "getApplicationProgress"
  | "getEnvironmentKeys"
  | "listMyOrganizations"
  | "createOrganization"
  | "listOrgApps"
  | "enableApp"
  | "disableApp"
  | "issueEnvironmentToken"
  | "publishAppRelease"
  | "yankAppRelease"
> = {
  async listApps(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const items = [];
      for (const r of await currentReleases(tx)) items.push(await registryEntry(ctx.deps, r));
      return { items };
    });
  },

  async getApp(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const r = await currentRelease(tx, ctx.params.app);
      if (!r) throw new ApiFailure("NOT_FOUND", `app ${ctx.params.app} has no published release`);
      return registryEntry(ctx.deps, r);
    });
  },

  async getAppRelease(ctx) {
    return inTransaction(ctx.deps.sql, ANON, async (tx) => {
      const [r] = await tx<
        ReleaseRow[]
      >`select * from wos.app_releases where app_id = ${ctx.params.app} and version = ${ctx.params.version}`;
      if (!r) throw new ApiFailure("NOT_FOUND", `release ${ctx.params.app}@${ctx.params.version} not found`);
      return releaseView(ctx.deps, r);
    });
  },

  async getApplicationProgress(ctx) {
    return inTransaction(ctx.deps.sql, ANON, (tx) => applicationProgress(ctx.deps, tx, ctx.params.app));
  },

  async getEnvironmentKeys(ctx) {
    const k = ctx.deps.appKeys;
    const keys = [];
    if (k?.envToken) keys.push({ kid: k.envToken.kid, alg: "EdDSA" as const, publicKey: k.envToken.publicKey });
    if (k?.envTokenNext) keys.push({ kid: k.envTokenNext.kid, alg: "EdDSA" as const, publicKey: k.envTokenNext.publicKey });
    return { keys };
  },

  async listMyOrganizations(ctx) {
    const caller = ctx.caller!;
    return inTransaction(ctx.deps.sql, asAccount(caller), async (tx) => {
      const rows = await tx<OrgRow[]>`
        select o.id, o.slug, o.name, o.kind, o.created_at, m.role
          from wos.memberships m join wos.organizations o on o.id = m.organization_id
         where m.account_id = ${caller.accountId}
         order by (o.kind = 'personal') desc, o.created_at, o.slug`;
      return { items: rows.map(orgView) };
    });
  },

  async createOrganization(ctx) {
    const caller = ctx.caller!;
    const { slug, name } = ctx.body;
    // Personal organizations are named u-<account id>; a team may never take one (it would block that sign-up).
    if (/^u-[0-9a-f]{32}$/.test(slug)) throw new ApiFailure("VALIDATION_FAILED", "slugs of the form u-<32 hex> are reserved");
    return inTransaction(ctx.deps.sql, asAccount(caller), async (tx) => {
      const [owned] = await tx<{ n: number }[]>`
        select count(*)::int as n from wos.memberships m join wos.organizations o on o.id = m.organization_id
         where m.account_id = ${caller.accountId} and m.role = 'owner' and o.kind = 'team'`;
      if (owned!.n >= MAX_OWNED_TEAM_ORGS)
        throw new ApiFailure("LIMIT_REACHED", `an account owns at most ${MAX_OWNED_TEAM_ORGS} team organizations`);
      let created: { id: string } | undefined;
      try {
        [created] = await tx.savepoint((sp) => sp<{ id: string }[]>`select wos.create_team_organization(${slug}, ${name}) as id`);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new ApiFailure("CONFLICT", `the slug ${slug} is taken`);
        throw err;
      }
      const [row] = await tx<OrgRow[]>`
        select o.id, o.slug, o.name, o.kind, o.created_at, m.role from wos.organizations o
          join wos.memberships m on m.organization_id = o.id and m.account_id = ${caller.accountId} where o.id = ${created!.id}`;
      await insertEvent(
        tx,
        {
          type: "organization.created",
          v: 1,
          visibility: "private",
          payload: { organizationId: row!.id, kind: "team", ownerAccountId: caller.accountId },
        },
        { aggregateKind: "organization", aggregateId: row!.id, actor: eventActor(caller), actorAccountId: caller.accountId },
      );
      return orgView(row!);
    });
  },

  async listOrgApps(ctx) {
    const caller = ctx.caller!;
    await roleIn(ctx.deps, caller, ctx.params.id);
    return inTransaction(ctx.deps.sql, asAccount(caller), (tx) => orgApps(ctx.deps, tx, ctx.params.id));
  },

  enableApp: (ctx) => changeEntitlement(ctx, "enable"),
  disableApp: (ctx) => changeEntitlement(ctx, "disable"),

  async issueEnvironmentToken(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const orgId = ctx.body.organizationId;
    const [env] = await inTransaction(
      deps.sql,
      ANON,
      (tx) => tx<{ id: string; kind: string }[]>`select id, kind from wos.environments where id = ${ctx.params.id}`,
    );
    if (!env) throw new ApiFailure("NOT_FOUND", "environment not found");
    const [m] = await inTransaction(
      deps.sql,
      asAccount(caller),
      (tx) =>
        tx<{ role: OrgRole }[]>`select role from wos.memberships where organization_id = ${orgId} and account_id = ${caller.accountId}`,
    );
    if (!m) throw new ApiFailure("FORBIDDEN", "you are not a member of this organization");
    const key = deps.appKeys?.envToken;
    if (!key) {
      deps.log("error", "issueEnvironmentToken: WOS_ENV_TOKEN_KEY is not configured");
      throw new ApiFailure("INTERNAL", "environment tokens are not available");
    }
    const apps = await inTransaction(deps.sql, asAccount(caller), async (tx) => {
      const registry = registryMap(await currentReleases(tx));
      return activeFor(deps, registry, await entitlementsOf(tx, orgId));
    });
    const iat = Math.floor(Date.now() / 1000);
    const claims: EnvironmentTokenClaims = {
      iss: deps.config.apiOrigin,
      aud: env.id,
      sub: caller.accountId,
      org: orgId,
      role: m.role,
      apps,
      iat,
      exp: iat + ENVIRONMENT_TOKEN_TTL_SECONDS,
    };
    const token = signEnvironmentToken(claims, key.kid, key.privateKey);
    return { token, expiresAt: new Date(claims.exp * 1000).toISOString(), claims };
  },

  async publishAppRelease(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const { manifest, desktopPackage, desktopPackageUrl, source } = ctx.body;
    const app = manifest.app.id;
    if (!RepoFullName.safeParse(source.repo).success) throw new ApiFailure("VALIDATION_FAILED", "source.repo must be owner/name");
    const bundleSha = await verifyDesktopRelease(ctx);
    return inTransaction(deps.sql, asMaintainer(caller), async (tx) => {
      const [reg] = await tx<
        { kind: string; billing: string }[]
      >`select kind, billing from wos.app_registry where app_id = ${app} for update`;
      if (reg && (reg.kind !== manifest.app.kind || reg.billing !== manifest.app.billing))
        throw new ApiFailure("VALIDATION_FAILED", `${app} is registered as ${reg.kind}/${reg.billing}; a release cannot change that`);
      if (!reg)
        await tx`insert into wos.app_registry (app_id, name, kind, billing) values (${app}, ${manifest.app.name}, ${manifest.app.kind}, ${manifest.app.billing})`;
      else await tx`update wos.app_registry set name = ${manifest.app.name} where app_id = ${app}`;
      const [newer] = await tx<{ version: string }[]>`
        select version from wos.app_releases where app_id = ${app}
           and string_to_array(version, '.')::int[] >= string_to_array(${manifest.app.version}, '.')::int[] limit 1`;
      if (newer) throw new ApiFailure("CONFLICT", `${app}@${newer.version} exists; versions only increase`);
      const surfaces = supportedSurfaces(manifest);
      try {
        await tx`
          insert into wos.app_releases (app_id, version, manifest, manifest_sha256, surfaces, desktop_package, desktop_package_url,
                                        desktop_bundle_sha256, source_repo, source_tag, source_commit)
          values (${app}, ${manifest.app.version}, ${tx.json(manifest as never)}, ${canonicalSha256(manifest)}, ${surfaces},
                  ${desktopPackage ? tx.json(desktopPackage as never) : null}, ${desktopPackageUrl}, ${bundleSha},
                  ${source.repo}, ${source.tag}, ${source.commit})`;
      } catch (err) {
        // A check constraint of wos.app_releases (0006, 0008, 0009) refused the row.
        if ((err as { code?: string }).code === "23514")
          throw new ApiFailure("VALIDATION_FAILED", "the registry refused this release", {
            constraint: (err as { constraint_name?: string }).constraint_name ?? null,
          });
        throw err;
      }
      await insertEvent(
        tx,
        { type: "app.release_published", v: 1, visibility: "public", payload: { app, version: manifest.app.version, surfaces } },
        { aggregateKind: "app", aggregateId: app, actor: "maintainer", actorAccountId: caller.accountId },
      );
      const r = await currentRelease(tx, app);
      if (!r) throw new ApiFailure("INTERNAL", "the release did not become current");
      return registryEntry(deps, r);
    });
  },

  async yankAppRelease(ctx) {
    const caller = ctx.caller!;
    const { app, version, reason } = ctx.body;
    return inTransaction(ctx.deps.sql, asMaintainer(caller), async (tx) => {
      const [r] = await tx<
        { state: "published" | "yanked" }[]
      >`select state from wos.app_releases where app_id = ${app} and version = ${version}`;
      if (!r) throw new ApiFailure("NOT_FOUND", `release ${app}@${version} not found`);
      const t = findTransition(AppReleaseMachine, r.state, "yank");
      if (!t) throw new ApiFailure("CONFLICT", `${app}@${version} is already ${r.state}`);
      const rows = await tx`
        update wos.app_releases set state = ${t.to}, yanked_at = now(), yank_reason = ${reason}, row_version = row_version + 1
         where app_id = ${app} and version = ${version} and state = ${r.state} returning app_id`;
      if (rows.length === 0) throw new ApiFailure("CONFLICT", "a concurrent change won; re-read and decide");
      await insertEvent(
        tx,
        { type: "app.release_yanked", v: 1, visibility: "public", payload: { app, version, reason } },
        { aggregateKind: "app", aggregateId: app, actor: "maintainer", actorAccountId: caller.accountId },
      );
      return { ok: true as const };
    });
  },
};

/**
 * The Build gate (D16, S-40): claims need Build enabled for an organization the caller belongs to. Throws 403
 * NOT_ENTITLED otherwise. Independent of Build's registry release: the entitlement exists and gates either way.
 */
export async function assertBuildEntitled(deps: HandlerCtx<"claimBuild">["deps"], caller: Caller): Promise<void> {
  const [row] = await inTransaction(
    deps.sql,
    asAccount(caller),
    (tx) => tx<{ ok: boolean }[]>`
      select exists (select 1 from wos.memberships m join wos.app_entitlements e on e.organization_id = m.organization_id
                      where m.account_id = ${caller.accountId} and e.app_id = ${BUILD_APP_ID} and e.state = 'enabled') as ok`,
  );
  if (!row?.ok)
    throw new ApiFailure(
      "NOT_ENTITLED",
      "Build is not enabled for any of your organizations. Enable it on your personal organization (wos apps enable build, or Apps in wOS Desktop), or ask an admin of your organization.",
    );
}

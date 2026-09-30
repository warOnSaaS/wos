/**
 * Wave 3a (WORKSTREAMS 12.1, 12.4): AppRoutes on a real migrated Postgres — the registry (publish with signature and
 * bundle re-verification, yank), organizations, EntitlementMachine with dependency checks and entitlement.changed,
 * environment tokens, application progress, TargetSummary.apps, and the Build gate (S-40).
 */
import { BUILD_APP_ID, ENVIRONMENT_TOKEN_TTL_SECONDS, WOS_CLOUD_ENVIRONMENT_ID } from "@waronsaas/contracts";
import { sha256Of, verifyEnvironmentToken } from "@waronsaas/contracts/canonical";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appKeysFromEnv, parseEd25519PrivateKey } from "../src/domain/app-keys.js";
import { manifest, personalOrg, publish, signedPackage, bundleBytes, DESKTOP_FILES, COMMIT } from "./support/apps.js";
import { type Account, createHarness, HAS_DB, type Harness, seedFeature } from "./support/harness.js";
import { generateKeyPairSync } from "node:crypto";

describe("environment-token and module keys from the environment", () => {
  it("reads PEM or seed keys, publishes only public halves, and never echoes a value in an error", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const seed = Buffer.alloc(32, 9).toString("base64");
    const mod = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
    const keys = appKeysFromEnv({
      WOS_ENV_TOKEN_KEY: pem.replace(/\n/g, "\\n"),
      WOS_ENV_TOKEN_KEY_NEXT: seed,
      WOS_MODULE_PUBLIC_KEYS: JSON.stringify({ "wos-module-2026": mod }),
    });
    expect(keys.envToken?.kid).toBe("wos-env-2026");
    expect(keys.envTokenNext?.kid).toBe("wos-env-2026-next");
    expect(keys.envTokenNext).not.toHaveProperty("privateKey");
    expect(keys.modulePublicKeys["wos-module-2026"]).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(appKeysFromEnv({})).toEqual({ envToken: null, envTokenNext: null, modulePublicKeys: {} });
    const secret = "c2VjcmV0LW5vdC1hLWtleQ==";
    expect(() => parseEd25519PrivateKey(secret, "WOS_ENV_TOKEN_KEY")).toThrow(/WOS_ENV_TOKEN_KEY/);
    try {
      appKeysFromEnv({ WOS_ENV_TOKEN_KEY: secret });
    } catch (err) {
      expect(String(err)).not.toContain(secret);
    }
    expect(() => appKeysFromEnv({ WOS_ENV_TOKEN_KEY: seed, WOS_ENV_TOKEN_KID: "bad" })).toThrow(/WOS_ENV_TOKEN_KID/);
  });
});

describe.skipIf(!HAS_DB)("AppRoutes", () => {
  let h: Harness;
  let maint: Account;
  let owner: Account;
  let member: Account;
  let outsider: Account;

  beforeAll(async () => {
    h = await createHarness();
    maint = await h.contributor("apps-maint", { maintainer: true });
    owner = await h.signIn("apps-owner@example.com");
    member = await h.signIn("apps-member@example.com");
    outsider = await h.signIn("apps-outsider@example.com");
  });
  afterAll(async () => {
    await h?.close();
  });

  it("lists nothing until a release is published; core and build are 404 until then", async () => {
    expect((await h.call("GET", "/v1/public/apps")).body).toEqual({ items: [] });
    expect((await h.call("GET", "/v1/public/apps/build")).status).toBe(404);
    expect((await h.call("GET", "/v1/public/apps/core")).status).toBe(404);
    const keys = await h.call("GET", "/v1/public/environment-keys");
    expect(keys.body.keys.map((k: { kid: string }) => k.kid)).toEqual(["wos-env-2026", "wos-env-2026-next"]);
  });

  it("publishes a module and a signed desktop app, re-verifying the package and its bundle", async () => {
    const contacts = await publish(h, maint.token, manifest("contacts", { kind: "module" }));
    expect(contacts.status, JSON.stringify(contacts.body)).toBe(200);
    expect(contacts.body).toMatchObject({ id: "contacts", kind: "module", currentVersion: "0.1.0" });

    const crmManifest = manifest("crm", {
      requires: [{ id: "contacts", version: "^0.1.0" }],
      features: ["contacts"],
      replaces: ["salesforce"],
      desktop: true,
    });
    const crm = await publish(h, maint.token, crmManifest);
    expect(crm.status, JSON.stringify(crm.body)).toBe(200);
    const url = crm.body.surfaces.desktop.package.url;
    expect(crm.body.surfaces.desktop).toMatchObject({
      available: true,
      version: "0.1.0",
      package: { sha256: sha256Of(h.bundles.get(url)!), keyId: "wos-module-2026" },
    });
    expect(crm.body.surfaces.ios).toEqual({ available: false, version: null });
    const [ev] = await h.owner<{ payload: unknown; visibility: string }[]>`
      select payload, visibility from wos.events where type = 'app.release_published' and aggregate_id = 'crm'`;
    expect(ev).toEqual({ visibility: "public", payload: { app: "crm", version: "0.1.0", surfaces: ["web", "desktop", "api"] } });

    const list = await h.call("GET", "/v1/public/apps");
    expect(list.body.items.map((a: { id: string }) => a.id)).toEqual(["contacts", "crm"]);
    const release = await h.call("GET", "/v1/public/apps/crm/releases/0.1.0");
    expect(release.body).toMatchObject({ app: "crm", version: "0.1.0", state: "published", yankedAt: null, desktopPackage: { url } });
    expect((await h.call("GET", "/v1/public/apps/crm/releases/9.9.9")).status).toBe(404);
  });

  it("refuses a forged signature, a tampered bundle, a missing package and a version that is not newer", async () => {
    const m = manifest("chat", { desktop: true });
    const other = generateKeyPairSync("ed25519").privateKey;
    const forged = signedPackage(m, other, h.keys.moduleKeyId, DESKTOP_FILES);
    const url = "https://github.com/waronsaas/wos/releases/download/modules/chat@0.1.0/bundle.json";
    h.bundles.set(url, bundleBytes(forged, DESKTOP_FILES));
    const source = { repo: "waronsaas/product", tag: "chat@0.1.0", commit: COMMIT };
    const bad = await h.call("POST", "/v1/admin/app-releases", {
      token: maint.token,
      idem: true,
      body: { manifest: m, desktopPackage: forged, desktopPackageUrl: url, source },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.reasons).toContain("signature: invalid");

    const good = signedPackage(m, h.keys.modulePrivate, h.keys.moduleKeyId, DESKTOP_FILES);
    h.bundles.set(url, bundleBytes(good, { ...DESKTOP_FILES, "app.js": "export const crm = 2;\n" }));
    const tampered = await h.call("POST", "/v1/admin/app-releases", {
      token: maint.token,
      idem: true,
      body: { manifest: m, desktopPackage: good, desktopPackageUrl: url, source },
    });
    expect(tampered.status).toBe(400);
    expect(tampered.body.error.details.reasons).toEqual(["bundle: app.js: bytes do not match the package hash"]);

    const missing = await h.call("POST", "/v1/admin/app-releases", {
      token: maint.token,
      idem: true,
      body: { manifest: m, desktopPackage: null, desktopPackageUrl: null, source },
    });
    expect(missing.status).toBe(400);

    const again = await publish(h, maint.token, manifest("contacts", { kind: "module" }));
    expect(again.status).toBe(409);
    expect((await h.call("GET", "/v1/public/apps/chat")).status).toBe(404);
  });

  it("organizations: personal first, team creation, reserved and taken slugs", async () => {
    const mine = await h.call("GET", "/v1/orgs", { token: owner.token });
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ kind: "personal", role: "owner" });
    const team = await h.call("POST", "/v1/orgs", { token: owner.token, idem: true, body: { name: "Acme Sales", slug: "acme-sales" } });
    expect(team.status, JSON.stringify(team.body)).toBe(200);
    expect(team.body).toMatchObject({ kind: "team", role: "owner", slug: "acme-sales" });
    const again = await h.call("POST", "/v1/orgs", { token: outsider.token, idem: true, body: { name: "Other", slug: "acme-sales" } });
    expect(again.status).toBe(409);
    const reserved = await h.call("POST", "/v1/orgs", {
      token: outsider.token,
      idem: true,
      body: { name: "X", slug: `u-${"0".repeat(32)}` },
    });
    expect(reserved.status).toBe(400);
    const after = await h.call("GET", "/v1/orgs", { token: owner.token });
    expect(after.body.items.map((o: { kind: string }) => o.kind)).toEqual(["personal", "team"]);
    const [ev] = await h.owner<
      { n: number }[]
    >`select count(*)::int as n from wos.events where type = 'organization.created' and aggregate_id = ${team.body.id}`;
    expect(ev!.n).toBe(1);
    // a member (not admin) of the team
    await h.owner`insert into wos.memberships (organization_id, account_id, role) values (${team.body.id}, ${member.id}, 'member')`;
  });

  it("enables and disables through the EntitlementMachine with optimistic concurrency and dependency checks", async () => {
    const team = (await h.owner<{ id: string }[]>`select id from wos.organizations where slug = 'acme-sales'`)[0]!.id;
    const before = await h.call("GET", `/v1/orgs/${team}/apps`, { token: member.token });
    expect(before.status).toBe(200);
    expect(before.body.yourApps.map((a: { app: { id: string } }) => a.app.id)).toEqual([]);
    expect(before.body.availableApps.map((a: { app: { id: string } }) => a.app.id)).toEqual(["crm"]);
    expect(before.body.availableApps[0].entitlement).toEqual({
      organizationId: team,
      app: "crm",
      state: "available",
      changedAt: null,
      rowVersion: 0,
    });

    expect((await h.call("GET", `/v1/orgs/${team}/apps`, { token: outsider.token })).status).toBe(403);
    expect((await h.call("GET", "/v1/orgs/0192f000-0000-7000-8000-0000000000ff/apps", { token: owner.token })).status).toBe(404);
    const byMember = await h.call("POST", `/v1/orgs/${team}/apps/crm/enable`, {
      token: member.token,
      idem: true,
      body: { expectedRowVersion: null },
    });
    expect(byMember.status).toBe(403);
    expect(
      (
        await h.call("POST", `/v1/orgs/${team}/apps/contacts/enable`, {
          token: owner.token,
          idem: true,
          body: { expectedRowVersion: null },
        })
      ).status,
    ).toBe(400);

    const stale = await h.call("POST", `/v1/orgs/${team}/apps/crm/enable`, {
      token: owner.token,
      idem: true,
      body: { expectedRowVersion: 3 },
    });
    expect(stale.status).toBe(409);
    const enabled = await h.call("POST", `/v1/orgs/${team}/apps/crm/enable`, {
      token: owner.token,
      idem: true,
      body: { expectedRowVersion: null },
    });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    expect(enabled.body.entitlement).toMatchObject({ app: "crm", state: "enabled", rowVersion: 0 });
    const twice = await h.call("POST", `/v1/orgs/${team}/apps/crm/enable`, {
      token: owner.token,
      idem: true,
      body: { expectedRowVersion: 0 },
    });
    expect(twice.status).toBe(409);

    const after = await h.call("GET", `/v1/orgs/${team}/apps`, { token: member.token });
    expect(after.body.yourApps.map((a: { app: { id: string } }) => a.app.id)).toEqual(["crm", "contacts"]);
    expect(after.body.availableApps).toEqual([]);

    // an app requiring crm (an app, not a module) needs crm enabled; crm cannot be disabled while it is
    expect((await publish(h, maint.token, manifest("reports", { requires: [{ id: "crm", version: ">=0.1.0" }] }))).status).toBe(200);
    const personal = (await h.owner<{ id: string }[]>`select id from wos.organizations where personal_account_id = ${owner.id}`)[0]!.id;
    const dep = await h.call("POST", `/v1/orgs/${personal}/apps/reports/enable`, {
      token: owner.token,
      idem: true,
      body: { expectedRowVersion: null },
    });
    expect(dep.status).toBe(409);
    expect(dep.body.error.code).toBe("DEPENDENCY_NOT_ENABLED");
    expect(dep.body.error.details.missing).toEqual(["crm is not enabled"]);
    expect(
      (await h.call("POST", `/v1/orgs/${team}/apps/reports/enable`, { token: owner.token, idem: true, body: { expectedRowVersion: null } }))
        .status,
    ).toBe(200);
    const blocked = await h.call("POST", `/v1/orgs/${team}/apps/crm/disable`, {
      token: owner.token,
      idem: true,
      body: { expectedRowVersion: 0 },
    });
    expect(blocked.body.error.code).toBe("DEPENDENT_ENABLED");
    expect(
      (await h.call("POST", `/v1/orgs/${team}/apps/reports/disable`, { token: owner.token, idem: true, body: { expectedRowVersion: 0 } }))
        .status,
    ).toBe(200);
    const disabled = await h.call("POST", `/v1/orgs/${team}/apps/crm/disable`, {
      token: owner.token,
      idem: true,
      body: { expectedRowVersion: 0 },
    });
    expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);
    expect(disabled.body.entitlement).toMatchObject({ state: "disabled", rowVersion: 1 });
    const reenabled = await h.call("POST", `/v1/orgs/${team}/apps/crm/enable`, {
      token: owner.token,
      idem: true,
      body: { expectedRowVersion: 1 },
    });
    expect(reenabled.body.entitlement).toMatchObject({ state: "enabled", rowVersion: 2 });

    const events = await h.owner<{ payload: { app: string; from: string; to: string }; visibility: string; actor_kind: string }[]>`
      select payload, visibility, actor_kind from wos.events where type = 'entitlement.changed' and payload->>'organizationId' = ${team} order by id`;
    expect(events.map((e) => `${e.payload.app}:${e.payload.from}->${e.payload.to}`)).toEqual([
      "crm:available->enabled",
      "reports:available->enabled",
      "reports:enabled->disabled",
      "crm:enabled->disabled",
      "crm:disabled->enabled",
    ]);
    expect(new Set(events.map((e) => e.visibility))).toEqual(new Set(["private"]));
  });

  it("parallel enables of one app: exactly one wins, the rest answer 409 CONFLICT", async () => {
    const team = await h.call("POST", "/v1/orgs", { token: outsider.token, idem: true, body: { name: "Race Team", slug: "race-team" } });
    expect(team.status).toBe(200);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        h.call("POST", `/v1/orgs/${team.body.id}/apps/crm/enable`, {
          token: outsider.token,
          idem: true,
          body: { expectedRowVersion: null },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409, 409, 409]);
    const [n] = await h.owner<{ n: number }[]>`
      select count(*)::int as n from wos.events where type = 'entitlement.changed' and payload->>'organizationId' = ${team.body.id}`;
    expect(n!.n).toBe(1);
  });

  it("mints a 15-minute EdDSA environment token with the org's active apps, verifiable with the published keys", async () => {
    const team = (await h.owner<{ id: string }[]>`select id from wos.organizations where slug = 'acme-sales'`)[0]!.id;
    const res = await h.call("POST", `/v1/environments/${WOS_CLOUD_ENVIRONMENT_ID}/token`, {
      token: member.token,
      body: { organizationId: team },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.claims).toMatchObject({
      aud: WOS_CLOUD_ENVIRONMENT_ID,
      sub: member.id,
      org: team,
      role: "member",
      apps: ["contacts", "core", "crm"],
    });
    expect(res.body.claims.exp - res.body.claims.iat).toBe(ENVIRONMENT_TOKEN_TTL_SECONDS);
    const keys = (await h.call("GET", "/v1/public/environment-keys")).body.keys as Array<{ kid: string; publicKey: string }>;
    const v = verifyEnvironmentToken(res.body.token, Object.fromEntries(keys.map((k) => [k.kid, k.publicKey])), {
      environmentId: WOS_CLOUD_ENVIRONMENT_ID,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    expect(v).toEqual({ ok: true, claims: res.body.claims });
    expect((await h.call("POST", `/v1/environments/${team}/token`, { token: member.token, body: { organizationId: team } })).status).toBe(
      404,
    );
    expect(
      (
        await h.call("POST", `/v1/environments/${WOS_CLOUD_ENVIRONMENT_ID}/token`, {
          token: outsider.token,
          body: { organizationId: team },
        })
      ).status,
    ).toBe(403);
    // the personal org: Build is enabled but has no release yet, so only core is active there
    const personal = await personalOrg(h, outsider.token);
    const mine = await h.call("POST", `/v1/environments/${WOS_CLOUD_ENVIRONMENT_ID}/token`, {
      token: outsider.token,
      body: { organizationId: personal },
    });
    expect(mine.body.claims.apps).toEqual(["core"]);
  });

  it("application progress: release basis, default-branch basis, none, and 404 for unknown apps", async () => {
    const crm = await h.call("GET", "/v1/public/apps/crm/progress");
    expect(crm.status, JSON.stringify(crm.body)).toBe(200);
    expect(crm.body).toMatchObject({
      app: "crm",
      basis: "release",
      manifestVersion: "0.1.0",
      builtBp: 0,
      targets: ["salesforce", "hubspot"],
    });
    expect(crm.body.surfaces.map((s: { surface: string }) => s.surface)).toEqual(["api", "desktop", "web"]);
    expect(crm.body.features).toEqual([{ feature: "contacts", contractVersion: null, relevantPoints: 0, mergedPoints: 0 }]);

    const none = await h.call("GET", "/v1/public/apps/meet/progress");
    expect(none.body).toMatchObject({ basis: "none", manifestVersion: null, builtBp: 0, surfaces: [], features: [], targets: ["zoom"] });
    h.github.putFile(
      "waronsaas/product",
      h.github.headOf("waronsaas/product"),
      "applications/esign/wos-app.json",
      JSON.stringify(manifest("esign", { web: true })),
    );
    const branch = await h.call("GET", "/v1/public/apps/esign/progress");
    expect(branch.body).toMatchObject({ basis: "default_branch", manifestVersion: "0.1.0", targets: ["docusign"] });
    expect((await h.call("GET", "/v1/public/apps/nothing-here/progress")).status).toBe(404);
    // build is in the registry (0006) with no release and no manifest on the product branch
    expect((await h.call("GET", "/v1/public/apps/build/progress")).body).toMatchObject({ basis: "none", targets: ["waronsaas"] });
  });

  it("serves target_apps in TargetSummary and TargetDetail", async () => {
    const list = await h.call("GET", "/v1/public/targets");
    const bySlug = Object.fromEntries(list.body.items.map((t: { slug: string; apps: string[] }) => [t.slug, t.apps]));
    expect(bySlug.salesforce).toEqual(["crm"]);
    expect(bySlug.hubspot).toEqual(["crm", "helpdesk", "marketing"]);
    expect(bySlug.waronsaas).toEqual(["build", "core"]);
    expect((await h.call("GET", "/v1/public/targets/salesforce")).body.apps).toEqual(["crm"]);
  });

  it("yanks a release: state yanked, removed from the registry, one-way", async () => {
    const res = await h.call("POST", "/v1/admin/app-releases/yank", {
      token: maint.token,
      idem: true,
      body: { app: "reports", version: "0.1.0", reason: "broken report math" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await h.call("GET", "/v1/public/apps/reports/releases/0.1.0");
    expect(r.body).toMatchObject({ state: "yanked", yankReason: "broken report math" });
    expect(r.body.yankedAt).not.toBeNull();
    expect((await h.call("GET", "/v1/public/apps/reports")).status).toBe(404);
    const again = await h.call("POST", "/v1/admin/app-releases/yank", {
      token: maint.token,
      idem: true,
      body: { app: "reports", version: "0.1.0", reason: "again, twice" },
    });
    expect(again.status).toBe(409);
    expect(
      (
        await h.call("POST", "/v1/admin/app-releases/yank", {
          token: maint.token,
          idem: true,
          body: { app: "reports", version: "7.0.0", reason: "not there" },
        })
      ).status,
    ).toBe(404);
    const [ev] = await h.owner<
      { n: number }[]
    >`select count(*)::int as n from wos.events where type = 'app.release_yanked' and aggregate_id = 'reports'`;
    expect(ev!.n).toBe(1);
  });

  it("Build's release: no package, source waronsaas/wos (the database refuses it until B-0007-control-plane is ruled)", async () => {
    const { readFile } = await import("node:fs/promises");
    const build = JSON.parse(await readFile(new URL("../../../apps/desktop/src/apps/build/wos-app.json", import.meta.url), "utf8"));
    const wrongRepo = await h.call("POST", "/v1/admin/app-releases", {
      token: maint.token,
      idem: true,
      body: {
        manifest: build,
        desktopPackage: null,
        desktopPackageUrl: null,
        source: { repo: "waronsaas/product", tag: "build@0.1.0", commit: COMMIT },
      },
    });
    expect(wrongRepo.status).toBe(400);
    const res = await h.call("POST", "/v1/admin/app-releases", {
      token: maint.token,
      idem: true,
      body: {
        manifest: build,
        desktopPackage: null,
        desktopPackageUrl: null,
        source: { repo: "waronsaas/wos", tag: "build@0.1.0", commit: COMMIT },
      },
    });
    // Migration 0006 requires a desktop package whenever `desktop` is among a release's surfaces; Build has none (D16).
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.message).toBe("the registry refused this release");
    expect(h.violations).toEqual([]);
  });

  it("the Build gate: claims answer 403 NOT_ENTITLED while Build is not enabled for any of the caller's organizations", async () => {
    const c = await h.contributor("gate-contrib");
    await h.owner`update wos.app_entitlements e set state = 'disabled' from wos.organizations o
                   where o.id = e.organization_id and o.personal_account_id = ${c.id} and e.app_id = ${BUILD_APP_ID}`;
    const seeded = await seedFeature(h.owner, { feature: "gate-feature", abus: [{ n: "01", write: ["modules/gate/**"] }] });
    const build = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: c.token,
      idem: true,
      body: { deviceId: c.deviceId },
    });
    expect(build.status).toBe(403);
    expect(build.body.error.code).toBe("NOT_ENTITLED");
    const review = await h.call("POST", "/v1/reviews/claim", {
      token: c.token,
      idem: true,
      body: { deviceId: c.deviceId, slot: "astra", kinds: ["implementation_review"] },
    });
    expect(review.body.error.code).toBe("NOT_ENTITLED");
    const task = await h.call("POST", "/v1/tasks/0192f000-0000-7000-8000-0000000000aa/claim", {
      token: c.token,
      idem: true,
      body: { deviceId: c.deviceId },
    });
    expect(task.body.error.code).toBe("NOT_ENTITLED");
    // a team organization with Build enabled is enough
    const team = (await h.owner<{ id: string }[]>`select id from wos.organizations where slug = 'acme-sales'`)[0]!.id;
    await h.owner`insert into wos.memberships (organization_id, account_id, role) values (${team}, ${c.id}, 'member')`;
    await h.owner`insert into wos.app_entitlements (organization_id, app_id, state) values (${team}, ${BUILD_APP_ID}, 'enabled')`;
    const ok = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
      token: c.token,
      idem: true,
      body: { deviceId: c.deviceId },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(h.violations).toEqual([]);
  });
});

describe.skipIf(!HAS_DB)("the Build gate without the harness default", () => {
  it("a new account has no Build entitlement: claims are NOT_ENTITLED", async () => {
    const h = await createHarness({}, { buildForEveryAccount: false });
    try {
      const c = await h.contributor("fresh");
      const seeded = await seedFeature(h.owner, { abus: [{ n: "01", write: ["modules/contacts/a/**"] }] });
      const res = await h.call("POST", `/v1/abus/${seeded.abus.get("01")}/claim`, {
        token: c.token,
        idem: true,
        body: { deviceId: c.deviceId },
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("NOT_ENTITLED");
      const [n] = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.leases`;
      expect(n!.n).toBe(0);
    } finally {
      await h.close();
    }
  });
});

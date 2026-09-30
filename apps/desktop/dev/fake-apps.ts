/**
 * DEVELOPMENT AND TESTS ONLY: a fake of the one-product routes, so the shell runs its real code against them.
 *   - api.waronsaas.test: `listMyOrganizations`, `listOrgApps`, `enableApp` / `disableApp` (EntitlementMachine rules:
 *     owners and admins only, optimistic row version), `getAppRelease`, `issueEnvironmentToken` (a real EdDSA token
 *     signed with a throwaway key);
 *   - registry.waronsaas.test: module bundles signed with a throwaway module key (dev/module-fixtures.ts);
 *   - core.waronsaas.test: a wOS Cloud Core (descriptor, `ActiveApps` from the verified token's claims, the test
 *     module's API);
 *   - wos.selfhost.test: a self-hosted Core with its own `local` sign-in and `WOS_APPS=sample` (S-41).
 * The world: Build is enabled on the personal org (as for accounts from before migration 0006); the test module
 * "sample" is available, not enabled. Nothing here is shipped.
 */
import { createPublicKey } from "node:crypto";
import {
  type ActiveApps,
  type AppRegistryEntry,
  type AppReleaseView,
  BUILD_APP_ID,
  CORE_APP_ID,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  type EnvironmentDescriptor,
  type OrgAppView,
  type OrganizationView,
  WOS_CLOUD_ENVIRONMENT_ID,
  WosAppManifest,
} from "@waronsaas/contracts";
import {
  canonicalSha256,
  ed25519PrivateKeyFromSeed,
  encodeDevicePublicKey,
  signEnvironmentToken,
  verifyEnvironmentToken,
} from "@waronsaas/contracts/canonical";
import buildManifestJson from "../src/apps/build/wos-app.json" with { type: "json" };
import { type BuiltModule, buildModule, SAMPLE_APP, sampleFiles, sampleManifest, type TestKey, testKey } from "./module-fixtures.js";

export const FAKE_CORE = "https://core.waronsaas.test";
export const FAKE_SELF_HOSTED = "https://wos.selfhost.test";
export const FAKE_REGISTRY = "https://registry.waronsaas.test";
export const SELF_HOSTED_ENVIRONMENT_ID = "0192f000-0000-7000-8000-00000005e1f0";
export const PERSONAL_ORG = "0192f000-0000-7000-8000-0000000000a1";
export const TEAM_ORG = "0192f000-0000-7000-8000-0000000000b2";
export const SELF_HOSTED_CODE = "WXYZ-2345";
const SELF_HOSTED_ORG = "0192f000-0000-7000-8000-0000000000c3";
const ENV_KID = "wos-env-0000-test";

const CORE_MANIFEST = WosAppManifest.parse({
  protocol: "wos-app/v1",
  app: { id: CORE_APP_ID, name: "wOS Core", version: "0.1.0", kind: "core", billing: "base", summary: "wOS Core (fake environment)." },
  requires: { wos: ">=0.1.0", apps: [] },
  surfaces: {
    web: { supported: false },
    desktop: { supported: false },
    ios: { supported: false },
    android: { supported: false },
    api: { supported: false },
  },
  data: { schema: "core", migrations: null, owns: [] },
  events: { publishes: [], consumes: [] },
  routes: { ui: "/core", api: null },
  hosting: { selfHost: { supported: true, services: ["postgres"] }, hosted: { supported: true } },
});
const BUILD_MANIFEST = WosAppManifest.parse(buildManifestJson);

function json(status: number, data: unknown): Response {
  return new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
const err = (status: number, code: string, message: string) => json(status, { error: { code, message, requestId: "fake" } });

interface Entitlement {
  state: "available" | "enabled" | "disabled" | "suspended";
  rowVersion: number;
  changedAt: string | null;
}

export class FakeApps {
  readonly moduleKey: TestKey;
  readonly envKey = ed25519PrivateKeyFromSeed(new Uint8Array(32).fill(9));
  readonly envPublicKey = encodeDevicePublicKey(createPublicKey(this.envKey));
  /** Release views by app@version; bundles by URL. */
  readonly releases = new Map<string, AppReleaseView>();
  readonly bundles = new Map<string, Uint8Array>();
  /** The registry's current version per app. */
  readonly current = new Map<string, string>();
  readonly entitlements = new Map<string, Entitlement>();
  readonly orgs: OrganizationView[] = [
    {
      id: PERSONAL_ORG,
      slug: "dev-personal",
      name: "dev@example.com",
      kind: "personal",
      role: "owner",
      createdAt: "2026-09-29T12:00:00.000Z",
    },
    { id: TEAM_ORG, slug: "acme-team", name: "Acme (TEST)", kind: "team", role: "member", createdAt: "2026-09-29T12:00:00.000Z" },
  ];
  /** The self-hosted Core's operator configuration (WOS_APPS). */
  selfHostedApps = [SAMPLE_APP];
  /** The Core version both fake environments report. */
  coreVersion = "0.1.0";
  readonly calls: string[] = [];
  private readonly selfSessions = new Map<string, string>();
  private selfRequest: string | null = null;

  constructor(
    private readonly now: () => Date = () => new Date(),
    opts: { buildEnabled?: boolean; moduleKey?: TestKey } = {},
  ) {
    this.moduleKey = opts.moduleKey ?? testKey();
    this.publishBuild();
    this.publishSample("0.1.0");
    if (opts.buildEnabled ?? true)
      this.entitlements.set(`${PERSONAL_ORG}/${BUILD_APP_ID}`, { state: "enabled", rowVersion: 1, changedAt: "2026-09-29T12:00:00.000Z" });
  }

  private publishBuild() {
    const m = BUILD_MANIFEST;
    this.releases.set(`${BUILD_APP_ID}@${m.app.version}`, {
      app: BUILD_APP_ID,
      version: m.app.version,
      state: "published",
      manifest: m,
      manifestSha256: canonicalSha256(m),
      desktopPackage: null,
      source: { repo: "waronsaas/wos", tag: `v${m.app.version}`, commit: "0".repeat(40) },
      publishedAt: "2026-09-30T00:00:00.000Z",
      yankedAt: null,
      yankReason: null,
    });
    this.current.set(BUILD_APP_ID, m.app.version);
  }

  /** Publishes (or replaces, for tamper tests) a signed version of the test module. */
  publishSample(version: string, over: Partial<Parameters<typeof buildModule>[0]> = {}): BuiltModule {
    const url = `${FAKE_REGISTRY}/modules/${SAMPLE_APP}@${version}.json`;
    const built = buildModule({ manifest: sampleManifest(version), files: sampleFiles(version), key: this.moduleKey, url, ...over });
    this.releases.set(`${SAMPLE_APP}@${version}`, built.release);
    this.bundles.set(url, built.bytes);
    const cur = this.current.get(SAMPLE_APP);
    if (!cur || cur.localeCompare(version, undefined, { numeric: true }) < 0) this.current.set(SAMPLE_APP, version);
    return built;
  }

  yank(app: string, version: string, reason: string) {
    const r = this.releases.get(`${app}@${version}`);
    if (r) this.releases.set(`${app}@${version}`, { ...r, state: "yanked", yankedAt: this.now().toISOString(), yankReason: reason });
  }

  private entry(app: string): AppRegistryEntry | null {
    const version = this.current.get(app);
    const r = version ? this.releases.get(`${app}@${version}`) : undefined;
    if (!r) return null;
    const m = r.manifest;
    const av = (supported: boolean) => ({ available: supported, version: supported ? m.app.version : null });
    return {
      id: m.app.id,
      name: m.app.name,
      kind: m.app.kind,
      billing: m.app.billing,
      summary: m.app.summary,
      currentVersion: m.app.version,
      protocol: "wos-app/v1",
      capabilities: m.provides,
      dependencies: m.requires.apps,
      features: m.features,
      replaces: m.replaces,
      surfaces: {
        web: av(m.surfaces.web.supported),
        desktop: { ...av(m.surfaces.desktop.supported), package: r.desktopPackage },
        ios: av(m.surfaces.ios.supported),
        android: av(m.surfaces.android.supported),
        api: av(m.surfaces.api.supported),
      },
      selfHost: { compatible: m.hosting.selfHost.supported },
      hosted: { compatible: m.hosting.hosted.supported },
      publishedAt: r.publishedAt,
    };
  }

  private ent(org: string, app: string): Entitlement {
    return this.entitlements.get(`${org}/${app}`) ?? { state: "available", rowVersion: 0, changedAt: null };
  }

  private orgView(org: string, app: string): OrgAppView {
    const e = this.ent(org, app);
    return { app: this.entry(app)!, entitlement: { organizationId: org, app, ...e } };
  }

  enabledApps(org: string): string[] {
    return [...this.current.keys()].filter((a) => this.ent(org, a).state === "enabled");
  }

  private activeApps(environmentId: string, org: string, ids: string[], source: "entitlement" | "self_host_config"): ActiveApps {
    const apps: ActiveApps["apps"] = [{ id: CORE_APP_ID, version: CORE_MANIFEST.app.version, source: "core", manifest: CORE_MANIFEST }];
    for (const id of ids) {
      if (id === CORE_APP_ID) continue;
      const version = this.current.get(id);
      const r = version ? this.releases.get(`${id}@${version}`) : undefined;
      if (r) apps.push({ id, version: r.version, source, manifest: r.manifest });
    }
    return { environmentId, organizationId: org, apps };
  }

  /** Answers the requests this fake owns; null for anything else. */
  handle(url: URL, init: RequestInit | undefined): Response | null {
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const origin = url.origin;
    const p = url.pathname;
    const record = () => this.calls.push(`${method} ${origin}${p}`);

    if (origin === FAKE_REGISTRY) {
      record();
      const bytes = this.bundles.get(`${origin}${p}`);
      return bytes ? new Response(Buffer.from(bytes), { status: 200 }) : err(404, "NOT_FOUND", "no such package");
    }

    if (origin === FAKE_CORE) {
      record();
      if (p === "/.well-known/wos-environment") return json(200, this.descriptor("cloud"));
      const v = auth?.startsWith("Bearer ")
        ? verifyEnvironmentToken(
            auth.slice(7),
            { [ENV_KID]: this.envPublicKey },
            {
              environmentId: WOS_CLOUD_ENVIRONMENT_ID,
              nowSeconds: Math.floor(this.now().getTime() / 1000),
            },
          )
        : null;
      if (!v?.ok) return err(401, "UNAUTHENTICATED", "sign in to this environment");
      if (p === "/v1/core/apps") return json(200, this.activeApps(WOS_CLOUD_ENVIRONMENT_ID, v.claims.org, v.claims.apps, "entitlement"));
      if (p === "/apps/sample/ping" && v.claims.apps.includes(SAMPLE_APP)) return json(200, { ok: true, environment: "FAKE wOS CLOUD" });
      return err(404, "NOT_FOUND", `no route ${method} ${p}`);
    }

    if (origin === FAKE_SELF_HOSTED) {
      record();
      if (p === "/.well-known/wos-environment") return json(200, this.descriptor("self_hosted"));
      if (p === "/v1/core/auth/local/start" && method === "POST") {
        this.selfRequest = "0192f000-0000-7000-8000-00000000f00d";
        return json(202, { requestId: this.selfRequest, expiresAt: new Date(this.now().getTime() + 900_000).toISOString() });
      }
      if (p === "/v1/core/auth/local/redeem" && method === "POST") {
        if (body?.requestId !== this.selfRequest || body?.code !== SELF_HOSTED_CODE)
          return err(401, "UNAUTHENTICATED", "that code is not valid (it may be used, expired or mistyped)");
        this.selfRequest = null;
        const token = `self-hosted-session-${this.selfSessions.size + 1}-xxxxxxxxxxxx`;
        this.selfSessions.set(token, "owner");
        return json(200, {
          token,
          expiresAt: new Date(this.now().getTime() + 30 * 86_400_000).toISOString(),
          userId: "0192f000-0000-7000-8000-0000000000d4",
          organizationId: SELF_HOSTED_ORG,
          role: "owner",
        });
      }
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!this.selfSessions.has(token)) return err(401, "UNAUTHENTICATED", "sign in to this environment");
      if (p === "/v1/core/auth/logout" && method === "POST") {
        this.selfSessions.delete(token);
        return json(200, { ok: true });
      }
      if (p === "/v1/core/apps")
        return json(200, this.activeApps(SELF_HOSTED_ENVIRONMENT_ID, SELF_HOSTED_ORG, this.selfHostedApps, "self_host_config"));
      if (p === "/apps/sample/ping") return json(200, { ok: true, environment: "FAKE SELF-HOSTED" });
      return err(404, "NOT_FOUND", `no route ${method} ${p}`);
    }

    // api.waronsaas.test: the AppRoutes Desktop uses.
    const accountRoute = (): Response | null => (auth === "Bearer test-access" ? null : err(401, "UNAUTHENTICATED", "bad token"));
    if (p === "/v1/orgs" && method === "GET") {
      record();
      return accountRoute() ?? json(200, { items: this.orgs });
    }
    let m = /^\/v1\/orgs\/([^/]+)\/apps$/.exec(p);
    if (m && method === "GET") {
      record();
      const denied = accountRoute();
      if (denied) return denied;
      const org = decodeURIComponent(m[1]!);
      if (!this.orgs.some((o) => o.id === org)) return err(404, "NOT_FOUND", "no such organization");
      const apps = [...this.current.keys()].filter((a) => this.entry(a)?.kind === "app");
      return json(200, {
        organizationId: org,
        yourApps: apps.filter((a) => this.ent(org, a).state === "enabled").map((a) => this.orgView(org, a)),
        availableApps: apps.filter((a) => this.ent(org, a).state !== "enabled").map((a) => this.orgView(org, a)),
      });
    }
    m = /^\/v1\/orgs\/([^/]+)\/apps\/([^/]+)\/(enable|disable)$/.exec(p);
    if (m && method === "POST") {
      record();
      const denied = accountRoute();
      if (denied) return denied;
      const [org, app, action] = [decodeURIComponent(m[1]!), decodeURIComponent(m[2]!), m[3]!];
      const o = this.orgs.find((x) => x.id === org);
      if (!o) return err(404, "NOT_FOUND", "no such organization");
      if (this.entry(app)?.kind !== "app") return err(404, "NOT_FOUND", "no published release");
      if (o.role !== "owner" && o.role !== "admin") return err(403, "FORBIDDEN", "owners and admins only");
      const cur = this.ent(org, app);
      const expected = body?.expectedRowVersion ?? null;
      const have = this.entitlements.has(`${org}/${app}`) ? cur.rowVersion : null;
      if (expected !== have) return err(409, "CONFLICT", "the entitlement changed");
      const to = action === "enable" ? "enabled" : "disabled";
      if (cur.state === to) return json(200, this.orgView(org, app));
      this.entitlements.set(`${org}/${app}`, { state: to, rowVersion: cur.rowVersion + 1, changedAt: this.now().toISOString() });
      return json(200, this.orgView(org, app));
    }
    m = /^\/v1\/public\/apps\/([^/]+)\/releases\/([^/]+)$/.exec(p);
    if (m && method === "GET") {
      record();
      const r = this.releases.get(`${decodeURIComponent(m[1]!)}@${decodeURIComponent(m[2]!)}`);
      return r ? json(200, r) : err(404, "NOT_FOUND", "no such release");
    }
    m = /^\/v1\/environments\/([^/]+)\/token$/.exec(p);
    if (m && method === "POST") {
      record();
      const denied = accountRoute();
      if (denied) return denied;
      if (decodeURIComponent(m[1]!) !== WOS_CLOUD_ENVIRONMENT_ID) return err(404, "NOT_FOUND", "no such environment");
      const org = String(body?.organizationId ?? "");
      const o = this.orgs.find((x) => x.id === org);
      if (!o) return err(403, "FORBIDDEN", "not a member");
      const iat = Math.floor(this.now().getTime() / 1000);
      const claims = {
        iss: "https://api.waronsaas.test",
        aud: WOS_CLOUD_ENVIRONMENT_ID,
        sub: "0192ab3c-0000-7000-8000-00000000aaaa",
        org,
        role: o.role,
        apps: [CORE_APP_ID, ...this.enabledApps(org)].sort(),
        iat,
        exp: iat + ENVIRONMENT_TOKEN_TTL_SECONDS,
      };
      return json(200, {
        token: signEnvironmentToken(claims, ENV_KID, this.envKey),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        claims,
      });
    }
    return null;
  }

  descriptor(kind: "cloud" | "self_hosted"): EnvironmentDescriptor {
    return kind === "cloud"
      ? {
          schema: "wos-environment.v1",
          environmentId: WOS_CLOUD_ENVIRONMENT_ID,
          name: "wOS Cloud (FAKE)",
          kind: "cloud",
          protocol: "wos-app/v1",
          coreVersion: this.coreVersion,
          apiBase: FAKE_CORE,
          auth: { kind: "wos_cloud", issuer: "https://api.waronsaas.test" },
        }
      : {
          schema: "wos-environment.v1",
          environmentId: SELF_HOSTED_ENVIRONMENT_ID,
          name: "Self-hosted wOS (FAKE)",
          kind: "self_hosted",
          protocol: "wos-app/v1",
          coreVersion: this.coreVersion,
          apiBase: FAKE_SELF_HOSTED,
          auth: { kind: "local" },
        };
  }
}

/**
 * A fake of the four AppRoutes the CLI calls, over a fake `fetch`. It follows the control plane's handlers
 * (services/control-plane/src/handlers/apps.ts): apps without a published release are absent from OrgApps and
 * enableApp answers 404 "app <id> has no published release"; owner/admin only; optimistic concurrency on the
 * entitlement row with `details.current`; DEPENDENCY_NOT_ENABLED with `details.missing`; DEPENDENT_ENABLED with
 * `details.dependents`. Every response is parsed with the frozen AppRoutes response schema before it is sent.
 */
import { readFileSync } from "node:fs";
import {
  type AppEntitlement,
  type AppRegistryEntry,
  AppRoutes,
  type AppRouteName,
  type OrgAppView,
  type OrganizationView,
  Routes,
} from "@waronsaas/contracts";

export const ACCESS = "test-access";
const AT = "2026-09-29T12:00:00.000Z";

/** Build's real manifest (apps/desktop/src/apps/build/wos-app.json), so the fixture says what Build says. */
const BUILD = JSON.parse(readFileSync(new URL("../../desktop/src/apps/build/wos-app.json", import.meta.url), "utf8")) as {
  app: { id: string; name: string; version: string; kind: "app"; billing: "free"; summary: string };
};

export function entry(
  id: string,
  o: { name: string; kind?: "core" | "app" | "module"; version?: string; summary?: string; deps?: string[]; hosted?: boolean },
): AppRegistryEntry {
  const off = { available: false, version: null };
  return {
    id,
    name: o.name,
    kind: o.kind ?? "app",
    billing: "free",
    summary: o.summary ?? `${o.name} (test fixture)`,
    currentVersion: o.version ?? "0.1.0",
    protocol: "wos-app/v1",
    capabilities: [],
    dependencies: (o.deps ?? []).map((d) => ({ id: d, version: ">=0.1.0" })),
    features: [],
    replaces: [],
    surfaces: { web: off, desktop: { ...off, package: null }, ios: off, android: off, api: off },
    selfHost: { compatible: true },
    hosted: { compatible: o.hosted ?? true },
    publishedAt: AT,
  };
}

export const buildEntry = () => entry(BUILD.app.id, { name: BUILD.app.name, version: BUILD.app.version, summary: BUILD.app.summary });

interface Row {
  state: AppEntitlement["state"];
  rowVersion: number;
  changedAt: string;
}

export const PERSONAL: OrganizationView = {
  id: "0192ab3c-0000-7000-8000-00000000a001",
  slug: "dev",
  name: "dev",
  kind: "personal",
  createdAt: AT,
  role: "owner",
};
export const TEAM: OrganizationView = {
  id: "0192ab3c-0000-7000-8000-00000000a002",
  slug: "acme",
  name: "Acme",
  kind: "team",
  createdAt: AT,
  role: "member",
};

export class FakeAppsServer {
  orgs: OrganizationView[] = [PERSONAL, TEAM];
  /** The registry: only apps with a current published release (0006 rows without a release are simply absent). */
  registry = new Map<string, AppRegistryEntry>([["core", entry("core", { name: "Core", kind: "core" })]]);
  /** (orgId/app) -> entitlement row; no row = available. */
  rows = new Map<string, Row>();
  readonly calls: Array<{ route: string; idempotencyKey: string | null; body: unknown }> = [];
  refreshes = 0;
  /** Runs once before the next enable/disable handler: another admin acting in between the read and the write. */
  interleave: (() => void) | null = null;

  setState(orgId: string, app: string, state: Row["state"], rowVersion = 1) {
    this.rows.set(`${orgId}/${app}`, { state, rowVersion, changedAt: AT });
  }

  private view(orgId: string, app: string): AppEntitlement {
    const r = this.rows.get(`${orgId}/${app}`);
    return r
      ? { organizationId: orgId, app, state: r.state, changedAt: r.changedAt, rowVersion: r.rowVersion }
      : { organizationId: orgId, app, state: "available", changedAt: null, rowVersion: 0 };
  }

  private orgApps(orgId: string) {
    const kindOrder = { core: 0, app: 1, module: 2 };
    const sorted = [...this.registry.values()].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id));
    const yourApps: OrgAppView[] = [];
    const availableApps: OrgAppView[] = [];
    for (const app of sorted) {
      const ent = this.view(orgId, app.id);
      if (app.kind !== "app") yourApps.push({ app, entitlement: { ...ent, state: "enabled" } });
      else if (ent.state === "enabled") yourApps.push({ app, entitlement: ent });
      else if (app.hosted.compatible) availableApps.push({ app, entitlement: ent });
    }
    return { organizationId: orgId, yourApps, availableApps };
  }

  private change(params: Record<string, string>, body: { expectedRowVersion: number | null }, event: "enable" | "disable") {
    const org = this.orgs.find((g) => g.id === params.id);
    if (!org) throw new Fail(404, "NOT_FOUND", "organization not found");
    if (org.role !== "owner" && org.role !== "admin")
      throw new Fail(403, "FORBIDDEN", "only an owner or admin of the organization changes its apps");
    this.interleave?.();
    this.interleave = null;
    const app = params.app!;
    const release = this.registry.get(app);
    if (!release) throw new Fail(404, "NOT_FOUND", `app ${app} has no published release`);
    if (release.kind !== "app")
      throw new Fail(400, "VALIDATION_FAILED", `${app} is a ${release.kind}; only applications are enabled or disabled`);
    const row = this.rows.get(`${org.id}/${app}`);
    const expected = body.expectedRowVersion;
    if ((row === undefined) !== (expected === null) || (row && row.rowVersion !== expected))
      throw new Fail(409, "CONFLICT", "the entitlement changed since you read it; re-read and decide", { current: this.view(org.id, app) });
    const from = row?.state ?? "available";
    const to = event === "enable" ? "enabled" : "disabled";
    const allowed = event === "enable" ? from === "available" || from === "disabled" : from === "enabled";
    if (!allowed) throw new Fail(409, "CONFLICT", `${app} is ${from}; it cannot ${event}`, { current: this.view(org.id, app) });
    if (event === "enable") {
      const missing = release.dependencies
        .filter((d) => d.id !== "core")
        .flatMap((d) =>
          !this.registry.has(d.id)
            ? [`${d.id} is not in the registry`]
            : this.view(org.id, d.id).state !== "enabled"
              ? [`${d.id} is not enabled`]
              : [],
        );
      if (missing.length)
        throw new Fail(409, "DEPENDENCY_NOT_ENABLED", `enable what ${app} requires first: ${missing.join("; ")}`, { missing });
    } else {
      const dependents = [...this.registry.values()]
        .filter((o) => o.id !== app && o.kind === "app" && this.view(org.id, o.id).state === "enabled")
        .filter((o) => o.dependencies.some((d) => d.id === app))
        .map((o) => o.id)
        .sort();
      if (dependents.length)
        throw new Fail(409, "DEPENDENT_ENABLED", `disable the apps that require ${app} first: ${dependents.join(", ")}`, { dependents });
    }
    this.rows.set(`${org.id}/${app}`, { state: to, rowVersion: (row?.rowVersion ?? 0) + 1, changedAt: AT });
    return { app: release, entitlement: this.view(org.id, app) };
  }

  private handle(name: AppRouteName, params: Record<string, string>, body: unknown): unknown {
    switch (name) {
      case "listMyOrganizations":
        return { items: this.orgs };
      case "listOrgApps": {
        const org = this.orgs.find((g) => g.id === params.id);
        if (!org) throw new Fail(404, "NOT_FOUND", "organization not found");
        return this.orgApps(org.id);
      }
      case "enableApp":
        return this.change(params, body as never, "enable");
      case "disableApp":
        return this.change(params, body as never, "disable");
      default:
        throw new Fail(500, "INTERNAL", `the fake does not serve ${name}`);
    }
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method === "POST" && url.pathname === Routes.refreshSession.path) {
      this.refreshes += 1;
      if (body?.refreshToken !== "test-refresh") return json(401, err("UNAUTHENTICATED", "refresh token expired"));
      return json(200, {
        accessToken: ACCESS,
        accessExpiresAt: "2026-09-29T13:00:00Z",
        refreshToken: "test-refresh-2",
        refreshExpiresAt: "2026-10-29T12:00:00Z",
      });
    }
    for (const [name, r] of Object.entries(AppRoutes) as Array<[AppRouteName, (typeof AppRoutes)[AppRouteName]]>) {
      if (r.method !== method) continue;
      const names: string[] = [];
      const re = new RegExp(`^${r.path.replace(/:([A-Za-z]+)/g, (_m, n: string) => (names.push(n), "([^/]+)"))}$`);
      const m = re.exec(url.pathname);
      if (!m) continue;
      if (r.auth !== "public" && headers.get("authorization") !== `Bearer ${ACCESS}`) return json(401, err("UNAUTHENTICATED", "bad token"));
      if (r.idempotent && !headers.get("idempotency-key")) return json(400, err("VALIDATION_FAILED", "Idempotency-Key required"));
      this.calls.push({ route: name, idempotencyKey: headers.get("idempotency-key"), body });
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
      try {
        return json(200, (r.response as { parse(v: unknown): unknown }).parse(this.handle(name, params, body)));
      } catch (e) {
        if (e instanceof Fail) return json(e.status, err(e.code, e.message, e.details));
        throw e;
      }
    }
    return json(404, err("NOT_FOUND", `no route ${method} ${url.pathname}`));
  };
}

class Fail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const err = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details === undefined ? {} : { details }), requestId: "req-test" },
});

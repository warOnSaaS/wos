/**
 * The shell's client for api.waronsaas.com routes the frozen `Orchestrator` interface does not cover (WORKSTREAMS 12.4
 * desktop row): the account (`getMe`), organizations, Your Apps / Available Apps, enable/disable, the registry release
 * lookup and environment tokens. Authenticated calls use the orchestrator's own session through its exported
 * `SessionReader`, whose refresh is a single flight shared with the orchestrator (a second refresher would revoke the
 * session family, S-4). Runs in main only; responses are parsed with the route's own schema. Error bodies keep their
 * `details` so the shell can explain DEPENDENCY_NOT_ENABLED, DEPENDENT_ENABLED and CONFLICT.
 */
import { ApiError, AppRoutes, type AppRouteName, type RouteName, Routes } from "@waronsaas/contracts";
import { idempotencyKey, type SessionReader } from "@waronsaas/orchestrator";
import type { z } from "zod";

type AnyRoute = (typeof Routes)[RouteName] | (typeof AppRoutes)[AppRouteName];
type AppRes<N extends AppRouteName> = z.infer<(typeof AppRoutes)[N]["response"]>;

export type OrgApps = AppRes<"listOrgApps">;
export type OrgAppView = AppRes<"enableApp">;
export type OrganizationView = AppRes<"listMyOrganizations">["items"][number];
export type AppReleaseView = AppRes<"getAppRelease">;
export type EnvironmentTokenResponse = AppRes<"issueEnvironmentToken">;
export type MeView = z.infer<(typeof Routes)["getMe"]["response"]>;

export class PlatformApiError extends Error {
  constructor(
    readonly route: string,
    readonly status: number,
    readonly code: string,
    readonly serverMessage: string,
    readonly details: unknown,
  ) {
    super(serverMessage);
    this.name = "PlatformApiError";
  }
}

export interface PlatformApi {
  me(): Promise<MeView | null>;
  listMyOrganizations(): Promise<OrganizationView[]>;
  listOrgApps(orgId: string): Promise<OrgApps>;
  enableApp(orgId: string, app: string, expectedRowVersion: number | null): Promise<OrgAppView>;
  disableApp(orgId: string, app: string, expectedRowVersion: number | null): Promise<OrgAppView>;
  getAppRelease(app: string, version: string): Promise<AppReleaseView>;
  issueEnvironmentToken(environmentId: string, organizationId: string): Promise<EnvironmentTokenResponse>;
  /** Downloads a module bundle (the registry's package URL). Bytes only; trust comes from the installer's checks. */
  download(url: string): Promise<Uint8Array>;
}

export interface PlatformApiOptions {
  baseUrl: string;
  fetch: typeof fetch;
  session: SessionReader;
  clientVersion: string;
  /** Upper bound on a module bundle download. */
  maxDownloadBytes?: number;
}

const MAX_BUNDLE = 64 * 1024 * 1024;

export function createPlatformApi(opts: PlatformApiOptions): PlatformApi {
  const request = async (
    name: string,
    def: AnyRoute,
    input: { params?: Record<string, string>; body?: unknown; idempotencyKey?: string },
  ) => {
    const path = def.path.replace(/:([A-Za-z]+)/g, (_m, n: string) => {
      const v = input.params?.[n];
      if (v === undefined) throw new Error(`missing path parameter ${n}`);
      return encodeURIComponent(v);
    });
    const headers: Record<string, string> = { accept: "application/json", "x-wos-client": `desktop/${opts.clientVersion}` };
    if (def.auth !== "public") {
      const token = await opts.session.accessToken();
      if (!token) throw new PlatformApiError(name, 401, "UNAUTHENTICATED", "not signed in to the wOS account", undefined);
      headers.authorization = `Bearer ${token}`;
    }
    if (def.idempotent) headers["idempotency-key"] = input.idempotencyKey ?? crypto.randomUUID();
    let body: string | undefined;
    if (def.method !== "GET" && input.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    let res: Response;
    try {
      res = await opts.fetch(new URL(path, opts.baseUrl).toString(), { method: def.method, headers, body });
    } catch (e) {
      throw new PlatformApiError(
        name,
        0,
        "NETWORK",
        `the control plane is unreachable (${e instanceof Error ? e.message : String(e)})`,
        undefined,
      );
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new PlatformApiError(name, res.status, "INTERNAL", `non-JSON response (HTTP ${res.status})`, undefined);
    }
    if (!res.ok) {
      const e = ApiError.safeParse(json);
      if (e.success) throw new PlatformApiError(name, res.status, e.data.error.code, e.data.error.message, e.data.error.details);
      throw new PlatformApiError(name, res.status, "INTERNAL", `HTTP ${res.status}`, undefined);
    }
    const parsed = (def.response as z.ZodType).safeParse(json);
    if (!parsed.success)
      throw new PlatformApiError(name, res.status, "INTERNAL", `${name}: the response does not match the contract`, undefined);
    return parsed.data;
  };

  const app = <N extends AppRouteName>(name: N, input: { params?: Record<string, string>; body?: unknown; idempotencyKey?: string } = {}) =>
    request(name, AppRoutes[name], input) as Promise<AppRes<N>>;

  const change = (name: "enableApp" | "disableApp") => (orgId: string, appId: string, expectedRowVersion: number | null) =>
    app(name, {
      params: { id: orgId, app: appId },
      body: { expectedRowVersion },
      // Deterministic: a retried request for the same decision replays instead of acting twice (the CLI's rule).
      idempotencyKey: idempotencyKey("desktop", name, orgId, appId, String(expectedRowVersion)),
    });

  return {
    async me() {
      if (!(await opts.session.accessToken())) return null;
      try {
        return (await request("getMe", Routes.getMe, {})) as MeView;
      } catch (e) {
        if (e instanceof PlatformApiError && e.code === "UNAUTHENTICATED") return null;
        throw e;
      }
    },
    listMyOrganizations: async () => (await app("listMyOrganizations")).items,
    listOrgApps: (orgId) => app("listOrgApps", { params: { id: orgId } }),
    enableApp: change("enableApp"),
    disableApp: change("disableApp"),
    getAppRelease: (appId, version) => app("getAppRelease", { params: { app: appId, version } }),
    issueEnvironmentToken: (environmentId, organizationId) =>
      app("issueEnvironmentToken", { params: { id: environmentId }, body: { organizationId } }),
    async download(url) {
      const u = new URL(url);
      if (u.protocol !== "https:" || u.username || u.password)
        throw new PlatformApiError("download", 0, "VALIDATION_FAILED", "module packages are downloaded over https only", undefined);
      let res: Response;
      try {
        res = await opts.fetch(u.toString(), { method: "GET", headers: { "x-wos-client": `desktop/${opts.clientVersion}` } });
      } catch (e) {
        throw new PlatformApiError(
          "download",
          0,
          "NETWORK",
          `the package is unreachable (${e instanceof Error ? e.message : String(e)})`,
          undefined,
        );
      }
      if (!res.ok)
        throw new PlatformApiError("download", res.status, "NOT_FOUND", `the package download answered HTTP ${res.status}`, undefined);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > (opts.maxDownloadBytes ?? MAX_BUNDLE))
        throw new PlatformApiError(
          "download",
          res.status,
          "VALIDATION_FAILED",
          "the package is larger than wOS Desktop accepts",
          undefined,
        );
      return bytes;
    },
  };
}

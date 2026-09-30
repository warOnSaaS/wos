/**
 * Build's CLI surface over `AppRoutes` (contracts 5.2.0, WORKSTREAMS 12.4): organizations and app entitlements on
 * api.waronsaas.com. The frozen `Orchestrator` interface covers the build pipeline only, so these four routes are
 * called here directly, with the same session the orchestrator keeps in the same SecretStore.
 *
 * Only `listMyOrganizations`, `listOrgApps`, `enableApp` and `disableApp` are used. Error bodies keep their `details`
 * (the `missing` requirements, the `dependents`, the `current` entitlement) so the CLI can explain them.
 */
import { AppRoutes, type AppRouteName, ApiError, Routes } from "@waronsaas/contracts";
import { idempotencyKey, type SecretStore } from "@waronsaas/orchestrator";
import type { z } from "zod";

/**
 * The orchestrator's session entry (packages/orchestrator/src/session.ts SESSION_KEY, not exported from the package).
 * test/apps.test.ts asserts the two are equal, so a rename there fails here.
 */
export const SESSION_KEY = "wos.session.v1";

interface StoredSession {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  deviceId: string;
}

type Def<N extends AppRouteName> = (typeof AppRoutes)[N];
type Res<N extends AppRouteName> = z.infer<Def<N>["response"]>;
type OrgApps = Res<"listOrgApps">;
type OrgAppView = Res<"enableApp">;
type OrganizationView = Res<"listMyOrganizations">["items"][number];

export class AppsCallError extends Error {
  constructor(
    readonly route: string,
    readonly status: number,
    readonly code: string,
    readonly serverMessage: string,
    readonly details: unknown,
  ) {
    super(`${route}: ${code}: ${serverMessage}`);
    this.name = "AppsCallError";
  }
}

export interface AppsApi {
  listMyOrganizations(): Promise<OrganizationView[]>;
  listOrgApps(orgId: string): Promise<OrgApps>;
  enableApp(orgId: string, app: string, expectedRowVersion: number | null): Promise<OrgAppView>;
  disableApp(orgId: string, app: string, expectedRowVersion: number | null): Promise<OrgAppView>;
}

export interface AppsApiOptions {
  baseUrl: string;
  fetch: typeof fetch;
  secrets: SecretStore;
  clientVersion: string;
  now?: () => Date;
}

export function createAppsApi(opts: AppsApiOptions): AppsApi {
  const now = opts.now ?? (() => new Date());

  const request = async (
    route: string,
    def: { method: string; path: string; auth: string; idempotent: boolean; response: z.ZodType },
    input: { params?: Record<string, string>; body?: unknown; idempotencyKey?: string; token?: string | null },
  ): Promise<unknown> => {
    const path = def.path.replace(/:([A-Za-z]+)/g, (_m, n: string) => encodeURIComponent(input.params?.[n] ?? ""));
    const headers: Record<string, string> = { accept: "application/json", "x-wos-client": `cli/${opts.clientVersion}` };
    if (def.auth !== "public") {
      if (!input.token) throw new AppsCallError(route, 401, "UNAUTHENTICATED", "not signed in (wos login)", undefined);
      headers.authorization = `Bearer ${input.token}`;
    }
    if (def.idempotent) headers["idempotency-key"] = input.idempotencyKey!;
    let body: string | undefined;
    if (def.method !== "GET" && input.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    const res = await opts.fetch(new URL(path, opts.baseUrl), { method: def.method, headers, body });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new AppsCallError(route, res.status, "INTERNAL", `non-JSON response (HTTP ${res.status})`, undefined);
    }
    if (!res.ok) {
      const e = ApiError.safeParse(json);
      if (e.success) throw new AppsCallError(route, res.status, e.data.error.code, e.data.error.message, e.data.error.details);
      throw new AppsCallError(route, res.status, "INTERNAL", `HTTP ${res.status}`, undefined);
    }
    const parsed = def.response.safeParse(json);
    if (!parsed.success)
      throw new AppsCallError(route, res.status, "INTERNAL", `response does not match the contract: ${parsed.error.message}`, undefined);
    return parsed.data;
  };

  /** Same rule as the orchestrator: refresh a minute before expiry, signed out once the refresh token expired. */
  const accessToken = async (): Promise<string | null> => {
    const raw = await opts.secrets.get(SESSION_KEY);
    if (!raw) return null;
    let s: StoredSession;
    try {
      s = JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
    const t = now().getTime();
    if (Date.parse(s.accessExpiresAt) - 60_000 > t) return s.accessToken;
    if (Date.parse(s.refreshExpiresAt) <= t) return null;
    const r = (await request("refreshSession", Routes.refreshSession, { body: { refreshToken: s.refreshToken } })) as z.infer<
      typeof Routes.refreshSession.response
    >;
    const next: StoredSession = { ...s, ...r };
    await opts.secrets.set(SESSION_KEY, JSON.stringify(next));
    return next.accessToken;
  };

  const call = async <N extends AppRouteName>(
    name: N,
    input: { params?: Record<string, string>; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<Res<N>> => (await request(name, AppRoutes[name], { ...input, token: await accessToken() })) as Res<N>;

  const change = (name: "enableApp" | "disableApp") => (orgId: string, app: string, expectedRowVersion: number | null) =>
    call(name, {
      params: { id: orgId, app },
      body: { expectedRowVersion },
      // Deterministic: a retried request for the same decision replays instead of acting twice.
      idempotencyKey: idempotencyKey("cli", name, orgId, app, String(expectedRowVersion)),
    });

  return {
    listMyOrganizations: async () => (await call("listMyOrganizations")).items,
    listOrgApps: (orgId) => call("listOrgApps", { params: { id: orgId } }),
    enableApp: change("enableApp"),
    disableApp: change("disableApp"),
  };
}

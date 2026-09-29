/**
 * Public, read-only routes (targets, features, contributors). Per orchestrator.ts these "stay direct
 * fetches of public routes"; everything authenticated goes through the orchestrator. Runs in main only
 * (the renderer has no network: CSP connect-src 'none'). Responses are parsed with the route's own
 * response schema, so the screens only ever see real API shapes.
 */
import { type RouteName, type RouteParams, type RouteQuery, type RouteResponse, Routes } from "@waronsaas/contracts";

type PublicRoute = "listTargets" | "getTarget" | "getFeature" | "getContributor" | "getContributorLedger";

export class PublicApiError extends Error {
  constructor(
    readonly route: RouteName,
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

export interface PublicApi {
  get<N extends PublicRoute>(name: N, input?: { params?: RouteParams<N>; query?: RouteQuery<N> }): Promise<RouteResponse<N>>;
}

export function createPublicApi(fetchImpl: typeof fetch, baseUrl: string, clientVersion: string): PublicApi {
  return {
    async get(name, input = {}) {
      const route = Routes[name];
      if (route.auth !== "public" || route.method !== "GET") throw new Error(`${name} is not a public GET route`);
      const params = (input.params ?? {}) as Record<string, string>;
      const path = route.path.replace(/:([A-Za-z]+)/g, (_m, key: string) => {
        const v = params[key];
        if (v === undefined) throw new Error(`missing path parameter ${key}`);
        return encodeURIComponent(v);
      });
      const url = new URL(path, baseUrl);
      for (const [k, v] of Object.entries((input.query ?? {}) as Record<string, unknown>)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), {
          method: "GET",
          headers: { accept: "application/json", "x-wos-client": `desktop/${clientVersion}` },
        });
      } catch (e) {
        throw new PublicApiError(name, 0, "NETWORK", `the control plane is unreachable (${e instanceof Error ? e.message : String(e)})`);
      }
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        throw new PublicApiError(name, res.status, "INTERNAL", "the control plane answered with something that is not JSON");
      }
      if (!res.ok) {
        const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
        throw new PublicApiError(
          name,
          res.status,
          typeof err?.code === "string" ? err.code : "INTERNAL",
          typeof err?.message === "string" ? err.message : `HTTP ${res.status}`,
        );
      }
      const parsed = route.response.safeParse(body);
      if (!parsed.success) throw new PublicApiError(name, res.status, "INTERNAL", `${name}: the response does not match the contract`);
      return parsed.data as RouteResponse<typeof name>;
    },
  };
}

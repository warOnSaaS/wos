/** Typed client over the frozen route map. The only way the orchestrator talks to the control plane. */
import { randomUUID } from "node:crypto";
import {
  ApiError,
  type RouteBody,
  type RouteName,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
  Routes,
} from "@waronsaas/contracts";
import type { ApiClient } from "./index.js";

export class ApiCallError extends Error {
  constructor(
    readonly route: RouteName,
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${route}: ${code}: ${message}`);
    this.name = "ApiCallError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch: typeof fetch;
  /** Returns the current wOS access token, or null when signed out. */
  accessToken: () => Promise<string | null>;
  clientKind: "desktop" | "cli";
  clientVersion: string;
}

function fillPath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const v = params?.[name];
    if (v === undefined || v === null) throw new Error(`missing path parameter ${name}`);
    return encodeURIComponent(String(v));
  });
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  return {
    async call<N extends RouteName>(
      name: N,
      input: { params?: RouteParams<N>; query?: RouteQuery<N>; body?: RouteBody<N>; idempotencyKey?: string },
    ): Promise<RouteResponse<N>> {
      const route = Routes[name];
      const url = new URL(fillPath(route.path, input.params as Record<string, unknown> | undefined), opts.baseUrl);
      if (input.query) {
        for (const [k, v] of Object.entries(input.query as Record<string, unknown>))
          if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
      const headers: Record<string, string> = {
        accept: "application/json",
        "x-wos-client": `${opts.clientKind}/${opts.clientVersion}`,
      };
      if (route.auth !== "public") {
        const token = await opts.accessToken();
        if (!token) throw new ApiCallError(name, 401, "UNAUTHENTICATED", "not signed in (wos login)");
        headers.authorization = `Bearer ${token}`;
      }
      if (route.idempotent) headers["idempotency-key"] = input.idempotencyKey ?? randomUUID();
      let body: string | undefined;
      if (route.method !== "GET" && input.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(input.body);
      }
      const res = await opts.fetch(url, { method: route.method, headers, body });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new ApiCallError(name, res.status, "INTERNAL", `non-JSON response (${res.status})`);
      }
      if (!res.ok) {
        const err = ApiError.safeParse(json);
        if (err.success) throw new ApiCallError(name, res.status, err.data.error.code, err.data.error.message);
        throw new ApiCallError(name, res.status, "INTERNAL", `HTTP ${res.status}`);
      }
      const parsed = route.response.safeParse(json);
      if (!parsed.success)
        throw new ApiCallError(name, res.status, "INTERNAL", `response does not match the contract: ${parsed.error.message}`);
      return parsed.data as RouteResponse<N>;
    },
  };
}

/** wOS Web's calls to its environment (wOS Core): the descriptor, ActiveApps, local sign-in and app APIs. */
import { ActiveApps, CoreRoutes, EnvironmentDescriptor } from "../../../modules/core-contracts/src/index.js";
import type { Fetch } from "../../../modules/core/src/env-token.js";

export type HttpResult = { status: number; body: unknown };

export class CoreClient {
  private descriptorCache: { at: number; value: EnvironmentDescriptor } | null = null;
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: Fetch,
    private readonly nowMs: () => number,
  ) {}

  private async call(method: string, path: string, bearer: string | null, body?: unknown): Promise<HttpResult> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchFn(new URL(path, this.baseUrl).toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  /** The environment descriptor, cached for 60 s (it changes only on a Core deploy). */
  async descriptor(): Promise<EnvironmentDescriptor> {
    if (this.descriptorCache && this.nowMs() - this.descriptorCache.at < 60_000) return this.descriptorCache.value;
    const r = await this.call("GET", CoreRoutes.environment.path, null);
    if (r.status !== 200) throw new Error(`environment descriptor: HTTP ${r.status}`);
    const value = EnvironmentDescriptor.parse(r.body);
    this.descriptorCache = { at: this.nowMs(), value };
    return value;
  }

  /** ActiveApps, or null when the session is not accepted (401). */
  async activeApps(bearer: string): Promise<ActiveApps | null> {
    const r = await this.call("GET", CoreRoutes.activeApps.path, bearer);
    if (r.status === 401) return null;
    if (r.status !== 200) throw new Error(`active apps: HTTP ${r.status}`);
    return ActiveApps.parse(r.body);
  }

  startLocalSignIn(email: string) {
    return this.call("POST", "/v1/core/auth/local/start", null, { email });
  }
  redeemLocalSignIn(requestId: string, code: string) {
    return this.call("POST", "/v1/core/auth/local/redeem", null, { requestId, code });
  }
  logoutLocal(bearer: string) {
    return this.call("POST", "/v1/core/auth/logout", bearer);
  }
  /** GET an app API path (the caller has already checked it is under that app's own prefix). */
  getApp(path: string, bearer: string) {
    return this.call("GET", path, bearer);
  }
}

/**
 * wOS Web's server-side calls to the control plane (api.waronsaas.com) on wOS Cloud: account sign-in, organizations,
 * Your Apps / Available Apps, enable and disable, and environment tokens. The browser talks only to wOS Web; tokens
 * stay in wOS Web's sealed cookie. The control plane treats this as a `web` client, whose tokens arrive as
 * Set-Cookie headers, which this client reads server-side.
 */
import { AppRoutes, OrgApps, OrgAppView, type OrganizationView, Routes } from "../../../modules/core-contracts/src/index.js";
import type { Fetch } from "../../../modules/core/src/env-token.js";

export type Tokens = { access: string; accessExp: string; refresh: string; refreshExp: string };
export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const cookieValue = (res: Response, name: string): string | null => {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair!.indexOf("=");
    if (pair!.slice(0, i).trim() === name) return decodeURIComponent(pair!.slice(i + 1).trim());
  }
  return null;
};

export class CloudClient {
  constructor(
    private readonly issuer: string,
    private readonly fetchFn: Fetch,
  ) {}

  private async call(
    method: string,
    path: string,
    opts: { bearer?: string; body?: unknown } = {},
  ): Promise<{ res: Response; body: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchFn(new URL(path, this.issuer).toString(), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new CloudError(res.status, e?.code ?? "INTERNAL", e?.message ?? `HTTP ${res.status}`);
    }
    return { res, body };
  }

  private tokensFrom(res: Response, body: unknown): Tokens {
    const b = body as { accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string };
    const access = b.accessToken || cookieValue(res, "wos_session");
    const refresh = b.refreshToken || cookieValue(res, "wos_refresh");
    if (!access || !refresh) throw new CloudError(502, "INTERNAL", "the control plane returned no session");
    return { access, accessExp: b.accessExpiresAt, refresh, refreshExp: b.refreshExpiresAt };
  }

  async startSignIn(email: string): Promise<{ requestId: string; pollSecret: string | null }> {
    const { res, body } = await this.call(Routes.startEmailSignIn.method, Routes.startEmailSignIn.path, {
      body: { email, clientKind: "web", deviceName: null, devicePublicKey: null },
    });
    const b = body as { requestId: string; pollSecret: string | null };
    return { requestId: b.requestId, pollSecret: b.pollSecret ?? cookieValue(res, "wos_signin") };
  }

  async redeemSignIn(requestId: string, pollSecret: string | null, code: string): Promise<Tokens> {
    const { res, body } = await this.call(Routes.redeemEmailSignIn.method, Routes.redeemEmailSignIn.path, {
      body: { requestId, pollSecret, linkToken: null, code },
    });
    return this.tokensFrom(res, body);
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const { res, body } = await this.call(Routes.refreshSession.method, Routes.refreshSession.path, { body: { refreshToken } });
    return this.tokensFrom(res, body);
  }

  async logout(access: string): Promise<void> {
    await this.call(Routes.logout.method, Routes.logout.path, { bearer: access }).catch(() => undefined);
  }

  async organizations(access: string): Promise<OrganizationView[]> {
    const { body } = await this.call(AppRoutes.listMyOrganizations.method, AppRoutes.listMyOrganizations.path, { bearer: access });
    return AppRoutes.listMyOrganizations.response.parse(body).items;
  }

  async orgApps(access: string, orgId: string): Promise<OrgApps> {
    const { body } = await this.call("GET", AppRoutes.listOrgApps.path.replace(":id", orgId), { bearer: access });
    return OrgApps.parse(body);
  }

  async setApp(
    access: string,
    orgId: string,
    app: string,
    action: "enable" | "disable",
    expectedRowVersion: number | null,
  ): Promise<OrgAppView> {
    const route = action === "enable" ? AppRoutes.enableApp : AppRoutes.disableApp;
    const { body } = await this.call(route.method, route.path.replace(":id", orgId).replace(":app", app), {
      bearer: access,
      body: { expectedRowVersion },
    });
    return OrgAppView.parse(body);
  }

  async environmentToken(access: string, environmentId: string, organizationId: string): Promise<{ token: string; expiresAt: string }> {
    const { body } = await this.call(
      AppRoutes.issueEnvironmentToken.method,
      AppRoutes.issueEnvironmentToken.path.replace(":id", environmentId),
      {
        bearer: access,
        body: { organizationId },
      },
    );
    const r = AppRoutes.issueEnvironmentToken.response.parse(body);
    return { token: r.token, expiresAt: r.expiresAt };
  }
}

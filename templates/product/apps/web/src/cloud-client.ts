/**
 * wOS Web's server-side calls to the control plane (api.waronsaas.com) on wOS Cloud: account sign-in, organizations,
 * Your Apps / Available Apps, enable and disable, and environment tokens. wOS Web signs in as the server-side client
 * `web_app` (SECURITY S-43, contracts 5.6.0): the pollSecret and the session tokens come in response BODIES,
 * server to server, and wOS Web keeps them in its own sealed, HttpOnly, host-only cookie. It never reads Set-Cookie
 * from the control plane, and the browser never talks to the control plane.
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

/** Exactly one of them: the typed code, or the link token from the emailed link (WEB_APP_SIGNIN_CODE_PATH). */
export type SignInProof = { code: string; linkToken?: never } | { linkToken: string; code?: never };

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

  /** Session tokens from a web_app body; an empty token means the control plane treated us as a cookie client. */
  private tokensFrom(b: { accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string }): Tokens {
    if (!b.accessToken || !b.refreshToken) throw new CloudError(502, "INTERNAL", "the control plane returned no session in the body");
    return { access: b.accessToken, accessExp: b.accessExpiresAt, refresh: b.refreshToken, refreshExp: b.refreshExpiresAt };
  }

  async startSignIn(email: string): Promise<{ requestId: string; pollSecret: string }> {
    const { body } = await this.call(Routes.startEmailSignIn.method, Routes.startEmailSignIn.path, {
      body: { email, clientKind: "web_app", deviceName: null, devicePublicKey: null },
    });
    const b = Routes.startEmailSignIn.response.parse(body);
    if (!b.pollSecret) throw new CloudError(502, "INTERNAL", "the control plane returned no pollSecret for web_app");
    return { requestId: b.requestId, pollSecret: b.pollSecret };
  }

  async redeemSignIn(requestId: string, pollSecret: string, proof: SignInProof): Promise<Tokens> {
    const { body } = await this.call(Routes.redeemEmailSignIn.method, Routes.redeemEmailSignIn.path, {
      body: { requestId, pollSecret, linkToken: proof.linkToken ?? null, code: proof.code ?? null },
    });
    return this.tokensFrom(Routes.redeemEmailSignIn.response.parse(body));
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const { body } = await this.call(Routes.refreshSession.method, Routes.refreshSession.path, { body: { refreshToken } });
    return this.tokensFrom(Routes.refreshSession.response.parse(body));
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

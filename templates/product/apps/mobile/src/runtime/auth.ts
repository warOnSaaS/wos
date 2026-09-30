/**
 * Sign-in, per environment (WOS-APP-PROTOCOL section 8).
 *
 * - `local` (a self-hosted Core): the Core's own email code, `CoreRoutes.localSignInStart` / `localSignInRedeem` /
 *   `logout` (contracts 5.6.0). The redeemed token is the Bearer on that Core. Fully built.
 * - `wos_cloud`: the wOS account at the control plane (D8 email code), then `AppRoutes.issueEnvironmentToken` for the
 *   environment. The control plane has no client kind for a phone: `startEmailSignIn.clientKind` is web, desktop, cli
 *   or web_app, and none of them fits (see blockers/B-0001-mobile-runtime.md). Until the architect rules, starting a
 *   wOS Cloud sign-in stops here and says why; redeem, refresh, organizations and environment tokens are built and
 *   tested, so the ruling only has to fill in `MOBILE_CLOUD_CLIENT_KIND`.
 */
import { AppRoutes, CoreRoutes, LocalSignInRedeemResponse, LocalSignInStartResponse, OrganizationView, Routes } from "../contracts.js";
import { callParsed, type HttpFetch, joinUrl } from "./http.js";
import type { CloudSession, LocalSession } from "./storage.js";

// ---------------------------------------------------------------------------------------------------------------
// local (self-hosted Core)
// ---------------------------------------------------------------------------------------------------------------

/** "abcd efgh", "ABCD-EFGH", "abcdefgh" -> "ABCD-EFGH"; null when it cannot be a code. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export async function startLocalSignIn(fetch: HttpFetch, apiBase: string, email: string) {
  return callParsed(
    fetch,
    { method: "POST", url: joinUrl(apiBase, CoreRoutes.localSignInStart.path), body: { email: email.trim() } },
    LocalSignInStartResponse,
  );
}

export async function redeemLocalSignIn(fetch: HttpFetch, apiBase: string, requestId: string, code: string): Promise<LocalSession> {
  const r = await callParsed(
    fetch,
    { method: "POST", url: joinUrl(apiBase, CoreRoutes.localSignInRedeem.path), body: { requestId, code } },
    LocalSignInRedeemResponse,
  );
  return { kind: "local", token: r.token, expiresAt: r.expiresAt, userId: r.userId, organizationId: r.organizationId, role: r.role };
}

/** Ends a local session on its Core, or does nothing (answers ok) for an environment token. */
export async function coreLogout(fetch: HttpFetch, apiBase: string, bearer: string): Promise<void> {
  await callParsed(fetch, { method: "POST", url: joinUrl(apiBase, CoreRoutes.logout.path), bearer }, CoreRoutes.logout.response);
}

// ---------------------------------------------------------------------------------------------------------------
// wos_cloud (the wOS account at the control plane)
// ---------------------------------------------------------------------------------------------------------------

type ClientKind = "web" | "desktop" | "cli" | "web_app";

/**
 * The `startEmailSignIn.clientKind` wOS Mobile signs in as. null: the contract has none for a phone
 * (blockers/B-0001-mobile-runtime.md). Borrowing `desktop` or `cli` would register the phone as a device that holds
 * an Ed25519 key in an OS keychain, which it does not; borrowing `web_app` would email a link to app.waronsaas.com
 * that only a browser holding the sealed poll secret can redeem.
 */
export const MOBILE_CLOUD_CLIENT_KIND: ClientKind | null = null;
export const CLOUD_SIGNIN_BLOCKER = "B-0001-mobile-runtime";

export type CloudStart =
  | { ok: true; requestId: string; pollSecret: string; expiresAt: string }
  | { ok: false; blocker: string; message: string };

export async function startCloudSignIn(
  fetch: HttpFetch,
  issuer: string,
  email: string,
  clientKind: ClientKind | null = MOBILE_CLOUD_CLIENT_KIND,
): Promise<CloudStart> {
  if (clientKind === null)
    return {
      ok: false,
      blocker: CLOUD_SIGNIN_BLOCKER,
      message:
        "wOS Cloud sign-in on wOS Mobile is waiting for the platform to add a mobile sign-in client (blocker B-0001-mobile-runtime). Self-hosted environments work now.",
    };
  const r = await callParsed(
    fetch,
    {
      method: "POST",
      url: joinUrl(issuer, Routes.startEmailSignIn.path),
      body: { email: email.trim(), clientKind, deviceName: "wOS Mobile", devicePublicKey: null },
    },
    Routes.startEmailSignIn.response,
  );
  if (r.pollSecret === null) throw new Error("the control plane kept the poll secret in a cookie; wOS Mobile needs it in the body");
  return { ok: true, requestId: r.requestId, pollSecret: r.pollSecret, expiresAt: r.expiresAt };
}

/** Redeems the typed code with the poll secret this phone holds (S-2). */
export async function redeemCloudSignIn(
  fetch: HttpFetch,
  issuer: string,
  input: { requestId: string; pollSecret: string; code: string },
): Promise<CloudSession> {
  const r = await callParsed(
    fetch,
    {
      method: "POST",
      url: joinUrl(issuer, Routes.redeemEmailSignIn.path),
      body: { requestId: input.requestId, pollSecret: input.pollSecret, linkToken: null, code: input.code },
    },
    Routes.redeemEmailSignIn.response,
  );
  return {
    kind: "wos_cloud",
    issuer,
    accessToken: r.accessToken,
    accessExpiresAt: r.accessExpiresAt,
    refreshToken: r.refreshToken,
    refreshExpiresAt: r.refreshExpiresAt,
    organizationId: null,
  };
}

/** Rotating refresh (S-4): the old refresh token is dead after this call, so the result must be stored at once. */
export async function refreshCloudSession(fetch: HttpFetch, session: CloudSession): Promise<CloudSession> {
  const r = await callParsed(
    fetch,
    { method: "POST", url: joinUrl(session.issuer, Routes.refreshSession.path), body: { refreshToken: session.refreshToken } },
    Routes.refreshSession.response,
  );
  return {
    ...session,
    accessToken: r.accessToken,
    accessExpiresAt: r.accessExpiresAt,
    refreshToken: r.refreshToken,
    refreshExpiresAt: r.refreshExpiresAt,
  };
}

export async function listOrganizations(fetch: HttpFetch, session: CloudSession) {
  const r = await callParsed(
    fetch,
    { method: "GET", url: joinUrl(session.issuer, AppRoutes.listMyOrganizations.path), bearer: session.accessToken },
    AppRoutes.listMyOrganizations.response,
  );
  return r.items.map((o) => OrganizationView.parse(o));
}

export async function issueEnvironmentToken(fetch: HttpFetch, session: CloudSession, environmentId: string, organizationId: string) {
  return callParsed(
    fetch,
    {
      method: "POST",
      url: joinUrl(session.issuer, AppRoutes.issueEnvironmentToken.path.replace(":id", encodeURIComponent(environmentId))),
      bearer: session.accessToken,
      body: { organizationId },
    },
    AppRoutes.issueEnvironmentToken.response,
  );
}

export async function cloudLogout(fetch: HttpFetch, session: CloudSession): Promise<void> {
  await callParsed(
    fetch,
    { method: "POST", url: joinUrl(session.issuer, Routes.logout.path), bearer: session.accessToken },
    Routes.logout.response,
  );
}

/**
 * Environment selection and discovery (WOS-APP-PROTOCOL section 8). wOS Mobile talks to ONE environment at a time:
 * wOS Cloud (`HOSTS.core`) by default, or a self-hosted wOS Core the user points it at. Every environment describes
 * itself at `GET /.well-known/wos-environment`; sessions are stored per `environmentId` and never shared.
 */
import { CoreRoutes, EnvironmentDescriptor, type EnvironmentDescriptorT, HOSTS } from "../contracts.js";
import { callParsed, type HttpFetch, HttpError, joinUrl } from "./http.js";

/** wOS Cloud's hosted Core, the default environment. */
export const CLOUD_URL: string = HOSTS.core;

/** The only issuer of wOS accounts. A descriptor naming any other `wos_cloud` issuer is refused (see `checkDescriptor`). */
export const TRUSTED_CLOUD_ISSUERS: readonly string[] = [HOSTS.api];

export type Environment = {
  /** The URL the user chose (normalised), where the descriptor was read. */
  url: string;
  descriptor: EnvironmentDescriptorT;
};

const PRIVATE_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/;

/**
 * "wos.example.com" -> "https://wos.example.com". Plain http is accepted only for a Core on this machine or the local
 * network (a development Core in Docker); anything on the internet must be https.
 */
export function normalizeEnvironmentUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  let s = input.trim();
  if (s.length === 0) return { ok: false, reason: "enter the address of a wOS environment" };
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  const m = /^(https?):\/\/([^/?#\s:]+)(:\d{1,5})?(\/[^?#\s]*)?$/i.exec(s);
  if (!m) return { ok: false, reason: "that is not a web address" };
  const scheme = (m[1] ?? "").toLowerCase();
  const host = (m[2] ?? "").toLowerCase();
  if (scheme === "http" && !PRIVATE_HOST.test(host))
    return { ok: false, reason: "use https (plain http only for a Core on your own network)" };
  const path = (m[4] ?? "").replace(/\/+$/, "");
  return { ok: true, url: `${scheme}://${host}${m[3] ?? ""}${path}` };
}

/** Reads and checks `/.well-known/wos-environment` at `url`. */
export async function discoverEnvironment(
  fetch: HttpFetch,
  url: string,
  opts: { trustedCloudIssuers?: readonly string[] } = {},
): Promise<Environment> {
  const descriptor = await callParsed(fetch, { method: "GET", url: joinUrl(url, CoreRoutes.environment.path) }, EnvironmentDescriptor);
  const problem = checkDescriptor(descriptor, opts.trustedCloudIssuers ?? TRUSTED_CLOUD_ISSUERS);
  if (problem) throw new HttpError(200, "PROTOCOL", problem);
  return { url, descriptor };
}

/**
 * What wOS Mobile refuses in a descriptor that parses:
 * - an API base on plain http outside the local network (the session token would travel in the clear);
 * - `wos_cloud` sign-in at an issuer that is not the wOS account service: an environment could otherwise ask the phone
 *   to send a wOS account's session to a server of its choosing.
 */
export function checkDescriptor(d: EnvironmentDescriptorT, trustedCloudIssuers: readonly string[]): string | null {
  const api = normalizeEnvironmentUrl(d.apiBase);
  if (!api.ok) return `the environment's API address is not usable: ${api.reason}`;
  if (d.auth.kind === "wos_cloud" && !trustedCloudIssuers.includes(d.auth.issuer.replace(/\/+$/, "")))
    return `the environment asks for wOS account sign-in at ${d.auth.issuer}, which is not the wOS account service`;
  return null;
}

/** What the sign-in screen offers for an environment. */
export type SignInMethod = "wos_cloud" | "local" | "unsupported";
export function signInMethod(d: EnvironmentDescriptorT): SignInMethod {
  if (d.auth.kind === "wos_cloud") return "wos_cloud";
  if (d.auth.kind === "local") return "local";
  return "unsupported";
}

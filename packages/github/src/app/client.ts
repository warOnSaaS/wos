/**
 * Octokit construction for the wOS GitHub App. Internal to ./app.
 *
 * The frozen function signatures take only `AppCredentials` and a repo name, so the transport is
 * module configuration: production uses global fetch against api.github.com; tests and the Wave 2
 * fake end-to-end run call `configureGithubApp({ fetch })` with a fake GitHub.
 */
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { AppCredentials } from "./index.js";

export interface GithubAppTransport {
  fetch: typeof fetch;
  /** REST/GraphQL API base, default https://api.github.com */
  apiBaseUrl: string;
  /** OAuth host for device and web flows, default https://github.com */
  oauthBaseUrl: string;
}

const DEFAULT_TRANSPORT: GithubAppTransport = {
  fetch: (...args) => globalThis.fetch(...args),
  apiBaseUrl: "https://api.github.com",
  oauthBaseUrl: "https://github.com",
};

let transport: GithubAppTransport = DEFAULT_TRANSPORT;
const installationIds = new Map<string, number>();
const installationClients = new Map<string, Octokit>();

/** Overrides the transport (tests, fake end-to-end runs, a GitHub Enterprise sandbox). Clears caches. */
export function configureGithubApp(overrides: Partial<GithubAppTransport>): void {
  transport = { ...DEFAULT_TRANSPORT, ...overrides };
  installationIds.clear();
  installationClients.clear();
}

export function resetGithubAppConfig(): void {
  configureGithubApp({});
}

export function currentTransport(): GithubAppTransport {
  return transport;
}

/** Error type for every failure raised by ./app. `status` is the GitHub HTTP status when there was one. */
export class GithubAppError extends Error {
  constructor(
    readonly code: GithubAppErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "GithubAppError";
  }
}

export type GithubAppErrorCode =
  | "CHANGESET_REJECTED"
  | "INVALID_INPUT"
  | "REF_CONFLICT"
  | "HEAD_MISMATCH"
  | "NOT_INSTALLED"
  | "OAUTH_ERROR"
  | "GITHUB_ERROR";

export function splitRepo(repo: string): { owner: string; repo: string } {
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repo);
  if (!m) throw new GithubAppError("INVALID_INPUT", `not a repo full name: ${JSON.stringify(repo)}`);
  return { owner: m[1]!, repo: m[2]! };
}

function baseOptions() {
  return { baseUrl: transport.apiBaseUrl, request: { fetch: transport.fetch }, log: silentLog };
}

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/** Installation-authenticated client for the installation that covers `repo`. */
export async function installationClient(creds: AppCredentials, repo: string): Promise<Octokit> {
  const { owner, repo: name } = splitRepo(repo);
  const key = `${creds.appId}:${owner}/${name}`.toLowerCase();
  let installationId = installationIds.get(key);
  if (installationId === undefined) {
    const appClient = new Octokit({
      ...baseOptions(),
      authStrategy: createAppAuth,
      auth: { appId: creds.appId, privateKey: creds.privateKeyPem },
    });
    try {
      const res = await appClient.request("GET /repos/{owner}/{repo}/installation", { owner, repo: name });
      installationId = res.data.id;
    } catch (e) {
      if (statusOf(e) === 404) throw new GithubAppError("NOT_INSTALLED", `the wOS App is not installed on ${repo}`, 404);
      throw wrap(e, `installation lookup for ${repo}`);
    }
    installationIds.set(key, installationId);
  }
  const clientKey = `${creds.appId}:${installationId}`;
  let client = installationClients.get(clientKey);
  if (!client) {
    client = new Octokit({
      ...baseOptions(),
      authStrategy: createAppAuth,
      auth: { appId: creds.appId, privateKey: creds.privateKeyPem, installationId },
    });
    installationClients.set(clientKey, client);
  }
  return client;
}

export function statusOf(e: unknown): number | null {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return null;
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function wrap(e: unknown, what: string): GithubAppError {
  if (e instanceof GithubAppError) return e;
  return new GithubAppError("GITHUB_ERROR", `${what}: ${messageOf(e)}`, statusOf(e));
}

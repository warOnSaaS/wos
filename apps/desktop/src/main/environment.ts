/**
 * Settings -> Environment (WOS-APP-PROTOCOL section 8; WORKSTREAMS 12.4 desktop row).
 *
 * - Discovery: `GET <url>/.well-known/wos-environment` (`EnvironmentDescriptor`). Default wOS Cloud (HOSTS.core).
 * - Sessions are per environment and never cross: a sign-in to one environment never signs in to another.
 *   - `wos_cloud`: the wOS account (D8, the orchestrator's session) is exchanged for a 15-minute environment token
 *     (`issueEnvironmentToken`, audience = the environment id, one organization). Kept in memory only, refreshed a
 *     minute before expiry; every refresh re-reads `ActiveApps`.
 *   - `local`: a self-hosted Core's own email-code sign-in (`CoreRoutes.localSignInStart` / `localSignInRedeem` /
 *     `logout`, contracts 5.6.0). The session token is kept in the OS keychain under `wos.env.<environmentId>`.
 *   - `oidc`: not supported by this Desktop yet; said plainly.
 * - Where a bearer may go: a wOS Cloud environment token is sent ONLY to HOSTS.core (a descriptor elsewhere that claims
 *   `wos_cloud` is refused: it would receive a token for the real wOS Cloud); every environment's `apiBase` must be on
 *   the origin the user entered.
 * - Self-hosted activation is the operator's (S-41): Desktop never asks wOS Cloud what may run on a self-hosted Core.
 */
import {
  ActiveApps,
  CoreRoutes,
  EnvironmentDescriptor,
  LocalSignInRedeemBody,
  LocalSignInRedeemResponse,
  LocalSignInStartResponse,
  type OrgRole,
} from "@waronsaas/contracts";
import type { SecretStore } from "@waronsaas/orchestrator";
import type { EnvironmentView } from "../shared/ipc.js";
import type { PlatformApi } from "./platform-api.js";

export class EnvironmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EnvironmentError";
  }
}

interface LocalSession {
  token: string;
  expiresAt: string;
  userId: string;
  organizationId: string;
  role: OrgRole;
  email: string;
}

interface CloudToken {
  token: string;
  expiresAt: string;
  organizationId: string;
  role: OrgRole;
}

export interface EnvironmentDeps {
  fetch: typeof fetch;
  secrets: SecretStore;
  platform: Pick<PlatformApi, "issueEnvironmentToken">;
  /** wOS Cloud's Core (HOSTS.core; the development fake passes its own). */
  cloudCoreUrl: string;
  /** Where wOS Cloud tokens are issued (HOSTS.api); a `wos_cloud` descriptor must name it as issuer. */
  cloudIssuer: string;
  clientVersion: string;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface EnvironmentManager {
  url(): string;
  setUrl(url: string): void;
  view(): EnvironmentView;
  descriptor(): EnvironmentDescriptor | null;
  /** Fetches the descriptor again; records the problem instead of throwing. */
  discover(): Promise<void>;
  startLocalSignIn(email: string): Promise<void>;
  redeemLocalCode(code: string): Promise<void>;
  signOut(): Promise<void>;
  /** The wOS account signed out: drop every cloud token. */
  forgetCloudTokens(): void;
  /** ActiveApps for the organization (cloud) or the local session (self-hosted). Throws EnvironmentError. */
  activeApps(organizationId: string | null): Promise<ActiveApps>;
  /** The org role of the environment session (permission filtering of navigation). */
  role(): OrgRole | null;
  /** A call to the environment's API with its session (the module host bridge). */
  request(organizationId: string | null, method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }>;
}

const SECRET_PREFIX = "wos.env.";
const MAX_BODY = 5 * 1024 * 1024;
const REFRESH_MARGIN_MS = 60_000;

export function createEnvironmentManager(initialUrl: string, deps: EnvironmentDeps): EnvironmentManager {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  let url = initialUrl;
  let descriptor: EnvironmentDescriptor | null = null;
  let problem: string | null = "NOT CHECKED YET.";
  let pendingLocal: { requestId: string; email: string } | null = null;
  let local: LocalSession | null = null;
  const cloudTokens = new Map<string, CloudToken>();
  let lastCloud: CloudToken | null = null;

  const isCloudUrl = () => new URL(url).origin === new URL(deps.cloudCoreUrl).origin;

  const json = async (res: Response): Promise<unknown> => {
    const text = await res.text();
    if (text.length > MAX_BODY) throw new EnvironmentError("INTERNAL", "the environment answered with too much data");
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new EnvironmentError("INTERNAL", `the environment answered with something that is not JSON (HTTP ${res.status})`);
    }
  };
  const errorOf = (body: unknown, status: number): EnvironmentError => {
    const e = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    return new EnvironmentError(
      typeof e?.code === "string" ? e.code : status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
      typeof e?.message === "string" ? e.message : `HTTP ${status}`,
    );
  };
  const call = async (method: string, path: string, init: { bearer?: string; body?: unknown } = {}) => {
    if (!descriptor) throw new EnvironmentError("NOT_FOUND", problem ?? "the environment is not reachable");
    const headers: Record<string, string> = { accept: "application/json", "x-wos-client": `desktop/${deps.clientVersion}` };
    if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
    let body: string | undefined;
    if (init.body !== undefined && method !== "GET" && method !== "DELETE") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let res: Response;
    try {
      res = await deps.fetch(new URL(path, `${descriptor.apiBase.replace(/\/$/, "")}/`).toString(), { method, headers, body });
    } catch (e) {
      throw new EnvironmentError("NETWORK", `the environment is unreachable (${e instanceof Error ? e.message : String(e)})`);
    }
    return { status: res.status, body: await json(res) };
  };

  const secretKey = (environmentId: string) => `${SECRET_PREFIX}${environmentId}`;
  const loadLocal = async (): Promise<LocalSession | null> => {
    if (descriptor?.auth.kind !== "local") return null;
    const raw = await deps.secrets.get(secretKey(descriptor.environmentId));
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as LocalSession;
      if (Date.parse(s.expiresAt) <= now().getTime()) {
        await deps.secrets.delete(secretKey(descriptor.environmentId));
        return null;
      }
      return s;
    } catch {
      return null;
    }
  };

  const cloudBearer = async (organizationId: string | null): Promise<CloudToken> => {
    if (!organizationId)
      throw new EnvironmentError("VALIDATION_FAILED", "CHOOSE AN ORGANIZATION: a wOS Cloud session is for one organization.");
    const key = `${descriptor!.environmentId}/${organizationId}`;
    const cached = cloudTokens.get(key);
    if (cached && Date.parse(cached.expiresAt) - REFRESH_MARGIN_MS > now().getTime()) {
      lastCloud = cached;
      return cached;
    }
    let r: Awaited<ReturnType<PlatformApi["issueEnvironmentToken"]>>;
    try {
      r = await deps.platform.issueEnvironmentToken(descriptor!.environmentId, organizationId);
    } catch (e) {
      const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "INTERNAL";
      if (code === "UNAUTHENTICATED") throw new EnvironmentError(code, "SIGN IN TO YOUR wOS ACCOUNT to use wOS Cloud.");
      throw new EnvironmentError(code, `wOS Cloud did not issue an environment token: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.claims.aud !== descriptor!.environmentId || r.claims.org !== organizationId)
      throw new EnvironmentError("INTERNAL", "the environment token is for another environment or organization");
    const t: CloudToken = { token: r.token, expiresAt: r.expiresAt, organizationId, role: r.claims.role };
    cloudTokens.set(key, t);
    lastCloud = t;
    return t;
  };

  const bearer = async (organizationId: string | null): Promise<{ token: string; role: OrgRole }> => {
    if (!descriptor) throw new EnvironmentError("NOT_FOUND", problem ?? "the environment is not reachable");
    switch (descriptor.auth.kind) {
      case "wos_cloud":
        return cloudBearer(organizationId);
      case "local": {
        local = await loadLocal();
        if (!local) throw new EnvironmentError("UNAUTHENTICATED", `SIGN IN TO ${descriptor.name}: this environment has its own sign-in.`);
        return local;
      }
      default:
        throw new EnvironmentError("NOT_IMPLEMENTED", "OIDC SIGN-IN IS NOT SUPPORTED by this wOS Desktop yet.");
    }
  };

  return {
    url: () => url,
    setUrl(next) {
      if (next === url) return;
      url = next;
      descriptor = null;
      problem = "NOT CHECKED YET.";
      pendingLocal = null;
      local = null;
      lastCloud = null;
    },
    descriptor: () => descriptor,
    view() {
      const kind = descriptor?.auth.kind ?? null;
      const cloud = kind === "wos_cloud" ? lastCloud : null;
      const loc = kind === "local" ? local : null;
      return {
        url,
        isDefault: isCloudUrl(),
        descriptor,
        problem,
        session: {
          signedIn: Boolean(cloud ?? loc),
          waitingForCode: kind === "local" && pendingLocal !== null,
          email: loc?.email ?? pendingLocal?.email ?? null,
          organizationId: cloud?.organizationId ?? loc?.organizationId ?? null,
          role: cloud?.role ?? loc?.role ?? null,
          expiresAt: cloud?.expiresAt ?? loc?.expiresAt ?? null,
        },
      };
    },
    async discover() {
      const target = url;
      let res: Response;
      try {
        res = await deps.fetch(new URL(CoreRoutes.environment.path, target).toString(), {
          method: "GET",
          headers: { accept: "application/json", "x-wos-client": `desktop/${deps.clientVersion}` },
        });
      } catch (e) {
        if (url === target) {
          descriptor = null;
          problem = `NOT REACHABLE: ${target} did not answer (${e instanceof Error ? e.message : String(e)}).`;
        }
        return;
      }
      let parsed: ReturnType<typeof EnvironmentDescriptor.safeParse> | null = null;
      try {
        parsed = res.ok ? EnvironmentDescriptor.safeParse(await json(res)) : null;
      } catch {
        parsed = null;
      }
      if (url !== target) return;
      if (!parsed?.success) {
        descriptor = null;
        problem = `NOT A wOS ENVIRONMENT: ${target}/.well-known/wos-environment did not answer with a wos-environment.v1 descriptor.`;
        return;
      }
      const d = parsed.data;
      if (new URL(d.apiBase).origin !== new URL(target).origin) {
        descriptor = null;
        problem = `REFUSED: the environment's API (${d.apiBase}) is on another origin than ${target}.`;
        return;
      }
      if (d.auth.kind === "wos_cloud") {
        const issuerOk = new URL(d.auth.issuer).origin === new URL(deps.cloudIssuer).origin;
        if (!isCloudUrl() || !issuerOk) {
          descriptor = null;
          problem = `REFUSED: ${target} says it is wOS Cloud, but wOS Cloud is ${deps.cloudCoreUrl}. wOS Desktop sends wOS Cloud sessions nowhere else.`;
          return;
        }
      }
      if (descriptor && descriptor.environmentId !== d.environmentId) {
        cloudTokens.clear();
        lastCloud = null;
      }
      descriptor = d;
      problem = d.auth.kind === "oidc" ? "OIDC SIGN-IN IS NOT SUPPORTED by this wOS Desktop yet." : null;
      if (d.auth.kind === "local") local = await loadLocal();
      log(`environment ${d.name} (${d.kind}, Core ${d.coreVersion}) at ${target}`);
    },
    async startLocalSignIn(email) {
      if (descriptor?.auth.kind !== "local")
        throw new EnvironmentError("VALIDATION_FAILED", "this environment does not use its own sign-in");
      const r = await call("POST", CoreRoutes.localSignInStart.path, { body: { email } });
      if (r.status !== 202) throw errorOf(r.body, r.status);
      const parsed = LocalSignInStartResponse.safeParse(r.body);
      if (!parsed.success) throw new EnvironmentError("INTERNAL", "the environment's sign-in answer does not match the contract");
      pendingLocal = { requestId: parsed.data.requestId, email };
    },
    async redeemLocalCode(code) {
      if (descriptor?.auth.kind !== "local" || !pendingLocal)
        throw new EnvironmentError("CONFLICT", "no sign-in to this environment is waiting for a code");
      const body = LocalSignInRedeemBody.safeParse({ requestId: pendingLocal.requestId, code });
      if (!body.success) throw new EnvironmentError("VALIDATION_FAILED", "the code is 8 characters, like ABCD-EFGH");
      const r = await call("POST", CoreRoutes.localSignInRedeem.path, { body: body.data });
      if (r.status !== 200) throw errorOf(r.body, r.status);
      const parsed = LocalSignInRedeemResponse.safeParse(r.body);
      if (!parsed.success) throw new EnvironmentError("INTERNAL", "the environment's sign-in answer does not match the contract");
      local = { ...parsed.data, email: pendingLocal.email };
      pendingLocal = null;
      await deps.secrets.set(secretKey(descriptor.environmentId), JSON.stringify(local));
    },
    async signOut() {
      pendingLocal = null;
      if (descriptor?.auth.kind === "local") {
        const s = await loadLocal();
        if (s) await call("POST", CoreRoutes.logout.path, { bearer: s.token }).catch(() => undefined);
        await deps.secrets.delete(secretKey(descriptor.environmentId));
        local = null;
      } else {
        cloudTokens.clear();
        lastCloud = null;
      }
    },
    forgetCloudTokens() {
      cloudTokens.clear();
      lastCloud = null;
    },
    async activeApps(organizationId) {
      const b = await bearer(organizationId);
      const r = await call("GET", CoreRoutes.activeApps.path, { bearer: b.token });
      if (r.status !== 200) {
        if (r.status === 401 && descriptor?.auth.kind === "local") {
          await deps.secrets.delete(secretKey(descriptor.environmentId));
          local = null;
        }
        throw errorOf(r.body, r.status);
      }
      const parsed = ActiveApps.safeParse(r.body);
      if (!parsed.success) throw new EnvironmentError("INTERNAL", "the environment's active apps do not match the contract");
      if (parsed.data.environmentId !== descriptor!.environmentId)
        throw new EnvironmentError("INTERNAL", "the environment answered for another environment id");
      return parsed.data;
    },
    role() {
      const kind = descriptor?.auth.kind;
      if (kind === "wos_cloud") return lastCloud?.role ?? null;
      if (kind === "local") return local?.role ?? null;
      return null;
    },
    async request(organizationId, method, path, body) {
      const b = await bearer(organizationId);
      return call(method, path, { bearer: b.token, body });
    },
  };
}

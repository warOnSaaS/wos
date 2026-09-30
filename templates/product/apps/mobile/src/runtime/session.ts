/**
 * One environment's session: the Bearer every `CoreRoutes` and app API call carries (WORKSTREAMS 12.4 shared rules).
 *
 * - Self-hosted (`local`): the Core's own session token, until its `expiresAt` or a 401.
 * - wOS Cloud: an environment token (C-8, 15 minutes) minted from the wOS account session with `issueEnvironmentToken`.
 *   It is kept in memory only and re-minted `ENV_TOKEN_REFRESH_MARGIN_SECONDS` before it expires, when the app comes
 *   back to the foreground close to expiry, and once after a 401. The account's access token is refreshed (rotating,
 *   S-4) when it has expired or the control plane answers 401; a refused refresh signs the phone out.
 *
 * Every token refresh emits `token_refreshed`, on which the ActiveApps controller re-reads the active apps.
 */
import type { Environment } from "./environment.js";
import { call, type Call, type HttpFetch, HttpError, joinUrl } from "./http.js";
import { cloudLogout, coreLogout, issueEnvironmentToken, listOrganizations, refreshCloudSession } from "./auth.js";
import {
  type CloudSession,
  clearSession,
  type LocalSession,
  loadSession,
  type SecureStore,
  saveSession,
  type StoredSession,
} from "./storage.js";
import type { OrgRoleT } from "../contracts.js";

/** Re-mint this long before the environment token's `exp`. Larger than the verifier's 60 s skew, well under 900 s. */
export const ENV_TOKEN_REFRESH_MARGIN_SECONDS = 120;
/** Never schedule a refresh sooner than this (a server clock far ahead must not cause a tight loop). */
export const MIN_REFRESH_DELAY_SECONDS = 5;

export type Clock = { now(): number };
export type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
export const systemClock: Clock = { now: () => Date.now() };
export const systemTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type SessionState = "signed_out" | "ready";
export type SessionEvent = { type: "token_refreshed" } | { type: "signed_out"; reason: string } | { type: "signed_in" };

type Deps = { fetch: HttpFetch; store: SecureStore; environment: Environment; clock?: Clock; timers?: Timers };
type EnvToken = { token: string; exp: number; role: OrgRoleT; organizationId: string };

export class EnvironmentSession {
  private readonly fetch: HttpFetch;
  private readonly store: SecureStore;
  readonly environment: Environment;
  private readonly clock: Clock;
  private readonly timers: Timers;
  private stored: StoredSession | null = null;
  private envToken: EnvToken | null = null;
  private refreshTimer: unknown = null;
  private minting: Promise<EnvToken> | null = null;
  private readonly listeners = new Set<(e: SessionEvent) => void>();

  constructor(deps: Deps) {
    this.fetch = deps.fetch;
    this.store = deps.store;
    this.environment = deps.environment;
    this.clock = deps.clock ?? systemClock;
    this.timers = deps.timers ?? systemTimers;
  }

  get environmentId(): string {
    return this.environment.descriptor.environmentId;
  }
  get apiBase(): string {
    return this.environment.descriptor.apiBase;
  }
  get state(): SessionState {
    return this.stored ? "ready" : "signed_out";
  }
  /** The caller's org role here: from the local session, or from the current environment token's claims. */
  get role(): OrgRoleT | null {
    if (this.stored?.kind === "local") return this.stored.role;
    return this.envToken?.role ?? null;
  }
  get organizationId(): string | null {
    if (this.stored?.kind === "local") return this.stored.organizationId;
    return this.envToken?.organizationId ?? this.stored?.organizationId ?? null;
  }
  /** The environment token's expiry in epoch seconds (wOS Cloud only), for display and tests. */
  get tokenExpiresAt(): number | null {
    return this.envToken?.exp ?? null;
  }

  subscribe(listener: (e: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(e: SessionEvent) {
    for (const l of [...this.listeners]) l(e);
  }

  private nowSeconds() {
    return Math.floor(this.clock.now() / 1000);
  }
  private expired(iso: string) {
    return Date.parse(iso) <= this.clock.now();
  }

  /** Loads the stored session for this environment. Returns the state; a lapsed session is removed. */
  async restore(): Promise<SessionState> {
    const s = await loadSession(this.store, this.environmentId);
    if (!s) return "signed_out";
    if (s.kind === "local" && this.expired(s.expiresAt)) {
      await clearSession(this.store, this.environmentId);
      return "signed_out";
    }
    if (s.kind === "wos_cloud" && this.expired(s.refreshExpiresAt)) {
      await clearSession(this.store, this.environmentId);
      return "signed_out";
    }
    this.stored = s;
    if (s.kind === "wos_cloud") {
      try {
        await this.mint();
      } catch (err) {
        if (this.state === "signed_out") return "signed_out";
        // Offline at start: stay signed in; the next call or foreground retries.
        if (!(err instanceof HttpError && err.code === "NETWORK")) throw err;
      }
    }
    return this.state;
  }

  async signInLocal(session: LocalSession): Promise<void> {
    await saveSession(this.store, this.environmentId, session);
    this.stored = session;
    this.emit({ type: "signed_in" });
  }

  /** Stores the wOS account session, picks the organization (the personal one, listed first) and mints a token. */
  async signInCloud(session: CloudSession): Promise<void> {
    let s = session;
    if (s.organizationId === null) {
      const orgs = await listOrganizations(this.fetch, s);
      const first = orgs[0];
      if (!first) throw new HttpError(200, "PROTOCOL", "this wOS account has no organization");
      s = { ...s, organizationId: first.id };
    }
    await saveSession(this.store, this.environmentId, s);
    this.stored = s;
    await this.mint();
    this.emit({ type: "signed_in" });
  }

  /** The Bearer for the next call, re-minting a wOS Cloud token that is due. */
  async bearer(): Promise<string> {
    const s = this.stored;
    if (!s) throw new HttpError(401, "UNAUTHENTICATED", "sign in to this environment");
    if (s.kind === "local") {
      if (this.expired(s.expiresAt)) {
        await this.signOutLocally("your session on this environment ended; sign in again");
        throw new HttpError(401, "UNAUTHENTICATED", "sign in to this environment");
      }
      return s.token;
    }
    const t = this.envToken;
    if (t && this.nowSeconds() < t.exp - ENV_TOKEN_REFRESH_MARGIN_SECONDS) return t.token;
    return (await this.mint()).token;
  }

  /**
   * A call to this environment with the session's Bearer. On a 401, a wOS Cloud session re-mints once and retries; a
   * local session is signed out (its Core no longer knows the token).
   */
  async authorized(c: Omit<Call, "bearer" | "url"> & { path: string }): Promise<{ status: number; json: unknown }> {
    const req = (bearer: string) => call(this.fetch, { method: c.method, url: joinUrl(this.apiBase, c.path), body: c.body, bearer });
    try {
      return await req(await this.bearer());
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 401 || !this.stored) throw err;
      if (this.stored.kind === "local") {
        await this.signOutLocally("your session on this environment ended; sign in again");
        throw err;
      }
      this.envToken = null;
      return req((await this.mint()).token);
    }
  }

  /** The app came back to the foreground: re-mint now if the token is due or was due while the phone slept. */
  async onForeground(): Promise<void> {
    if (this.stored?.kind !== "wos_cloud") return;
    const t = this.envToken;
    if (!t || this.nowSeconds() >= t.exp - ENV_TOKEN_REFRESH_MARGIN_SECONDS) await this.mint();
  }

  /** Mints a fresh environment token (one at a time), refreshing the account session when needed. */
  private mint(): Promise<EnvToken> {
    this.minting ??= this.doMint().finally(() => {
      this.minting = null;
    });
    return this.minting;
  }

  private async doMint(): Promise<EnvToken> {
    let s = this.stored;
    if (s?.kind !== "wos_cloud" || s.organizationId === null) throw new HttpError(401, "UNAUTHENTICATED", "sign in to wOS Cloud");
    if (this.expired(s.accessExpiresAt)) s = await this.refreshAccount(s);
    let r: Awaited<ReturnType<typeof issueEnvironmentToken>>;
    try {
      r = await issueEnvironmentToken(this.fetch, s, this.environmentId, s.organizationId!);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 401) throw err;
      s = await this.refreshAccount(s);
      r = await issueEnvironmentToken(this.fetch, s, this.environmentId, s.organizationId!);
    }
    const t: EnvToken = { token: r.token, exp: r.claims.exp, role: r.claims.role, organizationId: r.claims.org };
    this.envToken = t;
    this.schedule(t);
    this.emit({ type: "token_refreshed" });
    return t;
  }

  private async refreshAccount(s: CloudSession): Promise<CloudSession> {
    try {
      const next = await refreshCloudSession(this.fetch, s);
      await saveSession(this.store, this.environmentId, next);
      this.stored = next;
      return next;
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) await this.signOutLocally("your wOS account session ended; sign in again");
      throw err;
    }
  }

  private schedule(t: EnvToken) {
    if (this.refreshTimer !== null) this.timers.clearTimeout(this.refreshTimer);
    const delay = Math.max(MIN_REFRESH_DELAY_SECONDS, t.exp - ENV_TOKEN_REFRESH_MARGIN_SECONDS - this.nowSeconds());
    this.refreshTimer = this.timers.setTimeout(() => {
      this.refreshTimer = null;
      this.mint().catch(() => {
        // A failed background refresh is retried by the next call, the next foreground or ActiveApps' next tick.
      });
    }, delay * 1000);
  }

  /** Signs out here: ends the session on the server when reachable, then forgets it on the phone. */
  async signOut(): Promise<void> {
    const s = this.stored;
    try {
      if (s?.kind === "local") await coreLogout(this.fetch, this.apiBase, s.token);
      if (s?.kind === "wos_cloud") await cloudLogout(this.fetch, s);
    } catch {
      // Forgetting the session on the phone must not depend on the network.
    }
    await this.signOutLocally("signed out");
  }

  private async signOutLocally(reason: string) {
    if (this.refreshTimer !== null) this.timers.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.stored = null;
    this.envToken = null;
    await clearSession(this.store, this.environmentId);
    this.emit({ type: "signed_out", reason });
  }

  /** Stops timers without signing out (the app switched environment). */
  dispose(): void {
    if (this.refreshTimer !== null) this.timers.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.listeners.clear();
  }
}

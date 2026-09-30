/**
 * wOS Mobile's state, without React: which environment is selected, whether this phone is signed in to it, the
 * active apps and the navigation built from them. The React Native views subscribe to it and draw `WosState`.
 *
 *   loading -> choose_environment -> sign_in -> ready
 *                      ^------------- switch / sign out -----'
 */
import type { EnvironmentDescriptorT } from "../contracts.js";
import { ActiveAppsController, type ActiveAppsSnapshot } from "./active-apps.js";
import { CLOUD_SIGNIN_BLOCKER, normalizeCode, redeemCloudSignIn, redeemLocalSignIn, startCloudSignIn, startLocalSignIn } from "./auth.js";
import { discoverEnvironment, type Environment, normalizeEnvironmentUrl, signInMethod } from "./environment.js";
import { type HttpFetch, HttpError } from "./http.js";
import { type BundledMobileModule, type MobilePlatform, mobileNavigation, type NavEntry } from "./navigation.js";
import { type Clock, EnvironmentSession, type Timers } from "./session.js";
import { loadEnvironments, type SecureStore, saveEnvironments } from "./storage.js";

export type SignInStep =
  | { step: "email" }
  | { step: "code"; email: string; requestId: string; pollSecret: string | null; expiresAt: string }
  | { step: "blocked"; blocker: string; message: string };

export type WosState =
  | { phase: "loading" }
  | { phase: "choose_environment"; environments: Environment[]; error: string | null }
  | { phase: "sign_in"; environment: Environment; signIn: SignInStep; error: string | null }
  | {
      phase: "ready";
      environment: Environment;
      activeApps: ActiveAppsSnapshot;
      navigation: NavEntry[];
      notice: string | null;
    };

export type WosClientDeps = {
  fetch: HttpFetch;
  store: SecureStore;
  platform: MobilePlatform;
  modules: ReadonlyMap<string, BundledMobileModule>;
  clock?: Clock;
  timers?: Timers;
  trustedCloudIssuers?: readonly string[];
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class WosClient {
  private state: WosState = { phase: "loading" };
  private readonly listeners = new Set<(s: WosState) => void>();
  private environments: Environment[] = [];
  session: EnvironmentSession | null = null;
  activeApps: ActiveAppsController | null = null;
  private unsubs: (() => void)[] = [];

  constructor(private readonly deps: WosClientDeps) {}

  get current(): WosState {
    return this.state;
  }
  subscribe(l: (s: WosState) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private set(s: WosState) {
    this.state = s;
    for (const l of [...this.listeners]) l(s);
  }

  /** On launch: the stored environments, and the selected one's session if it is still valid. */
  async init(): Promise<void> {
    const stored = await loadEnvironments(this.deps.store);
    this.environments = stored.environments;
    const selected = this.environments.find((e) => e.descriptor.environmentId === stored.selected);
    if (!selected) return this.set({ phase: "choose_environment", environments: this.environments, error: null });
    await this.open(selected);
  }

  /** Reads `/.well-known/wos-environment` at the typed address, remembers the environment and selects it. */
  async connect(input: string): Promise<void> {
    const n = normalizeEnvironmentUrl(input);
    if (!n.ok) return this.set({ phase: "choose_environment", environments: this.environments, error: n.reason });
    let env: Environment;
    try {
      env = await discoverEnvironment(this.deps.fetch, n.url, { trustedCloudIssuers: this.deps.trustedCloudIssuers });
    } catch (err) {
      return this.set({ phase: "choose_environment", environments: this.environments, error: message(err) });
    }
    const id = env.descriptor.environmentId;
    this.environments = [...this.environments.filter((e) => e.descriptor.environmentId !== id), env];
    await saveEnvironments(this.deps.store, { selected: id, environments: this.environments });
    await this.open(env);
  }

  async selectEnvironment(environmentId: string): Promise<void> {
    const env = this.environments.find((e) => e.descriptor.environmentId === environmentId);
    if (!env) return;
    await saveEnvironments(this.deps.store, { selected: environmentId, environments: this.environments });
    await this.open(env);
  }

  /** Back to the environment list; the session stays stored for when the user returns. */
  async switchEnvironment(): Promise<void> {
    this.close();
    await saveEnvironments(this.deps.store, { selected: null, environments: this.environments });
    this.set({ phase: "choose_environment", environments: this.environments, error: null });
  }

  private close() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.activeApps?.stop();
    this.session?.dispose();
    this.activeApps = null;
    this.session = null;
  }

  private async open(env: Environment): Promise<void> {
    this.close();
    const session = new EnvironmentSession({
      fetch: this.deps.fetch,
      store: this.deps.store,
      environment: env,
      clock: this.deps.clock,
      timers: this.deps.timers,
    });
    this.session = session;
    let state: "ready" | "signed_out" = "signed_out";
    try {
      state = await session.restore();
    } catch (err) {
      return this.set({ phase: "sign_in", environment: env, signIn: { step: "email" }, error: message(err) });
    }
    this.unsubs.push(
      session.subscribe((e) => {
        if (e.type === "signed_out") {
          this.activeApps?.stop();
          this.set({ phase: "sign_in", environment: env, signIn: { step: "email" }, error: e.reason === "signed out" ? null : e.reason });
        }
      }),
    );
    if (state === "signed_out") return this.set({ phase: "sign_in", environment: env, signIn: { step: "email" }, error: null });
    await this.startReady(env);
  }

  private async startReady(env: Environment) {
    const session = this.session!;
    const apps = new ActiveAppsController(session, this.deps.timers);
    this.activeApps = apps;
    this.unsubs.push(apps.subscribe((snap) => this.publishReady(env, snap)));
    this.publishReady(env, apps.current);
    await apps.start();
  }

  private publishReady(env: Environment, snap: ActiveAppsSnapshot, notice: string | null = null) {
    if (this.session?.state !== "ready") return;
    const navigation = mobileNavigation(snap.apps?.apps ?? [], this.deps.platform, this.session.role, this.deps.modules);
    this.set({ phase: "ready", environment: env, activeApps: snap, navigation, notice });
  }

  /** Step 1 of sign-in: ask the environment (local) or the wOS account service (wos_cloud) to email a code. */
  async startSignIn(email: string): Promise<void> {
    const s = this.state;
    if (s.phase !== "sign_in") return;
    const d: EnvironmentDescriptorT = s.environment.descriptor;
    const method = signInMethod(d);
    try {
      if (method === "local") {
        const r = await startLocalSignIn(this.deps.fetch, d.apiBase, email);
        return this.set({
          ...s,
          signIn: { step: "code", email, requestId: r.requestId, pollSecret: null, expiresAt: r.expiresAt },
          error: null,
        });
      }
      if (method === "wos_cloud" && d.auth.kind === "wos_cloud") {
        const r = await startCloudSignIn(this.deps.fetch, d.auth.issuer, email);
        if (!r.ok) return this.set({ ...s, signIn: { step: "blocked", blocker: r.blocker, message: r.message }, error: null });
        return this.set({
          ...s,
          signIn: { step: "code", email, requestId: r.requestId, pollSecret: r.pollSecret, expiresAt: r.expiresAt },
          error: null,
        });
      }
      return this.set({
        ...s,
        signIn: {
          step: "blocked",
          blocker: "oidc",
          message: "This environment signs in through its own identity provider (OIDC), which wOS Mobile does not support yet.",
        },
        error: null,
      });
    } catch (err) {
      this.set({ ...s, error: message(err) });
    }
  }

  /** Step 2: redeem the typed code, store the session and show the environment's apps. */
  async redeemCode(input: string): Promise<void> {
    const s = this.state;
    if (s.phase !== "sign_in" || s.signIn.step !== "code" || !this.session) return;
    const code = normalizeCode(input);
    if (!code) return this.set({ ...s, error: "the code has 8 letters and digits, like ABCD-EF23" });
    const d = s.environment.descriptor;
    try {
      if (d.auth.kind === "local") {
        await this.session.signInLocal(await redeemLocalSignIn(this.deps.fetch, d.apiBase, s.signIn.requestId, code));
      } else if (d.auth.kind === "wos_cloud" && s.signIn.pollSecret) {
        const cloud = await redeemCloudSignIn(this.deps.fetch, d.auth.issuer, {
          requestId: s.signIn.requestId,
          pollSecret: s.signIn.pollSecret,
          code,
        });
        await this.session.signInCloud(cloud);
      } else {
        return this.set({ ...s, signIn: { step: "blocked", blocker: CLOUD_SIGNIN_BLOCKER, message: "sign-in is not available here" } });
      }
    } catch (err) {
      return this.set({
        ...s,
        error: err instanceof HttpError && err.status === 401 ? "that code is not valid (used, expired or mistyped)" : message(err),
      });
    }
    await this.startReady(s.environment);
  }

  restartSignIn(): void {
    const s = this.state;
    if (s.phase === "sign_in") this.set({ ...s, signIn: { step: "email" }, error: null });
  }

  async signOut(): Promise<void> {
    await this.session?.signOut();
  }

  /** The app returned to the foreground (React Native AppState "active"). */
  async onForeground(): Promise<void> {
    await this.activeApps?.onForeground();
  }

  dispose(): void {
    this.close();
    this.listeners.clear();
  }
}

/**
 * DesktopCore: the ONE wOS Desktop's app shell in the main process (D16), with no Electron import so it is tested
 * against the real orchestrator and fake or real control planes.
 *
 * The shell owns: the wOS account sign-in (D8, through the orchestrator), settings, Settings -> Environment and its
 * per-environment sessions, organizations, Your Apps / Available Apps with enable/disable, the desktop module
 * installer, the merged navigation, and the S-40 gate for Build.
 *
 * S-40: Build's channels reach the Build app (src/apps/build/main) only while BOTH hold: Build is enabled for an
 * organization of the signed-in account (checked against api.waronsaas.com at start, on every shell refresh and at
 * least every 60 seconds), and the user turned Build on for this device. `onBuildGate` tells start.ts to register or
 * unregister the IPC handlers; when the gate closes, running builds are aborted and held leases released. This file
 * also refuses Build channels while closed, so a stale handler cannot reach the orchestrator.
 */
import {
  ACTIVE_APPS_REFRESH_SECONDS,
  type ActiveApps,
  type AgentPolicyDocument,
  BUILD_APP_ID,
  type Me,
  type Orchestrator,
  type OrgRole,
  type SignInPrompt,
  type WosAppManifest,
} from "@waronsaas/contracts";
import { BUILD_MANIFEST } from "../apps/build/manifest.js";
import { type BuildCore, createBuildCore } from "../apps/build/main/build-core.js";
import {
  type AppInfo,
  BUILD_CHANNEL_LIST,
  type BuildChannel,
  type BuildGateView,
  type DesktopEvent,
  IPC_CHANNELS,
  type InvokeChannel,
  type ModuleBounds,
  type NavEntryView,
  type ShellState,
} from "../shared/ipc.js";
import type { EnvironmentManager } from "./environment.js";
import type { ActiveModule, ModuleInstaller } from "./module-installer.js";
import type { OrganizationView, PlatformApi } from "./platform-api.js";
import type { PublicApi } from "./public-api.js";
import { isAllowedExternalUrl, parseAuthDeepLink } from "./security.js";
import type { SettingsStore } from "./settings.js";
import { type Payloads, ValidationError, validatePayload } from "./validate.js";

export { explainFailure } from "../apps/build/main/build-core.js";

/** Where a verified module's page is shown (start.ts: a sandboxed WebContentsView under wos-module://). */
export interface ModuleHost {
  show(module: ActiveModule, route: string, bounds: ModuleBounds): Promise<void>;
  hide(): Promise<void>;
  /** The module shown right now, if any. */
  current(): { app: string; version: string } | null;
}

export interface CoreDeps {
  orchestrator: Orchestrator;
  publicApi: PublicApi;
  platform: PlatformApi;
  environment: EnvironmentManager;
  /** wOS Cloud's Core (HOSTS.core): where Settings -> Environment goes back to. */
  cloudCoreUrl: string;
  installer: ModuleInstaller;
  settings: SettingsStore;
  policy: AgentPolicyDocument;
  appInfo: AppInfo;
  emit: (event: DesktopEvent) => void;
  /** shell.openExternal, called only after the allowlist passed. */
  openExternal: (url: string) => Promise<void>;
  /** S-40: start.ts registers Build's IPC handlers when true and removes them when false. */
  onBuildGate?: (open: boolean) => void;
  moduleHost?: ModuleHost;
  newId?: () => string;
  now?: () => Date;
  log?: (msg: string) => void;
}

class Deferred<T> {
  resolve!: (v: T) => void;
  reject!: (e: unknown) => void;
  readonly promise = new Promise<T>((res, rej) => {
    this.resolve = res;
    this.reject = rej;
  });
}

/** A push-driven AsyncIterable for SignInPrompt.deepLinks. */
class LinkQueue implements AsyncIterable<string> {
  private readonly items: string[] = [];
  private waiter: Deferred<IteratorResult<string>> | null = null;
  private closed = false;
  push(v: string) {
    if (this.closed) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.resolve({ value: v, done: false });
    } else this.items.push(v);
  }
  close() {
    this.closed = true;
    this.waiter?.resolve({ value: undefined, done: true });
    this.waiter = null;
  }
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        this.waiter = new Deferred();
        return this.waiter.promise;
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

interface SignInSession {
  codes: Deferred<string> | null;
  pendingCodes: string[];
  links: LinkQueue;
  abort: AbortController;
}

/** The module host bridge may use these methods only, under the app's own `routes.api`. */
const MODULE_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

export interface DesktopCore {
  invoke(channel: InvokeChannel, payload: unknown): Promise<unknown>;
  /** wos:// URLs from open-url / second-instance / argv. Returns true when it was accepted. */
  handleDeepLink(url: string): boolean;
  /** Re-checks the Build gate, the environment's active apps and the modules; emits the shell state. Never throws. */
  refresh(): Promise<ShellState>;
  shellState(): ShellState;
  buildGateOpen(): boolean;
  /** The module page's host bridge (`window.wos.app(<id>)`), for the module currently shown. */
  moduleManifest(senderApp: string, requestedApp: string): WosAppManifest;
  moduleRequest(
    senderApp: string,
    requestedApp: string,
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  /** The module view could not load: fail that version and roll back (ModuleInstallMachine). */
  moduleLoadFailed(app: string, version: string, reason: string): Promise<void>;
  /** Waits for every running build/review (tests, shutdown). */
  settle(): Promise<void>;
  lastStatus(): ReturnType<BuildCore["lastStatus"]>;
}

const REFRESH_EVERY_MS = ACTIVE_APPS_REFRESH_SECONDS * 1000;

export function createDesktopCore(deps: CoreDeps): DesktopCore {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  let me: Me | null = null;
  let signIn: SignInSession | null = null;
  let organizations: OrganizationView[] = [];
  let entitledOrgs: string[] = [];
  let entitlementCheckedAt: string | null = null;
  let entitlementProblem: string | null = null;
  let activeApps: ActiveApps | null = null;
  let activeAppsProblem: string | null = null;
  let gateOpen = false;
  let refreshing: Promise<ShellState> | null = null;

  const build = createBuildCore({
    orchestrator: deps.orchestrator,
    publicApi: deps.publicApi,
    settings: deps.settings,
    policy: deps.policy,
    emit: deps.emit,
    me: () => me,
    setMe: (m) => {
      me = m;
    },
    ...(deps.newId ? { newId: deps.newId } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    log,
  });

  const emitOrchestrator = (event: Parameters<Parameters<Orchestrator["signIn"]>[2]>[0]) =>
    deps.emit({ kind: "orchestrator", runId: null, at: now().toISOString(), event });

  /** The org the apps screen and the wOS Cloud environment token use: the chosen one, else the personal one. */
  const selectedOrg = (): string | null => {
    const chosen = deps.settings.get().organizationId;
    if (chosen && organizations.some((o) => o.id === chosen)) return chosen;
    return organizations.find((o) => o.kind === "personal")?.id ?? organizations[0]?.id ?? null;
  };

  const gateView = (): BuildGateView => {
    const onDevice = deps.settings.get().buildOnDevice;
    const entitled = entitledOrgs.length > 0;
    let reason: string | null = null;
    if (!me) reason = "SIGN IN to your wOS account to use Build.";
    else if (entitlementProblem) reason = entitlementProblem;
    else if (!entitled) reason = "BUILD IS NOT ENABLED for any of your organizations. Enable it under YOUR APPS / AVAILABLE APPS.";
    else if (!onDevice) reason = "BUILD IS OFF ON THIS DEVICE. Turn it on to let wOS run claude, codex and git here.";
    return { entitled, entitledOrgs: [...entitledOrgs], onDevice, open: reason === null, reason, checkedAt: entitlementCheckedAt };
  };

  const roleGrants = (manifest: WosAppManifest, permission: string | null, role: OrgRole | null) => {
    if (permission === null) return true;
    const p = manifest.permissions.find((x) => x.key === permission);
    return Boolean(p && role && p.grantedTo.includes(role));
  };

  const navigation = (): NavEntryView[] => {
    const out: NavEntryView[] = [];
    const add = (manifest: WosAppManifest, role: OrgRole | null) => {
      for (const n of manifest.navigation) {
        if (!n.surfaces.includes("desktop") || !roleGrants(manifest, n.permission, role)) continue;
        out.push({ id: n.id, app: manifest.app.id, title: n.title, route: n.route, order: n.order });
      }
    };
    if (activeApps) {
      const role = deps.environment.role();
      for (const a of activeApps.apps) {
        if (a.id === BUILD_APP_ID) continue; // Build is never an environment feature (WORKSTREAMS 12.4).
        const m = deps.installer.active(a.id);
        if (m && m.version === a.version) add(m.manifest, role);
      }
    }
    if (gateOpen) {
      // Build's role is the caller's best role among the orgs where Build is enabled.
      const roles = organizations.filter((o) => entitledOrgs.includes(o.id)).map((o) => o.role);
      const role = (["owner", "admin", "member"] as const).find((r) => roles.includes(r)) ?? null;
      add(BUILD_MANIFEST, role);
    }
    return out.sort((a, b) => a.order - b.order || a.app.localeCompare(b.app) || a.id.localeCompare(b.id));
  };

  const shellState = (): ShellState => ({
    environment: deps.environment.view(),
    organizations: [...organizations],
    organizationId: selectedOrg(),
    activeApps:
      activeApps?.apps.map((a) => ({
        id: a.id,
        name: a.manifest.app.name,
        version: a.version,
        source: a.source,
        kind: a.manifest.app.kind,
        desktop: a.manifest.surfaces.desktop.supported,
      })) ?? null,
    activeAppsProblem,
    modules: deps.installer.status(),
    navigation: navigation(),
    build: gateView(),
  });

  const emitShell = () => {
    const state = shellState();
    deps.emit({ kind: "shell", state });
    return state;
  };

  /** Applies the gate: registers or removes Build's handlers; on close, aborts runs and releases leases. */
  const applyGate = async () => {
    const open = gateView().open;
    if (open === gateOpen) return;
    gateOpen = open;
    deps.onBuildGate?.(open);
    log(`Build gate ${open ? "open" : "closed"}`);
    if (!open) {
      const r = await build.lapse(gateView().reason ?? "Build is off");
      if (r.aborted || r.released.length) log(`Build lapsed: ${r.aborted} runs aborted, ${r.released.length} leases released`);
    }
  };

  /** S-40 entitlement half: Build enabled for ANY organization of the account, from listOrgApps on api.waronsaas.com. */
  const checkEntitlement = async () => {
    entitlementCheckedAt = now().toISOString();
    if (!me) {
      organizations = [];
      entitledOrgs = [];
      entitlementProblem = null;
      return;
    }
    try {
      organizations = await deps.platform.listMyOrganizations();
      const entitled: string[] = [];
      for (const o of organizations) {
        const apps = await deps.platform.listOrgApps(o.id);
        if (apps.yourApps.some((v) => v.app.id === BUILD_APP_ID && v.entitlement.state === "enabled")) entitled.push(o.id);
      }
      entitledOrgs = entitled;
      entitlementProblem = null;
    } catch (e) {
      // Fail closed: an unknown entitlement is no entitlement (the server's NOT_ENTITLED stands behind this too).
      entitledOrgs = [];
      entitlementProblem = `COULD NOT CHECK BUILD'S ENTITLEMENT: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  const syncEnvironment = async () => {
    await deps.environment.discover();
    const d = deps.environment.descriptor();
    if (!d) {
      activeApps = null;
      activeAppsProblem = deps.environment.view().problem;
      return;
    }
    try {
      activeApps = await deps.environment.activeApps(d.auth.kind === "wos_cloud" ? selectedOrg() : null);
      activeAppsProblem = null;
    } catch (e) {
      activeApps = null;
      activeAppsProblem = e instanceof Error ? e.message : String(e);
      return;
    }
    await deps.installer.sync(activeApps, { coreVersion: d.coreVersion });
    const shown = deps.moduleHost?.current();
    if (shown && !navigation().some((n) => n.app === shown.app)) await deps.moduleHost?.hide();
  };

  const refresh = (): Promise<ShellState> => {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        me = await deps.platform.me().catch(() => me);
        await checkEntitlement();
        await applyGate();
        await syncEnvironment();
      } catch (e) {
        log(`shell refresh: ${e instanceof Error ? e.message : String(e)}`);
      }
      return emitShell();
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const isBuildChannel = (c: InvokeChannel): c is BuildChannel => (BUILD_CHANNEL_LIST as readonly string[]).includes(c);

  async function handle<K extends InvokeChannel>(channel: K, p: Payloads[K]): Promise<unknown> {
    const C = IPC_CHANNELS;
    if (isBuildChannel(channel)) {
      if (!gateOpen)
        throw Object.assign(new Error(gateView().reason ?? "Build is off"), {
          code: "NOT_ENTITLED",
        });
      return build.invoke(channel, p as Payloads[BuildChannel]);
    }
    switch (channel) {
      case C.appInfo:
        return deps.appInfo;
      case C.account:
        me = await deps.platform.me().catch(() => me);
        return { me };
      case C.signIn: {
        const { email } = p as Payloads["wos:sign-in"];
        if (signIn) signIn.abort.abort();
        const session: SignInSession = { codes: null, pendingCodes: [], links: new LinkQueue(), abort: new AbortController() };
        signIn = session;
        const prompt: SignInPrompt = {
          code: () => {
            const queued = session.pendingCodes.shift();
            if (queued) return Promise.resolve(queued);
            session.codes = new Deferred<string>();
            session.abort.signal.addEventListener("abort", () => session.codes?.reject(new Error("ABORTED: sign-in cancelled")), {
              once: true,
            });
            return session.codes.promise;
          },
          deepLinks: session.links,
          signal: session.abort.signal,
        };
        try {
          const account = await deps.orchestrator.signIn({ email, deviceName: deps.settings.get().deviceName }, prompt, emitOrchestrator);
          me = account;
          await refresh();
          return account;
        } finally {
          session.links.close();
          if (signIn === session) signIn = null;
        }
      }
      case C.signInCode: {
        const { code } = p as Payloads["wos:sign-in-code"];
        if (!signIn) throw Object.assign(new Error("no sign-in is waiting for a code"), { code: "CONFLICT" });
        if (signIn.codes) {
          const d = signIn.codes;
          signIn.codes = null;
          d.resolve(code);
        } else signIn.pendingCodes.push(code);
        return undefined;
      }
      case C.signInCancel:
        signIn?.abort.abort();
        signIn?.links.close();
        return undefined;
      case C.logout: {
        me = null;
        await applyGate();
        await deps.orchestrator.logout();
        deps.environment.forgetCloudTokens();
        organizations = [];
        entitledOrgs = [];
        activeApps = null;
        await deps.moduleHost?.hide();
        emitShell();
        return undefined;
      }
      case C.getSettings:
        return deps.settings.get();
      case C.setSettings:
        return deps.settings.set(p as Payloads["wos:set-settings"]);
      case C.openExternal: {
        const { url } = p as Payloads["wos:open-external"];
        if (!isAllowedExternalUrl(url)) {
          log(`openExternal refused: ${url.slice(0, 200)}`);
          throw Object.assign(new Error("only https://waronsaas.com and https://github.com/waronsaas links open outside wOS"), {
            code: "FORBIDDEN",
          });
        }
        await deps.openExternal(url);
        return undefined;
      }
      case C.shellState:
        return shellState();
      case C.refreshShell:
        return refresh();
      case C.setEnvironment: {
        const { url } = p as Payloads["wos:set-environment"];
        const target = url ?? deps.cloudCoreUrl;
        deps.settings.set({ environmentUrl: target });
        deps.environment.setUrl(target);
        activeApps = null;
        await deps.moduleHost?.hide();
        return refresh();
      }
      case C.environmentSignIn: {
        await deps.environment.startLocalSignIn((p as Payloads["wos:environment-sign-in"]).email);
        return emitShell();
      }
      case C.environmentSignInCode: {
        await deps.environment.redeemLocalCode((p as Payloads["wos:environment-sign-in-code"]).code);
        return refresh();
      }
      case C.environmentSignOut: {
        await deps.environment.signOut();
        activeApps = null;
        await deps.moduleHost?.hide();
        return refresh();
      }
      case C.selectOrganization: {
        const { organizationId } = p as Payloads["wos:select-organization"];
        if (!organizations.some((o) => o.id === organizationId))
          throw Object.assign(new Error("that is not one of your organizations"), { code: "NOT_FOUND" });
        deps.settings.set({ organizationId });
        return refresh();
      }
      case C.orgApps:
        return deps.platform.listOrgApps((p as Payloads["wos:org-apps"]).organizationId);
      case C.enableApp:
      case C.disableApp: {
        const { organizationId, app, expectedRowVersion } = p as Payloads["wos:enable-app"];
        const view =
          channel === C.enableApp
            ? await deps.platform.enableApp(organizationId, app, expectedRowVersion)
            : await deps.platform.disableApp(organizationId, app, expectedRowVersion);
        // One enable changes every surface: re-read the gate and the environment now, not in 60 s. Hosted Core takes
        // the active apps from the environment token's claims, so the cached token (minted before this change) goes.
        deps.environment.forgetCloudTokens();
        await refresh();
        return view;
      }
      case C.setBuildOnDevice: {
        const { on } = p as Payloads["wos:set-build-on-device"];
        deps.settings.set({ buildOnDevice: on });
        if (on) await checkEntitlement();
        await applyGate();
        return emitShell();
      }
      case C.showModule: {
        const { app, route, bounds } = p as Payloads["wos:show-module"];
        if (!deps.moduleHost) throw Object.assign(new Error("modules are not available here"), { code: "NOT_IMPLEMENTED" });
        if (!navigation().some((n) => n.app === app))
          throw Object.assign(new Error(`${app} is not active in this environment`), { code: "NOT_FOUND" });
        const m = deps.installer.active(app);
        if (!m) throw Object.assign(new Error(`${app} has no verified desktop package installed`), { code: "NOT_FOUND" });
        const ui = m.manifest.routes.ui;
        if (!(route === ui || route.startsWith(`${ui}/`))) throw new ValidationError(`route must be under ${ui}`);
        await deps.moduleHost.show(m, route, bounds);
        return undefined;
      }
      case C.hideModule:
        await deps.moduleHost?.hide();
        return undefined;
      default:
        throw new ValidationError(`unknown channel ${String(channel)}`);
    }
  }

  const requireShown = (senderApp: string, requestedApp: string): ActiveModule => {
    if (senderApp !== requestedApp)
      throw Object.assign(new Error(`a module may use only its own app (${senderApp})`), { code: "FORBIDDEN" });
    const shown = deps.moduleHost?.current();
    if (!shown || shown.app !== senderApp) throw Object.assign(new Error("that module is not shown"), { code: "FORBIDDEN" });
    const m = deps.installer.active(senderApp);
    if (!m || m.version !== shown.version) throw Object.assign(new Error("that module is not active"), { code: "FORBIDDEN" });
    return m;
  };

  return {
    async invoke(channel, payload) {
      const p = validatePayload(channel, payload);
      return handle(channel, p);
    },
    handleDeepLink(url) {
      const link = parseAuthDeepLink(url);
      if (!link) {
        deps.emit({ kind: "deep_link", accepted: false, detail: "IGNORED: not a wos://auth sign-in link." });
        return false;
      }
      if (!signIn) {
        deps.emit({ kind: "deep_link", accepted: false, detail: "IGNORED: no sign-in is waiting. Start sign-in on this machine first." });
        return false;
      }
      signIn.links.push(link.url);
      deps.emit({ kind: "deep_link", accepted: true, detail: "SIGN-IN LINK RECEIVED." });
      return true;
    },
    refresh,
    shellState,
    buildGateOpen: () => gateOpen,
    moduleManifest(senderApp, requestedApp) {
      return requireShown(senderApp, requestedApp).manifest;
    },
    async moduleRequest(senderApp, requestedApp, method, path, body) {
      const m = requireShown(senderApp, requestedApp);
      const prefix = m.manifest.routes.api;
      if (!prefix) throw Object.assign(new Error(`${senderApp} declares no API`), { code: "FORBIDDEN" });
      if (!MODULE_METHODS.has(method)) throw new ValidationError("method must be GET, POST, PATCH or DELETE");
      if (
        typeof path !== "string" ||
        path.length > 1024 ||
        !(path === prefix || path.startsWith(`${prefix}/`)) ||
        /(^|\/)\.\.?(\/|$)|[\\?#%]/.test(path)
      )
        throw Object.assign(new Error(`a module may call only ${prefix}/...`), { code: "FORBIDDEN" });
      const d = deps.environment.descriptor();
      return deps.environment.request(d?.auth.kind === "wos_cloud" ? selectedOrg() : null, method, path, body);
    },
    async moduleLoadFailed(app, version, reason) {
      deps.installer.reportLoadFailure(app, version, reason);
      await deps.moduleHost?.hide();
      emitShell();
    },
    settle: () => build.settle(),
    lastStatus: () => build.lastStatus(),
  };
}

export { REFRESH_EVERY_MS };

/** Serialises an error for the bridge: "<CODE>: <message>" (see splitBridgeError in shared/ipc.ts). */
export function bridgeErrorMessage(e: unknown): string {
  const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "INTERNAL";
  let message = e instanceof Error ? e.message : String(e);
  // ApiCallError messages are "<route>: <CODE>: <message>"; keep only the message.
  const m = /^[A-Za-z]+: [A-Z_]+: ([\s\S]*)$/.exec(message);
  if (m) message = m[1]!;
  const prefixed = /^([A-Z][A-Z0-9_]+): ([\s\S]*)$/.exec(message);
  if (prefixed) return `${prefixed[1]}: ${prefixed[2]}`;
  return `${code}: ${message}`;
}

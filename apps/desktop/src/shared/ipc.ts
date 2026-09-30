/**
 * Desktop IPC contract (owner: desktop workstream; reviewed by the architect at the Wave 2 gate).
 *
 * The renderer sees ONLY `window.wos`, typed by `WosBridge`; it has no Node, no fs, no child_process
 * (SECURITY.md S-29). Every call is invoke/handle on one channel of `IPC_CHANNELS`; main validates
 * every payload (src/main/validate.ts) and checks the sender frame before it touches the orchestrator.
 * Main pushes `DesktopEvent`s on `wos:events` (the orchestrator's `OrchestratorEvent`s unchanged, tagged
 * with the run they belong to, so two builds on two providers can stream side by side).
 *
 * The renderer imports this file for TYPES only; `IPC_CHANNELS` is used by preload and main.
 */
import type {
  AbuSummary,
  ActiveApps,
  EnvironmentDescriptor,
  OrgApps,
  OrgAppView,
  OrganizationView,
  OrgRole,
  AppFeatureDetail,
  AttemptView,
  ContributionView,
  ContributorPublic,
  DomainEvent,
  LeaseView,
  LocalStatus,
  Me,
  ModelRef,
  OrchestratorEvent,
  ProviderId,
  ReviewerSlot,
  RouteResponse,
  TargetDetail,
  TargetSummary,
  TaskView,
} from "@waronsaas/contracts";

/**
 * The app shell's channels: always registered. Sign-in to the wOS account, settings, environments, organizations,
 * Your Apps / Available Apps and the module host. None of them spawns a process or touches git (S-40).
 */
export const SHELL_CHANNELS = {
  appInfo: "wos:app-info",
  account: "wos:account",
  signIn: "wos:sign-in",
  signInCode: "wos:sign-in-code",
  signInCancel: "wos:sign-in-cancel",
  logout: "wos:logout",
  getSettings: "wos:get-settings",
  setSettings: "wos:set-settings",
  openExternal: "wos:open-external",
  shellState: "wos:shell-state",
  refreshShell: "wos:refresh-shell",
  setEnvironment: "wos:set-environment",
  environmentSignIn: "wos:environment-sign-in",
  environmentSignInCode: "wos:environment-sign-in-code",
  environmentSignOut: "wos:environment-sign-out",
  selectOrganization: "wos:select-organization",
  orgApps: "wos:org-apps",
  enableApp: "wos:enable-app",
  disableApp: "wos:disable-app",
  setBuildOnDevice: "wos:set-build-on-device",
  showModule: "wos:show-module",
  hideModule: "wos:hide-module",
} as const;

/**
 * Build's channels (D16): registered as IPC handlers ONLY while S-40 holds (Build enabled for an organization of the
 * signed-in account AND turned on for this device). They spawn claude, codex and git, create worktrees under the
 * workspace root, attest CLIs and heartbeat leases. With Build off they do not exist in the main process.
 */
export const BUILD_CHANNELS = {
  status: "wos:status",
  linkGithub: "wos:link-github",
  listTargets: "wos:list-targets",
  getTarget: "wos:get-target",
  getFeature: "wos:get-feature",
  listClaimableAbus: "wos:list-claimable-abus",
  builderModels: "wos:builder-models",
  build: "wos:build",
  review: "wos:review",
  release: "wos:release",
  runs: "wos:runs",
  myWork: "wos:my-work",
  myEvents: "wos:my-events",
  contributions: "wos:contributions",
} as const;

export const IPC_CHANNELS = {
  ...SHELL_CHANNELS,
  ...BUILD_CHANNELS,
  /** main -> renderer only. */
  events: "wos:events",
} as const;

export type ShellChannel = (typeof SHELL_CHANNELS)[keyof typeof SHELL_CHANNELS];
export type BuildChannel = (typeof BUILD_CHANNELS)[keyof typeof BUILD_CHANNELS];
export const BUILD_CHANNEL_LIST: readonly BuildChannel[] = Object.values(BUILD_CHANNELS);
export const SHELL_CHANNEL_LIST: readonly ShellChannel[] = Object.values(SHELL_CHANNELS);

/**
 * The module host bridge (S-38): the ONLY channels a desktop module's page can reach, from its own preload
 * (`window.wos.app(<id>)`). Main checks that the sender is the module view showing `wos-module://<id>/<version>/`.
 */
export const MODULE_CHANNELS = {
  manifest: "wos-module:manifest",
  request: "wos-module:request",
} as const;

export type InvokeChannel = Exclude<(typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS], typeof IPC_CHANNELS.events>;

export interface AppInfo {
  productName: "wOS";
  version: string;
  contractsVersion: string;
  platform: "darwin" | "linux" | "win32";
  /** True only in the development build wired to the fake control plane; the UI labels every screen with it. */
  fakeControlPlane: boolean;
  apiBaseUrl: string;
  /** The D3 wording shown wherever WOS tokens appear. */
  tokenDisclaimer: string;
}

/** One builder model the picker may offer (D15): allowed for builders by policy AND attested on this device. */
export interface BuilderModelChoice {
  ref: ModelRef;
  label: string;
  modelId: string;
  provider: ProviderId;
  /** The CLI that runs it ("claude" or "codex"). */
  cli: string;
  available: boolean;
  /** Why it is not offered, in plain words; null when available. */
  reason: string | null;
  /** The policy default (first attested entry of the builder's allowedModels). */
  isDefault: boolean;
}

export type RunKind = "build" | "review";
export type RunState = "running" | "passed" | "failed";

export interface RunInfo {
  id: string;
  kind: RunKind;
  /** ABU id or key for builds, the reviewer slot for reviews. */
  subject: string;
  model: ModelRef | null;
  startedAt: string;
  finishedAt: string | null;
  state: RunState;
  /** Failure code from RunResult, or null. */
  code: string | null;
  /** Plain-words explanation of the outcome (DesktopCore.explainFailure), or null while running. */
  explanation: string | null;
  attempt: AttemptView | null;
}

export interface RunSnapshot extends RunInfo {
  /** The run's events so far (bounded ring buffer, newest last). */
  events: OrchestratorEvent[];
}

export type DesktopEvent =
  | { kind: "shell"; state: ShellState }
  | { kind: "orchestrator"; runId: string | null; at: string; event: OrchestratorEvent }
  | { kind: "run"; run: RunInfo }
  | { kind: "github_code"; verificationUri: string; userCode: string }
  | { kind: "deep_link"; accepted: boolean; detail: string };

/** contracts exports the schema only; the type is the ledger route's item. */
export type LedgerEntryView = RouteResponse<"getContributorLedger">["items"][number];

export interface ContributionHistory {
  handle: string | null;
  /** Null when the account has no public profile yet (no accepted contribution, or no handle). */
  profile: (ContributorPublic & { contributions: ContributionView[] }) | null;
  /** Null when the ledger is hidden (not opted in to the leaderboard) or there is no profile. */
  ledger: LedgerEntryView[] | null;
  ledgerHiddenReason: string | null;
}

export interface LocalSettings {
  deviceName: string;
  /** Desktop default: stop after local VERIFY + submission; the server drives review, qualification and PR. */
  detachAfterSubmit: boolean;
  /** Preselected in the BUILD model picker when attested. */
  preferredModel: ModelRef | null;
  /** How often the activity pane polls `events()` while signed in. */
  eventsPollSeconds: number;
  /**
   * Settings -> Environment: the base URL of the wOS environment this device's business apps use. Default wOS Cloud
   * (HOSTS.core). Build ignores it: Build always talks to api.waronsaas.com (WOS-APP-PROTOCOL section 8).
   */
  environmentUrl: string;
  /** The wOS Cloud organization the apps screen and the environment token use; null = the personal one. */
  organizationId: string | null;
  /** S-40: the user turned Build on for THIS device. Off by default; the entitlement alone is not enough. */
  buildOnDevice: boolean;
}

// ------------------------------------------------------------------------------------ the app shell (D16)

/** The wOS account as the shell knows it (GET /v1/me), without running any CLI. */
export interface AccountView {
  me: Me | null;
}

/** The environment this device talks to for business apps (Settings -> Environment). */
export interface EnvironmentView {
  url: string;
  /** True when this is wOS Cloud's default Core (HOSTS.core). */
  isDefault: boolean;
  /** From GET <url>/.well-known/wos-environment; null until discovered or when unreachable or refused. */
  descriptor: EnvironmentDescriptor | null;
  /** Why the environment cannot be used, in plain words; null when it can. */
  problem: string | null;
  session: {
    signedIn: boolean;
    /** Waiting for the emailed code of a `local` sign-in on a self-hosted Core. */
    waitingForCode: boolean;
    email: string | null;
    organizationId: string | null;
    role: OrgRole | null;
    expiresAt: string | null;
  };
}

/** One app active in the environment (ActiveApps), as the shell shows it. */
export interface ActiveAppView {
  id: string;
  name: string;
  version: string;
  source: ActiveApps["apps"][number]["source"];
  kind: "core" | "app" | "module";
  desktop: boolean;
}

/**
 * One desktop module's local install state (ModuleInstallMachine, S-37..S-39). `state` is the active version's state;
 * `unavailable` explains in words why nothing runs for this app.
 */
export interface ModuleStatusView {
  app: string;
  wanted: string | null;
  active: string | null;
  previous: string | null;
  state: "active" | "unavailable";
  reason: string | null;
  /** Recent failures, newest last (bounded). */
  failures: Array<{ version: string; reason: string; at: string }>;
}

/** One navigation entry, merged from the active manifests (and Build's, under S-40), ordered by `order`. */
export interface NavEntryView {
  id: string;
  app: string;
  title: string;
  route: string;
  order: number;
}

/** S-40 as the shell shows it. */
export interface BuildGateView {
  /** Build is enabled for at least one organization of the signed-in account (listOrgApps on api.waronsaas.com). */
  entitled: boolean;
  entitledOrgs: string[];
  /** The user turned Build on for this device. */
  onDevice: boolean;
  /** Both hold: Build's IPC handlers are registered. */
  open: boolean;
  /** Plain words: why Build is off, or null when open. */
  reason: string | null;
  checkedAt: string | null;
}

export interface ShellState {
  environment: EnvironmentView;
  organizations: OrganizationView[];
  organizationId: string | null;
  activeApps: ActiveAppView[] | null;
  activeAppsProblem: string | null;
  modules: ModuleStatusView[];
  navigation: NavEntryView[];
  build: BuildGateView;
}

export type { OrgApps, OrgAppView };

/** A rectangle of the main window, in CSS pixels, where a module's page is shown. */
export interface ModuleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a desktop module's page sees as `window.wos` (its own preload; never the shell's bridge). */
export interface ModuleHostBridge {
  app(id: string): {
    /** The app's signed manifest (from its verified package). */
    manifest(): Promise<unknown>;
    /** An HTTP call to the environment under the manifest's `routes.api` prefix, with the environment session. */
    request(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  };
}

export interface MyWork {
  leases: LeaseView[];
  tasks: TaskView[];
  attempts: AttemptView[];
}

export interface WosBridge {
  appInfo(): Promise<AppInfo>;
  /** The wOS account without running any CLI (the shell's boot). */
  account(): Promise<AccountView>;
  shellState(): Promise<ShellState>;
  /** Re-checks the Build gate, the environment's active apps and the modules now (also done every 60 s and on focus). */
  refreshShell(): Promise<ShellState>;
  /** Settings -> Environment: discovers `<url>/.well-known/wos-environment`; null goes back to wOS Cloud. */
  setEnvironment(url: string | null): Promise<ShellState>;
  /** `local` sign-in on a self-hosted Core: sends the code to the email. */
  environmentSignIn(email: string): Promise<ShellState>;
  environmentSignInCode(code: string): Promise<ShellState>;
  environmentSignOut(): Promise<ShellState>;
  selectOrganization(organizationId: string): Promise<ShellState>;
  orgApps(organizationId: string): Promise<OrgApps>;
  enableApp(organizationId: string, app: string, expectedRowVersion: number | null): Promise<OrgAppView>;
  disableApp(organizationId: string, app: string, expectedRowVersion: number | null): Promise<OrgAppView>;
  /** S-40: the device half of the Build gate. */
  setBuildOnDevice(on: boolean): Promise<ShellState>;
  /** Shows an installed module's page over `bounds` of the window, at `route` (under its `routes.ui`). */
  showModule(app: string, route: string, bounds: ModuleBounds): Promise<void>;
  hideModule(): Promise<void>;
  /** BUILD (S-40): refused, and absent from main, while Build is off. */
  status(): Promise<LocalStatus>;
  /** D8: starts email sign-in; resolves once the code or the `wos://auth` deep link is redeemed. */
  signIn(email: string): Promise<Me>;
  /** Answers the orchestrator's `prompt.code()` with the 8-character code ("ABCD-EFGH"). */
  submitSignInCode(code: string): Promise<void>;
  cancelSignIn(): Promise<void>;
  /** GitHub device flow; the verification URL and user code arrive as a `github_code` DesktopEvent. */
  linkGithub(): Promise<Me>;
  logout(): Promise<void>;
  listTargets(): Promise<TargetSummary[]>;
  getTarget(slug: string): Promise<TargetDetail>;
  getFeature(slug: string, feature: string): Promise<AppFeatureDetail>;
  listClaimableAbus(slug: string, feature: string): Promise<AbuSummary[]>;
  builderModels(): Promise<BuilderModelChoice[]>;
  /** Starts a build (D15 model choice); progress streams as DesktopEvents tagged with the run id. */
  build(abu: string, model: ModelRef): Promise<{ runId: string }>;
  review(slot: ReviewerSlot): Promise<{ runId: string }>;
  release(leaseId: string): Promise<void>;
  runs(): Promise<RunSnapshot[]>;
  myWork(): Promise<MyWork>;
  myEvents(after?: number): Promise<{ items: DomainEvent[]; lastId: number }>;
  contributions(): Promise<ContributionHistory>;
  getSettings(): Promise<LocalSettings>;
  setSettings(patch: Partial<LocalSettings>): Promise<LocalSettings>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
  /** Only https://waronsaas.com/... and https://github.com/waronsaas/... URLs; main enforces the allowlist. */
  openExternal(url: string): Promise<void>;
}

/** Errors cross the bridge as `"<CODE>: <message>"`; the renderer splits them with this. */
export function splitBridgeError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  // Electron prefixes "Error invoking remote method 'wos:x': Error: ".
  const stripped = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  const m = /^([A-Z][A-Z0-9_]+): ([\s\S]*)$/.exec(stripped);
  return m ? { code: m[1]!, message: m[2]! } : { code: "INTERNAL", message: stripped };
}

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

export const IPC_CHANNELS = {
  appInfo: "wos:app-info",
  status: "wos:status",
  signIn: "wos:sign-in",
  signInCode: "wos:sign-in-code",
  signInCancel: "wos:sign-in-cancel",
  linkGithub: "wos:link-github",
  logout: "wos:logout",
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
  getSettings: "wos:get-settings",
  setSettings: "wos:set-settings",
  openExternal: "wos:open-external",
  /** main -> renderer only. */
  events: "wos:events",
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
}

export interface MyWork {
  leases: LeaseView[];
  tasks: TaskView[];
  attempts: AttemptView[];
}

export interface WosBridge {
  appInfo(): Promise<AppInfo>;
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

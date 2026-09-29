import type { AgentRole, ModelRef, ProviderId, ReasoningLevel, ReviewerSlot } from "./agent-policy.js";
import type {
  AuthorSummary,
  BuildSummary,
  ChangesetValidation,
  ContextManifest,
  ContextPlan,
  ProviderAttestation,
  TaskKind,
  ToolchainAttestation,
  ReviewVerdict,
  Ruling,
} from "./agent-io.js";
import type { AbuSummary, AttemptView, LeaseView, Me, TaskView } from "./domain.js";
import type { DomainEvent } from "./events.js";

/**
 * The ONE orchestration interface shared by wOS CLI and wOS Desktop (spec: "The CLI and Desktop
 * must use the same underlying orchestration logic"). @waronsaas/orchestrator implements it;
 * apps/cli and apps/desktop (main process only) call it. Neither app may call the control-plane
 * API for workflow steps directly — only through this interface.
 *
 * Every long operation streams OrchestratorEvents to an observer so the CLI can print and the
 * Desktop can render a terminal/activity pane from the same stream.
 */

export type PipelineStep = "LEASE" | "BUILD" | "VERIFY" | "REVIEW" | "QUALIFY" | "PR";

export type OrchestratorEvent =
  | { type: "sign_in"; status: "email_sent" | "waiting_for_code" | "redeemed" | "failed"; detail: string }
  | { type: "github_link"; status: "waiting_for_user" | "linked" | "refused" | "expired"; detail: string }
  | { type: "step"; step: PipelineStep; status: "started" | "passed" | "failed" | "waiting"; detail: string }
  | { type: "lease"; lease: LeaseView }
  | { type: "worktree"; path: string; baseSha: string }
  | { type: "context"; manifest: ContextManifest }
  | { type: "agent_started"; role: AgentRole; provider: ProviderId; model: string; reasoning: ReasoningLevel; pid: number }
  | { type: "agent_output"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "agent_exited"; exitCode: number; durationMs: number }
  | { type: "verify"; checkId: string; status: "running" | "passed" | "failed"; exitCode: number | null; outputTail: string }
  | { type: "scope"; validation: ChangesetValidation }
  | { type: "attempt"; attempt: AttemptView }
  | { type: "waiting"; reason: "ci" | "reviews" | "merge" | "revision_window"; since: string }
  | { type: "warning"; code: string; message: string }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type OrchestratorObserver = (event: OrchestratorEvent) => void;

/** How signIn obtains the second factor from the user (D8). */
export interface SignInPrompt {
  /** Resolves with the 8-character code the user typed ("ABCD-EFGH"). CLI: stdin prompt; Desktop: a field. */
  code(): Promise<string>;
  /** Desktop only: deep links received for the wos:// scheme while waiting. */
  deepLinks?: AsyncIterable<string>;
  signal?: AbortSignal;
}

export interface ProviderStatus extends ProviderAttestation {
  /** Human-readable problem, e.g. "codex not signed in". */
  problems: string[];
}

export interface LocalStatus {
  signedIn: boolean;
  me: Me | null;
  git: { installed: boolean; version: string | null };
  providers: ProviderStatus[];
  /** Roles this machine can currently serve, per Agent Policy. */
  eligibleRoles: AgentRole[];
  activeLeases: LeaseView[];
  workspaceRoot: string;
  /** The toolchain this device attests (contracts 4.2.0, B-0006-github-build); null before the first status run. */
  toolchain: ToolchainAttestation | null;
}

export interface BuildOptions {
  /** ABU id (uuid) or "<target>/<abuKey>". */
  abu: string;
  /** D15 (4.3.0): builder model; sent as claimBuild `model`. Omitted = the policy default (Opus when attested). */
  model?: ModelRef;
  /** Stop after local VERIFY + submission instead of waiting for reviews/PR. Default false for CLI, true for Desktop. */
  detachAfterSubmit?: boolean;
  signal?: AbortSignal;
}

export interface ReviewOptions {
  slot: ReviewerSlot;
  kinds?: Array<"roadmap_review" | "feature_review" | "implementation_review">;
  signal?: AbortSignal;
}

export interface AuthorOptions {
  /** Task id of a roadmap_author / feature_author / abu_revision / conflict_resolution task. */
  taskId: string;
  /** D15 (4.3.0): sent as claimTask `model` (authors, revisions; ignored by the server for conflict_resolution, which is Fable only). */
  model?: ModelRef;
  signal?: AbortSignal;
}

export type RunResult =
  | { ok: true; attempt: AttemptView | null; task: TaskView; output: AuthorSummary | BuildSummary | ReviewVerdict | Ruling | null }
  | { ok: false; code: string; message: string; task: TaskView | null };

export interface Orchestrator {
  /**
   * wos login (D8, contracts 2.0.0). Email sign-in: calls startEmailSignIn with the client's device public
   * key, keeps the poll secret in memory only, then completes with whichever arrives first: the code the
   * user types (prompt.code) or a `wos://auth?r=<requestId>&t=<linkToken>` deep link (Desktop only,
   * prompt.deepLinks) whose request id matches. Redeems with the poll secret, stores the session and
   * device id in the OS keychain. Never touches GitHub.
   */
  signIn(input: { email: string; deviceName: string }, prompt: SignInPrompt, observer: OrchestratorObserver): Promise<Me>;
  /**
   * wos link-github (D8). Requires a session. GitHub device flow brokered by the control plane
   * (startGithubLink flow "device" -> pollGithubLink); `openUrl` shows verificationUri and userCode.
   * Resolves with Me once linked; rejects with GITHUB_LINKED_ELSEWHERE / GITHUB_RESERVED as returned.
   */
  linkGithub(observer: OrchestratorObserver, openUrl: (url: string, userCode: string) => void): Promise<Me>;
  logout(): Promise<void>;
  /** wos status */
  status(): Promise<LocalStatus>;
  /** wos build <abu>: LEASE -> BUILD -> VERIFY -> (submit) -> REVIEW -> QUALIFY -> PR (server-driven after submit). */
  build(options: BuildOptions, observer: OrchestratorObserver): Promise<RunResult>;
  /** wos review: claim an assigned review and run it at the policy's required reasoning. */
  review(options: ReviewOptions, observer: OrchestratorObserver): Promise<RunResult>;
  /** wos roadmap / wos resolve / revision of an attempt: run an author-type task. */
  author(options: AuthorOptions, observer: OrchestratorObserver): Promise<RunResult>;
  /** wos propose */
  propose(input: { target: string; feature: string | null; title: string; body: string }): Promise<{ issueUrl: string }>;
  /** Resume work after a restart: re-attaches to active leases found on the server. */
  resume(observer: OrchestratorObserver): Promise<RunResult[]>;
  /** Release a lease and clean the worktree. */
  release(leaseId: string, reason: string): Promise<void>;
  /** Pure: what the orchestrator would pass to the CLI (for Desktop's "show command" and for tests). */
  describeInvocation(plan: ContextPlan): { binary: string; argv: string[]; env: Record<string, string> };

  // Read operations the CLI and Desktop need (contracts 4.2.0, B-0009-github-build): thin ApiClient calls, no
  // workflow logic. Public reads (targets, features, catalog, leaderboard) stay direct fetches of public routes.
  listClaimableAbus(target: string, feature: string): Promise<AbuSummary[]>;
  listOpenTasks(filter: { kind?: TaskKind; target?: string; feature?: string }): Promise<TaskView[]>;
  myWork(): Promise<{ leases: LeaseView[]; tasks: TaskView[]; attempts: AttemptView[] }>;
  events(after?: number): Promise<{ items: DomainEvent[]; lastId: number }>;
  /** contracts 4.4.0 (B-0003-desktop): account preferences through the orchestrator's session (PATCH /v1/me). */
  updateMe(patch: {
    displayName?: string | null;
    leaderboardOptIn?: boolean;
    followedTargets?: string[];
    progressEmails?: boolean;
  }): Promise<Me>;
}

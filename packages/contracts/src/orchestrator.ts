import type { AgentRole, ModelRef, ProviderId, ReasoningLevel, ReviewerSlot } from "./agent-policy.js";
import type {
  AuthorSummary,
  BuildSummary,
  ChangesetValidation,
  ContextManifest,
  ContextPlan,
  ProviderAttestation,
  ReviewVerdict,
  Ruling,
} from "./agent-io.js";
import type { AttemptView, LeaseView, Me, TaskView } from "./domain.js";

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
}

export interface BuildOptions {
  /** ABU id (uuid) or "<target>/<abuKey>". */
  abu: string;
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
  model?: ModelRef;
  signal?: AbortSignal;
}

export type RunResult =
  | { ok: true; attempt: AttemptView | null; task: TaskView; output: AuthorSummary | BuildSummary | ReviewVerdict | Ruling | null }
  | { ok: false; code: string; message: string; task: TaskView | null };

export interface Orchestrator {
  /** wos login: brokered GitHub device flow; stores the session in the OS keychain. */
  login(observer: OrchestratorObserver, openUrl: (url: string, userCode: string) => void): Promise<Me>;
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
}

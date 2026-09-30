/**
 * Build (D16): the built-in wOS app for contributing. Its main-process half is everything wOS Desktop did before
 * Amendment 01: Sniper List reads, the claimable units, the D15 model picker, BUILD and review runs through the ONE
 * orchestrator, my work, my events, contributions. No workflow logic lives here; this file validates nothing itself
 * (the shell validates every payload first), routes to the orchestrator, tags events with a run id, keeps a bounded
 * activity log and translates failure codes into plain words.
 *
 * S-40: the shell registers these channels as IPC handlers only while Build is entitled AND on for this device, and
 * calls `lapse()` when either stops holding: running builds and reviews are aborted and held leases released.
 */
import type { AgentPolicyDocument, LocalStatus, Me, ModelRef, Orchestrator, OrchestratorEvent, RunResult } from "@waronsaas/contracts";
import {
  BUILD_CHANNELS,
  type BuildChannel,
  type ContributionHistory,
  type DesktopEvent,
  type RunInfo,
  type RunKind,
  type RunSnapshot,
} from "../../../shared/ipc.js";
import { type PublicApi, PublicApiError } from "../../../main/public-api.js";
import type { SettingsStore } from "../../../main/settings.js";
import { type Payloads, ValidationError } from "../../../main/validate.js";
import { builderModelChoices } from "./models.js";

export interface BuildCoreDeps {
  orchestrator: Orchestrator;
  publicApi: PublicApi;
  settings: SettingsStore;
  policy: AgentPolicyDocument;
  emit: (event: DesktopEvent) => void;
  /** The shell's latest account (so contributions need no extra call). */
  me: () => Me | null;
  setMe: (me: Me | null) => void;
  newId?: () => string;
  now?: () => Date;
  log?: (msg: string) => void;
}

/** Failure explanations in plain words (the coordinator's D15 brief: explain NOT_ELIGIBLE and LIMIT_REACHED plainly). */
export function explainFailure(code: string, message: string, context: { kind: RunKind; leased: boolean; model: ModelRef | null }): string {
  const model = context.model ? context.model.toUpperCase() : "THE CHOSEN MODEL";
  switch (code) {
    case "NOT_ELIGIBLE":
      return context.kind === "build"
        ? `NOT ELIGIBLE. The control plane will not give this device a build lease with ${model}: either the model is not allowed for builders, or this device has not attested the CLI that runs it (signed in and installed). Run STATUS to attest again, or pick another model. Server: ${message}`
        : `NOT ELIGIBLE. This account or device may not take this review now. Server: ${message}`;
    case "NOT_ENTITLED":
      return `BUILD IS NOT ENABLED. None of your organizations has Build enabled, so the control plane refuses claims (S-40). Enable Build under APPS. Server: ${message}`;
    case "LIMIT_REACHED":
      return context.leased
        ? `LIMIT REACHED. The agent used every local repair loop the policy allows and the checks still fail. The lease is given back. ${message}`
        : `LIMIT REACHED. You already hold a build lease on this provider. One Claude build (OPUS) and one Codex build (ASTRA or SOL) can run at the same time. Wait for the running build on this provider to submit, or pick a model on the other provider. Server: ${message}`;
    case "RESOURCE_LOCKED":
      return `LOCKED. Another build holds a resource this unit needs. Pick another unit or try later. Server: ${message}`;
    case "GITHUB_REQUIRED":
      return "GITHUB REQUIRED. Link a GitHub account before taking a lease (D8).";
    case "UNAUTHENTICATED":
      return "SIGNED OUT. The session is missing or expired. Sign in again.";
    case "MODEL_MISMATCH":
      return `MODEL MISMATCH. The CLI reported a different model from the one the plan requires, so wOS refused to submit. ${message}`;
    case "SCOPE_VIOLATION":
      return `OUT OF SCOPE. The change touched paths outside the unit's write scope and was not submitted. ${message}`;
    case "ABORTED":
      return "ABORTED.";
    case "NETWORK":
      return `OFFLINE. The control plane is unreachable. ${message}`;
    default:
      return `${code}. ${message}`;
  }
}

interface Run extends RunInfo {
  events: OrchestratorEvent[];
  leased: boolean;
  abort: AbortController;
}

const RUN_EVENT_LIMIT = 800;
const MAX_RUNS_KEPT = 30;

export interface BuildCore {
  invoke(channel: BuildChannel, payload: Payloads[BuildChannel]): Promise<unknown>;
  /** S-40 lapsed: abort running builds and reviews, release every held lease. Never throws. */
  lapse(reason: string): Promise<{ aborted: number; released: string[] }>;
  settle(): Promise<void>;
  lastStatus(): LocalStatus | null;
}

export function createBuildCore(deps: BuildCoreDeps): BuildCore {
  const now = deps.now ?? (() => new Date());
  let counter = 0;
  const newId = deps.newId ?? (() => `run-${Date.now().toString(36)}-${(++counter).toString(36)}`);
  const log = deps.log ?? (() => undefined);
  let status: LocalStatus | null = null;
  const runs = new Map<string, Run>();
  const running = new Set<Promise<unknown>>();

  const emitOrchestrator = (runId: string | null, event: OrchestratorEvent) => {
    deps.emit({ kind: "orchestrator", runId, at: now().toISOString(), event });
  };

  const info = (r: Run): RunInfo => {
    const { events: _e, leased: _l, abort: _a, ...rest } = r;
    return rest;
  };

  function trimRuns() {
    if (runs.size <= MAX_RUNS_KEPT) return;
    for (const [id, r] of runs) {
      if (runs.size <= MAX_RUNS_KEPT) break;
      if (r.state !== "running") runs.delete(id);
    }
  }

  function startRun(
    kind: RunKind,
    subject: string,
    model: ModelRef | null,
    go: (observer: (e: OrchestratorEvent) => void, signal: AbortSignal) => Promise<RunResult>,
  ) {
    const run: Run = {
      id: newId(),
      kind,
      subject,
      model,
      startedAt: now().toISOString(),
      finishedAt: null,
      state: "running",
      code: null,
      explanation: null,
      attempt: null,
      events: [],
      leased: false,
      abort: new AbortController(),
    };
    runs.set(run.id, run);
    trimRuns();
    deps.emit({ kind: "run", run: info(run) });
    const observer = (e: OrchestratorEvent) => {
      if (e.type === "lease") run.leased = true;
      if (e.type === "attempt") run.attempt = e.attempt;
      run.events.push(e);
      if (run.events.length > RUN_EVENT_LIMIT) run.events.splice(0, run.events.length - RUN_EVENT_LIMIT);
      emitOrchestrator(run.id, e);
    };
    const finish = (result: RunResult) => {
      run.finishedAt = now().toISOString();
      if (result.ok) {
        run.state = "passed";
        if (result.attempt) run.attempt = result.attempt;
        const where = run.attempt ? ` ATTEMPT ${run.attempt.state.toUpperCase()}.` : "";
        run.explanation =
          kind === "build"
            ? `SUBMITTED.${where} Reviews, qualification and the PR are driven by the control plane; this pane keeps following the activity.`
            : "VERDICT SUBMITTED. It stays sealed until the round is revealed.";
      } else {
        run.state = "failed";
        run.code = result.code;
        run.explanation = explainFailure(result.code, result.message, { kind, leased: run.leased, model });
      }
      deps.emit({ kind: "run", run: info(run) });
    };
    const p = go(observer, run.abort.signal)
      .then(finish)
      .catch((e: unknown) => {
        const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "INTERNAL";
        finish({ ok: false, code, message: e instanceof Error ? e.message : String(e), task: null });
      })
      .finally(() => running.delete(p));
    running.add(p);
    return run.id;
  }

  async function refreshStatus(): Promise<LocalStatus> {
    status = await deps.orchestrator.status();
    deps.setMe(status.me);
    return status;
  }

  async function contributions(): Promise<ContributionHistory> {
    const account = deps.me() ?? (await refreshStatus()).me;
    const handle = account?.handle ?? null;
    if (!handle) {
      return {
        handle: null,
        profile: null,
        ledger: null,
        ledgerHiddenReason: "NO HANDLE YET. A handle is set when GitHub is first linked.",
      };
    }
    let profile: ContributionHistory["profile"] = null;
    try {
      profile = await deps.publicApi.get("getContributor", { params: { handle } });
    } catch (e) {
      if (!(e instanceof PublicApiError && e.code === "NOT_FOUND")) throw e;
    }
    if (!profile) {
      return {
        handle,
        profile: null,
        ledger: null,
        ledgerHiddenReason: "NO PUBLIC PROFILE YET. It appears after the first accepted contribution.",
      };
    }
    try {
      const page = await deps.publicApi.get("getContributorLedger", { params: { handle } });
      return { handle, profile, ledger: page.items, ledgerHiddenReason: null };
    } catch (e) {
      if (e instanceof PublicApiError && e.code === "NOT_FOUND") {
        return {
          handle,
          profile,
          ledger: null,
          ledgerHiddenReason: "HIDDEN. The token history is public only when you opt in to the leaderboard.",
        };
      }
      throw e;
    }
  }

  async function handle(channel: BuildChannel, p: unknown): Promise<unknown> {
    const C = BUILD_CHANNELS;
    switch (channel) {
      case C.status:
        return refreshStatus();
      case C.linkGithub: {
        const account = await deps.orchestrator.linkGithub(
          (e) => emitOrchestrator(null, e),
          (verificationUri, userCode) => deps.emit({ kind: "github_code", verificationUri, userCode }),
        );
        deps.setMe(account);
        return account;
      }
      case C.listTargets:
        return (await deps.publicApi.get("listTargets")).items;
      case C.getTarget:
        return deps.publicApi.get("getTarget", { params: p as Payloads["wos:get-target"] });
      case C.getFeature:
        return deps.publicApi.get("getFeature", { params: p as Payloads["wos:get-feature"] });
      case C.listClaimableAbus: {
        const { slug, feature } = p as Payloads["wos:list-claimable-abus"];
        return deps.orchestrator.listClaimableAbus(slug, feature);
      }
      case C.builderModels:
        return builderModelChoices(deps.policy, status ?? (await refreshStatus()));
      case C.build: {
        const { abu, model } = p as Payloads["wos:build"];
        const role = deps.policy.roles.find((r) => r.role === "builder");
        if (!role?.allowedModels.includes(model)) throw new ValidationError(`${model} is not a builder model`);
        const detachAfterSubmit = deps.settings.get().detachAfterSubmit;
        const runId = startRun("build", abu, model, (observer, signal) =>
          deps.orchestrator.build({ abu, model, detachAfterSubmit, signal }, observer),
        );
        return { runId };
      }
      case C.review: {
        const { slot } = p as Payloads["wos:review"];
        const runId = startRun("review", slot, null, (observer, signal) =>
          deps.orchestrator.review({ slot, kinds: ["implementation_review"], signal }, observer),
        );
        return { runId };
      }
      case C.release: {
        const { leaseId } = p as Payloads["wos:release"];
        await deps.orchestrator.release(leaseId, "released from wOS Desktop");
        return undefined;
      }
      case C.runs:
        return [...runs.values()].map((r): RunSnapshot => ({ ...info(r), events: [...r.events] }));
      case C.myWork:
        return deps.orchestrator.myWork();
      case C.myEvents:
        return deps.orchestrator.events((p as Payloads["wos:my-events"]).after);
      case C.contributions:
        return contributions();
      default:
        throw new ValidationError(`unknown channel ${String(channel)}`);
    }
  }

  return {
    invoke: (channel, payload) => handle(channel, payload),
    async lapse(reason) {
      let aborted = 0;
      for (const r of runs.values()) {
        if (r.state === "running") {
          r.abort.abort();
          aborted++;
        }
      }
      const released: string[] = [];
      try {
        const work = await deps.orchestrator.myWork();
        for (const lease of work.leases.filter((l) => l.state === "active")) {
          try {
            await deps.orchestrator.release(lease.id, `Build turned off on this device: ${reason}`);
            released.push(lease.id);
          } catch (e) {
            log(`lease ${lease.id} not released: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (e) {
        log(`could not list leases to release: ${e instanceof Error ? e.message : String(e)}`);
      }
      status = null;
      return { aborted, released };
    },
    async settle() {
      while (running.size) await Promise.allSettled([...running]);
    },
    lastStatus: () => status,
  };
}

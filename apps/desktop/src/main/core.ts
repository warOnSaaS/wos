/**
 * DesktopCore: everything the main process does for the renderer, with no Electron import, so it is
 * tested against the real orchestrator (fake and real control planes). One call per bridge method; no
 * workflow logic lives here — builds, reviews, sign-in and GitHub linking are the ONE orchestrator's
 * (packages/orchestrator/README.md). This file only validates, routes, tags events with a run id, keeps
 * a bounded activity log and translates failure codes into plain words.
 */
import type {
  AgentPolicyDocument,
  LocalStatus,
  Me,
  ModelRef,
  Orchestrator,
  OrchestratorEvent,
  RunResult,
  SignInPrompt,
} from "@waronsaas/contracts";
import {
  type AppInfo,
  type ContributionHistory,
  type DesktopEvent,
  IPC_CHANNELS,
  type InvokeChannel,
  type RunInfo,
  type RunKind,
  type RunSnapshot,
} from "../shared/ipc.js";
import { builderModelChoices } from "./models.js";
import { type PublicApi, PublicApiError } from "./public-api.js";
import { isAllowedExternalUrl, parseAuthDeepLink } from "./security.js";
import type { SettingsStore } from "./settings.js";
import { type Payloads, ValidationError, validatePayload } from "./validate.js";

export interface CoreDeps {
  orchestrator: Orchestrator;
  publicApi: PublicApi;
  settings: SettingsStore;
  policy: AgentPolicyDocument;
  appInfo: AppInfo;
  emit: (event: DesktopEvent) => void;
  /** shell.openExternal, called only after the allowlist passed. */
  openExternal: (url: string) => Promise<void>;
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

interface Run extends RunInfo {
  events: OrchestratorEvent[];
  leased: boolean;
  abort: AbortController;
}

const RUN_EVENT_LIMIT = 800;
const MAX_RUNS_KEPT = 30;

export interface DesktopCore {
  invoke(channel: InvokeChannel, payload: unknown): Promise<unknown>;
  /** wos:// URLs from open-url / second-instance / argv. Returns true when it was accepted. */
  handleDeepLink(url: string): boolean;
  /** Waits for every running build/review (tests, shutdown). */
  settle(): Promise<void>;
  lastStatus(): LocalStatus | null;
}

export function createDesktopCore(deps: CoreDeps): DesktopCore {
  const now = deps.now ?? (() => new Date());
  let counter = 0;
  const newId = deps.newId ?? (() => `run-${Date.now().toString(36)}-${(++counter).toString(36)}`);
  const log = deps.log ?? (() => undefined);
  let status: LocalStatus | null = null;
  let me: Me | null = null;
  let signIn: SignInSession | null = null;
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
    me = status.me;
    return status;
  }

  async function contributions(): Promise<ContributionHistory> {
    const account = me ?? (await refreshStatus()).me;
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

  async function handle<K extends InvokeChannel>(channel: K, p: Payloads[K]): Promise<unknown> {
    const C = IPC_CHANNELS;
    switch (channel) {
      case C.appInfo:
        return deps.appInfo;
      case C.status:
        return refreshStatus();
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
          const account = await deps.orchestrator.signIn({ email, deviceName: deps.settings.get().deviceName }, prompt, (e) =>
            emitOrchestrator(null, e),
          );
          me = account;
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
      case C.linkGithub: {
        const account = await deps.orchestrator.linkGithub(
          (e) => emitOrchestrator(null, e),
          (verificationUri, userCode) => deps.emit({ kind: "github_code", verificationUri, userCode }),
        );
        me = account;
        return account;
      }
      case C.logout:
        await deps.orchestrator.logout();
        me = null;
        status = null;
        return undefined;
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
      default:
        throw new ValidationError(`unknown channel ${String(channel)}`);
    }
  }

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
    async settle() {
      while (running.size) await Promise.allSettled([...running]);
    },
    lastStatus: () => status,
  };
}

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

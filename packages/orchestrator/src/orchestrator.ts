/**
 * The one workflow driver behind `wos` and wOS Desktop. Every step goes through the typed ApiClient;
 * every local side effect goes through the injected ProcessRunner, SecretStore and github/local.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, matchesGlob } from "node:path";
import { buildInvocation, DEFAULT_POLICY } from "@waronsaas/agent-policy";
import { buildContext, type SnapshotReader } from "@waronsaas/context-engine";
import {
  type AgentRunRecord,
  type AttemptView,
  type AuthorOptions,
  type BuildOptions,
  AuthorSummary,
  BuildSummary,
  type Changeset,
  type ChangesetFile,
  type ChangesetValidation,
  type ClaimResponse,
  type ContextPlan,
  type LocalStatus,
  type Me,
  type SignInPrompt,
  type ToolchainAttestation,
  type OrchestratorObserver,
  type PipelineStep,
  type ProviderStatus,
  RepoManifest,
  ReviewVerdict,
  Ruling,
  type RunResult,
  type TaskView,
} from "@waronsaas/contracts";
import { canonicalJson, canonicalSha256, sha256Of, submissionSha256 } from "@waronsaas/contracts/canonical";
import { captureChanges, createWorktree, isBlockingRejection, removeWorktree, type WorktreeHandle } from "@waronsaas/github/local";
import { parseBuildGraphYaml } from "@waronsaas/planning";
import { validateChangeset } from "@waronsaas/verification";
import { ApiCallError, createApiClient } from "./api-client.js";
import { offAllowlist, parseAgentEvents } from "./agent-events.js";
import type { ApiClient, Engines, OrchestratorDeps } from "./index.js";
import { resolveBinary } from "./resolve-binary.js";
import {
  deviceKey,
  idempotencyKey,
  readSession,
  SESSION_KEY,
  type StoredSession,
  sessionAccessToken,
  signAgentRunWithDevice,
  signChangesetWithDevice,
  writeSession,
} from "./session.js";

/** ANSI colour sequences (ESC [ ... m), stripped from CLI listings before matching. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const TERMINAL = new Set(["merged", "expired", "abandoned", "failed", "closed_unmerged", "superseded"]);
const OUTPUT_TAIL = 2000;

/** Local record of an attempt this machine drives, so `resume` works after a process restart. */
interface AttemptState {
  attemptId: string;
  abu: string;
  leaseId: string | null;
  taskId: string;
  plan: ContextPlan | null;
  worktree: WorktreeHandle | null;
  submitted: boolean;
}

class StepError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable = false,
  ) {
    super(message);
  }
}

function tail(s: string): string {
  return s.length > OUTPUT_TAIL ? s.slice(-OUTPUT_TAIL) : s;
}

function gitOut(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((res, rej) =>
    execFile("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "buffer", maxBuffer: 1 << 30 }, (e, out, err) =>
      e ? rej(new Error(`git ${args.join(" ")}: ${err.toString()}`)) : res(out),
    ),
  );
}

export class OrchestratorImpl {
  private readonly api: ApiClient;
  private readonly engines: Engines;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;

  constructor(private readonly deps: OrchestratorDeps) {
    this.engines = {
      buildContext,
      buildInvocation,
      validateChangeset,
      parseBuildGraphYaml,
      policy: DEFAULT_POLICY,
      ...deps.engines,
    };
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = deps.pollIntervalMs ?? 5000;
    this.api = createApiClient({
      baseUrl: deps.apiBaseUrl,
      fetch: deps.fetch,
      clientKind: deps.clientKind,
      clientVersion: deps.clientVersion,
      accessToken: () => this.accessToken(),
    });
  }

  // ------------------------------------------------------------------------------ session

  private async accessToken(): Promise<string | null> {
    // Shared single-flight refresh (session.ts): other readers of the same SecretStore never race this one.
    return sessionAccessToken(this.deps.secrets, (refreshToken) => this.api.call("refreshSession", { body: { refreshToken } }), this.now);
  }

  private async session(): Promise<StoredSession> {
    const s = await readSession(this.deps.secrets);
    if (!s) throw new StepError("UNAUTHENTICATED", "not signed in: run `wos login`");
    return s;
  }

  /**
   * D8 email sign-in. The poll secret lives only in this call's memory. Completes with whichever
   * arrives first: a code the user types, or a `wos://auth?r=<requestId>&t=<token>` deep link whose
   * request id matches (links for other requests are ignored).
   */
  async signIn(input: { email: string; deviceName: string }, prompt: SignInPrompt, observer: OrchestratorObserver): Promise<Me> {
    const { publicKeyBase64 } = await deviceKey(this.deps.secrets);
    const start = await this.api.call("startEmailSignIn", {
      body: { email: input.email, clientKind: this.deps.clientKind, deviceName: input.deviceName, devicePublicKey: publicKeyBase64 },
    });
    const pollSecret = start.pollSecret;
    if (!pollSecret) throw new StepError("INTERNAL", "the server returned no poll secret to a desktop/CLI client");
    observer({ type: "sign_in", status: "email_sent", detail: `sign-in email sent to ${input.email}` });
    observer({ type: "sign_in", status: "waiting_for_code", detail: "type the 8-character code from the email, or open the link" });

    const never = new Promise<never>(() => undefined);
    const aborted = prompt.signal
      ? new Promise<never>((_r, rej) =>
          prompt.signal!.addEventListener("abort", () => rej(new StepError("ABORTED", "sign-in cancelled", true)), { once: true }),
        )
      : never;
    const fromLinks = (async (): Promise<{ linkToken: string }> => {
      if (!prompt.deepLinks) return never;
      for await (const link of prompt.deepLinks) {
        const token = parseAuthDeepLink(link, start.requestId);
        if (token) return { linkToken: token };
        observer({ type: "warning", code: "DEEP_LINK_IGNORED", message: "ignored a wos:// link that does not belong to this sign-in" });
      }
      return never;
    })();

    const maxCodeTries = 5;
    for (let tries = 0; ; tries++) {
      const fromCode = prompt.code().then((code) => ({ code: code.trim().toUpperCase() }));
      const got = await Promise.race([fromCode, fromLinks, aborted]);
      try {
        const r = await this.api.call("redeemEmailSignIn", {
          body: {
            requestId: start.requestId,
            pollSecret,
            linkToken: "linkToken" in got ? got.linkToken : null,
            code: "code" in got ? got.code : null,
          },
        });
        if (!r.deviceId) throw new StepError("INTERNAL", "the server registered no device for this client");
        await writeSession(this.deps.secrets, {
          accessToken: r.accessToken,
          accessExpiresAt: r.accessExpiresAt,
          refreshToken: r.refreshToken,
          refreshExpiresAt: r.refreshExpiresAt,
          deviceId: r.deviceId,
        });
        observer({ type: "sign_in", status: "redeemed", detail: `signed in as ${r.me.email}` });
        return r.me;
      } catch (e) {
        const retry = e instanceof ApiCallError && e.code === "UNAUTHENTICATED" && "code" in got && tries + 1 < maxCodeTries;
        observer({ type: "sign_in", status: retry ? "waiting_for_code" : "failed", detail: e instanceof Error ? e.message : String(e) });
        if (!retry) throw e;
      }
    }
  }

  /** D8: link GitHub (brokered device flow) for a signed-in account. */
  async linkGithub(observer: OrchestratorObserver, openUrl: (url: string, userCode: string) => void): Promise<Me> {
    await this.session();
    const me = await this.api.call("getMe", {});
    if (me.github) {
      observer({ type: "github_link", status: "linked", detail: `already linked to ${me.github.login}` });
      return me;
    }
    const start = await this.api.call("startGithubLink", { body: { flow: "device" } });
    if (start.flow !== "device") throw new StepError("INTERNAL", "server did not start a device flow");
    openUrl(start.verificationUri, start.userCode);
    observer({ type: "github_link", status: "waiting_for_user", detail: `enter ${start.userCode} at ${start.verificationUri}` });
    for (;;) {
      await this.sleep(Math.max(this.pollMs, start.intervalSeconds * 1000));
      let r: Awaited<ReturnType<typeof this.api.call<"pollGithubLink">>>;
      try {
        r = await this.api.call("pollGithubLink", { body: { linkId: start.linkId } });
      } catch (e) {
        if (e instanceof ApiCallError && (e.code === "GITHUB_LINKED_ELSEWHERE" || e.code === "GITHUB_RESERVED")) {
          observer({ type: "github_link", status: "refused", detail: e.message });
        }
        throw e;
      }
      if (r.status === "linked") {
        observer({ type: "github_link", status: "linked", detail: `linked ${r.me.github?.login ?? ""}`.trim() });
        return r.me;
      }
      if (r.status === "denied" || r.status === "expired") {
        observer({
          type: "github_link",
          status: r.status === "denied" ? "refused" : "expired",
          detail: `GitHub authorization ${r.status}`,
        });
        throw new StepError(`GITHUB_LINK_${r.status.toUpperCase()}`, `GitHub authorization ${r.status}`, true);
      }
    }
  }

  async logout(): Promise<void> {
    if (await readSession(this.deps.secrets)) await this.api.call("logout", {}).catch(() => undefined);
    await this.deps.secrets.delete(SESSION_KEY);
  }

  // ------------------------------------------------------------------------------ status

  async status(): Promise<LocalStatus> {
    const session = await readSession(this.deps.secrets);
    const me = session ? await this.api.call("getMe", {}).catch(() => null) : null;
    const gitV = await this.capture("git", ["--version"]);
    const providers: ProviderStatus[] = [];
    for (const p of this.engines.policy.providers) {
      const bin = this.binaryFor(p);
      const v = await this.capture(bin, p.versionCommand.slice(1));
      const auth = v.ok && p.authCheckCommand ? await this.capture(bin, p.authCheckCommand.slice(1)) : null;
      // contracts 5.17.0: a provider may say how its auth listing shows a sign-in (opencode: "OpenCode Go api"). The
      // listing names providers and methods, never secrets; ANSI colour codes are stripped first.
      const plain = auth?.out.replace(ANSI, "") ?? "";
      const custom = p.authSignedIn ? new RegExp(p.authSignedIn.pattern).test(plain) : null;
      const signedIn = auth?.ok === true && (custom ?? /("loggedIn"\s*:\s*true|Logged in)/i.test(auth.out));
      const authMethod = auth?.ok
        ? custom
          ? p.authSignedIn!.method
          : (/"authMethod"\s*:\s*"([^"]+)"/.exec(auth.out)?.[1] ?? (/using (\w+)/i.exec(auth.out)?.[1] || null))
        : null;
      const problems: string[] = [];
      if (!v.ok && !p.optional) problems.push(`${p.binary} not installed`);
      else if (!signedIn) problems.push(`${p.binary} not signed in`);
      providers.push({
        provider: p.id,
        installed: v.ok,
        cliVersion: v.ok ? (/\d+\.\d+\.\d+/.exec(v.out)?.[0] ?? null) : null,
        signedIn,
        authMethod,
        models: this.engines.policy.models.filter((m) => m.provider === p.id).map((m) => m.ref),
        checkedAt: this.now().toISOString(),
        problems,
      });
    }
    const ready = new Set(providers.filter((p) => p.installed && p.signedIn).flatMap((p) => p.models));
    const eligibleRoles = this.engines.policy.roles.filter((r) => r.allowedModels.some((m) => ready.has(m))).map((r) => r.role);
    const toolchain = await this.collectToolchain();
    // D13: the attestation the control plane matches against a repo's toolchainRequirements at claim time.
    if (me?.canContribute && session) {
      const providerAttestations = providers.map(({ problems: _p, ...a }) => a);
      await this.api.call("postAttestation", {
        body: { deviceId: session.deviceId, providers: providerAttestations, toolchain },
        idempotencyKey: idempotencyKey("postAttestation", session.deviceId, canonicalJson({ providerAttestations, toolchain })),
      });
    }
    const work = me?.canContribute ? await this.api.call("getMyWork", {}).catch(() => null) : null;
    return {
      signedIn: me !== null,
      me,
      git: { installed: gitV.ok, version: gitV.ok ? (/\d+\.\d+\.\d+/.exec(gitV.out)?.[0] ?? null) : null },
      providers,
      eligibleRoles,
      activeLeases: work?.leases.filter((l) => l.state === "active") ?? [],
      workspaceRoot: this.deps.workspaceRoot,
      // contracts 4.2.0 (B-0006-github-build), integration glue: status shows what was attested.
      toolchain,
    };
  }

  /**
   * D13 ToolchainAttestation: os and os version, then the tools wOS knows how to detect. Tool names:
   * "node", "xcode" (macOS only, `xcodebuild -version`), "android-sdk" (`sdkmanager --version`).
   * The shared vocabulary for tool names is not yet in the contracts (blockers/B-0006-github-build.md).
   */
  async collectToolchain(): Promise<ToolchainAttestation> {
    const platform = this.deps.platform ?? process.platform;
    const os: ToolchainAttestation["os"] = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";
    const firstVersion = (text: string) => /\d+(?:\.\d+)+/.exec(text)?.[0] ?? null;
    const osProbe =
      os === "macos"
        ? await this.capture("sw_vers", ["-productVersion"])
        : os === "linux"
          ? await this.capture("uname", ["-r"])
          : await this.capture("cmd", ["/c", "ver"]);
    const rawOs = osProbe.ok ? osProbe.out.trim().split("\n")[0]!.trim() : "";
    const osVersion = (os === "windows" ? firstVersion(rawOs) : rawOs) || "unknown";
    const tools: ToolchainAttestation["tools"] = [];
    const probe = async (name: ToolchainAttestation["tools"][number]["name"], binary: string, argv: string[]) => {
      const r = await this.capture(binary, argv);
      const version = r.ok ? firstVersion(r.out) : null;
      if (version) tools.push({ name, version });
    };
    await probe("node", "node", ["--version"]);
    if (os === "macos") await probe("xcode", "xcodebuild", ["-version"]);
    await probe("android-sdk", "sdkmanager", ["--version"]);
    return { os, osVersion, tools, checkedAt: this.now().toISOString() };
  }

  /**
   * contracts 5.17.0: the binary to spawn for a provider. On PATH (the agent environment's PATH) it is the bare name;
   * otherwise the first existing match of the provider's `binarySearchPaths` (e.g. opencode under another Node version's
   * nvm tree), newest first; else the bare name (and the spawn fails as "not installed").
   */
  private binaryFor(p: { binary: string; binarySearchPaths?: string[] }): string {
    const cached = this.binaries.get(p.binary);
    if (cached) return cached;
    const found = this.deps.resolveBinary
      ? this.deps.resolveBinary(p.binary, p.binarySearchPaths ?? [])
      : resolveBinary(p.binary, p.binarySearchPaths ?? [], this.baseEnv().PATH ?? "", this.baseEnv().HOME ?? null);
    this.binaries.set(p.binary, found);
    return found;
  }
  private readonly binaries = new Map<string, string>();

  private async capture(binary: string, argv: string[]): Promise<{ ok: boolean; out: string }> {
    await mkdir(this.deps.workspaceRoot, { recursive: true });
    let out = "";
    try {
      const r = await this.deps.processes.run({
        binary,
        argv,
        cwd: this.deps.workspaceRoot,
        env: this.baseEnv(),
        stdin: "",
        timeoutMs: 15_000,
        onStdout: (c) => {
          out += c;
        },
        onStderr: (c) => {
          out += c;
        },
      });
      return { ok: r.exitCode === 0, out };
    } catch {
      return { ok: false, out };
    }
  }

  private baseEnv(): Record<string, string> {
    if (this.deps.baseEnv) return { ...this.deps.baseEnv };
    const env: Record<string, string> = {};
    for (const k of ["PATH", "HOME", "USER", "LANG", "TMPDIR"]) {
      const v = process.env[k];
      if (v !== undefined) env[k] = v;
    }
    return env;
  }

  // Read operations for the CLI and Desktop (contracts 4.2.0, B-0009-github-build), integration glue:
  // thin ApiClient calls with no workflow logic.
  async listClaimableAbus(target: string, feature: string) {
    return (await this.api.call("listClaimableAbus", { params: { slug: target, feature } })).items;
  }

  async listOpenTasks(filter: { kind?: TaskView["kind"]; target?: string; feature?: string }) {
    return (await this.api.call("listOpenTasks", { query: filter })).items;
  }

  async myWork() {
    return this.api.call("getMyWork", {});
  }

  // contracts 4.4.0 (B-0003-desktop), integration glue.
  async updateMe(patch: { displayName?: string | null; leaderboardOptIn?: boolean; followedTargets?: string[]; progressEmails?: boolean }) {
    return this.api.call("updateMe", { body: patch });
  }

  async events(after?: number) {
    return this.api.call("listMyEvents", { query: after === undefined ? {} : { after } });
  }

  describeInvocation(plan: ContextPlan): { binary: string; argv: string[]; env: Record<string, string> } {
    const inv = this.engines.buildInvocation(
      plan,
      { cwd: "<worktree>", schemaPath: "<schema.json>", lastMessagePath: "<last-message.json>", sessionId: "<session-id>" },
      this.engines.policy,
    );
    return { binary: inv.binary, argv: inv.argv, env: inv.env };
  }

  // ------------------------------------------------------------------------------ local state

  private stateDir(): string {
    return join(this.deps.workspaceRoot, "state");
  }

  private async saveState(s: AttemptState): Promise<void> {
    await mkdir(this.stateDir(), { recursive: true });
    await writeFile(join(this.stateDir(), `attempt-${s.attemptId}.json`), JSON.stringify(s, null, 2));
  }

  private async dropState(attemptId: string): Promise<void> {
    await rm(join(this.stateDir(), `attempt-${attemptId}.json`), { force: true });
  }

  private async listStates(): Promise<AttemptState[]> {
    const names = await readdir(this.stateDir()).catch(() => [] as string[]);
    const out: AttemptState[] = [];
    for (const n of names.sort()) {
      if (!n.startsWith("attempt-") || !n.endsWith(".json")) continue;
      out.push(JSON.parse(await readFile(join(this.stateDir(), n), "utf8")) as AttemptState);
    }
    return out;
  }

  // ------------------------------------------------------------------------------ build

  async build(options: BuildOptions, observer: OrchestratorObserver): Promise<RunResult> {
    const emit = observer;
    let task: TaskView | null = null;
    try {
      const s = await this.session();
      const abuId = await this.resolveAbu(options.abu);
      this.step(emit, "LEASE", "started", `claiming ${options.abu}`);
      const claim = await this.api.call("claimBuild", {
        params: { id: abuId },
        // D15 (4.3.0): the contributor's model choice; omitted = the policy default.
        body: { deviceId: s.deviceId, ...(options.model ? { model: options.model } : {}) },
        idempotencyKey: idempotencyKey("claimBuild", abuId, s.deviceId, options.model ?? "", this.now().toISOString().slice(0, 16)),
      });
      task = claim.task;
      if (!claim.attempt) throw new StepError("INTERNAL", "claimBuild returned no attempt");
      emit({ type: "lease", lease: claim.lease });
      emit({ type: "attempt", attempt: claim.attempt });
      this.step(emit, "LEASE", "passed", `lease ${claim.lease.id} until ${claim.lease.expiresAt}`);
      const state: AttemptState = {
        attemptId: claim.attempt.id,
        abu: claim.attempt.abu,
        leaseId: claim.lease.id,
        taskId: claim.task.id,
        plan: claim.contextPlan,
        worktree: null,
        submitted: false,
      };
      await this.saveState(state);
      return await this.drive(state, claim, options.detachAfterSubmit ?? this.deps.clientKind === "desktop", emit, options.signal);
    } catch (e) {
      return this.failure(e, task, emit);
    }
  }

  private failure(e: unknown, task: TaskView | null, emit: OrchestratorObserver): RunResult {
    const code = e instanceof StepError || e instanceof ApiCallError ? e.code : "INTERNAL";
    const message = e instanceof Error ? e.message : String(e);
    emit({ type: "error", code, message, recoverable: e instanceof StepError ? e.recoverable : false });
    return { ok: false, code, message, task };
  }

  private step(emit: OrchestratorObserver, step: PipelineStep, status: "started" | "passed" | "failed" | "waiting", detail: string) {
    emit({ type: "step", step, status, detail });
  }

  private async resolveAbu(ref: string): Promise<string> {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) return ref;
    const m = /^([a-z][a-z0-9-]+)\/([a-z][a-z0-9-]+)#(\d{2})$/.exec(ref);
    if (!m) throw new StepError("VALIDATION_FAILED", `ABU must be an id or <target>/<feature>#<nn>, got ${JSON.stringify(ref)}`);
    const list = await this.api.call("listClaimableAbus", { params: { slug: m[1]!, feature: m[2]! } });
    const found = list.items.find((a) => a.key === `${m[2]}#${m[3]}`);
    if (!found) throw new StepError("NOT_FOUND", `no ABU ${m[2]}#${m[3]} in ${m[1]}`);
    return found.id;
  }

  /** From a fresh claim (or a revision claim) through submission, then the server-driven wait. */
  private async drive(
    state: AttemptState,
    claim: ClaimResponse,
    detach: boolean,
    emit: OrchestratorObserver,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    let current = claim;
    for (;;) {
      const attempt = await this.buildAndSubmit(state, current, emit, signal);
      if (detach) return { ok: true, attempt, task: current.task, output: null };
      const next = await this.waitForOutcome(state, emit, signal);
      if (next.kind === "done") return next.result;
      current = next.claim;
    }
  }

  private heartbeat(leaseId: string, seconds: number, phase: { value: string }): { stop: () => void; lost: () => string | null } {
    let lost: string | null = null;
    const beat = async () => {
      try {
        const s = await this.session();
        await this.api.call("heartbeat", { params: { id: leaseId }, body: { deviceId: s.deviceId, phase: phase.value } });
      } catch (e) {
        if (e instanceof ApiCallError && (e.code === "LEASE_EXPIRED" || e.code === "LEASE_NOT_HELD")) lost = e.code;
      }
    };
    const timer = setInterval(() => void beat(), Math.max(1, seconds) * 1000);
    timer.unref?.();
    return { stop: () => clearInterval(timer), lost: () => lost };
  }

  private async buildAndSubmit(
    state: AttemptState,
    claim: ClaimResponse,
    emit: OrchestratorObserver,
    signal?: AbortSignal,
  ): Promise<AttemptView | null> {
    const plan = claim.contextPlan;
    const lease = claim.lease;
    const phase = { value: "building" };
    const hb = this.heartbeat(lease.id, lease.heartbeatSeconds, phase);
    const check = () => {
      if (signal?.aborted) throw new StepError("ABORTED", "aborted by the user", true);
      const l = hb.lost();
      if (l) throw new StepError(l, `lease ${lease.id} lost (${l})`);
    };
    try {
      const name = `a-${state.attemptId.replace(/-/g, "").slice(0, 8)}-${lease.id.replace(/-/g, "").slice(0, 8)}`;
      if (state.worktree && state.worktree.baseSha !== plan.source.commit) {
        await removeWorktree(state.worktree).catch(() => undefined);
        state.worktree = null;
      }
      const wt = state.worktree ?? (await createWorktree(this.deps.workspaceRoot, plan.source.repo, plan.source.commit, name));
      Object.assign(state, { worktree: wt, leaseId: lease.id, taskId: claim.task.id, plan, submitted: false });
      await this.saveState(state);
      emit({ type: "worktree", path: wt.path, baseSha: wt.baseSha });

      const limit = this.engines.policy.limits.maxLocalRepairLoops;
      let localOutput: string | null = null;
      for (let loop = 0; ; loop++) {
        check();
        this.step(emit, "BUILD", "started", loop === 0 ? `building ${state.abu}` : `local repair ${loop} of ${limit}`);
        const failing = localOutput;
        const ctx = await this.engines.buildContext(
          plan,
          this.snapshotReader(wt, plan, lease.id, () => failing),
          this.engines.policy,
        );
        emit({ type: "context", manifest: ctx.manifest });
        // One manifest per agent run (contracts 2.0.0): a repair run's manifest includes local:verification-output.
        await this.api.call("postManifest", {
          params: { id: lease.id },
          body: ctx.manifest,
          idempotencyKey: idempotencyKey("postManifest", lease.id, ctx.manifest.manifestSha256),
        });
        const run = await this.runAgent(plan, ctx.prompt, ctx.manifest.manifestSha256, wt.path, lease.id, emit, signal);
        const summary = BuildSummary.safeParse(run.output);
        if (!summary.success) throw new StepError("AGENT_OUTPUT_INVALID", "the agent's output does not match build-summary.v1", true);
        this.step(emit, "BUILD", "passed", summary.data.summary.slice(0, 200));
        check();

        phase.value = "verifying";
        const toVerify = await this.api.call("setAttemptPhase", {
          params: { id: state.attemptId },
          body: { phase: "verifying", localRepair: false },
          idempotencyKey: idempotencyKey("verifying", state.attemptId, lease.id, String(loop)),
        });
        emit({ type: "attempt", attempt: toVerify });
        this.step(emit, "VERIFY", "started", "local verification (untrusted; CI re-runs everything)");
        const verification = await this.verifyLocally(wt, plan, emit, signal);
        const { changeset, validation } = await this.assemble(wt, plan, run.manifestSha256, summary.data, verification.results, lease.id);
        emit({ type: "scope", validation });
        const failed = !verification.ok || !validation.ok;
        if (!failed && changeset) {
          const res = await this.api.call("submitChangeset", {
            params: { id: lease.id },
            body: changeset,
            idempotencyKey: idempotencyKey("submitChangeset", lease.id, changeset.submissionSha256),
          });
          emit({ type: "scope", validation: res.validation });
          if (res.validation.ok) {
            if (res.attempt) emit({ type: "attempt", attempt: res.attempt });
            this.step(emit, "VERIFY", "passed", `submitted ${changeset.files.length} file(s), ${changeset.submissionSha256}`);
            state.submitted = true;
            state.leaseId = null;
            await this.saveState(state);
            return res.attempt;
          }
        }
        this.step(emit, "VERIFY", "failed", verification.ok ? "scope validation failed" : `check ${verification.failedId} failed`);
        localOutput = renderVerificationOutput(verification, validation);
        if (loop + 1 > limit) throw new StepError("LIMIT_REACHED", `local verification still failing after ${limit} repair loops`);
        phase.value = "building";
        const back = await this.api.call("setAttemptPhase", {
          params: { id: state.attemptId },
          body: { phase: "building", localRepair: true },
          idempotencyKey: idempotencyKey("repair", state.attemptId, lease.id, String(loop)),
        });
        emit({ type: "attempt", attempt: back });
      }
    } finally {
      hb.stop();
    }
  }

  private snapshotReader(wt: WorktreeHandle, plan: ContextPlan, leaseId: string, localOutput: () => string | null): SnapshotReader {
    const api = this.api;
    return {
      async readFile(path) {
        const oid = (await gitOut(wt.path, ["rev-parse", "--verify", "-q", `${wt.baseSha}:${path}`]).catch(() => null))?.toString().trim();
        if (!oid) return null;
        const bytes = await gitOut(wt.path, ["cat-file", "blob", oid]);
        return { bytes: new Uint8Array(bytes), gitBlobOid: oid };
      },
      async listFiles(glob) {
        const out = await gitOut(wt.path, ["ls-tree", "-r", "-z", "--name-only", "--full-tree", wt.baseSha]);
        return out
          .toString("utf8")
          .split("\0")
          .filter((p) => p !== "" && matchesGlob(p, glob))
          .sort();
      },
      // contracts 3.1.0 (B-0005-github-build): local documents go through readLocalDocument only; null = absent.
      async readLocalDocument(ref) {
        if (ref !== LOCAL_VERIFICATION_REF) return null;
        const text = localOutput();
        return text === null ? null : new TextEncoder().encode(text);
      },
      async readServerDocument(ref) {
        if (ref === LOCAL_VERIFICATION_REF) throw new StepError("FORBIDDEN", `${ref} is a local document`);
        const selector = plan.artifacts.find((a) => a.kind === "server_document" && a.ref === ref);
        if (selector?.kind !== "server_document") throw new StepError("FORBIDDEN", `server document ${ref} is not in this lease's plan`);
        const doc = await api.call("getLeaseDocument", { params: { id: leaseId }, query: { ref } });
        const bytes = Buffer.from(doc.contentBase64, "base64");
        if (doc.ref !== ref || doc.sha256 !== selector.sha256 || sha256Of(bytes) !== selector.sha256) {
          throw new StepError("DOCUMENT_MISMATCH", `server document ${ref} does not match the plan's sha256`);
        }
        return new Uint8Array(bytes);
      },
    };
  }

  private async runAgent(
    plan: ContextPlan,
    prompt: string,
    manifestSha256: string,
    cwd: string,
    leaseId: string,
    emit: OrchestratorObserver,
    signal?: AbortSignal,
  ): Promise<{ output: unknown; manifestSha256: string; agentRunId: string }> {
    const s = await this.session();
    const tmp = join(this.deps.workspaceRoot, "tmp", leaseId);
    await mkdir(tmp, { recursive: true });
    const sessionId = crypto.randomUUID();
    const paths = {
      cwd,
      schemaPath: join(tmp, "schema.json"),
      lastMessagePath: join(tmp, "last-message.json"),
      sessionId,
      configHome: join(tmp, "config-home"),
    };
    const inv = this.engines.buildInvocation(plan, paths, this.engines.policy);
    await writeFile(paths.schemaPath, inv.outputSchemaJson);
    await rm(paths.lastMessagePath, { force: true });
    await rm(paths.configHome, { recursive: true, force: true });
    await mkdir(paths.configHome, { recursive: true });
    if (inv.outputFile) await rm(join(cwd, inv.outputFile), { force: true });
    let stdout = "";
    let stderr = "";
    const startedAt = this.now().toISOString();
    let pid = 0;
    let started = false;
    const announce = () => {
      if (started) return;
      started = true;
      emit({ type: "agent_started", role: plan.role, provider: plan.provider, model: plan.modelId, reasoning: plan.reasoning, pid });
    };
    const spec = this.engines.policy.providers.find((p) => p.id === plan.provider);
    const res = await this.deps.processes.run({
      binary: spec ? this.binaryFor(spec) : inv.binary,
      argv: inv.argv,
      cwd,
      env: { ...this.baseEnv(), ...inv.env },
      stdin: prompt,
      timeoutMs: 8 * 3600_000,
      signal,
      onSpawn: (p) => {
        pid = p;
        announce();
      },
      onStdout: (c) => {
        announce();
        stdout += c;
        emit({ type: "agent_output", stream: "stdout", chunk: c });
      },
      onStderr: (c) => {
        announce();
        stderr += c;
        emit({ type: "agent_output", stream: "stderr", chunk: c });
      },
    });
    announce();
    // contracts 5.19.0: the CLI's own accounting (tokens, cost, steps, finish reason) is printed with the exit and recorded.
    const events = parseAgentEvents(plan.provider, stdout);
    emit({
      type: "agent_exited",
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      ...(events.usageDetail ? { usage: events.usageDetail } : {}),
    });
    if (events.usageDetail?.lastFinishReason === "length")
      emit({
        type: "warning",
        code: "OUTPUT_CAP_REACHED",
        message: "the agent's last step stopped at its output cap (finish reason \"length\"); its reasoning and output share that cap",
      });
    if (res.exitCode !== 0) throw new StepError("AGENT_FAILED", `${inv.binary} exited ${res.exitCode}: ${tail(stderr)}`, true);
    const parsed = await parseAgentOutput(plan.provider, stdout, paths.lastMessagePath);
    // contracts 5.17.0: CLIs without a schema flag write their output to a file in the worktree; read it, then remove it
    // before the changes are captured. Missing or unreadable = no output (the caller's schema check fails closed).
    if (inv.outputFile) {
      const file = join(cwd, inv.outputFile);
      const raw = await readFile(file, "utf8").catch(() => null);
      await rm(file, { force: true });
      try {
        parsed.output = raw === null ? null : JSON.parse(raw);
      } catch {
        parsed.output = null;
      }
    }
    const launch = this.deps.modelLaunch?.[plan.model];
    const cap = this.engines.policy.models.find((m) => m.ref === plan.model)?.maxConcurrentSubagents;
    if (cap !== undefined && events.subagents.maxConcurrent !== null && events.subagents.maxConcurrent > cap)
      emit({
        type: "warning",
        code: "SUBAGENT_CAP_EXCEEDED",
        message: `${events.subagents.maxConcurrent} sub-agents ran at once; the policy allows ${cap} (recorded in the run)`,
      });
    const unsigned: Omit<AgentRunRecord, "signature"> = {
      schema: "wos-agent-run.v1",
      leaseId,
      deviceId: s.deviceId,
      manifestSha256,
      provider: plan.provider,
      cliVersion: "unknown",
      authMethod: null,
      modelIdRequested: plan.modelId,
      modelIdReported: parsed.model,
      reasoningRequested: plan.reasoning,
      argvSha256: sha256Of(canonicalJson(inv.argv)),
      startedAt,
      endedAt: this.now().toISOString(),
      exitCode: res.exitCode,
      transcriptSha256: sha256Of(stdout),
      outputSha256: canonicalSha256(parsed.output ?? null),
      // opencode reports tokens per step (step_finish): summed as reported; claude and codex report them once.
      usage: plan.provider === "opencode_cli" ? events.usage : parsed.usage,
      // contracts 5.17.0: the launch as declared (D52), sub-agents (D69) and every web access (D70).
      ...(launch ? { launch } : {}),
      ...(events.subagents.count > 0 || cap !== undefined ? { subagentCount: events.subagents.count } : {}),
      ...(events.subagents.maxConcurrent !== null && events.subagents.count > 0
        ? { maxConcurrentSubagents: events.subagents.maxConcurrent }
        : {}),
      ...(events.fetches.length > 0 ? { fetches: events.fetches } : {}),
      ...(events.usageDetail ? { usageDetail: events.usageDetail } : {}),
    };
    const record = await signAgentRunWithDevice(this.deps.secrets, unsigned);
    const posted = await this.api.call("postAgentRun", {
      params: { id: leaseId },
      body: record,
      idempotencyKey: idempotencyKey("postAgentRun", leaseId, record.transcriptSha256, startedAt),
    });
    // AGENT-POLICY.md section 4: a reported model different from the requested one refuses the submission.
    if (parsed.model !== null && parsed.model !== plan.modelId) {
      throw new StepError("MODEL_MISMATCH", `requested ${plan.modelId}, the CLI reported ${parsed.model}`);
    }
    // D52: a claude endpoint that answers as another family (e.g. ANTHROPIC_BASE_URL in the claude settings pointing at
    // another vendor) never passes as the requested model.
    const fam = (m: string) => (/^claude-/i.test(m) ? "claude" : /(^|\/)glm-/i.test(m) ? "glm" : /^gpt-/i.test(m) ? "gpt" : "other");
    const foreign = events.respondedModels.filter((m) => fam(m) !== fam(plan.modelId));
    if (foreign.length > 0)
      throw new StepError("MODEL_MISMATCH", `requested ${plan.modelId}, the endpoint answered as ${foreign.join(", ")}`);
    // D70: every web access must be on the plan's allowlist (enforced after the fact where the CLI cannot restrict domains).
    const off = offAllowlist(events.fetches, plan.web ?? null);
    if (off.length > 0)
      throw new StepError("NETWORK_POLICY", `the agent read outside this plan's allowlist (D70): ${off.slice(0, 5).join(", ")}`);
    return { output: parsed.output, manifestSha256, agentRunId: posted.agentRunId };
  }

  private async verifyLocally(
    wt: WorktreeHandle,
    plan: ContextPlan,
    emit: OrchestratorObserver,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; failedId: string | null; failureOutput: string; results: Changeset["localVerification"] }> {
    const manifest = await this.repoManifest(wt);
    const spec = await this.abuSpec(wt, plan);
    const steps: Array<{ id: string; run: string[]; timeoutSeconds: number }> = [
      { id: "install", run: manifest.install, timeoutSeconds: 1800 },
      ...manifest.verify,
      ...(spec?.acceptance.checks ?? []).map((c) => ({ id: `acceptance:${c.id}`, run: c.run, timeoutSeconds: 1800 })),
    ];
    const results: Changeset["localVerification"] = [];
    for (const s of steps) {
      emit({ type: "verify", checkId: s.id, status: "running", exitCode: null, outputTail: "" });
      let out = "";
      const r = await this.deps.processes.run({
        binary: s.run[0]!,
        argv: s.run.slice(1),
        cwd: wt.path,
        env: this.baseEnv(),
        stdin: "",
        timeoutMs: s.timeoutSeconds * 1000,
        signal,
        onStdout: (c) => {
          out += c;
        },
        onStderr: (c) => {
          out += c;
        },
      });
      results.push({
        id: s.id,
        exitCode: r.exitCode,
        durationMs: Math.max(0, Math.round(r.durationMs)),
        outputSha256: sha256Of(out),
      });
      const ok = r.exitCode === 0;
      emit({ type: "verify", checkId: s.id, status: ok ? "passed" : "failed", exitCode: r.exitCode, outputTail: tail(out) });
      if (!ok) return { ok: false, failedId: s.id, failureOutput: tail(out), results };
    }
    return { ok: true, failedId: null, failureOutput: "", results };
  }

  private async repoManifest(wt: WorktreeHandle): Promise<RepoManifest> {
    const raw = await gitOut(wt.path, ["show", `${wt.baseSha}:wos.json`]).catch(() => null);
    if (!raw) throw new StepError("REPO_MANIFEST_MISSING", "wos.json missing at the base commit");
    const parsed = RepoManifest.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) throw new StepError("REPO_MANIFEST_INVALID", parsed.error.message);
    return parsed.data;
  }

  private async abuSpec(wt: WorktreeHandle, plan: ContextPlan) {
    if (!plan.feature || !plan.abu) return null;
    const raw = await gitOut(wt.path, ["show", `${wt.baseSha}:features/${plan.feature}/BUILD-GRAPH.yaml`]).catch(() => null);
    if (!raw) throw new StepError("BUILD_GRAPH_MISSING", `features/${plan.feature}/BUILD-GRAPH.yaml missing at the base commit`);
    const parsed = this.engines.parseBuildGraphYaml(raw.toString("utf8"));
    if (!parsed.ok) throw new StepError("BUILD_GRAPH_INVALID", parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; "));
    const spec = parsed.value.abus.find((a) => a.key === plan.abu);
    if (!spec) throw new StepError("BUILD_GRAPH_INVALID", `${plan.abu} not in the build graph`);
    return spec;
  }

  private async assemble(
    wt: WorktreeHandle,
    plan: ContextPlan,
    manifestSha256: string,
    summary: BuildSummary | AuthorSummary,
    localVerification: Changeset["localVerification"],
    leaseId: string,
  ): Promise<{ changeset: Changeset | null; validation: ChangesetValidation }> {
    const s = await this.session();
    const cap = await captureChanges(wt);
    const blocking = cap.rejected.filter(isBlockingRejection);
    const errors: ChangesetValidation["errors"] = blocking.map((r) => ({
      code: r.reason === "path_invalid" ? "PATH_INVALID" : "SYMLINK_OR_SPECIAL_FILE",
      path: r.path,
      message: `rejected by capture: ${r.reason}`,
    }));
    if (cap.files.length === 0) errors.push({ code: "EMPTY_DIFF", path: null, message: "the agent changed nothing" });
    if (errors.length > 0) return { changeset: null, validation: { ok: false, errors } };
    const changeset = await signChangesetWithDevice(this.deps.secrets, {
      schema: "wos-changeset.v1",
      taskId: plan.taskId,
      leaseId,
      deviceId: s.deviceId,
      parentCommit: wt.baseSha,
      manifestSha256,
      submissionSha256: submissionSha256(wt.baseSha, cap.files),
      files: cap.files,
      summary,
      localVerification,
    });
    const existing = (await gitOut(wt.path, ["ls-tree", "-r", "-z", "--name-only", "--full-tree", wt.baseSha]))
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    const validation = this.engines.validateChangeset(changeset, {
      kind: "abu",
      abu: await this.abuSpec(wt, plan),
      documentPaths: [],
      repoManifest: await this.repoManifest(wt),
      existingPaths: new Set(existing),
    });
    return { changeset, validation };
  }

  // ------------------------------------------------------------------------------ wait, revise

  private async waitForOutcome(
    state: AttemptState,
    emit: OrchestratorObserver,
    signal?: AbortSignal,
  ): Promise<{ kind: "done"; result: RunResult } | { kind: "revise"; claim: ClaimResponse }> {
    let last = "";
    const since = this.now().toISOString();
    for (;;) {
      if (signal?.aborted)
        return {
          kind: "done",
          result: { ok: false, code: "ABORTED", message: "stopped waiting (the attempt continues on the server)", task: null },
        };
      const a = await this.api.call("getAttempt", { params: { id: state.attemptId } });
      const key = `${a.state}:${a.headSha}:${a.pr?.number ?? ""}`;
      if (key !== last) {
        last = key;
        const { reviews: _r, openFindings: _f, ...view } = a;
        emit({ type: "attempt", attempt: view });
        switch (a.state) {
          case "submitted":
          case "candidate_pushed":
            this.step(emit, "REVIEW", "waiting", "waiting for wos-verify on the candidate commit");
            emit({ type: "waiting", reason: "ci", since });
            break;
          case "in_review":
            this.step(emit, "REVIEW", "waiting", "CI passed; waiting for the Astra and Fable reviews");
            emit({ type: "waiting", reason: "reviews", since });
            break;
          case "qualified":
            this.step(emit, "REVIEW", "passed", "both reviews NO_MATERIAL_GAPS");
            this.step(emit, "QUALIFY", "passed", "qualification passed; the wOS App is opening the PR");
            break;
          case "pr_open":
            this.step(emit, "PR", "passed", a.pr ? `PR #${a.pr.number} ${a.pr.url}` : "PR open");
            emit({ type: "waiting", reason: "merge", since });
            break;
          case "changes_requested": {
            this.step(
              emit,
              "REVIEW",
              "failed",
              a.openFindings.length ? `${a.openFindings.length} open finding(s)` : "CI or merge queue failed",
            );
            emit({ type: "waiting", reason: "revision_window", since });
            const claim = await this.claimRevision(state);
            if (claim) {
              if (claim.attempt) emit({ type: "attempt", attempt: claim.attempt });
              emit({ type: "lease", lease: claim.lease });
              this.step(emit, "LEASE", "passed", `revision lease ${claim.lease.id}`);
              return { kind: "revise", claim };
            }
            break;
          }
          default:
            if (TERMINAL.has(a.state)) {
              if (state.worktree) await removeWorktree(state.worktree).catch(() => undefined);
              await this.dropState(state.attemptId);
              const task = await this.taskOf(state.taskId);
              if (a.state === "merged") return { kind: "done", result: { ok: true, attempt: view, task: task!, output: null } };
              return {
                kind: "done",
                result: { ok: false, code: `ATTEMPT_${a.state.toUpperCase()}`, message: a.failureReason ?? a.state, task },
              };
            }
        }
      }
      await this.sleep(this.pollMs);
    }
  }

  private async taskOf(taskId: string): Promise<TaskView | null> {
    const work = await this.api.call("getMyWork", {}).catch(() => null);
    return work?.tasks.find((t) => t.id === taskId) ?? null;
  }

  private async claimRevision(state: AttemptState): Promise<ClaimResponse | null> {
    const s = await this.session();
    const open = await this.api.call("listOpenTasks", { query: { kind: "abu_revision" } });
    const task = open.items.find((t) => t.attemptId === state.attemptId);
    if (!task) return null;
    const claim = await this.api.call("claimTask", {
      params: { id: task.id },
      // A revision continues on the model that built the attempt (D15).
      body: { deviceId: s.deviceId, ...(state.plan ? { model: state.plan.model } : {}) },
      idempotencyKey: idempotencyKey("claimTask", task.id, s.deviceId),
    });
    state.taskId = task.id;
    return claim;
  }

  // ------------------------------------------------------------------------------ resume, release

  async resume(observer: OrchestratorObserver): Promise<RunResult[]> {
    const results: RunResult[] = [];
    await this.session();
    const work = await this.api.call("getMyWork", {});
    for (const st of await this.listStates()) {
      const attempt =
        work.attempts.find((a) => a.id === st.attemptId) ??
        (await this.api.call("getAttempt", { params: { id: st.attemptId } }).catch(() => null));
      if (!attempt || TERMINAL.has(attempt.state)) {
        if (st.worktree) await removeWorktree(st.worktree).catch(() => undefined);
        await this.dropState(st.attemptId);
        continue;
      }
      observer({ type: "attempt", attempt: stripAttempt(attempt) });
      try {
        const lease = st.leaseId ? work.leases.find((l) => l.id === st.leaseId && l.state === "active") : undefined;
        if (!st.submitted && lease && st.plan && ["leased", "building", "verifying"].includes(attempt.state)) {
          const task = work.tasks.find((t) => t.id === st.taskId);
          if (!task) throw new StepError("NOT_FOUND", `task ${st.taskId} not found`);
          this.step(observer, "LEASE", "passed", `resumed lease ${lease.id}`);
          const claim: ClaimResponse = { task, lease, contextPlan: st.plan, attempt: stripAttempt(attempt) };
          results.push(await this.drive(st, claim, false, observer));
        } else if (st.submitted || !["leased", "building", "verifying"].includes(attempt.state)) {
          const next = await this.waitForOutcome(st, observer);
          if (next.kind === "done") results.push(next.result);
          else results.push(await this.drive(st, next.claim, false, observer));
        } else {
          observer({ type: "warning", code: "LEASE_LOST", message: `attempt ${attempt.id} has no active lease on this device` });
        }
      } catch (e) {
        results.push(this.failure(e, null, observer));
      }
    }
    return results;
  }

  async release(leaseId: string, reason: string): Promise<void> {
    await this.api.call("releaseLease", { params: { id: leaseId }, body: { reason }, idempotencyKey: idempotencyKey("release", leaseId) });
    for (const st of await this.listStates()) {
      if (st.leaseId !== leaseId) continue;
      if (st.worktree) await removeWorktree(st.worktree).catch(() => undefined);
      await this.dropState(st.attemptId);
    }
  }

  // ------------------------------------------------------------------------------ review, author, propose

  async review(
    options: {
      slot: "astra" | "fable";
      kinds?: Array<"roadmap_review" | "feature_review" | "implementation_review">;
      signal?: AbortSignal;
    },
    observer: OrchestratorObserver,
  ): Promise<RunResult> {
    let task: TaskView | null = null;
    try {
      const s = await this.session();
      this.step(observer, "LEASE", "started", `asking for a ${options.slot} review`);
      const kinds = options.kinds ?? ["implementation_review", "feature_review", "roadmap_review"];
      const claim = await this.api.call("claimReview", {
        body: { deviceId: s.deviceId, slot: options.slot, kinds },
        idempotencyKey: idempotencyKey("claimReview", s.deviceId, options.slot, this.now().toISOString().slice(0, 16)),
      });
      if (!claim) {
        this.step(observer, "LEASE", "waiting", "no review is waiting for this slot");
        return { ok: false, code: "NO_TASK", message: "no review task available", task: null };
      }
      task = claim.task;
      observer({ type: "lease", lease: claim.lease });
      this.step(observer, "LEASE", "passed", `review lease ${claim.lease.id}`);
      const plan = claim.contextPlan;
      const phase = { value: "reviewing" };
      const hb = this.heartbeat(claim.lease.id, claim.lease.heartbeatSeconds, phase);
      const name = `r-${claim.lease.id.replace(/-/g, "").slice(0, 12)}`;
      const wt = await createWorktree(this.deps.workspaceRoot, plan.source.repo, plan.source.commit, name);
      try {
        observer({ type: "worktree", path: wt.path, baseSha: wt.baseSha });
        this.step(
          observer,
          "REVIEW",
          "started",
          `reviewing ${plan.abu ?? plan.feature ?? plan.target} at ${plan.source.commit.slice(0, 12)}`,
        );
        const ctx = await this.engines.buildContext(
          plan,
          this.snapshotReader(wt, plan, claim.lease.id, () => null),
          this.engines.policy,
        );
        observer({ type: "context", manifest: ctx.manifest });
        await this.api.call("postManifest", {
          params: { id: claim.lease.id },
          body: ctx.manifest,
          idempotencyKey: idempotencyKey("postManifest", claim.lease.id, ctx.manifest.manifestSha256),
        });
        const run = await this.runAgent(plan, ctx.prompt, ctx.manifest.manifestSha256, wt.path, claim.lease.id, observer, options.signal);
        const verdict = ReviewVerdict.safeParse(run.output);
        if (!verdict.success) throw new StepError("AGENT_OUTPUT_INVALID", "the reviewer's output does not match review-verdict.v1");
        const attempt = claim.attempt;
        await this.api.call("submitVerdict", {
          params: { id: claim.lease.id },
          // contracts 4.2.0 (B-0008-github-build), integration glue: bind the verdict to the claimed round.
          body: {
            verdict: verdict.data,
            headSha: claim.round?.headSha ?? plan.source.commit,
            submissionSha256: claim.round?.submissionSha256 ?? null,
            agentRunId: run.agentRunId,
          },
          idempotencyKey: idempotencyKey("submitVerdict", claim.lease.id, run.agentRunId),
        });
        this.step(observer, "REVIEW", "passed", `${verdict.data.verdict} (sealed until the other slot is in)`);
        return { ok: true, attempt, task, output: verdict.data };
      } finally {
        hb.stop();
        await removeWorktree(wt).catch(() => undefined);
      }
    } catch (e) {
      return this.failure(e, task, observer);
    }
  }

  async author(options: AuthorOptions, observer: OrchestratorObserver): Promise<RunResult> {
    let task: TaskView | null = null;
    try {
      const s = await this.session();
      const launch = options.launch ?? (options.model ? this.deps.modelLaunch?.[options.model] : undefined);
      const claim = await this.api.call("claimTask", {
        params: { id: options.taskId },
        body: { deviceId: s.deviceId, ...(options.model ? { model: options.model } : {}), ...(launch ? { launch } : {}) },
        idempotencyKey: idempotencyKey("claimTask", options.taskId, s.deviceId),
      });
      task = claim.task;
      observer({ type: "lease", lease: claim.lease });
      if (claim.contextPlan.taskKind === "abu_revision" && claim.attempt) {
        const prior = (await this.listStates()).find((x) => x.attemptId === claim.attempt!.id);
        const state: AttemptState = prior ?? {
          attemptId: claim.attempt.id,
          abu: claim.attempt.abu,
          leaseId: claim.lease.id,
          taskId: claim.task.id,
          plan: claim.contextPlan,
          worktree: null,
          submitted: false,
        };
        return await this.drive(state, claim, false, observer, options.signal);
      }
      const kind = claim.contextPlan.taskKind;
      if (kind === "roadmap_author" || kind === "feature_author") return await this.authorDocument(claim, observer, options.signal);
      if (kind === "conflict_resolution") return await this.resolveConflict(claim, observer, options.signal);
      await this.api.call("releaseLease", {
        params: { id: claim.lease.id },
        body: { reason: `author() does not run ${kind} tasks` },
        idempotencyKey: idempotencyKey("release", claim.lease.id),
      });
      throw new StepError("VALIDATION_FAILED", `task kind ${kind} is not an author task (use build or review)`);
    } catch (e) {
      return this.failure(e, task, observer);
    }
  }

  /** A leased agent run in a fresh worktree at plan.source.commit: context, manifest, agent, signed run record. */
  private async leasedRun(claim: ClaimResponse, prefix: string, observer: OrchestratorObserver, signal?: AbortSignal) {
    const plan = claim.contextPlan;
    const wt = await createWorktree(
      this.deps.workspaceRoot,
      plan.source.repo,
      plan.source.commit,
      `${prefix}-${claim.lease.id.replace(/-/g, "").slice(0, 12)}`,
    );
    observer({ type: "worktree", path: wt.path, baseSha: wt.baseSha });
    const ctx = await this.engines.buildContext(
      plan,
      this.snapshotReader(wt, plan, claim.lease.id, () => null),
      this.engines.policy,
    );
    observer({ type: "context", manifest: ctx.manifest });
    await this.api.call("postManifest", {
      params: { id: claim.lease.id },
      body: ctx.manifest,
      idempotencyKey: idempotencyKey("postManifest", claim.lease.id, ctx.manifest.manifestSha256),
    });
    const run = await this.runAgent(plan, ctx.prompt, ctx.manifest.manifestSha256, wt.path, claim.lease.id, observer, signal);
    return { wt, run };
  }

  /**
   * roadmap_author / feature_author: the agent edits the canonical document files, the changeset is
   * limited to the document paths the control plane will enforce (documentScope), signed and submitted.
   * Review rounds are server-driven; a revision arrives later as a new author task.
   */
  private async authorDocument(claim: ClaimResponse, observer: OrchestratorObserver, signal?: AbortSignal): Promise<RunResult> {
    const plan = claim.contextPlan;
    const hb = this.heartbeat(claim.lease.id, claim.lease.heartbeatSeconds, { value: "authoring" });
    let wt: WorktreeHandle | null = null;
    try {
      this.step(observer, "BUILD", "started", `${plan.taskKind} for ${plan.feature ?? plan.target}`);
      const r = await this.leasedRun(claim, "d", observer, signal);
      wt = r.wt;
      const summary = AuthorSummary.safeParse(r.run.output);
      if (!summary.success) throw new StepError("AGENT_OUTPUT_INVALID", "the agent's output does not match author-summary.v1", true);
      this.step(observer, "BUILD", "passed", summary.data.summary.slice(0, 200));
      this.step(observer, "VERIFY", "started", "document scope");
      const s = await this.session();
      const cap = await captureChanges(wt);
      const errors: ChangesetValidation["errors"] = cap.rejected.filter(isBlockingRejection).map((x) => ({
        code: x.reason === "path_invalid" ? ("PATH_INVALID" as const) : ("SYMLINK_OR_SPECIAL_FILE" as const),
        path: x.path,
        message: `rejected by capture: ${x.reason}`,
      }));
      if (cap.files.length === 0) errors.push({ code: "EMPTY_DIFF", path: null, message: "the agent changed nothing" });
      if (errors.length > 0) {
        observer({ type: "scope", validation: { ok: false, errors } });
        throw new StepError("SCOPE_VIOLATION", errors.map((e) => `${e.code} ${e.path ?? ""}`.trim()).join("; "));
      }
      const existing = new Set(
        (await gitOut(wt.path, ["ls-tree", "-r", "-z", "--name-only", "--full-tree", wt.baseSha]))
          .toString("utf8")
          .split("\0")
          .filter(Boolean),
      );
      const changeset = await signChangesetWithDevice(this.deps.secrets, {
        schema: "wos-changeset.v1",
        taskId: plan.taskId,
        leaseId: claim.lease.id,
        deviceId: s.deviceId,
        parentCommit: wt.baseSha,
        manifestSha256: r.run.manifestSha256,
        submissionSha256: submissionSha256(wt.baseSha, cap.files),
        files: cap.files,
        summary: summary.data,
        localVerification: [],
      });
      const local = this.engines.validateChangeset(changeset, {
        kind: plan.taskKind === "feature_author" ? "feature_contract" : "roadmap",
        abu: null,
        documentPaths: documentPaths(plan, cap.files, existing),
        repoManifest: await this.repoManifest(wt),
        existingPaths: existing,
      });
      observer({ type: "scope", validation: local });
      if (!local.ok) throw new StepError("SCOPE_VIOLATION", local.errors.map((e) => `${e.code} ${e.path ?? ""}`.trim()).join("; "));
      const res = await this.api.call("submitChangeset", {
        params: { id: claim.lease.id },
        body: changeset,
        idempotencyKey: idempotencyKey("submitChangeset", claim.lease.id, changeset.submissionSha256),
      });
      observer({ type: "scope", validation: res.validation });
      if (!res.validation.ok) throw new StepError("SCOPE_VIOLATION", "the control plane refused the submission");
      this.step(observer, "VERIFY", "passed", `submitted ${changeset.files.length} file(s) to document ${res.documentId ?? "?"}`);
      this.step(observer, "REVIEW", "waiting", "the document review round is server-driven");
      return { ok: true, attempt: null, task: claim.task, output: summary.data };
    } finally {
      hb.stop();
      if (wt) await removeWorktree(wt).catch(() => undefined);
    }
  }

  /** conflict_resolution: a read-only resolver run whose Ruling goes to the maintainer for confirmation (V1). */
  private async resolveConflict(claim: ClaimResponse, observer: OrchestratorObserver, signal?: AbortSignal): Promise<RunResult> {
    const hb = this.heartbeat(claim.lease.id, claim.lease.heartbeatSeconds, { value: "resolving" });
    let wt: WorktreeHandle | null = null;
    try {
      this.step(observer, "REVIEW", "started", "resolving the dispute");
      const r = await this.leasedRun(claim, "c", observer, signal);
      wt = r.wt;
      const ruling = Ruling.safeParse(r.run.output);
      if (!ruling.success) throw new StepError("AGENT_OUTPUT_INVALID", "the resolver's output does not match ruling.v1", true);
      const res = await this.api.call("submitRuling", {
        params: { id: claim.lease.id },
        body: ruling.data,
        idempotencyKey: idempotencyKey("submitRuling", claim.lease.id, r.run.agentRunId),
      });
      this.step(
        observer,
        "REVIEW",
        "passed",
        res.awaitingMaintainer ? "ruling submitted; awaiting maintainer confirmation" : "ruling submitted",
      );
      return { ok: true, attempt: null, task: claim.task, output: ruling.data };
    } finally {
      hb.stop();
      if (wt) await removeWorktree(wt).catch(() => undefined);
    }
  }

  async propose(input: { target: string; feature: string | null; title: string; body: string }): Promise<{ issueUrl: string }> {
    await this.session();
    const r = await this.api.call("createProposal", {
      body: input,
      idempotencyKey: idempotencyKey("propose", input.target, input.title, input.body),
    });
    return { issueUrl: r.issueUrl };
  }
}

function stripAttempt(a: AttemptView & { reviews?: unknown; openFindings?: unknown }): AttemptView {
  const { reviews: _r, openFindings: _f, ...view } = a;
  return view;
}

const LOCAL_VERIFICATION_REF = "local:verification-output";

/**
 * The document paths the control plane enforces for an author task (control-plane documentScope):
 * feature contracts write CONTRACT.yaml, BUILD-GRAPH.yaml and acceptance/**; roadmaps write
 * roadmaps/<target>/** plus NEW catalog entries (the server narrows those to newCatalogFeatures).
 */
function documentPaths(plan: ContextPlan, files: ChangesetFile[], existing: ReadonlySet<string>): string[] {
  if (plan.taskKind === "feature_author") {
    const f = plan.feature!;
    return [`features/${f}/CONTRACT.yaml`, `features/${f}/BUILD-GRAPH.yaml`, `features/${f}/acceptance/**`];
  }
  const paths = [`roadmaps/${plan.target}/**`];
  for (const f of files) if (/^catalog\/[a-z][a-z0-9-]*\.yaml$/.test(f.path) && !existing.has(f.path)) paths.push(f.path);
  return paths;
}

/** The local_document a repair run sees: the failing check's output tail and any scope errors. */
function renderVerificationOutput(
  verification: { ok: boolean; failedId: string | null; failureOutput: string },
  validation: ChangesetValidation,
): string {
  const lines = ["# Local verification failed (wOS)", ""];
  if (!verification.ok)
    lines.push(
      `Check \`${verification.failedId}\` failed. Output (last ${OUTPUT_TAIL} characters):`,
      "",
      "```",
      verification.failureOutput,
      "```",
      "",
    );
  if (!validation.ok) {
    lines.push("Scope validation errors:", "");
    for (const e of validation.errors) lines.push(`- ${e.code}${e.path ? ` ${e.path}` : ""}: ${e.message}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Parses `wos://auth?r=<requestId>&t=<token>`; returns the token only when `r` matches this sign-in. */
export function parseAuthDeepLink(link: string, requestId: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "wos:" || url.hostname !== "auth") return null;
  const r = url.searchParams.get("r");
  const t = url.searchParams.get("t");
  return r === requestId && t ? t : null;
}

/** Agent output: claude stream-json `result` event (structured_output or JSON text), codex `-o` last message. UNVERIFIED shapes. */
export async function parseAgentOutput(
  provider: string,
  stdout: string,
  lastMessagePath: string,
): Promise<{ output: unknown; model: string | null; usage: { inputTokens: number | null; outputTokens: number | null } }> {
  let model: string | null = null;
  let output: unknown = null;
  let usage = { inputTokens: null as number | null, outputTokens: null as number | null };
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof ev.model === "string" && model === null) model = ev.model;
    if (ev.type === "result") {
      if (ev.structured_output && typeof ev.structured_output === "object") output = ev.structured_output;
      else if (typeof ev.result === "string") {
        try {
          output = JSON.parse(ev.result);
        } catch {
          output = null;
        }
      }
      const u = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (u) usage = { inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null };
    }
  }
  if (provider === "codex_cli") {
    const last = await readFile(lastMessagePath, "utf8").catch(() => null);
    if (last !== null) {
      try {
        output = JSON.parse(last);
      } catch {
        output = null;
      }
    }
  }
  return { output, model, usage };
}

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
  type AuthorSummary,
  BuildSummary,
  type Changeset,
  type ChangesetFile,
  type ChangesetValidation,
  type ClaimResponse,
  type ContextPlan,
  type LocalStatus,
  type Me,
  type OrchestratorObserver,
  type PipelineStep,
  type ProviderStatus,
  RepoManifest,
  ReviewVerdict,
  type RunResult,
  type TaskView,
} from "@waronsaas/contracts";
import { canonicalJson, canonicalSha256, sha256Prefixed } from "@waronsaas/github";
import { captureChanges, createWorktree, isBlockingRejection, removeWorktree, type WorktreeHandle } from "@waronsaas/github/local";
import { parseBuildGraphYaml } from "@waronsaas/planning";
import { validateChangeset } from "@waronsaas/verification";
import { ApiCallError, createApiClient } from "./api-client.js";
import type { ApiClient, Engines, OrchestratorDeps } from "./index.js";
import { deviceKey, idempotencyKey, readSession, SESSION_KEY, signCanonical, type StoredSession, writeSession } from "./session.js";

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
    const s = await readSession(this.deps.secrets);
    if (!s) return null;
    if (Date.parse(s.accessExpiresAt) - 60_000 > this.now().getTime()) return s.accessToken;
    if (Date.parse(s.refreshExpiresAt) <= this.now().getTime()) return null;
    const r = await this.api.call("refreshSession", { body: { refreshToken: s.refreshToken } });
    const next: StoredSession = { ...s, ...r };
    await writeSession(this.deps.secrets, next);
    return next.accessToken;
  }

  private async session(): Promise<StoredSession> {
    const s = await readSession(this.deps.secrets);
    if (!s) throw new StepError("UNAUTHENTICATED", "not signed in: run `wos login`");
    return s;
  }

  /**
   * Links GitHub (brokered device flow) for an account that already has a session. Email sign-in
   * (D8) has no place in this frozen signature: blockers/B-0003-github-build.md.
   */
  async login(observer: OrchestratorObserver, openUrl: (url: string, userCode: string) => void): Promise<Me> {
    await this.session();
    const me = await this.api.call("getMe", {});
    if (me.github) return me;
    const start = await this.api.call("startGithubLink", { body: { flow: "device" } });
    if (start.flow !== "device") throw new StepError("INTERNAL", "server did not start a device flow");
    openUrl(start.verificationUri, start.userCode);
    for (;;) {
      await this.sleep(Math.max(this.pollMs, 5000));
      const r = await this.api.call("pollGithubLink", { body: { linkId: start.linkId } });
      if (r.status === "linked") return r.me;
      if (r.status === "denied" || r.status === "expired") {
        observer({ type: "error", code: `GITHUB_LINK_${r.status.toUpperCase()}`, message: `GitHub link ${r.status}`, recoverable: true });
        throw new StepError(`GITHUB_LINK_${r.status.toUpperCase()}`, `GitHub link ${r.status}`);
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
      const v = await this.capture(p.binary, p.versionCommand.slice(1));
      const auth = v.ok && p.authCheckCommand ? await this.capture(p.authCheckCommand[0]!, p.authCheckCommand.slice(1)) : null;
      const signedIn = auth?.ok === true && /("loggedIn"\s*:\s*true|Logged in)/i.test(auth.out);
      const authMethod = auth?.ok
        ? (/"authMethod"\s*:\s*"([^"]+)"/.exec(auth.out)?.[1] ?? (/using (\w+)/i.exec(auth.out)?.[1] || null))
        : null;
      const problems: string[] = [];
      if (!v.ok) problems.push(`${p.binary} not installed`);
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
    const work = me?.canContribute ? await this.api.call("getMyWork", {}).catch(() => null) : null;
    return {
      signedIn: me !== null,
      me,
      git: { installed: gitV.ok, version: gitV.ok ? (/\d+\.\d+\.\d+/.exec(gitV.out)?.[0] ?? null) : null },
      providers,
      eligibleRoles,
      activeLeases: work?.leases.filter((l) => l.state === "active") ?? [],
      workspaceRoot: this.deps.workspaceRoot,
    };
  }

  private async capture(binary: string, argv: string[]): Promise<{ ok: boolean; out: string }> {
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

  async build(
    options: { abu: string; detachAfterSubmit?: boolean; signal?: AbortSignal },
    observer: OrchestratorObserver,
  ): Promise<RunResult> {
    const emit = observer;
    let task: TaskView | null = null;
    try {
      const s = await this.session();
      const abuId = await this.resolveAbu(options.abu);
      this.step(emit, "LEASE", "started", `claiming ${options.abu}`);
      const claim = await this.api.call("claimBuild", {
        params: { id: abuId },
        body: { deviceId: s.deviceId },
        idempotencyKey: idempotencyKey("claimBuild", abuId, s.deviceId, this.now().toISOString().slice(0, 16)),
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
      let manifestPosted = false;
      for (let loop = 0; ; loop++) {
        check();
        this.step(emit, "BUILD", "started", loop === 0 ? `building ${state.abu}` : `local repair ${loop} of ${limit}`);
        const ctx = await this.engines.buildContext(plan, this.snapshotReader(wt), this.engines.policy);
        emit({ type: "context", manifest: ctx.manifest });
        if (!manifestPosted) {
          await this.api.call("postManifest", {
            params: { id: lease.id },
            body: ctx.manifest,
            idempotencyKey: idempotencyKey("postManifest", lease.id, ctx.manifest.manifestSha256),
          });
          manifestPosted = true;
        }
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

  private snapshotReader(wt: WorktreeHandle): SnapshotReader {
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
      async readServerDocument(ref) {
        // No route serves server documents yet (blockers/B-0004-github-build.md).
        throw new StepError("NOT_IMPLEMENTED", `server document ${ref}: no control-plane route exists`);
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
    const paths = { cwd, schemaPath: join(tmp, "schema.json"), lastMessagePath: join(tmp, "last-message.json"), sessionId };
    const inv = this.engines.buildInvocation(plan, paths, this.engines.policy);
    await writeFile(paths.schemaPath, inv.outputSchemaJson);
    await rm(paths.lastMessagePath, { force: true });
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
    const res = await this.deps.processes.run({
      binary: inv.binary,
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
    emit({ type: "agent_exited", exitCode: res.exitCode, durationMs: res.durationMs });
    if (res.exitCode !== 0) throw new StepError("AGENT_FAILED", `${inv.binary} exited ${res.exitCode}: ${tail(stderr)}`, true);
    const parsed = await parseAgentOutput(plan.provider, stdout, paths.lastMessagePath);
    const key = await deviceKey(this.deps.secrets);
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
      argvSha256: sha256Prefixed(canonicalJson(inv.argv)),
      startedAt,
      endedAt: this.now().toISOString(),
      exitCode: res.exitCode,
      transcriptSha256: sha256Prefixed(stdout),
      outputSha256: canonicalSha256(parsed.output ?? null),
      usage: parsed.usage,
    };
    const record: AgentRunRecord = { ...unsigned, signature: signCanonical(key.privateKeyPem, unsigned) };
    const posted = await this.api.call("postAgentRun", {
      params: { id: leaseId },
      body: record,
      idempotencyKey: idempotencyKey("postAgentRun", leaseId, record.transcriptSha256, startedAt),
    });
    // AGENT-POLICY.md section 4: a reported model different from the requested one refuses the submission.
    if (parsed.model !== null && parsed.model !== plan.modelId) {
      throw new StepError("MODEL_MISMATCH", `requested ${plan.modelId}, the CLI reported ${parsed.model}`);
    }
    return { output: parsed.output, manifestSha256, agentRunId: posted.agentRunId };
  }

  private async verifyLocally(
    wt: WorktreeHandle,
    plan: ContextPlan,
    emit: OrchestratorObserver,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; failedId: string | null; results: Changeset["localVerification"] }> {
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
        outputSha256: sha256Prefixed(out),
      });
      const ok = r.exitCode === 0;
      emit({ type: "verify", checkId: s.id, status: ok ? "passed" : "failed", exitCode: r.exitCode, outputTail: tail(out) });
      if (!ok) return { ok: false, failedId: s.id, results };
    }
    return { ok: true, failedId: null, results };
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
    const changeset = await this.signChangeset({
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

  private async signChangeset(c: Omit<Changeset, "signature">): Promise<Changeset> {
    const key = await deviceKey(this.deps.secrets);
    const signed = { ...c, files: c.files.map((f) => (f.op === "upsert" ? { ...f, contentBase64: f.sha256 } : f)) };
    return { ...c, signature: signCanonical(key.privateKeyPem, signed) };
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
      body: { deviceId: s.deviceId },
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
        const ctx = await this.engines.buildContext(plan, this.snapshotReader(wt), this.engines.policy);
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
          body: { verdict: verdict.data, headSha: plan.source.commit, submissionSha256: null, agentRunId: run.agentRunId },
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

  async author(options: { taskId: string; signal?: AbortSignal }, observer: OrchestratorObserver): Promise<RunResult> {
    let task: TaskView | null = null;
    try {
      const s = await this.session();
      const claim = await this.api.call("claimTask", {
        params: { id: options.taskId },
        body: { deviceId: s.deviceId },
        idempotencyKey: idempotencyKey("claimTask", options.taskId, s.deviceId),
      });
      task = claim.task;
      observer({ type: "lease", lease: claim.lease });
      if (claim.task.kind === "abu_revision" && claim.attempt) {
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
      // Roadmap / feature contract authoring and conflict resolution: Wave 2 (needs planning templates).
      await this.api.call("releaseLease", {
        params: { id: claim.lease.id },
        body: { reason: "this client cannot run this task kind yet" },
        idempotencyKey: idempotencyKey("release", claim.lease.id),
      });
      throw new StepError("NOT_IMPLEMENTED", `task kind ${claim.task.kind} is not supported by this orchestrator build yet`);
    } catch (e) {
      return this.failure(e, task, observer);
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

/** BUILD-PROTOCOL.md section 6: sha256 of JCS {parentCommit, files: [{path, op, mode, sha256}] sorted by path}; deletes carry path and op only. */
export function submissionSha256(parentCommit: string, files: ChangesetFile[]): string {
  const entries = files
    .map((f) => (f.op === "upsert" ? { path: f.path, op: f.op, mode: f.mode, sha256: f.sha256 } : { path: f.path, op: f.op }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return canonicalSha256({ parentCommit, files: entries });
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

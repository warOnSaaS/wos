/**
 * A fake control plane for orchestrator tests: serves the frozen `Routes` over a fake `fetch` and
 * drives the attempt machine server-side the way BUILD-PROTOCOL.md describes, with scripted CI,
 * review and merge-queue outcomes. Candidate commits are real commits pushed to a local upstream
 * repository, so revisions and rebases create real worktrees.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getRolePolicy, resolveReasoning } from "@waronsaas/agent-policy";
import { builderArtifactSelectors, PROMPT_TEMPLATE_BY_ROLE, renderPolicyDocument, SECRET_PATTERNS } from "@waronsaas/context-engine";
import { sha256Of } from "@waronsaas/contracts/canonical";
import {
  AGENT_POLICY,
  type AbuSpec,
  type AgentRole,
  type ArtifactSelector,
  type BuildGraph,
  CONTEXT_FORMAT_VERSION,
  DEFAULT_TOOLCHAIN_PATHS,
  type AttemptView,
  type Changeset,
  type ContextPlan,
  type LeaseView,
  type Me,
  type RouteName,
  Routes,
  type TaskView,
} from "@waronsaas/contracts";

export const FIXED_DATE = "2026-09-29T12:00:00Z";
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: FIXED_DATE,
  GIT_COMMITTER_DATE: FIXED_DATE,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

export const REPO = "waronsaas/product";
export const TARGET = "salesforce";
export const FEATURE = "contacts";
export const ABU_KEY = "contacts#04";
export const SIGNIN_REQUEST_ID = "0192ab3c-0000-7000-8000-00000000beef";

export const WOS_JSON = {
  schema: "wos-repo.v1",
  displayName: "warOnSaaS suite (fixture)",
  apps: [{ surface: "web", path: "apps/web" }],
  defaultBranch: "main",
  stack: { language: "typescript", runtime: "node", packageManager: "npm" },
  install: ["wos-fake-check", "install"],
  verify: [{ id: "unit", run: ["wos-fake-check", "unit"], timeoutSeconds: 60 }],
  protectedPaths: [".github/**", "wos.json"],
  lockfiles: ["package-lock.json"],
  generatedPaths: [],
  migrationsDir: null,
  maxChangesetBytes: 4000000,
  toolchainPaths: [...DEFAULT_TOOLCHAIN_PATHS],
};

export const ABU_SPEC: AbuSpec = {
  repo: REPO,
  key: ABU_KEY,
  title: "Contact list endpoint",
  objective: "Return the contact list for the signed-in tenant, paginated.",
  requirements: ["R-001"],
  dependsOn: [],
  sizePoints: 3,
  scope: { write: ["modules/contacts/**"], read: [] },
  resources: [],
  acceptance: { checks: [{ id: "list", run: ["wos-fake-check", "unit"] }], tests: [] },
};

export const BUILD_GRAPH: BuildGraph = { schema: "wos-build-graph.v1", feature: FEATURE, contractVersion: 1, abus: [ABU_SPEC] };

export function makeUpstream(): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), "wos-orch-upstream-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  const files: Record<string, string> = {
    "wos.json": `${JSON.stringify(WOS_JSON, null, 2)}\n`,
    // JSON is valid YAML; planning's parseBuildGraphYaml is still a stub, tests parse it with the zod schema.
    "features/contacts/BUILD-GRAPH.yaml": `${JSON.stringify(BUILD_GRAPH, null, 2)}\n`,
    "features/contacts/CONTRACT.yaml": "schema: wos-feature-contract.v1\nkey: contacts\n",
    "modules/contacts/list.ts": "export const list = () => [];\n",
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, base: git(dir, "rev-parse", "HEAD") };
}

type Outcome = { ci: Array<"success" | "failure">; review: Array<"pass" | "gaps">; merge: Array<"merged" | "blocked"> };

interface Attempt extends AttemptView {
  taskId: string;
  events: string[];
  pendingBaseMove: boolean;
}

export class FakeControlPlane {
  private n = 0;
  readonly attempts = new Map<string, Attempt>();
  readonly leases = new Map<string, LeaseView & { taskId: string; attemptId: string | null }>();
  readonly tasks = new Map<string, TaskView>();
  readonly calls: Array<{ route: RouteName; idempotencyKey: string | null }> = [];
  readonly submissions: Changeset[] = [];
  readonly manifests: string[] = [];
  readonly agentRuns: unknown[] = [];
  readonly abuId: string;
  outcomes: Outcome = { ci: [], review: [], merge: [] };
  readonly documentRequests: string[] = [];
  readonly manifestBodies: Array<{ artifacts: unknown[]; manifestSha256: string }> = [];
  readonly signInStarts: Array<Record<string, unknown>> = [];
  readonly redeems: Array<Record<string, unknown>> = [];
  githubLinkScript: Array<"pending" | "linked" | "denied" | "expired" | "elsewhere"> = [];
  meOverride: Partial<Me> | null = null;

  /** The plan a lease was issued (tests inspect it; describeInvocation uses a real one). */
  planOf(leaseId: string): ContextPlan | undefined {
    return this.plans.get(leaseId);
  }

  /** Every server document this fake serves, rendered deterministically so plan sha256s match. */
  renderDoc(ref: string): string {
    const policy = /^wos:policy\/([a-z_]+)@/.exec(ref);
    if (policy) return renderPolicyDocument(policy[1] as AgentRole, AGENT_POLICY);
    const task = /^wos:task\/(.+)$/.exec(ref);
    if (task) return this.taskSpec(task[1]!);
    return `# ${ref}\n\nRendered by the fake control plane.\n`;
  }

  private doc(ref: string, required = true): ArtifactSelector {
    return { kind: "server_document", ref, sha256: sha256Of(this.renderDoc(ref)), required };
  }

  readonly plans = new Map<string, ContextPlan>();
  readonly attestations: Array<{ deviceId: string; providers: unknown[]; toolchain?: unknown }> = [];
  /** "scripted": outcomes.review decides; "orchestrators": two review tasks, decided by the submitted verdicts. */
  reviewMode: "scripted" | "orchestrators" = "scripted";
  readonly reviewTasks: Array<{
    taskId: string;
    attemptId: string;
    slot: "astra" | "fable";
    state: "open" | "leased" | "done";
    roundId: string;
  }> = [];
  readonly verdicts: Array<{ slot: string; verdict: string; headSha: string; agentRunId: string }> = [];

  taskSpec(taskId: string): string {
    return `# Task ${taskId}\n\nBuild ${ABU_KEY}: contact list endpoint.\n`;
  }

  constructor(
    private readonly upstream: { dir: string; base: string },
    private readonly now: () => Date,
  ) {
    this.abuId = this.id();
  }

  id(): string {
    this.n += 1;
    return `0192ab3c-0000-7000-8000-${String(this.n).padStart(12, "0")}`;
  }

  private ts(offsetMin = 0): string {
    return new Date(this.now().getTime() + offsetMin * 60_000).toISOString();
  }

  me(): Me {
    return {
      ...this.baseMe(),
      ...this.meOverride,
    };
  }

  private baseMe(): Me {
    return {
      id: "0192ab3c-0000-7000-8000-00000000aaaa",
      email: "dev@example.com",
      handle: "octo-dev",
      github: { userId: 4242, login: "octo-dev", linkedAt: FIXED_DATE, accountCreatedAt: "2019-01-01T00:00:00Z" },
      canContribute: true,
      displayName: null,
      roles: [],
      leaderboardOptIn: false,
      status: "active",
      followedTargets: [],
      progressEmails: false,
      attestations: [],
      balance: { held: 0, available: 0, score: 0 },
    };
  }

  /** Issued exactly like services/control-plane buildPlan for a builder, from the real policy and selectors. */
  private plan(taskId: string, taskKind: "abu_build" | "abu_revision", leaseId: string, attemptId: string, commit: string): ContextPlan {
    const p = this.builderPlan(taskId, taskKind, leaseId, attemptId, commit);
    this.plans.set(leaseId, p);
    return p;
  }

  private reviewPlan(t: (typeof this.reviewTasks)[number], leaseId: string, headSha: string): ContextPlan {
    const roleName = `implementation_reviewer_${t.slot}` as const;
    const role = getRolePolicy(roleName, AGENT_POLICY);
    const model = AGENT_POLICY.models.find((m) => m.ref === role.allowedModels[0])!;
    const p: ContextPlan = {
      schema: "wos-context-plan.v1",
      taskId: t.taskId,
      taskKind: "implementation_review",
      leaseId,
      role: roleName,
      model: model.ref,
      modelId: model.modelId,
      provider: model.provider,
      reasoning: resolveReasoning(role, model),
      policyVersion: AGENT_POLICY.policyVersion,
      contextFormatVersion: CONTEXT_FORMAT_VERSION,
      target: null,
      feature: FEATURE,
      abu: ABU_KEY,
      attemptId: t.attemptId,
      roundId: t.roundId,
      source: { repo: REPO, commit: headSha },
      artifacts: [
        this.doc(`wos:policy/${roleName}@${AGENT_POLICY.policyVersion}`),
        this.doc(`wos:task/${t.taskId}`),
        this.doc(`wos:diff/${t.attemptId}@${headSha}`),
        { kind: "repo_file", repo: REPO, path: "features/contacts/CONTRACT.yaml", required: true },
        { kind: "repo_glob", repo: REPO, glob: "modules/contacts/**", required: true },
        this.doc(`wos:ci/${t.attemptId}@${headSha}`),
      ],
      excludeGlobs: [...SECRET_PATTERNS],
      promptTemplateId: PROMPT_TEMPLATE_BY_ROLE[roleName],
      budgetTokens: role.budgetOverrides.find((o) => o.model === model.ref)?.contextBudgetTokens ?? role.contextBudgetTokens,
      outputSchema: role.outputSchema,
      allowedCommands: [],
    };
    this.plans.set(leaseId, p);
    return p;
  }

  /** Opens an author or resolver task (roadmap_author, feature_author, conflict_resolution) for author(). */
  openAuthorTask(kind: "roadmap_author" | "feature_author" | "conflict_resolution"): TaskView {
    const role = kind === "conflict_resolution" ? "conflict_resolver" : kind;
    const t: TaskView = {
      ...this.task(kind, null, "open"),
      role,
      target: kind === "roadmap_author" ? TARGET : null,
      feature: kind === "roadmap_author" ? null : FEATURE,
      abu: null,
      documentId: kind === "conflict_resolution" ? null : this.id(),
    };
    this.tasks.set(t.id, t);
    return t;
  }

  readonly rulings: unknown[] = [];
  readonly claimBodies: Array<{ deviceId: string; model?: string; launch?: unknown }> = [];
  /** Scripted claim refusals, e.g. the per-provider build-lease limit (D15). */
  readonly claimRefusals: Array<"LIMIT_REACHED" | "NOT_ELIGIBLE"> = [];
  /** Events served by listMyEvents (tests push contract-shaped DomainEvents). */
  readonly domainEvents: Array<{ id: number } & Record<string, unknown>> = [];
  /** D15: the model the server issues builder plans for (until the claim can name it, B-0010-github-build). */
  builderModel: "opus" | "astra" | "sol" | null = null;
  /** D70: the web the server issues with author plans (research roles), when a test sets it. */
  authorWeb: ContextPlan["web"] = null;
  /** The next submitChangeset fails with this error (after the lease checks). */
  failNextSubmission: { status: number; code: string; message: string } | null = null;

  private authorPlan(t: TaskView, leaseId: string): ContextPlan {
    const roleName = t.role;
    const role = getRolePolicy(roleName, AGENT_POLICY);
    const chosen = this.claimBodies.at(-1)?.model;
    const ref = chosen && role.allowedModels.includes(chosen as never) ? chosen : role.allowedModels[0];
    const model = AGENT_POLICY.models.find((m) => m.ref === ref)!;
    const artifacts: ArtifactSelector[] = [this.doc(`wos:policy/${roleName}@${AGENT_POLICY.policyVersion}`), this.doc(`wos:task/${t.id}`)];
    if (t.kind === "roadmap_author")
      artifacts.push({ kind: "repo_file", repo: REPO, path: "roadmaps/salesforce/ROADMAP.yaml", required: false });
    if (t.kind === "feature_author")
      artifacts.push({ kind: "repo_file", repo: REPO, path: "features/contacts/CONTRACT.yaml", required: false });
    if (t.kind === "conflict_resolution") artifacts.push(this.doc(`wos:dispute/${t.id}`));
    const p: ContextPlan = {
      schema: "wos-context-plan.v1",
      taskId: t.id,
      taskKind: t.kind,
      leaseId,
      role: roleName,
      model: model.ref,
      modelId: model.modelId,
      provider: model.provider,
      reasoning: resolveReasoning(role, model),
      policyVersion: AGENT_POLICY.policyVersion,
      contextFormatVersion: CONTEXT_FORMAT_VERSION,
      target: t.target,
      feature: t.feature,
      abu: null,
      attemptId: null,
      roundId: null,
      source: { repo: REPO, commit: this.upstream.base },
      artifacts,
      excludeGlobs: [...SECRET_PATTERNS],
      promptTemplateId: PROMPT_TEMPLATE_BY_ROLE[roleName],
      budgetTokens: role.budgetOverrides.find((o) => o.model === model.ref)?.contextBudgetTokens ?? role.contextBudgetTokens,
      outputSchema: role.outputSchema,
      allowedCommands: [],
      ...(this.authorWeb ? { web: this.authorWeb } : {}),
    };
    this.plans.set(leaseId, p);
    return p;
  }

  private builderPlan(
    taskId: string,
    taskKind: "abu_build" | "abu_revision",
    leaseId: string,
    attemptId: string,
    commit: string,
  ): ContextPlan {
    const role = getRolePolicy("builder", AGENT_POLICY);
    const model = AGENT_POLICY.models.find((m) => m.ref === (this.builderModel ?? role.allowedModels[0]))!;
    const policyText = renderPolicyDocument("builder", AGENT_POLICY);
    return {
      schema: "wos-context-plan.v1",
      taskId,
      taskKind,
      leaseId,
      role: "builder",
      model: model.ref,
      modelId: model.modelId,
      provider: model.provider,
      reasoning: resolveReasoning(role, model),
      policyVersion: AGENT_POLICY.policyVersion,
      contextFormatVersion: CONTEXT_FORMAT_VERSION,
      target: null,
      feature: FEATURE,
      abu: ABU_KEY,
      attemptId,
      roundId: null,
      source: { repo: REPO, commit },
      artifacts: builderArtifactSelectors({
        repo: REPO,
        feature: FEATURE,
        abu: ABU_SPEC,
        policyDocument: { ref: `wos:policy/builder@${AGENT_POLICY.policyVersion}`, sha256: sha256Of(policyText) },
        taskDocument: { ref: `wos:task/${taskId}`, sha256: sha256Of(this.renderDoc(`wos:task/${taskId}`)) },
        localVerificationOutput: true,
      }),
      excludeGlobs: [...SECRET_PATTERNS],
      promptTemplateId: PROMPT_TEMPLATE_BY_ROLE.builder,
      budgetTokens: role.budgetOverrides.find((o) => o.model === model.ref)?.contextBudgetTokens ?? role.contextBudgetTokens,
      outputSchema: role.outputSchema,
      allowedCommands: [...WOS_JSON.verify.map((v) => v.run), ...ABU_SPEC.acceptance.checks.map((c) => c.run)],
    };
  }

  private view(a: Attempt): AttemptView {
    const { taskId: _t, events: _e, pendingBaseMove: _p, ...v } = a;
    return { ...v, updatedAt: this.ts() };
  }

  private lease(taskId: string, attemptId: string | null) {
    const lease = {
      id: this.id(),
      taskId,
      state: "active" as const,
      issuedAt: this.ts(),
      expiresAt: this.ts(30),
      hardDeadlineAt: this.ts(480),
      heartbeatSeconds: 60,
      attemptId,
    };
    this.leases.set(lease.id, lease);
    return lease;
  }

  private leaseView(l: LeaseView & { taskId: string; attemptId: string | null }): LeaseView {
    const { attemptId: _a, ...v } = l;
    return v;
  }

  private task(kind: TaskView["kind"], attemptId: string | null, state: TaskView["state"]): TaskView {
    const t: TaskView = {
      id: this.id(),
      kind,
      state,
      role: "builder",
      reviewerSlot: null,
      target: null,
      feature: FEATURE,
      relevantTo: [TARGET],
      repo: REPO,
      abu: ABU_KEY,
      attemptId,
      documentId: null,
      roundId: null,
      createdAt: this.ts(),
    };
    this.tasks.set(t.id, t);
    return t;
  }

  private move(a: Attempt, to: AttemptView["state"]) {
    a.events.push(`${a.state}->${to}`);
    a.state = to;
  }

  /** Commits a submission onto `parent` and pushes it to the candidate branch of the upstream. */
  private commitCandidate(a: Attempt, cs: Changeset): string {
    const work = mkdtempSync(join(tmpdir(), "wos-orch-cand-"));
    try {
      git(work, "init", "-q");
      git(work, "fetch", "-q", this.upstream.dir, cs.parentCommit);
      git(work, "checkout", "-q", "--detach", cs.parentCommit);
      for (const f of cs.files) {
        const p = join(work, f.path);
        if (f.op === "delete") git(work, "rm", "-q", f.path);
        else {
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, Buffer.from(f.contentBase64, "base64"));
        }
      }
      git(work, "add", "-A");
      git(work, "commit", "-q", "-m", `${ABU_KEY}: candidate`);
      const sha = git(work, "rev-parse", "HEAD");
      git(work, "push", "-q", "-f", this.upstream.dir, `HEAD:refs/heads/wos/candidate/${a.id}`);
      return sha;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  private requestRevision(a: Attempt) {
    this.move(a, "changes_requested");
    this.task("abu_revision", a.id, "open");
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    for (const [name, r] of Object.entries(Routes) as Array<[RouteName, (typeof Routes)[RouteName]]>) {
      if (r.method !== method) continue;
      const names: string[] = [];
      const re = new RegExp(`^${r.path.replace(/:([A-Za-z]+)/g, (_m, n: string) => (names.push(n), "([^/]+)"))}$`);
      const m = re.exec(url.pathname);
      if (!m) continue;
      if (r.auth !== "public" && headers.get("authorization") !== "Bearer test-access")
        return json(401, err("UNAUTHENTICATED", "bad token"));
      if (r.idempotent && !headers.get("idempotency-key")) return json(400, err("VALIDATION_FAILED", "Idempotency-Key required"));
      this.calls.push({ route: name, idempotencyKey: headers.get("idempotency-key") });
      const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
      try {
        return json(200, this.handle(name, params, Object.fromEntries(url.searchParams), body));
      } catch (e) {
        if (e instanceof HttpErr) return json(e.status, err(e.code, e.message));
        throw e;
      }
    }
    return json(404, err("NOT_FOUND", `no route ${method} ${url.pathname}`));
  };

  private handle(
    name: RouteName,
    params: Record<string, string>,
    query: Record<string, string>,
    body: Record<string, unknown> | null,
  ): unknown {
    switch (name) {
      case "getMe":
        return this.me();
      case "getMyWork":
        return {
          leases: [...this.leases.values()].map((l) => this.leaseView(l)),
          tasks: [...this.tasks.values()],
          attempts: [...this.attempts.values()].map((a) => this.view(a)),
        };
      case "listClaimableAbus":
        return {
          items: [
            {
              id: this.abuId,
              key: ABU_KEY,
              title: "Contact list endpoint",
              state: "ready",
              sizePoints: 3,
              dependsOn: [],
              requirements: ["R-001"],
              relevantTo: [TARGET],
              claimable: true,
              repo: REPO,
              pr: null,
            },
          ],
        };
      case "claimBuild": {
        this.claimBodies.push(body as never);
        const refusal = this.claimRefusals.shift();
        if (refusal) throw new HttpErr(refusal === "LIMIT_REACHED" ? 409 : 403, refusal, `${refusal}: fake refusal`);
        if (body?.model) {
          if (!getRolePolicy("builder", AGENT_POLICY).allowedModels.includes(body.model as never)) {
            throw new HttpErr(403, "NOT_ELIGIBLE", `model ${String(body.model)} is not allowed for builder`);
          }
          this.builderModel = body.model as "opus" | "astra" | "sol";
        }
        if (params.id !== this.abuId) throw new HttpErr(404, "NOT_FOUND", "no such ABU");
        const task = this.task("abu_build", null, "leased");
        const a: Attempt = {
          id: this.id(),
          abu: ABU_KEY,
          feature: FEATURE,
          relevantTo: [TARGET],
          repo: REPO,
          state: "leased",
          builderHandle: "octo-dev",
          baseSha: this.upstream.base,
          candidateBranch: null,
          headSha: null,
          repairCount: 0,
          pr: null,
          failureReason: null,
          updatedAt: this.ts(),
          taskId: task.id,
          events: ["claim->leased"],
          pendingBaseMove: false,
        };
        this.attempts.set(a.id, a);
        task.attemptId = a.id;
        const lease = this.lease(task.id, a.id);
        return {
          task,
          lease: this.leaseView(lease),
          contextPlan: this.plan(task.id, "abu_build", lease.id, a.id, a.baseSha),
          attempt: this.view(a),
        };
      }
      case "getLeaseDocument": {
        const l = this.activeLease(params.id!);
        this.documentRequests.push(query.ref!);
        const plan = this.plans.get(l.id);
        const inPlan = plan?.artifacts.some((a) => a.kind === "server_document" && a.ref === query.ref);
        if (!inPlan) throw new HttpErr(403, "FORBIDDEN", "ref not in this lease's plan");
        const text = this.renderDoc(query.ref!);
        return { ref: query.ref, sha256: sha256Of(text), contentBase64: Buffer.from(text).toString("base64") };
      }
      case "listMyEvents": {
        const after = Number(query.after ?? 0);
        const items = this.domainEvents.filter((e) => e.id > after);
        return { items, lastId: items.at(-1)?.id ?? after };
      }
      case "postAttestation":
        this.attestations.push(body as never);
        return this.me();
      case "claimReview": {
        const t = this.reviewTasks.find((x) => x.state === "open" && x.slot === body?.slot);
        if (!t) return null;
        t.state = "leased";
        const a = this.attempts.get(t.attemptId)!;
        const task: TaskView = {
          ...this.task("implementation_review", a.id, "leased"),
          role: `implementation_reviewer_${t.slot}`,
          reviewerSlot: t.slot,
          roundId: t.roundId,
        };
        this.tasks.set(task.id, task);
        t.taskId = task.id;
        const lease = this.lease(task.id, null);
        return { task, lease: this.leaseView(lease), contextPlan: this.reviewPlan(t, lease.id, a.headSha!), attempt: this.view(a) };
      }
      case "submitVerdict": {
        const l = this.activeLease(params.id!);
        const t = this.reviewTasks.find((x) => x.taskId === l.taskId)!;
        const v = body as { verdict: { verdict: string }; headSha: string; agentRunId: string };
        this.verdicts.push({ slot: t.slot, verdict: v.verdict.verdict, headSha: v.headSha, agentRunId: v.agentRunId });
        t.state = "done";
        l.state = "completed";
        return { sealed: true, reviewId: this.id() };
      }
      case "startEmailSignIn":
        this.signInStarts.push(body as never);
        return { requestId: SIGNIN_REQUEST_ID, pollSecret: "poll-secret-xyz", expiresAt: this.ts(15) };
      case "redeemEmailSignIn": {
        this.redeems.push(body as never);
        const ok = body?.pollSecret === "poll-secret-xyz" && (body?.code === "ABCD-EFGH" || body?.linkToken === "good-token");
        if (!ok) throw new HttpErr(401, "UNAUTHENTICATED", "wrong code");
        return {
          accessToken: "test-access",
          accessExpiresAt: "2026-09-29T13:00:00Z",
          refreshToken: "test-refresh",
          refreshExpiresAt: "2026-10-29T12:00:00Z",
          deviceId: "0192ab3c-0000-7000-8000-0000000000dd",
          created: false,
          me: this.me(),
        };
      }
      case "startGithubLink":
        return {
          flow: "device",
          linkId: "0192ab3c-0000-7000-8000-00000000c1c1",
          userCode: "WOS1-2345",
          verificationUri: "https://github.com/login/device",
          intervalSeconds: 5,
          expiresAt: this.ts(15),
        };
      case "pollGithubLink": {
        const next = this.githubLinkScript.shift() ?? "pending";
        if (next === "elsewhere") throw new HttpErr(409, "GITHUB_LINKED_ELSEWHERE", "this GitHub account is linked to another wOS account");
        if (next === "linked") return { status: "linked", me: this.me() };
        return { status: next };
      }
      case "heartbeat":
        return this.leaseView(this.leases.get(params.id!)!);
      case "postManifest": {
        const l = this.activeLease(params.id!);
        const a = l.attemptId ? this.attempts.get(l.attemptId) : undefined;
        this.manifests.push(String(body?.manifestSha256));
        this.manifestBodies.push(body as never);
        if (a?.state === "leased") this.move(a, "building");
        return { accepted: true, manifestId: this.id() };
      }
      case "postAgentRun":
        this.activeLease(params.id!);
        this.agentRuns.push(body);
        return { agentRunId: this.id() };
      case "setAttemptPhase": {
        const a = this.attempts.get(params.id!)!;
        if (body?.phase === "verifying") this.move(a, "verifying");
        else this.move(a, "building");
        return this.view(a);
      }
      case "submitRuling": {
        const l = this.activeLease(params.id!);
        this.rulings.push(body);
        l.state = "completed";
        return { rulingId: this.id(), awaitingMaintainer: true };
      }
      case "submitChangeset": {
        const l = this.activeLease(params.id!);
        if (this.failNextSubmission) {
          // Incident 2026-10-01: the control plane refused the commit after validation (the lease stays active).
          const e = this.failNextSubmission;
          this.failNextSubmission = null;
          throw new HttpErr(e.status, e.code, e.message);
        }
        if (!l.attemptId) {
          this.submissions.push(body as unknown as Changeset);
          l.state = "completed";
          return { validation: { ok: true, errors: [] }, attempt: null, documentId: this.tasks.get(l.taskId)!.documentId };
        }
        const a = this.attempts.get(l.attemptId!)!;
        const cs = body as unknown as Changeset;
        this.submissions.push(cs);
        this.move(a, "submitted");
        l.state = "completed";
        a.headSha = this.commitCandidate(a, cs);
        a.candidateBranch = `wos/candidate/${a.id}`;
        return { validation: { ok: true, errors: [] }, attempt: this.view(a), documentId: null };
      }
      case "getAttempt": {
        const a = this.attempts.get(params.id!);
        if (!a) throw new HttpErr(404, "NOT_FOUND", "no attempt");
        this.advance(a);
        return { ...this.view(a), reviews: [], openFindings: [] };
      }
      case "listOpenTasks":
        return { items: [...this.tasks.values()].filter((t) => t.state === "open" && (!query.kind || t.kind === query.kind)) };
      case "claimTask": {
        this.claimBodies.push(body as never);
        const t = this.tasks.get(params.id!)!;
        if (t.state !== "open") throw new HttpErr(409, "CONFLICT", "task not open");
        t.state = "leased";
        if (t.kind !== "abu_revision") {
          const lease = this.lease(t.id, null);
          return { task: t, lease: this.leaseView(lease), contextPlan: this.authorPlan(t, lease.id), attempt: null };
        }
        const a = this.attempts.get(t.attemptId!)!;
        a.repairCount += 1;
        this.move(a, "building");
        const lease = this.lease(t.id, a.id);
        // Rebase after merge_blocked: the new plan starts from the moved default branch.
        let commit = a.headSha!;
        if (a.pendingBaseMove) {
          a.pendingBaseMove = false;
          a.baseSha = git(this.upstream.dir, "rev-parse", "main");
          commit = a.baseSha;
        }
        return {
          task: t,
          lease: this.leaseView(lease),
          contextPlan: this.plan(t.id, "abu_revision", lease.id, a.id, commit),
          attempt: this.view(a),
        };
      }
      case "releaseLease": {
        const l = this.leases.get(params.id!)!;
        l.state = "released";
        // Like the control plane: a released lease's task is open again.
        const t = this.tasks.get(l.taskId);
        if (t?.state === "leased") t.state = "open";
        return this.leaseView(l);
      }
      case "createProposal":
        return { proposalId: this.id(), issueUrl: "https://github.com/waronsaas/product/issues/1" };
      default:
        throw new HttpErr(501, "INTERNAL", `fake control plane does not serve ${name}`);
    }
  }

  private activeLease(id: string) {
    const l = this.leases.get(id);
    if (l?.state !== "active") throw new HttpErr(409, "LEASE_NOT_HELD", "lease not active");
    return l;
  }

  /** Server-side progress on every poll, one transition at a time. */
  private advance(a: Attempt) {
    switch (a.state) {
      case "submitted":
        this.move(a, "candidate_pushed");
        return;
      case "candidate_pushed":
        if ((this.outcomes.ci.shift() ?? "success") === "success") {
          this.move(a, "in_review");
          if (this.reviewMode === "orchestrators") {
            const roundId = this.id();
            for (const slot of ["astra", "fable"] as const)
              this.reviewTasks.push({ taskId: "", attemptId: a.id, slot, state: "open", roundId });
          }
        } else this.requestRevision(a);
        return;
      case "in_review": {
        if (this.reviewMode === "scripted") {
          if ((this.outcomes.review.shift() ?? "pass") === "pass") this.move(a, "qualified");
          else this.requestRevision(a);
          return;
        }
        const mine = this.reviewTasks.filter((t) => t.attemptId === a.id);
        if (mine.some((t) => t.state !== "done")) return;
        const bound = this.verdicts.filter((v) => v.headSha === a.headSha);
        if (bound.length === 2 && bound.every((v) => v.verdict === "NO_MATERIAL_GAPS")) this.move(a, "qualified");
        else this.requestRevision(a);
        return;
      }
      case "qualified":
        this.move(a, "pr_open");
        a.pr = { number: 7, url: "https://github.com/waronsaas/product/pull/7" };
        return;
      case "pr_open":
        if ((this.outcomes.merge.shift() ?? "merged") === "merged") this.move(a, "merged");
        else {
          // Main moved under the PR: the merge queue ejects it and the revision must rebase.
          writeFileSync(join(this.upstream.dir, "README.md"), "main moved\n");
          git(this.upstream.dir, "add", "README.md");
          git(this.upstream.dir, "commit", "-q", "-m", "main moved");
          a.pendingBaseMove = true;
          this.requestRevision(a);
        }
        return;
      default:
        return;
    }
  }
}

class HttpErr extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function err(code: string, message: string) {
  return { error: { code, message, requestId: "req-test" } };
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

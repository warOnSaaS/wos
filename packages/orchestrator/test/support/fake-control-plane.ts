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
import {
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

export const REPO = "waronsaas/suite";
export const TARGET = "salesforce";
export const FEATURE = "contacts";
export const ABU_KEY = "contacts#04";

export const WOS_JSON = {
  schema: "wos-repo.v1",
  displayName: "warOnSaaS suite (fixture)",
  products: [],
  defaultBranch: "main",
  stack: { language: "typescript", runtime: "node", packageManager: "npm" },
  install: ["wos-fake-check", "install"],
  verify: [{ id: "unit", run: ["wos-fake-check", "unit"], timeoutSeconds: 60 }],
  protectedPaths: [".github/**", "wos.json"],
  lockfiles: ["package-lock.json"],
  generatedPaths: [],
  migrationsDir: null,
  maxChangesetBytes: 4000000,
};

export function makeUpstream(): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), "wos-orch-upstream-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  const files: Record<string, string> = {
    "wos.json": `${JSON.stringify(WOS_JSON, null, 2)}\n`,
    "features/contacts/BUILD-GRAPH.yaml": "schema: wos-build-graph.v1\n# parsed by the fake parseBuildGraphYaml\n",
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

  private plan(taskId: string, leaseId: string, attemptId: string, commit: string): ContextPlan {
    return {
      schema: "wos-context-plan.v1",
      taskId,
      leaseId,
      role: "builder",
      model: "opus",
      modelId: "claude-opus-5-5",
      provider: "claude_cli",
      reasoning: "high",
      policyVersion: "agent-policy.v1",
      contextFormatVersion: "wos-context.v1",
      target: TARGET,
      feature: FEATURE,
      abu: ABU_KEY,
      attemptId,
      roundId: null,
      source: { repo: REPO, commit },
      artifacts: [],
      excludeGlobs: [],
      promptTemplateId: "builder.v1",
      budgetTokens: 100000,
      outputSchema: "build-summary.v1",
      allowedCommands: [["wos-fake-check", "unit"]],
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
      target: TARGET,
      feature: FEATURE,
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
              pr: null,
            },
          ],
        };
      case "claimBuild": {
        if (params.id !== this.abuId) throw new HttpErr(404, "NOT_FOUND", "no such ABU");
        const task = this.task("abu_build", null, "leased");
        const a: Attempt = {
          id: this.id(),
          abu: ABU_KEY,
          target: TARGET,
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
        return { task, lease: this.leaseView(lease), contextPlan: this.plan(task.id, lease.id, a.id, a.baseSha), attempt: this.view(a) };
      }
      case "heartbeat":
        return this.leaseView(this.leases.get(params.id!)!);
      case "postManifest": {
        const l = this.activeLease(params.id!);
        const a = this.attempts.get(l.attemptId!)!;
        this.manifests.push(String(body?.manifestSha256));
        if (a.state === "leased") this.move(a, "building");
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
      case "submitChangeset": {
        const l = this.activeLease(params.id!);
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
        const t = this.tasks.get(params.id!)!;
        if (t.state !== "open") throw new HttpErr(409, "CONFLICT", "task not open");
        t.state = "leased";
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
        return { task: t, lease: this.leaseView(lease), contextPlan: this.plan(t.id, lease.id, a.id, commit), attempt: this.view(a) };
      }
      case "releaseLease": {
        const l = this.leases.get(params.id!)!;
        l.state = "released";
        return this.leaseView(l);
      }
      case "createProposal":
        return { proposalId: this.id(), issueUrl: "https://github.com/waronsaas/suite/issues/1" };
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
        if ((this.outcomes.ci.shift() ?? "success") === "success") this.move(a, "in_review");
        else this.requestRevision(a);
        return;
      case "in_review":
        if ((this.outcomes.review.shift() ?? "pass") === "pass") this.move(a, "qualified");
        else this.requestRevision(a);
        return;
      case "qualified":
        this.move(a, "pr_open");
        a.pr = { number: 7, url: "https://github.com/waronsaas/suite/pull/7" };
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

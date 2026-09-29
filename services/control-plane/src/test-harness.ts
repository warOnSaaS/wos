/**
 * `@waronsaas/control-plane/test-harness` — `createTestHarness()` for suites outside the control plane
 * (the verification workstream's API-level adversarial suite, tests/adversarial/support/harness.ts).
 * The real Hono app on a fresh migrated Postgres (needs WOS_TEST_DATABASE_URL), the real Wave 1/2 packages,
 * and fakes only for GitHub (every call recorded) and email. Adds no route and no contract field.
 */
import { randomUUID } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { AbuSpec, ContextPlan } from "@waronsaas/contracts";
import {
  type Account,
  CRON_SECRET,
  createHarness,
  type Harness,
  manifestFor,
  seedFeature,
  signedChangeset,
  signedRun,
  webhookHeaders,
} from "./testing/harness.js";

export interface Contributor {
  accountId: string;
  email: string;
  accessToken: string;
  deviceId: string;
  deviceKey: KeyObject;
}
export interface ReadyLease {
  leaseId: string;
  taskId: string;
  attemptId: string;
  parentCommit: string;
  manifestSha256: string;
  existingPaths: string[];
}
export interface OpenRound {
  roundId: string;
  attemptId: string;
  headSha: string;
  submissionSha256: string;
}
export interface ControlPlaneHarness {
  request(
    method: string,
    path: string,
    init?: { token?: string; body?: unknown; headers?: Record<string, string>; ip?: string },
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  contributor(opts?: { github?: boolean; githubAgeDays?: number; maintainer?: boolean }): Promise<Contributor>;
  seedAbu(spec: { key: string; write: string[]; resources?: { key: string; mode: "exclusive" | "shared" }[] }): Promise<string>;
  leaseReadyToSubmit(builder: Contributor, abuId: string): Promise<ReadyLease>;
  roundInReview(builder: Contributor, abuId: string): Promise<OpenRound>;
  reviewAgentRun(reviewer: Contributor, leaseId: string): Promise<string>;
  bootstrap(enabled: boolean): Promise<void>;
  lastEmail(to: string): Promise<{ link: string; code: string } | null>;
  githubCalls(): Array<{ method: string; path: string; body?: unknown }>;
  close(): Promise<void>;
}

/** The underlying control-plane harness as well, for suites that need its fixtures directly. */
export { createHarness } from "./testing/harness.js";

let seq = 0;
const READ_OPERATIONS = new Set([
  "getBranchHead",
  "readFileAt",
  "listTreePaths",
  "blobOidsAt",
  "compareDiff",
  "verifyWebhookSignature",
  "webAuthorizeUrl",
]);

export async function createTestHarness(): Promise<ControlPlaneHarness> {
  const h: Harness = await createHarness();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  // Record every GitHub operation the control plane performs (method name, repo/ref path, arguments).
  const gh = h.github as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(h.github))) {
    const fn = gh[name];
    if (name === "constructor" || typeof fn !== "function" || ["headOf", "putFile"].includes(name)) continue;
    gh[name] = (...args: unknown[]) => {
      // HTTP verb of the GitHub REST call behind each App operation: reads are GET, everything else writes.
      const method = READ_OPERATIONS.has(name) ? "GET" : "POST";
      const path = `${name}/${args.filter((a) => typeof a === "string" || typeof a === "number").join("/")}`;
      calls.push({ method, path, body: args });
      return (fn as (...a: unknown[]) => unknown).apply(h.github, args);
    };
  }
  const accounts = new Map<string, Account>();
  let maintainer: Account | undefined;
  const features = new Map<string, { featureId: string; contractDocId: string; reqId: string; repo: string }>();
  const toContributor = (a: Account): Contributor => ({
    accountId: a.id,
    email: a.email,
    accessToken: a.token,
    deviceId: a.deviceId,
    deviceKey: a.key,
  });

  const call = async (
    method: string,
    path: string,
    init: { token?: string; body?: unknown; headers?: Record<string, string>; idem?: boolean } = {},
  ) => {
    const r = await h.call(method, path, { token: init.token, body: init.body, headers: init.headers, idem: init.idem });
    if (r.status >= 400) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  };

  // Fixture requests are not part of an attack: they do not count toward the account's write rate limit (S-3).
  const forgetFixtureTraffic = async (accountId: string) => {
    await h.owner`delete from wos.rate_limits where bucket = ${`api:${accountId}`}`;
  };

  const claimAndPrepare = async (builder: Contributor, abuId: string): Promise<ReadyLease & { plan: ContextPlan }> => {
    // Fixture convenience: attack suites reuse one builder for many independent leases, so the builder's
    // earlier build leases are released first (D15 allows one per provider, two in total).
    const earlier = await h.owner<{ id: string }[]>`
      select l.id from wos.leases l join wos.tasks t on t.id = l.task_id
       where l.account_id = ${builder.accountId} and l.state = 'active' and t.kind in ('abu_build', 'abu_revision')`;
    for (const l of earlier) {
      await h.call("POST", `/v1/leases/${l.id}/release`, {
        token: builder.accessToken,
        idem: true,
        body: { reason: "test harness: fixture reuse" },
      });
    }
    // ...and the builder's earlier attempts that outlived their lease (submitted, in review) are failed through the
    // maintainer route, so their resource locks free up for the next independent attack.
    const live = await h.owner<{ id: string }[]>`
      select id from wos.attempts where account_id = ${builder.accountId}
         and state in ('submitted', 'candidate_pushed', 'in_review', 'changes_requested', 'qualified', 'pr_open')`;
    if (live.length > 0) {
      maintainer ??= await h.contributor(`harness-maintainer-${randomUUID().slice(0, 6)}`, { maintainer: true });
      for (const a of live) {
        await h.call("POST", "/v1/admin/actions", {
          token: maintainer.token,
          idem: true,
          body: { action: "fail_attempt", attemptId: a.id, reason: "test harness: fixture reuse" },
        });
      }
    }
    const claim = await call("POST", `/v1/abus/${abuId}/claim`, {
      token: builder.accessToken,
      idem: true,
      body: { deviceId: builder.deviceId },
    });
    const plan = claim.body.contextPlan as ContextPlan;
    const leaseId = claim.body.lease.id as string;
    const manifest = await manifestFor(h, plan);
    await call("POST", `/v1/leases/${leaseId}/manifest`, { token: builder.accessToken, idem: true, body: manifest });
    await call("POST", `/v1/leases/${leaseId}/agent-runs`, {
      token: builder.accessToken,
      idem: true,
      body: signedRun(builder.deviceKey, plan, leaseId, builder.deviceId, manifest.manifestSha256),
    });
    await call("POST", `/v1/attempts/${claim.body.attempt.id}/phase`, {
      token: builder.accessToken,
      idem: true,
      body: { phase: "verifying", localRepair: false },
    });
    await forgetFixtureTraffic(builder.accountId);
    return {
      plan,
      leaseId,
      taskId: plan.taskId,
      attemptId: claim.body.attempt.id,
      parentCommit: plan.source.commit,
      manifestSha256: manifest.manifestSha256,
      existingPaths: await h.github.listTreePaths(plan.source.repo, plan.source.commit),
    };
  };

  return {
    async request(method, path, init = {}) {
      const headers: Record<string, string> = { ...(init.headers ?? {}), ...(init.ip ? { "x-forwarded-for": init.ip } : {}) };
      // Test clock: the control plane only reads the database clock, so "advance N minutes" moves every
      // active lease's expiry (and hard deadline) N minutes into the past before the request runs.
      const advance = Number(headers["x-wos-test-advance-minutes"] ?? 0);
      delete headers["x-wos-test-advance-minutes"];
      if (advance > 0) {
        await h.owner`update wos.leases set expires_at = expires_at - make_interval(mins => ${advance}),
                             hard_deadline_at = hard_deadline_at - make_interval(mins => ${advance}) where state = 'active'`;
      }
      // The suite's cron token maps to this harness's cron secret.
      if (headers.authorization === "Bearer test-cron") headers.authorization = `Bearer ${CRON_SECRET}`;
      const r = await h.call(method, path, { token: init.token, body: init.body, headers });
      const out: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        out[k] = v;
      });
      return { status: r.status, body: r.body, headers: out };
    },

    async contributor(opts = {}) {
      const name = `adv-${++seq}-${randomUUID().slice(0, 6)}`;
      const a = opts.github === false ? await h.signIn(`${name}@example.com`) : await h.contributor(name, opts);
      accounts.set(a.id, a);
      return toContributor(a);
    },

    async seedAbu(spec) {
      const [feature, n] = spec.key.split("#");
      if (!feature || !n) throw new Error(`ABU key ${spec.key} must be <feature>#<nn>`);
      const known = features.get(feature);
      if (!known) {
        const seeded = await seedFeature(h.owner, { feature, abus: [{ n, write: spec.write, resources: spec.resources }] });
        const [req] = await h.owner<{ id: string }[]>`select id from wos.requirements where document_id = ${seeded.contractDocId}`;
        const [doc] = await h.owner<
          { repo: string }[]
        >`select repo_full_name as repo from wos.documents where id = ${seeded.contractDocId}`;
        features.set(feature, { featureId: seeded.featureId, contractDocId: seeded.contractDocId, reqId: req!.id, repo: doc!.repo });
        return seeded.abus.get(n)!;
      }
      const abuSpec: AbuSpec = {
        repo: known.repo,
        key: spec.key,
        title: `Unit ${n}`,
        objective: "Build this unit so that its acceptance checks pass.",
        requirements: ["R-001"],
        dependsOn: [],
        sizePoints: 2,
        scope: { write: spec.write, read: [] },
        resources: spec.resources ?? [],
        acceptance: { checks: [{ id: "unit", run: ["npm", "test"] }], tests: [] },
      } as AbuSpec;
      const id = randomUUID();
      await h.owner`insert into wos.abus (id, catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens, repo_full_name)
                    values (${id}, ${known.featureId}, ${known.contractDocId}, ${spec.key}, ${abuSpec.title}, 2, 'ready', ${h.owner.json(abuSpec as never)}, 1000, ${known.repo})`;
      await h.owner`insert into wos.abu_requirements (abu_id, requirement_id) values (${id}, ${known.reqId})`;
      await h.owner`insert into wos.tasks (kind, state, role, abu_id, catalog_feature_id) values ('abu_build', 'open', 'builder', ${id}, ${known.featureId})`;
      return id;
    },

    async leaseReadyToSubmit(builder, abuId) {
      const { plan: _plan, ...ready } = await claimAndPrepare(builder, abuId);
      return ready;
    },

    async roundInReview(builder, abuId) {
      const ready = await claimAndPrepare(builder, abuId);
      const [spec] = await h.owner<{ spec: AbuSpec }[]>`select spec from wos.abus where id = ${abuId}`;
      const scope = spec!.spec.scope.write[0]!;
      const path = scope.endsWith("/**") ? `${scope.slice(0, -3)}/adversarial-${++seq}.ts` : scope;
      const cs = signedChangeset(builder.deviceKey, {
        taskId: ready.taskId,
        leaseId: ready.leaseId,
        deviceId: builder.deviceId,
        parentCommit: ready.parentCommit,
        manifestSha256: ready.manifestSha256,
        files: [{ path, content: "export const unit = true;\n" }],
      });
      const submitted = await call("POST", `/v1/leases/${ready.leaseId}/changeset`, { token: builder.accessToken, idem: true, body: cs });
      const headSha = submitted.body.attempt.headSha as string;
      const suite = {
        action: "completed",
        repository: { full_name: ready.plan.source.repo },
        check_suite: { id: 9000 + seq, head_sha: headSha, conclusion: "success", app: { slug: "github-actions" } },
      };
      await call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
      const [round] = await h.owner<{ id: string; head_sha: string; submission_sha256: string }[]>`
        select id, head_sha, submission_sha256 from wos.rounds where attempt_id = ${ready.attemptId} and state = 'awaiting_reviews'`;
      if (!round) throw new Error("no open round after green CI");
      await forgetFixtureTraffic(builder.accountId);
      return { roundId: round.id, attemptId: ready.attemptId, headSha: round.head_sha, submissionSha256: round.submission_sha256 };
    },

    async reviewAgentRun(reviewer, leaseId) {
      const [lease] = await h.owner<{ context_plan: ContextPlan }[]>`select context_plan from wos.leases where id = ${leaseId}`;
      if (!lease) throw new Error(`lease ${leaseId} not found`);
      const manifest = await manifestFor(h, lease.context_plan);
      await call("POST", `/v1/leases/${leaseId}/manifest`, { token: reviewer.accessToken, idem: true, body: manifest });
      const run = await call("POST", `/v1/leases/${leaseId}/agent-runs`, {
        token: reviewer.accessToken,
        idem: true,
        body: signedRun(reviewer.deviceKey, lease.context_plan, leaseId, reviewer.deviceId, manifest.manifestSha256),
      });
      await forgetFixtureTraffic(reviewer.accountId);
      return run.body.agentRunId as string;
    },

    async bootstrap(enabled) {
      const [row] = await h.owner<
        { enabled: boolean }[]
      >`select coalesce((value->>'enabled')::boolean, false) as enabled from wos.platform_settings where key = 'bootstrap_mode'`;
      if (row?.enabled === enabled) return;
      // Bootstrap is one-way (migration 0002): ending it is allowed, re-entering it is refused by the database.
      await h.owner`update wos.platform_settings set value = jsonb_build_object('enabled', ${enabled}::boolean) where key = 'bootstrap_mode'`;
    },

    async lastEmail(to) {
      try {
        const m = h.mailer.lastTo(to);
        return { link: `https://waronsaas.com/auth/verify?r=${m.requestId}&t=${m.linkToken}`, code: m.code };
      } catch {
        return null;
      }
    },

    githubCalls: () => [...calls],

    async close() {
      await h.close();
    },
  };
}

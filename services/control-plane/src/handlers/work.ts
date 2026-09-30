/**
 * Work discovery, claims and the lease lifecycle (BUILD-PROTOCOL.md sections 3-7, REVIEW-PROTOCOL.md
 * sections 3-6). Every claim is one transaction; every state change is a guarded transition + event.
 */
import {
  type AbuSpec,
  BlockerMachine,
  type AuthorSummary,
  type BuildSummary,
  type ChangesetValidation,
  COMMIT_TRAILERS,
  type ContextPlan,
  type ReviewerSlot,
  type TaskKind,
} from "@waronsaas/contracts";
import { eligibilityRouteError } from "@waronsaas/agent-policy";
import { inTransaction, type Tx } from "@waronsaas/db";
import { APP_COMMIT_AUTHOR_NAME, candidateBranch, coAuthoredBy, noreplyEmail } from "@waronsaas/github";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";
import { insertEvent } from "../db/events.js";
import type { Caller, Handlers } from "../http/router.js";
import { uuidv7 } from "../util/crypto.js";
import { sha256Of, verifyAgentRunSignature, verifyChangesetSignature } from "@waronsaas/contracts/canonical";
import {
  afterDocumentRevision,
  documentScope,
  loadDocument,
  repoManifestAt,
  validateDocumentRevision,
  type DocumentRow,
} from "../domain/documents.js";
import { buildPlan, renderServerDocument } from "../domain/plans.js";
import { createContribution } from "../domain/ledger.js";
import { agentSeatRefusals, revealRound, roundComplete, subjectAuthors } from "../domain/review.js";
import {
  abuTransition,
  acquireLocks,
  activeLeaseCount,
  afterLeaseLost,
  assertDevice,
  attemptTransition,
  AUTHOR_KINDS,
  BUILD_KINDS,
  endAttempt,
  endLease,
  evaluateEligibility,
  insertLease,
  lockRepo,
  REVIEW_KINDS,
  requiredLocks,
  roleForTask,
  SYSTEM,
  taskTransition,
} from "../domain/work.js";
import { abuSummaries, revealedReviews } from "./public.js";
import { assertBuildEntitled } from "./apps.js";
import { assertToolchain } from "../domain/toolchain.js";
import { scopesOverlap } from "@waronsaas/verification";
import { transition } from "../db/transition.js";
import {
  attemptView,
  type AttemptRow,
  type LeaseRow,
  leaseView,
  loadAttempt,
  loadTask,
  queryTasks,
  type TaskRow,
  taskView,
} from "../views.js";

const asContributor = (c: Caller) => ({ kind: "contributor" as const, accountId: c.accountId });
const SYSTEM_TX = { kind: "system" as const, accountId: null };
const by = (c: Caller) => ({ actor: "contributor" as const, accountId: c.accountId });

/** Security-rule codes whose repetition fails the attempt (DOMAIN-MODEL.md 4.6). */
const SECURITY_CODES = new Set([
  "WORKFLOW_FILE",
  "SYMLINK_OR_SPECIAL_FILE",
  "SIGNATURE_INVALID",
  "SUBMISSION_HASH_MISMATCH",
  "SECRET_DETECTED",
]);

async function heldLeaseRow(
  tx: Tx,
  leaseId: string,
  accountId: string,
  expiredCode: "LEASE_EXPIRED" | "LEASE_NOT_HELD" = "LEASE_EXPIRED",
): Promise<LeaseRow> {
  const [l] = await tx<(LeaseRow & { live: boolean })[]>`select *, expires_at > now() as live from wos.leases where id = ${leaseId}`;
  if (!l || l.account_id !== accountId) throw new ApiFailure("LEASE_NOT_HELD", "you do not hold this lease");
  if (l.state !== "active" || !l.live)
    throw new ApiFailure(expiredCode, `the lease is ${l.state === "active" ? "past its expiry" : l.state}`);
  return l;
}

/** The attempt a build/revision task belongs to. */
async function attemptOfTask(tx: Tx, task: TaskRow, accountId: string): Promise<AttemptRow | null> {
  if (task.attempt_id) return loadAttempt(tx, task.attempt_id);
  const [a] = await tx<{ id: string }[]>`
    select id from wos.attempts where abu_id = ${task.abu_id} and account_id = ${accountId}
       and state not in ('merged', 'expired', 'abandoned', 'failed', 'closed_unmerged', 'superseded')`;
  return a ? loadAttempt(tx, a.id) : null;
}

async function claimResponse(tx: Tx, deps: Deps, taskId: string, lease: LeaseRow, plan: ContextPlan, attemptId: string | null) {
  const task = (await loadTask(tx, taskId))!;
  const attempt = attemptId ? await loadAttempt(tx, attemptId) : null;
  // contracts 4.2.0 (B-0008-github-build), integration glue: review claims carry the round a verdict must bind to.
  let round = null;
  if (task.round_id) {
    const [r] = await tx<{ id: string; round_number: number; head_sha: string; submission_sha256: string }[]>`
      select id, round_number, head_sha, submission_sha256 from wos.rounds where id = ${task.round_id}`;
    if (r) round = { id: r.id, number: r.round_number, headSha: r.head_sha, submissionSha256: r.submission_sha256 };
  }
  return {
    task: taskView(task),
    lease: leaseView(lease, deps.policy),
    contextPlan: plan,
    attempt: attempt ? attemptView(attempt) : null,
    round,
  };
}

async function withGithubRetries<T>(deps: Deps, what: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= deps.config.githubRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err instanceof ApiFailure && err.code !== "UPSTREAM_GITHUB") throw err;
    }
  }
  deps.log("warn", `GitHub ${what} failed`, { error: last instanceof Error ? last.message : String(last) });
  throw new ApiFailure("UPSTREAM_GITHUB", `GitHub ${what} failed; retry with the same Idempotency-Key`);
}

/** D15: at most `maxConcurrentBuildLeasesPerProvider` active build leases per provider (AGENT-POLICY.md, D15). */
async function assertProviderCapacity(tx: Tx, deps: Deps, accountId: string, provider: string): Promise<void> {
  const [n] = await tx<{ n: number }[]>`
    select count(*)::int as n from wos.leases l join wos.tasks t on t.id = l.task_id
     where l.account_id = ${accountId} and l.state = 'active' and t.kind in ('abu_build', 'abu_revision')
       and l.context_plan->>'provider' = ${provider}`;
  const limit = deps.policy.limits.maxConcurrentBuildLeasesPerProvider;
  if ((n?.n ?? 0) >= limit)
    throw new ApiFailure("LIMIT_REACHED", `you already hold ${n!.n} build lease(s) on ${provider} (limit ${limit} per provider)`);
}

export const workHandlers: Pick<
  Handlers,
  | "listClaimableAbus"
  | "claimBuild"
  | "claimReview"
  | "listOpenTasks"
  | "claimTask"
  | "heartbeat"
  | "releaseLease"
  | "postManifest"
  | "getLeaseDocument"
  | "postAgentRun"
  | "setAttemptPhase"
  | "submitChangeset"
  | "submitVerdict"
  | "submitRuling"
  | "getAttempt"
> = {
  async listClaimableAbus(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const [af] = await tx<{ target_id: string; contract: string | null }[]>`
        select af.target_id, f.current_contract_document_id as contract
          from wos.app_features af join wos.targets t on t.id = af.target_id join wos.catalog_features f on f.id = af.catalog_feature_id
         where t.slug = ${ctx.params.slug} and f.key = ${ctx.params.feature} and af.state <> 'descoped'`;
      if (!af) throw new ApiFailure("NOT_FOUND", `${ctx.params.slug} does not track ${ctx.params.feature}`);
      if (!af.contract) return { items: [] };
      const ids = await tx<{ id: string }[]>`
        select distinct a.id, a.key from wos.abus a join wos.abu_requirements ar on ar.abu_id = a.id
          join wos.requirements r on r.id = ar.requirement_id
          join wos.requirement_profiles rp on rp.requirement_id = r.id and rp.target_id = ${af.target_id}
         where a.catalog_feature_id = (select catalog_feature_id from wos.documents where id = ${af.contract}) and a.state <> 'superseded'
         order by a.key`;
      const summaries = await abuSummaries(
        tx,
        ids.map((i) => i.id),
      );
      const active = await activeLeaseCount(tx, caller.accountId, BUILD_KINDS);
      const items = [];
      for (const { id } of ids) {
        const s = summaries.get(id)!;
        let claimable = s.state === "ready" && active < deps.policy.limits.maxConcurrentBuildLeasesPerContributor;
        if (claimable) {
          const [t] = await tx<{ excluded: boolean }[]>`
            select ${caller.accountId}::uuid = any(excluded_account_ids) as excluded from wos.tasks where abu_id = ${id} and kind = 'abu_build' and state = 'open'`;
          claimable = !!t && !t.excluded;
        }
        if (claimable) {
          const [spec] = await tx<{ spec: AbuSpec }[]>`select spec from wos.abus where id = ${id}`;
          const wanted = requiredLocks(spec!.spec);
          const live = await tx<{ resource_key: string; mode: string; path_prefix: string | null; path_is_tree: boolean | null }[]>`
            select resource_key, mode, path_prefix, path_is_tree from wos.resource_locks
             where repo_full_name = (select repo_full_name from wos.abus where id = ${id}) and released_at is null`;
          claimable = !wanted.some((w) =>
            live.some((l) =>
              w.pathPrefix !== null && l.path_prefix !== null
                ? scopesOverlap(w.pathIsTree ? `${w.pathPrefix}/**` : w.pathPrefix, l.path_is_tree ? `${l.path_prefix}/**` : l.path_prefix)
                : w.pathPrefix === null &&
                  l.path_prefix === null &&
                  w.key === l.resource_key &&
                  (w.mode === "exclusive" || l.mode === "exclusive"),
            ),
          );
        }
        items.push({ ...s, claimable });
      }
      return { items };
    });
  },

  // LEASE (BUILD-PROTOCOL.md section 3): attempt + lease + locks + pinned base, one transaction.
  async claimBuild(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    await assertBuildEntitled(deps, caller); // D16, S-40: claims need Build enabled for one of the caller's organizations
    const [pre] = await inTransaction(
      deps.sql,
      asContributor(caller),
      (tx) => tx<{ state: string; repo_full_name: string }[]>`select state, repo_full_name from wos.abus where id = ${ctx.params.id}`,
    );
    if (!pre) throw new ApiFailure("NOT_FOUND", "ABU not found");
    const repo = pre.repo_full_name;
    if (pre.state !== "ready") throw new ApiFailure("CONFLICT", `ABU is ${pre.state}`);
    const baseSha = await withGithubRetries(deps, "branch head", () => deps.github.getBranchHead(repo, "main"));
    const manifest = await repoManifestAt(deps, repo, baseSha).catch(() => null);
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      await lockRepo(tx, repo);
      const [abu] = await tx<
        { id: string; key: string; state: string; spec: AbuSpec }[]
      >`select id, key, state, spec from wos.abus where id = ${ctx.params.id}`;
      if (abu?.state !== "ready") throw new ApiFailure("CONFLICT", `ABU is ${abu?.state ?? "gone"}`);
      const [task] = await queryTasks(tx, "where t.abu_id = $1 and t.kind = 'abu_build' and t.state = 'open'", [abu.id]);
      if (!task) throw new ApiFailure("CONFLICT", "no open build task for this ABU");
      await assertDevice(tx, caller.accountId, ctx.body.deviceId);
      const active = await activeLeaseCount(tx, caller.accountId, BUILD_KINDS);
      if (active >= deps.policy.limits.maxConcurrentBuildLeasesPerContributor) {
        throw new ApiFailure("LIMIT_REACHED", `you already hold ${active} build leases`);
      }
      const elig = await evaluateEligibility(tx, deps, {
        accountId: caller.accountId,
        deviceId: ctx.body.deviceId,
        role: "builder",
        task,
        subjectAuthorIds: [],
        otherSlotReviewerId: null,
        reviewsOfSameAuthorLast7d: 0,
        activeLeasesOfKind: active,
        claimedModel: ctx.body.model ?? null,
        builder: { writeScopes: abu.spec.scope.write, manifest },
      });
      if (!elig.eligible)
        throw new ApiFailure(eligibilityRouteError(elig) ?? "NOT_ELIGIBLE", "not eligible to build this ABU", { reasons: elig.reasons });
      await assertProviderCapacity(tx, deps, caller.accountId, elig.model.provider);
      await assertToolchain(tx, deps, {
        accountId: caller.accountId,
        deviceId: ctx.body.deviceId,
        repo,
        commit: baseSha,
        write: abu.spec.scope.write,
        manifest,
      });
      const attemptId = uuidv7();
      await tx`insert into wos.attempts (id, abu_id, account_id, github_user_id, state, base_sha)
               values (${attemptId}, ${abu.id}, ${caller.accountId}, ${caller.githubUserId!}, 'leased', ${baseSha})`;
      await insertEvent(
        tx,
        { type: "attempt.created", v: 1, visibility: "public", payload: { attemptId, abu: abu.key, state: "leased" } },
        { aggregateKind: "attempt", aggregateId: attemptId, actor: "contributor", actorAccountId: caller.accountId },
      );
      await acquireLocks(tx, repo, attemptId, requiredLocks(abu.spec));
      const leaseId = uuidv7();
      const plan = await buildPlan(tx, deps, {
        task,
        leaseId,
        attemptId,
        role: "builder",
        model: elig.model,
        reasoning: elig.reasoning,
        source: { repo, commit: baseSha },
        abu: abu.spec,
        priorRound: 0,
        subjectId: attemptId,
        repoManifest: manifest,
        headSha: null,
        ciFailed: false,
      });
      const lease = await insertLease(tx, deps, {
        id: leaseId,
        taskId: task.id,
        accountId: caller.accountId,
        deviceId: ctx.body.deviceId,
        role: "builder",
        plan,
      });
      await taskTransition(tx, task, "claim", by(caller));
      await abuTransition(tx, abu, "attempt_started", SYSTEM);
      return claimResponse(tx, deps, task.id, lease, plan, attemptId);
    });
  },

  // Reviewers never choose: the server assigns the oldest eligible task of the slot (REVIEW-PROTOCOL.md section 3).
  async claimReview(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    await assertBuildEntitled(deps, caller); // D16, S-40: claims need Build enabled for one of the caller's organizations
    const { slot, kinds, deviceId } = ctx.body;
    const active = await inTransaction(deps.sql, asContributor(caller), async (tx) => {
      await assertDevice(tx, caller.accountId, deviceId).catch(() => {
        throw new ApiFailure("NOT_ELIGIBLE", "unknown or revoked device", { reasons: ["device not registered to this account"] });
      });
      const n = await activeLeaseCount(tx, caller.accountId, REVIEW_KINDS);
      if (n >= deps.policy.limits.maxConcurrentReviewLeasesPerContributor)
        throw new ApiFailure("LIMIT_REACHED", `you already hold ${n} review leases`);
      const general = await evaluateEligibility(tx, deps, {
        accountId: caller.accountId,
        deviceId,
        role: roleForTask(kinds[0]!, slot),
        task: null,
        subjectAuthorIds: [],
        otherSlotReviewerId: null,
        reviewsOfSameAuthorLast7d: 0,
        activeLeasesOfKind: n,
      });
      if (!general.eligible) throw new ApiFailure("NOT_ELIGIBLE", `not eligible for the ${slot} slot`, { reasons: general.reasons });
      return n;
    });
    // Authorised: assignment needs other accounts' private rows (the other slot's reviewer), so it runs as system (S-9).
    return inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      const candidates = await queryTasks(
        tx,
        `where t.kind = any($1::text[]) and t.reviewer_slot = $2 and t.state = 'open' and not ($3::uuid = any(t.excluded_account_ids))
         order by t.created_at, random() limit 50`,
        [kinds, slot, caller.accountId],
      );
      for (const task of candidates) {
        const [round] = await tx<
          { id: string; attempt_id: string | null; document_id: string | null; round_number: number; head_sha: string; state: string }[]
        >`
          select id, attempt_id, document_id, round_number, head_sha, state from wos.rounds where id = ${task.round_id}`;
        if (round?.state !== "awaiting_reviews") continue;
        const authors = await subjectAuthors(tx, round);
        const [other] = await tx<{ account_id: string }[]>`
          select l.account_id from wos.tasks t2 join wos.leases l on l.task_id = t2.id
           where t2.round_id = ${round.id} and t2.reviewer_slot <> ${slot} and l.state in ('active', 'completed')
          union select account_id from wos.reviews where round_id = ${round.id} and slot <> ${slot} limit 1`;
        const [same] = await tx<{ n: number }[]>`
          select count(*)::int as n from wos.reviews v join wos.rounds r on r.id = v.round_id
            left join wos.attempts a on a.id = r.attempt_id
           where v.account_id = ${caller.accountId} and v.sealed_at > now() - interval '7 days'
             and a.account_id = any(${authors as never}::uuid[])`;
        const elig = await evaluateEligibility(tx, deps, {
          accountId: caller.accountId,
          deviceId,
          role: roleForTask(task.kind, slot as ReviewerSlot),
          task,
          subjectAuthorIds: authors,
          otherSlotReviewerId: other?.account_id ?? null,
          reviewsOfSameAuthorLast7d: same?.n ?? 0,
          activeLeasesOfKind: active,
        });
        if (!elig.eligible) continue;
        // D53: never the Fable seat under the fallback, never a reviewer of the model that built the subject.
        if ((await agentSeatRefusals(tx, round, slot, elig.model.modelId)).length > 0) continue;
        let spec: AbuSpec | null = null;
        const repo = task.repo;
        if (round.attempt_id) {
          const [a] = await tx<
            { spec: AbuSpec }[]
          >`select ab.spec from wos.attempts at join wos.abus ab on ab.id = at.abu_id where at.id = ${round.attempt_id}`;
          spec = a?.spec ?? null;
        } else {
        }
        const leaseId = uuidv7();
        const plan = await buildPlan(tx, deps, {
          task,
          leaseId,
          attemptId: round.attempt_id,
          role: roleForTask(task.kind, slot as ReviewerSlot),
          model: elig.model,
          reasoning: elig.reasoning,
          source: { repo, commit: round.head_sha },
          abu: spec,
          priorRound: round.round_number - 1,
          subjectId: round.attempt_id ?? round.document_id,
          repoManifest: null,
          headSha: round.head_sha,
          ciFailed: false,
        });
        const lease = await insertLease(tx, deps, {
          id: leaseId,
          taskId: task.id,
          accountId: caller.accountId,
          deviceId,
          role: plan.role,
          plan,
        });
        await taskTransition(tx, task, "claim", by(caller));
        return claimResponse(tx, deps, task.id, lease, plan, round.attempt_id);
      }
      return null;
    });
  },

  async listOpenTasks(ctx) {
    const caller = ctx.caller!;
    return inTransaction(ctx.deps.sql, asContributor(caller), async (tx) => {
      const kinds: TaskKind[] = ctx.query.kind
        ? [ctx.query.kind]
        : ["roadmap_author", "feature_author", "abu_revision", "conflict_resolution"];
      const rows = await queryTasks(
        tx,
        `where t.kind = any($1::text[]) and t.kind not in ('roadmap_review', 'feature_review', 'implementation_review', 'abu_build')
           and t.state = 'open' and not ($2::uuid = any(t.excluded_account_ids))
           and (t.restricted_to_account_id is null or t.restricted_to_account_id = $2::uuid)
         order by t.created_at limit 200`,
        [kinds, caller.accountId],
      );
      return {
        items: rows
          .filter((r) => !ctx.query.target || r.relevant_to.includes(ctx.query.target))
          .filter((r) => !ctx.query.feature || r.feature_key === ctx.query.feature)
          .map(taskView),
      };
    });
  },

  async claimTask(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    await assertBuildEntitled(deps, caller); // D16, S-40: claims need Build enabled for one of the caller's organizations
    const task0 = await inTransaction(deps.sql, asContributor(caller), (tx) => loadTask(tx, ctx.params.id));
    if (!task0) throw new ApiFailure("NOT_FOUND", "task not found");
    if (REVIEW_KINDS.includes(task0.kind))
      throw new ApiFailure("NOT_ELIGIBLE", "reviews are assigned by POST /v1/reviews/claim", { reasons: ["review task"] });
    if (task0.kind === "abu_build")
      throw new ApiFailure("NOT_ELIGIBLE", "claim builds with POST /v1/abus/:id/claim", { reasons: ["build task"] });
    if (task0.state !== "open") throw new ApiFailure("CONFLICT", `task is ${task0.state}`);
    // Source commit for the plan: the candidate head (revisions), the document head, or the repo head.
    let source: { repo: string; commit: string };
    let rebaseTo: string | null = null;
    let doc: DocumentRow | null = null;
    if (task0.kind === "abu_revision") {
      const a = await inTransaction(deps.sql, asContributor(caller), (tx) => loadAttempt(tx, task0.attempt_id!));
      if (!a) throw new ApiFailure("NOT_FOUND", "attempt not found");
      if (a.pr_number !== null) rebaseTo = await withGithubRetries(deps, "branch head", () => deps.github.getBranchHead(a.repo, "main"));
      source = { repo: a.repo, commit: rebaseTo ?? a.head_sha ?? a.base_sha };
    } else {
      doc = task0.document_id ? await inTransaction(deps.sql, asContributor(caller), (tx) => loadDocument(tx, task0.document_id!)) : null;
      const repo = doc?.repo ?? task0.repo;
      source = {
        repo,
        commit: doc?.head_sha ?? (await withGithubRetries(deps, "branch head", () => deps.github.getBranchHead(repo, "main"))),
      };
    }
    const manifest = task0.kind === "abu_revision" ? await repoManifestAt(deps, source.repo, source.commit).catch(() => null) : null;
    return inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      const task = await loadTask(tx, ctx.params.id);
      if (task?.state !== "open") throw new ApiFailure("CONFLICT", "task is no longer open");
      await assertDevice(tx, caller.accountId, ctx.body.deviceId);
      const role = roleForTask(task.kind, task.reviewer_slot);
      const family = task.kind === "abu_revision" ? BUILD_KINDS : AUTHOR_KINDS;
      const limit =
        task.kind === "abu_revision"
          ? deps.policy.limits.maxConcurrentBuildLeasesPerContributor
          : deps.policy.limits.maxConcurrentAuthorLeasesPerContributor;
      const active = await activeLeaseCount(tx, caller.accountId, family);
      if (active >= limit) throw new ApiFailure("LIMIT_REACHED", `you already hold ${active} leases of this kind`);
      const revisionSpec =
        task.kind === "abu_revision"
          ? ((await tx<{ spec: AbuSpec }[]>`select spec from wos.abus where id = ${task.abu_id}`)[0]?.spec ?? null)
          : null;
      let authors: string[] = [];
      if (task.kind === "conflict_resolution" && task.document_id)
        authors = await subjectAuthors(tx, { attempt_id: null, document_id: task.document_id });
      const elig = await evaluateEligibility(tx, deps, {
        accountId: caller.accountId,
        deviceId: ctx.body.deviceId,
        role,
        task,
        subjectAuthorIds: authors,
        otherSlotReviewerId: null,
        reviewsOfSameAuthorLast7d: 0,
        activeLeasesOfKind: active,
        claimedModel: ctx.body.model ?? null,
        ...(revisionSpec ? { builder: { writeScopes: revisionSpec.scope.write, manifest } } : {}),
      });
      if (!elig.eligible)
        throw new ApiFailure(eligibilityRouteError(elig) ?? "NOT_ELIGIBLE", "not eligible for this task", { reasons: elig.reasons });
      if (task.kind === "abu_revision") await assertProviderCapacity(tx, deps, caller.accountId, elig.model.provider);
      let spec: AbuSpec | null = null;
      let attemptId: string | null = null;
      let priorRound = 0;
      let ciFailed = false;
      if (task.kind === "abu_revision") {
        const attempt = await loadAttempt(tx, task.attempt_id!);
        if (attempt?.state !== "changes_requested") throw new ApiFailure("CONFLICT", `attempt is ${attempt?.state ?? "gone"}`);
        attemptId = attempt.id;
        const [s] = await tx<{ spec: AbuSpec }[]>`select spec from wos.abus where id = ${attempt.abu_id}`;
        spec = s!.spec;
        await assertToolchain(tx, deps, {
          accountId: caller.accountId,
          deviceId: ctx.body.deviceId,
          repo: source.repo,
          commit: source.commit,
          write: spec.scope.write,
          manifest,
        });
        const [r] = await tx<
          { n: number | null }[]
        >`select max(round_number)::int as n from wos.rounds where attempt_id = ${attempt.id} and state = 'revealed'`;
        priorRound = r?.n ?? 0;
        const [ci] = await tx<{ conclusion: string }[]>`
          select conclusion from wos.verification_runs where attempt_id = ${attempt.id} and source = 'ci' and head_sha = ${attempt.head_sha ?? ""}
           order by created_at desc limit 1`;
        ciFailed = !!ci && ci.conclusion !== "success";
        await attemptTransition(tx, attempt, "resume_for_revision", by(caller), {
          repair_count: attempt.repair_count + 1,
          local_repair_count: 0,
          ...(rebaseTo ? { base_sha: rebaseTo } : {}),
        });
      } else if (task.document_id) {
        const [r] = await tx<
          { n: number | null }[]
        >`select max(round_number)::int as n from wos.rounds where document_id = ${task.document_id} and state = 'revealed'`;
        priorRound = r?.n ?? 0;
      }
      if (task.blocker_id) {
        const [b] = await tx<{ state: string }[]>`select state from wos.blockers where id = ${task.blocker_id}`;
        if (b?.state === "open") {
          await transition(tx, {
            machine: BlockerMachine,
            table: "blockers",
            id: task.blocker_id,
            from: "open",
            event: "claim_resolution",
            actor: "contributor",
            actorAccountId: caller.accountId,
            aggregateKind: "blocker",
            emit: {
              type: "blocker.state_changed",
              v: 1,
              visibility: "public",
              payload: { blockerId: task.blocker_id, from: "open", to: "resolving" },
            },
          });
        }
      }
      const leaseId = uuidv7();
      const plan = await buildPlan(tx, deps, {
        task,
        leaseId,
        attemptId,
        role,
        model: elig.model,
        reasoning: elig.reasoning,
        source,
        abu: spec,
        priorRound,
        subjectId: attemptId ?? task.document_id,
        repoManifest: manifest,
        headSha: task.kind === "abu_revision" ? source.commit : null,
        ciFailed,
      });
      const lease = await insertLease(tx, deps, {
        id: leaseId,
        taskId: task.id,
        accountId: caller.accountId,
        deviceId: ctx.body.deviceId,
        role,
        plan,
      });
      await taskTransition(tx, task, "claim", by(caller));
      return claimResponse(tx, deps, task.id, lease, plan, attemptId);
    });
  },

  async heartbeat(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const [l] = await tx<
        (LeaseRow & { live: boolean })[]
      >`select *, expires_at > now() as live from wos.leases where id = ${ctx.params.id}`;
      if (!l || l.account_id !== caller.accountId || l.device_id !== ctx.body.deviceId)
        throw new ApiFailure("LEASE_NOT_HELD", "you do not hold this lease on this device");
      if (l.state !== "active" || !l.live) throw new ApiFailure("LEASE_EXPIRED", "the lease has expired");
      const ttl = deps.policy.roles.find((r) => r.role === l.context_plan.role)?.lease.ttlMinutes ?? 30;
      // Guarded: a heartbeat racing the sweeper either extends the lease or loses (409 LEASE_EXPIRED).
      const [row] = await tx<LeaseRow[]>`
        update wos.leases set expires_at = least(now() + make_interval(mins => ${ttl}), hard_deadline_at), heartbeat_at = now(),
               row_version = row_version + 1
         where id = ${l.id} and state = 'active' and expires_at > now() and row_version = ${l.row_version}
        returning *`;
      if (!row) throw new ApiFailure("LEASE_EXPIRED", "the lease expired while extending it");
      return leaseView(row, deps.policy);
    });
  },

  async releaseLease(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    return inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      const [l] = await tx<LeaseRow[]>`select * from wos.leases where id = ${ctx.params.id}`;
      if (!l || l.account_id !== caller.accountId || l.state !== "active")
        throw new ApiFailure("LEASE_NOT_HELD", "you do not hold an active lease with this id");
      await endLease(tx, l, "release", by(caller), ctx.body.reason || "released");
      await afterLeaseLost(tx, deps, l, "released", by(caller), `released: ${ctx.body.reason}`);
      const [after] = await tx<LeaseRow[]>`select * from wos.leases where id = ${l.id}`;
      return leaseView(after!, deps.policy);
    });
  },

  // CONTEXT-PROTOCOL.md section 2: server documents of the caller's lease plan, rendered by the same code that hashed them.
  async getLeaseDocument(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const l = await heldLeaseRow(tx, ctx.params.id, caller.accountId);
      const plan = l.context_plan as unknown as ContextPlan;
      const selector = plan.artifacts.find((a) => a.kind === "server_document" && a.ref === ctx.query.ref);
      if (selector?.kind !== "server_document") throw new ApiFailure("FORBIDDEN", "that ref is not in this lease's context plan");
      const text = await renderServerDocument(tx, deps, selector.ref);
      if (text === null) throw new ApiFailure("NOT_FOUND", "document not found");
      const sha256 = sha256Of(text);
      if (sha256 !== selector.sha256) {
        deps.log("error", "server document drifted from its plan hash", { ref: selector.ref, leaseId: l.id });
        throw new ApiFailure("NOT_FOUND", "the document no longer renders as planned");
      }
      return { ref: selector.ref, sha256, contentBase64: Buffer.from(text, "utf8").toString("base64") };
    });
  },

  async postManifest(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const manifest = ctx.body;
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const l = await heldLeaseRow(tx, ctx.params.id, caller.accountId);
      const plan = l.context_plan as unknown as ContextPlan;
      if (manifest.task.id !== l.task_id)
        throw new ApiFailure("MANIFEST_REJECTED", "manifest is for another task", { reasons: ["task id differs from the lease's task"] });
      const check = deps.logic.checkManifestAgainstPlan(manifest, plan);
      if (!check.ok)
        throw new ApiFailure("MANIFEST_REJECTED", "the manifest does not match the plan issued with this lease", {
          reasons: check.reasons,
        });
      const [dupe] = await tx<
        { id: string; lease_id: string }[]
      >`select id, lease_id from wos.context_manifests where manifest_sha256 = ${manifest.manifestSha256} and lease_id = ${l.id}`;
      // Integration glue (migration 0004): a deterministic engine gives a re-claimed task the same manifest;
      // manifests are unique per lease, so only a repeat on THIS lease is a replay.
      if (dupe) return { accepted: true as const, manifestId: dupe.id };
      const manifestId = uuidv7();
      await tx`
        insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
        values (${manifestId}, ${l.id}, ${l.task_id}, ${caller.accountId}, ${manifest.role}, ${manifest.model.modelId}, ${manifest.reasoning},
                ${manifest.contextFormatVersion}, ${tx.json(manifest as never)}, ${manifest.manifestSha256})`;
      const task = (await loadTask(tx, l.task_id))!;
      if (BUILD_KINDS.includes(task.kind)) {
        const attempt = await attemptOfTask(tx, task, caller.accountId);
        if (attempt) {
          if (attempt.state === "leased") await attemptTransition(tx, attempt, "start_build", by(caller));
          await insertEvent(
            tx,
            {
              type: "attempt.manifest_recorded",
              v: 1,
              visibility: "private",
              payload: { attemptId: attempt.id, manifestSha256: manifest.manifestSha256 },
            },
            { aggregateKind: "attempt", aggregateId: attempt.id, actor: "contributor", actorAccountId: caller.accountId },
          );
        }
      }
      return { accepted: true as const, manifestId };
    });
  },

  // S-13: stored whatever the signature says; signature_valid = false blocks qualification.
  async postAgentRun(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const record = ctx.body;
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const l = await heldLeaseRow(tx, ctx.params.id, caller.accountId, "LEASE_NOT_HELD");
      if (record.leaseId !== l.id || record.deviceId !== l.device_id)
        throw new ApiFailure("VALIDATION_FAILED", "record is for another lease or device");
      const [m] = await tx<
        { id: string }[]
      >`select id from wos.context_manifests where lease_id = ${l.id} and manifest_sha256 = ${record.manifestSha256}`;
      if (!m) throw new ApiFailure("VALIDATION_FAILED", "post the context manifest for this run first");
      const [d] = await tx<
        { public_key: string; revoked_at: Date | null }[]
      >`select public_key, revoked_at from wos.devices where id = ${l.device_id}`;
      const valid = !!d && !d.revoked_at && verifyAgentRunSignature(record, d.public_key);
      const id = uuidv7();
      await tx`insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid)
               values (${id}, ${l.id}, ${m.id}, ${caller.accountId}, ${l.device_id}, ${tx.json(record as never)}, ${valid})`;
      return { agentRunId: id };
    });
  },

  async setAttemptPhase(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    return inTransaction(deps.sql, asContributor(caller), async (tx) => {
      const attempt = await loadAttempt(tx, ctx.params.id);
      if (!attempt || attempt.account_id !== caller.accountId) throw new ApiFailure("LEASE_NOT_HELD", "this is not your attempt");
      const [l] = await tx<{ id: string }[]>`
        select l.id from wos.leases l join wos.tasks t on t.id = l.task_id
         where l.account_id = ${caller.accountId} and l.state = 'active' and l.expires_at > now()
           and ((t.kind = 'abu_build' and t.abu_id = ${attempt.abu_id}) or (t.kind = 'abu_revision' and t.attempt_id = ${attempt.id}))`;
      if (!l) throw new ApiFailure("LEASE_NOT_HELD", "no active build lease for this attempt");
      if (ctx.body.phase === "verifying" && attempt.state === "building") {
        const [run] = await tx`select 1 as x from wos.agent_runs where lease_id = ${l.id} limit 1`;
        if (!run) throw new ApiFailure("CONFLICT", "post the agent run record before verifying");
        await attemptTransition(tx, attempt, "start_verify", by(caller));
      } else if (ctx.body.phase === "building" && ctx.body.localRepair && attempt.state === "verifying") {
        if (attempt.local_repair_count >= deps.policy.limits.maxLocalRepairLoops) {
          throw new ApiFailure(
            "LIMIT_REACHED",
            `local repair limit (${deps.policy.limits.maxLocalRepairLoops}) reached; release the lease`,
          );
        }
        await attemptTransition(tx, attempt, "verify_failed_locally", by(caller), { local_repair_count: attempt.local_repair_count + 1 });
      } else {
        throw new ApiFailure("CONFLICT", `attempt is ${attempt.state}; cannot move to ${ctx.body.phase}`);
      }
      return attemptView((await loadAttempt(tx, attempt.id))!);
    });
  },

  // BUILD-PROTOCOL.md sections 6-7: validate, App commit, then record everything in one transaction.
  async submitChangeset(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const cs = ctx.body;
    const pre = await inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      const l = await heldLeaseRow(tx, ctx.params.id, caller.accountId);
      if (cs.leaseId !== l.id || cs.taskId !== l.task_id || cs.deviceId !== l.device_id) {
        throw new ApiFailure("VALIDATION_FAILED", "changeset leaseId, taskId and deviceId must match the lease");
      }
      const task = (await loadTask(tx, l.task_id))!;
      const [device] = await tx<
        { public_key: string; revoked_at: Date | null }[]
      >`select public_key, revoked_at from wos.devices where id = ${l.device_id}`;
      const [manifest] =
        await tx`select 1 as x from wos.context_manifests where lease_id = ${l.id} and manifest_sha256 = ${cs.manifestSha256}`;
      let attempt: AttemptRow | null = null;
      let doc: DocumentRow | null = null;
      let spec: AbuSpec | null = null;
      if (BUILD_KINDS.includes(task.kind)) {
        attempt = await attemptOfTask(tx, task, caller.accountId);
        if (attempt?.state !== "verifying")
          throw new ApiFailure("VALIDATION_FAILED", `attempt must be verifying (is ${attempt?.state ?? "missing"})`);
        spec = (await tx<{ spec: AbuSpec }[]>`select spec from wos.abus where id = ${attempt.abu_id}`)[0]!.spec;
      } else if (task.kind === "roadmap_author" || task.kind === "feature_author") {
        doc = await loadDocument(tx, task.document_id!);
        if (!doc || (doc.state !== "drafting" && doc.state !== "revising"))
          throw new ApiFailure("VALIDATION_FAILED", `document is ${doc?.state ?? "missing"}`);
      } else {
        throw new ApiFailure("VALIDATION_FAILED", `${task.kind} tasks do not submit changesets`);
      }
      // Every open material finding of the subject needs an answer (REVIEW-PROTOCOL.md section 7).
      const subjectId = attempt?.id ?? doc!.id;
      const open = await tx<{ id: string }[]>`
        select f.id from wos.findings f join wos.rounds r on r.id = f.round_id
         where (f.attempt_id = ${subjectId} or f.document_id = ${subjectId}) and r.state = 'revealed' and f.severity = 'material' and f.state in ('open', 'disputed')`;
      const answered = new Set((cs.summary as AuthorSummary | BuildSummary).responses.map((r) => r.findingId));
      const unanswered = open.filter((f) => !answered.has(f.id)).map((f) => f.id);
      if (unanswered.length > 0)
        throw new ApiFailure("VALIDATION_FAILED", "answer every open material finding with fixed or disputed", { unanswered });
      const plan = l.context_plan as unknown as ContextPlan;
      const expectedParent = attempt ? (attempt.head_sha ?? attempt.base_sha) : (doc!.head_sha ?? plan.source.commit);
      return { l, task, device, manifestOk: !!manifest, attempt, doc, spec, expectedParent };
    });
    const repo = pre.doc?.repo ?? pre.attempt!.repo;
    const repoManifest = await repoManifestAt(deps, repo, cs.parentCommit);
    if (!repoManifest) throw new ApiFailure("VALIDATION_FAILED", "wos.json is missing or invalid at the parent commit");
    const existingPaths = new Set(await withGithubRetries(deps, "tree listing", () => deps.github.listTreePaths(repo, cs.parentCommit)));
    const validation: ChangesetValidation = deps.logic.validateChangeset(cs, {
      kind: pre.doc ? pre.doc.kind : "abu",
      abu: pre.spec,
      documentPaths: pre.doc ? await documentScope(deps, pre.doc, cs, existingPaths) : [],
      repoManifest,
      existingPaths,
    });
    const errors = [...validation.errors];
    if (cs.parentCommit !== pre.expectedParent) {
      errors.push({ code: "PARENT_MISMATCH", path: null, message: `parent must be ${pre.expectedParent}` });
    }
    if (!pre.manifestOk)
      errors.push({ code: "MANIFEST_MISMATCH", path: null, message: "manifestSha256 is not an accepted manifest of this lease" });
    if (!pre.device || pre.device.revoked_at || !verifyChangesetSignature(cs, pre.device.public_key)) {
      errors.push({ code: "SIGNATURE_INVALID", path: null, message: "signature does not verify with the device key" });
    }
    const result: ChangesetValidation = { ok: validation.ok && errors.length === validation.errors.length, errors };
    const fileManifest = cs.files.map((f) =>
      f.op === "upsert" ? { path: f.path, op: f.op, mode: f.mode, sha256: f.sha256, bytes: f.bytes } : { path: f.path, op: f.op },
    );
    const totalBytes = cs.files.reduce((n, f) => n + (f.op === "upsert" ? f.bytes : 0), 0);
    const insertChangeset = (tx: Tx, ok: boolean, id: string) =>
      tx`insert into wos.changesets (id, lease_id, task_id, account_id, device_id, parent_sha, manifest_sha256, submission_sha256, signature_valid,
                                     file_manifest, total_bytes, validation, ok, summary)
         values (${id}, ${pre.l.id}, ${pre.task.id}, ${caller.accountId}, ${pre.l.device_id}, ${cs.parentCommit}, ${cs.manifestSha256},
                 ${cs.submissionSha256}, ${!errors.some((e) => e.code === "SIGNATURE_INVALID")}, ${tx.json(fileManifest as never)},
                 ${Math.min(totalBytes, 4_000_000)}, ${tx.json(result as never)}, ${ok}, ${tx.json(cs.summary as never)})`;

    if (!result.ok) {
      await inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
        await insertChangeset(tx, false, uuidv7());
        if (pre.attempt && errors.some((e) => SECURITY_CODES.has(e.code))) {
          const [n] = await tx<{ n: number }[]>`
            select count(*)::int as n from wos.changesets c join wos.tasks t on t.id = c.task_id
             where not c.ok and c.account_id = ${caller.accountId}
               and (t.attempt_id = ${pre.attempt.id} or (t.kind = 'abu_build' and t.abu_id = ${pre.attempt.abu_id} and c.created_at >= ${pre.attempt.updated_at}::timestamptz - interval '1 day'))
               and exists (select 1 from jsonb_array_elements(c.validation->'errors') e where e->>'code' = any(${[...SECURITY_CODES]}::text[]))`;
          if ((n?.n ?? 0) >= 2) {
            const a = await loadAttempt(tx, pre.attempt.id);
            if (a && a.state === "verifying")
              await endAttempt(tx, deps, a, "fail", SYSTEM, "repeated submissions rejected for a security rule");
          }
        }
      });
      throw new ApiFailure("SCOPE_VIOLATION", "the changeset failed server-side validation; nothing was committed", result);
    }

    // The App builds the commit (contributors never push). Nothing is recorded unless it succeeds.
    const [handle] = [caller.handle ?? ""];
    const [ghLogin] = await inTransaction(
      deps.sql,
      SYSTEM_TX,
      (tx) => tx<{ github_login: string }[]>`select github_login from wos.accounts where id = ${caller.accountId}`,
    );
    const branch = pre.attempt ? candidateBranch(pre.attempt.id) : pre.doc!.branch;
    const expectedHead = pre.attempt ? pre.attempt.head_sha : pre.doc!.head_sha;
    const title = pre.attempt
      ? `${pre.attempt.abu_key}: ${pre.spec!.title}`
      : `${pre.doc!.kind === "roadmap" ? pre.doc!.target_slug : pre.doc!.feature_key} v${pre.doc!.version} revision`;
    const trailers: Record<string, string> = {
      [COMMIT_TRAILERS.task]: pre.task.id,
      ...(pre.attempt ? { [COMMIT_TRAILERS.attempt]: pre.attempt.id, [COMMIT_TRAILERS.abu]: pre.attempt.abu_key } : {}),
      [COMMIT_TRAILERS.manifest]: cs.manifestSha256,
      [COMMIT_TRAILERS.contributor]: handle,
    };
    const coAuthor = coAuthoredBy(caller.githubUserId!, ghLogin?.github_login ?? handle);
    const commit = await withGithubRetries(deps, "commit", () =>
      deps.github.commitChangeset(
        repo,
        branch,
        cs,
        {
          author: {
            name: APP_COMMIT_AUTHOR_NAME,
            // Attributed to the bot account when its id is known (the id+login noreply form GitHub links to the account).
            email:
              deps.config.appBotUserId !== null
                ? noreplyEmail(deps.config.appBotUserId, APP_COMMIT_AUTHOR_NAME)
                : `${APP_COMMIT_AUTHOR_NAME}@users.noreply.github.com`,
          },
          trailers,
          message: `${title}\n\n${Object.entries(trailers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}\n${coAuthor}`,
        },
        { createBranch: expectedHead === null, expectedHeadSha: expectedHead },
      ),
    );
    const docErrors = pre.doc
      ? await inTransaction(deps.sql, SYSTEM_TX, (tx) => validateDocumentRevision(tx, deps, pre.doc!, cs, commit.commitSha))
      : [];

    return inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      const changesetId = uuidv7();
      await insertChangeset(tx, true, changesetId);
      await tx`insert into wos.candidate_commits (id, changeset_id, repo, branch, commit_sha)
               values (${uuidv7()}, ${changesetId}, ${repo}, ${branch}, ${commit.commitSha})`;
      const lease = await tx<
        { id: string }[]
      >`select id from wos.leases where id = ${pre.l.id} and state = 'active' and expires_at > now()`;
      if (lease.length === 0) throw new ApiFailure("LEASE_EXPIRED", "the lease expired before the submission was recorded");
      await endLease(tx, pre.l, "complete", SYSTEM, "submission accepted");
      await taskTransition(tx, pre.task, "submit", by(caller));
      await taskTransition(tx, { id: pre.task.id, state: "submitted" }, "accept_output", SYSTEM);
      for (const r of (cs.summary as AuthorSummary | BuildSummary).responses) {
        const [f] = await tx<{ id: string }[]>`
          select id from wos.findings where id = ${r.findingId} and (attempt_id = ${pre.attempt?.id ?? null} or document_id = ${pre.doc?.id ?? null})`;
        if (!f) continue;
        await tx`insert into wos.finding_responses (id, finding_id, account_id, source, action, note)
                 values (${uuidv7()}, ${f.id}, ${caller.accountId}, 'author', ${r.action}, ${r.note})`;
        if (r.action === "disputed") {
          await tx`update wos.findings set state = 'disputed', dispute_rounds = dispute_rounds + 1, row_version = row_version + 1
                    where id = ${f.id} and state in ('open', 'disputed')`;
        }
      }
      let attemptOut = null;
      if (pre.attempt) {
        const submitted = await attemptTransition(tx, pre.attempt, "submit_changeset", by(caller));
        await attemptTransition(tx, { ...pre.attempt, state: submitted }, "candidate_committed", SYSTEM, {
          head_sha: commit.commitSha,
          candidate_branch: branch,
        });
        attemptOut = attemptView((await loadAttempt(tx, pre.attempt.id))!);
      } else {
        await afterDocumentRevision(tx, deps, pre.doc!, {
          taskId: pre.task.id,
          headSha: commit.commitSha,
          submissionSha256: cs.submissionSha256,
          errors: docErrors,
          by: by(caller),
        });
      }
      return { validation: result, attempt: attemptOut, documentId: pre.doc?.id ?? null };
    });
  },

  // Sealed until both slots are in; then revealed atomically in the same transaction (REVIEW-PROTOCOL.md sections 5-6).
  async submitVerdict(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    const b = ctx.body;
    return inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      const l = await heldLeaseRow(tx, ctx.params.id, caller.accountId);
      const task = (await loadTask(tx, l.task_id))!;
      if (!REVIEW_KINDS.includes(task.kind) || task.state !== "leased")
        throw new ApiFailure("VALIDATION_FAILED", "this lease is not a review");
      // Serialise the two slots of the round (row lock), then check the binding (D9).
      const [round] = await tx<
        { id: string; head_sha: string; submission_sha256: string; attempt_id: string | null; document_id: string | null }[]
      >`
        update wos.rounds set row_version = row_version + 1 where id = ${task.round_id} and state = 'awaiting_reviews'
        returning id, head_sha, submission_sha256, attempt_id, document_id`;
      if (!round) throw new ApiFailure("CONFLICT", "the round is no longer awaiting reviews");
      if (b.headSha !== round.head_sha || b.submissionSha256 !== round.submission_sha256) {
        throw new ApiFailure("VALIDATION_FAILED", "verdict must be bound to the round's head sha and submission hash");
      }
      // The verdict is bound to exactly this signed run of this lease (migration 0003, B-0003-architect).
      const [run] = await tx<{ manifest_id: string; signature_valid: boolean }[]>`
        select manifest_id, signature_valid from wos.agent_runs where id = ${b.agentRunId} and lease_id = ${l.id} and account_id = ${caller.accountId}`;
      if (!run) throw new ApiFailure("VALIDATION_FAILED", "agentRunId is not a run recorded for this lease");
      if (!run.signature_valid) throw new ApiFailure("VALIDATION_FAILED", "the agent run's device signature is not valid");
      const authors = await subjectAuthors(tx, round);
      const [other] = await tx<
        { account_id: string }[]
      >`select account_id from wos.reviews where round_id = ${round.id} and slot <> ${task.reviewer_slot}`;
      const elig = await evaluateEligibility(tx, deps, {
        accountId: caller.accountId,
        deviceId: l.device_id,
        role: roleForTask(task.kind, task.reviewer_slot),
        task: { ...task, excluded_account_ids: task.excluded_account_ids.filter((x) => x !== caller.accountId) },
        subjectAuthorIds: authors,
        otherSlotReviewerId: other?.account_id ?? null,
        reviewsOfSameAuthorLast7d: 0,
        activeLeasesOfKind: 0,
      });
      if (!elig.eligible) throw new ApiFailure("CONFLICT", "you are no longer eligible to review this subject", { reasons: elig.reasons });
      const plan = l.context_plan as unknown as ContextPlan;
      const seatRefusals = await agentSeatRefusals(tx, round, task.reviewer_slot!, plan.modelId);
      if (seatRefusals.length > 0)
        throw new ApiFailure("CONFLICT", "this verdict cannot hold a seat of the round (D53)", { reasons: seatRefusals });
      const reviewId = uuidv7();
      try {
        await tx`
          insert into wos.reviews (id, round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning, head_sha,
                                   submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
          values (${reviewId}, ${round.id}, ${task.id}, ${l.id}, ${caller.accountId}, ${caller.githubUserId!}, ${task.reviewer_slot}, ${plan.provider},
                  ${plan.modelId}, ${plan.reasoning}, ${b.headSha}, ${b.submissionSha256}, ${b.verdict.verdict}, ${tx.json(b.verdict as never)},
                  ${run.manifest_id}, ${elig.independence}, ${b.agentRunId})`;
      } catch (err) {
        if ((err as { code?: string }).code === "23514")
          throw new ApiFailure("VALIDATION_FAILED", "the verdict violates reviewer independence or binding");
        throw err;
      }
      await endLease(tx, l, "complete", SYSTEM, "verdict sealed");
      await taskTransition(tx, task, "submit", by(caller));
      await taskTransition(tx, { id: task.id, state: "submitted" }, "accept_output", SYSTEM);
      // The review is a contribution from sealing; it is accepted only when its subject is (REWARD-PROTOCOL.md section 3).
      await createContribution(tx, {
        accountId: caller.accountId,
        githubUserId: caller.githubUserId!,
        category: "review",
        attemptId: round.attempt_id,
        documentId: round.document_id,
        reviewId,
        independence: elig.independence,
        idempotencyKey: `review:${reviewId}:${caller.accountId}`,
      });
      await insertEvent(
        tx,
        { type: "round.verdict_sealed", v: 1, visibility: "private", payload: { roundId: round.id, slot: task.reviewer_slot!, reviewId } },
        { aggregateKind: "round", aggregateId: round.id, actor: "contributor", actorAccountId: caller.accountId },
      );
      if (await roundComplete(tx, round.id)) await revealRound(tx, deps, round.id);
      return { sealed: true as const, reviewId };
    });
  },

  async submitRuling(ctx) {
    const { deps } = ctx;
    const caller = ctx.caller!;
    return inTransaction(deps.sql, SYSTEM_TX, async (tx) => {
      const l = await heldLeaseRow(tx, ctx.params.id, caller.accountId, "LEASE_NOT_HELD");
      const task = (await loadTask(tx, l.task_id))!;
      if (task.kind !== "conflict_resolution" || task.state !== "leased")
        throw new ApiFailure("VALIDATION_FAILED", "this lease is not a conflict resolution");
      for (const r of ctx.body.rulings) {
        const [f] = await tx`
          select 1 as x from wos.findings where id = ${r.findingId} and state in ('open', 'disputed')
             and (document_id = ${task.document_id} or attempt_id = ${task.attempt_id})`;
        if (!f) throw new ApiFailure("VALIDATION_FAILED", `finding ${r.findingId} is not an open finding of this subject`);
      }
      const rulingId = uuidv7();
      await tx`insert into wos.rulings (id, task_id, lease_id, account_id, body, state)
               values (${rulingId}, ${task.id}, ${l.id}, ${caller.accountId}, ${tx.json(ctx.body as never)}, 'awaiting_maintainer')`;
      await createContribution(tx, {
        accountId: caller.accountId,
        githubUserId: caller.githubUserId!,
        category: "architecture_resolution",
        attemptId: task.attempt_id,
        documentId: task.document_id,
        independence: "independent",
        idempotencyKey: `architecture_resolution:${rulingId}:${caller.accountId}`,
      });
      for (const r of ctx.body.rulings) {
        await tx`insert into wos.finding_responses (id, finding_id, account_id, source, action, note)
                 values (${uuidv7()}, ${r.findingId}, ${caller.accountId}, 'resolver', ${r.decision}, ${r.rationale})`;
      }
      await endLease(tx, l, "complete", SYSTEM, "ruling submitted");
      await taskTransition(tx, task, "submit", by(caller));
      await taskTransition(tx, { id: task.id, state: "submitted" }, "accept_output", SYSTEM);
      return { rulingId, awaitingMaintainer: true };
    });
  },

  async getAttempt(ctx) {
    const caller = ctx.caller!;
    // Runs as the caller: RLS keeps sealed findings of an unrevealed round out of this response (S-9, S-11).
    return inTransaction(ctx.deps.sql, asContributor(caller), async (tx) => {
      const attempt = await loadAttempt(tx, ctx.params.id);
      if (!attempt) throw new ApiFailure("NOT_FOUND", "attempt not found");
      const findings = await tx<{ id: string; title: string; detail: string; slot: "astra" | "fable" }[]>`
        select f.id, f.title, f.detail, v.slot from wos.findings f join wos.reviews v on v.id = f.review_id
         where f.attempt_id = ${attempt.id} and f.state in ('open', 'disputed') order by f.id`;
      return { ...attemptView(attempt), reviews: await revealedReviews(tx, { attemptId: attempt.id }), openFindings: findings };
    });
  },
};

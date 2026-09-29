/**
 * Tasks, leases, attempts and resource locks: the shared persistence of LEASE -> ... -> PR
 * (BUILD-PROTOCOL.md, DOMAIN-MODEL.md sections 4.1, 4.2, 4.5, 4.6). Every state change goes through
 * `transition` (guarded UPDATE + one event).
 */
import type { EligibilityInput, EligibilityResult } from "@waronsaas/agent-policy";
import {
  type AbuSpec,
  AbuMachine,
  type AgentRole,
  AttemptMachine,
  type AttemptState,
  BlockerMachine,
  LeaseMachine,
  type ReviewerSlot,
  TaskMachine,
  type TaskKind,
  type TaskState,
} from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import { scopesOverlap } from "@waronsaas/verification";
import type { Deps } from "../deps.js";
import { ApiFailure } from "../errors.js";
import { type EventActor, insertEvent } from "../db/events.js";
import { transition } from "../db/transition.js";
import { uuidv7 } from "../util/crypto.js";
import { type AttemptRow, type LeaseRow, latestAttestations, loadAttempt, loadTask, type TaskRow } from "../views.js";

export const BUILD_KINDS: readonly TaskKind[] = ["abu_build", "abu_revision"];
export const REVIEW_KINDS: readonly TaskKind[] = ["roadmap_review", "feature_review", "implementation_review"];
export const LIVE_ATTEMPT_STATES: readonly AttemptState[] = [
  "leased",
  "building",
  "verifying",
  "submitted",
  "candidate_pushed",
  "in_review",
  "changes_requested",
  "qualified",
  "pr_open",
];

export interface ActorRef {
  actor: EventActor;
  accountId: string | null;
}
export const SYSTEM: ActorRef = { actor: "system", accountId: null };

export function roleForTask(kind: TaskKind, slot: ReviewerSlot | null): AgentRole {
  switch (kind) {
    case "abu_build":
    case "abu_revision":
      return "builder";
    case "roadmap_author":
      return "roadmap_author";
    case "feature_author":
      return "feature_author";
    case "conflict_resolution":
      return "conflict_resolver";
    case "roadmap_review":
      return slot === "astra" ? "roadmap_reviewer_astra" : "roadmap_reviewer_fable";
    case "feature_review":
      return slot === "astra" ? "feature_reviewer_astra" : "feature_reviewer_fable";
    case "implementation_review":
      return slot === "astra" ? "implementation_reviewer_astra" : "implementation_reviewer_fable";
  }
}

export interface NewTask {
  kind: TaskKind;
  state: "open" | "blocked";
  reviewerSlot?: ReviewerSlot | null;
  targetId?: string | null;
  catalogFeatureId?: string | null;
  abuId?: string | null;
  attemptId?: string | null;
  documentId?: string | null;
  roundId?: string | null;
  blockerId?: string | null;
  restrictedToAccountId?: string | null;
  excludedAccountIds?: string[];
  carry?: unknown;
}

/** Inserts a task and its `task.created` event. */
export async function createTask(tx: Tx, t: NewTask, by: ActorRef): Promise<string> {
  const id = uuidv7();
  const role = roleForTask(t.kind, t.reviewerSlot ?? null);
  await tx`
    insert into wos.tasks (id, kind, state, role, reviewer_slot, target_id, catalog_feature_id, abu_id, attempt_id, document_id,
                           round_id, blocker_id, restricted_to_account_id, excluded_account_ids, carry)
    values (${id}, ${t.kind}, ${t.state}, ${role}, ${t.reviewerSlot ?? null}, ${t.targetId ?? null}, ${t.catalogFeatureId ?? null},
            ${t.abuId ?? null}, ${t.attemptId ?? null}, ${t.documentId ?? null}, ${t.roundId ?? null}, ${t.blockerId ?? null},
            ${t.restrictedToAccountId ?? null}, ${(t.excludedAccountIds ?? []) as never}::uuid[],
            ${t.carry === undefined || t.carry === null ? null : tx.json(t.carry as never)})`;
  await insertEvent(
    tx,
    { type: "task.created", v: 1, visibility: "private", payload: { taskId: id, kind: t.kind } },
    { aggregateKind: "task", aggregateId: id, actor: by.actor, actorAccountId: by.accountId },
  );
  return id;
}

export async function taskTransition(
  tx: Tx,
  task: { id: string; state: TaskState },
  event: "claim" | "lease_lost" | "submit" | "accept_output" | "reject_output" | "cancel" | "dependencies_met",
  by: ActorRef,
  set?: Record<string, unknown>,
): Promise<TaskState> {
  const row = await transition(tx, {
    machine: TaskMachine,
    table: "tasks",
    id: task.id,
    from: task.state,
    event,
    actor: by.actor,
    actorAccountId: by.accountId,
    set,
    aggregateKind: "task",
    emit: {
      type: "task.state_changed",
      v: 1,
      visibility: "private",
      payload: {
        taskId: task.id,
        from: task.state,
        to: TaskMachine.transitions.find((x) => x.from === task.state && x.event === event)!.to,
      },
    },
  });
  return row.state as TaskState;
}

/** Ends an active lease (complete/release/expire/revoke) with its `lease.ended` event. */
export async function endLease(
  tx: Tx,
  lease: { id: string; task_id: string },
  event: "complete" | "release" | "expire" | "revoke",
  by: ActorRef,
  reason: string,
): Promise<void> {
  const to = ({ complete: "completed", release: "released", expire: "expired", revoke: "revoked" } as const)[event];
  await transition(tx, {
    machine: LeaseMachine,
    table: "leases",
    id: lease.id,
    from: "active",
    event,
    actor: by.actor,
    actorAccountId: by.accountId,
    set: { ended_at: new Date(), end_reason: reason.slice(0, 500) },
    guard: event === "expire" ? tx`expires_at <= now()` : undefined,
    aggregateKind: "lease",
    emit: { type: "lease.ended", v: 1, visibility: "private", payload: { leaseId: lease.id, taskId: lease.task_id, to } },
  });
}

export async function attemptTransition(
  tx: Tx,
  a: { id: string; state: AttemptState; abu_key: string },
  event: string,
  by: ActorRef,
  set?: Record<string, unknown>,
): Promise<AttemptState> {
  const t = AttemptMachine.transitions.find((x) => x.from === a.state && x.event === event);
  if (!t) throw new ApiFailure("CONFLICT", `attempt is ${a.state}; ${event} is not possible`);
  const row = await transition(tx, {
    machine: AttemptMachine,
    table: "attempts",
    id: a.id,
    from: a.state,
    event: event as never,
    actor: by.actor,
    actorAccountId: by.accountId,
    set,
    aggregateKind: "attempt",
    emit: {
      type: "attempt.state_changed",
      v: 1,
      visibility: "public",
      payload: { attemptId: a.id, abu: a.abu_key, from: a.state, to: t.to },
    },
  });
  return row.state as AttemptState;
}

export async function abuTransition(
  tx: Tx,
  abu: { id: string; key: string; state: string },
  event: "dependencies_merged" | "attempt_started" | "attempt_ended" | "attempt_merged" | "flag_for_decomposition" | "supersede",
  by: ActorRef,
  set?: Record<string, unknown>,
): Promise<void> {
  const t = AbuMachine.transitions.find((x) => x.from === abu.state && x.event === event);
  if (!t) throw new ApiFailure("CONFLICT", `ABU ${abu.key} is ${abu.state}; ${event} is not possible`);
  await transition(tx, {
    machine: AbuMachine,
    table: "abus",
    id: abu.id,
    from: abu.state as never,
    event,
    actor: by.actor,
    actorAccountId: by.accountId,
    set,
    aggregateKind: "abu",
    emit: { type: "abu.state_changed", v: 1, visibility: "public", payload: { abuId: abu.id, abu: abu.key, from: abu.state, to: t.to } },
  });
}

// ---------------------------------------------------------------------------------------------- locks

export interface LockRequest {
  key: string;
  mode: "exclusive" | "shared";
  pathPrefix: string | null;
  pathIsTree: boolean | null;
}

/** One exclusive `path:<prefix>` lock per write scope plus every declared resource (BUILD-PROTOCOL.md section 3 step 5). */
export function requiredLocks(spec: AbuSpec): LockRequest[] {
  const out: LockRequest[] = [];
  for (const w of spec.scope.write) {
    const tree = w.endsWith("/**");
    const prefix = tree ? w.slice(0, -3) : w;
    out.push({ key: `path:${prefix}`, mode: "exclusive", pathPrefix: prefix, pathIsTree: tree });
  }
  for (const r of spec.resources) out.push({ key: r.key, mode: r.mode, pathPrefix: null, pathIsTree: null });
  return out;
}

const scopeOf = (prefix: string, tree: boolean) => (tree ? `${prefix}/**` : prefix);

/** Serialises lock acquisition for one repository (pg_advisory_xact_lock(hashtext('wos.locks:' || repo))). */
export async function lockRepo(tx: Tx, repo: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext(${`wos.locks:${repo}`}))`;
}

/** Refuses with RESOURCE_LOCKED if any live lock conflicts, else inserts the attempt's locks. Caller holds lockRepo. */
export async function acquireLocks(tx: Tx, repo: string, attemptId: string, wanted: LockRequest[]): Promise<void> {
  const live = await tx<
    { resource_key: string; mode: "exclusive" | "shared"; path_prefix: string | null; path_is_tree: boolean | null; abu_key: string }[]
  >`
    select l.resource_key, l.mode, l.path_prefix, l.path_is_tree, ab.key as abu_key
      from wos.resource_locks l join wos.attempts at on at.id = l.attempt_id join wos.abus ab on ab.id = at.abu_id
     where l.repo_full_name = ${repo} and l.released_at is null`;
  const holders = new Set<string>();
  const clashes: string[] = [];
  for (const w of wanted) {
    for (const l of live) {
      let clash = false;
      if (w.pathPrefix !== null && l.path_prefix !== null) {
        clash = scopesOverlap(scopeOf(w.pathPrefix, w.pathIsTree === true), scopeOf(l.path_prefix, l.path_is_tree === true));
      } else if (w.pathPrefix === null && l.path_prefix === null) {
        clash = w.key === l.resource_key && (w.mode === "exclusive" || l.mode === "exclusive");
      }
      if (clash) {
        holders.add(l.abu_key);
        clashes.push(`${w.key} conflicts with ${l.resource_key} held by ${l.abu_key}`);
      }
    }
  }
  if (clashes.length > 0) {
    throw new ApiFailure("RESOURCE_LOCKED", `resources are held by ${[...holders].sort().join(", ")}`, {
      holders: [...holders].sort(),
      clashes,
    });
  }
  for (const w of wanted) {
    await tx`
      insert into wos.resource_locks (id, repo_full_name, attempt_id, resource_key, mode, path_prefix, path_is_tree)
      values (${uuidv7()}, ${repo}, ${attemptId}, ${w.key}, ${w.mode}, ${w.pathPrefix}, ${w.pathIsTree})`;
  }
}

export async function releaseLocks(tx: Tx, attemptId: string): Promise<void> {
  await tx`update wos.resource_locks set released_at = now() where attempt_id = ${attemptId} and released_at is null`;
}

// ---------------------------------------------------------------------------------------------- eligibility

export async function bootstrapMode(tx: Tx): Promise<{ enabled: boolean; since: string | null }> {
  const [row] = await tx<{ value: { enabled?: boolean; since?: string | null } }[]>`
    select value from wos.platform_settings where key = 'bootstrap_mode'`;
  return { enabled: row?.value?.enabled === true, since: row?.value?.since ?? null };
}

export interface EligibilityFacts {
  accountId: string;
  deviceId: string;
  role: AgentRole;
  task: TaskRow | null;
  subjectAuthorIds: string[];
  otherSlotReviewerId: string | null;
  reviewsOfSameAuthorLast7d: number;
  activeLeasesOfKind: number;
}

export async function evaluateEligibility(tx: Tx, deps: Deps, f: EligibilityFacts): Promise<EligibilityResult> {
  const [acc] = await tx<{ github_created_at: Date | null; status: string; is_maintainer: boolean; accepted: number }[]>`
    select a.github_created_at, a.status,
           exists (select 1 from wos.account_roles r where r.account_id = a.id and r.role = 'maintainer') as is_maintainer,
           (select count(*)::int from wos.contributions c where c.account_id = a.id and c.state = 'accepted') as accepted
      from wos.accounts a where a.id = ${f.accountId}`;
  if (!acc?.github_created_at) return { eligible: false, reasons: ["GitHub account not linked"] };
  const attestations = await latestAttestations(tx, f.accountId, f.deviceId);
  const boot = await bootstrapMode(tx);
  let taskOpenHours = 0;
  if (f.task) {
    const [h] = await tx<{ h: number }[]>`select extract(epoch from now() - ${f.task.created_at}::timestamptz)::float8 / 3600 as h`;
    taskOpenHours = h?.h ?? 0;
  }
  const input: EligibilityInput = {
    role: f.role,
    account: {
      id: f.accountId,
      githubAccountCreatedAt: acc.github_created_at.toISOString(),
      acceptedContributions: acc.accepted,
      isMaintainer: acc.is_maintainer,
      suspended: acc.status !== "active",
    },
    attestations,
    subjectAuthorIds: f.subjectAuthorIds,
    otherSlotReviewerId: f.otherSlotReviewerId,
    reviewsOfSameAuthorLast7d: f.reviewsOfSameAuthorLast7d,
    activeLeasesOfKind: f.activeLeasesOfKind,
    bootstrapMode: boot.enabled,
    taskOpenHours,
  };
  const result = deps.logic.checkEligibility(input, deps.policy);
  if (result.eligible && f.task) {
    const reasons: string[] = [];
    if (f.task.excluded_account_ids.includes(f.accountId)) reasons.push("excluded from this task");
    if (f.task.restricted_to_account_id && f.task.restricted_to_account_id !== f.accountId)
      reasons.push("task is restricted to another account");
    if (reasons.length > 0) return { eligible: false, reasons };
  }
  return result;
}

export async function activeLeaseCount(tx: Tx, accountId: string, kinds: readonly TaskKind[]): Promise<number> {
  const [r] = await tx<{ n: number }[]>`
    select count(*)::int as n from wos.leases l join wos.tasks t on t.id = l.task_id
     where l.account_id = ${accountId} and l.state = 'active' and t.kind in ${tx(kinds as string[])}`;
  return r?.n ?? 0;
}

export async function assertDevice(tx: Tx, accountId: string, deviceId: string): Promise<{ id: string; public_key: string }> {
  const [d] = await tx<{ id: string; public_key: string }[]>`
    select id, public_key from wos.devices where id = ${deviceId} and account_id = ${accountId} and revoked_at is null`;
  if (!d) throw new ApiFailure("NOT_ELIGIBLE", "unknown or revoked device", { reasons: ["device not registered to this account"] });
  return d;
}

// ---------------------------------------------------------------------------------------------- leases

export async function insertLease(
  tx: Tx,
  deps: Deps,
  input: { id: string; taskId: string; accountId: string; deviceId: string; role: AgentRole; plan: unknown },
): Promise<LeaseRow> {
  const role = deps.policy.roles.find((r) => r.role === input.role)!;
  const [row] = await tx<LeaseRow[]>`
    insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
    values (${input.id}, ${input.taskId}, ${input.accountId}, ${input.deviceId}, 'active', ${tx.json(input.plan as never)},
            now() + make_interval(mins => ${role.lease.ttlMinutes}), now() + make_interval(mins => ${role.lease.hardDeadlineMinutes}))
    returning *`;
  await insertEvent(
    tx,
    { type: "lease.issued", v: 1, visibility: "private", payload: { leaseId: input.id, taskId: input.taskId, accountId: input.accountId } },
    { aggregateKind: "lease", aggregateId: input.id, actor: "contributor", actorAccountId: input.accountId },
  );
  return row!;
}

export async function loadLease(tx: Tx, id: string): Promise<LeaseRow | null> {
  const [l] = await tx<LeaseRow[]>`select * from wos.leases where id = ${id}`;
  return l ?? null;
}

/** The caller's active, unexpired lease; LEASE_NOT_HELD / LEASE_EXPIRED otherwise. */
export async function heldLease(tx: Tx, leaseId: string, accountId: string): Promise<LeaseRow> {
  const [l] = await tx<(LeaseRow & { live: boolean })[]>`select *, expires_at > now() as live from wos.leases where id = ${leaseId}`;
  if (!l || l.account_id !== accountId) throw new ApiFailure("LEASE_NOT_HELD", "you do not hold this lease");
  if (l.state !== "active" || !l.live)
    throw new ApiFailure("LEASE_EXPIRED", `lease is ${l.state === "active" ? "past its expiry" : l.state}`);
  return l;
}

// ---------------------------------------------------------------------------------------------- attempts

/**
 * Ends an attempt that did not merge (abandon, lease_lapsed, fail, pr_closed, supersede): releases its
 * locks, cancels its live build/revision tasks (revoking their leases) and moves the ABU back to
 * `ready` with a NEW build task, or to `needs_decomposition` at the failure limit. Returns the new state.
 */
export async function endAttempt(
  tx: Tx,
  deps: Deps,
  attempt: AttemptRow,
  event: "abandon" | "lease_lapsed" | "fail" | "pr_closed" | "supersede",
  by: ActorRef,
  reason: string,
): Promise<AttemptState> {
  const to = await attemptTransition(tx, attempt, event, by, { failure_reason: reason.slice(0, 1000) });
  await releaseLocks(tx, attempt.id);
  const live = await tx<{ id: string; state: TaskState; kind: TaskKind }[]>`
    select id, state, kind from wos.tasks
     where ((kind = 'abu_revision' and attempt_id = ${attempt.id}) or (kind = 'abu_build' and abu_id = ${attempt.abu_id}))
       and state in ('blocked', 'open', 'leased', 'submitted')`;
  for (const t of live) {
    if (t.state === "leased") {
      const [l] = await tx<
        { id: string; task_id: string }[]
      >`select id, task_id from wos.leases where task_id = ${t.id} and state = 'active'`;
      if (l) await endLease(tx, l, "revoke", SYSTEM, `attempt ${to}`);
      await taskTransition(tx, t, "cancel", SYSTEM);
    } else if (t.state === "submitted") {
      await taskTransition(tx, t, "accept_output", SYSTEM);
    } else {
      await taskTransition(tx, t, "cancel", SYSTEM);
    }
  }
  if (event === "supersede") return to;
  const [abu] = await tx<{ id: string; key: string; state: string; failed_attempts: number; catalog_feature_id: string }[]>`
    select id, key, state, failed_attempts, catalog_feature_id from wos.abus where id = ${attempt.abu_id}`;
  if (abu && abu.state === "in_progress") {
    const counts = to === "failed" || to === "expired" || to === "closed_unmerged";
    const failed = abu.failed_attempts + (counts ? 1 : 0);
    if (failed >= deps.policy.limits.maxFailedAttemptsPerAbu) {
      await abuTransition(tx, abu, "flag_for_decomposition", SYSTEM, { failed_attempts: failed });
    } else {
      await abuTransition(tx, abu, "attempt_ended", SYSTEM, { failed_attempts: failed });
      await createTask(tx, { kind: "abu_build", state: "open", abuId: abu.id, catalogFeatureId: abu.catalog_feature_id }, SYSTEM);
    }
  }
  return to;
}

/**
 * A lease stopped being active (released, expired or revoked): the task and its subject follow
 * (DOMAIN-MODEL.md 4.1 "Failure paths"). The lease row must already be ended by the caller.
 */
export async function afterLeaseLost(
  tx: Tx,
  deps: Deps,
  lease: { id: string; task_id: string; account_id: string },
  cause: "released" | "expired" | "revoked",
  by: ActorRef,
  reason: string,
): Promise<{ expiredAttempts: number }> {
  const task = await loadTask(tx, lease.task_id);
  if (task?.state !== "leased") return { expiredAttempts: 0 };
  if (task.kind === "abu_build" || task.kind === "abu_revision") {
    const attemptId =
      task.attempt_id ??
      (
        await tx<{ id: string }[]>`
          select id from wos.attempts where abu_id = ${task.abu_id} and account_id = ${lease.account_id}
             and state in ('leased', 'building', 'verifying') order by created_at desc limit 1`
      )[0]?.id;
    const attempt = attemptId ? await loadAttempt(tx, attemptId) : null;
    if (attempt && (attempt.state === "leased" || attempt.state === "building" || attempt.state === "verifying")) {
      const event = cause === "released" ? "abandon" : "lease_lapsed";
      const actor = cause === "released" ? by : SYSTEM;
      await endAttempt(tx, deps, attempt, event, actor, reason);
      return { expiredAttempts: event === "lease_lapsed" ? 1 : 0 };
    }
    await taskTransition(tx, task, "cancel", SYSTEM);
    return { expiredAttempts: 0 };
  }
  const excluded =
    cause === "expired" && REVIEW_KINDS.includes(task.kind) ? [...new Set([...task.excluded_account_ids, lease.account_id])] : null;
  await taskTransition(
    tx,
    task,
    "lease_lost",
    cause === "released" ? by : SYSTEM,
    excluded ? { excluded_account_ids: excluded } : undefined,
  );
  if (task.blocker_id) {
    const [b] = await tx<{ id: string; state: string }[]>`select id, state from wos.blockers where id = ${task.blocker_id}`;
    if (b?.state === "resolving") {
      await transition(tx, {
        machine: BlockerMachine,
        table: "blockers",
        id: b.id,
        from: "resolving",
        event: "resolution_lost",
        actor: "system",
        actorAccountId: null,
        aggregateKind: "blocker",
        emit: { type: "blocker.state_changed", v: 1, visibility: "private", payload: { blockerId: b.id, from: "resolving", to: "open" } },
      });
    }
  }
  return { expiredAttempts: 0 };
}

/** changes_requested: revision window + one abu_revision task restricted to the builder (BUILD-PROTOCOL.md section 10). */
export async function requestChanges(
  tx: Tx,
  deps: Deps,
  attempt: AttemptRow,
  event: "ci_failed" | "round_gaps" | "merge_blocked",
  by: ActorRef,
): Promise<AttemptState> {
  if (attempt.repair_count >= deps.policy.limits.implementationMaxRepairRounds) {
    return endAttempt(
      tx,
      deps,
      attempt,
      "fail",
      SYSTEM,
      `repair limit (${deps.policy.limits.implementationMaxRepairRounds}) reached after ${event}`,
    );
  }
  const [dl] = await tx<{ at: Date }[]>`select now() + make_interval(hours => ${deps.policy.limits.revisionWindowHours}) as at`;
  const to = await attemptTransition(tx, attempt, event, by, { revision_deadline_at: dl!.at });
  const [abu] = await tx<{ catalog_feature_id: string }[]>`select catalog_feature_id from wos.abus where id = ${attempt.abu_id}`;
  await createTask(
    tx,
    {
      kind: "abu_revision",
      state: "open",
      abuId: attempt.abu_id,
      attemptId: attempt.id,
      catalogFeatureId: abu?.catalog_feature_id ?? null,
      restrictedToAccountId: attempt.account_id,
    },
    SYSTEM,
  );
  return to;
}

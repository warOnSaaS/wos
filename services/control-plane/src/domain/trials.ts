/**
 * D69 candidate trials (contracts 5.17.0, migration 0015): a maintainer designates ONE open roadmap_author task for a
 * candidate model of capability-policy.v3 (V1: glm on OpenCode Go). While the trial stands, only that candidate claims
 * the task and the document's later author tasks, and the candidate claims nothing else (rule modelClaimRefusals). The
 * work is validated and reviewed as normal and may merge; its rounds, PR, commits and contributions carry the label
 * `candidate_trial:<candidate>`.
 *
 * The API deploys from main, possibly before migration 0015 runs: every read of a trial object first checks that
 * wos.candidate_trials exists (`trialsAvailable`); without it there are no trials and every candidate claim is refused.
 */
import { candidateTrialLabel, type LaunchDeclaration, type ModelSpec } from "@waronsaas/contracts";
import { CAPABILITY_POLICY_V3, modelClaimRefusals } from "@waronsaas/contracts/protocol";
import type { Tx } from "@waronsaas/db";
import { insertEvent } from "../db/events.js";
import { ApiFailure } from "../errors.js";
import type { ActorRef } from "./work.js";

export const TRIAL_POLICY = CAPABILITY_POLICY_V3;

let available = false;
/** True once migration 0015 is applied (cached only when true: a migration is never rolled back). */
export async function trialsAvailable(tx: Tx): Promise<boolean> {
  if (available) return true;
  const [r] = await tx<{ ok: boolean }[]>`select to_regclass('wos.candidate_trials') is not null as ok`;
  available = r?.ok === true;
  return available;
}

export interface TrialRow {
  id: string;
  task_id: string;
  document_id: string | null;
  candidate: string;
  label: string;
}

/**
 * The trial in force for a task: designated on the task itself, or on its document (a later author task of the same
 * document, i.e. a revision). Null when none, or when migration 0015 is not applied.
 */
export async function activeTrialFor(tx: Tx, task: { id: string; kind: string; document_id: string | null }): Promise<TrialRow | null> {
  if (!(await trialsAvailable(tx))) return null;
  const [t] = await tx<TrialRow[]>`
    select id, task_id, document_id, candidate, label from wos.candidate_trials
     where revoked_at is null
       and (task_id = ${task.id} or (${task.kind} = 'roadmap_author' and document_id is not null and document_id = ${task.document_id}))
     order by assigned_at desc limit 1`;
  return t ?? null;
}

/** Active trials of these tasks, by task id (empty when migration 0015 is not applied). */
export async function activeTrialsOf(
  tx: Tx,
  tasks: ReadonlyArray<{ id: string; kind: string; document_id: string | null }>,
): Promise<Map<string, TrialRow>> {
  const out = new Map<string, TrialRow>();
  if (tasks.length === 0 || !(await trialsAvailable(tx))) return out;
  const rows = await tx<TrialRow[]>`
    select id, task_id, document_id, candidate, label from wos.candidate_trials where revoked_at is null
       and (task_id in ${tx(tasks.map((t) => t.id))}
            or document_id in ${tx(tasks.map((t) => t.document_id ?? "00000000-0000-0000-0000-000000000000"))})`;
  for (const t of tasks) {
    const hit = rows.find(
      (r) => r.task_id === t.id || (t.kind === "roadmap_author" && t.document_id !== null && r.document_id === t.document_id),
    );
    if (hit) out.set(t.id, hit);
  }
  return out;
}

/** The active trial label of a document, or null (tolerates a database without migration 0015). */
export async function documentTrialLabel(tx: Tx, documentId: string | null): Promise<TrialRow | null> {
  if (!documentId || !(await trialsAvailable(tx))) return null;
  const [t] = await tx<TrialRow[]>`
    select id, task_id, document_id, candidate, label from wos.candidate_trials where document_id = ${documentId}
     order by (revoked_at is null) desc, assigned_at desc limit 1`;
  return t ?? null;
}

/** The candidate entry whose model id pattern matches, if any (capability-policy.v3). */
export function candidateFor(modelId: string) {
  const glob = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return TRIAL_POLICY.candidates.find((c) => glob(c.modelIdPattern).test(modelId)) ?? null;
}

/**
 * D52 + D69 at claim time (rule `modelClaimRefusals`): a candidate model is refused everywhere except a task designated
 * for it; a designated task refuses every other model; a candidate claim declares its launch provider. Models that are
 * not candidates, on tasks without a trial, keep the V1 rules (empty result).
 */
export function candidateClaimRefusals(
  model: Pick<ModelSpec, "provider" | "modelId">,
  task: { kind: string; role: string },
  trial: TrialRow | null,
  launch: LaunchDeclaration | null,
): string[] {
  const cand = candidateFor(model.modelId);
  if (!cand && !trial) return [];
  const r = modelClaimRefusals(
    TRIAL_POLICY,
    { provider: cand?.provider ?? model.provider, modelId: model.modelId, requiredClass: "PLAN_L1", role: task.role },
    trial ? { candidate: trial.candidate, taskKind: task.kind } : null,
  );
  if (r.length === 0 && cand) {
    const providers = [cand.provider, ...(cand.alternativeProviders ?? [])];
    if (!launch || !(providers as readonly string[]).includes(launch.provider))
      r.push(`${cand.key} claims must declare how they reach it: launch.provider one of ${providers.join(", ")} (D52, self-reported)`);
  }
  return r;
}

/** AdminAction assign_candidate_trial (public, forward-only). */
export async function assignCandidateTrial(
  tx: Tx,
  input: { taskId: string; candidate: string; reason: string },
  by: ActorRef & { accountId: string },
): Promise<void> {
  if (!(await trialsAvailable(tx)))
    throw new ApiFailure("CONFLICT", "candidate trials need production migration 0015_candidate_trials.sql (not applied yet)");
  const cand = TRIAL_POLICY.candidates.find((c) => c.key === input.candidate);
  if (!cand?.trials)
    throw new ApiFailure("VALIDATION_FAILED", `${input.candidate} is not a candidate with trials in ${TRIAL_POLICY.policyVersion}`);
  const [task] = await tx<{ id: string; kind: string; state: string; document_id: string | null }[]>`
    select id, kind, state, document_id from wos.tasks where id = ${input.taskId}`;
  if (!task) throw new ApiFailure("NOT_FOUND", "task not found");
  if (!(cand.trials.taskKinds as readonly string[]).includes(task.kind))
    throw new ApiFailure("VALIDATION_FAILED", `${cand.key} trials cover ${cand.trials.taskKinds.join(", ")}, not ${task.kind}`);
  if (task.state !== "open") throw new ApiFailure("CONFLICT", `task is ${task.state}: a trial designates an open task`);
  if (await activeTrialFor(tx, task)) throw new ApiFailure("CONFLICT", "this task (or its document) already has a candidate trial");
  const label = candidateTrialLabel(cand.key);
  await tx`insert into wos.candidate_trials (task_id, candidate, label, capability_policy_version, reason, assigned_by)
           values (${task.id}, ${cand.key}, ${label}, ${TRIAL_POLICY.policyVersion}, ${input.reason}, ${by.accountId})`;
  await insertEvent(
    tx,
    {
      type: "task.candidate_trial_assigned",
      v: 1,
      visibility: "public",
      payload: { taskId: task.id, documentId: task.document_id, candidate: cand.key, label, reason: input.reason },
    },
    { aggregateKind: "task", aggregateId: task.id, actor: by.actor, actorAccountId: by.accountId },
  );
}

/** AdminAction revoke_candidate_trial (public): later claims follow the normal rules (e.g. Opus). */
export async function revokeCandidateTrial(
  tx: Tx,
  input: { taskId: string; reason: string },
  by: ActorRef & { accountId: string },
): Promise<void> {
  if (!(await trialsAvailable(tx))) throw new ApiFailure("NOT_FOUND", "no candidate trial (migration 0015 is not applied)");
  const [task] = await tx<
    { id: string; kind: string; document_id: string | null }[]
  >`select id, kind, document_id from wos.tasks where id = ${input.taskId}`;
  if (!task) throw new ApiFailure("NOT_FOUND", "task not found");
  const trial = await activeTrialFor(tx, task);
  if (!trial) throw new ApiFailure("NOT_FOUND", "this task has no candidate trial in force");
  await tx`update wos.candidate_trials set revoked_at = now(), revoked_by = ${by.accountId}, revoked_reason = ${input.reason}
            where id = ${trial.id} and revoked_at is null`;
  await insertEvent(
    tx,
    {
      type: "task.candidate_trial_revoked",
      v: 1,
      visibility: "public",
      payload: { taskId: trial.task_id, documentId: trial.document_id, candidate: trial.candidate, reason: input.reason },
    },
    { aggregateKind: "task", aggregateId: trial.task_id, actor: by.actor, actorAccountId: by.accountId },
  );
}

/** Records a claim under a trial, with the launch as declared (public event). */
export async function recordTrialClaim(
  tx: Tx,
  trial: TrialRow,
  input: { leaseId: string; taskId: string; accountId: string; modelId: string; launch: LaunchDeclaration | null },
): Promise<void> {
  const provider = input.launch?.provider ?? "anthropic";
  await tx`insert into wos.candidate_trial_claims (lease_id, trial_id, task_id, account_id, model_id, provider_declared, base_url_declared)
           values (${input.leaseId}, ${trial.id}, ${input.taskId}, ${input.accountId}, ${input.modelId}, ${provider}, ${input.launch?.baseUrl ?? null})`;
  await insertEvent(
    tx,
    {
      type: "lease.candidate_trial_claimed",
      v: 1,
      visibility: "public",
      payload: {
        taskId: input.taskId,
        leaseId: input.leaseId,
        candidate: trial.candidate,
        modelId: input.modelId,
        provider,
        baseUrl: input.launch?.baseUrl ?? null,
        identity: "self_reported",
      },
    },
    { aggregateKind: "task", aggregateId: input.taskId, actor: "contributor", actorAccountId: input.accountId },
  );
}

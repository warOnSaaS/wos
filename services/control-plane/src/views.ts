/** Row -> API read-model mappers and the queries behind them. Nothing here exposes sealed verdicts or secrets. */
import type { AgentPolicyDocument, AgentRole, AttemptView, LeaseView, Me, ProviderAttestation, TaskView } from "@waronsaas/contracts";
import { ModelRef } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";

export const iso = (d: Date | string | null | undefined): string | null => (d == null ? null : new Date(d).toISOString());
export const isoReq = (d: Date | string): string => new Date(d).toISOString();
export const num = (v: string | number | bigint | null | undefined): number => (v == null ? 0 : Number(v));

/** Apps an ABU is relevant to: targets whose profile includes one of its requirements (D10). */
export const ABU_RELEVANCE = (abuIdSql: string) => `coalesce((
  select array_agg(distinct rt.slug order by rt.slug) from wos.abu_requirements ar
    join wos.requirement_profiles rp on rp.requirement_id = ar.requirement_id
    join wos.targets rt on rt.id = rp.target_id
   where ar.abu_id = ${abuIdSql}), '{}')`;

/** Apps that reference a catalog feature (non-descoped app features), by rank. */
export const FEATURE_APPS = (featureIdSql: string) => `coalesce((
  select array_agg(ft.slug order by ft.rank) from wos.app_features af join wos.targets ft on ft.id = af.target_id
   where af.catalog_feature_id = ${featureIdSql} and af.state <> 'descoped'), '{}')`;

export interface TaskRow {
  id: string;
  kind: TaskView["kind"];
  state: TaskView["state"];
  role: TaskView["role"];
  reviewer_slot: "astra" | "fable" | null;
  target_id: string | null;
  catalog_feature_id: string | null;
  abu_id: string | null;
  attempt_id: string | null;
  document_id: string | null;
  round_id: string | null;
  blocker_id: string | null;
  restricted_to_account_id: string | null;
  excluded_account_ids: string[];
  carry: unknown;
  created_at: Date;
  row_version: number;
  /** Set only for roadmap work (contracts 3.0.0 work subject model). */
  target_slug: string | null;
  feature_key: string | null;
  abu_key: string | null;
  feature_id: string | null;
  resolved_abu_id: string | null;
  relevant_to: string[];
  repo: string;
}

/** `select` list + joins that resolve a task's target, feature and ABU keys. Append `where ...` on alias t. */
/**
 * `select` list + joins resolving a task's subject: roadmap work has one target; contract, build, review and
 * ABU-blocker work has one catalog feature and serves `relevant_to`. Append `where ...` on alias t.
 */
export const TASK_SELECT = `
    select t.*, cf.key as feature_key, cf.id as feature_id, ab.key as abu_key, ab.id as resolved_abu_id,
           case when cf.id is null then coalesce(tg.slug, dtg.slug, blt.slug) end as target_slug,
           coalesce(ab.repo_full_name, cf.repo_full_name, d.repo_full_name, tg.repo_full_name, blt.repo_full_name) as repo,
           case when cf.id is null then array[coalesce(tg.slug, dtg.slug, blt.slug)]
                when ab.id is not null then ${ABU_RELEVANCE("ab.id")}
                else ${FEATURE_APPS("cf.id")} end as relevant_to
      from wos.tasks t
      left join wos.targets tg on tg.id = t.target_id
      left join wos.documents d on d.id = t.document_id
      left join wos.targets dtg on dtg.id = d.target_id
      left join wos.blockers bl on bl.id = t.blocker_id
      left join wos.targets blt on blt.id = bl.target_id
      left join wos.attempts at on at.id = t.attempt_id
      left join wos.abus ab on ab.id = coalesce(t.abu_id, at.abu_id, bl.abu_id)
      left join wos.catalog_features cf on cf.id = coalesce(t.catalog_feature_id, ab.catalog_feature_id, d.catalog_feature_id)`;

export async function queryTasks(tx: Tx, where: string, params: unknown[]): Promise<TaskRow[]> {
  return tx.unsafe<TaskRow[]>(`${TASK_SELECT} ${where}`, params as never[]);
}

export async function loadTask(tx: Tx, id: string): Promise<TaskRow | null> {
  const r = await queryTasks(tx, "where t.id = $1", [id]);
  return r[0] ?? null;
}

export function taskView(r: TaskRow): TaskView {
  return {
    id: r.id,
    kind: r.kind,
    state: r.state,
    role: r.role,
    reviewerSlot: r.reviewer_slot,
    target: r.target_slug,
    feature: r.feature_key,
    relevantTo: r.relevant_to,
    repo: r.repo,
    abu: r.abu_key,
    attemptId: r.attempt_id,
    documentId: r.document_id,
    roundId: r.round_id,
    createdAt: isoReq(r.created_at),
  };
}

export interface LeaseRow {
  id: string;
  task_id: string;
  account_id: string;
  device_id: string;
  state: LeaseView["state"];
  context_plan: { role?: AgentRole } & Record<string, unknown>;
  issued_at: Date;
  expires_at: Date;
  hard_deadline_at: Date;
  row_version: number;
}

export function leaseView(r: LeaseRow, policy: AgentPolicyDocument): LeaseView {
  const role = policy.roles.find((x) => x.role === r.context_plan.role);
  return {
    id: r.id,
    taskId: r.task_id,
    state: r.state,
    issuedAt: isoReq(r.issued_at),
    expiresAt: isoReq(r.expires_at),
    hardDeadlineAt: isoReq(r.hard_deadline_at),
    heartbeatSeconds: role?.lease.heartbeatSeconds ?? 60,
  };
}

export interface AttemptRow {
  id: string;
  abu_id: string;
  account_id: string;
  github_user_id: string;
  state: AttemptView["state"];
  base_sha: string;
  candidate_branch: string | null;
  head_sha: string | null;
  repair_count: number;
  local_repair_count: number;
  revision_deadline_at: Date | null;
  pr_number: number | null;
  pr_url: string | null;
  merged_sha: string | null;
  failure_reason: string | null;
  updated_at: Date;
  row_version: number;
  abu_key: string;
  abu_state: string;
  abu_row_version: number;
  feature_id: string;
  feature_key: string;
  relevant_to: string[];
  repo: string;
  builder_handle: string;
  /** D15: provider and model of the run that produced the latest submission. */
  built_with: { provider: "claude_cli" | "codex_cli"; model: "fable" | "opus" | "astra" | "sol"; modelId: string } | null;
}

export async function loadAttempt(tx: Tx, id: string): Promise<AttemptRow | null> {
  const rows = await tx.unsafe<AttemptRow[]>(
    `select at.*, ab.key as abu_key, ab.state as abu_state, ab.row_version as abu_row_version, cf.id as feature_id, cf.key as feature_key,
            ${ABU_RELEVANCE("ab.id")} as relevant_to, ab.repo_full_name as repo, ac.handle as builder_handle,
            (select jsonb_build_object('provider', m.manifest->>'provider', 'model', m.manifest->'model'->>'ref', 'modelId', m.model_id)
               from wos.changesets c join wos.tasks t on t.id = c.task_id
               join wos.context_manifests m on m.lease_id = c.lease_id and m.manifest_sha256 = c.manifest_sha256
              where c.ok and (t.attempt_id = at.id or (t.kind = 'abu_build' and t.abu_id = at.abu_id and c.account_id = at.account_id))
              order by c.created_at desc limit 1) as built_with
       from wos.attempts at
       join wos.abus ab on ab.id = at.abu_id
       join wos.catalog_features cf on cf.id = ab.catalog_feature_id
       join wos.accounts ac on ac.id = at.account_id
      where at.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export function attemptView(r: AttemptRow): AttemptView {
  return {
    id: r.id,
    abu: r.abu_key,
    feature: r.feature_key,
    relevantTo: r.relevant_to,
    repo: r.repo,
    builtWith: r.built_with,
    state: r.state,
    builderHandle: r.builder_handle,
    baseSha: r.base_sha,
    candidateBranch: r.candidate_branch,
    headSha: r.head_sha,
    repairCount: r.repair_count,
    pr: r.pr_number !== null && r.pr_url ? { number: r.pr_number, url: r.pr_url } : null,
    failureReason: r.failure_reason,
    updatedAt: isoReq(r.updated_at),
  };
}

/** Latest attestation per provider for an account (optionally one device). */
export async function latestAttestations(tx: Tx, accountId: string, deviceId: string | null): Promise<ProviderAttestation[]> {
  const rows = await tx<
    {
      provider: ProviderAttestation["provider"];
      installed: boolean;
      cli_version: string | null;
      signed_in: boolean;
      auth_method: string | null;
      models: string[];
      checked_at: Date;
    }[]
  >`
    select distinct on (provider) provider, installed, cli_version, signed_in, auth_method, models, checked_at
      from wos.provider_attestations
     where account_id = ${accountId} ${deviceId ? tx`and device_id = ${deviceId}` : tx``}
     order by provider, created_at desc`;
  return rows.map((r) => ({
    provider: r.provider,
    installed: r.installed,
    cliVersion: r.cli_version,
    signedIn: r.signed_in,
    authMethod: r.auth_method,
    // Every policy model ref (contracts 5.17.0: glm too; sol was missing from the earlier literal list).
    models: r.models.filter((m): m is ProviderAttestation["models"][number] => ModelRef.safeParse(m).success),
    checkedAt: isoReq(r.checked_at),
  }));
}

/** The signed-in account. Must run as that account (account_emails is own-row only). */
export async function loadMe(tx: Tx, accountId: string): Promise<Me> {
  const [a] = await tx<
    {
      id: string;
      handle: string | null;
      display_name: string | null;
      github_user_id: string | null;
      github_login: string | null;
      github_created_at: Date | null;
      github_linked_at: Date | null;
      leaderboard_opt_in: boolean;
      progress_emails: boolean;
      status: "active" | "suspended";
      email: string;
      is_maintainer: boolean;
      held: string;
      available: string;
      score: string;
    }[]
  >`
    select a.id, a.handle, a.display_name, a.github_user_id, a.github_login, a.github_created_at, a.github_linked_at,
           a.leaderboard_opt_in, a.progress_emails, a.status, e.email,
           exists (select 1 from wos.account_roles r where r.account_id = a.id and r.role = 'maintainer') as is_maintainer,
           b.held, b.available, b.score
      from wos.accounts a
      join wos.account_emails e on e.account_id = a.id
      join wos.v_balances b on b.account_id = a.id
     where a.id = ${accountId}`;
  if (!a) throw new Error(`account ${accountId} not visible to itself`);
  const follows = await tx<{ slug: string }[]>`
    select t.slug from wos.follows f join wos.targets t on t.id = f.target_id where f.account_id = ${accountId} order by t.rank`;
  const linked = a.github_user_id !== null;
  return {
    id: a.id,
    email: a.email,
    handle: a.handle,
    github: linked
      ? {
          userId: Number(a.github_user_id),
          login: a.github_login!,
          accountCreatedAt: isoReq(a.github_created_at!),
          linkedAt: isoReq(a.github_linked_at!),
        }
      : null,
    canContribute: linked && a.status === "active",
    displayName: a.display_name,
    roles: a.is_maintainer ? ["maintainer"] : [],
    leaderboardOptIn: a.leaderboard_opt_in,
    status: a.status,
    followedTargets: follows.map((f) => f.slug),
    progressEmails: a.progress_emails,
    attestations: await latestAttestations(tx, accountId, null),
    balance: { held: num(a.held), available: num(a.available), score: num(a.score) },
  };
}

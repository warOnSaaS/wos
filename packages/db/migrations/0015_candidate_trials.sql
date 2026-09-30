-- 0015_candidate_trials.sql — contracts 5.17.0 (D69 candidate trials). Owner: Lead Architect.
-- PRODUCTION MIGRATION: the coordinator applies it through the runner (list with --check first). The API deploys from
-- main, possibly before this runs: the control plane built from the same commit checks for wos.candidate_trials
-- (to_regclass) before it reads or writes the objects below, and reads the new round column through to_jsonb. Without
-- this migration no trial can be assigned and every candidate claim stays refused (D52).
--
--   1. wos.candidate_trials: a maintainer designates ONE open roadmap_author task for a candidate model (V1: glm). Public,
--      forward-only (rows are never deleted; only a revocation is added, once). The designation covers that task and the
--      later author tasks of the same document until revoked.
--   2. wos.candidate_trial_claims: every claim under a trial, with the launch AS DECLARED (D52: identity self_reported).
--   3. Labels `candidate_trial:<candidate>`: pinned on every round of the trial's document when it opens, and on every
--      contribution of a document that had a trial (alongside single_lab_review / bootstrap_self).
--   4. The opencode CLI (provider opencode_cli, agent-policy.v2) may be attested. Until this runs the control plane does
--      not store opencode attestations, so opencode models stay unattested (and unclaimable).
-- Touches none of the objects of the draft protocol migrations 0007 and 0010; commutes with them.

-- --------------------------------------------------------------------------------------------
-- 1. Trials
-- --------------------------------------------------------------------------------------------
create table wos.candidate_trials (
  id                         uuid primary key default gen_random_uuid(),
  task_id                    uuid not null references wos.tasks (id),
  document_id                uuid references wos.documents (id),
  candidate                  text not null check (candidate ~ '^[a-z][a-z0-9-]{0,30}$'),
  label                      text not null,
  capability_policy_version  text not null check (capability_policy_version ~ '^capability-policy\.v[0-9]+$'),
  reason                     text not null check (length(reason) >= 5),
  assigned_by                uuid not null references wos.accounts (id),
  assigned_at                timestamptz not null default now(),
  revoked_at                 timestamptz,
  revoked_by                 uuid references wos.accounts (id),
  revoked_reason             text,
  check (label = 'candidate_trial:' || candidate),
  check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoked_reason is null))
);
create unique index candidate_trials_one_active_task on wos.candidate_trials (task_id) where revoked_at is null;
create unique index candidate_trials_one_active_document on wos.candidate_trials (document_id)
  where revoked_at is null and document_id is not null;

create or replace function wos.check_candidate_trial() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  t wos.tasks%rowtype;
begin
  if not exists (select 1 from wos.account_roles ar
                  where ar.account_id = (case when tg_op = 'INSERT' then new.assigned_by else new.revoked_by end) and ar.role = 'maintainer') then
    raise exception 'wos: only a maintainer assigns or revokes a candidate trial' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    select * into t from wos.tasks where id = new.task_id for update;
    if t.id is null or t.kind <> 'roadmap_author' or t.state <> 'open' then
      raise exception 'wos: a candidate trial designates one OPEN roadmap_author task (task % is %/%)', new.task_id, t.kind, t.state
        using errcode = 'check_violation';
    end if;
    new.document_id := t.document_id;
    new.revoked_at := null;
    new.revoked_by := null;
    new.revoked_reason := null;
    new.assigned_at := clock_timestamp();
    return new;
  end if;
  -- Forward-only: an update only revokes, once, and changes nothing else.
  if old.revoked_at is not null or new.revoked_at is null
     or row(new.id, new.task_id, new.document_id, new.candidate, new.label, new.capability_policy_version, new.reason, new.assigned_by,
            new.assigned_at)
        is distinct from row(old.id, old.task_id, old.document_id, old.candidate, old.label, old.capability_policy_version, old.reason,
            old.assigned_by, old.assigned_at) then
    raise exception 'wos: a candidate trial is only revoked, once' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger candidate_trials_check before insert or update on wos.candidate_trials
  for each row execute function wos.check_candidate_trial();
create trigger candidate_trials_no_delete before delete on wos.candidate_trials
  for each row execute function wos.forbid_mutation();
create trigger candidate_trials_no_truncate before truncate on wos.candidate_trials
  for each statement execute function wos.forbid_mutation();

-- --------------------------------------------------------------------------------------------
-- 2. Claims under a trial, with the launch as declared
-- --------------------------------------------------------------------------------------------
create table wos.candidate_trial_claims (
  lease_id           uuid primary key references wos.leases (id),
  trial_id           uuid not null references wos.candidate_trials (id),
  task_id            uuid not null references wos.tasks (id),
  account_id         uuid not null references wos.accounts (id),
  model_id           text not null,
  provider_declared  text not null check (provider_declared in ('anthropic', 'openai', 'zai', 'opencode-go')),
  base_url_declared  text,
  identity           text not null default 'self_reported' check (identity = 'self_reported'),
  claimed_at         timestamptz not null default now()
);
create trigger candidate_trial_claims_append_only before update or delete on wos.candidate_trial_claims
  for each row execute function wos.forbid_mutation();
create trigger candidate_trial_claims_no_truncate before truncate on wos.candidate_trial_claims
  for each statement execute function wos.forbid_mutation();

-- --------------------------------------------------------------------------------------------
-- 3. Labels
-- --------------------------------------------------------------------------------------------
alter table wos.rounds add column trial_label text check (trial_label is null or trial_label ~ '^candidate_trial:[a-z][a-z0-9-]{0,30}$');
alter table wos.contributions add column trial_label text check (trial_label is null or trial_label ~ '^candidate_trial:[a-z][a-z0-9-]{0,30}$');

-- A round's trial label is derived when it opens (the document's active trial) and never changes, like its seats (0013).
create or replace function wos.pin_round_trial_label() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.trial_label := (select c.label from wos.candidate_trials c
                         where new.document_id is not null and c.document_id = new.document_id and c.revoked_at is null);
    return new;
  end if;
  if new.trial_label is distinct from old.trial_label then
    raise exception 'wos: a round''s candidate trial label is fixed when it opens' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger rounds_trial_label before insert or update on wos.rounds
  for each row execute function wos.pin_round_trial_label();

-- A contribution of a document that had a candidate trial (active or revoked) carries its label.
create or replace function wos.label_trial_contribution() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.trial_label := (select c.label from wos.candidate_trials c
                         where new.document_id is not null and c.document_id = new.document_id order by c.assigned_at desc limit 1);
    return new;
  end if;
  if new.trial_label is distinct from old.trial_label then
    raise exception 'wos: a contribution''s candidate trial label is fixed when it is created' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger contributions_trial_label before insert or update on wos.contributions
  for each row execute function wos.label_trial_contribution();

-- --------------------------------------------------------------------------------------------
-- 4. The opencode provider
-- --------------------------------------------------------------------------------------------
alter table wos.provider_attestations drop constraint provider_attestations_provider_check;
alter table wos.provider_attestations add constraint provider_attestations_provider_check
  check (provider in ('claude_cli', 'codex_cli', 'opencode_cli'));

-- --------------------------------------------------------------------------------------------
-- Grants and row-level security
-- --------------------------------------------------------------------------------------------
grant select, insert, update on wos.candidate_trials to wos_app;
grant select, insert on wos.candidate_trial_claims to wos_app;
alter table wos.candidate_trials enable row level security;
alter table wos.candidate_trial_claims enable row level security;
-- Trials and their claims are public (D69): which task, which candidate, why, and the launch as declared.
create policy public_read on wos.candidate_trials for select to wos_app using (true);
create policy privileged_insert on wos.candidate_trials for insert to wos_app with check (wos.is_privileged());
create policy privileged_update on wos.candidate_trials for update to wos_app using (wos.is_privileged()) with check (wos.is_privileged());
create policy public_read on wos.candidate_trial_claims for select to wos_app using (true);
create policy privileged_insert on wos.candidate_trial_claims for insert to wos_app with check (wos.is_privileged());

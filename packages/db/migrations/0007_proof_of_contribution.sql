-- 0007_proof_of_contribution.sql — DRAFT v2 (after Astra review 02), pending Astra review 03. Owner: Lead Architect.
-- DO NOT APPLY TO PRODUCTION. It applies cleanly on 0006 and is exercised by db:test so the design is executable.
--
-- Proof of Contribution (Amendment 02, D18–D48). Evidence tables are append-only for every role (the ledger's rule);
-- state is the latest append-only event. v2 closes Astra-02: transitions validated with IS TRUE (H6), server-stamped
-- times (H6), qualification evidence required for receipts (H7), no pre-ratified quorums (H7), independence against a
-- privileged relationship view in both insertion orders (H8), a privileged wallet registry and beneficiary identities
-- (H9), atomic dispute bundles with per-item stakes and derived settlements (H10), private canary classification (H11),
-- action-bound two-person authorization (H12), pool kinds and one terminal disposition (H13), duty as events (M14),
-- expiring run-log bodies (M17), proposed allocations separated from final entitlements and claim leaves (H2),
-- persisted signed transactions with one active attempt per leaf (H3), holdback (D40), confiscation (D39).

-- ============================================================================================
-- 0. Helpers
-- ============================================================================================
create or replace function wos.protocol_append_only(t text) returns void
language plpgsql as $$
begin
  execute format('create trigger %I before update or delete on wos.%I for each row execute function wos.forbid_mutation()', t || '_append_only', t);
  execute format('create trigger %I before truncate on wos.%I for each statement execute function wos.forbid_mutation()', t || '_no_truncate', t);
end $$;

create or replace function wos.is_maintainer(a uuid) returns boolean
language sql stable security definer set search_path = wos, pg_temp as $$
  select exists (select 1 from wos.account_roles r where r.account_id = a and r.role = 'maintainer')
$$;

create or replace function wos.bootstrap_on() returns boolean
language sql stable as $$
  select coalesce((select (value ->> 'enabled')::boolean from wos.platform_settings where key = 'bootstrap_mode'), false)
$$;

-- ============================================================================================
-- 1. Admin actions: immutable, hash-chained; two-person rule derived from the action kind (H12)
-- ============================================================================================
create table wos.admin_actions (
  id                     uuid primary key default gen_random_uuid(),
  entry_no               bigint not null unique,
  actor_account_id       uuid not null references wos.accounts (id),
  action                 text not null check (action in (
    'authorize_reviewer', 'revoke_reviewer', 'suspend_reward_eligibility', 'restore_reward_eligibility',
    'suspend_reviewer_privileges', 'restore_reviewer_privileges', 'suspend_account', 'restore_account',
    'invalidate_receipt', 'restore_receipt', 'hold_receipt', 'clear_risk_flag', 'uphold_risk_flag', 'record_offset',
    'activate_policy', 'activate_oracle', 'set_model_eligibility', 'epoch_transition', 'record_genesis',
    'approve_genesis_reference', 'award_security', 'bootstrap_merge', 'ratify_receipt', 'reject_ratification',
    'resolve_dispute', 'decide_appeal', 'clip_receipt', 'correct_accrual', 'end_bootstrap', 'start_test_epochs',
    'end_test_epochs', 'pause_settlement', 'resume_settlement', 'switch_adapter', 'void_leaf', 'confiscate',
    'decide_confiscation_appeal', 'exclude', 'write_off', 'bind_org_wallet')),
  target_kind            text not null,
  target_id              text not null,
  reason                 text not null check (length(btrim(reason)) >= 20),
  payload                jsonb not null default '{}',          -- the exact mutation this action authorizes
  previous_state         jsonb not null,
  resulting_state        jsonb not null,
  requires_co_signer     boolean not null default false,       -- derived by the trigger, never trusted from the caller
  co_signer_account_id   uuid references wos.accounts (id),
  prev_hash              bytea not null default '\x00',
  entry_hash             bytea not null default '\x00',
  created_at             timestamptz not null default now()
);

-- H12: which actions need two people is a property of the action, not a caller label (mirrors RiskPolicy
-- twoPersonActions; change both together).
create or replace function wos.two_person_action(a text) returns boolean
language sql immutable as $$
  select a in ('invalidate_receipt', 'suspend_account', 'record_offset', 'activate_policy', 'activate_oracle',
               'record_genesis', 'approve_genesis_reference', 'confiscate', 'exclude', 'clip_receipt',
               'switch_adapter', 'write_off', 'decide_confiscation_appeal')
$$;

create or replace function wos.admin_actions_chain() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  last_no bigint;
  last_hash bytea;
begin
  if not wos.is_maintainer(new.actor_account_id) then
    raise exception 'wos: admin action by a non-maintainer' using errcode = 'insufficient_privilege';
  end if;
  new.requires_co_signer := wos.two_person_action(new.action);
  if new.requires_co_signer and (new.co_signer_account_id is null or new.co_signer_account_id = new.actor_account_id) then
    raise exception 'wos: % needs a second maintainer as co-signer', new.action using errcode = 'check_violation';
  end if;
  if new.co_signer_account_id is not null and not wos.is_maintainer(new.co_signer_account_id) then
    raise exception 'wos: co-signer is not a maintainer' using errcode = 'insufficient_privilege';
  end if;
  if new.action = 'bootstrap_merge' and not wos.bootstrap_on() then
    raise exception 'wos: bootstrap_merge outside bootstrap mode' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(7313372);
  select entry_no, entry_hash into last_no, last_hash from wos.admin_actions order by entry_no desc limit 1;
  new.entry_no := coalesce(last_no, 0) + 1;
  new.prev_hash := coalesce(last_hash, '\x00'::bytea);
  new.created_at := date_trunc('milliseconds', clock_timestamp());
  new.entry_hash := sha256(new.prev_hash || convert_to(concat_ws('|',
      new.entry_no, new.id, new.actor_account_id, new.action, new.target_kind, new.target_id, new.reason,
      new.payload::text, new.previous_state::text, new.resulting_state::text, new.requires_co_signer,
      coalesce(new.co_signer_account_id::text, ''),
      to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ), 'UTF8'));
  return new;
end $$;
create trigger admin_actions_chain before insert on wos.admin_actions for each row execute function wos.admin_actions_chain();

-- A consuming mutation must name an action of an allowed kind whose target is exactly this row (H12).
create or replace function wos.require_admin_action(aid uuid, kinds text[], tkind text, tid text) returns void
language plpgsql stable security definer set search_path = wos, pg_temp as $$
begin
  if aid is null or not exists (select 1 from wos.admin_actions a
      where a.id = aid and a.action = any(kinds) and a.target_kind = tkind and a.target_id = tid) then
    raise exception 'wos: admin action % does not authorize % on %/%', aid, kinds, tkind, tid using errcode = 'insufficient_privilege';
  end if;
end $$;

-- ============================================================================================
-- 2. Policy documents and forward-only activations (D33; H6 repro F)
-- ============================================================================================
create table wos.policy_documents (
  kind        text not null check (kind in ('reward', 'oracle', 'review', 'capability', 'usage_proof', 'risk', 'merge', 'completion', 'genesis', 'governance')),
  version     text not null,
  body        jsonb not null,
  sha256      text not null check (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  primary key (kind, version)
);

create table wos.policy_activations (
  kind             text not null,
  version          text not null,
  effective_epoch  integer not null check (effective_epoch > 0),
  announced_at     timestamptz not null default now(),      -- server-stamped; a backdated value is overwritten
  emergency        boolean not null default false,
  preview_sha256   text check (preview_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now(),
  primary key (kind, effective_epoch),
  foreign key (kind, version) references wos.policy_documents (kind, version),
  check (emergency or preview_sha256 is not null)
);

create or replace function wos.check_policy_activation() returns trigger
language plpgsql as $$
declare
  last_epoch integer;
  target_start timestamptz;
  target_state text;
begin
  new.announced_at := clock_timestamp();
  perform wos.require_admin_action(new.admin_action_id, array['activate_policy', 'activate_oracle'], 'policy', new.kind || ':' || new.version);
  select max(epoch_number) into last_epoch from wos.epochs;
  select starts_at into target_start from wos.epochs where epoch_number = new.effective_epoch;
  target_state := wos.epoch_state(new.effective_epoch);
  if not new.emergency then
    -- Forward-only: the target is not yet published, is OPEN or undefined, and starts at least 72 h after NOW.
    if target_state is not null and target_state <> 'OPEN' then
      raise exception 'wos: epoch % is % — policies never change a published or finalized epoch', new.effective_epoch, target_state
        using errcode = 'check_violation';
    end if;
    if target_start is not null and target_start < new.announced_at + interval '72 hours' then
      raise exception 'wos: announce a policy change at least 72 h before its epoch starts' using errcode = 'check_violation';
    end if;
    if target_start is null and new.effective_epoch <= coalesce(last_epoch, 0) then
      raise exception 'wos: epoch % is not defined', new.effective_epoch using errcode = 'check_violation';
    end if;
  else
    if target_state is not null and target_state not in ('OPEN', 'CALCULATING') then
      raise exception 'wos: an emergency change never touches published allocations (epoch % is %)', new.effective_epoch, target_state
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger policy_activations_check before insert on wos.policy_activations for each row execute function wos.check_policy_activation();

-- ============================================================================================
-- 3. Lease fencing, attempt lifetime, run-policy snapshots, qualification results (H7)
-- ============================================================================================
alter table wos.leases add column generation integer;
update wos.leases l set generation = g.n
  from (select id, row_number() over (partition by task_id order by issued_at, id) as n from wos.leases) g
 where g.id = l.id;
alter table wos.leases alter column generation set not null;
alter table wos.leases add constraint leases_generation_positive check (generation > 0);
create unique index leases_task_generation on wos.leases (task_id, generation);

create or replace function wos.leases_assign_generation() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.lease_gen:' || new.task_id::text));
  select coalesce(max(generation), 0) + 1 into new.generation from wos.leases where task_id = new.task_id;
  return new;
end $$;
create trigger leases_generation before insert on wos.leases for each row execute function wos.leases_assign_generation();

create or replace function wos.leases_generation_immutable() returns trigger
language plpgsql as $$
begin
  if new.generation <> old.generation or new.task_id <> old.task_id then
    raise exception 'wos: lease generation and task are immutable' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger leases_generation_immutable before update on wos.leases for each row execute function wos.leases_generation_immutable();

-- Hard attempt lifetime (Astra-01 item 7): never null; the sweeper expires attempts past it.
alter table wos.attempts add column max_lifetime_at timestamptz;
update wos.attempts set max_lifetime_at = created_at + interval '7 days';
alter table wos.attempts alter column max_lifetime_at set default (now() + interval '7 days');
alter table wos.attempts alter column max_lifetime_at set not null;

create table wos.run_policy_snapshots (
  lease_id          uuid primary key references wos.leases (id),
  generation        integer not null,
  body              jsonb not null,
  snapshot_sha256   text not null unique check (snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at        timestamptz not null default now()
);

-- H7: the persisted result of QUALIFY (BUILD-PROTOCOL §9 / document consensus), tied to subject revision, lease
-- generation and the submission that was accepted while that lease was valid.
create table wos.qualification_results (
  id                 uuid primary key default gen_random_uuid(),
  subject_kind       text not null check (subject_kind in ('attempt', 'document')),
  subject_id         uuid not null,
  subject_revision   text not null,                -- head sha (attempt) or document version
  lease_id           uuid not null references wos.leases (id),
  lease_generation   integer not null,
  changeset_id       uuid references wos.changesets (id),
  passed             boolean not null,
  snapshot_sha256s   text[] not null,
  evidence           jsonb not null,
  recorded_at        timestamptz not null default now()
);

create or replace function wos.check_qualification_result() returns trigger
language plpgsql as $$
declare
  l wos.leases%rowtype;
  c wos.changesets%rowtype;
begin
  new.recorded_at := clock_timestamp();
  select * into l from wos.leases where id = new.lease_id;
  if l.generation <> new.lease_generation then
    raise exception 'wos: qualification cites generation % of a lease whose generation is %', new.lease_generation, l.generation using errcode = 'check_violation';
  end if;
  if new.subject_kind = 'attempt' then
    if new.changeset_id is null then
      raise exception 'wos: an attempt qualification names the accepted changeset' using errcode = 'check_violation';
    end if;
    select * into c from wos.changesets where id = new.changeset_id;
    -- The lease was valid WHEN the submission was accepted (not through review): issued before, not ended before.
    if c.lease_id <> new.lease_id or not c.ok or c.created_at < l.issued_at or (l.ended_at is not null and c.created_at > l.ended_at) then
      raise exception 'wos: the changeset was not accepted on this lease while it was valid' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger qualification_results_check before insert on wos.qualification_results for each row execute function wos.check_qualification_result();

-- Review duty and audits are leased tasks too.
alter table wos.tasks drop constraint tasks_kind_check;
alter table wos.tasks add constraint tasks_kind_check check (kind in ('roadmap_author', 'roadmap_review', 'feature_author',
  'feature_review', 'abu_build', 'abu_revision', 'implementation_review', 'conflict_resolution', 'payout_audit'));
alter table wos.tasks drop constraint tasks_role_check;
alter table wos.tasks add constraint tasks_role_check check (role in ('roadmap_author', 'roadmap_reviewer_astra',
  'roadmap_reviewer_fable', 'feature_author', 'feature_reviewer_astra', 'feature_reviewer_fable', 'builder',
  'implementation_reviewer_astra', 'implementation_reviewer_fable', 'conflict_resolver', 'payout_auditor'));

-- ============================================================================================
-- 3b. Organizations as beneficiaries (D38, D44) and RELATED ACCOUNTS (H8)
-- ============================================================================================
create table wos.sponsorship_links (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references wos.organizations (id),
  contributor_account_id  uuid not null references wos.accounts (id),
  organization_share_bp   integer not null default 10000 check (organization_share_bp between 0 and 10000),
  approved_by_account_id  uuid not null references wos.accounts (id),
  effective_from          timestamptz not null default now(),
  created_at              timestamptz not null default now()
);
create table wos.sponsorship_link_ends (
  sponsorship_id   uuid primary key references wos.sponsorship_links (id),
  ended_by         uuid not null references wos.accounts (id),
  ended_at         timestamptz not null default now()
);

create or replace function wos.check_sponsorship_link() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  new.effective_from := clock_timestamp();       -- forward-only (D44)
  if not exists (select 1 from wos.memberships m where m.organization_id = new.organization_id
                  and m.account_id = new.approved_by_account_id and m.role in ('owner', 'admin')) then
    raise exception 'wos: a sponsorship must be approved by an owner or admin of the organization' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.organizations o where o.id = new.organization_id and o.kind = 'personal') then
    raise exception 'wos: a personal organization cannot sponsor contributions' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.sponsorship_links s where s.contributor_account_id = new.contributor_account_id
              and not exists (select 1 from wos.sponsorship_link_ends e where e.sponsorship_id = s.id)) then
    raise exception 'wos: a contributor has at most one active sponsorship (end it to change the split)' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger sponsorship_links_check before insert on wos.sponsorship_links for each row execute function wos.check_sponsorship_link();

-- H8: related = same account, members of the same TEAM organization (any role), or ever sponsored by the same
-- organization (ended links included: history relevant to the work). Security definer: sees rows RLS hides.
create or replace function wos.related_accounts(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = wos, pg_temp as $$
  select a = b
      or exists (select 1 from wos.memberships x join wos.memberships y on y.organization_id = x.organization_id
                   join wos.organizations o on o.id = x.organization_id and o.kind = 'team'
                  where x.account_id = a and y.account_id = b)
      or exists (select 1 from wos.sponsorship_links x join wos.sponsorship_links y on y.organization_id = x.organization_id
                  where x.contributor_account_id = a and y.contributor_account_id = b)
      or exists (select 1 from wos.sponsorship_links x join wos.memberships y on y.organization_id = x.organization_id
                  where (x.contributor_account_id = a and y.account_id = b) or (x.contributor_account_id = b and y.account_id = a))
$$;

-- Agent reviews: not related to the builder or the other seat; not the human reviewer of the same round (both orders).
create or replace function wos.check_review_related() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  builder uuid;
begin
  perform pg_advisory_xact_lock(hashtext('wos.round:' || new.round_id::text));
  select a.account_id into builder from wos.rounds r join wos.attempts a on a.id = r.attempt_id where r.id = new.round_id;
  if builder is not null and new.independence = 'independent' and builder <> new.account_id and wos.related_accounts(builder, new.account_id) then
    raise exception 'wos: reviewer % is related to the builder', new.account_id using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.reviews o where o.round_id = new.round_id and o.account_id <> new.account_id and wos.related_accounts(o.account_id, new.account_id)) then
    raise exception 'wos: related accounts may not fill two seats of one round' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.human_reviews h where h.round_id = new.round_id and wos.related_accounts(h.reviewer_account_id, new.account_id)) then
    raise exception 'wos: the human reviewer of this round (or a related account) may not take an agent seat' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ============================================================================================
-- 3c. Publication disclosure accepted before the first contribution or wallet binding (M17, D47)
-- ============================================================================================
create table wos.publication_consents (
  account_id          uuid not null references wos.accounts (id),
  disclosure_version  text not null,
  disclosure_sha256   text not null check (disclosure_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at          timestamptz not null default now(),
  primary key (account_id, disclosure_version)
);

-- ============================================================================================
-- 4. Usage receipts, provider response dedup, run-log commitments and expiring bodies (M17)
-- ============================================================================================
create table wos.usage_receipts (
  id                        uuid primary key default gen_random_uuid(),
  agent_run_id              uuid not null unique references wos.agent_runs (id),
  lease_id                  uuid not null references wos.leases (id),
  lease_generation          integer not null,
  account_id                uuid not null references wos.accounts (id),
  provider                  text not null check (provider in ('claude_cli', 'codex_cli')),
  model_id_requested        text not null,
  model_id_reported         text,
  reasoning_requested       text not null check (reasoning_requested in ('low', 'medium', 'high', 'xhigh', 'max')),
  reasoning_observed        text,
  verification_level        text not null check (verification_level in ('VERIFIED', 'ATTESTED', 'ESTIMATED', 'UNVERIFIED')),
  log_consistent            boolean not null,       -- false: no run log (bare numbers, weighted 50%); an inconsistent log is UNVERIFIED
  input_tokens              bigint not null check (input_tokens >= 0),
  cached_input_tokens       bigint not null check (cached_input_tokens >= 0),
  cache_write_input_tokens  bigint not null check (cache_write_input_tokens >= 0),
  output_tokens             bigint not null check (output_tokens >= 0),
  reasoning_output_tokens   bigint not null check (reasoning_output_tokens >= 0 and reasoning_output_tokens <= output_tokens),
  usage_event_count         integer not null check (usage_event_count >= 0),
  oracle_version            text not null,
  acu_micro                 bigint not null check (acu_micro >= 0),
  run_policy_snapshot_sha256 text not null,
  body                      jsonb not null,
  receipt_sha256            text not null unique check (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at                timestamptz not null default now()
);
create index usage_receipts_account on wos.usage_receipts (account_id, created_at);

create table wos.usage_event_ids (
  id_sha256         text primary key check (id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  usage_receipt_id  uuid not null references wos.usage_receipts (id),
  created_at        timestamptz not null default now()
);

create or replace function wos.check_usage_receipt() returns trigger
language plpgsql as $$
declare
  l wos.leases%rowtype;
begin
  select * into l from wos.leases where id = new.lease_id;
  if l.generation <> new.lease_generation or l.account_id <> new.account_id then
    raise exception 'wos: usage receipt does not match lease %/generation %', new.lease_id, new.lease_generation using errcode = 'check_violation';
  end if;
  if not exists (select 1 from wos.agent_runs r where r.id = new.agent_run_id and r.lease_id = new.lease_id and r.signature_valid) then
    raise exception 'wos: usage receipt needs a validly signed agent run of the same lease' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from wos.run_policy_snapshots s where s.lease_id = new.lease_id and s.snapshot_sha256 = new.run_policy_snapshot_sha256) then
    raise exception 'wos: usage receipt must cite the run-policy snapshot of its lease' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger usage_receipts_check before insert on wos.usage_receipts for each row execute function wos.check_usage_receipt();

-- Immutable commitment (kept forever) and the log body (deleted after its expiry; never updated).
create table wos.run_log_commitments (
  agent_run_id     uuid primary key references wos.agent_runs (id),
  log_sha256       text not null unique check (log_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  turns            integer not null check (turns between 0 and 2000),
  repair_loops     integer not null check (repair_loops >= 0),
  tool_calls       integer not null check (tool_calls >= 0),
  totals_match     boolean not null,
  body_expires_at  timestamptz not null,
  created_at       timestamptz not null default now()
);
create table wos.run_log_bodies (
  agent_run_id  uuid primary key references wos.run_log_commitments (agent_run_id),
  size_bytes    integer not null check (size_bytes between 1 and 1048576),
  body          jsonb not null
);
create or replace function wos.run_log_body_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'wos: run log bodies are never edited' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' and (select body_expires_at from wos.run_log_commitments c where c.agent_run_id = old.agent_run_id) > now() then
    raise exception 'wos: a run log body is deleted only after its retention expires' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(old, new);
end $$;
create trigger run_log_bodies_rules before update or delete on wos.run_log_bodies for each row execute function wos.run_log_body_rules();

create table wos.usage_publications (
  usage_receipt_id  uuid primary key references wos.usage_receipts (id),
  epoch_number      integer not null,
  created_at        timestamptz not null default now()
);

-- ============================================================================================
-- 5. Epochs: immutable definitions (freezing the numbers the DB enforces) + append-only transitions (H6)
-- ============================================================================================
create table wos.epochs (
  epoch_number        integer primary key check (epoch_number > 0),
  mode                text not null check (mode in ('test', 'live')),
  cluster             text not null check (cluster in ('devnet', 'mainnet-beta')),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  risk_review_hours   integer not null check (risk_review_hours > 0),
  challenge_hours     integer not null check (challenge_hours > 0),
  reply_hours         integer not null default 24 check (reply_hours > 0),
  appeal_hours        integer not null default 72 check (appeal_hours > 0),
  max_disputes_per_account integer not null default 3 check (max_disputes_per_account > 0),
  max_items_per_dispute    integer not null default 25 check (max_items_per_dispute > 0),
  stake_per_item_bp   integer not null default 200 check (stake_per_item_bp between 0 and 10000),
  max_stake_bp        integer not null default 1000 check (max_stake_bp between 0 and 10000),
  min_stake_base      bigint not null default 1000000 check (min_stake_base >= 0),
  bounty_bp_of_recovered integer not null default 2000 check (bounty_bp_of_recovered between 0 and 10000),
  policy_versions     jsonb not null,
  created_at          timestamptz not null default now(),
  check (ends_at > starts_at),
  check (mode <> 'test' or cluster = 'devnet')         -- H7: test epochs are devnet only
);

create table wos.epoch_transitions (
  epoch_number        integer not null references wos.epochs (epoch_number),
  seq                 integer not null,
  from_state          text check (from_state in ('OPEN', 'CALCULATING', 'PROPOSED', 'FINALIZED', 'DISTRIBUTABLE', 'CLOSED')),
  to_state            text not null check (to_state in ('OPEN', 'CALCULATING', 'PROPOSED', 'FINALIZED', 'DISTRIBUTABLE', 'CLOSED')),
  actor               text not null check (actor in ('system', 'maintainer')),
  admin_action_id     uuid references wos.admin_actions (id),
  receipts_root       text check (receipts_root ~ '^sha256:[0-9a-f]{64}$'),
  allocations_root    text check (allocations_root ~ '^sha256:[0-9a-f]{64}$'),
  result_sha256       text check (result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  anchor_signature    text,
  at                  timestamptz not null default now(),
  primary key (epoch_number, seq),
  check ((to_state = 'PROPOSED') = (receipts_root is not null and allocations_root is not null and result_sha256 is not null)),
  check ((to_state = 'DISTRIBUTABLE') = (anchor_signature is not null)),
  check ((actor = 'maintainer') = (admin_action_id is not null))
);

create or replace function wos.epoch_state(e integer) returns text
language sql stable as $$
  select to_state from wos.epoch_transitions where epoch_number = e order by seq desc limit 1
$$;
create or replace function wos.epoch_state_at(e integer, s text) returns timestamptz
language sql stable as $$
  select at from wos.epoch_transitions where epoch_number = e and to_state = s order by seq desc limit 1
$$;

create or replace function wos.check_epoch_transition() returns trigger
language plpgsql as $$
declare
  cur text;
  ep wos.epochs%rowtype;
  cur_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('wos.epoch:' || new.epoch_number::text));
  select * into ep from wos.epochs where epoch_number = new.epoch_number;
  select to_state, at into cur, cur_at from wos.epoch_transitions where epoch_number = new.epoch_number order by seq desc limit 1;
  new.seq := coalesce((select max(seq) from wos.epoch_transitions where epoch_number = new.epoch_number), 0) + 1;
  new.at := clock_timestamp();
  if new.admin_action_id is not null then
    perform wos.require_admin_action(new.admin_action_id, array['epoch_transition'], 'epoch', new.epoch_number::text);
  end if;
  -- H6: every guard is evaluated with IS TRUE; NULL never passes. The first transition must be OPEN.
  if not ((cur is null and new.from_state is null and new.to_state = 'OPEN')
       or (cur is not null and new.from_state is not distinct from cur and (
              (cur = 'OPEN' and new.to_state = 'CALCULATING' and new.at >= ep.ends_at)
           or (cur = 'CALCULATING' and new.to_state = 'PROPOSED' and new.at >= cur_at + make_interval(hours => ep.risk_review_hours))
           or (cur = 'PROPOSED' and new.to_state = 'FINALIZED' and new.at >= cur_at + make_interval(hours => ep.challenge_hours))
           or (cur = 'FINALIZED' and new.to_state = 'DISTRIBUTABLE')
           or (cur = 'DISTRIBUTABLE' and new.to_state = 'CLOSED')))) is true then
    raise exception 'wos: epoch % transition % -> % is not allowed now (windows are enforced)', new.epoch_number, coalesce(cur, 'new'), new.to_state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger epoch_transitions_check before insert on wos.epoch_transitions for each row execute function wos.check_epoch_transition();

-- ============================================================================================
-- 6. Contribution receipts: immutable, qualified, one dedup namespace shared with Genesis (H7)
-- ============================================================================================
create table wos.work_dedup_keys (
  dedup_key   text primary key,
  source      text not null check (source in ('receipt', 'genesis')),
  created_at  timestamptz not null default now()
);

create table wos.contribution_receipts (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references wos.accounts (id),
  contribution_type     text not null check (contribution_type in ('APPLICATION_ROADMAP', 'FEATURE_SPECIFICATION',
    'ARCHITECTURE_RESOLUTION', 'IMPLEMENTATION', 'AGENT_REVIEW', 'HUMAN_REVIEW', 'SECURITY', 'INTEGRATION',
    'DOCUMENTATION', 'OTHER_PROTOCOL_APPROVED', 'PROPOSAL', 'BUG_REPORT', 'AUDIT_RERUN')),
  slice                 text not null check (slice in ('execution', 'planning', 'human_review', 'outcomes', 'security_reserve')),
  evidence_class        text not null check (evidence_class in ('attested_usage', 'accepted_output', 'outcome')),
  acceptance_event      text not null,
  independence          text not null check (independence in ('independent', 'founder_bootstrap')),
  initial_status        text not null check (initial_status in ('ACTIVE', 'PROVISIONAL')),
  weight_micro          bigint not null check (weight_micro >= 0),
  attested_acu_micro    bigint not null check (attested_acu_micro >= 0),
  cap_acu_micro         bigint not null check (cap_acu_micro >= 0),
  lowest_verification   text not null check (lowest_verification in ('VERIFIED', 'ATTESTED', 'ESTIMATED', 'UNVERIFIED')),
  usage_receipt_ids     uuid[] not null default '{}',
  qualification_id      uuid references wos.qualification_results (id),
  beneficiary_org_id    uuid references wos.organizations (id),
  beneficiary_org_share_bp integer not null default 0 check (beneficiary_org_share_bp between 0 and 10000),
  sponsorship_id        uuid references wos.sponsorship_links (id),
  subject_kind          text not null,
  subject_id            uuid not null,
  lease_id              uuid references wos.leases (id),
  lease_generation      integer,
  dedup_key             text not null unique references wos.work_dedup_keys (dedup_key),
  admitted_epoch        integer not null references wos.epochs (epoch_number),
  body                  jsonb not null,
  receipt_sha256        text not null unique check (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  qualified_at          timestamptz not null,
  created_at            timestamptz not null default now(),
  check ((independence = 'independent') = (initial_status = 'ACTIVE')),
  check (evidence_class <> 'attested_usage' or weight_micro <= cap_acu_micro),
  check (evidence_class <> 'attested_usage' or weight_micro <= attested_acu_micro),
  check ((lease_id is null) = (lease_generation is null)),
  check ((beneficiary_org_id is null) = (sponsorship_id is null)),
  check (beneficiary_org_id is not null or beneficiary_org_share_bp = 0)
);
create index contribution_receipts_account on wos.contribution_receipts (account_id, created_at);

create or replace function wos.check_contribution_receipt() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  q wos.qualification_results%rowtype;
  n_usage integer;
  sum_acu bigint;
  ep wos.epochs%rowtype;
  s wos.sponsorship_links%rowtype;
begin
  new.created_at := clock_timestamp();
  if not exists (select 1 from wos.publication_consents c where c.account_id = new.account_id) then
    raise exception 'wos: the contributor has not accepted the publication disclosure (D47)' using errcode = 'check_violation';
  end if;
  if new.independence = 'founder_bootstrap' and not (wos.bootstrap_on() and wos.is_maintainer(new.account_id)) then
    raise exception 'wos: a founder_bootstrap receipt needs bootstrap mode and a maintainer contributor' using errcode = 'check_violation';
  end if;
  select * into ep from wos.epochs where epoch_number = new.admitted_epoch;
  if (wos.epoch_state(new.admitted_epoch) = 'OPEN') is not true then
    raise exception 'wos: receipts are admitted only to an OPEN epoch (epoch % is %)', new.admitted_epoch, wos.epoch_state(new.admitted_epoch)
      using errcode = 'check_violation';
  end if;
  -- Mainnet fails closed (F1): no attested-usage weight is admitted to a mainnet epoch.
  if ep.cluster = 'mainnet-beta' and new.evidence_class = 'attested_usage' then
    raise exception 'wos: attested usage is not eligible on mainnet until founder decision F1' using errcode = 'check_violation';
  end if;
  -- Subject kind must fit the type.
  if (new.contribution_type = 'IMPLEMENTATION' and new.subject_kind <> 'attempt')
     or (new.contribution_type in ('APPLICATION_ROADMAP', 'FEATURE_SPECIFICATION') and new.subject_kind <> 'document') then
    raise exception 'wos: % needs a % subject', new.contribution_type, case when new.contribution_type = 'IMPLEMENTATION' then 'attempt' else 'document' end
      using errcode = 'check_violation';
  end if;
  if new.subject_kind = 'attempt' and not exists (select 1 from wos.attempts a where a.id = new.subject_id and a.state = 'merged') then
    raise exception 'wos: the attempt % is not merged', new.subject_id using errcode = 'check_violation';
  end if;
  if new.subject_kind = 'document' and not exists (select 1 from wos.documents d where d.id = new.subject_id) then
    raise exception 'wos: the document % does not exist', new.subject_id using errcode = 'check_violation';
  end if;
  -- Qualification (H7): leased work needs a passed qualification of THIS subject on THIS lease generation.
  if new.contribution_type in ('IMPLEMENTATION', 'AGENT_REVIEW', 'ARCHITECTURE_RESOLUTION', 'APPLICATION_ROADMAP',
                               'FEATURE_SPECIFICATION', 'AUDIT_RERUN', 'INTEGRATION', 'DOCUMENTATION') then
    select * into q from wos.qualification_results where id = new.qualification_id;
    if (q.passed and q.subject_id = new.subject_id and q.subject_kind = new.subject_kind
        and q.lease_id = new.lease_id and q.lease_generation = new.lease_generation) is not true then
      raise exception 'wos: % needs a passed qualification of its subject on its lease generation', new.contribution_type using errcode = 'check_violation';
    end if;
  end if;
  -- Attested usage (H7): the weight rests on this contributor's own ATTESTED/VERIFIED usage receipts, summed by the DB.
  if new.evidence_class = 'attested_usage' then
    if new.lowest_verification in ('ESTIMATED', 'UNVERIFIED') then
      raise exception 'wos: attested_usage weight cannot rest on % usage (fail closed)', new.lowest_verification using errcode = 'check_violation';
    end if;
    select count(*), coalesce(sum(u.acu_micro), 0) into n_usage, sum_acu
      from wos.usage_receipts u
     where u.id = any(new.usage_receipt_ids) and u.account_id = new.account_id and u.verification_level in ('VERIFIED', 'ATTESTED');
    if n_usage = 0 or n_usage <> cardinality(new.usage_receipt_ids) or sum_acu <> new.attested_acu_micro then
      raise exception 'wos: attested ACU must equal the sum of the contributor''s own qualifying usage receipts' using errcode = 'check_violation';
    end if;
  end if;
  if new.sponsorship_id is not null then
    select * into s from wos.sponsorship_links where id = new.sponsorship_id;
    if s.contributor_account_id <> new.account_id or s.organization_id <> new.beneficiary_org_id or s.organization_share_bp <> new.beneficiary_org_share_bp
       or exists (select 1 from wos.sponsorship_link_ends e where e.sponsorship_id = s.id) then
      raise exception 'wos: the beneficiary must be the contributor''s ACTIVE sponsorship, with its split' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger contribution_receipts_check before insert on wos.contribution_receipts
  for each row execute function wos.check_contribution_receipt();

-- ============================================================================================
-- 7. Receipt status: append-only events validated against ReceiptStatusMachine (D23, D28, H12)
-- ============================================================================================
create table wos.receipt_status_events (
  receipt_id       uuid not null references wos.contribution_receipts (id),
  seq              integer not null,
  from_status      text check (from_status in ('ACTIVE', 'PROVISIONAL', 'RATIFIED', 'REVOKED')),
  to_status        text not null check (to_status in ('ACTIVE', 'PROVISIONAL', 'RATIFIED', 'REVOKED')),
  kind             text not null check (kind in ('issued', 'quorum_ratified', 'human_signoff', 'ratification_rejected', 'revoked', 'restored')),
  quorum_id        uuid,
  human_review_id  uuid,
  admin_action_id  uuid references wos.admin_actions (id),
  at               timestamptz not null default now(),
  primary key (receipt_id, seq)
);

create or replace function wos.receipt_status(r uuid) returns text
language sql stable security definer set search_path = wos, pg_temp as $$
  select to_status from wos.receipt_status_events where receipt_id = r order by seq desc limit 1
$$;

create or replace function wos.check_receipt_status_event() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  cur text;
  born text;
  before_revoke text;
  c wos.contribution_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('wos.receipt:' || new.receipt_id::text));
  select * into c from wos.contribution_receipts where id = new.receipt_id;
  born := c.initial_status;
  cur := wos.receipt_status(new.receipt_id);
  new.seq := coalesce((select max(seq) from wos.receipt_status_events where receipt_id = new.receipt_id), 0) + 1;
  new.at := clock_timestamp();
  if cur = 'REVOKED' then
    select from_status into before_revoke from wos.receipt_status_events where receipt_id = new.receipt_id and to_status = 'REVOKED' order by seq desc limit 1;
  end if;
  if not ((cur is null and new.from_status is null and new.kind = 'issued' and new.to_status = born)
       or (cur is not null and new.from_status is not distinct from cur and (
              (cur = 'PROVISIONAL' and new.to_status = 'RATIFIED' and new.kind = 'quorum_ratified' and new.quorum_id is not null)
           or (cur = 'PROVISIONAL' and new.to_status = 'RATIFIED' and new.kind = 'human_signoff' and new.human_review_id is not null)
           or (cur = 'PROVISIONAL' and new.to_status = 'PROVISIONAL' and new.kind = 'ratification_rejected' and new.admin_action_id is not null)
           or (cur in ('ACTIVE', 'PROVISIONAL', 'RATIFIED') and new.to_status = 'REVOKED' and new.kind = 'revoked' and new.admin_action_id is not null)
           or (cur = 'REVOKED' and new.kind = 'restored' and new.admin_action_id is not null and new.to_status = before_revoke)))) is true then
    raise exception 'wos: receipt status % -> % by % is not allowed', coalesce(cur, 'new'), new.to_status, new.kind using errcode = 'check_violation';
  end if;
  if new.kind = 'revoked' then
    perform wos.require_admin_action(new.admin_action_id, array['invalidate_receipt', 'confiscate', 'resolve_dispute'], 'receipt', new.receipt_id::text);
  elsif new.kind = 'restored' then
    perform wos.require_admin_action(new.admin_action_id, array['restore_receipt'], 'receipt', new.receipt_id::text);
  elsif new.kind = 'ratification_rejected' then
    perform wos.require_admin_action(new.admin_action_id, array['reject_ratification'], 'receipt', new.receipt_id::text);
  elsif new.kind = 'human_signoff' then
    -- An unrelated human's PASS on this receipt; for founder bootstrap work the human is also not a maintainer.
    if not exists (select 1 from wos.human_reviews h where h.id = new.human_review_id and h.verdict = 'PASS'
                    and h.subject_kind = 'receipt' and h.subject_id = c.id and not wos.related_accounts(h.reviewer_account_id, c.account_id)
                    and (c.independence <> 'founder_bootstrap' or not wos.is_maintainer(h.reviewer_account_id))) then
      raise exception 'wos: sign-off must be a PASS on this receipt by an unrelated human (not a maintainer for founder work)' using errcode = 'check_violation';
    end if;
  elsif new.kind = 'quorum_ratified' then
    if not exists (select 1 from wos.payout_audit_outcomes o where o.quorum_id = new.quorum_id and o.receipt_id = new.receipt_id and o.outcome = 'ratified') then
      raise exception 'wos: quorum % did not ratify receipt %', new.quorum_id, new.receipt_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger receipt_status_events_check before insert on wos.receipt_status_events
  for each row execute function wos.check_receipt_status_event();

create or replace function wos.issue_receipt_status() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if not exists (select 1 from wos.work_dedup_keys where dedup_key = new.dedup_key and source = 'receipt') then
    raise exception 'wos: receipt dedup key % is not a receipt key', new.dedup_key using errcode = 'check_violation';
  end if;
  insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind) values (new.id, null, new.initial_status, 'issued');
  return new;
end $$;
create trigger contribution_receipts_issue after insert on wos.contribution_receipts
  for each row execute function wos.issue_receipt_status();

-- ============================================================================================
-- 8. Human review: scoped qualifications and bound reviews (H8)
-- ============================================================================================
create table wos.reviewer_qualification_events (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references wos.accounts (id),
  action               text not null check (action in ('grant', 'suspend', 'restore', 'revoke')),
  domains              text[] not null,
  level                integer not null check (level between 1 and 3),
  contribution_types   text[] not null,
  risk_classes         text[] not null,
  admin_action_id      uuid not null references wos.admin_actions (id),
  created_at           timestamptz not null default now()
);
create or replace function wos.check_qualification_event() returns trigger
language plpgsql as $$
begin
  new.created_at := clock_timestamp();
  perform wos.require_admin_action(new.admin_action_id,
    case when new.action in ('grant', 'restore') then array['authorize_reviewer', 'restore_reviewer_privileges'] else array['revoke_reviewer', 'suspend_reviewer_privileges'] end,
    'account', new.account_id::text);
  return new;
end $$;
create trigger reviewer_qualification_events_check before insert on wos.reviewer_qualification_events
  for each row execute function wos.check_qualification_event();

-- The latest qualification event of an account, if it grants the risk class.
create or replace function wos.reviewer_qualified(a uuid, risk text default null) returns boolean
language sql stable security definer set search_path = wos, pg_temp as $$
  select coalesce((select q.action in ('grant', 'restore') and (risk is null or risk = any(q.risk_classes))
                     from wos.reviewer_qualification_events q where q.account_id = a order by q.created_at desc, q.id desc limit 1), false)
$$;

create table wos.human_reviews (
  id                      uuid primary key default gen_random_uuid(),
  purpose                 text not null check (purpose in ('pre_merge', 'ratification_signoff', 'audit')),
  subject_kind            text not null check (subject_kind in ('attempt', 'document', 'receipt', 'genesis', 'security_report')),
  subject_id              uuid not null,
  round_id                uuid references wos.rounds (id),
  head_sha                text check (head_sha ~ '^[0-9a-f]{40}$'),
  submission_sha256       text check (submission_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  context_sha256          text not null check (context_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  reviewer_account_id     uuid not null references wos.accounts (id),
  risk_class              text not null,
  verdict                 text not null check (verdict in ('PASS', 'FAIL')),
  review_policy_version   text not null,
  body                    jsonb not null,
  review_sha256           text not null unique check (review_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sealed_at               timestamptz not null default now()
);

create or replace function wos.check_human_review() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  author uuid;
  r wos.rounds%rowtype;
begin
  new.sealed_at := clock_timestamp();
  if not wos.reviewer_qualified(new.reviewer_account_id, new.risk_class) then
    raise exception 'wos: account % is not an authorized human reviewer for risk class %', new.reviewer_account_id, new.risk_class using errcode = 'check_violation';
  end if;
  if new.subject_kind = 'attempt' then
    select account_id into author from wos.attempts where id = new.subject_id;
  elsif new.subject_kind = 'receipt' then
    select account_id into author from wos.contribution_receipts where id = new.subject_id;
  elsif new.subject_kind = 'genesis' then
    select contributor_account_id into author from wos.genesis_contributions where id = new.subject_id;
  end if;
  if author = new.reviewer_account_id then
    raise exception 'wos: a human reviewer may not review their own work' using errcode = 'check_violation';
  end if;
  if author is not null and wos.related_accounts(author, new.reviewer_account_id) then
    raise exception 'wos: a human reviewer may not review a related account''s work (related accounts)' using errcode = 'check_violation';
  end if;
  if new.subject_kind = 'document' and exists (
      select 1 from wos.changesets c join wos.tasks t on t.id = c.task_id
       where t.document_id = new.subject_id and c.ok and wos.related_accounts(c.account_id, new.reviewer_account_id)) then
    raise exception 'wos: a human reviewer may not review a document they or a related account authored' using errcode = 'check_violation';
  end if;
  if new.purpose = 'pre_merge' then
    select * into r from wos.rounds where id = new.round_id;
    -- H8: the round belongs to THIS subject and the approval is bound to its head and diff.
    if (new.head_sha = r.head_sha and new.submission_sha256 = r.submission_sha256
        and ((new.subject_kind = 'attempt' and r.attempt_id = new.subject_id) or (new.subject_kind = 'document' and r.document_id = new.subject_id))) is not true then
      raise exception 'wos: a pre-merge human review is bound to a round of this subject, its head sha and submission hash' using errcode = 'check_violation';
    end if;
    perform pg_advisory_xact_lock(hashtext('wos.round:' || new.round_id::text));
    if exists (select 1 from wos.reviews v where v.round_id = new.round_id and wos.related_accounts(v.account_id, new.reviewer_account_id)) then
      raise exception 'wos: the human reviewer (or a related account) already holds an agent seat of this round' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger human_reviews_check before insert on wos.human_reviews for each row execute function wos.check_human_review();
create trigger reviews_related before insert on wos.reviews for each row execute function wos.check_review_related();

create table wos.review_eval_cases (
  id               uuid primary key default gen_random_uuid(),
  subject_kind     text not null,
  subject_id       uuid not null,
  round_id         uuid references wos.rounds (id),
  pattern          text not null check (pattern in ('agents_pass_human_fail', 'agents_fail_human_pass', 'agents_split', 'post_merge_defect_missed_by_all', 'auditors_split')),
  astra_verdict    text,
  fable_verdict    text,
  human_verdict    text,
  outcome          text not null check (outcome in ('pending', 'human_upheld', 'agents_upheld', 'both_wrong')),
  context_sha256   text not null,
  created_at       timestamptz not null default now()
);

-- ============================================================================================
-- 9. Payout audits: PRIVATE quorums and verdicts (H11), public outcomes, canaries, clips, duty events (M14)
-- ============================================================================================
create table wos.payout_audit_quorums (
  id                    uuid primary key default gen_random_uuid(),
  receipt_id            uuid references wos.contribution_receipts (id),   -- null for a canary quorum (private table)
  is_canary             boolean not null default false,
  purpose               text not null check (purpose in ('sampled', 'dispute_gate', 'ratification', 'canary')),
  size                  integer not null check (size between 1 and 5),
  require_provider_diversity boolean not null default true,
  review_policy_version text not null,
  outcome               text check (outcome in ('ratified', 'findings', 'expired')),
  created_at            timestamptz not null default now(),
  check (is_canary = (receipt_id is null)),
  check (is_canary = (purpose = 'canary'))
);

create or replace function wos.check_payout_audit_quorum() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.outcome is not null then
      raise exception 'wos: a quorum is created without an outcome (H7: no pre-ratified quorums)' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.outcome is not null or new.receipt_id is distinct from old.receipt_id or new.size <> old.size or new.is_canary <> old.is_canary or new.purpose <> old.purpose then
    raise exception 'wos: a quorum''s outcome is set once and nothing else changes' using errcode = 'check_violation';
  end if;
  if new.outcome = 'ratified' and (select count(*) from wos.payout_audit_verdicts v
                                    where v.quorum_id = new.id and v.outside_feature and v.judgment = 'plausible') < new.size then
    raise exception 'wos: quorum % lacks % outside-feature plausible judgments', new.id, new.size using errcode = 'check_violation';
  end if;
  if new.outcome = 'ratified' and exists (select 1 from wos.payout_audit_verdicts v where v.quorum_id = new.id and v.judgment in ('inflated', 'misattributed')) then
    raise exception 'wos: quorum % has an open inflation or attribution finding', new.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payout_audit_quorums_check before insert or update on wos.payout_audit_quorums
  for each row execute function wos.check_payout_audit_quorum();
create trigger payout_audit_quorums_no_delete before delete or truncate on wos.payout_audit_quorums
  for each statement execute function wos.forbid_mutation();

create table wos.payout_audit_verdicts (
  id                  uuid primary key default gen_random_uuid(),
  quorum_id           uuid not null references wos.payout_audit_quorums (id),
  slot                integer not null check (slot > 0),
  outside_feature     boolean not null,
  packet_id           uuid not null,
  reviewer_account_id uuid not null references wos.accounts (id),
  task_id             uuid not null references wos.tasks (id),
  lease_id            uuid not null references wos.leases (id),
  agent_run_id        uuid not null references wos.agent_runs (id),
  provider            text not null check (provider in ('claude_cli', 'codex_cli')),
  judgment            text not null check (judgment in ('plausible', 'inflated', 'misattributed', 'insufficient_evidence')),
  body                jsonb not null,
  verdict_sha256      text not null unique check (verdict_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sealed_at           timestamptz not null default now(),
  unique (quorum_id, slot),
  unique (quorum_id, reviewer_account_id)
);

-- Security definer (H8): sees sealed rows of other seats; one lock per quorum; binds seat, task, lease and signed run.
create or replace function wos.check_payout_audit_verdict() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  q wos.payout_audit_quorums%rowtype;
  c wos.contribution_receipts%rowtype;
  t wos.tasks%rowtype;
  l wos.leases%rowtype;
  on_feature boolean;
begin
  perform pg_advisory_xact_lock(hashtext('wos.quorum:' || new.quorum_id::text));
  new.sealed_at := clock_timestamp();
  select * into q from wos.payout_audit_quorums where id = new.quorum_id;
  if q.outcome is not null then
    raise exception 'wos: quorum % is already revealed', q.id using errcode = 'check_violation';
  end if;
  if new.slot > q.size then
    raise exception 'wos: slot % exceeds quorum size %', new.slot, q.size using errcode = 'check_violation';
  end if;
  select * into t from wos.tasks where id = new.task_id;
  select * into l from wos.leases where id = new.lease_id;
  if (t.kind = 'payout_audit' and l.task_id = t.id and l.account_id = new.reviewer_account_id and l.state = 'active'
      and exists (select 1 from wos.agent_runs r where r.id = new.agent_run_id and r.lease_id = new.lease_id and r.signature_valid)) is not true then
    raise exception 'wos: a payout-audit verdict needs the reviewer''s active payout_audit lease and a signed run of it' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.payout_audit_verdicts o where o.quorum_id = new.quorum_id and wos.related_accounts(o.reviewer_account_id, new.reviewer_account_id)) then
    raise exception 'wos: related accounts may not fill two seats of one audit quorum' using errcode = 'check_violation';
  end if;
  if q.require_provider_diversity and q.size > 1
     and (select count(*) from wos.payout_audit_verdicts o where o.quorum_id = new.quorum_id) = q.size - 1
     and not exists (select 1 from wos.payout_audit_verdicts o where o.quorum_id = new.quorum_id and o.provider <> new.provider) then
    raise exception 'wos: the last seat of a quorum must add a second provider' using errcode = 'check_violation';
  end if;
  if not q.is_canary then
    select * into c from wos.contribution_receipts where id = q.receipt_id;
    if wos.related_accounts(c.account_id, new.reviewer_account_id) then
      raise exception 'wos: a contributor (or a related account) may not audit this receipt' using errcode = 'check_violation';
    end if;
    select exists (select 1 from wos.contribution_receipts o
                    where wos.related_accounts(o.account_id, new.reviewer_account_id)
                      and o.body ->> 'feature' is not distinct from c.body ->> 'feature' and c.body ->> 'feature' is not null) into on_feature;
    if new.outside_feature and on_feature then
      raise exception 'wos: auditor % has receipts on this feature and cannot fill an outside-feature seat', new.reviewer_account_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger payout_audit_verdicts_check before insert on wos.payout_audit_verdicts
  for each row execute function wos.check_payout_audit_verdict();

-- Public: only real (non-canary) revealed outcomes are published, with the verdict hashes (H11).
create table wos.payout_audit_outcomes (
  quorum_id       uuid primary key references wos.payout_audit_quorums (id),
  receipt_id      uuid not null references wos.contribution_receipts (id),
  outcome         text not null check (outcome in ('ratified', 'findings', 'expired')),
  verdict_sha256s text[] not null,
  published_at    timestamptz not null default now()
);
create or replace function wos.check_payout_audit_outcome() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if not exists (select 1 from wos.payout_audit_quorums q where q.id = new.quorum_id and not q.is_canary and q.receipt_id = new.receipt_id and q.outcome = new.outcome) then
    raise exception 'wos: only a revealed real quorum''s outcome is published' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payout_audit_outcomes_check before insert on wos.payout_audit_outcomes for each row execute function wos.check_payout_audit_outcome();

create table wos.receipt_clips (
  receipt_id           uuid primary key references wos.contribution_receipts (id),
  new_weight_micro     bigint not null check (new_weight_micro >= 0),
  quorum_id            uuid references wos.payout_audit_quorums (id),
  admin_action_id      uuid not null references wos.admin_actions (id),
  auditor_account_ids  uuid[] not null check (cardinality(auditor_account_ids) > 0),
  created_at           timestamptz not null default now()
);
create or replace function wos.check_receipt_clip() returns trigger
language plpgsql as $$
begin
  perform wos.require_admin_action(new.admin_action_id, array['clip_receipt'], 'receipt', new.receipt_id::text);
  if new.new_weight_micro > (select weight_micro from wos.contribution_receipts where id = new.receipt_id) then
    raise exception 'wos: a clip never raises a receipt''s weight' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger receipt_clips_check before insert on wos.receipt_clips for each row execute function wos.check_receipt_clip();

create or replace function wos.effective_weight(r uuid) returns bigint
language sql stable as $$
  select least(c.weight_micro, coalesce((select k.new_weight_micro from wos.receipt_clips k where k.receipt_id = c.id), c.weight_micro))
    from wos.contribution_receipts c where c.id = r
$$;

-- M14: duty is derived from append-only events (offer, then completion / no-fault expiry / decline).
create table wos.duty_events (
  offer_id      uuid not null,
  seq           integer not null check (seq > 0),
  account_id    uuid not null references wos.accounts (id),
  epoch_number  integer not null,
  kind          text not null check (kind in ('offered', 'completed', 'expired_no_fault', 'declined')),
  quorum_id     uuid references wos.payout_audit_quorums (id),
  deadline_at   timestamptz,
  at            timestamptz not null default now(),
  primary key (offer_id, seq),
  check ((kind = 'offered') = (seq = 1)),
  check (kind <> 'offered' or deadline_at is not null)
);
create or replace function wos.check_duty_event() returns trigger
language plpgsql as $$
declare
  first wos.duty_events%rowtype;
begin
  new.at := clock_timestamp();
  if new.seq > 1 then
    select * into first from wos.duty_events where offer_id = new.offer_id and seq = 1;
    if first.account_id is distinct from new.account_id or exists (select 1 from wos.duty_events d where d.offer_id = new.offer_id and d.seq > 1) then
      raise exception 'wos: a duty offer ends exactly once, for the account it was offered to' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger duty_events_check before insert on wos.duty_events for each row execute function wos.check_duty_event();

create table wos.payout_canaries (
  id                    uuid primary key default gen_random_uuid(),
  quorum_id             uuid not null unique references wos.payout_audit_quorums (id),
  packet_id             uuid not null unique,
  line_ref              text not null check (line_ref ~ '^L[0-9]{1,3}$'),
  source_receipt_id     uuid not null references wos.contribution_receipts (id),
  perturbator_version   text not null,
  seed_sha256           text not null check (seed_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  perturbation          text not null check (perturbation in ('inflated_usage', 'padded_repairs', 'context_inflation', 'model_mismatch', 'duplicated_attribution', 'wrong_split')),
  magnitude_bp          integer not null check (magnitude_bp > 0),
  retired_after_epoch   integer not null,
  created_at            timestamptz not null default now()
);
create table wos.payout_canary_outcomes (
  canary_id             uuid not null references wos.payout_canaries (id),
  verdict_id            uuid not null unique references wos.payout_audit_verdicts (id),
  reviewer_account_id   uuid not null references wos.accounts (id),
  caught                boolean not null,      -- judgment AND reason matched the perturbation (H11)
  created_at            timestamptz not null default now(),
  primary key (canary_id, reviewer_account_id)
);

-- ============================================================================================
-- 10. Manifests, proposed allocations (per receipt and beneficiary), final entitlements, claim leaves, settlement
-- ============================================================================================
create table wos.epoch_manifest_entries (
  epoch_number     integer not null references wos.epochs (epoch_number),
  mode             text not null check (mode in ('test', 'live')),
  receipt_id       uuid not null references wos.contribution_receipts (id),
  receipt_sha256   text not null,
  disposition      text not null check (disposition in ('included', 'deferred', 'revoked')),
  deferral_count   integer not null check (deferral_count between 0 and 2),
  created_at       timestamptz not null default now(),
  primary key (epoch_number, receipt_id)
);
create unique index epoch_manifest_once on wos.epoch_manifest_entries (receipt_id, mode) where disposition = 'included';

-- H2: every epoch write takes the same lock as the epoch transitions, so nothing lands after publication.
create or replace function wos.lock_epoch_calculating(e integer) returns void
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.epoch:' || e::text));
  if (wos.epoch_state(e) = 'CALCULATING') is not true then
    raise exception 'wos: epoch % is %, not CALCULATING (written once, before publication)', e, coalesce(wos.epoch_state(e), 'undefined')
      using errcode = 'check_violation';
  end if;
end $$;

create or replace function wos.check_manifest_entry() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  ep_mode text;
  st text;
begin
  perform wos.lock_epoch_calculating(new.epoch_number);
  select mode into ep_mode from wos.epochs where epoch_number = new.epoch_number;
  if new.mode <> ep_mode then
    raise exception 'wos: manifest mode % differs from epoch mode %', new.mode, ep_mode using errcode = 'check_violation';
  end if;
  st := wos.receipt_status(new.receipt_id);
  if new.disposition = 'included' and not (st in ('ACTIVE', 'RATIFIED') or (ep_mode = 'test' and st <> 'REVOKED')) then
    raise exception 'wos: a % receipt cannot be included in a % epoch', st, ep_mode using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger epoch_manifest_check before insert on wos.epoch_manifest_entries for each row execute function wos.check_manifest_entry();

-- Proposed allocations: immutable, published at PROPOSED, one line per (receipt, beneficiary) or per payout.
create table wos.allocations (
  id                uuid primary key,
  epoch_number      integer not null references wos.epochs (epoch_number),
  mode              text not null check (mode in ('test', 'live')),
  account_id        uuid references wos.accounts (id),              -- the contributor (null for bounties/pool lines)
  beneficiary_kind  text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id    uuid not null,
  receipt_id        uuid references wos.contribution_receipts (id),
  slice             text not null check (slice in ('execution', 'planning', 'human_review', 'outcomes', 'completion_payout', 'security_payout', 'dispute_bounty', 'recovery_bounty')),
  pool_key          text,
  weight_micro      bigint not null check (weight_micro >= 0),
  amount_base       bigint not null check (amount_base >= 0),
  explanation       jsonb not null,
  explanation_sha256 text not null check (explanation_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at        timestamptz not null default now(),
  check ((slice in ('execution', 'planning', 'human_review', 'outcomes')) = (receipt_id is not null and account_id is not null) or slice = 'security_payout')
);
create unique index allocations_receipt_once on wos.allocations (receipt_id, mode, beneficiary_id, slice) where receipt_id is not null;

create or replace function wos.check_allocation() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  c wos.contribution_receipts%rowtype;
begin
  perform wos.lock_epoch_calculating(new.epoch_number);
  if new.mode <> (select mode from wos.epochs where epoch_number = new.epoch_number) then
    raise exception 'wos: allocation mode differs from its epoch' using errcode = 'check_violation';
  end if;
  if new.receipt_id is not null and new.slice <> 'security_payout' then
    select * into c from wos.contribution_receipts where id = new.receipt_id;
    -- H2: the receipt is in THIS epoch's manifest, the slice is the receipt's, and the beneficiary is its own.
    if not exists (select 1 from wos.epoch_manifest_entries m where m.epoch_number = new.epoch_number and m.receipt_id = new.receipt_id and m.disposition = 'included') then
      raise exception 'wos: receipt % is not included in epoch %', new.receipt_id, new.epoch_number using errcode = 'check_violation';
    end if;
    if (new.slice = c.slice and new.account_id = c.account_id
        and ((new.beneficiary_kind = 'person' and new.beneficiary_id = c.account_id and c.beneficiary_org_share_bp < 10000)
          or (new.beneficiary_kind = 'organization' and new.beneficiary_id = c.beneficiary_org_id and c.beneficiary_org_share_bp > 0))) is not true then
      raise exception 'wos: allocation of receipt % must use its slice, contributor and beneficiary', new.receipt_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger allocations_check before insert on wos.allocations for each row execute function wos.check_allocation();

create table wos.anomaly_metrics (
  epoch_number   integer not null references wos.epochs (epoch_number),
  beneficiary_id uuid not null,
  metrics        jsonb not null,
  rank_score     bigint not null,
  created_at     timestamptz not null default now(),
  primary key (epoch_number, beneficiary_id)
);
create or replace function wos.check_anomaly_metrics() returns trigger
language plpgsql as $$
begin
  perform wos.lock_epoch_calculating(new.epoch_number);
  return new;
end $$;
create trigger anomaly_metrics_check before insert on wos.anomaly_metrics for each row execute function wos.check_anomaly_metrics();

-- Final entitlements (H2), per beneficiary: written from FINALIZED on (undisputed) or when a gate resolves.
create table wos.entitlements (
  id                uuid primary key default gen_random_uuid(),
  epoch_number      integer not null references wos.epochs (epoch_number),
  beneficiary_kind  text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id    uuid not null,
  kind              text not null check (kind in ('release_now', 'holdback_tranche', 'holdback_matured', 'bounty', 'genesis_vesting', 'withheld_release')),
  amount_base       bigint not null check (amount_base > 0),
  source_tranche_id uuid unique references wos.entitlements (id),     -- a matured release names its tranche, once
  withheld_epochs   integer not null default 0 check (withheld_epochs >= 0),
  flags             text[] not null default '{}',
  created_at        timestamptz not null default now(),
  check ((kind = 'holdback_matured') = (source_tranche_id is not null)),
  check (flags <@ array['unaudited', 'released_after_dispute']::text[])
);
create or replace function wos.check_entitlement() returns trigger
language plpgsql as $$
declare
  t wos.entitlements%rowtype;
begin
  new.created_at := clock_timestamp();
  if (wos.epoch_state(new.epoch_number) in ('FINALIZED', 'DISTRIBUTABLE', 'CLOSED')) is not true and new.kind <> 'genesis_vesting' then
    raise exception 'wos: entitlements exist only once epoch % is FINALIZED', new.epoch_number using errcode = 'check_violation';
  end if;
  if new.kind = 'holdback_matured' then
    select * into t from wos.entitlements where id = new.source_tranche_id;
    if (t.kind = 'holdback_tranche' and t.beneficiary_id = new.beneficiary_id and t.amount_base >= new.amount_base) is not true then
      raise exception 'wos: a matured release must name a tranche of the same beneficiary' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger entitlements_check before insert on wos.entitlements for each row execute function wos.check_entitlement();

-- A claim turns claimable entitlements into ONE leaf for the beneficiary's currently bound wallet.
create table wos.claim_leaves (
  id                  uuid primary key default gen_random_uuid(),
  cluster             text not null check (cluster in ('devnet', 'mainnet-beta')),
  beneficiary_kind    text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id      uuid not null,
  wallet              text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount_base         bigint not null check (amount_base > 0),
  adapter_generation  integer not null check (adapter_generation > 0),
  leaf_sha256         text not null check (leaf_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at          timestamptz not null default now()
);
create or replace function wos.check_claim_leaf() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  new.created_at := clock_timestamp();
  if not exists (select 1 from wos.wallet_registry r where r.cluster = new.cluster and r.wallet = new.wallet
                  and r.beneficiary_kind = new.beneficiary_kind and r.beneficiary_id = new.beneficiary_id) then
    raise exception 'wos: the wallet is not currently bound to this beneficiary' using errcode = 'check_violation';
  end if;
  if new.adapter_generation <> wos.adapter_generation() then
    raise exception 'wos: leaves are created for the current settlement adapter generation only' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger claim_leaves_check before insert on wos.claim_leaves for each row execute function wos.check_claim_leaf();

create table wos.leaf_voids (
  leaf_id          uuid primary key references wos.claim_leaves (id),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);

create table wos.entitlement_claims (
  entitlement_id  uuid not null references wos.entitlements (id),
  leaf_id         uuid not null references wos.claim_leaves (id),
  primary key (entitlement_id, leaf_id)
);
create or replace function wos.check_entitlement_claim() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  e wos.entitlements%rowtype;
  l wos.claim_leaves%rowtype;
begin
  select * into e from wos.entitlements where id = new.entitlement_id;
  select * into l from wos.claim_leaves where id = new.leaf_id;
  if e.kind = 'holdback_tranche' then
    raise exception 'wos: a holdback tranche is claimable only through its matured release' using errcode = 'check_violation';
  end if;
  if e.beneficiary_id <> l.beneficiary_id or e.beneficiary_kind <> l.beneficiary_kind then
    raise exception 'wos: entitlement and leaf beneficiaries differ' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.entitlement_claims x where x.entitlement_id = new.entitlement_id
              and not exists (select 1 from wos.leaf_voids v where v.leaf_id = x.leaf_id)) then
    raise exception 'wos: entitlement % is already in a live leaf', new.entitlement_id using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.confiscation_sources s where s.source_id = new.entitlement_id::text) then
    raise exception 'wos: entitlement % was confiscated', new.entitlement_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger entitlement_claims_check before insert on wos.entitlement_claims for each row execute function wos.check_entitlement_claim();

-- H3: the signed transaction is persisted BEFORE broadcast; one active attempt per leaf; a replacement only after a
-- history-checked "expired, never landed"; confirmation only at finalized commitment.
create table wos.settlement_attempts (
  leaf_id                 uuid not null references wos.claim_leaves (id),
  attempt                 integer not null check (attempt > 0),
  adapter_generation      integer not null,
  signed_tx               bytea not null,
  signed_tx_sha256        text not null check (signed_tx_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature               text not null unique,
  last_valid_block_height bigint not null check (last_valid_block_height >= 0),
  persisted_at            timestamptz not null default now(),
  primary key (leaf_id, attempt)
);
create table wos.settlement_outcomes (
  leaf_id          uuid not null,
  attempt          integer not null,
  outcome          text not null check (outcome in ('confirmed', 'expired_not_landed', 'failed_before_broadcast')),
  commitment       text check (commitment in ('processed', 'confirmed', 'finalized')),
  history_checked  boolean not null default false,
  slot             bigint,
  at               timestamptz not null default now(),
  primary key (leaf_id, attempt),
  foreign key (leaf_id, attempt) references wos.settlement_attempts (leaf_id, attempt),
  check (outcome <> 'confirmed' or commitment = 'finalized'),
  check (outcome <> 'expired_not_landed' or history_checked)
);
create unique index settlement_one_confirmed on wos.settlement_outcomes (leaf_id) where outcome = 'confirmed';

create or replace function wos.check_settlement_attempt() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  l wos.claim_leaves%rowtype;
  claimed bigint;
begin
  perform pg_advisory_xact_lock(hashtext('wos.leaf:' || new.leaf_id::text));
  new.persisted_at := clock_timestamp();
  select * into l from wos.claim_leaves where id = new.leaf_id;
  if exists (select 1 from wos.leaf_voids v where v.leaf_id = new.leaf_id) then
    raise exception 'wos: leaf % is void', new.leaf_id using errcode = 'check_violation';
  end if;
  if wos.settlement_paused() or new.adapter_generation <> wos.adapter_generation() or l.adapter_generation <> new.adapter_generation then
    raise exception 'wos: settlement is paused or this adapter generation is fenced' using errcode = 'check_violation';
  end if;
  select coalesce(sum(e.amount_base), 0) into claimed from wos.entitlement_claims x join wos.entitlements e on e.id = x.entitlement_id where x.leaf_id = new.leaf_id;
  if claimed <> l.amount_base then
    raise exception 'wos: leaf amount % differs from its claimed entitlements %', l.amount_base, claimed using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.settlement_outcomes o where o.leaf_id = new.leaf_id and o.outcome = 'confirmed') then
    raise exception 'wos: leaf % is already settled', new.leaf_id using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.settlement_attempts a where a.leaf_id = new.leaf_id
              and not exists (select 1 from wos.settlement_outcomes o where o.leaf_id = a.leaf_id and o.attempt = a.attempt)) then
    raise exception 'wos: leaf % has an unresolved attempt (rebroadcast the same bytes instead)', new.leaf_id using errcode = 'check_violation';
  end if;
  if new.attempt <> coalesce((select max(attempt) from wos.settlement_attempts where leaf_id = new.leaf_id), 0) + 1 then
    raise exception 'wos: attempts are numbered contiguously' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger settlement_attempts_check before insert on wos.settlement_attempts for each row execute function wos.check_settlement_attempt();

create table wos.offsets (
  id               uuid primary key default gen_random_uuid(),
  beneficiary_kind text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id   uuid not null,
  receipt_id       uuid references wos.contribution_receipts (id),
  amount_base      bigint not null check (amount_base > 0),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);
create or replace function wos.check_offset() returns trigger
language plpgsql as $$
begin
  perform wos.require_admin_action(new.admin_action_id, array['record_offset', 'confiscate'], 'beneficiary', new.beneficiary_id::text);
  return new;
end $$;
create trigger offsets_check before insert on wos.offsets for each row execute function wos.check_offset();

-- ============================================================================================
-- 10b. Optimistic payouts: acceptances, atomic dispute bundles, gates, replies, resolutions, appeals (H10, D43)
-- ============================================================================================
create table wos.allocation_acceptances (
  epoch_number      integer not null references wos.epochs (epoch_number),
  account_id        uuid not null references wos.accounts (id),
  allocations_root  text not null check (allocations_root ~ '^sha256:[0-9a-f]{64}$'),
  created_at        timestamptz not null default now(),
  primary key (epoch_number, account_id)
);

create table wos.allocation_disputes (
  id                   uuid primary key default gen_random_uuid(),
  epoch_number         integer not null references wos.epochs (epoch_number),
  disputer_account_id  uuid not null references wos.accounts (id),
  stake_base           bigint not null check (stake_base > 0),
  note_untrusted       text not null default '' check (length(note_untrusted) <= 4000),
  shared_evidence      jsonb not null default '[]',
  body                 jsonb not null,           -- AllocationDispute: body.items is the frozen bundle
  opened_at            timestamptz not null default now()
);

create table wos.dispute_gates (
  allocation_id        uuid primary key references wos.allocations (id),
  priority_dispute_id  uuid references wos.allocation_disputes (id),   -- null while only related parties disputed
  reply_deadline_at    timestamptz not null,
  created_at           timestamptz not null default now()
);

create table wos.dispute_items (
  dispute_id           uuid not null references wos.allocation_disputes (id),
  allocation_id        uuid not null references wos.allocations (id),
  reason               text not null check (reason in ('inflated_usage', 'padded_repairs', 'context_inflation', 'model_misreported', 'misattribution', 'duplicate_work', 'split_gaming', 'other')),
  evidence             jsonb not null,
  proposed_amount_base bigint check (proposed_amount_base >= 0),
  stake_base           bigint not null check (stake_base > 0),
  created_at           timestamptz not null default now(),
  primary key (dispute_id, allocation_id)
);

-- The header fixes time, window, standing, quota (serialized) and the per-item stakes; its AFTER trigger inserts the
-- frozen bundle atomically. Items cannot be added later or by anyone else.
create or replace function wos.check_allocation_dispute() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  ep wos.epochs%rowtype;
  n_items integer;
  pending bigint;
  each_stake bigint;
  bp_part bigint;
  cap_part bigint;
begin
  new.opened_at := clock_timestamp();
  perform pg_advisory_xact_lock(hashtext('wos.dispute_quota:' || new.epoch_number::text || ':' || new.disputer_account_id::text));
  select * into ep from wos.epochs where epoch_number = new.epoch_number;
  if (wos.epoch_state(new.epoch_number) = 'PROPOSED'
      and new.opened_at < wos.epoch_state_at(new.epoch_number, 'PROPOSED') + make_interval(hours => ep.challenge_hours)) is not true then
    raise exception 'wos: disputes are accepted only while epoch % is PROPOSED and its window is open', new.epoch_number using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount_base), 0) into pending from wos.allocations a
   where a.epoch_number = new.epoch_number and a.beneficiary_kind = 'person' and a.beneficiary_id = new.disputer_account_id;
  if pending = 0 then
    raise exception 'wos: only participants of epoch % may dispute its allocations', new.epoch_number using errcode = 'check_violation';
  end if;
  if (select count(*) from wos.allocation_disputes d where d.epoch_number = new.epoch_number and d.disputer_account_id = new.disputer_account_id)
     >= ep.max_disputes_per_account then
    raise exception 'wos: dispute rate limit reached for epoch %', new.epoch_number using errcode = 'check_violation';
  end if;
  n_items := coalesce(jsonb_array_length(new.body -> 'items'), 0);
  if n_items < 1 or n_items > ep.max_items_per_dispute then
    raise exception 'wos: a dispute carries 1..% items, frozen at submission', ep.max_items_per_dispute using errcode = 'check_violation';
  end if;
  bp_part := pending * ep.stake_per_item_bp / 10000;
  cap_part := pending * ep.max_stake_bp / 10000 / n_items;
  each_stake := greatest(ep.min_stake_base, least(bp_part, cap_part));
  if each_stake * n_items > pending then
    raise exception 'wos: the stakes of % items exceed the disputer''s pending allocation', n_items using errcode = 'check_violation';
  end if;
  if new.stake_base <> each_stake * n_items then
    raise exception 'wos: stake must be % (% per item)', each_stake * n_items, each_stake using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger allocation_disputes_check before insert on wos.allocation_disputes for each row execute function wos.check_allocation_dispute();

create or replace function wos.insert_dispute_bundle() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  it jsonb;
begin
  perform set_config('wos.dispute_bundle', new.id::text, true);
  for it in select * from jsonb_array_elements(new.body -> 'items') loop
    insert into wos.dispute_items (dispute_id, allocation_id, reason, evidence, proposed_amount_base, stake_base)
    values (new.id, (it ->> 'allocationId')::uuid, it ->> 'reason', coalesce(it -> 'evidence', '[]'::jsonb),
            (it ->> 'proposedAmountBase')::bigint, new.stake_base / jsonb_array_length(new.body -> 'items'));
  end loop;
  perform set_config('wos.dispute_bundle', '', true);
  return new;
end $$;
create trigger allocation_disputes_bundle after insert on wos.allocation_disputes for each row execute function wos.insert_dispute_bundle();

create or replace function wos.check_dispute_item() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.allocation_disputes%rowtype;
  a wos.allocations%rowtype;
  ep wos.epochs%rowtype;
  related boolean;
begin
  if current_setting('wos.dispute_bundle', true) is distinct from new.dispute_id::text then
    raise exception 'wos: dispute items are inserted only with their dispute (frozen bundle)' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := clock_timestamp();
  select * into d from wos.allocation_disputes where id = new.dispute_id;
  select * into a from wos.allocations where id = new.allocation_id;
  select * into ep from wos.epochs where epoch_number = d.epoch_number;
  if a.epoch_number is distinct from d.epoch_number then
    raise exception 'wos: a dispute covers allocations of its own epoch only' using errcode = 'check_violation';
  end if;
  if a.account_id = d.disputer_account_id or a.beneficiary_id = d.disputer_account_id then
    raise exception 'wos: one cannot dispute one''s own allocation' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.dispute_item_resolutions r where r.allocation_id = new.allocation_id) then
    raise exception 'wos: allocation % is already resolved' , new.allocation_id using errcode = 'check_violation';
  end if;
  related := a.account_id is not null and wos.related_accounts(a.account_id, d.disputer_account_id);
  insert into wos.dispute_gates (allocation_id, priority_dispute_id, reply_deadline_at)
  values (new.allocation_id, case when related then null else new.dispute_id end, clock_timestamp() + make_interval(hours => ep.reply_hours))
  on conflict (allocation_id) do update set priority_dispute_id = excluded.priority_dispute_id
    where wos.dispute_gates.priority_dispute_id is null and excluded.priority_dispute_id is not null;
  return new;
end $$;
create trigger dispute_items_check before insert on wos.dispute_items for each row execute function wos.check_dispute_item();

-- Gates change only once: a null bounty priority may be taken by the first UNRELATED disputer (D43).
create or replace function wos.dispute_gate_rules() returns trigger
language plpgsql as $$
begin
  if old.priority_dispute_id is not null or new.allocation_id <> old.allocation_id or new.reply_deadline_at <> old.reply_deadline_at then
    raise exception 'wos: a gate''s priority is set once and nothing else changes' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_gates_rules before update on wos.dispute_gates for each row execute function wos.dispute_gate_rules();
create trigger dispute_gates_no_delete before delete or truncate on wos.dispute_gates for each statement execute function wos.forbid_mutation();

create table wos.dispute_replies (
  allocation_id    uuid not null references wos.dispute_gates (allocation_id),
  account_id       uuid not null references wos.accounts (id),
  body_untrusted   text not null check (length(body_untrusted) <= 4000),
  evidence         jsonb not null default '[]',
  created_at       timestamptz not null default now(),
  primary key (allocation_id, created_at)
);
create or replace function wos.check_dispute_reply() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  new.created_at := clock_timestamp();
  if new.account_id is distinct from (select account_id from wos.allocations where id = new.allocation_id) then
    raise exception 'wos: only the accused may reply' using errcode = 'check_violation';
  end if;
  if new.created_at > (select reply_deadline_at from wos.dispute_gates where allocation_id = new.allocation_id) then
    raise exception 'wos: the right-of-reply window has closed' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_replies_check before insert on wos.dispute_replies for each row execute function wos.check_dispute_reply();

create table wos.dispute_item_resolutions (
  allocation_id          uuid primary key references wos.dispute_gates (allocation_id),
  outcome                text not null check (outcome in ('UPHELD', 'CLIPPED', 'REVOKED')),
  quorum_id              uuid references wos.payout_audit_quorums (id),
  admin_action_id        uuid references wos.admin_actions (id),
  resulting_amount_base  bigint not null check (resulting_amount_base >= 0),
  excess_base            bigint not null check (excess_base >= 0),
  recovered_base         bigint not null check (recovered_base >= 0),
  resolved_at            timestamptz not null default now(),
  check (quorum_id is not null or admin_action_id is not null),
  check ((outcome = 'UPHELD') = (excess_base = 0)),
  check (outcome <> 'REVOKED' or resulting_amount_base = 0),
  check (recovered_base <= excess_base)
);
create or replace function wos.check_dispute_resolution() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  new.resolved_at := clock_timestamp();
  if new.resolved_at < (select reply_deadline_at from wos.dispute_gates where allocation_id = new.allocation_id)
     and not exists (select 1 from wos.dispute_replies r where r.allocation_id = new.allocation_id) then
    raise exception 'wos: a gate resolves after the reply (or its window)' using errcode = 'check_violation';
  end if;
  if new.resulting_amount_base + new.excess_base <> (select amount_base from wos.allocations where id = new.allocation_id) then
    raise exception 'wos: resulting amount + excess must equal the proposed amount' using errcode = 'check_violation';
  end if;
  if new.admin_action_id is not null then
    perform wos.require_admin_action(new.admin_action_id, array['resolve_dispute'], 'allocation', new.allocation_id::text);
  elsif not exists (select 1 from wos.payout_audit_quorums q join wos.allocations a on a.id = new.allocation_id
                     where q.id = new.quorum_id and q.receipt_id = a.receipt_id and q.purpose = 'dispute_gate' and q.outcome is not null) then
    raise exception 'wos: the gate''s quorum for this allocation has not revealed' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_item_resolutions_check before insert on wos.dispute_item_resolutions
  for each row execute function wos.check_dispute_resolution();

-- One appeal per resolved allocation, by the accused or the priority disputer, within the appeal window (D43).
create table wos.dispute_appeals (
  allocation_id         uuid primary key references wos.dispute_item_resolutions (allocation_id),
  appellant_account_id  uuid not null references wos.accounts (id),
  statement_untrusted   text not null check (length(statement_untrusted) between 20 and 4000),
  created_at            timestamptz not null default now()
);
create or replace function wos.check_dispute_appeal() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  a wos.allocations%rowtype;
  g wos.dispute_gates%rowtype;
begin
  new.created_at := clock_timestamp();
  select * into a from wos.allocations where id = new.allocation_id;
  select * into g from wos.dispute_gates where allocation_id = new.allocation_id;
  if not (new.appellant_account_id = a.account_id
          or new.appellant_account_id = (select disputer_account_id from wos.allocation_disputes where id = g.priority_dispute_id)) then
    raise exception 'wos: only the accused or the priority disputer may appeal' using errcode = 'check_violation';
  end if;
  if new.created_at > (select resolved_at from wos.dispute_item_resolutions where allocation_id = new.allocation_id)
                      + make_interval(hours => (select appeal_hours from wos.epochs where epoch_number = a.epoch_number)) then
    raise exception 'wos: the appeal window has closed' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_appeals_check before insert on wos.dispute_appeals for each row execute function wos.check_dispute_appeal();

create table wos.dispute_appeal_decisions (
  allocation_id          uuid primary key references wos.dispute_appeals (allocation_id),
  decision               text not null check (decision in ('confirmed', 'reversed')),
  final_amount_base      bigint not null check (final_amount_base >= 0),
  admin_action_id        uuid not null references wos.admin_actions (id),
  created_at             timestamptz not null default now()
);
create or replace function wos.check_appeal_decision() returns trigger
language plpgsql as $$
begin
  perform wos.require_admin_action(new.admin_action_id, array['decide_appeal'], 'allocation', new.allocation_id::text);
  return new;
end $$;
create trigger dispute_appeal_decisions_check before insert on wos.dispute_appeal_decisions for each row execute function wos.check_appeal_decision();

-- Settlement is DERIVED (H10): excess and recovered from gates this dispute holds priority on; bounty from recovered
-- only (D41); stakes forfeited per rejected item (D43); every item resolved and no appeal pending.
create table wos.dispute_settlements (
  dispute_id             uuid primary key references wos.allocation_disputes (id),
  total_excess_base      bigint not null check (total_excess_base >= 0),
  recovered_base         bigint not null check (recovered_base >= 0),
  bounty_base            bigint not null check (bounty_base >= 0),
  stake_forfeited_base   bigint not null check (stake_forfeited_base >= 0),
  settled_in_epoch       integer not null references wos.epochs (epoch_number),
  created_at             timestamptz not null default now()
);
create or replace function wos.check_dispute_settlement() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.allocation_disputes%rowtype;
  ex bigint;
  rec bigint;
  forfeit bigint;
begin
  select * into d from wos.allocation_disputes where id = new.dispute_id;
  if exists (select 1 from wos.dispute_items i where i.dispute_id = new.dispute_id
              and not exists (select 1 from wos.dispute_item_resolutions r where r.allocation_id = i.allocation_id)) then
    raise exception 'wos: every item of the dispute must be resolved first' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.dispute_items i join wos.dispute_appeals ap on ap.allocation_id = i.allocation_id
              where i.dispute_id = new.dispute_id and not exists (select 1 from wos.dispute_appeal_decisions x where x.allocation_id = ap.allocation_id)) then
    raise exception 'wos: an appeal of this dispute is pending' using errcode = 'check_violation';
  end if;
  select coalesce(sum(r.excess_base), 0), coalesce(sum(r.recovered_base), 0) into ex, rec
    from wos.dispute_gates g join wos.dispute_item_resolutions r on r.allocation_id = g.allocation_id
   where g.priority_dispute_id = new.dispute_id;
  select coalesce(sum(i.stake_base), 0) into forfeit
    from wos.dispute_items i join wos.dispute_item_resolutions r on r.allocation_id = i.allocation_id
   where i.dispute_id = new.dispute_id and r.outcome = 'UPHELD';
  if new.total_excess_base <> ex or new.recovered_base <> rec or new.stake_forfeited_base <> forfeit
     or new.bounty_base * 10000 > rec * (select bounty_bp_of_recovered from wos.epochs where epoch_number = d.epoch_number) then
    raise exception 'wos: settlement must equal the derived values (excess %, recovered %, forfeited %, bounty <= % bp of recovered)',
      ex, rec, forfeit, (select bounty_bp_of_recovered from wos.epochs where epoch_number = d.epoch_number) using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_settlements_check before insert on wos.dispute_settlements for each row execute function wos.check_dispute_settlement();

-- ============================================================================================
-- 10c. Confiscation after proven cheating and exclusions (D39) — each source consumed once
-- ============================================================================================
create table wos.confiscations (
  id                 uuid primary key default gen_random_uuid(),
  beneficiary_kind   text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id     uuid not null,
  proven_excess_base bigint not null check (proven_excess_base > 0),
  finding_ref        text not null,
  admin_action_id    uuid not null references wos.admin_actions (id),
  notice_at          timestamptz not null default now(),
  reply_closes_at    timestamptz not null,
  appeal_closes_at   timestamptz not null,
  check (appeal_closes_at >= reply_closes_at)
);
create or replace function wos.check_confiscation() returns trigger
language plpgsql as $$
begin
  new.notice_at := clock_timestamp();
  if new.reply_closes_at < new.notice_at + interval '72 hours' or new.appeal_closes_at < new.reply_closes_at + interval '168 hours' then
    raise exception 'wos: confiscation needs >= 72 h reply and >= 168 h appeal windows after notice' using errcode = 'check_violation';
  end if;
  perform wos.require_admin_action(new.admin_action_id, array['confiscate'], 'confiscation', new.id::text);
  return new;
end $$;
create trigger confiscations_check before insert on wos.confiscations for each row execute function wos.check_confiscation();

create table wos.confiscation_appeal_decisions (
  confiscation_id  uuid primary key references wos.confiscations (id),
  decision         text not null check (decision in ('upheld', 'overturned')),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);

create table wos.confiscation_sources (
  confiscation_id  uuid not null references wos.confiscations (id),
  source_kind      text not null check (source_kind in ('pending_allocation', 'holdback', 'unclaimed_entitlement', 'genesis_unvested')),
  source_id        text not null,
  amount_base      bigint not null check (amount_base > 0),
  created_at       timestamptz not null default now(),
  primary key (source_kind, source_id)                 -- every source is consumed exactly once
);
create or replace function wos.check_confiscation_source() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  c wos.confiscations%rowtype;
  e wos.entitlements%rowtype;
  a wos.allocations%rowtype;
  decided text;
begin
  select * into c from wos.confiscations where id = new.confiscation_id;
  select decision into decided from wos.confiscation_appeal_decisions where confiscation_id = c.id;
  if decided = 'overturned' or (decided is null and clock_timestamp() < c.appeal_closes_at) then
    raise exception 'wos: confiscation executes only after the appeal window (or an upheld appeal)' using errcode = 'check_violation';
  end if;
  if (select coalesce(sum(amount_base), 0) from wos.confiscation_sources s where s.confiscation_id = c.id) + new.amount_base > c.proven_excess_base then
    raise exception 'wos: confiscation never exceeds the proven excess' using errcode = 'check_violation';
  end if;
  if new.source_kind = 'pending_allocation' then
    select * into a from wos.allocations where id = new.source_id::uuid;
    if (a.beneficiary_id = c.beneficiary_id and a.amount_base >= new.amount_base
        and wos.epoch_state(a.epoch_number) in ('CALCULATING', 'PROPOSED')) is not true then
      raise exception 'wos: a pending allocation source must be the beneficiary''s, unpublished-final and large enough' using errcode = 'check_violation';
    end if;
  elsif new.source_kind in ('holdback', 'unclaimed_entitlement', 'genesis_unvested') then
    select * into e from wos.entitlements where id = new.source_id::uuid;
    if (e.beneficiary_id = c.beneficiary_id and e.amount_base >= new.amount_base
        and ((new.source_kind = 'holdback' and e.kind = 'holdback_tranche'
              and not exists (select 1 from wos.entitlements m where m.source_tranche_id = e.id))
          or (new.source_kind = 'unclaimed_entitlement' and e.kind in ('release_now', 'holdback_matured', 'bounty', 'withheld_release')
              and not exists (select 1 from wos.entitlement_claims x where x.entitlement_id = e.id
                               and not exists (select 1 from wos.leaf_voids v where v.leaf_id = x.leaf_id)))
          or (new.source_kind = 'genesis_unvested' and e.kind = 'genesis_vesting'))) is not true then
      raise exception 'wos: the source is not an unreleased, unclaimed entitlement of this beneficiary' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger confiscation_sources_check before insert on wos.confiscation_sources for each row execute function wos.check_confiscation_source();

create table wos.exclusions (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references wos.accounts (id),
  scope                   text[] not null check (scope <@ array['rewards', 'voting', 'review', 'duty']::text[] and cardinality(scope) > 0),
  until_epoch             integer,                                   -- null = permanent
  governance_proposal_id  uuid,
  admin_action_id         uuid not null references wos.admin_actions (id),
  created_at              timestamptz not null default now()
);
create or replace function wos.check_exclusion() returns trigger
language plpgsql as $$
begin
  perform wos.require_admin_action(new.admin_action_id, array['exclude'], 'account', new.account_id::text);
  -- Permanent exclusion needs a structural governance vote once governance is active (founder AdminAction before).
  if new.until_epoch is null and new.governance_proposal_id is null and not wos.bootstrap_on() then
    raise exception 'wos: a permanent exclusion needs a governance decision' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger exclusions_check before insert on wos.exclusions for each row execute function wos.check_exclusion();

-- ============================================================================================
-- 11. Wallet bindings (append-only log) + a privileged wallet registry for uniqueness (H9)
-- ============================================================================================
create table wos.wallet_bindings (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references wos.accounts (id),       -- the person acting (for an org: an owner/admin)
  organization_id      uuid references wos.organizations (id),          -- set when binding the org's beneficiary wallet
  cluster              text not null check (cluster in ('devnet', 'mainnet-beta')),
  wallet               text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  kind                 text not null check (kind in ('external', 'cli_keypair', 'multisig_pda')),
  action               text not null check (action in ('bind', 'unbind')),
  message              text not null,
  signature            text,
  multisig_tx_signature text,
  controllers          uuid[] not null default '{}',
  created_at           timestamptz not null default now(),
  check ((kind = 'multisig_pda') = (multisig_tx_signature is not null and signature is null)),
  check (kind = 'multisig_pda' or signature is not null),
  check (kind <> 'multisig_pda' or organization_id is not null)
);

create table wos.wallet_registry (
  cluster           text not null,
  wallet            text not null,
  beneficiary_kind  text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id    uuid not null,
  bound_at          timestamptz not null default now(),
  primary key (cluster, wallet),
  unique (cluster, beneficiary_kind, beneficiary_id)
);

create or replace function wos.apply_wallet_binding() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  bk text := case when new.organization_id is null then 'person' else 'organization' end;
  bid uuid := coalesce(new.organization_id, new.account_id);
begin
  new.created_at := clock_timestamp();
  perform pg_advisory_xact_lock(hashtext('wos.wallet:' || new.cluster || ':' || new.wallet));
  if position(new.wallet in new.message) = 0 or position(new.account_id::text in new.message) = 0
     or (new.organization_id is not null and position(new.organization_id::text in new.message) = 0) then
    raise exception 'wos: the signed message must name the wallet, the account and (for orgs) the organization' using errcode = 'check_violation';
  end if;
  if new.organization_id is not null and not exists (select 1 from wos.memberships m where m.organization_id = new.organization_id
                                                     and m.account_id = new.account_id and m.role in ('owner', 'admin')) then
    raise exception 'wos: only an owner or admin binds an organization wallet' using errcode = 'check_violation';
  end if;
  if new.action = 'bind' then
    insert into wos.wallet_registry (cluster, wallet, beneficiary_kind, beneficiary_id) values (new.cluster, new.wallet, bk, bid);
  else
    delete from wos.wallet_registry r where r.cluster = new.cluster and r.wallet = new.wallet and r.beneficiary_kind = bk and r.beneficiary_id = bid;
    if not found then
      raise exception 'wos: only the bound beneficiary may unbind this wallet' using errcode = 'check_violation';
    end if;
  end if;
  return new;
exception when unique_violation then
  raise exception 'wos: wallet or beneficiary is already bound (one wallet per beneficiary per cluster)' using errcode = 'check_violation';
end $$;
create trigger wallet_bindings_apply before insert on wos.wallet_bindings for each row execute function wos.apply_wallet_binding();

-- ============================================================================================
-- 12. Completion pools: kinds, frozen definitions, corrections, one terminal disposition (H13)
-- ============================================================================================
create table wos.completion_pools (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('feature', 'application')),
  pool_key    text not null unique,
  created_at  timestamptz not null default now()
);
create table wos.completion_definitions (
  pool_id              uuid not null references wos.completion_pools (id),
  definition_version   integer not null check (definition_version > 0),
  body                 jsonb not null,
  definition_sha256    text not null check (definition_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  frozen_at            timestamptz not null default now(),
  primary key (pool_id, definition_version)
);
create table wos.pool_accruals (
  pool_id       uuid not null references wos.completion_pools (id),
  epoch_number  integer not null references wos.epochs (epoch_number),
  amount_base   bigint not null check (amount_base > 0),
  primary key (pool_id, epoch_number)
);
-- Accrual attributed to work later clipped or revoked is corrected back to the reserve (engine accrualCorrections).
create table wos.pool_accrual_corrections (
  id               uuid primary key default gen_random_uuid(),
  pool_id          uuid not null references wos.completion_pools (id),
  receipt_id       uuid not null references wos.contribution_receipts (id),
  amount_base      bigint not null check (amount_base > 0),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now(),
  unique (pool_id, receipt_id)
);
create or replace function wos.check_accrual_correction() returns trigger
language plpgsql as $$
begin
  perform wos.require_admin_action(new.admin_action_id, array['correct_accrual', 'clip_receipt', 'invalidate_receipt'], 'receipt', new.receipt_id::text);
  return new;
end $$;
create trigger pool_accrual_corrections_check before insert on wos.pool_accrual_corrections for each row execute function wos.check_accrual_correction();

create table wos.pool_events (
  pool_id              uuid not null references wos.completion_pools (id),
  event                text not null check (event in ('payable', 'paid', 'returned')),
  epoch_number         integer not null references wos.epochs (epoch_number),
  definition_version   integer,
  amount_base          bigint not null check (amount_base >= 0),
  created_at           timestamptz not null default now(),
  primary key (pool_id, event)
);
create unique index pool_events_one_terminal on wos.pool_events (pool_id) where event in ('paid', 'returned');
create or replace function wos.check_pool_event() returns trigger
language plpgsql as $$
begin
  if new.event = 'paid' and not exists (select 1 from wos.pool_events e where e.pool_id = new.pool_id and e.event = 'payable') then
    raise exception 'wos: a pool is paid only after it became payable' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger pool_events_check before insert on wos.pool_events for each row execute function wos.check_pool_event();

-- ============================================================================================
-- 13. Genesis historical credit: shared dedup, canonical commit mapping, frozen reference population (M16)
-- ============================================================================================
create table wos.genesis_contributions (
  id                       uuid primary key default gen_random_uuid(),
  contributor_account_id   uuid not null references wos.accounts (id),
  evidence_kind            text not null check (evidence_kind in ('git_commit', 'wave_report', 'retro_abu')),
  evidence_refs            text[] not null check (cardinality(evidence_refs) > 0),
  evidence_sha256          text not null check (evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  dedup_key                text not null unique references wos.work_dedup_keys (dedup_key),
  size_points              integer not null check (size_points > 0),
  genesis_policy_version   text not null,
  body                     jsonb not null,
  recorded_at              timestamptz not null default now()
);
create or replace function wos.check_genesis_dedup() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from wos.work_dedup_keys where dedup_key = new.dedup_key and source = 'genesis') then
    raise exception 'wos: genesis dedup key % is not a genesis key', new.dedup_key using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger genesis_contributions_dedup before insert on wos.genesis_contributions for each row execute function wos.check_genesis_dedup();

-- Each commit maps to exactly one retro unit, so overlapping work cannot be credited under two keys.
create table wos.genesis_commit_claims (
  commit_sha               text primary key check (commit_sha ~ '^[0-9a-f]{40}$'),
  genesis_contribution_id  uuid not null references wos.genesis_contributions (id)
);

-- The frozen reference population: approved receipts, never a Genesis beneficiary's or a related party's.
create table wos.genesis_reference_receipts (
  receipt_id       uuid primary key references wos.contribution_receipts (id),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);
create or replace function wos.check_genesis_reference() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  acct uuid;
begin
  perform wos.require_admin_action(new.admin_action_id, array['approve_genesis_reference'], 'genesis_reference', 'v1');
  select account_id into acct from wos.contribution_receipts where id = new.receipt_id;
  if exists (select 1 from wos.genesis_contributions g where wos.related_accounts(g.contributor_account_id, acct)) then
    raise exception 'wos: a Genesis beneficiary or related party cannot be in the reference population' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger genesis_reference_receipts_check before insert on wos.genesis_reference_receipts for each row execute function wos.check_genesis_reference();

-- ============================================================================================
-- 13b. Governance (D34, D36, D37, D44) and the settlement off-ramp (D35, D46; H3, H6)
-- ============================================================================================
create table wos.governance_proposals (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('policy_change', 'adapter_switch', 'migration', 'ratify_emergency', 'governance_change', 'permanent_exclusion')),
  tier             text not null check (tier in ('routine', 'structural', 'governance', 'emergency_ratification')),
  body             jsonb not null,
  snapshot_epoch   integer not null references wos.epochs (epoch_number),
  voting_opens_at  timestamptz not null,
  voting_closes_at timestamptz not null,
  created_at       timestamptz not null default now(),
  check (voting_closes_at > voting_opens_at),
  check ((kind = 'ratify_emergency') = (tier = 'emergency_ratification')),
  check (kind not in ('adapter_switch', 'migration', 'permanent_exclusion') or tier in ('structural', 'governance')),
  check (kind <> 'governance_change' or tier = 'governance')
);

create table wos.governance_weight_snapshots (
  proposal_id        uuid not null references wos.governance_proposals (id),
  account_id         uuid not null references wos.accounts (id),
  group_id           text not null,           -- beneficial owner (organization or person)
  locked_base        bigint not null check (locked_base >= 0),
  contribution_micro bigint not null check (contribution_micro >= 0),
  primary key (proposal_id, account_id)
);

create table wos.governance_votes (
  proposal_id   uuid not null references wos.governance_proposals (id),
  account_id    uuid not null references wos.accounts (id),
  choice        text not null check (choice in ('yes', 'no', 'abstain')),
  body          jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (proposal_id, account_id)
);
create or replace function wos.check_governance_vote() returns trigger
language plpgsql as $$
declare
  g wos.governance_proposals%rowtype;
begin
  new.created_at := clock_timestamp();     -- H6: server time, never the caller's
  select * into g from wos.governance_proposals where id = new.proposal_id;
  if (new.created_at >= g.voting_opens_at and new.created_at < g.voting_closes_at) is not true then
    raise exception 'wos: voting on % is closed', new.proposal_id using errcode = 'check_violation';
  end if;
  if not exists (select 1 from wos.governance_weight_snapshots w where w.proposal_id = new.proposal_id and w.account_id = new.account_id) then
    raise exception 'wos: account % has no weight in the snapshot', new.account_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger governance_votes_check before insert on wos.governance_votes for each row execute function wos.check_governance_vote();

-- Settlement adapter history. The ledger is canonical. Pauses carry a server-measured expiry <= 14 days; an expired
-- pause does NOT auto-resume: resuming needs an explicit safety confirmation (D46). Price is never a trigger.
create table wos.settlement_adapter_events (
  seq                     bigint generated always as identity primary key,
  action                  text not null check (action in ('activate', 'pause', 'resume', 'retire')),
  adapter                 text not null check (adapter in ('solana_wos', 'in_app_credits', 'paused_accrual', 'successor')),
  trigger_kind            text not null check (trigger_kind in ('security_incident', 'chain_failure', 'legal_order', 'program_bug', 'governance_decision')),
  expires_at              timestamptz,
  safety_confirmation     text,
  admin_action_id         uuid references wos.admin_actions (id),
  governance_proposal_id  uuid references wos.governance_proposals (id),
  created_at              timestamptz not null default now(),
  check (admin_action_id is not null or governance_proposal_id is not null),
  check ((action = 'pause') = (expires_at is not null)),
  check ((action = 'pause') = (adapter = 'paused_accrual')),
  check ((action = 'resume') = (safety_confirmation is not null and length(btrim(safety_confirmation)) >= 20))
);
create or replace function wos.check_adapter_event() returns trigger
language plpgsql as $$
begin
  new.created_at := clock_timestamp();                  -- H6 repro G: the expiry is measured from server time
  if new.action = 'pause' and new.expires_at > new.created_at + interval '336 hours' then
    raise exception 'wos: an emergency pause expires within 14 days of now' using errcode = 'check_violation';
  end if;
  if new.admin_action_id is not null then
    perform wos.require_admin_action(new.admin_action_id,
      case new.action when 'pause' then array['pause_settlement'] when 'resume' then array['resume_settlement'] else array['switch_adapter'] end,
      'settlement', new.adapter);
  end if;
  if new.action in ('activate', 'retire') and new.governance_proposal_id is null and exists (select 1 from wos.settlement_adapter_events) then
    raise exception 'wos: switching or retiring an adapter needs a governance decision (founder AdminAction only for the first activation)' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger settlement_adapter_events_check before insert on wos.settlement_adapter_events for each row execute function wos.check_adapter_event();

create or replace function wos.adapter_generation() returns integer
language sql stable security definer set search_path = wos, pg_temp as $$
  select greatest(1, (select count(*)::integer from wos.settlement_adapter_events where action = 'activate'))
$$;
-- Paused while the latest pause/resume event is a pause (expired or not: no auto-resume).
create or replace function wos.settlement_paused() returns boolean
language sql stable security definer set search_path = wos, pg_temp as $$
  select coalesce((select action = 'pause' from wos.settlement_adapter_events where action in ('pause', 'resume') order by seq desc limit 1), false)
$$;

-- H3: a migration snapshot only after draining: settlement paused and no attempt without an outcome.
create table wos.migration_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  at_epoch               integer not null references wos.epochs (epoch_number),
  from_adapter           text not null,
  to_adapter             text not null,
  finalized_slot         bigint not null check (finalized_slot > 0),
  body                   jsonb not null,
  snapshot_sha256        text not null unique check (snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  governance_proposal_id uuid references wos.governance_proposals (id),
  created_at             timestamptz not null default now()
);
create or replace function wos.check_migration_snapshot() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if not wos.settlement_paused() then
    raise exception 'wos: pause (fence) settlement before a migration snapshot' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.settlement_attempts a where not exists (select 1 from wos.settlement_outcomes o where o.leaf_id = a.leaf_id and o.attempt = a.attempt)) then
    raise exception 'wos: resolve every in-flight settlement attempt (drain) before the snapshot' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger migration_snapshots_check before insert on wos.migration_snapshots for each row execute function wos.check_migration_snapshot();

-- ============================================================================================
-- 14. Abuse signals and risk flags (private)
-- ============================================================================================
create table wos.abuse_signals (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,
  severity          text not null check (severity in ('info', 'low', 'medium', 'high')),
  subject_kind      text not null,
  subject_id        text not null,
  account_id        uuid references wos.accounts (id),
  detector          text not null,
  detector_version  text not null,
  evidence          jsonb not null,
  raised_at         timestamptz not null default now()
);
create index abuse_signals_account on wos.abuse_signals (account_id, raised_at desc);

create table wos.risk_flags (
  id                   uuid primary key default gen_random_uuid(),
  receipt_id           uuid not null references wos.contribution_receipts (id),
  signal_ids           uuid[] not null check (cardinality(signal_ids) > 0),
  effect               text not null check (effect in ('none', 'hold', 'exclude_pending_review')),
  risk_policy_version  text not null,
  raised_at            timestamptz not null default now()
);

-- ============================================================================================
-- 15. Append-only enforcement, grants and RLS
-- ============================================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_actions', 'policy_documents', 'policy_activations', 'run_policy_snapshots', 'qualification_results',
    'sponsorship_links', 'sponsorship_link_ends', 'publication_consents', 'usage_receipts', 'usage_event_ids',
    'run_log_commitments', 'usage_publications', 'epochs', 'epoch_transitions', 'work_dedup_keys', 'contribution_receipts',
    'receipt_status_events', 'reviewer_qualification_events', 'human_reviews', 'review_eval_cases', 'payout_audit_verdicts',
    'payout_audit_outcomes', 'receipt_clips', 'duty_events', 'payout_canaries', 'payout_canary_outcomes',
    'epoch_manifest_entries', 'allocations', 'anomaly_metrics', 'entitlements', 'claim_leaves', 'leaf_voids',
    'entitlement_claims', 'settlement_attempts', 'settlement_outcomes', 'offsets', 'allocation_acceptances',
    'allocation_disputes', 'dispute_items', 'dispute_replies', 'dispute_item_resolutions', 'dispute_appeals',
    'dispute_appeal_decisions', 'dispute_settlements', 'confiscations', 'confiscation_appeal_decisions',
    'confiscation_sources', 'exclusions', 'wallet_bindings', 'completion_pools', 'completion_definitions',
    'pool_accruals', 'pool_accrual_corrections', 'pool_events', 'genesis_contributions', 'genesis_commit_claims',
    'genesis_reference_receipts', 'governance_proposals', 'governance_weight_snapshots', 'governance_votes',
    'settlement_adapter_events', 'migration_snapshots', 'abuse_signals', 'risk_flags'
  ] loop
    perform wos.protocol_append_only(t);
  end loop;
  foreach t in array array[
    'admin_actions', 'policy_documents', 'policy_activations', 'run_policy_snapshots', 'qualification_results',
    'sponsorship_links', 'sponsorship_link_ends', 'publication_consents', 'usage_receipts', 'usage_event_ids',
    'run_log_commitments', 'run_log_bodies', 'usage_publications', 'epochs', 'epoch_transitions', 'work_dedup_keys',
    'contribution_receipts', 'receipt_status_events', 'reviewer_qualification_events', 'human_reviews', 'review_eval_cases',
    'payout_audit_quorums', 'payout_audit_verdicts', 'payout_audit_outcomes', 'receipt_clips', 'duty_events',
    'payout_canaries', 'payout_canary_outcomes', 'epoch_manifest_entries', 'allocations', 'anomaly_metrics',
    'entitlements', 'claim_leaves', 'leaf_voids', 'entitlement_claims', 'settlement_attempts', 'settlement_outcomes',
    'offsets', 'allocation_acceptances', 'allocation_disputes', 'dispute_gates', 'dispute_items', 'dispute_replies',
    'dispute_item_resolutions', 'dispute_appeals', 'dispute_appeal_decisions', 'dispute_settlements', 'confiscations',
    'confiscation_appeal_decisions', 'confiscation_sources', 'exclusions', 'wallet_bindings', 'wallet_registry',
    'completion_pools', 'completion_definitions', 'pool_accruals', 'pool_accrual_corrections', 'pool_events',
    'genesis_contributions', 'genesis_commit_claims', 'genesis_reference_receipts', 'governance_proposals',
    'governance_weight_snapshots', 'governance_votes', 'settlement_adapter_events', 'migration_snapshots',
    'abuse_signals', 'risk_flags'
  ] loop
    execute format('alter table wos.%I enable row level security', t);
    execute format('grant select, insert on wos.%I to wos_app', t);
  end loop;
end $$;
grant update on wos.payout_audit_quorums, wos.dispute_gates to wos_app;
grant delete on wos.run_log_bodies to wos_app;

-- Public protocol records: readable by any actor; writes are control-plane decisions (privileged actors).
do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_actions', 'policy_documents', 'policy_activations', 'run_policy_snapshots', 'qualification_results',
    'sponsorship_links', 'sponsorship_link_ends', 'usage_event_ids', 'run_log_commitments', 'usage_publications',
    'epochs', 'epoch_transitions', 'work_dedup_keys', 'contribution_receipts', 'receipt_status_events',
    'reviewer_qualification_events', 'human_reviews', 'review_eval_cases', 'payout_audit_outcomes', 'receipt_clips',
    'epoch_manifest_entries', 'allocations', 'anomaly_metrics', 'entitlements', 'claim_leaves', 'leaf_voids',
    'entitlement_claims', 'settlement_attempts', 'settlement_outcomes', 'offsets', 'dispute_gates',
    'dispute_item_resolutions', 'dispute_appeal_decisions', 'dispute_settlements', 'confiscations',
    'confiscation_appeal_decisions', 'confiscation_sources', 'exclusions', 'completion_pools', 'completion_definitions',
    'pool_accruals', 'pool_accrual_corrections', 'pool_events', 'genesis_contributions', 'genesis_commit_claims',
    'genesis_reference_receipts', 'governance_proposals', 'governance_weight_snapshots', 'settlement_adapter_events',
    'migration_snapshots'
  ] loop
    execute format('create policy public_read on wos.%I for select to wos_app using (true)', t);
    execute format('create policy privileged_write on wos.%I for insert to wos_app with check (wos.is_privileged())', t);
  end loop;
end $$;
create policy privileged_update on wos.dispute_gates for update to wos_app using (wos.is_privileged()) with check (wos.is_privileged());

-- Participants write their own disputes (the bundle is inserted by the header's definer trigger), replies,
-- appeals, votes, acceptances and consents; all public.
do $$
declare
  t text;
begin
  foreach t in array array['allocation_disputes', 'dispute_items', 'dispute_replies', 'dispute_appeals', 'governance_votes', 'allocation_acceptances'] loop
    execute format('create policy public_read on wos.%I for select to wos_app using (true)', t);
  end loop;
end $$;
create policy own_insert on wos.allocation_disputes for insert to wos_app with check (wos.is_privileged() or disputer_account_id = wos.actor_id());
create policy definer_only on wos.dispute_items for insert to wos_app with check (wos.is_privileged());
create policy own_insert on wos.dispute_replies for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.dispute_appeals for insert to wos_app with check (wos.is_privileged() or appellant_account_id = wos.actor_id());
create policy own_insert on wos.governance_votes for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.allocation_acceptances for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_all on wos.publication_consents for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id()) with check (wos.is_privileged() or account_id = wos.actor_id());

-- Usage receipts and run-log bodies: the contributor and privileged actors; everyone once published (post-finalization).
create policy published_or_own on wos.usage_receipts for select to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id() or exists (select 1 from wos.usage_publications p where p.usage_receipt_id = id));
create policy privileged_write on wos.usage_receipts for insert to wos_app with check (wos.is_privileged());
create policy published_or_own on wos.run_log_bodies for select to wos_app
  using (wos.is_privileged()
         or exists (select 1 from wos.agent_runs r where r.id = agent_run_id and r.account_id = wos.actor_id())
         or exists (select 1 from wos.usage_receipts u join wos.usage_publications p on p.usage_receipt_id = u.id where u.agent_run_id = run_log_bodies.agent_run_id));
create policy privileged_write on wos.run_log_bodies for insert to wos_app with check (wos.is_privileged());
create policy privileged_delete on wos.run_log_bodies for delete to wos_app using (wos.is_privileged());

-- Wallet bindings: own rows; the registry is readable only through leaves (privileged).
create policy own_or_privileged on wos.wallet_bindings for select to wos_app using (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.wallet_bindings for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());

-- PRIVATE (H11): quorums (they carry the canary classification), verdicts until revealed (then via public outcomes),
-- canaries, duty events (own rows), abuse signals, risk flags, the wallet registry.
create policy privileged_only on wos.payout_audit_quorums for all to wos_app using (wos.is_privileged()) with check (wos.is_privileged());
create policy own_or_privileged on wos.payout_audit_verdicts for select to wos_app using (wos.is_privileged() or reviewer_account_id = wos.actor_id());
create policy reviewer_inserts on wos.payout_audit_verdicts for insert to wos_app with check (wos.is_privileged() or reviewer_account_id = wos.actor_id());
create policy own_or_privileged on wos.duty_events for select to wos_app using (wos.is_privileged() or account_id = wos.actor_id());
create policy privileged_write on wos.duty_events for insert to wos_app with check (wos.is_privileged());
do $$
declare
  t text;
begin
  foreach t in array array['payout_canaries', 'payout_canary_outcomes', 'abuse_signals', 'risk_flags', 'wallet_registry'] loop
    execute format('create policy privileged_only on wos.%I for all to wos_app using (wos.is_privileged()) with check (wos.is_privileged())', t);
  end loop;
end $$;

grant execute on function wos.related_accounts(uuid, uuid), wos.epoch_state_at(integer, text), wos.epoch_state(integer),
  wos.receipt_status(uuid), wos.effective_weight(uuid), wos.reviewer_qualified(uuid, text), wos.is_maintainer(uuid),
  wos.bootstrap_on(), wos.adapter_generation(), wos.settlement_paused(), wos.two_person_action(text) to wos_app;

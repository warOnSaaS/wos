-- 0007_proof_of_contribution.sql — DRAFT pending the Astra review (docs/protocol/REVIEW-PACKET.md). Owner: Lead Architect.
-- DO NOT APPLY TO PRODUCTION. It applies cleanly on 0006 and is exercised by db:test so the design is executable.
--
-- Proof of Contribution (Amendment 02, D18–D33): run-policy snapshots and lease fencing, usage receipts with
-- provider-response dedup and scrubbed run logs, immutable contribution receipts with append-only status
-- (ACTIVE / PROVISIONAL / RATIFIED / REVOKED), optimistic payouts with a challenge window, disputes over any set of
-- allocations with focused audit gates, anomaly metrics, payout audit duty with sealed quorums,
-- payout canaries and receipt clips, human
-- review with reviewer qualifications, epochs (append-only transitions, frozen manifests, exactly-once allocations),
-- claim leaves and retry-safe settlement records, offsets, wallet bindings, completion pools with frozen definitions,
-- Genesis historical credit with a shared dedup namespace, abuse signals and risk flags, and the hash-chained
-- admin action log. Every evidence table is append-only for every role (the ledger's rule); state is derived from
-- the latest append-only event, never updated in place.

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
language sql stable as $$
  select exists (select 1 from wos.account_roles r where r.account_id = a and r.role = 'maintainer')
$$;

create or replace function wos.bootstrap_on() returns boolean
language sql stable as $$
  select coalesce((select (value ->> 'enabled')::boolean from wos.platform_settings where key = 'bootstrap_mode'), false)
$$;

-- ============================================================================================
-- 1. Admin actions: immutable, hash-chained like the ledger (no silent confiscation)
-- ============================================================================================
create table wos.admin_actions (
  id                     uuid primary key default gen_random_uuid(),
  entry_no               bigint not null unique,
  actor_account_id       uuid not null references wos.accounts (id),
  action                 text not null check (action in (
    'authorize_reviewer', 'revoke_reviewer', 'suspend_reward_eligibility', 'restore_reward_eligibility',
    'suspend_reviewer_privileges', 'restore_reviewer_privileges', 'suspend_account', 'restore_account',
    'invalidate_receipt', 'restore_receipt', 'hold_receipt', 'clear_risk_flag', 'uphold_risk_flag', 'record_offset',
    'activate_policy', 'activate_oracle', 'set_model_eligibility', 'open_epoch', 'finalize_epoch',
    'mark_epoch_distributable', 'close_epoch', 'record_genesis', 'award_security', 'bootstrap_merge',
    'ratify_receipt', 'reject_ratification', 'resolve_ratification_dispute', 'clip_receipt', 'end_bootstrap',
    'start_test_epochs', 'end_test_epochs')),
  target_kind            text not null,
  target_id              text not null,
  reason                 text not null check (length(btrim(reason)) >= 20),
  affected_receipt_ids   uuid[] not null default '{}',
  affected_epochs        integer[] not null default '{}',
  previous_state         jsonb not null,
  resulting_state        jsonb not null,
  requires_co_signer     boolean not null,
  co_signer_account_id   uuid references wos.accounts (id),
  prev_hash              bytea not null,
  entry_hash             bytea not null unique,
  created_at             timestamptz not null,
  check (not requires_co_signer or (co_signer_account_id is not null and co_signer_account_id <> actor_account_id)),
  -- bootstrap_merge is only possible while bootstrap mode is on (checked by trigger) and never needs a co-signer
  check (action <> 'bootstrap_merge' or not requires_co_signer)
);

create or replace function wos.admin_actions_chain() returns trigger
language plpgsql as $$
declare
  last_no bigint;
  last_hash bytea;
begin
  if not wos.is_maintainer(new.actor_account_id) then
    raise exception 'wos: admin action by a non-maintainer' using errcode = 'insufficient_privilege';
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
      array_to_string(new.affected_receipt_ids, ','), array_to_string(new.affected_epochs, ','),
      new.previous_state::text, new.resulting_state::text, new.requires_co_signer,
      coalesce(new.co_signer_account_id::text, ''),
      to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ), 'UTF8'));
  return new;
end $$;
create trigger admin_actions_chain before insert on wos.admin_actions for each row execute function wos.admin_actions_chain();

-- ============================================================================================
-- 2. Policy documents and activations (versions never change; activation only at epoch boundaries)
-- ============================================================================================
create table wos.policy_documents (
  kind        text not null check (kind in ('reward', 'oracle', 'review', 'capability', 'usage_proof', 'risk', 'merge', 'completion', 'genesis')),
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
  announced_at     timestamptz not null default now(),
  emergency        boolean not null default false,
  preview_sha256   text check (preview_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now(),
  primary key (kind, effective_epoch),
  foreign key (kind, version) references wos.policy_documents (kind, version),
  check (emergency or preview_sha256 is not null)
);

-- Forward-only (D33): a normal change applies from the next epoch at the earliest, announced >= 72 h before that epoch
-- starts (when the epoch is already defined); an emergency change may touch the open epoch only while its allocations
-- are unpublished. Nothing ever applies to a published or finalized epoch.
create or replace function wos.check_policy_activation() returns trigger
language plpgsql as $$
declare
  open_epoch integer;
  target_start timestamptz;
  target_state text;
begin
  select max(epoch_number) into open_epoch from wos.epochs e where wos.epoch_state(e.epoch_number) = 'OPEN';
  select starts_at into target_start from wos.epochs where epoch_number = new.effective_epoch;
  target_state := wos.epoch_state(new.effective_epoch);
  if not new.emergency then
    if new.effective_epoch <= coalesce(open_epoch, 0) then
      raise exception 'wos: a policy change takes effect from the next epoch at the earliest' using errcode = 'check_violation';
    end if;
    if target_start is not null and new.announced_at > target_start - interval '72 hours' then
      raise exception 'wos: announce a policy change at least 72 h before its epoch starts' using errcode = 'check_violation';
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
-- 3. Lease fencing (Astra-01 item 7) and run-policy snapshots (item 8)
-- ============================================================================================
alter table wos.leases add column generation integer;
update wos.leases l set generation = g.n
  from (select id, row_number() over (partition by task_id order by issued_at, id) as n from wos.leases) g
 where g.id = l.id;
alter table wos.leases alter column generation set not null;
alter table wos.leases add constraint leases_generation_positive check (generation > 0);
create unique index leases_task_generation on wos.leases (task_id, generation);

-- Each new lease of a task gets the next generation; a submission names its lease, so a reassigned task's old
-- worker can never submit (its lease is not active and its generation is not the latest).
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

-- Hard attempt lifetime (the ABU cannot be held indefinitely without an active run); the sweeper expires it.
alter table wos.attempts add column max_lifetime_at timestamptz;

create table wos.run_policy_snapshots (
  lease_id          uuid primary key references wos.leases (id),
  generation        integer not null,
  body              jsonb not null,     -- RunPolicySnapshot
  snapshot_sha256   text not null unique check (snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at        timestamptz not null default now()
);

-- Review duty and audits are leased tasks too.
alter table wos.tasks drop constraint tasks_kind_check;
alter table wos.tasks add constraint tasks_kind_check check (kind in ('roadmap_author', 'roadmap_review', 'feature_author',
  'feature_review', 'abu_build', 'abu_revision', 'implementation_review', 'conflict_resolution', 'payout_audit'));
alter table wos.tasks drop constraint tasks_role_check;
alter table wos.tasks add constraint tasks_role_check check (role in ('roadmap_author', 'roadmap_reviewer_astra',
  'roadmap_reviewer_fable', 'feature_author', 'feature_reviewer_astra', 'feature_reviewer_fable', 'builder',
  'implementation_reviewer_astra', 'implementation_reviewer_fable', 'conflict_resolver', 'payout_auditor'));

-- ============================================================================================
-- 4. Usage receipts (one per agent run) and provider response dedup
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
  input_tokens              bigint not null check (input_tokens >= 0),
  cached_input_tokens       bigint not null check (cached_input_tokens >= 0),
  cache_write_input_tokens  bigint not null check (cache_write_input_tokens >= 0),
  output_tokens             bigint not null check (output_tokens >= 0),
  reasoning_output_tokens   bigint not null check (reasoning_output_tokens >= 0 and reasoning_output_tokens <= output_tokens),
  usage_event_count         integer not null check (usage_event_count >= 0),
  oracle_version            text not null,
  acu_micro                 bigint not null check (acu_micro >= 0),
  run_policy_snapshot_sha256 text not null,
  body                      jsonb not null,    -- UsageReceipt
  receipt_sha256            text not null unique check (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at                timestamptz not null default now()
);
create index usage_receipts_account on wos.usage_receipts (account_id, created_at);

-- A provider response id (hashed) may back usage exactly once across ALL runs: replayed transcripts collide here.
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

-- ============================================================================================
-- 5. Epochs: immutable definitions + append-only transitions (bounded windows enforced here)
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
  max_disputes_per_account integer not null default 3 check (max_disputes_per_account > 0),
  max_items_per_dispute    integer not null default 25 check (max_items_per_dispute > 0),
  policy_versions     jsonb not null,
  created_at          timestamptz not null default now(),
  check (ends_at > starts_at),
  check (mode = 'test' or cluster = 'devnet' or cluster = 'mainnet-beta')
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
  check ((to_state = 'DISTRIBUTABLE') = (anchor_signature is not null))
);

create or replace function wos.epoch_state(e integer) returns text
language sql stable as $$
  select to_state from wos.epoch_transitions where epoch_number = e order by seq desc limit 1
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
  if new.from_state is distinct from cur then
    raise exception 'wos: epoch % is %, not %', new.epoch_number, coalesce(cur, 'new'), coalesce(new.from_state, 'new') using errcode = 'check_violation';
  end if;
  if not ((cur is null and new.to_state = 'OPEN')
       or (cur = 'OPEN' and new.to_state = 'CALCULATING')
       or (cur = 'CALCULATING' and new.to_state = 'PROPOSED')
       or (cur = 'PROPOSED' and new.to_state = 'FINALIZED')
       or (cur = 'FINALIZED' and new.to_state = 'DISTRIBUTABLE')
       or (cur = 'DISTRIBUTABLE' and new.to_state = 'CLOSED')) then
    raise exception 'wos: epoch transition % -> % is not allowed', coalesce(cur, 'new'), new.to_state using errcode = 'check_violation';
  end if;
  if new.to_state = 'CALCULATING' and new.at < ep.ends_at then
    raise exception 'wos: epoch % cannot close before %', new.epoch_number, ep.ends_at using errcode = 'check_violation';
  end if;
  if new.to_state = 'PROPOSED' and new.at < cur_at + make_interval(hours => ep.risk_review_hours) then
    raise exception 'wos: epoch % is inside its risk review window', new.epoch_number using errcode = 'check_violation';
  end if;
  if new.to_state = 'FINALIZED' and new.at < cur_at + make_interval(hours => ep.challenge_hours) then
    raise exception 'wos: epoch % is inside its challenge window', new.epoch_number using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger epoch_transitions_check before insert on wos.epoch_transitions for each row execute function wos.check_epoch_transition();

-- ============================================================================================
-- 6. Contribution receipts: immutable, one dedup namespace shared with Genesis
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
  subject_kind          text not null,
  subject_id            uuid not null,
  lease_id              uuid references wos.leases (id),
  lease_generation      integer,
  dedup_key             text not null unique references wos.work_dedup_keys (dedup_key),
  admitted_epoch        integer not null references wos.epochs (epoch_number),
  body                  jsonb not null,     -- ContributionReceipt
  receipt_sha256        text not null unique check (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  qualified_at          timestamptz not null,
  created_at            timestamptz not null default now(),
  check ((independence = 'independent') = (initial_status = 'ACTIVE')),
  check (evidence_class <> 'attested_usage' or weight_micro <= cap_acu_micro),
  check (evidence_class <> 'attested_usage' or weight_micro <= attested_acu_micro),
  check ((lease_id is null) = (lease_generation is null))
);
create index contribution_receipts_account on wos.contribution_receipts (account_id, created_at);

create or replace function wos.check_contribution_receipt() returns trigger
language plpgsql as $$
begin
  if new.independence = 'founder_bootstrap' and not (wos.bootstrap_on() and wos.is_maintainer(new.account_id)) then
    raise exception 'wos: a founder_bootstrap receipt needs bootstrap mode and a maintainer contributor' using errcode = 'check_violation';
  end if;
  if new.lowest_verification in ('ESTIMATED', 'UNVERIFIED') and new.evidence_class = 'attested_usage' then
    raise exception 'wos: attested_usage weight cannot rest on % usage (fail closed)', new.lowest_verification using errcode = 'check_violation';
  end if;
  if coalesce(wos.epoch_state(new.admitted_epoch), '') <> 'OPEN' then
    raise exception 'wos: receipts are admitted only to an OPEN epoch (epoch % is %)', new.admitted_epoch, wos.epoch_state(new.admitted_epoch)
      using errcode = 'check_violation';
  end if;
  if new.lease_id is not null and not exists (select 1 from wos.leases l where l.id = new.lease_id and l.generation = new.lease_generation) then
    raise exception 'wos: receipt lease generation mismatch' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger contribution_receipts_check before insert on wos.contribution_receipts
  for each row execute function wos.check_contribution_receipt();

-- ============================================================================================
-- 7. Receipt status: append-only events, validated against ReceiptStatusMachine (D23, D25)
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
language sql stable as $$
  select to_status from wos.receipt_status_events where receipt_id = r order by seq desc limit 1
$$;

create or replace function wos.check_receipt_status_event() returns trigger
language plpgsql as $$
declare
  cur text;
  born text;
  before_revoke text;
  ok boolean;
begin
  perform pg_advisory_xact_lock(hashtext('wos.receipt:' || new.receipt_id::text));
  select initial_status into born from wos.contribution_receipts where id = new.receipt_id;
  cur := wos.receipt_status(new.receipt_id);
  new.seq := coalesce((select max(seq) from wos.receipt_status_events where receipt_id = new.receipt_id), 0) + 1;
  if new.from_status is distinct from cur then
    raise exception 'wos: receipt % is %, not %', new.receipt_id, coalesce(cur, 'new'), coalesce(new.from_status, 'new') using errcode = 'check_violation';
  end if;
  if cur = 'REVOKED' then
    select from_status into before_revoke from wos.receipt_status_events
     where receipt_id = new.receipt_id and to_status = 'REVOKED' order by seq desc limit 1;
  end if;
  ok := (cur is null and new.kind = 'issued' and new.to_status = born)
     or (cur = 'PROVISIONAL' and new.to_status = 'RATIFIED' and new.kind = 'quorum_ratified' and new.quorum_id is not null)
     or (cur = 'PROVISIONAL' and new.to_status = 'RATIFIED' and new.kind = 'human_signoff' and new.human_review_id is not null)
     or (cur = 'PROVISIONAL' and new.to_status = 'PROVISIONAL' and new.kind = 'ratification_rejected' and (new.quorum_id is not null or new.human_review_id is not null))
     or (cur in ('ACTIVE', 'PROVISIONAL', 'RATIFIED') and new.to_status = 'REVOKED' and new.kind = 'revoked' and new.admin_action_id is not null)
     or (cur = 'REVOKED' and new.kind = 'restored' and new.admin_action_id is not null and new.to_status = before_revoke);
  if not ok then
    raise exception 'wos: receipt status % -> % by % is not allowed', coalesce(cur, 'new'), new.to_status, new.kind using errcode = 'check_violation';
  end if;
  -- Ratification by human sign-off: an authorized human who is not the contributor, reviewing THIS receipt's subject.
  if new.kind = 'human_signoff' and not exists (
      select 1 from wos.human_reviews h join wos.contribution_receipts c on c.id = new.receipt_id
       where h.id = new.human_review_id and h.verdict = 'PASS' and h.reviewer_account_id <> c.account_id
         and ((h.subject_kind = c.subject_kind and h.subject_id = c.subject_id) or (h.subject_kind = 'receipt' and h.subject_id = c.id))) then
    raise exception 'wos: human sign-off must be a PASS by a non-author human on this receipt''s subject' using errcode = 'check_violation';
  end if;
  if new.kind = 'quorum_ratified' and not exists (
      select 1 from wos.payout_audit_quorums q where q.id = new.quorum_id and q.receipt_id = new.receipt_id and q.outcome = 'ratified') then
    raise exception 'wos: quorum % did not ratify receipt %', new.quorum_id, new.receipt_id using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger receipt_status_events_check before insert on wos.receipt_status_events
  for each row execute function wos.check_receipt_status_event();

-- Every receipt is born with its 'issued' event in the same transaction.
create or replace function wos.issue_receipt_status() returns trigger
language plpgsql as $$
begin
  insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind) values (new.id, null, new.initial_status, 'issued');
  perform 1 from wos.work_dedup_keys where dedup_key = new.dedup_key and source = 'receipt';
  if not found then
    raise exception 'wos: receipt dedup key % is not a receipt key', new.dedup_key using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger contribution_receipts_issue after insert on wos.contribution_receipts
  for each row execute function wos.issue_receipt_status();

-- ============================================================================================
-- 8. Human review: qualifications (append-only events) and bound, sealed reviews
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
create index reviewer_qualification_events_account on wos.reviewer_qualification_events (account_id, created_at desc);

create or replace function wos.reviewer_qualified(a uuid) returns boolean
language sql stable as $$
  select coalesce((select action in ('grant', 'restore') from wos.reviewer_qualification_events
                    where account_id = a order by created_at desc, id desc limit 1), false)
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
  body                    jsonb not null,     -- HumanReview
  review_sha256           text not null unique check (review_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sealed_at               timestamptz not null default now()
);

create or replace function wos.check_human_review() returns trigger
language plpgsql as $$
declare
  author uuid;
  r wos.rounds%rowtype;
begin
  if not wos.reviewer_qualified(new.reviewer_account_id) then
    raise exception 'wos: account % is not an authorized human reviewer', new.reviewer_account_id using errcode = 'check_violation';
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
  if new.subject_kind = 'document' and exists (
      select 1 from wos.changesets c join wos.tasks t on t.id = c.task_id
       where t.document_id = new.subject_id and c.account_id = new.reviewer_account_id and c.ok) then
    raise exception 'wos: a human reviewer may not review a document they authored' using errcode = 'check_violation';
  end if;
  if new.purpose = 'pre_merge' then
    if new.round_id is null or new.head_sha is null or new.submission_sha256 is null then
      raise exception 'wos: a pre-merge human review is bound to a round, head sha and submission hash' using errcode = 'check_violation';
    end if;
    select * into r from wos.rounds where id = new.round_id;
    if r.head_sha <> new.head_sha or r.submission_sha256 <> new.submission_sha256 then
      raise exception 'wos: human review bound to %/% but the round is %/%', new.head_sha, new.submission_sha256, r.head_sha, r.submission_sha256
        using errcode = 'check_violation';
    end if;
    -- One identity per slot: the human may not also hold an agent slot of the same round.
    if exists (select 1 from wos.reviews v where v.round_id = new.round_id and v.account_id = new.reviewer_account_id) then
      raise exception 'wos: the human reviewer already holds an agent slot of this round' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger human_reviews_check before insert on wos.human_reviews for each row execute function wos.check_human_review();

create table wos.review_eval_cases (
  id               uuid primary key default gen_random_uuid(),
  subject_kind     text not null,
  subject_id       uuid not null,
  round_id         uuid references wos.rounds (id),
  pattern          text not null check (pattern in ('agents_pass_human_fail', 'agents_fail_human_pass', 'agents_split', 'post_merge_defect_missed_by_all', 'ratifiers_split')),
  astra_verdict    text,
  fable_verdict    text,
  human_verdict    text,
  outcome          text not null check (outcome in ('pending', 'human_upheld', 'agents_upheld', 'both_wrong')),
  context_sha256   text not null,
  created_at       timestamptz not null default now()
);

-- ============================================================================================
-- 9. Run logs, payout audit duty with sealed quorums (D25, D27), payout canaries, clips
-- ============================================================================================
-- Scrubbed structured run logs (RunLog). PRIVATE until the run's epoch finalizes (then published by the API).
create table wos.run_logs (
  agent_run_id     uuid primary key references wos.agent_runs (id),
  log_sha256       text not null unique check (log_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  size_bytes       integer not null check (size_bytes between 1 and 1048576),
  turns            integer not null check (turns between 0 and 2000),
  totals_match     boolean not null,      -- per-turn sums equal the usage receipt (else the run is UNVERIFIED)
  body             jsonb not null,
  created_at       timestamptz not null default now()
);

-- Per-run usage becomes public only when its epoch finalizes (canaries stay unmatchable during the audit window).
create table wos.usage_publications (
  usage_receipt_id  uuid primary key references wos.usage_receipts (id),
  epoch_number      integer not null references wos.epochs (epoch_number),
  created_at        timestamptz not null default now()
);

create table wos.payout_audit_quorums (
  id                    uuid primary key default gen_random_uuid(),
  receipt_id            uuid references wos.contribution_receipts (id),   -- null for a canary quorum
  is_canary             boolean not null default false,
  size                  integer not null check (size between 1 and 5),
  review_policy_version text not null,
  outcome               text check (outcome in ('ratified', 'findings', 'expired')),
  created_at            timestamptz not null default now(),
  check (is_canary = (receipt_id is null))
);
create unique index payout_audit_quorums_one_ratified on wos.payout_audit_quorums (receipt_id) where outcome = 'ratified';

create table wos.payout_audit_verdicts (
  id                  uuid primary key default gen_random_uuid(),
  quorum_id           uuid not null references wos.payout_audit_quorums (id),
  slot                integer not null check (slot > 0),
  outside_feature     boolean not null,   -- only outside-feature verdicts count toward ratification
  packet_id           uuid not null,
  reviewer_account_id uuid not null references wos.accounts (id),
  task_id             uuid not null references wos.tasks (id),
  lease_id            uuid not null references wos.leases (id),
  agent_run_id        uuid not null references wos.agent_runs (id),
  provider            text not null check (provider in ('claude_cli', 'codex_cli')),
  judgment            text not null check (judgment in ('plausible', 'inflated', 'misattributed', 'insufficient_evidence')),
  body                jsonb not null,        -- PayoutAuditVerdict
  verdict_sha256      text not null unique check (verdict_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sealed_at           timestamptz not null default now(),
  unique (quorum_id, slot),
  unique (quorum_id, reviewer_account_id)
);

create or replace function wos.check_payout_audit_verdict() returns trigger
language plpgsql as $$
declare
  q wos.payout_audit_quorums%rowtype;
  c wos.contribution_receipts%rowtype;
  on_feature boolean;
begin
  select * into q from wos.payout_audit_quorums where id = new.quorum_id;
  if q.outcome is not null then
    raise exception 'wos: quorum % is already revealed', q.id using errcode = 'check_violation';
  end if;
  if not q.is_canary then
    select * into c from wos.contribution_receipts where id = q.receipt_id;
    if c.account_id = new.reviewer_account_id then
      raise exception 'wos: a contributor may not audit their own receipt' using errcode = 'check_violation';
    end if;
    -- outside_feature must be true only for auditors with no receipt on the same feature
    select exists (select 1 from wos.contribution_receipts o
                    where o.account_id = new.reviewer_account_id and o.body ->> 'feature' is not distinct from c.body ->> 'feature'
                      and c.body ->> 'feature' is not null) into on_feature;
    if new.outside_feature and on_feature then
      raise exception 'wos: auditor % has receipts on this feature and cannot fill an outside-feature slot', new.reviewer_account_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger payout_audit_verdicts_check before insert on wos.payout_audit_verdicts
  for each row execute function wos.check_payout_audit_verdict();

create or replace function wos.payout_audit_outcome_once() returns trigger
language plpgsql as $$
begin
  if old.outcome is not null or new.receipt_id is distinct from old.receipt_id or new.size <> old.size or new.is_canary <> old.is_canary then
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
create trigger payout_audit_quorums_outcome before update on wos.payout_audit_quorums
  for each row execute function wos.payout_audit_outcome_once();
create trigger payout_audit_quorums_no_delete before delete or truncate on wos.payout_audit_quorums
  for each statement execute function wos.forbid_mutation();

-- An upheld inflation finding clips a receipt once, never upward (append-only). Effective weight = min(original, clip).
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

create table wos.duty_statements (
  account_id    uuid not null references wos.accounts (id),
  epoch_number  integer not null references wos.epochs (epoch_number),
  owed          integer not null check (owed >= 0),
  offered       integer not null check (offered >= 0),
  done          integer not null check (done >= 0),
  claim_gated   boolean not null,
  created_at    timestamptz not null default now(),
  primary key (account_id, epoch_number),
  check (claim_gated = (done < least(owed, offered)))
);

-- Payout canaries are PRIVATE: model-free perturbations of real payout lines; never allocated, never public.
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
  caught                boolean not null,
  created_at            timestamptz not null default now(),
  primary key (canary_id, reviewer_account_id)
);

-- ============================================================================================
-- 10. Epoch manifests, allocations, claim leaves, settlement, offsets
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
-- Exactly-once: a receipt is included in at most one epoch per mode.
create unique index epoch_manifest_once on wos.epoch_manifest_entries (receipt_id, mode) where disposition = 'included';

create or replace function wos.check_manifest_entry() returns trigger
language plpgsql as $$
declare
  ep_mode text;
  st text;
begin
  select mode into ep_mode from wos.epochs where epoch_number = new.epoch_number;
  if new.mode <> ep_mode then
    raise exception 'wos: manifest mode % differs from epoch mode %', new.mode, ep_mode using errcode = 'check_violation';
  end if;
  if coalesce(wos.epoch_state(new.epoch_number), '') <> 'CALCULATING' then
    raise exception 'wos: the manifest is frozen when the epoch closes (epoch % is %)', new.epoch_number, wos.epoch_state(new.epoch_number)
      using errcode = 'check_violation';
  end if;
  st := wos.receipt_status(new.receipt_id);
  if new.disposition = 'included' and not (st in ('ACTIVE', 'RATIFIED') or (ep_mode = 'test' and st <> 'REVOKED')) then
    raise exception 'wos: a % receipt cannot be included in a % epoch', st, ep_mode using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger epoch_manifest_check before insert on wos.epoch_manifest_entries for each row execute function wos.check_manifest_entry();

create table wos.allocations (
  id             uuid primary key,               -- stable: deterministicUuid(epoch, line key); the public permalink id
  epoch_number   integer not null references wos.epochs (epoch_number),
  account_id     uuid not null references wos.accounts (id),
  receipt_id     uuid references wos.contribution_receipts (id),   -- one line per receipt in distributing slices
  slice          text not null check (slice in ('execution', 'planning', 'human_review', 'outcomes', 'completion_payout', 'security_payout', 'dispute_bounty', 'offset')),
  weight_micro   bigint not null check (weight_micro >= 0),
  amount_base    bigint not null,
  explanation    jsonb not null,                 -- AllocationExplanation (public, pseudonymous)
  explanation_sha256 text not null check (explanation_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  check ((slice = 'offset') = (amount_base < 0) or amount_base = 0),
  check ((slice in ('execution', 'planning', 'human_review', 'outcomes')) = (receipt_id is not null) or slice = 'security_payout')
);
create unique index allocations_receipt_once on wos.allocations (epoch_number, receipt_id, slice) where receipt_id is not null;

-- Deterministic anomaly metrics (engine output), written with the allocations; public.
create table wos.anomaly_metrics (
  epoch_number   integer not null references wos.epochs (epoch_number),
  account_id     uuid not null references wos.accounts (id),
  metrics        jsonb not null,                 -- AnomalyMetrics
  rank_score     bigint not null,
  created_at     timestamptz not null default now(),
  primary key (epoch_number, account_id)
);

create or replace function wos.check_allocation() returns trigger
language plpgsql as $$
begin
  if coalesce(wos.epoch_state(new.epoch_number), '') <> 'CALCULATING' then
    raise exception 'wos: allocations are written once, while epoch % is CALCULATING', new.epoch_number using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger allocations_check before insert on wos.allocations for each row execute function wos.check_allocation();
create trigger anomaly_metrics_check before insert on wos.anomaly_metrics for each row execute function wos.check_allocation();

create table wos.claim_leaves (
  epoch_number   integer not null references wos.epochs (epoch_number),
  leaf_index     integer not null check (leaf_index >= 0),
  account_id     uuid not null references wos.accounts (id),
  wallet         text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount_base    bigint not null check (amount_base > 0),
  leaf_sha256    text not null check (leaf_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  primary key (epoch_number, leaf_index),
  unique (epoch_number, account_id)
);
create trigger claim_leaves_check before insert on wos.claim_leaves for each row execute function wos.check_allocation();

-- Retry-safe settlement: each attempt is a row; outcome rows are appended, never updated.
create table wos.settlement_records (
  epoch_number            integer not null,
  leaf_index              integer not null,
  attempt                 integer not null check (attempt > 0),
  signature               text not null,
  last_valid_block_height bigint not null check (last_valid_block_height >= 0),
  outcome                 text not null check (outcome in ('pending', 'confirmed', 'expired_not_landed', 'failed')),
  created_at              timestamptz not null default now(),
  primary key (epoch_number, leaf_index, attempt, outcome),
  foreign key (epoch_number, leaf_index) references wos.claim_leaves (epoch_number, leaf_index)
);
-- At most one confirmed transfer per leaf: the duplicate-claim backstop.
create unique index settlement_one_confirmed on wos.settlement_records (epoch_number, leaf_index) where outcome = 'confirmed';

create table wos.offsets (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references wos.accounts (id),
  receipt_id       uuid not null references wos.contribution_receipts (id),
  amount_base      bigint not null check (amount_base > 0),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);

-- ============================================================================================
-- 10b. Optimistic payouts (D28–D32): acceptances, disputes over any set of allocations, gates, replies, outcomes
-- ============================================================================================
create or replace function wos.epoch_state_at(e integer, s text) returns timestamptz
language sql stable as $$
  select at from wos.epoch_transitions where epoch_number = e and to_state = s order by seq desc limit 1
$$;

-- Accept is one click and optional: silence accepts. Finality never depends on this row or on a notification.
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
  stake_base           bigint not null check (stake_base >= 0),
  note_untrusted       text not null default '' check (length(note_untrusted) <= 4000),
  shared_evidence      jsonb not null default '[]',
  body                 jsonb not null,           -- AllocationDispute
  opened_at            timestamptz not null default clock_timestamp()
);

create or replace function wos.check_allocation_dispute() returns trigger
language plpgsql as $$
declare
  ep wos.epochs%rowtype;
  proposed_at timestamptz;
begin
  select * into ep from wos.epochs where epoch_number = new.epoch_number;
  if wos.epoch_state(new.epoch_number) <> 'PROPOSED' then
    raise exception 'wos: disputes are accepted only while epoch % is PROPOSED', new.epoch_number using errcode = 'check_violation';
  end if;
  proposed_at := wos.epoch_state_at(new.epoch_number, 'PROPOSED');
  if new.opened_at >= proposed_at + make_interval(hours => ep.challenge_hours) then
    raise exception 'wos: the challenge window of epoch % has closed', new.epoch_number using errcode = 'check_violation';
  end if;
  -- Epoch-wide standing: the disputer has an allocation in this epoch (the pool is shared, so everyone is affected).
  if not exists (select 1 from wos.allocations a where a.epoch_number = new.epoch_number and a.account_id = new.disputer_account_id and a.amount_base > 0) then
    raise exception 'wos: only participants of epoch % may dispute its allocations', new.epoch_number using errcode = 'check_violation';
  end if;
  if (select count(*) from wos.allocation_disputes d where d.epoch_number = new.epoch_number and d.disputer_account_id = new.disputer_account_id)
     >= ep.max_disputes_per_account then
    raise exception 'wos: dispute rate limit reached for epoch %', new.epoch_number using errcode = 'check_violation';
  end if;
  if new.stake_base > (select coalesce(sum(amount_base), 0) from wos.allocations a where a.epoch_number = new.epoch_number and a.account_id = new.disputer_account_id) then
    raise exception 'wos: the stake exceeds the disputer''s pending allocation' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger allocation_disputes_check before insert on wos.allocation_disputes for each row execute function wos.check_allocation_dispute();

-- One gate per disputed allocation; later disputes on the same allocation join it (bounty priority stays with the first).
create table wos.dispute_gates (
  allocation_id          uuid primary key references wos.allocations (id),
  first_dispute_id       uuid not null references wos.allocation_disputes (id),
  reply_deadline_at      timestamptz not null,
  created_at             timestamptz not null default now()
);

create table wos.dispute_items (
  dispute_id           uuid not null references wos.allocation_disputes (id),
  allocation_id        uuid not null references wos.allocations (id),
  reason               text not null check (reason in ('inflated_usage', 'padded_repairs', 'context_inflation', 'model_misreported', 'misattribution', 'duplicate_work', 'split_gaming', 'other')),
  evidence             jsonb not null,
  proposed_amount_base bigint check (proposed_amount_base >= 0),
  created_at           timestamptz not null default now(),
  primary key (dispute_id, allocation_id)
);

create or replace function wos.check_dispute_item() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.allocation_disputes%rowtype;
  a wos.allocations%rowtype;
  ep wos.epochs%rowtype;
begin
  select * into d from wos.allocation_disputes where id = new.dispute_id;
  select * into a from wos.allocations where id = new.allocation_id;
  select * into ep from wos.epochs where epoch_number = d.epoch_number;
  if a.epoch_number <> d.epoch_number then
    raise exception 'wos: a dispute covers allocations of its own epoch only' using errcode = 'check_violation';
  end if;
  if a.account_id = d.disputer_account_id then
    raise exception 'wos: one cannot dispute one''s own allocation' using errcode = 'check_violation';
  end if;
  if (select count(*) from wos.dispute_items i where i.dispute_id = new.dispute_id) >= ep.max_items_per_dispute then
    raise exception 'wos: too many allocations in one dispute' using errcode = 'check_violation';
  end if;
  insert into wos.dispute_gates (allocation_id, first_dispute_id, reply_deadline_at)
  values (new.allocation_id, new.dispute_id, clock_timestamp() + make_interval(hours => ep.reply_hours))
  on conflict (allocation_id) do nothing;
  return new;
end $$;
create trigger dispute_items_check before insert on wos.dispute_items for each row execute function wos.check_dispute_item();

-- Right of reply: only the accused, only before the gate's reply deadline.
create table wos.dispute_replies (
  allocation_id    uuid not null references wos.dispute_gates (allocation_id),
  account_id       uuid not null references wos.accounts (id),
  body_untrusted   text not null check (length(body_untrusted) <= 4000),
  evidence         jsonb not null default '[]',
  created_at       timestamptz not null default clock_timestamp(),
  primary key (allocation_id, created_at)
);
create or replace function wos.check_dispute_reply() returns trigger
language plpgsql as $$
begin
  if new.account_id <> (select account_id from wos.allocations where id = new.allocation_id) then
    raise exception 'wos: only the accused may reply' using errcode = 'check_violation';
  end if;
  if new.created_at > (select reply_deadline_at from wos.dispute_gates where allocation_id = new.allocation_id) then
    raise exception 'wos: the right-of-reply window has closed' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_replies_check before insert on wos.dispute_replies for each row execute function wos.check_dispute_reply();

-- Per-allocation outcome (never above the proposed amount); per-dispute settlement (bounty on TOTAL excess).
create table wos.dispute_item_resolutions (
  allocation_id          uuid primary key references wos.dispute_gates (allocation_id),
  outcome                text not null check (outcome in ('UPHELD', 'CLIPPED', 'REVOKED')),
  quorum_id              uuid references wos.payout_audit_quorums (id),
  admin_action_id        uuid references wos.admin_actions (id),
  resulting_amount_base  bigint not null check (resulting_amount_base >= 0),
  excess_base            bigint not null check (excess_base >= 0),
  resolved_at            timestamptz not null default now(),
  check (quorum_id is not null or admin_action_id is not null),
  check ((outcome = 'UPHELD') = (excess_base = 0)),
  check (outcome <> 'REVOKED' or resulting_amount_base = 0)
);
create or replace function wos.check_dispute_resolution() returns trigger
language plpgsql as $$
begin
  if new.resulting_amount_base + new.excess_base <> (select amount_base from wos.allocations where id = new.allocation_id) then
    raise exception 'wos: resulting amount + excess must equal the proposed amount' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_item_resolutions_check before insert on wos.dispute_item_resolutions
  for each row execute function wos.check_dispute_resolution();

create table wos.dispute_settlements (
  dispute_id             uuid primary key references wos.allocation_disputes (id),
  total_excess_base      bigint not null check (total_excess_base >= 0),
  bounty_base            bigint not null check (bounty_base >= 0 and bounty_base <= total_excess_base),
  stake_forfeited_base   bigint not null check (stake_forfeited_base >= 0),
  settled_in_epoch       integer not null references wos.epochs (epoch_number),
  created_at             timestamptz not null default now(),
  check (total_excess_base = 0 or stake_forfeited_base = 0)
);

-- ============================================================================================
-- 11. Wallet bindings (append-only; one account per wallet per cluster)
-- ============================================================================================
create table wos.wallet_bindings (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references wos.accounts (id),
  cluster      text not null check (cluster in ('devnet', 'mainnet-beta')),
  wallet       text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  kind         text not null check (kind in ('external', 'cli_keypair')),
  action       text not null check (action in ('bind', 'unbind')),
  message      text not null,
  signature    text not null,
  created_at   timestamptz not null default clock_timestamp()
);
create index wallet_bindings_wallet on wos.wallet_bindings (cluster, wallet, created_at desc);
create index wallet_bindings_account on wos.wallet_bindings (account_id, cluster, created_at desc);

create or replace function wos.check_wallet_binding() returns trigger
language plpgsql as $$
declare
  holder uuid;
  last_action text;
begin
  perform pg_advisory_xact_lock(hashtext('wos.wallet:' || new.cluster || ':' || new.wallet));
  select account_id, action into holder, last_action from wos.wallet_bindings
   where cluster = new.cluster and wallet = new.wallet order by created_at desc, id desc limit 1;
  if new.action = 'bind' and last_action = 'bind' and holder <> new.account_id then
    raise exception 'wos: wallet is bound to another account' using errcode = 'check_violation';
  end if;
  if new.action = 'unbind' and (last_action is distinct from 'bind' or holder <> new.account_id) then
    raise exception 'wos: only the bound account may unbind a wallet' using errcode = 'check_violation';
  end if;
  if position(new.wallet in new.message) = 0 or position(new.account_id::text in new.message) = 0 then
    raise exception 'wos: the signed message must name the wallet and the account' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger wallet_bindings_check before insert on wos.wallet_bindings for each row execute function wos.check_wallet_binding();

-- ============================================================================================
-- 12. Completion pools with frozen, versioned definitions
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
  body                 jsonb not null,    -- CompletionDefinition
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

create table wos.pool_events (
  pool_id              uuid not null references wos.completion_pools (id),
  event                text not null check (event in ('payable', 'paid', 'returned')),
  epoch_number         integer not null references wos.epochs (epoch_number),
  definition_version   integer,
  amount_base          bigint not null check (amount_base >= 0),
  created_at           timestamptz not null default now(),
  primary key (pool_id, event)
);

-- ============================================================================================
-- 13. Genesis historical credit (distinct category; shared dedup namespace with receipts)
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
  perform 1 from wos.work_dedup_keys where dedup_key = new.dedup_key and source = 'genesis';
  if not found then
    raise exception 'wos: genesis dedup key % is not a genesis key', new.dedup_key using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger genesis_contributions_dedup before insert on wos.genesis_contributions
  for each row execute function wos.check_genesis_dedup();

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
    'admin_actions', 'policy_documents', 'policy_activations', 'run_policy_snapshots', 'usage_receipts', 'usage_event_ids',
    'epochs', 'epoch_transitions', 'work_dedup_keys', 'contribution_receipts', 'receipt_status_events',
    'reviewer_qualification_events', 'human_reviews', 'review_eval_cases', 'payout_audit_verdicts', 'duty_statements',
    'payout_canaries', 'payout_canary_outcomes', 'run_logs', 'usage_publications', 'receipt_clips', 'epoch_manifest_entries',
    'anomaly_metrics', 'allocation_acceptances', 'allocation_disputes', 'dispute_gates', 'dispute_items', 'dispute_replies',
    'dispute_item_resolutions', 'dispute_settlements', 'allocations', 'claim_leaves', 'settlement_records',
    'offsets', 'wallet_bindings', 'completion_pools', 'completion_definitions', 'pool_accruals', 'pool_events',
    'genesis_contributions', 'abuse_signals', 'risk_flags'
  ] loop
    perform wos.protocol_append_only(t);
    execute format('alter table wos.%I enable row level security', t);
    execute format('grant select, insert on wos.%I to wos_app', t);
  end loop;
end $$;

alter table wos.payout_audit_quorums enable row level security;
grant select, insert, update on wos.payout_audit_quorums to wos_app;

-- Public protocol records (transparency): readable by any actor; writes are control-plane decisions.
do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_actions', 'policy_documents', 'policy_activations', 'run_policy_snapshots', 'usage_event_ids', 'usage_publications',
    'epochs', 'epoch_transitions', 'work_dedup_keys', 'contribution_receipts', 'receipt_status_events', 'receipt_clips',
    'reviewer_qualification_events', 'human_reviews', 'review_eval_cases', 'payout_audit_quorums', 'duty_statements',
    'epoch_manifest_entries', 'allocations', 'claim_leaves', 'settlement_records', 'offsets', 'completion_pools',
    'completion_definitions', 'pool_accruals', 'pool_events', 'genesis_contributions', 'anomaly_metrics',
    'dispute_gates', 'dispute_item_resolutions', 'dispute_settlements'
  ] loop
    execute format('create policy public_read on wos.%I for select to wos_app using (true)', t);
    execute format('create policy privileged_write on wos.%I for insert to wos_app with check (wos.is_privileged())', t);
  end loop;
end $$;

-- Disputes, items, replies and acceptances are public; participants write their own.
do $$
declare
  t text;
begin
  foreach t in array array['allocation_disputes', 'dispute_items', 'dispute_replies', 'allocation_acceptances'] loop
    execute format('create policy public_read on wos.%I for select to wos_app using (true)', t);
  end loop;
end $$;
create policy own_insert on wos.allocation_disputes for insert to wos_app with check (wos.is_privileged() or disputer_account_id = wos.actor_id());
create policy own_insert on wos.dispute_items for insert to wos_app
  with check (wos.is_privileged() or exists (select 1 from wos.allocation_disputes d where d.id = dispute_id and d.disputer_account_id = wos.actor_id()));
create policy own_insert on wos.dispute_replies for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.allocation_acceptances for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy privileged_update on wos.payout_audit_quorums for update to wos_app using (wos.is_privileged()) with check (wos.is_privileged());

-- Sealed until the quorum is revealed; then public (canary verdicts never). Reviewers insert their own verdicts.
create policy sealed_until_revealed on wos.payout_audit_verdicts for select to wos_app
  using (wos.is_privileged() or reviewer_account_id = wos.actor_id()
         or exists (select 1 from wos.payout_audit_quorums q where q.id = quorum_id and q.outcome is not null and not q.is_canary));
create policy reviewer_inserts on wos.payout_audit_verdicts for insert to wos_app
  with check (wos.is_privileged() or reviewer_account_id = wos.actor_id());

-- Usage receipts and run logs: the contributor and privileged actors always; everyone once published (post-finalization).
create policy published_or_own on wos.usage_receipts for select to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id()
         or exists (select 1 from wos.usage_publications p where p.usage_receipt_id = id));
create policy privileged_write on wos.usage_receipts for insert to wos_app with check (wos.is_privileged());
create policy published_or_own on wos.run_logs for select to wos_app
  using (wos.is_privileged()
         or exists (select 1 from wos.agent_runs r where r.id = agent_run_id and r.account_id = wos.actor_id())
         or exists (select 1 from wos.usage_receipts u join wos.usage_publications p on p.usage_receipt_id = u.id where u.agent_run_id = run_logs.agent_run_id));
create policy privileged_write on wos.run_logs for insert to wos_app with check (wos.is_privileged());

-- Wallet bindings: own rows or privileged; the account itself binds.
create policy own_or_privileged on wos.wallet_bindings for select to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.wallet_bindings for insert to wos_app
  with check (wos.is_privileged() or account_id = wos.actor_id());

-- Private: canaries, abuse signals, risk flags (privileged only; published in aggregate).
do $$
declare
  t text;
begin
  foreach t in array array['payout_canaries', 'payout_canary_outcomes', 'abuse_signals', 'risk_flags'] loop
    execute format('create policy privileged_only on wos.%I for all to wos_app using (wos.is_privileged()) with check (wos.is_privileged())', t);
  end loop;
end $$;

grant execute on function wos.epoch_state_at(integer, text), wos.epoch_state(integer), wos.receipt_status(uuid), wos.effective_weight(uuid), wos.reviewer_qualified(uuid), wos.is_maintainer(uuid), wos.bootstrap_on() to wos_app;

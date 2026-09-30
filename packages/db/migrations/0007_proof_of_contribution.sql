-- 0007_proof_of_contribution.sql — DRAFT v6 (review 04/05 fix pass; engine-first enforcement, D51; budget-based rewards,
-- D49; D53-D55), pending Astra review 06. Owner: Lead Architect. DO NOT APPLY TO PRODUCTION. It applies cleanly on 0006
-- (it depends on nothing after 0006) and is exercised by db:test.
--
-- Proof of Contribution (Amendment 02, D18–D51). v5 shrinks the database's job (D51): tables store the outputs of the
-- deterministic engine and rules (packages/contracts/src/protocol), append-only; SQL enforces ONLY the hard invariants
-- listed in section I. Every Astra review 02/03 repro stays rejected, by an invariant here or by a rules/engine test the
-- service must call before writing (REVIEW-PACKET §3e; docs/protocol/PROTOCOL.md §12).

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
-- T. Tables (storage of engine outputs; every one append-only unless noted)
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
    'decide_confiscation_appeal', 'exclude', 'write_off', 'bind_org_wallet', 'approve_budget', 'switch_review_policy')),
  target_kind            text not null,
  target_id              text not null,
  reason                 text not null check (length(btrim(reason)) >= 20),
  payload                jsonb not null default '{}',          -- the exact mutation this action authorizes
  previous_state         jsonb not null,
  resulting_state        jsonb not null,
  requires_co_signer     boolean not null default false,       -- derived by the trigger, never trusted from the caller
  co_signer_account_id   uuid references wos.accounts (id),    -- the named second maintainer; they approve SEPARATELY (A3-7)
  bootstrap_single_signer boolean not null default false,      -- D54: a two-person action single-signed in bootstrap (derived, public)
  operation_sha256       text not null default '',              -- derived: hash of the exact operation (kind, target, payload, prior state)
  prev_hash              bytea not null default '\x00',
  entry_hash             bytea not null default '\x00',
  created_at             timestamptz not null default now()
);

create table wos.admin_action_approvals (
  admin_action_id      uuid primary key references wos.admin_actions (id),
  approver_account_id  uuid not null references wos.accounts (id),
  operation_sha256     text not null,
  approved_at          timestamptz not null default now()
);

create table wos.admin_action_uses (
  admin_action_id  uuid primary key references wos.admin_actions (id),
  consumer         text not null,
  used_at          timestamptz not null default now()
);

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

alter table wos.leases add column generation integer;

update wos.leases l set generation = g.n
  from (select id, row_number() over (partition by task_id order by issued_at, id) as n from wos.leases) g
 where g.id = l.id;

alter table wos.leases alter column generation set not null;

alter table wos.leases add constraint leases_generation_positive check (generation > 0);

create unique index leases_task_generation on wos.leases (task_id, generation);

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

create table wos.qualification_results (
  id                      uuid primary key default gen_random_uuid(),
  subject_kind            text not null check (subject_kind in ('attempt', 'document')),
  subject_id              uuid not null,
  subject_revision        text not null check (subject_revision ~ '^[0-9a-f]{40}$'),   -- head sha of the accepted round
  lease_id                uuid not null references wos.leases (id),
  lease_generation        integer not null,
  changeset_id            uuid not null references wos.changesets (id),
  round_id                uuid not null references wos.rounds (id),
  verification_run_id     uuid references wos.verification_runs (id),
  human_review_id         uuid,                                                          -- FK added after human_reviews
  policy_snapshot_sha256  text not null,
  evidence                jsonb not null,
  evidence_sha256         text not null check (evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at             timestamptz not null default now()
);

alter table wos.tasks drop constraint tasks_kind_check;

alter table wos.tasks add constraint tasks_kind_check check (kind in ('roadmap_author', 'roadmap_review', 'feature_author',
  'feature_review', 'abu_build', 'abu_revision', 'implementation_review', 'conflict_resolution', 'payout_audit'));

alter table wos.tasks drop constraint tasks_role_check;

alter table wos.tasks add constraint tasks_role_check check (role in ('roadmap_author', 'roadmap_reviewer_astra',
  'roadmap_reviewer_fable', 'feature_author', 'feature_reviewer_astra', 'feature_reviewer_fable', 'builder',
  'implementation_reviewer_astra', 'implementation_reviewer_fable', 'conflict_resolver', 'payout_auditor'));

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

create table wos.publication_consents (
  account_id          uuid not null references wos.accounts (id),
  disclosure_version  text not null,
  disclosure_sha256   text not null check (disclosure_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at          timestamptz not null default now(),
  primary key (account_id, disclosure_version)
);

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

create table wos.usage_publications (
  usage_receipt_id  uuid primary key references wos.usage_receipts (id),
  epoch_number      integer not null,
  created_at        timestamptz not null default now()
);

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
  holdback_bp         integer not null default 2000 check (holdback_bp between 0 and 10000),    -- pinned per epoch (D49: 20%/6 recommended, F15)
  holdback_epochs     integer not null default 6 check (holdback_epochs > 0),
  -- D49: pinned when the epoch is defined (from the engine and the policy); no task is issued without them.
  issuance_rate_base_per_acu bigint check (issuance_rate_base_per_acu > 0),
  task_capacity_base  bigint check (task_capacity_base >= 0),
  -- Review 05 B3: the reserve snapshot and demand forecast the envelope was computed from (engine openEpoch; rule
  -- epochEnvelopeRefusals compares the pinned rate and capacity with the engine's). Pinned together or not at all.
  reserve_snapshot_base      bigint check (reserve_snapshot_base >= 0),
  demand_forecast_acu_micro  bigint check (demand_forecast_acu_micro >= 0),
  budget_expiry_epochs integer not null default 4 check (budget_expiry_epochs > 0),
  budget_human_above_bp integer not null default 12500 check (budget_human_above_bp >= 10000),
  budget_hard_max_bp  integer not null default 20000 check (budget_hard_max_bp >= 10000),
  review_grace_epochs integer not null default 2 check (review_grace_epochs >= 0),   -- review 06 R06-5: pinned on each budget
  provisional_challenge_hours integer not null default 48 check (provisional_challenge_hours > 0),  -- D54 window, pinned on publication
  policy_versions     jsonb not null,
  created_at          timestamptz not null default now(),
  check (ends_at > starts_at),
  check (mode <> 'test' or cluster = 'devnet'),        -- H7: test epochs are devnet only
  check ((issuance_rate_base_per_acu is null) = (task_capacity_base is null)
     and (issuance_rate_base_per_acu is null) = (reserve_snapshot_base is null)
     and (issuance_rate_base_per_acu is null) = (demand_forecast_acu_micro is null))
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

create table wos.acceptance_objectives (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('feature_criterion', 'planning_deliverable', 'review_round', 'audit', 'resolution')),
  ref                   text not null,
  budget_acu_micro      bigint not null check (budget_acu_micro > 0),
  budget_model_version  text not null,
  consensus_round_id    uuid references wos.rounds (id),
  created_at            timestamptz not null default now(),
  unique (kind, ref)                                  -- review 05 B1: one objective per canonical work identity (I4)
);

create table wos.task_budgets (
  task_id                     uuid primary key,
  objective_id                uuid not null references wos.acceptance_objectives (id),
  kind                        text not null check (kind in ('execution', 'planning', 'human_review')),
  budget_acu_micro            bigint not null check (budget_acu_micro > 0),
  model_acu_micro             bigint not null check (model_acu_micro > 0),
  basis                       jsonb not null,               -- expected compute, size points, difficulty, importance, shared dependency
  justification               text not null default '' check (length(justification) <= 4000),
  budget_model_version        text not null,
  proposer_account_id         uuid not null references wos.accounts (id),
  approval_admin_action_id    uuid references wos.admin_actions (id),
  issued_epoch                integer not null references wos.epochs (epoch_number),
  issuance_rate_base_per_acu  bigint not null default 0,    -- server-set from the epoch
  reserved_base               bigint not null default 0,    -- server-set: budget x rate / 1e6
  expires_epoch               integer not null default 0,   -- server-set: issued epoch + the epoch's budget expiry
  -- Review 06 R06-5: the review grace and reward-policy version PINNED at issuance (never re-read from a later policy).
  review_grace_epochs         integer not null default 0,   -- server-set from the epoch
  policy_version              text not null default '',     -- server-set from the epoch's pinned reward policy
  -- Review 06: a re-issue is a NEW task/reservation generation linked to the one it replaces (released or expired).
  reissue_of                  uuid unique references wos.task_budgets (task_id),
  created_at                  timestamptz not null default now()
);

-- Review 06 R06-5: the authoritative submission event of commissioned work (on time = before the budget's expiry).
create table wos.task_submissions (
  task_id            uuid primary key references wos.task_budgets (task_id),
  -- Review 07 R07-4: the accepted submission itself is the evidence (its server time); the epoch and hash are DERIVED.
  changeset_id       uuid not null references wos.changesets (id),
  submitted_at       timestamptz not null default now(),   -- server-set: the changeset's creation time
  submitted_epoch    integer not null default 0,           -- server-set from submitted_at and the epoch calendar
  submission_sha256  text not null default '',             -- server-set: the changeset's diff hash
  created_at         timestamptz not null default now()
);



create table wos.task_budget_releases (
  task_id     uuid primary key references wos.task_budgets (task_id),
  reason      text not null check (reason in ('expired', 'failed', 'abandoned', 'cancelled', 'repriced')),
  -- Review 06 R06-4 / 07 R07-4: releasing SUBMITTED work names its final rejection or its authorized cancellation.
  final_rejection_ref text,
  admin_action_id     uuid references wos.admin_actions (id),
  created_at  timestamptz not null default now()
);

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
  evidence_class        text not null check (evidence_class in ('accepted_budget', 'outcome')),
  acceptance_event      text not null,
  independence          text not null check (independence in ('independent', 'founder_bootstrap')),
  initial_status        text not null check (initial_status in ('ACTIVE', 'PROVISIONAL')),
  weight_micro          bigint not null check (weight_micro >= 0),   -- D49: the task budget, or an outcome's ACU-equivalent
  task_id               uuid references wos.task_budgets (task_id),  -- D49: the budget this receipt is paid from
  share_bp              integer check (share_bp between 1 and 10000), -- D49: this contributor's declared share
  lowest_verification   text check (lowest_verification in ('VERIFIED', 'ATTESTED', 'ESTIMATED', 'UNVERIFIED')),  -- telemetry only
  usage_receipt_ids     uuid[] not null default '{}',                 -- telemetry only
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
  check ((evidence_class = 'accepted_budget') = (task_id is not null)),
  check ((task_id is null) = (share_bp is null)),
  unique (task_id, account_id),
  check ((lease_id is null) = (lease_generation is null)),
  check ((beneficiary_org_id is null) = (sponsorship_id is null)),
  check (beneficiary_org_id is not null or beneficiary_org_share_bp = 0)
);

create index contribution_receipts_account on wos.contribution_receipts (account_id, created_at);

create table wos.receipt_status_events (
  receipt_id       uuid not null references wos.contribution_receipts (id),
  seq              integer not null,
  from_status      text check (from_status in ('ACTIVE', 'PROVISIONAL', 'RATIFIED', 'FINAL_BY_SILENCE', 'REVOKED')),
  to_status        text not null check (to_status in ('ACTIVE', 'PROVISIONAL', 'RATIFIED', 'FINAL_BY_SILENCE', 'REVOKED')),
  kind             text not null check (kind in ('issued', 'quorum_ratified', 'human_signoff', 'ratification_rejected', 'final_by_silence',
                                                  'revoked', 'restored')),
  quorum_id        uuid,
  human_review_id  uuid,
  admin_action_id  uuid references wos.admin_actions (id),
  resolution_allocation_id uuid,                     -- A3-7: a dispute-driven revocation names the final REVOKED resolution
  at               timestamptz not null default now(),
  primary key (receipt_id, seq)
);

-- D54 / review 06 R06-2: a PROVISIONAL receipt's challenge publication (after bootstrap ended; server-stamped; window
-- pinned), its free challenges (V1: a flag that sends the receipt to the review gate; no stake), under one subject lock.
create table wos.provisional_publications (
  receipt_id           uuid primary key references wos.contribution_receipts (id),
  receipt_sha256       text not null check (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  review_policy_version text not null,
  bootstrap_ended_at   timestamptz not null default now(),   -- server-set
  window_hours         integer not null default 0,           -- server-set from the receipt's epoch
  published_at         timestamptz not null default now(),   -- server-set
  closes_at            timestamptz not null default now(),   -- server-set: published_at + window
  notification         jsonb not null,                       -- public place and notified participants (evidence)
  check (notification ? 'publicUrl' and notification ? 'notifiedParticipants')
);
create table wos.provisional_challenges (
  id                   uuid primary key default gen_random_uuid(),
  receipt_id           uuid not null references wos.provisional_publications (receipt_id),
  challenger_account_id uuid not null references wos.accounts (id),
  reason_untrusted     text not null check (length(reason_untrusted) between 20 and 4000),
  created_at           timestamptz not null default now()
);

create table wos.contribution_usage (
  usage_receipt_id  uuid primary key references wos.usage_receipts (id),
  receipt_id        uuid not null references wos.contribution_receipts (id)
);

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

alter table wos.qualification_results add constraint qualification_results_human_review_fk foreign key (human_review_id) references wos.human_reviews (id);

-- Review 05 B6: a commissioned human review is a server-owned assignment of a human_review task budget to one
-- reviewer for one subject; the review cites it and a HUMAN_REVIEW receipt is paid only through it (rule
-- receiptRouteRefusals). One assignment per task (I4).
create table wos.human_review_assignments (
  task_id              uuid primary key,
  reviewer_account_id  uuid not null references wos.accounts (id),
  subject_kind         text not null check (subject_kind in ('attempt', 'document', 'receipt', 'genesis', 'security_report')),
  subject_id           uuid not null,
  risk_class           text not null,
  created_at           timestamptz not null default now()
);
alter table wos.human_reviews add column assignment_task_id uuid references wos.human_review_assignments (task_id);
create unique index human_reviews_one_per_assignment on wos.human_reviews (assignment_task_id) where assignment_task_id is not null;

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

create table wos.payout_audit_assignments (
  id                   uuid primary key default gen_random_uuid(),
  quorum_id            uuid not null references wos.payout_audit_quorums (id),
  slot                 integer not null check (slot > 0),
  outside_feature      boolean not null,
  packet_sha256        text not null check (packet_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  reviewer_account_id  uuid not null references wos.accounts (id),
  task_id              uuid not null unique references wos.tasks (id),
  lease_id             uuid not null unique references wos.leases (id),
  lease_generation     integer not null,
  permitted_provider   text not null check (permitted_provider in ('claude_cli', 'codex_cli')),
  review_policy_version text not null,
  created_at           timestamptz not null default now(),
  unique (quorum_id, slot),
  unique (quorum_id, reviewer_account_id)
);

create table wos.payout_audit_verdicts (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null unique references wos.payout_audit_assignments (id),   -- redeemed once (A3-6)
  quorum_id           uuid not null references wos.payout_audit_quorums (id),
  slot                integer not null check (slot > 0),
  outside_feature     boolean not null,
  packet_sha256       text not null check (packet_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  reviewer_account_id uuid not null references wos.accounts (id),
  task_id             uuid not null references wos.tasks (id),
  lease_id            uuid not null references wos.leases (id),
  agent_run_id        uuid not null unique references wos.agent_runs (id),                 -- a run is used once (A3-6)
  provider            text not null check (provider in ('claude_cli', 'codex_cli')),
  judgment            text not null check (judgment in ('plausible', 'inflated', 'misattributed', 'insufficient_evidence')),
  body                jsonb not null,
  verdict_sha256      text not null unique check (verdict_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  sealed_at           timestamptz not null default now(),
  unique (quorum_id, slot),
  unique (quorum_id, reviewer_account_id)
);

create table wos.payout_audit_outcomes (
  quorum_id       uuid primary key references wos.payout_audit_quorums (id),
  receipt_id      uuid not null references wos.contribution_receipts (id),
  outcome         text not null check (outcome in ('ratified', 'findings', 'expired')),
  verdict_sha256s text[] not null,
  published_at    timestamptz not null default now()
);

create table wos.receipt_clips (
  receipt_id           uuid primary key references wos.contribution_receipts (id),
  new_weight_micro     bigint not null check (new_weight_micro >= 0),
  quorum_id            uuid references wos.payout_audit_quorums (id),
  admin_action_id      uuid not null references wos.admin_actions (id),
  auditor_account_ids  uuid[] not null check (cardinality(auditor_account_ids) > 0),
  created_at           timestamptz not null default now()
);

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

create unique index duty_events_one_end on wos.duty_events (offer_id) where seq > 1;

create table wos.payout_canaries (
  id                    uuid primary key default gen_random_uuid(),
  quorum_id             uuid not null unique references wos.payout_audit_quorums (id),
  packet_id             uuid not null unique,
  line_ref              text not null check (line_ref ~ '^L[0-9]{1,3}$'),
  source_receipt_id     uuid not null references wos.contribution_receipts (id),
  perturbator_version   text not null,
  seed_sha256           text not null check (seed_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  perturbation          text not null check (perturbation in ('budget_mismatch', 'unmet_acceptance', 'split_stacking', 'duplicated_attribution', 'wrong_split')),
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

-- Review 07 R07-2: the V1 free challenge of an ordinary (ACTIVE) allocation — no stake, no bounty, no appeal (D55).
-- Bound to the frozen receipt revision and the epoch's published allocations root; the accused replies; one decision.
create table wos.allocation_challenges (
  id                    uuid primary key default gen_random_uuid(),
  allocation_id         uuid not null references wos.allocations (id),
  receipt_id            uuid not null references wos.contribution_receipts (id),
  receipt_sha256        text not null check (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  allocations_root      text not null check (allocations_root ~ '^sha256:[0-9a-f]{64}$'),
  challenger_account_id uuid not null references wos.accounts (id),
  reason_untrusted      text not null check (length(reason_untrusted) between 20 and 4000),
  created_at            timestamptz not null default now()
);
create table wos.allocation_challenge_replies (
  challenge_id     uuid primary key references wos.allocation_challenges (id),
  account_id       uuid not null references wos.accounts (id),
  body_untrusted   text not null check (length(body_untrusted) between 1 and 4000),
  created_at       timestamptz not null default now()
);
create table wos.allocation_challenge_decisions (
  challenge_id          uuid primary key references wos.allocation_challenges (id),
  outcome               text not null check (outcome in ('confirmed', 'changed')),
  resulting_amount_base bigint not null check (resulting_amount_base >= 0),
  admin_action_id       uuid not null references wos.admin_actions (id),
  decided_at            timestamptz not null default now()
);

create table wos.anomaly_metrics (
  epoch_number   integer not null references wos.epochs (epoch_number),
  beneficiary_id uuid not null,
  metrics        jsonb not null,
  rank_score     bigint not null,
  created_at     timestamptz not null default now(),
  primary key (epoch_number, beneficiary_id)
);

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
  opened_at            timestamptz not null default now(),
  opened_txid          bigint not null default txid_current()   -- I1: items are written in this transaction only
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
  reason               text not null check (reason in ('budget_mismatch', 'unmet_acceptance', 'defective_work', 'misattribution', 'duplicate_work', 'split_gaming', 'other')),
  evidence             jsonb not null,
  proposed_amount_base bigint check (proposed_amount_base >= 0),
  stake_base           bigint not null check (stake_base > 0),
  created_at           timestamptz not null default now(),
  primary key (dispute_id, allocation_id)
);

create table wos.dispute_replies (
  allocation_id    uuid not null references wos.dispute_gates (allocation_id),
  account_id       uuid not null references wos.accounts (id),
  body_untrusted   text not null check (length(body_untrusted) <= 4000),
  evidence         jsonb not null default '[]',
  created_at       timestamptz not null default now(),
  primary key (allocation_id, created_at)
);

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

create table wos.dispute_appeals (
  allocation_id         uuid primary key references wos.dispute_item_resolutions (allocation_id),
  appellant_account_id  uuid not null references wos.accounts (id),
  statement_untrusted   text not null check (length(statement_untrusted) between 20 and 4000),
  created_at            timestamptz not null default now()
);

create table wos.dispute_appeal_decisions (
  allocation_id          uuid primary key references wos.dispute_appeals (allocation_id),
  decision               text not null check (decision in ('confirmed', 'reversed')),
  final_amount_base      bigint not null check (final_amount_base >= 0),
  admin_action_id        uuid not null references wos.admin_actions (id),
  created_at             timestamptz not null default now()
);

create table wos.dispute_settlements (
  dispute_id             uuid primary key references wos.allocation_disputes (id),
  total_excess_base      bigint not null check (total_excess_base >= 0),
  recovered_base         bigint not null check (recovered_base >= 0),
  bounty_base            bigint not null check (bounty_base >= 0),
  stake_forfeited_base   bigint not null check (stake_forfeited_base >= 0),
  settled_in_epoch       integer not null references wos.epochs (epoch_number),
  created_at             timestamptz not null default now()
);

create table wos.entitlements (
  id                uuid primary key default gen_random_uuid(),
  epoch_number      integer not null references wos.epochs (epoch_number),
  cluster           text not null default '' ,                       -- server-set from the epoch
  mode              text not null default '',                        -- server-set from the epoch
  beneficiary_kind  text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id    uuid not null,
  kind              text not null check (kind in ('release_now', 'holdback_tranche', 'holdback_matured', 'bounty', 'genesis_vesting', 'withheld_release')),
  source_kind       text not null check (source_kind in ('allocation', 'tranche', 'dispute_settlement', 'genesis')),
  source_id         uuid not null,
  amount_base       bigint not null check (amount_base > 0),
  matures_epoch     integer,                                         -- server-set for a tranche: epoch + pinned holdback epochs
  policy_version    text,                                            -- server-set: the epoch's pinned reward policy
  withheld_epochs   integer not null default 0 check (withheld_epochs >= 0),
  flags             text[] not null default '{}',
  -- Review 04 finding 2: a tranche (or a withheld allocation) may be released in several parts when a hold on part of
  -- it is lifted later; each part has its sequence number. Over-release is refused by the conservation check (I8).
  release_seq       integer not null default 1 check (release_seq >= 1),
  created_at        timestamptz not null default now(),
  unique (source_kind, source_id, kind, release_seq),
  check (release_seq = 1 or kind in ('holdback_matured', 'withheld_release')),
  check ((kind in ('release_now', 'withheld_release', 'holdback_tranche')) = (source_kind = 'allocation')),
  check ((kind = 'holdback_matured') = (source_kind = 'tranche')),
  check ((kind = 'bounty') = (source_kind = 'dispute_settlement')),
  check (flags <@ array['unaudited', 'released_after_dispute']::text[])
);

create table wos.claim_leaves (
  id                  uuid primary key default gen_random_uuid(),
  cluster             text not null check (cluster in ('devnet', 'mainnet-beta')),
  beneficiary_kind    text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id      uuid not null,
  wallet              text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount_base         bigint not null check (amount_base > 0),
  adapter_generation  integer not null check (adapter_generation > 0),
  leaf_sha256         text not null check (leaf_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at          timestamptz not null default now(),
  check (cluster = 'devnet')             -- default-deny mainnet at the settlement boundary (MAINNET-READINESS gate)
);

create table wos.leaf_voids (
  leaf_id          uuid primary key references wos.claim_leaves (id),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);

create table wos.entitlement_claims (
  entitlement_id  uuid not null references wos.entitlements (id),
  leaf_id         uuid not null references wos.claim_leaves (id),
  amount_base     bigint not null check (amount_base > 0),       -- A3-2/A3-4: the entitlement's whole REMAINING balance
  primary key (entitlement_id, leaf_id)
);

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
  leaf_id               uuid not null,
  attempt               integer not null,
  outcome               text not null check (outcome in ('confirmed', 'expired_not_landed')),
  commitment            text check (commitment in ('processed', 'confirmed', 'finalized')),
  slot                  bigint,
  history_checked       boolean not null default false,
  observed_block_height bigint,
  status_observation    jsonb,                 -- the getSignatureStatuses(searchTransactionHistory) response, verbatim
  at                    timestamptz not null default now(),
  primary key (leaf_id, attempt),
  foreign key (leaf_id, attempt) references wos.settlement_attempts (leaf_id, attempt),
  check (outcome <> 'confirmed' or (commitment is not null and commitment = 'finalized' and slot is not null)),
  check (outcome <> 'expired_not_landed' or (history_checked and observed_block_height is not null and status_observation is not null))
);

create unique index settlement_one_confirmed on wos.settlement_outcomes (leaf_id) where outcome = 'confirmed';

create table wos.offsets (
  id               uuid primary key default gen_random_uuid(),
  beneficiary_kind text not null check (beneficiary_kind in ('person', 'organization')),
  beneficiary_id   uuid not null,
  receipt_id       uuid references wos.contribution_receipts (id),
  amount_base      bigint not null check (amount_base > 0),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);

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
  hold_expires_at    timestamptz not null,                        -- review 04 finding 4: finite, bounded from notice (rule, F17)
  check (appeal_closes_at >= reply_closes_at),
  check (isfinite(reply_closes_at) and isfinite(appeal_closes_at) and isfinite(hold_expires_at) and hold_expires_at >= appeal_closes_at)
);

create table wos.confiscation_appeals (
  confiscation_id       uuid primary key references wos.confiscations (id),
  appellant_account_id  uuid not null references wos.accounts (id),
  statement_untrusted   text not null check (length(statement_untrusted) between 20 and 4000),
  created_at            timestamptz not null default now()
);

create table wos.confiscation_appeal_decisions (
  confiscation_id  uuid primary key references wos.confiscation_appeals (confiscation_id),
  decision         text not null check (decision in ('upheld', 'overturned')),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);

create table wos.confiscation_sources (
  confiscation_id  uuid not null references wos.confiscations (id),
  source_kind      text not null check (source_kind in ('pending_allocation', 'holdback', 'unclaimed_entitlement', 'genesis_unvested')),
  source_id        uuid not null,
  amount_base      bigint not null check (amount_base > 0),
  created_at       timestamptz not null default now(),
  primary key (confiscation_id, source_kind, source_id)
);

create table wos.confiscation_executions (
  confiscation_id  uuid primary key references wos.confiscations (id),
  executed_at      timestamptz not null default now()
);

create table wos.exclusions (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references wos.accounts (id),
  scope                   text[] not null check (scope <@ array['rewards', 'voting', 'review', 'duty']::text[] and cardinality(scope) > 0),
  until_epoch             integer,                                   -- null = permanent
  governance_proposal_id  uuid,
  admin_action_id         uuid not null references wos.admin_actions (id),
  created_at              timestamptz not null default now()
);

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

create table wos.pool_accrual_corrections (
  id               uuid primary key default gen_random_uuid(),
  pool_id          uuid not null references wos.completion_pools (id),
  receipt_id       uuid not null references wos.contribution_receipts (id),
  amount_base      bigint not null check (amount_base > 0),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now(),
  unique (pool_id, receipt_id)
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

create unique index pool_events_one_terminal on wos.pool_events (pool_id) where event in ('paid', 'returned');

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
  admin_action_id          uuid not null references wos.admin_actions (id),
  recorded_at              timestamptz not null default now()
);

create table wos.genesis_commit_claims (
  commit_sha               text primary key check (commit_sha ~ '^[0-9a-f]{40}$'),
  genesis_contribution_id  uuid not null references wos.genesis_contributions (id)
);

create table wos.genesis_reference_manifests (
  version          text primary key,
  cutoff_epoch     integer not null references wos.epochs (epoch_number),
  rules            jsonb not null,
  receipt_ids      uuid[] not null check (cardinality(receipt_ids) > 0),
  manifest_sha256  text not null unique check (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  admin_action_id  uuid not null references wos.admin_actions (id),
  created_at       timestamptz not null default now()
);

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

create table wos.confiscation_releases (
  confiscation_id  uuid primary key references wos.confiscations (id),
  reason           text not null check (reason in ('overturned', 'lapsed')),
  created_at       timestamptz not null default now()
);

-- D58: per ruled finding, which lab raised it, which resolved it, and the outcome — queryable, so resolver bias toward
-- its own lab can be measured. `raised_by_lab` is derived by the server from the finding's review; a resolver never
-- comes from the raising lab (the human maintainer is 'human').
create table wos.ruling_lab_records (
  ruling_id        uuid not null references wos.rulings (id),
  finding_id       uuid not null references wos.findings (id),
  raised_by_lab    text not null default '' check (raised_by_lab in ('', 'anthropic', 'openai', 'zai')),
  resolved_by_lab  text not null default '' check (resolved_by_lab in ('', 'anthropic', 'openai', 'zai', 'human')),  -- server-derived (R07-7)
  outcome          text not null check (outcome in ('upheld', 'overruled')),
  created_at       timestamptz not null default now(),
  primary key (ruling_id, finding_id),
  check (resolved_by_lab <> raised_by_lab)
);
create index ruling_lab_records_labs on wos.ruling_lab_records (raised_by_lab, resolved_by_lab, outcome);

create table wos.epoch_balances (
  epoch_number        integer primary key references wos.epochs (epoch_number),
  emission_reserve    bigint not null check (emission_reserve > 0),
  remaining_reserve   bigint not null check (remaining_reserve >= 0),
  pools               bigint not null check (pools >= 0),
  security_reserve    bigint not null check (security_reserve >= 0),
  reserved_budgets    bigint not null check (reserved_budgets >= 0),
  issued              bigint not null check (issued >= 0),
  holdback            bigint not null check (holdback >= 0),
  claimable           bigint not null check (claimable >= 0),
  result_sha256       text not null check (result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at          timestamptz not null default now(),
  check (remaining_reserve + pools + security_reserve + reserved_budgets + issued = emission_reserve),
  check (holdback + claimable <= issued)
);

-- ============================================================================================
-- I. HARD INVARIANTS (D51). Only what must hold even if the application is buggy. Every other protocol rule is a
-- pure function in packages/contracts/src/protocol/{rules,engine,governance,machines}.ts that the service layer MUST
-- call, inside the writing transaction, before it writes (REVIEW-PACKET §3e maps every review repro to its guard).
--   I1  append-only: no UPDATE/DELETE/TRUNCATE on protocol records (loop in section S), except the two fields that are
--       set exactly once (quorum outcome, gate bounty priority) and expired run-log bodies
--   I2  server time on every time the rules read (the caller's clock is never trusted)
--   I3  admin actions: hash-chained, maintainer actor, two-person derived from the kind, co-signer named
--   I4  uniqueness: keys and partial unique indexes (one entitlement per (source, kind), one confirmed settlement per
--       leaf and at most one live leaf per entitlement via conservation, one wallet per beneficiary per cluster, one
--       lease generation per task, one terminal duty event, one terminal pool event, one use per admin action)
--   I5  lease generation fencing; a budget is fixed before any lease and its proposer never takes the lease
--   I6  reviewer independence and no self-review (agent seats, human reviews, audit seats)
--   I7  serialized epoch publication: the transition machine, and nothing written to an epoch after it is published
--   I8  conservation at commit: one deferred check over every balance the protocol moves (no source over-consumed,
--       no capacity over-reserved, shares exactly 10000, stakes within pending) plus the epoch funding equation (CHECK)
--   I9  settlement finality: persisted signed attempts, one unresolved attempt, proven expiry and finalized
--       confirmation by a typed observation of the attempt's own signature, a shared fence with pause/snapshot, no void
--       of a leaf that may still pay; a confiscation ends once (executed or released, serialized)
-- ============================================================================================

-- I2: server time. A generic stamp: `create trigger ... execute function wos.stamp_now('column')`.
create or replace function wos.stamp_now() returns trigger
language plpgsql as $$
begin
  new := jsonb_populate_record(new, jsonb_build_object(tg_argv[0], clock_timestamp()));
  return new;
end $$;

-- I3: admin actions.
create or replace function wos.two_person_action(a text) returns boolean
language sql immutable as $$
  select a in ('invalidate_receipt', 'suspend_account', 'record_offset', 'activate_policy', 'activate_oracle',
               'record_genesis', 'approve_genesis_reference', 'confiscate', 'exclude', 'clip_receipt',
               'switch_adapter', 'write_off', 'decide_confiscation_appeal', 'approve_budget')
$$;
create or replace function wos.operation_sha256(action text, tkind text, tid text, payload jsonb, prior jsonb) returns text
language sql immutable as $$
  select 'sha256:' || encode(sha256(convert_to(concat_ws('|', action, tkind, tid, payload::text, prior::text), 'UTF8')), 'hex')
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
  -- D54: during bootstrap the founder is never blocked on recruiting a second person: a two-person action without a
  -- co-signer is single-signed, derived and labelled (public in the chain). Outside bootstrap it needs the co-signer.
  new.bootstrap_single_signer := new.requires_co_signer and new.co_signer_account_id is null and wos.bootstrap_on();
  if new.bootstrap_single_signer then
    new.requires_co_signer := false;
  elsif new.requires_co_signer and (new.co_signer_account_id is null or new.co_signer_account_id = new.actor_account_id
                                 or not wos.is_maintainer(new.co_signer_account_id)) then
    raise exception 'wos: % needs a second maintainer as co-signer', new.action using errcode = 'check_violation';
  end if;
  if new.action = 'bootstrap_merge' and not wos.bootstrap_on() then
    raise exception 'wos: bootstrap_merge outside bootstrap mode' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(7313372);
  select entry_no, entry_hash into last_no, last_hash from wos.admin_actions order by entry_no desc limit 1;
  new.entry_no := coalesce(last_no, 0) + 1;
  new.prev_hash := coalesce(last_hash, '\x00'::bytea);
  new.created_at := date_trunc('milliseconds', clock_timestamp());
  new.operation_sha256 := wos.operation_sha256(new.action, new.target_kind, new.target_id, new.payload, new.previous_state);
  new.entry_hash := sha256(new.prev_hash || convert_to(concat_ws('|', new.entry_no, new.id, new.actor_account_id, new.action,
      new.target_kind, new.target_id, new.reason, new.payload::text, new.previous_state::text, new.resulting_state::text,
      new.requires_co_signer, coalesce(new.co_signer_account_id::text, ''), new.bootstrap_single_signer,
      to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), 'UTF8'));
  return new;
end $$;
create trigger admin_actions_chain before insert on wos.admin_actions for each row execute function wos.admin_actions_chain();

-- I5: lease generation fencing.
create or replace function wos.leases_assign_generation() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.lease_gen:' || new.task_id::text));
  select coalesce(max(generation), 0) + 1 into new.generation from wos.leases where task_id = new.task_id;
  -- D49: the proposer of this task's budget (or a related account) never takes its lease.
  if exists (select 1 from wos.task_budgets b where b.task_id = new.task_id and wos.related_accounts(b.proposer_account_id, new.account_id)) then
    raise exception 'wos: the proposer of this task''s budget (or a related account) may not take its lease' using errcode = 'check_violation';
  end if;
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

-- I6: related accounts = same account, the same TEAM organization, or ever sponsored by the same organization.
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
create or replace function wos.check_review_related() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  builder uuid;
begin
  perform pg_advisory_xact_lock(hashtext('wos.round:' || new.round_id::text));
  select a.account_id into builder from wos.rounds r join wos.attempts a on a.id = r.attempt_id where r.id = new.round_id;
  if new.independence = 'independent' and (
       (builder is not null and builder <> new.account_id and wos.related_accounts(builder, new.account_id))
    or exists (select 1 from wos.rounds r join wos.tasks t on t.document_id = r.document_id join wos.changesets c on c.task_id = t.id and c.ok
                where r.id = new.round_id and wos.related_accounts(c.account_id, new.account_id))) then
    raise exception 'wos: reviewer % is (related to) the author of this subject', new.account_id using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.reviews o where o.round_id = new.round_id and o.account_id <> new.account_id and wos.related_accounts(o.account_id, new.account_id))
     or exists (select 1 from wos.human_reviews h where h.round_id = new.round_id and wos.related_accounts(h.reviewer_account_id, new.account_id)) then
    raise exception 'wos: related accounts may not fill two seats of one round (agent or human)' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger reviews_related before insert on wos.reviews for each row execute function wos.check_review_related();

create or replace function wos.check_human_review_independence() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  author uuid;
begin
  new.sealed_at := clock_timestamp();
  select case new.subject_kind
           when 'attempt' then (select account_id from wos.attempts where id = new.subject_id)
           when 'receipt' then (select account_id from wos.contribution_receipts where id = new.subject_id)
           when 'genesis' then (select contributor_account_id from wos.genesis_contributions where id = new.subject_id) end into author;
  if author = new.reviewer_account_id then
    raise exception 'wos: a human reviewer may not review their own work' using errcode = 'check_violation';
  end if;
  if (author is not null and wos.related_accounts(author, new.reviewer_account_id))
     or (new.subject_kind = 'document' and exists (select 1 from wos.changesets c join wos.tasks t on t.id = c.task_id
          where t.document_id = new.subject_id and c.ok and wos.related_accounts(c.account_id, new.reviewer_account_id))) then
    raise exception 'wos: a human reviewer may not review a related account''s work' using errcode = 'check_violation';
  end if;
  if new.round_id is not null then
    perform pg_advisory_xact_lock(hashtext('wos.round:' || new.round_id::text));
    if exists (select 1 from wos.reviews v where v.round_id = new.round_id and wos.related_accounts(v.account_id, new.reviewer_account_id)) then
      raise exception 'wos: the human reviewer (or a related account) already holds an agent seat of this round' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger human_reviews_independence before insert on wos.human_reviews for each row execute function wos.check_human_review_independence();

create or replace function wos.check_audit_seat_independence() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  author uuid;
begin
  perform pg_advisory_xact_lock(hashtext('wos.quorum:' || new.quorum_id::text));
  select c.account_id into author from wos.payout_audit_quorums q join wos.contribution_receipts c on c.id = q.receipt_id where q.id = new.quorum_id;
  if author is not null and wos.related_accounts(author, new.reviewer_account_id) then
    raise exception 'wos: a contributor (or a related account) may not audit this receipt' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.payout_audit_assignments o where o.quorum_id = new.quorum_id and o.id <> new.id
              and wos.related_accounts(o.reviewer_account_id, new.reviewer_account_id)) then
    raise exception 'wos: related accounts may not fill two seats of one audit quorum' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payout_audit_assignments_independence before insert on wos.payout_audit_assignments
  for each row execute function wos.check_audit_seat_independence();

-- I1 (set-once fields): a quorum is created without an outcome and gets one exactly once; a gate's bounty priority is
-- taken once. Everything else in these rows is immutable.
create or replace function wos.quorum_outcome_once() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.outcome is not null then
    raise exception 'wos: a quorum is created without an outcome (no pre-ratified quorums)' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (old.outcome is not null or new.receipt_id is distinct from old.receipt_id or new.size <> old.size
                           or new.is_canary <> old.is_canary or new.purpose <> old.purpose) then
    raise exception 'wos: a quorum''s outcome is set once and nothing else changes' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger payout_audit_quorums_once before insert or update on wos.payout_audit_quorums for each row execute function wos.quorum_outcome_once();
create trigger payout_audit_quorums_no_delete before delete or truncate on wos.payout_audit_quorums for each statement execute function wos.forbid_mutation();
create or replace function wos.dispute_gate_priority_once() returns trigger
language plpgsql as $$
begin
  if old.priority_dispute_id is not null or new.allocation_id <> old.allocation_id or new.reply_deadline_at <> old.reply_deadline_at then
    raise exception 'wos: a gate''s priority is set once and nothing else changes' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_gates_once before update on wos.dispute_gates for each row execute function wos.dispute_gate_priority_once();
create trigger dispute_gates_no_delete before delete or truncate on wos.dispute_gates for each statement execute function wos.forbid_mutation();
-- A dispute's items are its frozen bundle: written in the transaction that opened it, never later (H10).
create or replace function wos.dispute_items_frozen() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if (select opened_txid from wos.allocation_disputes where id = new.dispute_id) is distinct from txid_current() then
    raise exception 'wos: dispute items are written only with their dispute (frozen bundle)' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger dispute_items_frozen before insert on wos.dispute_items for each row execute function wos.dispute_items_frozen();

-- I7: serialized epoch publication.
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
  cur_at timestamptz;
  ep wos.epochs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('wos.epoch:' || new.epoch_number::text));
  select * into ep from wos.epochs where epoch_number = new.epoch_number;
  select to_state, at into cur, cur_at from wos.epoch_transitions where epoch_number = new.epoch_number order by seq desc limit 1;
  new.seq := coalesce((select max(seq) from wos.epoch_transitions where epoch_number = new.epoch_number), 0) + 1;
  new.at := clock_timestamp();
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

-- Manifest entries, allocations and anomaly metrics are written only while the epoch is CALCULATING, in its mode, under
-- the transition lock; entitlements only from FINALIZED on.
create or replace function wos.check_publication_write() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.epoch:' || new.epoch_number::text));
  if tg_table_name = 'entitlements' then
    new.created_at := clock_timestamp();
    select cluster, mode into new.cluster, new.mode from wos.epochs where epoch_number = new.epoch_number;
    if (wos.epoch_state(new.epoch_number) in ('FINALIZED', 'DISTRIBUTABLE', 'CLOSED')) is not true then
      raise exception 'wos: entitlements exist only once epoch % is FINALIZED', new.epoch_number using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (wos.epoch_state(new.epoch_number) = 'CALCULATING') is not true then
    raise exception 'wos: epoch % is %, not CALCULATING (written once, before publication)', new.epoch_number, coalesce(wos.epoch_state(new.epoch_number), 'undefined')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger epoch_manifest_publication before insert on wos.epoch_manifest_entries for each row execute function wos.check_publication_write();
create trigger allocations_publication before insert on wos.allocations for each row execute function wos.check_publication_write();
create trigger anomaly_metrics_publication before insert on wos.anomaly_metrics for each row execute function wos.check_publication_write();
create trigger entitlements_publication before insert on wos.entitlements for each row execute function wos.check_publication_write();

-- I5 (D49): budgets are immutable (append-only) and fixed before work: no budget once a lease exists; the reservation
-- is computed by the server from the epoch's pinned issuance rate.
create or replace function wos.check_task_budget() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  ep wos.epochs%rowtype;
begin
  new.created_at := clock_timestamp();
  perform pg_advisory_xact_lock(hashtext('wos.lease_gen:' || new.task_id::text));
  if exists (select 1 from wos.leases l where l.task_id = new.task_id) then
    raise exception 'wos: a budget is fixed before work starts (task % already has a lease)', new.task_id using errcode = 'check_violation';
  end if;
  select * into ep from wos.epochs where epoch_number = new.issued_epoch;
  if (wos.epoch_state(new.issued_epoch) = 'OPEN') is not true or ep.issuance_rate_base_per_acu is null or ep.task_capacity_base is null then
    raise exception 'wos: tasks are issued only in an OPEN epoch with a pinned issuance rate and task capacity' using errcode = 'check_violation';
  end if;
  new.issuance_rate_base_per_acu := ep.issuance_rate_base_per_acu;
  -- Review 05 B9: an explicit floor, as the engine (a numeric -> bigint cast would round to nearest).
  new.reserved_base := floor(new.budget_acu_micro::numeric * ep.issuance_rate_base_per_acu / 1000000)::bigint;
  if new.reserved_base = 0 then
    raise exception 'wos: the budget reserves nothing at the epoch''s rate: the task is not issued (as the engine)' using errcode = 'check_violation';
  end if;
  new.expires_epoch := new.issued_epoch + ep.budget_expiry_epochs;
  new.review_grace_epochs := ep.review_grace_epochs;
  if new.reissue_of is not null then perform wos.lock_task(new.reissue_of); end if;
  new.policy_version := coalesce(ep.policy_versions ->> 'reward', '');
  if new.reissue_of is not null and not exists (
       select 1 from wos.task_budgets b join wos.task_budget_releases r on r.task_id = b.task_id
        where b.task_id = new.reissue_of and b.objective_id = new.objective_id
          and not exists (select 1 from wos.contribution_receipts c where c.task_id = b.task_id)) then
    raise exception 'wos: a re-issue replaces a released or expired, unaccepted task of the same objective' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger task_budgets_check before insert on wos.task_budgets for each row execute function wos.check_task_budget();

-- I8: conservation at commit. One function, deferred to commit and serialized, so concurrent writers cannot each see
-- room that only one of them has. It re-sums every balance touched by the row.
create or replace function wos.check_conservation() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  eid uuid;
  cid uuid;
  e wos.entitlements%rowtype;
  j jsonb := to_jsonb(new);
begin
  perform pg_advisory_xact_lock(hashtext('wos.conservation'));
  if tg_table_name = 'task_budgets' then
    if (select sum(reserved_base) from wos.task_budgets where issued_epoch = new.issued_epoch)
       > (select task_capacity_base from wos.epochs where epoch_number = new.issued_epoch) then
      raise exception 'wos: epoch % task capacity is exhausted: the task is not issued (reservation at issuance, never scaled)', new.issued_epoch
        using errcode = 'check_violation';
    end if;
    if (select sum(b.budget_acu_micro) from wos.task_budgets b where b.objective_id = new.objective_id
          and not exists (select 1 from wos.task_budget_releases r where r.task_id = b.task_id))
       > (select budget_acu_micro from wos.acceptance_objectives where id = new.objective_id) then
      raise exception 'wos: task budgets under objective % exceed its budget (splitting cannot raise the total)', new.objective_id using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'contribution_receipts' then
    if new.task_id is not null and (select sum(share_bp) from wos.contribution_receipts where task_id = new.task_id) <> 10000 then
      raise exception 'wos: declared shares of task % must sum to 10000 bp', new.task_id using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'task_budget_releases' then
    if exists (select 1 from wos.contribution_receipts c where c.task_id = new.task_id) then
      raise exception 'wos: task % was accepted; its budget is paid, not released', new.task_id using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'allocations' then
    if exists (select 1 from wos.contribution_receipts c where c.id = new.receipt_id and c.task_id is not null
                and (select sum(x.amount_base) from wos.allocations x join wos.contribution_receipts r on r.id = x.receipt_id where r.task_id = c.task_id)
                    > (select reserved_base from wos.task_budgets where task_id = c.task_id)) then
      raise exception 'wos: allocations of a task exceed its reserved budget' using errcode = 'check_violation';
    end if;
    -- Review 05 B2: no receipt is allocated more than its declared share of the reservation (rounded up); the exact
    -- largest-remainder split is the rule taskAllocationRefusals.
    if exists (select 1 from wos.contribution_receipts c join wos.task_budgets b on b.task_id = c.task_id where c.id = new.receipt_id
                and (select sum(x.amount_base) from wos.allocations x where x.receipt_id = c.id)
                    > ceil(b.reserved_base::numeric * c.share_bp / 10000)) then
      raise exception 'wos: a receipt is allocated more than its declared share of the task''s reservation' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'allocation_disputes' then
    if (select sum(stake_base) from wos.allocation_disputes where epoch_number = new.epoch_number and disputer_account_id = new.disputer_account_id)
       > (select coalesce(sum(amount_base), 0) from wos.allocations where epoch_number = new.epoch_number and account_id = new.disputer_account_id) then
      raise exception 'wos: the stakes of your disputes in epoch % exceed your pending allocations', new.epoch_number using errcode = 'check_violation';
    end if;
  end if;
  -- Source balances: an allocation, an entitlement (tranche or claimable), a confiscation, a settlement's bounty.
  if tg_table_name in ('entitlements', 'entitlement_claims', 'confiscation_sources', 'confiscation_releases', 'leaf_voids') then
    for eid in
      select (j ->> 'source_id')::uuid where tg_table_name in ('entitlements', 'confiscation_sources')
      union select (j ->> 'entitlement_id')::uuid where tg_table_name = 'entitlement_claims'
      union select (j ->> 'id')::uuid where tg_table_name = 'entitlements'
      union select x.entitlement_id from wos.entitlement_claims x where tg_table_name = 'leaf_voids' and x.leaf_id = (j ->> 'leaf_id')::uuid
      union select s.source_id from wos.confiscation_sources s
             where tg_table_name = 'confiscation_releases' and s.confiscation_id = (j ->> 'confiscation_id')::uuid
    loop
      continue when eid is null;
      if exists (select 1 from wos.allocations a where a.id = eid) then
        if (select coalesce(sum(amount_base), 0) from wos.entitlements where source_kind = 'allocation' and source_id = eid)
           + (select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s where s.source_id = eid and s.source_kind = 'pending_allocation'
                and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id))
           > (select amount_base from wos.allocations where id = eid) then
          raise exception 'wos: allocation % is over-consumed (entitlements + holds > amount)', eid using errcode = 'check_violation';
        end if;
      end if;
      select * into e from wos.entitlements where id = eid;
      if e.id is not null and (
           (select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x where x.entitlement_id = e.id
             and not exists (select 1 from wos.leaf_voids v where v.leaf_id = x.leaf_id))
         + (select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s where s.source_id = e.id and s.source_kind in ('holdback', 'unclaimed_entitlement')
             and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id))
         + (select coalesce(sum(m.amount_base), 0) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = e.id)
         > e.amount_base) then
        raise exception 'wos: entitlement % is over-consumed (claims + holds + matured > amount)', e.id using errcode = 'check_violation';
      end if;
      if exists (select 1 from wos.dispute_settlements d where d.dispute_id = eid)
         and (select coalesce(sum(amount_base), 0) from wos.entitlements where source_kind = 'dispute_settlement' and source_id = eid)
             > (select bounty_base from wos.dispute_settlements where dispute_id = eid) then
        raise exception 'wos: bounty entitlements exceed the settlement''s bounty' using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  if tg_table_name = 'confiscation_sources' then
    cid := new.confiscation_id;
    if (select sum(amount_base) from wos.confiscation_sources where confiscation_id = cid)
       > (select proven_excess_base from wos.confiscations where id = cid) then
      raise exception 'wos: confiscation never exceeds the proven excess' using errcode = 'check_violation';
    end if;
  end if;
  return null;
end $$;
do $$
declare
  t text;
begin
  foreach t in array array['task_budgets', 'contribution_receipts', 'task_budget_releases', 'allocations', 'allocation_disputes',
                           'entitlements', 'entitlement_claims', 'confiscation_sources', 'confiscation_releases', 'leaf_voids'] loop
    execute format('create constraint trigger %I after insert on wos.%I deferrable initially deferred for each row execute function wos.check_conservation()',
                   t || '_conservation', t);
  end loop;
end $$;

-- I4: the wallet registry — one beneficiary per wallet, one wallet per beneficiary per cluster, whatever RLS shows.
create or replace function wos.apply_wallet_binding() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  bk text := case when new.organization_id is null then 'person' else 'organization' end;
  bid uuid := coalesce(new.organization_id, new.account_id);
begin
  new.created_at := clock_timestamp();
  perform pg_advisory_xact_lock(hashtext('wos.wallet:' || new.cluster || ':' || new.wallet));
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

-- I9: settlement finality and the fence.
create or replace function wos.adapter_generation() returns integer
language sql stable security definer set search_path = wos, pg_temp as $$
  select greatest(1, (select count(*)::integer from wos.settlement_adapter_events where action = 'activate'))
$$;
create or replace function wos.settlement_paused() returns boolean
language sql stable security definer set search_path = wos, pg_temp as $$
  select coalesce((select action = 'pause' from wos.settlement_adapter_events where action in ('pause', 'resume') order by seq desc limit 1), false)
$$;
create or replace function wos.check_claim_leaf() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  new.created_at := clock_timestamp();
  if new.cluster <> 'devnet' then
    raise exception 'wos: mainnet settlement is closed in this draft (MAINNET-READINESS gate)' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock_shared(hashtext('wos.settlement_fence'));
  if not exists (select 1 from wos.wallet_registry r where r.cluster = new.cluster and r.wallet = new.wallet
                  and r.beneficiary_kind = new.beneficiary_kind and r.beneficiary_id = new.beneficiary_id)
     or new.adapter_generation <> wos.adapter_generation() then
    raise exception 'wos: a leaf goes to the beneficiary''s currently bound wallet, in the current adapter generation' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger claim_leaves_check before insert on wos.claim_leaves for each row execute function wos.check_claim_leaf();
create or replace function wos.check_entitlement_claim_leaf() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.leaf:' || new.leaf_id::text));
  if exists (select 1 from wos.leaf_voids v where v.leaf_id = new.leaf_id) or exists (select 1 from wos.settlement_attempts a where a.leaf_id = new.leaf_id) then
    raise exception 'wos: leaf % is frozen (void, or already signed)', new.leaf_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger entitlement_claims_frozen before insert on wos.entitlement_claims for each row execute function wos.check_entitlement_claim_leaf();
create or replace function wos.check_leaf_void() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.leaf:' || new.leaf_id::text));
  if exists (select 1 from wos.settlement_outcomes o where o.leaf_id = new.leaf_id and o.outcome = 'confirmed') then
    raise exception 'wos: a confirmed leaf is never voided' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.settlement_attempts a where a.leaf_id = new.leaf_id
              and not exists (select 1 from wos.settlement_outcomes o where o.leaf_id = a.leaf_id and o.attempt = a.attempt and o.outcome = 'expired_not_landed')) then
    raise exception 'wos: leaf % has a signed attempt that may still land (prove expiry first)', new.leaf_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger leaf_voids_check before insert on wos.leaf_voids for each row execute function wos.check_leaf_void();
create or replace function wos.check_settlement_attempt() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  l wos.claim_leaves%rowtype;
begin
  perform pg_advisory_xact_lock_shared(hashtext('wos.settlement_fence'));
  perform pg_advisory_xact_lock(hashtext('wos.leaf:' || new.leaf_id::text));
  new.persisted_at := clock_timestamp();
  select * into l from wos.claim_leaves where id = new.leaf_id;
  if exists (select 1 from wos.leaf_voids v where v.leaf_id = new.leaf_id) then
    raise exception 'wos: leaf % is void', new.leaf_id using errcode = 'check_violation';
  end if;
  if wos.settlement_paused() or new.adapter_generation <> wos.adapter_generation() or l.adapter_generation <> new.adapter_generation then
    raise exception 'wos: settlement is paused or this adapter generation is fenced' using errcode = 'check_violation';
  end if;
  if (select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x where x.leaf_id = new.leaf_id) <> l.amount_base then
    raise exception 'wos: leaf amount differs from its claimed entitlements' using errcode = 'check_violation';
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
create or replace function wos.check_settlement_outcome() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  a wos.settlement_attempts%rowtype;
  cl text;
  o jsonb := new.status_observation;
begin
  perform pg_advisory_xact_lock(hashtext('wos.leaf:' || new.leaf_id::text));
  new.at := clock_timestamp();
  select * into a from wos.settlement_attempts where leaf_id = new.leaf_id and attempt = new.attempt;
  select cluster into cl from wos.claim_leaves where id = new.leaf_id;
  if new.outcome = 'expired_not_landed' and (new.observed_block_height > a.last_valid_block_height) is not true then
    raise exception 'wos: expiry is proven only by a block height past the attempt''s last valid block height' using errcode = 'check_violation';
  end if;
  -- Review 04 finding 8: the observation is typed and must say what the outcome claims, for THIS signature on THIS
  -- cluster. Expiry: a historical search that found nothing (value = [null]). Confirmation: finalized without error.
  -- (Rows the table CHECKs refuse anyway — no history search, no finalized commitment — are left to those CHECKs.)
  if (new.outcome = 'expired_not_landed' and new.history_checked and new.observed_block_height is not null and o is not null)
     or (new.outcome = 'confirmed' and new.commitment = 'finalized' and new.slot is not null) then
  if (o ->> 'signature' = a.signature and o ->> 'cluster' = cl and jsonb_typeof(o -> 'value') = 'array' and jsonb_array_length(o -> 'value') = 1) is not true then
    raise exception 'wos: the status observation must be the response for this attempt''s signature on its cluster' using errcode = 'check_violation';
  end if;
  if new.outcome = 'expired_not_landed' and (o ->> 'searchTransactionHistory' = 'true' and o -> 'value' = '[null]'::jsonb) is not true then
    raise exception 'wos: expiry needs a historical search that found no transaction (the observation shows one)' using errcode = 'check_violation';
  end if;
  if new.outcome = 'confirmed' and (o -> 'value' -> 0 ->> 'confirmationStatus' = 'finalized' and o -> 'value' -> 0 -> 'err' = 'null'::jsonb) is not true then
    raise exception 'wos: confirmed needs the signature finalized without error' using errcode = 'check_violation';
  end if;
  end if;
  return new;
end $$;
create trigger settlement_outcomes_check before insert on wos.settlement_outcomes for each row execute function wos.check_settlement_outcome();

-- I5 (review 06 R06-6): a qualification binds the run-policy snapshot OF ITS LEASE AND GENERATION, by hash.
alter table wos.qualification_results add constraint qualification_results_snapshot_fk
  foreign key (policy_snapshot_sha256) references wos.run_policy_snapshots (snapshot_sha256);
create or replace function wos.check_qualification_snapshot() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if not exists (select 1 from wos.run_policy_snapshots s where s.snapshot_sha256 = new.policy_snapshot_sha256
                  and s.lease_id = new.lease_id and s.generation = new.lease_generation) then
    raise exception 'wos: the qualification''s run-policy snapshot belongs to another lease or generation' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger qualification_results_snapshot before insert on wos.qualification_results for each row execute function wos.check_qualification_snapshot();

-- Review 06 R06-5: a submission is recorded while the budget is live and unreleased (server time).
-- Review 07 R07-4: submission, release and replacement of a task serialize on ONE task lock and re-read state after it.
create or replace function wos.lock_task(t uuid) returns void
language sql as $$ select pg_advisory_xact_lock(hashtext('wos.task:' || t::text)) $$;
create or replace function wos.check_task_submission() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  b wos.task_budgets%rowtype;
  cs wos.changesets%rowtype;
  deadline timestamptz;
begin
  perform wos.lock_task(new.task_id);
  new.created_at := clock_timestamp();
  select * into b from wos.task_budgets where task_id = new.task_id;
  select * into cs from wos.changesets where id = new.changeset_id;
  if cs.id is null or cs.task_id <> new.task_id or not cs.ok or not cs.signature_valid then
    raise exception 'wos: a submission is the task''s own accepted, signed changeset' using errcode = 'check_violation';
  end if;
  new.submitted_at := cs.created_at;
  new.submission_sha256 := cs.submission_sha256;
  new.submitted_epoch := coalesce((select max(e.epoch_number) from wos.epochs e where e.epoch_number between b.issued_epoch and b.expires_epoch - 1
                                    and e.starts_at <= cs.created_at), b.issued_epoch);
  deadline := (select starts_at from wos.epochs where epoch_number = b.expires_epoch);
  if (deadline is not null and cs.created_at >= deadline) or cs.created_at < b.created_at
     or exists (select 1 from wos.task_budget_releases r where r.task_id = new.task_id) then
    raise exception 'wos: work is submitted only while its budget is live (before its expiry, unreleased)' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger task_submissions_check before insert on wos.task_submissions for each row execute function wos.check_task_submission();
create or replace function wos.check_task_release() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform wos.lock_task(new.task_id);
  if new.reason in ('failed', 'abandoned') and exists (select 1 from wos.task_submissions s where s.task_id = new.task_id)
     and new.final_rejection_ref is null and new.admin_action_id is null then
    raise exception 'wos: submitted work awaiting review is released only after its final rejection or an authorized cancellation'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger task_budget_releases_check before insert on wos.task_budget_releases for each row execute function wos.check_task_release();

-- D54 / review 06 R06-2: one SUBJECT LOCK per receipt serializes challenge publication, challenge admission, silence
-- finalization and live admission (manifest); each reads authoritative state after taking it, with server time.
create or replace function wos.lock_receipt_subject(r uuid) returns void
language sql as $$ select pg_advisory_xact_lock(hashtext('wos.receipt_subject:' || r::text)) $$;
create or replace function wos.receipt_status(r uuid) returns text
language sql stable security definer set search_path = wos, pg_temp as $$
  select to_status from wos.receipt_status_events where receipt_id = r order by seq desc limit 1
$$;
create or replace function wos.check_provisional_publication() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  ended timestamptz;
begin
  perform wos.lock_receipt_subject(new.receipt_id);
  if wos.bootstrap_on() then
    raise exception 'wos: provisional receipts are published for challenge only after bootstrap ended (D54)' using errcode = 'check_violation';
  end if;
  if (wos.receipt_status(new.receipt_id) = 'PROVISIONAL') is not true
     or new.receipt_sha256 <> (select receipt_sha256 from wos.contribution_receipts where id = new.receipt_id) then
    raise exception 'wos: only a PROVISIONAL receipt is published, bound to its hash' using errcode = 'check_violation';
  end if;
  select updated_at into ended from wos.platform_settings where key = 'bootstrap_mode';
  new.bootstrap_ended_at := ended;
  new.published_at := clock_timestamp();
  select e.provisional_challenge_hours into new.window_hours
    from wos.contribution_receipts c join wos.epochs e on e.epoch_number = c.admitted_epoch where c.id = new.receipt_id;
  new.closes_at := new.published_at + make_interval(hours => new.window_hours);
  return new;
end $$;
create trigger provisional_publications_check before insert on wos.provisional_publications for each row execute function wos.check_provisional_publication();
create or replace function wos.check_provisional_challenge() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform wos.lock_receipt_subject(new.receipt_id);
  new.created_at := clock_timestamp();
  if (wos.receipt_status(new.receipt_id) = 'PROVISIONAL') is not true
     or new.created_at >= (select closes_at from wos.provisional_publications where receipt_id = new.receipt_id) then
    raise exception 'wos: the challenge window of receipt % has closed or it is already final', new.receipt_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger provisional_challenges_check before insert on wos.provisional_challenges for each row execute function wos.check_provisional_challenge();
create or replace function wos.check_receipt_status_event() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  -- Review 07 R07-5: EVERY status mutation takes the subject lock (it changes eligibility) and reads state after it.
  perform wos.lock_receipt_subject(new.receipt_id);
  if new.kind = 'restored' and new.to_status = 'FINAL_BY_SILENCE' then
    if (wos.receipt_status(new.receipt_id) = 'REVOKED') is not true
       or not exists (select 1 from wos.receipt_status_events e where e.receipt_id = new.receipt_id and e.kind = 'final_by_silence') then
      raise exception 'wos: receipt % is restored to FINAL_BY_SILENCE only when its history holds its silence finalization', new.receipt_id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.kind = 'final_by_silence' then
    if new.from_status <> 'PROVISIONAL' or new.to_status <> 'FINAL_BY_SILENCE'
       or (wos.receipt_status(new.receipt_id) = 'PROVISIONAL') is not true
       or (clock_timestamp() >= (select closes_at from wos.provisional_publications where receipt_id = new.receipt_id)) is not true
       or exists (select 1 from wos.provisional_challenges c where c.receipt_id = new.receipt_id) then
      raise exception 'wos: receipt % finalizes by silence only after its published window closed with no challenge', new.receipt_id
        using errcode = 'check_violation';
    end if;
  elsif new.to_status = 'FINAL_BY_SILENCE' then
    raise exception 'wos: FINAL_BY_SILENCE is reached only by the final_by_silence event' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger receipt_status_events_d54 before insert on wos.receipt_status_events for each row execute function wos.check_receipt_status_event();
-- Live admission (and so allocations and entitlements) of a published provisional receipt waits for its final status,
-- under the same subject lock.
create or replace function wos.check_manifest_provisional() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if new.mode = 'live' and new.disposition = 'included' and exists (select 1 from wos.provisional_publications p where p.receipt_id = new.receipt_id) then
    perform wos.lock_receipt_subject(new.receipt_id);
    if (wos.receipt_status(new.receipt_id) in ('FINAL_BY_SILENCE', 'RATIFIED')) is not true then
      raise exception 'wos: a challenged or unfinalized provisional receipt is not admitted live' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger epoch_manifest_provisional before insert on wos.epoch_manifest_entries for each row execute function wos.check_manifest_provisional();
-- Review 07 R07-2: admission of a free allocation challenge, its decision and every entitlement of a challenged
-- allocation take the RECEIPT's subject lock and read state after it.
create or replace function wos.check_allocation_challenge() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  a wos.allocations%rowtype;
begin
  perform wos.lock_receipt_subject(new.receipt_id);
  new.created_at := clock_timestamp();
  select * into a from wos.allocations where id = new.allocation_id;
  if a.id is null or a.receipt_id is distinct from new.receipt_id then
    raise exception 'wos: the challenged allocation belongs to another receipt' using errcode = 'check_violation';
  end if;
  if (wos.epoch_state(a.epoch_number) = 'PROPOSED') is not true
     or new.created_at >= wos.epoch_state_at(a.epoch_number, 'PROPOSED') + make_interval(hours => (select challenge_hours from wos.epochs where epoch_number = a.epoch_number)) then
    raise exception 'wos: the challenge window of epoch % is not open', a.epoch_number using errcode = 'check_violation';
  end if;
  if new.receipt_sha256 <> (select receipt_sha256 from wos.contribution_receipts where id = new.receipt_id)
     or new.allocations_root is distinct from (select t.allocations_root from wos.epoch_transitions t where t.epoch_number = a.epoch_number and t.to_state = 'PROPOSED') then
    raise exception 'wos: a challenge cites the frozen receipt revision and the epoch''s published allocations root' using errcode = 'check_violation';
  end if;
  if (wos.receipt_status(new.receipt_id) = 'ACTIVE') is not true then
    raise exception 'wos: the free allocation challenge is for ACTIVE receipts' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.allocation_challenges c where c.allocation_id = new.allocation_id
              and not exists (select 1 from wos.allocation_challenge_decisions d where d.challenge_id = c.id)) then
    raise exception 'wos: allocation % already has an undecided challenge', new.allocation_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger allocation_challenges_check before insert on wos.allocation_challenges for each row execute function wos.check_allocation_challenge();
create or replace function wos.check_allocation_challenge_decision() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  c wos.allocation_challenges%rowtype;
  amt bigint;
begin
  select * into c from wos.allocation_challenges where id = new.challenge_id;
  perform wos.lock_receipt_subject(c.receipt_id);
  new.decided_at := clock_timestamp();
  select amount_base into amt from wos.allocations where id = c.allocation_id;
  if (new.outcome = 'confirmed' and new.resulting_amount_base <> amt) or (new.outcome = 'changed' and new.resulting_amount_base >= amt) then
    raise exception 'wos: a confirmed allocation keeps its amount; a changed one is lowered' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger allocation_challenge_decisions_check before insert on wos.allocation_challenge_decisions for each row execute function wos.check_allocation_challenge_decision();
create or replace function wos.check_allocation_challenge_reply() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  c wos.allocation_challenges%rowtype;
begin
  select * into c from wos.allocation_challenges where id = new.challenge_id;
  perform wos.lock_receipt_subject(c.receipt_id);
  new.created_at := clock_timestamp();
  if new.account_id is distinct from (select account_id from wos.allocations where id = c.allocation_id)
     or exists (select 1 from wos.allocation_challenge_decisions d where d.challenge_id = new.challenge_id) then
    raise exception 'wos: only the accused replies, before the decision' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger allocation_challenge_replies_check before insert on wos.allocation_challenge_replies for each row execute function wos.check_allocation_challenge_reply();
create or replace function wos.check_challenged_entitlement() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  rid uuid;
  lim bigint;
begin
  if new.source_kind <> 'allocation' then return new; end if;
  select receipt_id into rid from wos.allocations where id = new.source_id;
  if rid is null then return new; end if;
  -- Lock FIRST, then read (an uncommitted challenge holding the lock must be seen; review 07 race R07-2).
  perform wos.lock_receipt_subject(rid);
  if not exists (select 1 from wos.allocation_challenges c where c.allocation_id = new.source_id) then return new; end if;
  if exists (select 1 from wos.allocation_challenges c where c.allocation_id = new.source_id
              and not exists (select 1 from wos.allocation_challenge_decisions d where d.challenge_id = c.id)) then
    raise exception 'wos: allocation % has an undecided challenge: nothing is entitled until its decision', new.source_id using errcode = 'check_violation';
  end if;
  select min(d.resulting_amount_base) into lim from wos.allocation_challenge_decisions d join wos.allocation_challenges c on c.id = d.challenge_id
   where c.allocation_id = new.source_id;
  if (select coalesce(sum(amount_base), 0) from wos.entitlements where source_kind = 'allocation' and source_id = new.source_id) + new.amount_base > lim then
    raise exception 'wos: entitlements of allocation % exceed its decided amount', new.source_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger entitlements_challenged before insert on wos.entitlements for each row execute function wos.check_challenged_entitlement();

-- The end of bootstrap is time-stamped (the publication window's reference point).
create or replace function wos.stamp_bootstrap_end() returns trigger
language plpgsql as $$
begin
  if new.key = 'bootstrap_mode' and coalesce((old.value ->> 'enabled')::boolean, false) and not coalesce((new.value ->> 'enabled')::boolean, false) then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger platform_settings_bootstrap_end_stamp before update on wos.platform_settings for each row execute function wos.stamp_bootstrap_end();

-- I6 (D58): a disputed finding is never resolved by the lab that raised it. The raising lab is derived from the
-- finding's review provider (never trusted from the caller).
create or replace function wos.lab_of_provider(p text) returns text
language sql immutable as $$
  select case p when 'claude_cli' then 'anthropic' when 'codex_cli' then 'openai' when 'zai' then 'zai' end
$$;
create or replace function wos.check_ruling_lab_record() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  ru wos.rulings%rowtype;
  decided text;
  prov text;
begin
  new.created_at := clock_timestamp();
  select wos.lab_of_provider(r.provider) into new.raised_by_lab
    from wos.findings f join wos.reviews r on r.id = f.review_id where f.id = new.finding_id;
  if new.raised_by_lab is null or new.raised_by_lab = '' then
    raise exception 'wos: the lab that raised finding % is unknown', new.finding_id using errcode = 'check_violation';
  end if;
  -- Review 07 R07-7: the record is DERIVED from a CONFIRMED ruling that decided this finding; the resolving lab comes
  -- from the resolver's recorded run (or 'human' for a maintainer's own ruling); unknown fails closed.
  select * into ru from wos.rulings where id = new.ruling_id;
  if ru.state is distinct from 'confirmed' then
    raise exception 'wos: ruling % is not confirmed', new.ruling_id using errcode = 'check_violation';
  end if;
  select x ->> 'decision' into decided from jsonb_array_elements(ru.body -> 'rulings') x where x ->> 'findingId' = new.finding_id::text limit 1;
  if decided is null or decided <> new.outcome then
    raise exception 'wos: ruling % did not decide finding % as %', new.ruling_id, new.finding_id, new.outcome using errcode = 'check_violation';
  end if;
  select record ->> 'provider' into prov from wos.agent_runs where lease_id = ru.lease_id order by created_at desc limit 1;
  new.resolved_by_lab := coalesce(wos.lab_of_provider(prov), case when prov is null and wos.is_maintainer(ru.account_id) then 'human' end, '');
  if new.resolved_by_lab = '' then
    raise exception 'wos: the lab that resolved ruling % is unknown', new.ruling_id using errcode = 'check_violation';
  end if;
  if new.resolved_by_lab = new.raised_by_lab then
    raise exception 'wos: finding % was raised by % and cannot be resolved by the same lab (D58)', new.finding_id, new.raised_by_lab
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger ruling_lab_records_check before insert on wos.ruling_lab_records for each row execute function wos.check_ruling_lab_record();

-- I9 (review 04 finding 4): a confiscation ENDS once — executed or released, never both — serialized per confiscation
-- (a lock both writers take), so an execution left open across the hold's expiry cannot commit beside a lapse release
-- and a claim of the source. Execution only before the hold lapses; a 'lapsed' release only once it has (server time).
create or replace function wos.check_confiscation_end() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  c wos.confiscations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('wos.confiscation:' || new.confiscation_id::text));
  select * into c from wos.confiscations where id = new.confiscation_id;
  if exists (select 1 from wos.confiscation_executions x where x.confiscation_id = new.confiscation_id)
     or exists (select 1 from wos.confiscation_releases x where x.confiscation_id = new.confiscation_id) then
    raise exception 'wos: confiscation % has already ended (executed or released)', new.confiscation_id using errcode = 'check_violation';
  end if;
  if tg_table_name = 'confiscation_executions' and clock_timestamp() >= c.hold_expires_at then
    raise exception 'wos: the hold of confiscation % lapsed at %: it no longer executes', new.confiscation_id, c.hold_expires_at using errcode = 'check_violation';
  end if;
  if tg_table_name = 'confiscation_releases' and to_jsonb(new) ->> 'reason' = 'lapsed' and clock_timestamp() < c.hold_expires_at then
    raise exception 'wos: the hold of confiscation % lapses only at %', new.confiscation_id, c.hold_expires_at using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger confiscation_executions_end before insert on wos.confiscation_executions for each row execute function wos.check_confiscation_end();
create trigger confiscation_releases_end before insert on wos.confiscation_releases for each row execute function wos.check_confiscation_end();
create or replace function wos.may_broadcast(leaf uuid, att integer) returns boolean
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform pg_advisory_xact_lock_shared(hashtext('wos.settlement_fence'));
  return not wos.settlement_paused()
     and exists (select 1 from wos.settlement_attempts a where a.leaf_id = leaf and a.attempt = att and a.adapter_generation = wos.adapter_generation()
                  and not exists (select 1 from wos.settlement_outcomes o where o.leaf_id = a.leaf_id and o.attempt = a.attempt));
end $$;
create or replace function wos.check_adapter_event() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.settlement_fence'));
  new.created_at := clock_timestamp();
  if new.action = 'pause' and new.expires_at > new.created_at + interval '336 hours' then
    raise exception 'wos: an emergency pause expires within 14 days of now' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger settlement_adapter_events_check before insert on wos.settlement_adapter_events for each row execute function wos.check_adapter_event();
create or replace function wos.check_migration_snapshot() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('wos.settlement_fence'));
  new.created_at := clock_timestamp();
  if not wos.settlement_paused() then
    raise exception 'wos: pause (fence) settlement before a migration snapshot' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.settlement_attempts a where not exists (select 1 from wos.settlement_outcomes o where o.leaf_id = a.leaf_id and o.attempt = a.attempt)) then
    raise exception 'wos: resolve every in-flight settlement attempt (drain) before the snapshot' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger migration_snapshots_check before insert on wos.migration_snapshots for each row execute function wos.check_migration_snapshot();

-- Retention (M17): run-log bodies are never edited and deleted only after their expiry.
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

-- I2: server time on the times the engine's rules read.
do $$
declare
  p text[];
begin
  foreach p slice 1 in array array[
    ['policy_activations', 'announced_at'], ['qualification_results', 'recorded_at'], ['usage_receipts', 'created_at'],
    ['contribution_receipts', 'created_at'], ['receipt_status_events', 'at'], ['payout_audit_verdicts', 'sealed_at'],
    ['payout_audit_assignments', 'created_at'], ['duty_events', 'at'], ['allocation_disputes', 'opened_at'],
    ['dispute_items', 'created_at'], ['dispute_replies', 'created_at'], ['dispute_item_resolutions', 'resolved_at'],
    ['dispute_appeals', 'created_at'], ['dispute_appeal_decisions', 'created_at'], ['dispute_settlements', 'created_at'],
    ['confiscations', 'notice_at'], ['confiscation_appeals', 'created_at'], ['confiscation_appeal_decisions', 'created_at'],
    ['confiscation_sources', 'created_at'], ['confiscation_releases', 'created_at'], ['confiscation_executions', 'executed_at'],
    ['governance_votes', 'created_at'], ['admin_action_approvals', 'approved_at'], ['admin_action_uses', 'used_at'],
    ['sponsorship_links', 'effective_from'], ['genesis_contributions', 'recorded_at'], ['genesis_reference_manifests', 'created_at']
  ] loop
    execute format('create trigger %I before insert on wos.%I for each row execute function wos.stamp_now(%L)', p[1] || '_server_time', p[1], p[2]);
  end loop;
end $$;

-- ============================================================================================
-- S. Append-only enforcement (I1), grants and RLS
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
    'dispute_appeal_decisions', 'dispute_settlements', 'confiscations', 'confiscation_appeals', 'confiscation_appeal_decisions',
    'confiscation_sources', 'confiscation_executions', 'exclusions', 'wallet_bindings', 'completion_pools', 'completion_definitions',
    'pool_accruals', 'pool_accrual_corrections', 'pool_events', 'genesis_contributions', 'genesis_commit_claims',
    'genesis_reference_manifests', 'governance_proposals', 'governance_weight_snapshots', 'governance_votes',
    'settlement_adapter_events', 'migration_snapshots', 'abuse_signals', 'risk_flags', 'admin_action_approvals',
    'admin_action_uses', 'contribution_usage', 'payout_audit_assignments', 'acceptance_objectives', 'task_budgets', 'task_budget_releases', 'confiscation_releases', 'epoch_balances',
    'human_review_assignments', 'ruling_lab_records', 'task_submissions', 'provisional_publications', 'provisional_challenges',
    'allocation_challenges', 'allocation_challenge_replies', 'allocation_challenge_decisions'
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
    'confiscation_appeals', 'confiscation_appeal_decisions', 'confiscation_sources', 'confiscation_executions', 'exclusions',
    'wallet_bindings', 'wallet_registry',
    'completion_pools', 'completion_definitions', 'pool_accruals', 'pool_accrual_corrections', 'pool_events',
    'genesis_contributions', 'genesis_commit_claims', 'genesis_reference_manifests', 'governance_proposals',
    'governance_weight_snapshots', 'governance_votes', 'settlement_adapter_events', 'migration_snapshots',
    'abuse_signals', 'risk_flags', 'admin_action_approvals', 'admin_action_uses', 'contribution_usage', 'payout_audit_assignments',
    'acceptance_objectives', 'task_budgets', 'task_budget_releases', 'confiscation_releases', 'epoch_balances', 'human_review_assignments', 'ruling_lab_records',
    'task_submissions', 'provisional_publications', 'provisional_challenges',
    'allocation_challenges', 'allocation_challenge_replies', 'allocation_challenge_decisions'
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
    'confiscation_appeal_decisions', 'confiscation_sources', 'confiscation_executions', 'exclusions', 'completion_pools', 'completion_definitions',
    'pool_accruals', 'pool_accrual_corrections', 'pool_events', 'genesis_contributions', 'genesis_commit_claims',
    'genesis_reference_manifests', 'governance_proposals', 'governance_weight_snapshots', 'settlement_adapter_events',
    'migration_snapshots', 'admin_action_uses', 'contribution_usage', 'acceptance_objectives', 'task_budgets', 'task_budget_releases',
    'confiscation_releases', 'epoch_balances', 'ruling_lab_records', 'task_submissions', 'provisional_publications',
    'allocation_challenge_decisions'
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
  foreach t in array array['allocation_disputes', 'dispute_items', 'dispute_replies', 'dispute_appeals', 'governance_votes', 'allocation_acceptances',
                         'confiscation_appeals', 'admin_action_approvals', 'provisional_challenges',
                         'allocation_challenges', 'allocation_challenge_replies'] loop
    execute format('create policy public_read on wos.%I for select to wos_app using (true)', t);
  end loop;
end $$;
create policy own_insert on wos.allocation_disputes for insert to wos_app with check (wos.is_privileged() or disputer_account_id = wos.actor_id());
create policy definer_only on wos.dispute_items for insert to wos_app with check (wos.is_privileged());
create policy own_insert on wos.dispute_replies for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.dispute_appeals for insert to wos_app with check (wos.is_privileged() or appellant_account_id = wos.actor_id());
create policy own_insert on wos.governance_votes for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.allocation_acceptances for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.allocation_challenges for insert to wos_app with check (wos.is_privileged() or challenger_account_id = wos.actor_id());
create policy own_insert on wos.allocation_challenge_replies for insert to wos_app with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_insert on wos.provisional_challenges for insert to wos_app with check (wos.is_privileged() or challenger_account_id = wos.actor_id());
create policy own_insert on wos.confiscation_appeals for insert to wos_app with check (wos.is_privileged() or appellant_account_id = wos.actor_id());
-- A3-7: the co-signer approves from THEIR OWN session; no other actor (privileged or not) can write their approval.
create policy own_insert on wos.admin_action_approvals for insert to wos_app with check (approver_account_id = wos.actor_id());
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
-- A3-6: assignments are server-owned and private (they reveal seats and canary packets).
create policy privileged_only on wos.payout_audit_assignments for all to wos_app using (wos.is_privileged()) with check (wos.is_privileged());
-- Review 05 B6: human-review assignments are server-owned (the reviewer and privileged actors read them).
create policy own_or_privileged on wos.human_review_assignments for select to wos_app using (wos.is_privileged() or reviewer_account_id = wos.actor_id());
create policy privileged_write on wos.human_review_assignments for insert to wos_app with check (wos.is_privileged());
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
  wos.is_maintainer(uuid), wos.bootstrap_on(), wos.adapter_generation(), wos.settlement_paused(), wos.two_person_action(text),
  wos.operation_sha256(text, text, text, jsonb, jsonb), wos.may_broadcast(uuid, integer) to wos_app;

-- 0001_init.sql — wOS V1 schema. Owner: Lead Architect (frozen at contracts 1.0.0).
--
-- Conventions
--   * Everything lives in schema `wos`, which is NOT exposed through Supabase's Data API
--     (PostgREST exposes `public` and `graphql_public` only; see FOUNDER-CHECKLIST.md).
--   * State columns are text + CHECK; the allowed values mirror packages/contracts/src/state-machines.ts
--     and are compared by packages/db/test/schema.test.ts. Change both together or neither.
--   * Mutable aggregates carry `row_version` for optimistic concurrency:
--       update ... set state = $to, row_version = row_version + 1
--       where id = $id and state = $from and row_version = $v
--   * Append-only tables: triggers reject UPDATE/DELETE/TRUNCATE for every role (including the owner),
--     and the app role is additionally granted only SELECT, INSERT.
--   * The app connects as `wos_app` (NOBYPASSRLS). Every transaction sets
--       set_config('wos.actor_id', <account uuid or ''>, true), set_config('wos.actor_kind', <kind>, true)
--     and RLS policies use wos.actor_id() / wos.is_privileged().
--   * ids are UUIDv7 minted by the application; gen_random_uuid() is only a fallback default.

create schema if not exists wos;

-- ============================================================================================
-- Roles
-- ============================================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wos_app') then
    -- LOGIN + password are set by the founder out of band (FOUNDER-CHECKLIST.md). Never in a migration.
    create role wos_app nologin nobypassrls noinherit;
  end if;
end $$;

revoke all on schema wos from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema wos from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema wos from authenticated';
  end if;
end $$;
grant usage on schema wos to wos_app;

-- ============================================================================================
-- Helper functions
-- ============================================================================================
create or replace function wos.actor_id() returns uuid
language sql stable as $$
  select nullif(current_setting('wos.actor_id', true), '')::uuid
$$;

create or replace function wos.actor_kind() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('wos.actor_kind', true), ''), 'anonymous')
$$;

-- system (cron/consumers), github (webhook processing) and maintainer requests may read private rows.
create or replace function wos.is_privileged() returns boolean
language sql stable as $$
  select wos.actor_kind() in ('system', 'github', 'maintainer')
$$;

create or replace function wos.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'wos: % on %.% is forbidden (append-only)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

create or replace function wos.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ============================================================================================
-- Identity (D8: email magic link; GitHub linked later, required to contribute)
-- ============================================================================================
create table wos.accounts (
  id                 uuid primary key default gen_random_uuid(),
  handle             text,
  display_name       text check (display_name is null or length(display_name) <= 80),
  github_user_id     bigint unique,
  github_login       text,
  github_created_at  timestamptz,
  github_linked_at   timestamptz,
  avatar_url         text,
  leaderboard_opt_in boolean not null default false,
  progress_emails    boolean not null default false,
  status             text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  row_version        integer not null default 0,
  constraint accounts_github_consistent check (
    (github_user_id is null and github_login is null and github_linked_at is null)
    or (github_user_id is not null and github_login is not null and github_linked_at is not null and github_created_at is not null)
  ),
  constraint accounts_handle_format check (handle is null or handle ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  constraint accounts_suspension_reason check ((status = 'suspended') = (suspended_reason is not null))
);
create unique index accounts_handle_lower on wos.accounts (lower(handle)) where handle is not null;
create trigger accounts_touch before update on wos.accounts for each row execute function wos.touch_updated_at();

-- Email is private: separate table with own-row RLS.
create table wos.account_emails (
  account_id        uuid primary key references wos.accounts (id),
  email             text not null check (length(email) <= 254),
  email_normalized  text not null unique check (email_normalized = lower(btrim(email_normalized))),
  verified_at       timestamptz not null,
  created_at        timestamptz not null default now()
);

create table wos.account_roles (
  account_id  uuid not null references wos.accounts (id),
  role        text not null check (role in ('maintainer')),
  granted_at  timestamptz not null default now(),
  granted_by  uuid references wos.accounts (id),
  primary key (account_id, role)
);

-- Append-only history of GitHub links, used for reservations (90 days after unlink) and for
-- independence checks across relinks.
create table wos.github_identity_history (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references wos.accounts (id),
  github_user_id  bigint not null,
  github_login    text not null,
  action          text not null check (action in ('linked', 'unlinked')),
  reserved_until  timestamptz,
  occurred_at     timestamptz not null default now(),
  check ((action = 'unlinked') = (reserved_until is not null))
);
create index github_identity_history_user on wos.github_identity_history (github_user_id, occurred_at desc);

create table wos.email_signin_requests (
  id                  uuid primary key default gen_random_uuid(),
  email_normalized    text not null,
  client_kind         text not null check (client_kind in ('web', 'desktop', 'cli')),
  device_name         text,
  device_public_key   text,
  link_token_hash     bytea not null unique,   -- sha256(32 random bytes); raw token only in the email
  code_hash           bytea not null,          -- sha256(requestId || code); 8 chars, 5 attempts
  poll_secret_hash    bytea not null,          -- sha256(poll secret); binds redemption to the starting client
  ip_hash             bytea,                   -- sha256(ip || daily salt) for rate limiting only
  attempts            integer not null default 0 check (attempts between 0 and 5),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  redeemed_at         timestamptz,
  redeemed_account_id uuid references wos.accounts (id),
  check (expires_at <= created_at + interval '15 minutes'),
  check ((redeemed_at is null) = (redeemed_account_id is null))
);
create index email_signin_requests_email on wos.email_signin_requests (email_normalized, created_at desc);
create index email_signin_requests_ip on wos.email_signin_requests (ip_hash, created_at desc);

create table wos.github_link_requests (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references wos.accounts (id),
  flow          text not null check (flow in ('device', 'web')),
  device_code   text,             -- GitHub device_code (not a user credential); deleted/expired after 15 min
  state_hash    bytea,            -- web flow OAuth state
  state         text not null default 'pending' check (state in ('pending', 'linked', 'denied', 'expired', 'refused')),
  refusal       text check (refusal in ('GITHUB_LINKED_ELSEWHERE', 'GITHUB_RESERVED')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  completed_at  timestamptz,
  check ((flow = 'device') = (device_code is not null)),
  check ((flow = 'web') = (state_hash is not null))
);

create table wos.devices (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references wos.accounts (id),
  name        text not null check (length(name) <= 100),
  client_kind text not null check (client_kind in ('desktop', 'cli')),
  public_key  text not null unique,   -- Ed25519, base64; signs agent-run attestations
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index devices_account on wos.devices (account_id);

create table wos.sessions (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null,
  account_id          uuid not null references wos.accounts (id),
  device_id           uuid references wos.devices (id),
  client_kind         text not null check (client_kind in ('web', 'desktop', 'cli')),
  access_token_hash   bytea not null unique,
  access_expires_at   timestamptz not null,
  refresh_token_hash  bytea not null unique,
  refresh_expires_at  timestamptz not null,
  rotated_at          timestamptz,   -- set when this refresh token was exchanged; reuse => revoke family
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz
);
create index sessions_family on wos.sessions (family_id);
create index sessions_account on wos.sessions (account_id) where revoked_at is null;

create table wos.provider_attestations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references wos.accounts (id),
  device_id     uuid not null references wos.devices (id),
  provider      text not null check (provider in ('claude_cli', 'codex_cli')),
  installed     boolean not null,
  cli_version   text,
  signed_in     boolean not null,
  auth_method   text,
  models        text[] not null default '{}',
  checked_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index provider_attestations_latest on wos.provider_attestations (account_id, provider, created_at desc);

create table wos.platform_settings (
  key         text primary key check (key in ('bootstrap_mode', 'active_reward_schedule', 'active_policy', 'product_repo')),
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references wos.accounts (id)
);
insert into wos.platform_settings (key, value) values
  ('bootstrap_mode', '{"enabled": true, "since": null}'::jsonb),
  ('active_reward_schedule', '"rewards.v1"'::jsonb),
  ('active_policy', '"agent-policy.v1"'::jsonb),
  ('product_repo', '"waronsaas/suite"'::jsonb);

-- ============================================================================================
-- Targets, inventory, roadmap structure
-- ============================================================================================
create table wos.targets (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),
  name            text not null,
  rank            integer not null unique check (rank >= 0),   -- 0 = warOnSaaS itself (TGT-00)
  what_it_is      text not null,
  -- D10: every replacement lives in the one product repo (platform_settings.product_repo) under products/<slug>;
  -- TGT-00 warOnSaaS lives in the platform repo.
  repo_full_name  text not null check (repo_full_name ~ '^waronsaas/[A-Za-z0-9._-]+$'),
  product_path    text not null,
  product_name    text,
  hosted_url      text check (hosted_url is null or hosted_url ~ '^https://'),
  self_hostable   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  row_version     integer not null default 0
);
create trigger targets_touch before update on wos.targets for each row execute function wos.touch_updated_at();

create table wos.follows (
  account_id  uuid not null references wos.accounts (id),
  target_id   uuid not null references wos.targets (id),
  created_at  timestamptz not null default now(),
  primary key (account_id, target_id)
);

-- Canonical document workflows: Application Roadmaps and Feature Contracts (DocumentMachine).
create table wos.documents (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('roadmap', 'feature_contract')),
  target_id      uuid references wos.targets (id),          -- roadmaps: the app
  catalog_feature_id uuid,                                  -- contracts: the catalog feature (FK below)
  version        integer not null check (version > 0),
  state          text not null check (state in ('drafting', 'validating', 'in_review', 'revising', 'escalated', 'consensus', 'merged', 'abandoned')),
  round_number   integer not null default 0 check (round_number >= 0),
  branch         text not null,
  pr_number      integer,
  head_sha       text check (head_sha is null or head_sha ~ '^[0-9a-f]{40}$'),
  merged_sha     text check (merged_sha is null or merged_sha ~ '^[0-9a-f]{40}$'),
  merged_at      timestamptz,
  opened_by      uuid references wos.accounts (id),
  ended_reason   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  row_version    integer not null default 0,
  check ((kind = 'roadmap') = (target_id is not null and catalog_feature_id is null)),
  check ((kind = 'feature_contract') = (catalog_feature_id is not null and target_id is null)),
  check ((state = 'merged') = (merged_sha is not null)),
  check (state <> 'abandoned' or ended_reason is not null)
);
create unique index documents_roadmap_version on wos.documents (target_id, version) where kind = 'roadmap';
create unique index documents_contract_version on wos.documents (catalog_feature_id, version) where kind = 'feature_contract';
-- ONE canonical open roadmap per target, ONE open contract workflow per feature (spec Agent 6).
create unique index documents_one_open_roadmap on wos.documents (target_id)
  where kind = 'roadmap' and state not in ('merged', 'abandoned');
create unique index documents_one_open_contract on wos.documents (catalog_feature_id)
  where kind = 'feature_contract' and state not in ('merged', 'abandoned');
create trigger documents_touch before update on wos.documents for each row execute function wos.touch_updated_at();

create table wos.inventory_versions (
  id           uuid primary key default gen_random_uuid(),
  target_id    uuid not null references wos.targets (id),
  version      integer not null check (version > 0),
  state        text not null check (state in ('proposed', 'frozen', 'superseded')),
  document_id  uuid not null references wos.documents (id),
  head_sha     text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  item_count   integer not null check (item_count > 0),
  frozen_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (target_id, version),
  check ((state = 'proposed') = (frozen_at is null))
);
create unique index inventory_one_frozen on wos.inventory_versions (target_id) where state = 'frozen';

create table wos.inventory_items (
  id                    uuid primary key default gen_random_uuid(),
  inventory_version_id  uuid not null references wos.inventory_versions (id),
  key                   text not null check (key ~ '^INV-\d{4}$'),
  area                  text not null,
  title                 text not null,
  weight                integer not null default 1 check (weight = 1),
  source_url            text not null,
  unique (inventory_version_id, key)
);

-- Capabilities of one app as of its latest merged roadmap version (older versions: git history + snapshots).
create table wos.capabilities (
  id                uuid primary key default gen_random_uuid(),
  target_id         uuid not null references wos.targets (id),
  key               text not null check (key ~ '^[a-z][a-z0-9-]{0,39}$'),
  title             text not null,
  summary           text not null,
  position          integer not null,
  weight_bp         integer not null check (weight_bp between 1 and 10000),   -- D12, reasoned, frozen per version
  weight_rationale  text not null check (length(btrim(weight_rationale)) >= 40),
  mapped            boolean not null,
  roadmap_version   integer not null check (roadmap_version > 0),
  retired           boolean not null default false,
  unique (target_id, key)
);

-- The global Feature Catalog (D10): app-independent, one contract and one build graph per feature.
create table wos.catalog_features (
  id                            uuid primary key default gen_random_uuid(),
  key                           text not null unique check (key ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'),
  title                         text not null,
  summary                       text not null,
  state                         text not null check (state in ('active', 'aliased')),
  alias_of                      uuid references wos.catalog_features (id),
  created_by_document_id        uuid not null references wos.documents (id),
  current_contract_document_id  uuid references wos.documents (id),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  row_version                   integer not null default 0,
  check ((state = 'aliased') = (alias_of is not null)),
  check (alias_of is null or alias_of <> id)
);
create trigger catalog_features_touch before update on wos.catalog_features for each row execute function wos.touch_updated_at();
alter table wos.documents add constraint documents_catalog_feature_fk foreign key (catalog_feature_id) references wos.catalog_features (id);

-- D11: one tracked record per (app, catalog feature), materialised when the app's roadmap version merges.
create table wos.app_features (
  id                     uuid primary key default gen_random_uuid(),
  target_id              uuid not null references wos.targets (id),
  catalog_feature_id     uuid not null references wos.catalog_features (id),
  capability_id          uuid not null references wos.capabilities (id),
  state                  text not null check (state in ('mapped', 'specifying', 'specified', 'building', 'built', 'descoped')),
  weight_bp              integer not null check (weight_bp between 1 and 10000),   -- share of its capability (D12)
  weight_rationale       text not null check (length(btrim(weight_rationale)) >= 40),
  app_notes              text not null default '',
  phase                  text not null check (phase in ('core', 'later')),
  first_roadmap_version  integer not null check (first_roadmap_version > 0),
  roadmap_version        integer not null check (roadmap_version >= first_roadmap_version),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  row_version            integer not null default 0,
  unique (target_id, catalog_feature_id)
);
create index app_features_catalog on wos.app_features (catalog_feature_id);
create trigger app_features_touch before update on wos.app_features for each row execute function wos.touch_updated_at();

-- Each inventory item of a version is either mapped to exactly one feature or excluded (the denominator rule).
-- Each inventory item of a version: in exactly one capability (and, once mapped, one app feature) or excluded.
create table wos.inventory_dispositions (
  inventory_version_id  uuid not null references wos.inventory_versions (id),
  inventory_item_id     uuid not null references wos.inventory_items (id),
  capability_id         uuid references wos.capabilities (id),
  app_feature_id        uuid references wos.app_features (id),
  excluded_reason       text,
  roadmap_version       integer not null,
  primary key (inventory_version_id, inventory_item_id),
  check ((capability_id is null) <> (excluded_reason is null)),
  check (app_feature_id is null or capability_id is not null)
);
create index inventory_dispositions_app_feature on wos.inventory_dispositions (app_feature_id);

create table wos.requirements (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references wos.documents (id),
  catalog_feature_id uuid not null references wos.catalog_features (id),
  key          text not null check (key ~ '^R-\d{3}$'),
  kind         text not null check (kind in ('functional', 'data', 'api', 'ui', 'security', 'performance', 'operability')),
  statement    text not null,
  unique (document_id, key)
);

-- D10 per-app parity profiles: which requirements of a contract version each app needs.
create table wos.requirement_profiles (
  document_id     uuid not null references wos.documents (id),
  target_id       uuid not null references wos.targets (id),
  requirement_id  uuid not null references wos.requirements (id),
  primary key (document_id, target_id, requirement_id)
);
create index requirement_profiles_target on wos.requirement_profiles (target_id, document_id);

-- ============================================================================================
-- Build graph
-- ============================================================================================
create table wos.abus (
  id                  uuid primary key default gen_random_uuid(),
  catalog_feature_id  uuid not null references wos.catalog_features (id),
  document_id         uuid not null references wos.documents (id),
  key                 text not null check (key ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]#\d{2}$'),
  title               text not null,
  size_points         integer not null check (size_points in (1, 2, 3, 5, 8)),
  state               text not null check (state in ('pending_dependencies', 'ready', 'in_progress', 'merged', 'needs_decomposition', 'superseded')),
  spec                jsonb not null,   -- AbuSpec exactly as merged in BUILD-GRAPH.yaml
  est_context_tokens  integer not null check (est_context_tokens > 0),
  failed_attempts     integer not null default 0 check (failed_attempts >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  row_version         integer not null default 0,
  unique (document_id, key)
);
create index abus_feature_state on wos.abus (catalog_feature_id, state);
create trigger abus_touch before update on wos.abus for each row execute function wos.touch_updated_at();

create table wos.abu_dependencies (
  abu_id             uuid not null references wos.abus (id),
  depends_on_abu_id  uuid not null references wos.abus (id),
  primary key (abu_id, depends_on_abu_id),
  check (abu_id <> depends_on_abu_id)
);
create index abu_dependencies_reverse on wos.abu_dependencies (depends_on_abu_id);

create table wos.abu_requirements (
  abu_id          uuid not null references wos.abus (id),
  requirement_id  uuid not null references wos.requirements (id),
  primary key (abu_id, requirement_id)
);

-- ============================================================================================
-- Attempts, rounds, tasks, leases, locks
-- ============================================================================================
create table wos.attempts (
  id                    uuid primary key default gen_random_uuid(),
  abu_id                uuid not null references wos.abus (id),
  account_id            uuid not null references wos.accounts (id),
  github_user_id        bigint not null,   -- snapshot at claim: provenance records the GitHub identity (D8)
  state                 text not null check (state in ('leased', 'building', 'verifying', 'submitted', 'candidate_pushed', 'in_review', 'changes_requested', 'qualified', 'pr_open', 'merged', 'expired', 'abandoned', 'failed', 'closed_unmerged', 'superseded')),
  base_sha              text not null check (base_sha ~ '^[0-9a-f]{40}$'),
  candidate_branch      text,
  head_sha              text check (head_sha is null or head_sha ~ '^[0-9a-f]{40}$'),
  repair_count          integer not null default 0 check (repair_count >= 0),
  local_repair_count    integer not null default 0 check (local_repair_count >= 0),
  revision_deadline_at  timestamptz,
  pr_number             integer,
  pr_url                text,
  merged_sha            text check (merged_sha is null or merged_sha ~ '^[0-9a-f]{40}$'),
  failure_reason        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  row_version           integer not null default 0,
  check ((state = 'merged') = (merged_sha is not null)),
  check (state <> 'changes_requested' or revision_deadline_at is not null)
);
-- At most one live attempt per ABU.
create unique index attempts_one_live_per_abu on wos.attempts (abu_id)
  where state not in ('merged', 'expired', 'abandoned', 'failed', 'closed_unmerged', 'superseded');
create index attempts_account on wos.attempts (account_id, state);
create trigger attempts_touch before update on wos.attempts for each row execute function wos.touch_updated_at();

create table wos.rounds (
  id            uuid primary key default gen_random_uuid(),
  subject_kind  text not null check (subject_kind in ('roadmap', 'feature_contract', 'implementation')),
  document_id   uuid references wos.documents (id),
  attempt_id    uuid references wos.attempts (id),
  round_number  integer not null check (round_number > 0),
  head_sha      text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  submission_sha256 text not null check (submission_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state         text not null check (state in ('awaiting_reviews', 'revealed', 'cancelled')),
  outcome       text check (outcome in ('consensus', 'gaps')),
  independence  text check (independence in ('independent', 'bootstrap_maintainer', 'bootstrap_self')),
  opened_at     timestamptz not null default now(),
  revealed_at   timestamptz,
  row_version   integer not null default 0,
  check ((subject_kind = 'implementation') = (attempt_id is not null)),
  check ((subject_kind <> 'implementation') = (document_id is not null)),
  check ((state = 'revealed') = (revealed_at is not null and outcome is not null and independence is not null))
);
create unique index rounds_document_number on wos.rounds (document_id, round_number) where document_id is not null;
create unique index rounds_attempt_number on wos.rounds (attempt_id, round_number) where attempt_id is not null;
create unique index rounds_one_open_document on wos.rounds (document_id) where document_id is not null and state = 'awaiting_reviews';
create unique index rounds_one_open_attempt on wos.rounds (attempt_id) where attempt_id is not null and state = 'awaiting_reviews';

create table wos.proposals (
  id            uuid primary key default gen_random_uuid(),
  target_id     uuid references wos.targets (id),
  catalog_feature_id uuid references wos.catalog_features (id),
  account_id    uuid not null references wos.accounts (id),
  title         text not null,
  body          text not null,
  issue_number  integer,
  state         text not null check (state in ('open', 'accepted', 'rejected', 'incorporated')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  row_version   integer not null default 0
);
create trigger proposals_touch before update on wos.proposals for each row execute function wos.touch_updated_at();

create table wos.blockers (
  id                    uuid primary key default gen_random_uuid(),
  target_id             uuid references wos.targets (id),
  account_id            uuid not null references wos.accounts (id),
  abu_id                uuid references wos.abus (id),
  affected_contract     text not null,
  reason                text not null,
  evidence              text not null,
  requested_capability  text not null,
  affected_workstream   text not null,
  suggested_resolution  text,
  issue_number          integer,
  state                 text not null check (state in ('open', 'resolving', 'resolved', 'rejected')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  row_version           integer not null default 0
);
create trigger blockers_touch before update on wos.blockers for each row execute function wos.touch_updated_at();

create table wos.tasks (
  id                        uuid primary key default gen_random_uuid(),
  kind                      text not null check (kind in ('roadmap_author', 'roadmap_review', 'feature_author', 'feature_review', 'abu_build', 'abu_revision', 'implementation_review', 'conflict_resolution')),
  state                     text not null check (state in ('blocked', 'open', 'leased', 'submitted', 'completed', 'cancelled')),
  role                      text not null check (role in ('roadmap_author', 'roadmap_reviewer_astra', 'roadmap_reviewer_fable', 'feature_author', 'feature_reviewer_astra', 'feature_reviewer_fable', 'builder', 'implementation_reviewer_astra', 'implementation_reviewer_fable', 'conflict_resolver')),
  reviewer_slot             text check (reviewer_slot in ('astra', 'fable')),
  target_id                 uuid references wos.targets (id),            -- roadmap tasks
  catalog_feature_id        uuid references wos.catalog_features (id),   -- contract / build tasks
  abu_id                    uuid references wos.abus (id),
  attempt_id                uuid references wos.attempts (id),
  document_id               uuid references wos.documents (id),
  round_id                  uuid references wos.rounds (id),
  blocker_id                uuid references wos.blockers (id),
  -- Only this account may claim (abu_revision: the attempt's builder).
  restricted_to_account_id  uuid references wos.accounts (id),
  -- Accounts that may never claim (authors of the subject; the other slot's reviewer).
  excluded_account_ids      uuid[] not null default '{}',
  -- Deterministic validator errors to fix (author tasks after validation_failed).
  carry                     jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  row_version               integer not null default 0,
  check ((kind in ('roadmap_review', 'feature_review', 'implementation_review')) = (reviewer_slot is not null)),
  check ((kind in ('roadmap_review', 'feature_review', 'implementation_review')) = (round_id is not null)),
  check ((kind in ('abu_build', 'abu_revision')) = (abu_id is not null)),
  check (kind <> 'abu_revision' or (attempt_id is not null and restricted_to_account_id is not null))
);
create index tasks_open on wos.tasks (kind, state, created_at) where state in ('open', 'blocked');
create unique index tasks_one_review_per_slot on wos.tasks (round_id, reviewer_slot)
  where round_id is not null and state <> 'cancelled';
create unique index tasks_one_live_build_per_abu on wos.tasks (abu_id)
  where kind = 'abu_build' and state in ('blocked', 'open', 'leased', 'submitted');
create trigger tasks_touch before update on wos.tasks for each row execute function wos.touch_updated_at();

create table wos.leases (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references wos.tasks (id),
  account_id        uuid not null references wos.accounts (id),
  device_id         uuid not null references wos.devices (id),
  state             text not null check (state in ('active', 'completed', 'released', 'expired', 'revoked')),
  context_plan      jsonb not null,   -- ContextPlan issued with the lease (immutable by convention)
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,
  hard_deadline_at  timestamptz not null,
  heartbeat_at      timestamptz,
  ended_at          timestamptz,
  end_reason        text,
  row_version       integer not null default 0,
  check (expires_at <= hard_deadline_at),
  check ((state = 'active') = (ended_at is null))
);
-- Exactly one active lease per task.
create unique index leases_one_active_per_task on wos.leases (task_id) where state = 'active';
create index leases_active_expiry on wos.leases (expires_at) where state = 'active';
create index leases_account_active on wos.leases (account_id) where state = 'active';

-- Write-scope and logical resource locks, held by a live attempt (they survive lease gaps while in review).
create table wos.resource_locks (
  id            uuid primary key default gen_random_uuid(),
  repo_full_name text not null,          -- locks are per repository (D10: all apps share waronsaas/suite)
  attempt_id    uuid not null references wos.attempts (id),
  resource_key  text not null,          -- "path:<prefix>" or a ResourceKey from the build graph
  mode          text not null check (mode in ('exclusive', 'shared')),
  path_prefix   text,                   -- for path locks: the scope without "/**"
  path_is_tree  boolean,
  acquired_at   timestamptz not null default now(),
  released_at   timestamptz,
  check ((resource_key like 'path:%') = (path_prefix is not null and path_is_tree is not null))
);
create index resource_locks_live on wos.resource_locks (repo_full_name) where released_at is null;
-- Backstop for identical exclusive keys. Prefix overlap and shared/exclusive mixing are checked by the
-- control plane while holding pg_advisory_xact_lock(hashtext('wos.locks:' || repo_full_name)).
create unique index resource_locks_exclusive_key on wos.resource_locks (repo_full_name, resource_key)
  where released_at is null and mode = 'exclusive';

-- ============================================================================================
-- Agent evidence (append-only)
-- ============================================================================================
create table wos.context_manifests (
  id                      uuid primary key default gen_random_uuid(),
  lease_id                uuid not null references wos.leases (id),
  task_id                 uuid not null references wos.tasks (id),
  account_id              uuid not null references wos.accounts (id),
  role                    text not null,
  model_id                text not null,
  reasoning               text not null check (reasoning in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')),
  context_format_version  text not null,
  manifest                jsonb not null,
  manifest_sha256         text not null unique check (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at              timestamptz not null default now()
);

create table wos.agent_runs (
  id               uuid primary key default gen_random_uuid(),
  lease_id         uuid not null references wos.leases (id),
  manifest_id      uuid not null references wos.context_manifests (id),
  account_id       uuid not null references wos.accounts (id),
  device_id        uuid not null references wos.devices (id),
  record           jsonb not null,   -- AgentRunRecord
  signature_valid  boolean not null,
  created_at       timestamptz not null default now()
);

create table wos.changesets (
  id              uuid primary key default gen_random_uuid(),
  lease_id        uuid not null references wos.leases (id),
  task_id         uuid not null references wos.tasks (id),
  account_id      uuid not null references wos.accounts (id),
  device_id       uuid not null references wos.devices (id),
  parent_sha      text not null check (parent_sha ~ '^[0-9a-f]{40}$'),
  manifest_sha256    text not null check (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  submission_sha256  text not null check (submission_sha256 ~ '^sha256:[0-9a-f]{64}$'),  -- the "diff hash" (D9)
  signature_valid    boolean not null,
  file_manifest   jsonb not null,    -- [{path, op, mode, sha256, bytes}] — content is NOT stored; GitHub holds it
  total_bytes     integer not null check (total_bytes between 0 and 4000000),
  validation      jsonb not null,    -- ChangesetValidation
  ok              boolean not null,
  summary         jsonb not null,    -- AuthorSummary | BuildSummary
  created_at      timestamptz not null default now()
);

create table wos.candidate_commits (
  id            uuid primary key default gen_random_uuid(),
  changeset_id  uuid not null unique references wos.changesets (id),
  repo          text not null,
  branch        text not null,
  commit_sha    text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  created_at    timestamptz not null default now()
);

create table wos.reviews (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references wos.rounds (id),
  task_id         uuid not null references wos.tasks (id),
  lease_id        uuid not null references wos.leases (id),
  account_id      uuid not null references wos.accounts (id),
  github_user_id  bigint not null,
  slot            text not null check (slot in ('astra', 'fable')),
  provider        text not null check (provider in ('claude_cli', 'codex_cli')),
  model_id        text not null,
  reasoning       text not null check (reasoning in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')),
  head_sha        text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  submission_sha256 text not null check (submission_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  verdict         text not null check (verdict in ('NO_MATERIAL_GAPS', 'MATERIAL_GAPS')),
  body            jsonb not null,   -- ReviewVerdict
  manifest_id     uuid not null references wos.context_manifests (id),
  independence    text not null check (independence in ('independent', 'bootstrap_maintainer', 'bootstrap_self')),
  sealed_at       timestamptz not null default now(),
  unique (round_id, slot),
  unique (round_id, account_id)    -- the two slots of a round are always different accounts
);

create table wos.findings (
  id                       uuid primary key default gen_random_uuid(),
  review_id                uuid not null references wos.reviews (id),
  round_id                 uuid not null references wos.rounds (id),
  document_id              uuid references wos.documents (id),
  attempt_id               uuid references wos.attempts (id),
  local_id                 text not null,
  severity                 text not null check (severity in ('material', 'minor')),
  category                 text not null,
  title                    text not null,
  detail                   text not null,
  evidence                 jsonb not null default '[]',
  suggested_resolution     text not null default '',
  state                    text not null check (state in ('open', 'resolved', 'disputed', 'upheld', 'overruled')),
  dispute_rounds           integer not null default 0 check (dispute_rounds >= 0),
  updated_at               timestamptz not null default now(),
  row_version              integer not null default 0,
  unique (review_id, local_id),
  check ((document_id is null) <> (attempt_id is null))
);
create index findings_open_document on wos.findings (document_id) where state in ('open', 'disputed');
create index findings_open_attempt on wos.findings (attempt_id) where state in ('open', 'disputed');
create trigger findings_touch before update on wos.findings for each row execute function wos.touch_updated_at();

create table wos.finding_responses (
  id          uuid primary key default gen_random_uuid(),
  finding_id  uuid not null references wos.findings (id),
  round_id    uuid references wos.rounds (id),
  account_id  uuid references wos.accounts (id),
  source      text not null check (source in ('author', 'reviewer', 'resolver', 'maintainer')),
  action      text not null check (action in ('fixed', 'disputed', 'resolved', 'still_open', 'upheld', 'overruled')),
  note        text not null,
  created_at  timestamptz not null default now()
);
create index finding_responses_finding on wos.finding_responses (finding_id, created_at);

create table wos.rulings (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references wos.tasks (id),
  lease_id      uuid not null references wos.leases (id),
  account_id    uuid not null references wos.accounts (id),
  body          jsonb not null,   -- Ruling
  state         text not null check (state in ('awaiting_maintainer', 'confirmed', 'rejected')),
  decided_by    uuid references wos.accounts (id),
  decided_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  row_version   integer not null default 0,
  check ((state = 'awaiting_maintainer') = (decided_at is null))
);

create table wos.verification_runs (
  id                     uuid primary key default gen_random_uuid(),
  attempt_id             uuid references wos.attempts (id),
  document_id            uuid references wos.documents (id),
  source                 text not null check (source in ('local', 'ci')),
  head_sha               text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  conclusion             text not null check (conclusion in ('success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale')),
  github_check_suite_id  bigint,
  details                jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  check ((attempt_id is null) <> (document_id is null)),
  check ((source = 'ci') = (github_check_suite_id is not null))
);
create index verification_runs_attempt on wos.verification_runs (attempt_id, head_sha);

create table wos.pull_requests (
  id              uuid primary key default gen_random_uuid(),
  repo_full_name  text not null,
  number          integer not null check (number > 0),
  kind            text not null check (kind in ('roadmap', 'feature_contract', 'implementation')),
  document_id     uuid references wos.documents (id),
  attempt_id      uuid references wos.attempts (id),
  url             text not null,
  head_sha        text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  state           text not null check (state in ('open', 'merged', 'closed')),
  merged_sha      text check (merged_sha is null or merged_sha ~ '^[0-9a-f]{40}$'),
  merged_at       timestamptz,
  opened_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (repo_full_name, number),
  check ((kind = 'implementation') = (attempt_id is not null)),
  check ((state = 'merged') = (merged_sha is not null))
);
create trigger pull_requests_touch before update on wos.pull_requests for each row execute function wos.touch_updated_at();

create table wos.provenance_records (
  id               uuid primary key default gen_random_uuid(),
  pull_request_id  uuid not null references wos.pull_requests (id),
  record           jsonb not null,   -- ProvenanceRecord
  record_sha256    text not null unique check (record_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at       timestamptz not null default now()
);

-- ============================================================================================
-- Contributions and the WOS token ledger (D3)
-- ============================================================================================
create table wos.contributions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references wos.accounts (id),
  github_user_id    bigint not null,   -- GitHub identity that did the work (provenance, D8)
  category          text not null check (category in ('roadmap_work', 'feature_contract_work', 'architecture_resolution', 'implementation', 'review', 'review_finding', 'security', 'feature_completion_pool', 'application_completion_pool')),
  state             text not null check (state in ('pending', 'accepted', 'rejected', 'reversed')),
  target_id         uuid references wos.targets (id),            -- null for shared-feature work (paid once, D10)
  catalog_feature_id uuid references wos.catalog_features (id),
  abu_id            uuid references wos.abus (id),
  attempt_id        uuid references wos.attempts (id),
  document_id       uuid references wos.documents (id),
  review_id         uuid references wos.reviews (id),
  pull_request_id   uuid references wos.pull_requests (id),
  independence      text not null check (independence in ('independent', 'bootstrap_maintainer', 'bootstrap_self')),
  weight            integer not null default 1 check (weight > 0),
  idempotency_key   text not null unique,
  accepted_at       timestamptz,
  ended_reason      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  row_version       integer not null default 0,
  check ((state in ('accepted', 'reversed')) = (accepted_at is not null))
);
create index contributions_account on wos.contributions (account_id, state);
create trigger contributions_touch before update on wos.contributions for each row execute function wos.touch_updated_at();

create table wos.reward_pools (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('feature_completion', 'application_completion')),
  target_id         uuid not null references wos.targets (id),
  app_feature_id    uuid references wos.app_features (id),   -- per-app feature completion (D10)
  amount            bigint not null check (amount >= 0),
  schedule_version  text not null,
  state             text not null check (state in ('open', 'distributed')),
  created_at        timestamptz not null default now(),
  distributed_at    timestamptz,
  check ((kind = 'feature_completion') = (app_feature_id is not null)),
  check ((state = 'distributed') = (distributed_at is not null))
);
create unique index reward_pools_feature on wos.reward_pools (app_feature_id) where kind = 'feature_completion';
create unique index reward_pools_application on wos.reward_pools (target_id) where kind = 'application_completion';

create table wos.ledger_entries (
  id                  uuid primary key default gen_random_uuid(),
  entry_no            bigint not null unique,     -- assigned by trigger under a lock; gapless
  account_id          uuid not null references wos.accounts (id),
  kind                text not null check (kind in ('award', 'release', 'void', 'clawback', 'debit', 'adjustment')),
  bucket              text not null check (bucket in ('held', 'available')),
  amount              bigint not null check (amount <> 0),
  category            text check (category in ('roadmap_work', 'feature_contract_work', 'architecture_resolution', 'implementation', 'review', 'review_finding', 'security', 'feature_completion_pool', 'application_completion_pool')),
  contribution_id     uuid references wos.contributions (id),
  pool_id             uuid references wos.reward_pools (id),
  related_entry_id    uuid references wos.ledger_entries (id),
  pair_id             uuid,
  idempotency_key     text not null unique,
  schedule_version    text not null,
  memo                text not null,
  release_after       timestamptz,
  created_by_kind     text not null check (created_by_kind in ('system', 'maintainer')),
  created_by_account  uuid references wos.accounts (id),
  prev_hash           bytea not null,
  entry_hash          bytea not null unique,
  created_at          timestamptz not null,
  constraint ledger_sign_rules check (
       (kind = 'award'      and bucket = 'held'      and amount > 0 and category is not null and release_after is not null)
    or (kind = 'release'    and ((bucket = 'held' and amount < 0) or (bucket = 'available' and amount > 0)) and pair_id is not null and related_entry_id is not null)
    or (kind = 'void'       and bucket = 'held'      and amount < 0 and related_entry_id is not null)
    or (kind = 'clawback'   and bucket = 'available' and amount < 0 and related_entry_id is not null)
    or (kind = 'debit'      and bucket = 'available' and amount < 0)
    or (kind = 'adjustment' and created_by_kind = 'maintainer' and created_by_account is not null and length(memo) >= 10)
  )
);
create index ledger_entries_account on wos.ledger_entries (account_id, entry_no);

-- Hash chain: entry_hash = sha256(prev_hash || canonical row text). Tamper-evident, verifiable by anyone
-- from the public ledger API. Serialised by an advisory transaction lock.
create or replace function wos.ledger_chain() returns trigger
language plpgsql as $$
declare
  last_no   bigint;
  last_hash bytea;
begin
  perform pg_advisory_xact_lock(7313371);
  select entry_no, entry_hash into last_no, last_hash
    from wos.ledger_entries order by entry_no desc limit 1;
  new.entry_no   := coalesce(last_no, 0) + 1;
  new.prev_hash  := coalesce(last_hash, '\x00'::bytea);
  new.created_at := date_trunc('milliseconds', clock_timestamp());
  new.entry_hash := sha256(new.prev_hash || convert_to(concat_ws('|',
      new.entry_no, new.id, new.account_id, new.kind, new.bucket, new.amount,
      coalesce(new.category, ''), coalesce(new.contribution_id::text, ''), coalesce(new.pool_id::text, ''),
      coalesce(new.related_entry_id::text, ''), coalesce(new.pair_id::text, ''),
      new.idempotency_key, new.schedule_version, new.memo,
      coalesce(to_char(new.release_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
      new.created_by_kind, coalesce(new.created_by_account::text, ''),
      to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ), 'UTF8'));
  return new;
end $$;
create trigger ledger_entries_chain before insert on wos.ledger_entries
  for each row execute function wos.ledger_chain();

-- Derived balances (never stored). Score = lifetime earned; spending (debit) never lowers it.
create view wos.v_balances as
select a.id as account_id,
       coalesce(sum(l.amount) filter (where l.bucket = 'held'), 0)::bigint      as held,
       coalesce(sum(l.amount) filter (where l.bucket = 'available'), 0)::bigint as available,
       coalesce(sum(l.amount) filter (where l.kind in ('award', 'void', 'clawback', 'adjustment')), 0)::bigint as score
  from wos.accounts a
  left join wos.ledger_entries l on l.account_id = a.id
 group by a.id;

create view wos.v_leaderboard as
select rank() over (order by b.score desc, a.created_at asc)::integer as rank,
       a.id as account_id, a.handle, a.display_name, a.avatar_url, b.score
  from wos.accounts a
  join wos.v_balances b on b.account_id = a.id
 where a.leaderboard_opt_in and a.status = 'active' and a.handle is not null and b.score > 0;

-- ============================================================================================
-- Progress (append-only snapshots) and events
-- ============================================================================================
create table wos.events (
  id                 bigint generated always as identity primary key,
  type               text not null check (type ~ '^[a-z_]+\.[a-z_]+$'),
  v                  integer not null default 1 check (v > 0),
  visibility         text not null check (visibility in ('public', 'private')),
  aggregate_kind     text not null,
  aggregate_id       text not null,
  actor_account_id   uuid references wos.accounts (id),
  actor_kind         text not null check (actor_kind in ('contributor', 'maintainer', 'system', 'github')),
  payload            jsonb not null,
  contracts_version  text not null,
  idempotency_key    text unique,
  occurred_at        timestamptz not null default now()
);
create index events_public on wos.events (id desc) where visibility = 'public';
create index events_aggregate on wos.events (aggregate_kind, aggregate_id, id);

create table wos.event_consumptions (
  event_id      bigint not null references wos.events (id),
  consumer      text not null check (consumer in ('progress', 'rewards', 'task_unlocker', 'github_sync', 'public_feed')),
  processed_at  timestamptz not null default now(),
  primary key (event_id, consumer)
);

-- One row per scope per recomputation. The full AppProgress JSON is kept for traceability (D11):
-- every number on the site can be re-derived from `detail` + the records it names.
create table wos.progress_snapshots (
  id                 bigint generated always as identity primary key,
  target_id          uuid not null references wos.targets (id),
  scope              text not null check (scope in ('app', 'capability', 'feature')),
  capability_id      uuid references wos.capabilities (id),
  app_feature_id     uuid references wos.app_features (id),
  mapped_bp          integer not null check (mapped_bp between 0 and 10000),
  specified_bp       integer not null check (specified_bp between 0 and 10000),
  built_bp           integer not null check (built_bp between 0 and 10000),
  roadmap_version    integer,
  inventory_version  integer,
  inventory_items    integer check (inventory_items is null or inventory_items >= 0),
  excluded_items     integer not null default 0 check (excluded_items >= 0),
  input_sha256       text not null check (input_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  detail             jsonb,                 -- AppProgress (scope = 'app' only)
  cause_event_id     bigint references wos.events (id),
  computed_at        timestamptz not null default now(),
  check (built_bp <= specified_bp and specified_bp <= mapped_bp),
  check ((scope = 'app') = (capability_id is null and app_feature_id is null)),
  check ((scope = 'capability') = (capability_id is not null and app_feature_id is null)),
  check ((scope = 'feature') = (app_feature_id is not null)),
  check ((scope = 'app') = (detail is not null))
);
create index progress_snapshots_target on wos.progress_snapshots (target_id, scope, id desc);

create view wos.v_target_progress as
select distinct on (t.id)
       t.id as target_id, t.slug,
       coalesce(p.mapped_bp, 0) as mapped_bp,
       coalesce(p.specified_bp, 0) as specified_bp,
       coalesce(p.built_bp, 0) as built_bp,
       p.roadmap_version, p.inventory_version, p.inventory_items, coalesce(p.excluded_items, 0) as excluded_items,
       p.computed_at
  from wos.targets t
  left join wos.progress_snapshots p on p.target_id = t.id and p.scope = 'app' 
 order by t.id, p.id desc nulls last;

-- ============================================================================================
-- Infrastructure tables
-- ============================================================================================
create table wos.idempotency_keys (
  account_id       uuid not null references wos.accounts (id),
  route            text not null,
  key              uuid not null,
  request_sha256   text not null,
  response_status  integer not null,
  response_body    jsonb not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '24 hours',
  primary key (account_id, route, key)
);
create index idempotency_keys_expiry on wos.idempotency_keys (expires_at);

create table wos.webhook_deliveries (
  delivery_id      text primary key,          -- X-GitHub-Delivery
  event            text not null,
  action           text,
  installation_id  bigint,
  payload_sha256   text not null,
  payload          jsonb not null,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  attempts         integer not null default 0,
  last_error       text
);
create index webhook_deliveries_unprocessed on wos.webhook_deliveries (received_at) where processed_at is null;

create table wos.rate_limits (
  bucket        text not null,      -- e.g. 'signin:email:<sha256>' / 'signin:ip:<sha256>' / 'api:<account>'
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (bucket, window_start)
);

create table wos.outbound_emails (
  id           uuid primary key default gen_random_uuid(),
  template     text not null check (template in ('signin', 'progress_digest', 'lease_expiring', 'review_assigned')),
  to_hash      bytea not null,       -- recipient address is not stored; hash for dedupe/rate limits
  provider_id  text,
  status       text not null check (status in ('queued', 'sent', 'failed')),
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

-- ============================================================================================
-- Integrity triggers
-- ============================================================================================

-- Reviewer independence backstop: an implementation reviewer is never the attempt's builder,
-- and a document reviewer never authored a revision of that document, unless the review is
-- explicitly labelled bootstrap_self (AGENT-POLICY.md "Bootstrap mode").
create or replace function wos.check_review_independence() returns trigger
language plpgsql as $$
declare
  r wos.rounds%rowtype;
  conflict boolean;
begin
  select * into r from wos.rounds where id = new.round_id;
  if r.state <> 'awaiting_reviews' then
    raise exception 'wos: round % is %, cannot accept a review', r.id, r.state using errcode = 'check_violation';
  end if;
  if new.head_sha <> r.head_sha or new.submission_sha256 <> r.submission_sha256 then
    raise exception 'wos: review is bound to %/% but round % is %/%', new.head_sha, new.submission_sha256, r.id, r.head_sha, r.submission_sha256
      using errcode = 'check_violation';
  end if;
  if new.independence = 'bootstrap_self' then
    return new;
  end if;
  if r.attempt_id is not null then
    select exists (select 1 from wos.attempts a where a.id = r.attempt_id and a.account_id = new.account_id) into conflict;
  else
    select exists (
      select 1 from wos.changesets c join wos.tasks t on t.id = c.task_id
       where t.document_id = r.document_id and c.account_id = new.account_id and c.ok
    ) into conflict;
  end if;
  if conflict then
    raise exception 'wos: account % authored the subject of round % and may not review it', new.account_id, r.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger reviews_independence before insert on wos.reviews
  for each row execute function wos.check_review_independence();

-- Append-only enforcement (every role, including the owner; the app role also lacks the grants).
do $$
declare
  t text;
begin
  foreach t in array array[
    'github_identity_history', 'provider_attestations', 'context_manifests', 'agent_runs', 'changesets',
    'candidate_commits', 'reviews', 'finding_responses', 'verification_runs', 'provenance_records',
    'ledger_entries', 'progress_snapshots', 'events', 'event_consumptions', 'inventory_items'
  ] loop
    execute format('create trigger %I before update or delete on wos.%I for each row execute function wos.forbid_mutation()', t || '_append_only', t);
    execute format('create trigger %I before truncate on wos.%I for each statement execute function wos.forbid_mutation()', t || '_no_truncate', t);
  end loop;
end $$;

-- ============================================================================================
-- Grants
-- ============================================================================================
grant select, insert on
  wos.github_identity_history, wos.provider_attestations, wos.context_manifests, wos.agent_runs,
  wos.changesets, wos.candidate_commits, wos.reviews, wos.finding_responses, wos.verification_runs,
  wos.provenance_records, wos.ledger_entries, wos.progress_snapshots, wos.events, wos.event_consumptions,
  wos.inventory_items
to wos_app;

grant select, insert, update on
  wos.accounts, wos.account_emails, wos.github_link_requests, wos.devices, wos.sessions,
  wos.email_signin_requests, wos.platform_settings, wos.targets, wos.documents, wos.inventory_versions,
  wos.capabilities, wos.catalog_features, wos.app_features, wos.requirement_profiles, wos.inventory_dispositions, wos.requirements, wos.abus,
  wos.abu_dependencies, wos.abu_requirements, wos.attempts, wos.rounds, wos.proposals, wos.blockers,
  wos.tasks, wos.leases, wos.resource_locks, wos.findings, wos.rulings, wos.pull_requests,
  wos.contributions, wos.reward_pools, wos.webhook_deliveries, wos.rate_limits, wos.outbound_emails
to wos_app;

-- Rows the app may delete: follows (unfollow), expired idempotency keys, old rate-limit windows.
grant select, insert, update, delete on wos.follows, wos.idempotency_keys, wos.rate_limits to wos_app;
grant select, insert, delete on wos.account_roles to wos_app;
grant select on wos.v_balances, wos.v_leaderboard, wos.v_target_progress to wos_app;
grant execute on function wos.actor_id(), wos.actor_kind(), wos.is_privileged() to wos_app;

-- ============================================================================================
-- Row-level security
-- ============================================================================================
-- Every table has RLS enabled. Public project data (targets, roadmap structure, ABUs, PRs, events,
-- ledger, progress) is readable by the app role for any actor, because it is public on GitHub and the
-- website anyway. Private data is restricted to the owning account or privileged actors.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'wos' loop
    execute format('alter table wos.%I enable row level security', t);
  end loop;
end $$;

-- Public-data tables: full access for the app role (authorisation is enforced in the control plane
-- by state-machine guards; RLS here guards the private tables below).
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'account_roles', 'platform_settings', 'targets', 'follows', 'documents', 'inventory_versions',
    'inventory_items', 'capabilities', 'catalog_features', 'app_features', 'requirement_profiles', 'inventory_dispositions', 'requirements', 'abus',
    'abu_dependencies', 'abu_requirements', 'attempts', 'rounds', 'proposals', 'blockers', 'tasks',
    'resource_locks', 'changesets', 'candidate_commits', 'finding_responses', 'rulings', 'verification_runs',
    'pull_requests', 'provenance_records', 'contributions', 'reward_pools', 'ledger_entries',
    'progress_snapshots', 'events', 'event_consumptions', 'idempotency_keys', 'webhook_deliveries',
    'rate_limits', 'outbound_emails', 'github_identity_history', 'agent_runs', 'context_manifests'
  ] loop
    execute format('create policy app_all on wos.%I for all to wos_app using (true) with check (true)', t);
  end loop;
end $$;

-- Private: own rows or privileged actor.
create policy own_or_privileged on wos.account_emails for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id())
  with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_or_privileged on wos.devices for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id())
  with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_or_privileged on wos.provider_attestations for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id())
  with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_or_privileged on wos.github_link_requests for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id())
  with check (wos.is_privileged() or account_id = wos.actor_id());
create policy own_or_privileged on wos.leases for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id())
  with check (wos.is_privileged() or account_id = wos.actor_id());

-- Sessions and sign-in requests are looked up before an actor is known: only the 'system' actor
-- (the auth handlers run as system) may touch them.
create policy system_only on wos.sessions for all to wos_app
  using (wos.actor_kind() = 'system') with check (wos.actor_kind() = 'system');
create policy system_only on wos.email_signin_requests for all to wos_app
  using (wos.actor_kind() = 'system') with check (wos.actor_kind() = 'system');

-- Sealed reviews: visible to their author and privileged actors until the round is revealed.
create policy sealed_until_revealed on wos.reviews for select to wos_app
  using (
    wos.is_privileged()
    or account_id = wos.actor_id()
    or exists (select 1 from wos.rounds r where r.id = round_id and r.state = 'revealed')
  );
create policy reviewer_inserts on wos.reviews for insert to wos_app
  with check (wos.is_privileged() or account_id = wos.actor_id());
create policy sealed_until_revealed on wos.findings for select to wos_app
  using (
    wos.is_privileged()
    or exists (select 1 from wos.reviews v where v.id = review_id and v.account_id = wos.actor_id())
    or exists (select 1 from wos.rounds r where r.id = round_id and r.state = 'revealed')
  );
create policy privileged_writes on wos.findings for insert to wos_app with check (wos.is_privileged());
create policy privileged_updates on wos.findings for update to wos_app using (wos.is_privileged()) with check (wos.is_privileged());

-- Seed TGT-00 warOnSaaS and the Sniper List (matches apps/web/data/targets.ts; no progress rows = 0% everywhere).
insert into wos.targets (slug, name, rank, what_it_is, repo_full_name, product_path) values
  ('waronsaas', 'warOnSaaS', 0, 'wOS: the platform that coordinates contributors and their agents to build the replacements. Its own first target (TGT-00).', 'waronsaas/waronsaas', '.'),
  ('salesforce', 'Salesforce', 1, 'Customer relationship management (CRM) for sales teams.', 'waronsaas/suite', 'products/salesforce'),
  ('hubspot', 'HubSpot', 2, 'Marketing, sales and customer service software built around one contact database.', 'waronsaas/suite', 'products/hubspot'),
  ('slack', 'Slack', 3, 'Team chat for work.', 'waronsaas/suite', 'products/slack'),
  ('zoom', 'Zoom', 4, 'Video meetings and webinars.', 'waronsaas/suite', 'products/zoom'),
  ('shopify', 'Shopify', 5, 'Software for running an online store.', 'waronsaas/suite', 'products/shopify'),
  ('quickbooks', 'QuickBooks', 6, 'Accounting software for small businesses.', 'waronsaas/suite', 'products/quickbooks'),
  ('jira', 'Jira', 7, 'Issue and project tracking for software teams.', 'waronsaas/suite', 'products/jira'),
  ('zendesk', 'Zendesk', 8, 'Customer support ticketing and help centre software.', 'waronsaas/suite', 'products/zendesk'),
  ('docusign', 'DocuSign', 9, 'Electronic signatures and agreement workflows.', 'waronsaas/suite', 'products/docusign'),
  ('netsuite', 'NetSuite', 10, 'Cloud ERP: finance, inventory and operations for mid-size companies.', 'waronsaas/suite', 'products/netsuite');

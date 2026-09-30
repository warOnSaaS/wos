-- 0012_identity_and_organizations.sql — contracts 5.12.0 (Amendment 04, D65). Owner: Lead Architect.
-- PRODUCTION MIGRATION: the coordinator applies it through the runner (list with --check first) before the control
-- plane serves IdentityRoutes (Wave 3b). Additive: new tables, two new columns with defaults, one new trigger.
--
--   github_signin_requests   Sign in with GitHub, bound to the starting client's poll secret (S-2), system only.
--   organizations.plan       every organization is on plan 'free' (quotas are policy data; no billing in V1).
--   memberships.via          how a member joined (created, invite, domain_auto_join, join_request, scim).
--   org_invites              invites by email with a role; 7 days; one pending invite per (org, email).
--   org_domains              verified domains; a domain is verified by at most one organization.
--   org_join_requests        join requests on a verified domain with policy 'request'.
--   org_join_exclusions      accounts that left or were removed: never auto-joined again.
--   org_app_permissions      per-app permission overrides (a set per organization and app).
--   memberships_rules_actor  admins never touch owners; members only leave (defence in depth for the API rules).
-- Dormant enterprise modules (SSO, SCIM, audit export) get their tables when activated, not here.
-- Touches none of the objects of the draft protocol migrations 0007 and 0010.

-- --------------------------------------------------------------------------------------------
-- 1. Sign in with GitHub
-- --------------------------------------------------------------------------------------------
create table wos.github_signin_requests (
  id                  uuid primary key default gen_random_uuid(),
  client_kind         text not null check (client_kind in ('web', 'desktop', 'cli', 'web_app', 'mobile')),
  flow                text not null check (flow in ('device', 'web')),
  device_code         text,
  state_hash          bytea,
  poll_secret_hash    bytea not null,
  device_name         text check (device_name is null or length(device_name) <= 100),
  device_public_key   text,
  ip_hash             bytea,
  state               text not null default 'pending'
                        check (state in ('pending', 'email_proof_required', 'signed_in', 'denied', 'expired', 'refused')),
  refusal             text check (refusal in ('GITHUB_RESERVED', 'GITHUB_EMAIL_UNVERIFIED', 'ACCOUNT_SUSPENDED')),
  github_user_id      bigint,
  proof_account_id    uuid references wos.accounts (id),
  proof_code_hash     bytea,
  proof_attempts      integer not null default 0 check (proof_attempts between 0 and 5),
  signed_in_account_id uuid references wos.accounts (id),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  completed_at        timestamptz,
  check (expires_at <= created_at + interval '30 minutes'),
  check ((flow = 'device') = (device_code is not null)),
  check ((flow = 'web') = (state_hash is not null)),
  check ((flow = 'web') = (client_kind in ('web', 'web_app'))),
  check (device_public_key is null or client_kind in ('desktop', 'cli')),
  check (state <> 'email_proof_required' or (proof_account_id is not null and proof_code_hash is not null)),
  check ((state = 'refused') = (refusal is not null)),
  check ((state = 'signed_in') = (signed_in_account_id is not null))
);
create index github_signin_requests_ip on wos.github_signin_requests (ip_hash, created_at desc);

-- --------------------------------------------------------------------------------------------
-- 2. Plans and how members joined
-- --------------------------------------------------------------------------------------------
alter table wos.organizations add column plan text not null default 'free' check (plan in ('free'));
alter table wos.memberships add column via text not null default 'created'
  check (via in ('created', 'invite', 'domain_auto_join', 'join_request', 'scim'));

-- --------------------------------------------------------------------------------------------
-- 3. Invites
-- --------------------------------------------------------------------------------------------
create table wos.org_invites (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references wos.organizations (id),
  email_normalized  text not null check (email_normalized = lower(btrim(email_normalized)) and length(email_normalized) <= 254),
  role              text not null check (role in ('owner', 'admin', 'member')),
  invited_by        uuid not null references wos.accounts (id),
  state             text not null default 'pending' check (state in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  responded_at      timestamptz,
  responded_by      uuid references wos.accounts (id),
  row_version       integer not null default 0,
  check (expires_at <= created_at + interval '7 days'),
  check ((state = 'pending') = (responded_at is null))
);
create unique index org_invites_one_pending on wos.org_invites (organization_id, email_normalized) where state = 'pending';
create index org_invites_email on wos.org_invites (email_normalized) where state = 'pending';

-- --------------------------------------------------------------------------------------------
-- 4. Verified domains, join requests, exclusions
-- --------------------------------------------------------------------------------------------
create table wos.org_domains (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references wos.organizations (id),
  domain            text not null check (domain ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' and length(domain) <= 253),
  token_hash        bytea not null,
  state             text not null default 'pending' check (state in ('pending', 'verified', 'failed', 'lapsed', 'removed')),
  join_policy       text not null default 'off' check (join_policy in ('off', 'request', 'auto_join')),
  created_at        timestamptz not null default now(),
  verified_at       timestamptz,
  last_checked_at   timestamptz,
  failing_since     timestamptz,
  row_version       integer not null default 0,
  check ((state in ('verified', 'lapsed')) <= (verified_at is not null))
);
-- One organization per verified domain (the first to verify wins); one live row per (org, domain).
create unique index org_domains_one_verified on wos.org_domains (domain) where state = 'verified';
create unique index org_domains_one_live on wos.org_domains (organization_id, domain) where state in ('pending', 'verified', 'lapsed');

create table wos.org_join_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references wos.organizations (id),
  account_id        uuid not null references wos.accounts (id),
  domain_id         uuid not null references wos.org_domains (id),
  state             text not null default 'pending' check (state in ('pending', 'approved', 'denied', 'withdrawn')),
  created_at        timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        uuid references wos.accounts (id),
  row_version       integer not null default 0
);
create unique index org_join_requests_one_pending on wos.org_join_requests (organization_id, account_id) where state = 'pending';

create table wos.org_join_exclusions (
  organization_id  uuid not null references wos.organizations (id),
  account_id       uuid not null references wos.accounts (id),
  reason           text not null check (reason in ('left', 'removed')),
  created_at       timestamptz not null default now(),
  primary key (organization_id, account_id)
);

-- Invites and domains exist only for team organizations.
create or replace function wos.team_org_only() returns trigger
language plpgsql as $$
begin
  if (select kind from wos.organizations where id = new.organization_id) <> 'team' then
    raise exception 'wos: a personal organization has no % ', tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger org_invites_team_only before insert on wos.org_invites for each row execute function wos.team_org_only();
create trigger org_domains_team_only before insert on wos.org_domains for each row execute function wos.team_org_only();
create trigger org_join_requests_team_only before insert on wos.org_join_requests for each row execute function wos.team_org_only();

-- --------------------------------------------------------------------------------------------
-- 5. Per-app permission overrides
-- --------------------------------------------------------------------------------------------
create table wos.org_app_permissions (
  organization_id  uuid not null references wos.organizations (id),
  app_id           text not null check (app_id ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$'),
  overrides        jsonb not null default '[]' check (jsonb_typeof(overrides) = 'array' and jsonb_array_length(overrides) <= 200),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references wos.accounts (id),
  row_version      integer not null default 0,
  primary key (organization_id, app_id)
);

-- --------------------------------------------------------------------------------------------
-- 6. Member rules for non-privileged actors: admins never change or remove owners, never make owners;
--    a member (or anyone) may delete only their own membership (leave).
-- --------------------------------------------------------------------------------------------
create or replace function wos.memberships_actor_rules() returns trigger
language plpgsql as $$
declare
  actor_role text;
begin
  -- Only the application role is bound (like RLS); owners, migrations and privileged actors are not.
  if current_user <> 'wos_app' or wos.is_privileged() then
    return coalesce(new, old);
  end if;
  actor_role := wos.org_role(coalesce(new.organization_id, old.organization_id));
  if tg_op = 'DELETE' and old.account_id = wos.actor_id() then
    return old;
  end if;
  -- The creator's own first membership (wos.create_team_organization).
  if tg_op = 'INSERT' and new.account_id = wos.actor_id()
     and not exists (select 1 from wos.memberships m where m.organization_id = new.organization_id) then
    return new;
  end if;
  if actor_role = 'admin' and (
       (tg_op in ('UPDATE', 'DELETE') and old.role = 'owner')
    or (tg_op in ('INSERT', 'UPDATE') and new.role = 'owner')
    or (tg_op = 'DELETE' and old.role = 'admin')) then
    raise exception 'wos: admins do not manage owners, and remove members only' using errcode = 'insufficient_privilege';
  end if;
  if actor_role is distinct from 'owner' and actor_role is distinct from 'admin' then
    raise exception 'wos: only owners and admins manage members' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end $$;
-- Named to run after 0006's memberships_rules (triggers fire in name order).
create trigger memberships_rules_actor before insert or update or delete on wos.memberships
  for each row execute function wos.memberships_actor_rules();

-- --------------------------------------------------------------------------------------------
-- 7. Grants and RLS
-- --------------------------------------------------------------------------------------------
grant select, insert, update on wos.github_signin_requests, wos.org_invites, wos.org_domains, wos.org_join_requests,
  wos.org_app_permissions to wos_app;
grant select, insert on wos.org_join_exclusions to wos_app;

alter table wos.github_signin_requests enable row level security;
alter table wos.org_invites enable row level security;
alter table wos.org_domains enable row level security;
alter table wos.org_join_requests enable row level security;
alter table wos.org_join_exclusions enable row level security;
alter table wos.org_app_permissions enable row level security;

-- Looked up before an actor is known, like email sign-in: system only.
create policy system_only on wos.github_signin_requests for all to wos_app
  using (wos.actor_kind() = 'system') with check (wos.actor_kind() = 'system');

-- Invites: owners and admins of the organization; the invitee's side (by email) is served by the system actor.
create policy admins_all on wos.org_invites for all to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'))
  with check (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'));

create policy members_read on wos.org_domains for select to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) is not null);
create policy owners_write on wos.org_domains for insert to wos_app
  with check (wos.is_privileged() or wos.org_role(organization_id) = 'owner');
create policy owners_update on wos.org_domains for update to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) = 'owner')
  with check (wos.is_privileged() or wos.org_role(organization_id) = 'owner');

create policy requester_or_admins on wos.org_join_requests for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id() or wos.org_role(organization_id) in ('owner', 'admin'))
  with check (wos.is_privileged() or account_id = wos.actor_id() or wos.org_role(organization_id) in ('owner', 'admin'));

create policy privileged_or_self on wos.org_join_exclusions for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id() or wos.org_role(organization_id) in ('owner', 'admin'))
  with check (wos.is_privileged() or account_id = wos.actor_id() or wos.org_role(organization_id) in ('owner', 'admin'));

create policy members_read on wos.org_app_permissions for select to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) is not null);
create policy admins_write on wos.org_app_permissions for insert to wos_app
  with check (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'));
create policy admins_update on wos.org_app_permissions for update to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'))
  with check (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'));

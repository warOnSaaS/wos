-- 0006_one_product.sql — contracts 5.0.0 (Amendment 01: wOS is one product; D16 Build is an opt-in app;
-- D17 Desktop on macOS, Windows and Linux). Owner: Lead Architect.
--
-- Adds wOS Cloud tenancy (organizations, memberships), the AppRegistry (apps and their signed releases),
-- AppEntitlements, the target -> app mapping and the wOS Cloud environment. Entitlements gate HOSTED
-- activation only: nothing here is consulted by a self-hosted wOS (SECURITY S-41).
-- Applied by hand through the runner on top of 0005 (docs/architecture/ARCHITECTURE.md section 10).

-- --------------------------------------------------------------------------------------------
-- 0. Surfaces: 'api' joins Surface (packages/contracts/src/primitives.ts). The product surfaces are
--    web, desktop, ios, android and api (ProductSurface).
-- --------------------------------------------------------------------------------------------
alter table wos.target_surfaces drop constraint if exists target_surfaces_surface_check;
alter table wos.target_surfaces add constraint target_surfaces_surface
  check (surface in ('web', 'ios', 'android', 'desktop', 'api', 'cli', 'browser_extension', 'email_addin', 'other'));
alter table wos.app_feature_surfaces drop constraint if exists app_feature_surfaces_surface_check;
alter table wos.app_feature_surfaces add constraint app_feature_surfaces_surface
  check (surface in ('web', 'ios', 'android', 'desktop', 'api', 'cli', 'browser_extension', 'email_addin', 'other'));
alter table wos.requirement_surfaces drop constraint if exists requirement_surfaces_surface_check;
alter table wos.requirement_surfaces add constraint requirement_surfaces_surface
  check (surface in ('web', 'ios', 'android', 'desktop', 'api', 'cli', 'browser_extension', 'email_addin', 'other'));
alter table wos.verification_runs drop constraint if exists verification_runs_surface_check;
alter table wos.verification_runs add constraint verification_runs_surface
  check (surface in ('web', 'ios', 'android', 'desktop', 'api', 'cli', 'browser_extension', 'email_addin', 'other'));

-- --------------------------------------------------------------------------------------------
-- 1. Organizations and memberships (wOS Cloud tenancy). Every account has exactly one personal
--    organization; team organizations are created by an account that becomes their owner.
-- --------------------------------------------------------------------------------------------
create table wos.organizations (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name                 text not null check (length(btrim(name)) between 1 and 80),
  kind                 text not null check (kind in ('personal', 'team')),
  personal_account_id  uuid unique references wos.accounts (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  row_version          integer not null default 0,
  check ((kind = 'personal') = (personal_account_id is not null))
);
create trigger organizations_touch before update on wos.organizations for each row execute function wos.touch_updated_at();

create or replace function wos.organizations_immutable() returns trigger
language plpgsql as $$
begin
  if new.kind <> old.kind or new.personal_account_id is distinct from old.personal_account_id then
    raise exception 'wos: an organization''s kind and personal owner never change' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger organizations_immutable before update on wos.organizations for each row execute function wos.organizations_immutable();

create table wos.memberships (
  organization_id  uuid not null references wos.organizations (id),
  account_id       uuid not null references wos.accounts (id),
  role             text not null check (role in ('owner', 'admin', 'member')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  row_version      integer not null default 0,
  primary key (organization_id, account_id)
);
create index memberships_account on wos.memberships (account_id);
create trigger memberships_touch before update on wos.memberships for each row execute function wos.touch_updated_at();

-- A personal organization has exactly one member, its account, as owner. Every organization keeps an owner.
create or replace function wos.memberships_rules() returns trigger
language plpgsql as $$
declare
  org record;
  oid uuid := coalesce(new.organization_id, old.organization_id);
begin
  select kind, personal_account_id into org from wos.organizations where id = oid;
  if tg_op in ('INSERT', 'UPDATE') and org.kind = 'personal' and (new.account_id <> org.personal_account_id or new.role <> 'owner') then
    raise exception 'wos: a personal organization has only its own account, as owner' using errcode = 'check_violation';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if org.kind = 'personal' then
      raise exception 'wos: the owner of a personal organization cannot be removed' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from wos.memberships m where m.organization_id = oid and m.role = 'owner' and m.account_id <> old.account_id) then
      raise exception 'wos: an organization must keep at least one owner' using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_rules before insert or update or delete on wos.memberships
  for each row execute function wos.memberships_rules();

-- The caller's role in an organization (null = not a member). Security definer: used inside RLS policies.
create or replace function wos.org_role(org uuid) returns text
language sql stable security definer set search_path = wos, pg_temp as $$
  select role from wos.memberships where organization_id = org and account_id = wos.actor_id()
$$;

-- Every new account gets its personal organization (D16: its owner may enable Build for themselves).
create or replace function wos.create_personal_organization() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  oid uuid := gen_random_uuid();
begin
  insert into wos.organizations (id, slug, name, kind, personal_account_id)
  values (oid, 'u-' || replace(new.id::text, '-', ''), coalesce(new.display_name, new.handle, 'Personal'), 'personal', new.id);
  insert into wos.memberships (organization_id, account_id, role) values (oid, new.id, 'owner');
  return new;
end $$;
create trigger accounts_personal_organization after insert on wos.accounts
  for each row execute function wos.create_personal_organization();

-- Team organizations are created through this function so the creator is owner in the same statement.
create or replace function wos.create_team_organization(p_slug text, p_name text) returns uuid
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  oid uuid := gen_random_uuid();
begin
  if wos.actor_id() is null then
    raise exception 'wos: creating an organization needs a signed-in actor' using errcode = 'insufficient_privilege';
  end if;
  insert into wos.organizations (id, slug, name, kind) values (oid, p_slug, p_name, 'team');
  insert into wos.memberships (organization_id, account_id, role) values (oid, wos.actor_id(), 'owner');
  return oid;
end $$;

-- --------------------------------------------------------------------------------------------
-- 2. AppRegistry: applications, shared modules and core, and their released versions.
-- --------------------------------------------------------------------------------------------
create table wos.app_registry (
  app_id           text primary key check (app_id ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$'),
  name             text not null,
  kind             text not null check (kind in ('core', 'app', 'module')),
  billing          text not null check (billing in ('base', 'addon', 'free')),
  current_version  text check (current_version ~ '^\d+\.\d+\.\d+$'),   -- latest published, not yanked; null before the first release
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  row_version      integer not null default 0,
  check ((kind = 'core') = (app_id = 'core')),
  check ((kind = 'core') = (billing = 'base')),
  check (kind <> 'module' or billing = 'free'),
  check (app_id <> 'build' or billing = 'free')
);
create trigger app_registry_touch before update on wos.app_registry for each row execute function wos.touch_updated_at();

create table wos.app_releases (
  app_id                  text not null references wos.app_registry (app_id),
  version                 text not null check (version ~ '^\d+\.\d+\.\d+$'),
  state                   text not null default 'published' check (state in ('published', 'yanked')),
  manifest                jsonb not null,                       -- WosAppManifest, validated by the control plane
  manifest_sha256         text not null check (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  surfaces                text[] not null check (surfaces <@ array['web', 'desktop', 'ios', 'android', 'api']),
  desktop_package         jsonb,                                -- ModulePackage (signature verified on publish, S-37)
  desktop_package_url     text check (desktop_package_url ~ '^https://'),
  source_repo             text not null,
  source_tag              text not null,
  source_commit           text not null check (source_commit ~ '^[0-9a-f]{40}$'),
  published_at            timestamptz not null default now(),
  yanked_at               timestamptz,
  yank_reason             text,
  row_version             integer not null default 0,
  primary key (app_id, version),
  check ((state = 'yanked') = (yanked_at is not null and yank_reason is not null)),
  check ((desktop_package is null) = (desktop_package_url is null)),
  check (('desktop' = any (surfaces)) = (desktop_package is not null))
);

-- Releases are immutable except the one-way yank; versions only increase per app (downgrade protection, S-39).
create or replace function wos.app_releases_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'wos: app releases are never deleted (yank instead)' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'published' then
      raise exception 'wos: a release is inserted as published' using errcode = 'check_violation';
    end if;
    if exists (select 1 from wos.app_releases r where r.app_id = new.app_id
                and string_to_array(r.version, '.')::int[] >= string_to_array(new.version, '.')::int[]) then
      raise exception 'wos: release % of % is not newer than an existing release', new.version, new.app_id using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.app_id, new.version, new.manifest, new.manifest_sha256, new.surfaces, new.desktop_package, new.desktop_package_url,
      new.source_repo, new.source_tag, new.source_commit, new.published_at)
     is distinct from
     (old.app_id, old.version, old.manifest, old.manifest_sha256, old.surfaces, old.desktop_package, old.desktop_package_url,
      old.source_repo, old.source_tag, old.source_commit, old.published_at) then
    raise exception 'wos: a published release is immutable' using errcode = 'insufficient_privilege';
  end if;
  if not (old.state = 'published' and new.state = 'yanked') and new.state is distinct from old.state then
    raise exception 'wos: illegal release transition % -> %', old.state, new.state using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger app_releases_rules before insert or update or delete on wos.app_releases
  for each row execute function wos.app_releases_rules();
create trigger app_releases_no_truncate before truncate on wos.app_releases
  for each statement execute function wos.forbid_mutation();

-- current_version = the highest published (not yanked) release.
create or replace function wos.app_registry_current_version() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  update wos.app_registry g set current_version = (
    select r.version from wos.app_releases r where r.app_id = g.app_id and r.state = 'published'
     order by string_to_array(r.version, '.')::int[] desc limit 1),
    row_version = g.row_version + 1
   where g.app_id = new.app_id;
  return null;
end $$;
create trigger app_releases_current after insert or update on wos.app_releases
  for each row execute function wos.app_registry_current_version();

-- --------------------------------------------------------------------------------------------
-- 3. AppEntitlements (EntitlementMachine). One row per (organization, kind-app application);
--    no row = "available". Core and modules are never entitled.
-- --------------------------------------------------------------------------------------------
create table wos.app_entitlements (
  organization_id   uuid not null references wos.organizations (id),
  app_id            text not null references wos.app_registry (app_id),
  state             text not null check (state in ('enabled', 'disabled', 'suspended')),
  suspended_reason  text,
  changed_at        timestamptz not null default now(),
  changed_by        uuid references wos.accounts (id),          -- null for system actions
  row_version       integer not null default 0,
  primary key (organization_id, app_id),
  check ((state = 'suspended') = (suspended_reason is not null))
);

create or replace function wos.app_entitlements_rules() returns trigger
language plpgsql as $$
declare
  k text;
begin
  select kind into k from wos.app_registry where app_id = new.app_id;
  if k is distinct from 'app' then
    raise exception 'wos: only kind app is entitled (% is %)', new.app_id, k using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' and new.state <> 'enabled' then
    raise exception 'wos: an entitlement starts enabled (available -> enabled)' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.app_id <> old.app_id then
      raise exception 'wos: an entitlement never moves' using errcode = 'check_violation';
    end if;
    if new.state <> old.state and (old.state, new.state) not in (
         ('enabled', 'disabled'), ('disabled', 'enabled'), ('enabled', 'suspended'), ('suspended', 'enabled'), ('suspended', 'disabled')) then
      raise exception 'wos: illegal entitlement transition % -> %', old.state, new.state using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger app_entitlements_rules before insert or update on wos.app_entitlements
  for each row execute function wos.app_entitlements_rules();
create trigger app_entitlements_no_delete before delete or truncate on wos.app_entitlements
  for each statement execute function wos.forbid_mutation();

-- --------------------------------------------------------------------------------------------
-- 4. Targets map to apps (the Sniper List tracks the TARGET, the app is the PRODUCT). No foreign key to
--    the registry: an app is named here before its first release exists.
-- --------------------------------------------------------------------------------------------
create table wos.target_apps (
  target_id  uuid not null references wos.targets (id),
  app_id     text not null check (app_id ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$'),
  primary key (target_id, app_id)
);
insert into wos.target_apps (target_id, app_id)
select t.id, m.app_id from wos.targets t join (values
  ('waronsaas', 'core'), ('waronsaas', 'build'),
  ('salesforce', 'crm'),
  ('hubspot', 'crm'), ('hubspot', 'marketing'), ('hubspot', 'helpdesk'),
  ('slack', 'chat'),
  ('zoom', 'meet'),
  ('shopify', 'commerce'),
  ('quickbooks', 'accounting'),
  ('jira', 'projects'),
  ('zendesk', 'helpdesk'),
  ('docusign', 'esign'),
  ('netsuite', 'erp')
) as m (slug, app_id) on m.slug = t.slug;

-- --------------------------------------------------------------------------------------------
-- 5. Environments the control plane mints tokens for (wOS Cloud only; self-hosted ones never register).
-- --------------------------------------------------------------------------------------------
create table wos.environments (
  id          uuid primary key,
  kind        text not null check (kind = 'cloud'),
  name        text not null,
  api_base    text not null check (api_base ~ '^https://'),
  created_at  timestamptz not null default now()
);
insert into wos.environments (id, kind, name, api_base)
values ('0192f000-0000-7000-8000-00000000c10d', 'cloud', 'wOS Cloud', 'https://core.waronsaas.com');

-- --------------------------------------------------------------------------------------------
-- 6. Seed and backfill: core and build in the registry; a personal organization for every existing
--    account, with Build enabled (everyone who signed up so far did so to contribute, D16).
-- --------------------------------------------------------------------------------------------
insert into wos.app_registry (app_id, name, kind, billing) values
  ('core', 'wOS Core', 'core', 'base'),
  ('build', 'Build', 'app', 'free');

insert into wos.organizations (id, slug, name, kind, personal_account_id)
select gen_random_uuid(), 'u-' || replace(a.id::text, '-', ''), coalesce(a.display_name, a.handle, 'Personal'), 'personal', a.id
  from wos.accounts a
 where not exists (select 1 from wos.organizations o where o.personal_account_id = a.id);
insert into wos.memberships (organization_id, account_id, role)
select o.id, o.personal_account_id, 'owner' from wos.organizations o
 where o.kind = 'personal'
   and not exists (select 1 from wos.memberships m where m.organization_id = o.id);
insert into wos.app_entitlements (organization_id, app_id, state, changed_by)
select o.id, 'build', 'enabled', null from wos.organizations o where o.kind = 'personal';

-- --------------------------------------------------------------------------------------------
-- 7. Grants and RLS.
--    Organizations, memberships and entitlements are private to members. The registry, releases,
--    target -> app mapping and environments are public and written only by privileged actors.
-- --------------------------------------------------------------------------------------------
grant select, insert, update on wos.organizations, wos.memberships, wos.app_entitlements, wos.app_registry, wos.app_releases to wos_app;
grant delete on wos.memberships to wos_app;
grant select, insert on wos.target_apps, wos.environments to wos_app;
grant execute on function wos.org_role(uuid), wos.create_team_organization(text, text) to wos_app;

alter table wos.organizations enable row level security;
alter table wos.memberships enable row level security;
alter table wos.app_registry enable row level security;
alter table wos.app_releases enable row level security;
alter table wos.app_entitlements enable row level security;
alter table wos.target_apps enable row level security;
alter table wos.environments enable row level security;

create policy members_read on wos.organizations for select to wos_app
  using (wos.is_privileged() or wos.org_role(id) is not null);
create policy admins_update on wos.organizations for update to wos_app
  using (wos.is_privileged() or wos.org_role(id) in ('owner', 'admin'))
  with check (wos.is_privileged() or wos.org_role(id) in ('owner', 'admin'));
create policy privileged_insert on wos.organizations for insert to wos_app with check (wos.is_privileged());

create policy members_read on wos.memberships for select to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id() or wos.org_role(organization_id) is not null);
create policy admins_write on wos.memberships for insert to wos_app
  with check (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'));
create policy admins_update on wos.memberships for update to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'))
  with check (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'));
create policy admins_delete on wos.memberships for delete to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin') or account_id = wos.actor_id());

create policy members_read on wos.app_entitlements for select to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) is not null);
create policy admins_write on wos.app_entitlements for insert to wos_app
  with check (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'));
create policy admins_update on wos.app_entitlements for update to wos_app
  using (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'))
  with check (wos.is_privileged() or wos.org_role(organization_id) in ('owner', 'admin'));

do $$
declare
  t text;
begin
  foreach t in array array['app_registry', 'app_releases', 'target_apps', 'environments'] loop
    execute format('create policy public_read on wos.%I for select to wos_app using (true)', t);
    execute format('create policy privileged_insert on wos.%I for insert to wos_app with check (wos.is_privileged())', t);
  end loop;
  foreach t in array array['app_registry', 'app_releases'] loop
    execute format('create policy privileged_update on wos.%I for update to wos_app using (wos.is_privileged()) with check (wos.is_privileged())', t);
  end loop;
end $$;

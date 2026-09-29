-- 0005_surfaces.sql — contracts 4.0.0 (D13: parity is features AND experience, on every surface; D14: one suite). Owner: Lead Architect.

-- --------------------------------------------------------------------------------------------
-- 0. Repository names (founder decisions, 2026-09-29): product repo waronsaas/product; platform repo renamed
--    waronsaas/wos (D14). The product is ONE suite, so targets no longer have a product path (D14).
-- --------------------------------------------------------------------------------------------
update wos.targets set repo_full_name = 'waronsaas/product' where repo_full_name = 'waronsaas/suite';
update wos.targets set repo_full_name = 'waronsaas/wos' where repo_full_name = 'waronsaas/waronsaas';
alter table wos.targets drop column product_path;
update wos.platform_settings set value = '"waronsaas/product"'::jsonb where key = 'product_repo';

-- --------------------------------------------------------------------------------------------
-- 1. Repository registry: ABUs of one build graph may live in several repos of the same family.
-- --------------------------------------------------------------------------------------------
create table wos.repositories (
  repo_full_name  text primary key check (repo_full_name ~ '^waronsaas/[A-Za-z0-9._-]+$'),
  family          text not null check (family in ('platform', 'product')),
  default_branch  text not null default 'main',
  created_at      timestamptz not null default now()
);
insert into wos.repositories (repo_full_name, family) values
  ('waronsaas/wos', 'platform'),
  ('waronsaas/product', 'product');

create or replace function wos.check_repo_consistency() returns trigger
language plpgsql as $$
declare
  expected text;
begin
  if tg_table_name = 'documents' then
    if new.kind = 'roadmap' then
      select repo_full_name into expected from wos.targets where id = new.target_id;
    else
      select repo_full_name into expected from wos.catalog_features where id = new.catalog_feature_id;
    end if;
  elsif tg_table_name = 'abus' then
    -- D13: an ABU may live in any repository of the same family as its contract document.
    select d.repo_full_name into expected from wos.documents d where d.id = new.document_id;
    if expected is not null and not exists (
      select 1 from wos.repositories a join wos.repositories b on a.family = b.family
       where a.repo_full_name = expected and b.repo_full_name = new.repo_full_name
    ) then
      raise exception 'wos: abus row is in repo % but its parent is in % (a different repository family)', new.repo_full_name, expected
        using errcode = 'check_violation';
    end if;
    return new;
  elsif tg_table_name = 'catalog_features' then
    select repo_full_name into expected from wos.documents where id = new.created_by_document_id;
  end if;
  if expected is not null and expected <> new.repo_full_name then
    raise exception 'wos: % row is in repo % but its parent is in %', tg_table_name, new.repo_full_name, expected
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- --------------------------------------------------------------------------------------------
-- 2. Surfaces: per app (roadmap), per app feature (reasoned weights + journeys), per requirement.
--    Values mirror packages/contracts/src/primitives.ts Surface.
-- --------------------------------------------------------------------------------------------
create table wos.target_surfaces (
  target_id        uuid not null references wos.targets (id),
  surface          text not null check (surface in ('web', 'ios', 'android', 'desktop', 'cli', 'browser_extension', 'email_addin', 'other')),
  status           text not null check (status in ('in_scope', 'excluded')),
  reason           text,
  repo_full_name   text references wos.repositories (repo_full_name),
  path             text,
  roadmap_version  integer not null check (roadmap_version > 0),
  primary key (target_id, surface),
  check ((status = 'excluded') = (reason is not null)),
  check ((status = 'in_scope') = (repo_full_name is not null and path is not null))
);

create table wos.app_feature_surfaces (
  app_feature_id    uuid not null references wos.app_features (id),
  surface           text not null check (surface in ('web', 'ios', 'android', 'desktop', 'cli', 'browser_extension', 'email_addin', 'other')),
  weight_bp         integer not null check (weight_bp between 1 and 10000),   -- D12 applied to D13, frozen per version
  weight_rationale  text not null check (length(btrim(weight_rationale)) >= 40),
  roadmap_version   integer not null check (roadmap_version > 0),
  primary key (app_feature_id, surface)
);

alter table wos.app_features add column journeys jsonb not null default '[]';   -- Journey[] from the roadmap ref

create table wos.requirement_surfaces (
  requirement_id  uuid not null references wos.requirements (id),
  surface         text not null check (surface in ('web', 'ios', 'android', 'desktop', 'cli', 'browser_extension', 'email_addin', 'other')),
  primary key (requirement_id, surface)
);

-- Per-surface acceptance results (check wos-acceptance/<feature>/<target>/<surface>).
alter table wos.verification_runs add column surface text
  check (surface in ('web', 'ios', 'android', 'desktop', 'cli', 'browser_extension', 'email_addin', 'other'));
alter table wos.verification_runs add constraint verification_runs_profile_surface
  check (subject <> 'profile_acceptance' or surface is not null);
drop index wos.verification_runs_profile;
create index verification_runs_profile on wos.verification_runs (catalog_feature_id, profile_target_id, surface, created_at desc)
  where subject = 'profile_acceptance';

-- --------------------------------------------------------------------------------------------
-- 3. Toolchain attestations (path-based toolchain eligibility, e.g. macOS + Xcode for native iOS ABUs).
-- --------------------------------------------------------------------------------------------
create table wos.toolchain_attestations (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references wos.accounts (id),
  device_id   uuid not null references wos.devices (id),
  os          text not null check (os in ('macos', 'linux', 'windows')),
  os_version  text not null,
  tools       jsonb not null default '[]',    -- [{name, version}] e.g. xcode, android-sdk, node
  checked_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index toolchain_attestations_latest on wos.toolchain_attestations (account_id, device_id, created_at desc);
create trigger toolchain_attestations_append_only before update or delete on wos.toolchain_attestations
  for each row execute function wos.forbid_mutation();
create trigger toolchain_attestations_no_truncate before truncate on wos.toolchain_attestations
  for each statement execute function wos.forbid_mutation();

-- --------------------------------------------------------------------------------------------
-- 4. Grants and RLS for the new tables.
-- --------------------------------------------------------------------------------------------
grant select, insert, update on wos.repositories, wos.target_surfaces, wos.app_feature_surfaces, wos.requirement_surfaces to wos_app;
grant delete on wos.target_surfaces, wos.app_feature_surfaces to wos_app;   -- replaced when a new roadmap version merges
grant select, insert on wos.toolchain_attestations to wos_app;
alter table wos.repositories enable row level security;
alter table wos.target_surfaces enable row level security;
alter table wos.app_feature_surfaces enable row level security;
alter table wos.requirement_surfaces enable row level security;
alter table wos.toolchain_attestations enable row level security;
create policy app_all on wos.repositories for all to wos_app using (true) with check (true);
create policy app_all on wos.target_surfaces for all to wos_app using (true) with check (true);
create policy app_all on wos.app_feature_surfaces for all to wos_app using (true) with check (true);
create policy app_all on wos.requirement_surfaces for all to wos_app using (true) with check (true);
create policy own_or_privileged on wos.toolchain_attestations for all to wos_app
  using (wos.is_privileged() or account_id = wos.actor_id())
  with check (wos.is_privileged() or account_id = wos.actor_id());

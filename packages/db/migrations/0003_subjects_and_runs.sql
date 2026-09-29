-- 0003_subjects_and_runs.sql — contracts 3.0.0 (Wave 1 gate, control-plane findings). Owner: Lead Architect.

-- --------------------------------------------------------------------------------------------
-- 1. Every document, catalog feature and ABU knows its repository (TGT-00 lives in the platform repo).
--    Catalogs are per repository: a roadmap may reference only catalog features of its own repo.
-- --------------------------------------------------------------------------------------------
alter table wos.catalog_features add column repo_full_name text not null
  check (repo_full_name ~ '^waronsaas/[A-Za-z0-9._-]+$');
alter table wos.documents add column repo_full_name text not null
  check (repo_full_name ~ '^waronsaas/[A-Za-z0-9._-]+$');
alter table wos.abus add column repo_full_name text not null
  check (repo_full_name ~ '^waronsaas/[A-Za-z0-9._-]+$');
create index abus_repo_state on wos.abus (repo_full_name, state);

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
    select repo_full_name into expected from wos.documents where id = new.document_id;
  elsif tg_table_name = 'catalog_features' then
    select repo_full_name into expected from wos.documents where id = new.created_by_document_id;
  end if;
  if expected is not null and expected <> new.repo_full_name then
    raise exception 'wos: % row is in repo % but its parent is in %', tg_table_name, new.repo_full_name, expected
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger documents_repo before insert or update of repo_full_name on wos.documents
  for each row execute function wos.check_repo_consistency();
create trigger abus_repo before insert or update of repo_full_name on wos.abus
  for each row execute function wos.check_repo_consistency();
create trigger catalog_features_repo before insert or update of repo_full_name on wos.catalog_features
  for each row execute function wos.check_repo_consistency();

-- --------------------------------------------------------------------------------------------
-- 2. A review is bound to the agent run that produced it (same lease, same manifest, valid signature).
-- --------------------------------------------------------------------------------------------
alter table wos.reviews add column agent_run_id uuid not null unique references wos.agent_runs (id);

create or replace function wos.check_review_agent_run() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from wos.agent_runs ar
     where ar.id = new.agent_run_id and ar.lease_id = new.lease_id and ar.manifest_id = new.manifest_id
       and ar.account_id = new.account_id and ar.signature_valid
  ) then
    raise exception 'wos: agent run % is not a valid signed run of lease % with manifest %', new.agent_run_id, new.lease_id, new.manifest_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger reviews_agent_run before insert on wos.reviews
  for each row execute function wos.check_review_agent_run();

-- --------------------------------------------------------------------------------------------
-- 3. Optimistic concurrency on inventory versions; lookup of profile acceptance results.
-- --------------------------------------------------------------------------------------------
alter table wos.inventory_versions add column row_version integer not null default 0;
create index verification_runs_profile on wos.verification_runs (catalog_feature_id, profile_target_id, created_at desc)
  where subject = 'profile_acceptance';

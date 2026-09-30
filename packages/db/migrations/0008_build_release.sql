-- 0008_build_release.sql — contracts 5.6.0 (B-0007-control-plane). Owner: Lead Architect.
--
-- Two gaps between 0006 and the AppRoutes contract (5.2.0):
--  1. Build is bundled in the Desktop binary (D16, S-40): its release lists the desktop surface and has NO
--     package. 0006 refused that for every app. Now it is allowed for `build` only; every other app still needs a
--     signed package exactly when it lists desktop.
--  2. The registry publishes sha256Of(the downloaded ModuleBundle bytes). It is written once at publish, in
--     `desktop_bundle_sha256`, immutable like the rest of the release.
--
-- Numbered 0008 so it cannot collide with ws/protocol's 0007_proof_of_contribution.sql. The two touch disjoint
-- objects (this one only wos.app_releases), so they commute: production may apply 0008 before 0007 exists.
-- Relaxes one check and adds one nullable column; no existing row is changed (production has no releases).

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'wos.app_releases'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%desktop%= ANY%surfaces%desktop_package IS NOT NULL%';
  if c is null then
    raise exception 'wos 0008: the 0006 desktop-package check of wos.app_releases was not found';
  end if;
  execute format('alter table wos.app_releases drop constraint %I', c);
end $$;

alter table wos.app_releases
  add column desktop_bundle_sha256 text check (desktop_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  add constraint app_releases_desktop_package check (
    (('desktop' = any (surfaces)) = (desktop_package is not null))
    or (app_id = 'build' and 'desktop' = any (surfaces) and desktop_package is null and desktop_package_url is null)
  ),
  add constraint app_releases_desktop_bundle_sha256 check ((desktop_package is null) = (desktop_bundle_sha256 is null));

-- Immutability now covers the bundle hash too (same function as 0006, one more column).
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
      new.desktop_bundle_sha256, new.source_repo, new.source_tag, new.source_commit, new.published_at)
     is distinct from
     (old.app_id, old.version, old.manifest, old.manifest_sha256, old.surfaces, old.desktop_package, old.desktop_package_url,
      old.desktop_bundle_sha256, old.source_repo, old.source_tag, old.source_commit, old.published_at) then
    raise exception 'wos: a published release is immutable' using errcode = 'insufficient_privilege';
  end if;
  if not (old.state = 'published' and new.state = 'yanked') and new.state is distinct from old.state then
    raise exception 'wos: illegal release transition % -> %', old.state, new.state using errcode = 'check_violation';
  end if;
  return new;
end $$;

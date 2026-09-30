-- 0009_web_app_client.sql — contracts 5.7.0 (B-0009-control-plane, completing the 5.6.0 rulings). Owner: Lead Architect.
--
-- Two follow-ups to contracts 5.6.0 that the database must carry:
--  1. B-0002-suite-shell / S-43: `startEmailSignIn.clientKind` gained `web_app` (wOS Web's server), but 0001 limits
--     wos.email_signin_requests.client_kind and wos.sessions.client_kind to web/desktop/cli, so a web_app sign-in
--     could not be stored. Both now accept `web_app`. wos.devices is unchanged: web_app registers no device key.
--  2. B-0007-control-plane: the control plane now writes desktop_bundle_sha256 at every desktop publish, so the
--     0008 check "a hash only with a package" becomes "a hash exactly with a package", as the blocker asked.
--     Adding the check validates existing rows: if any release has a package and no hash, this migration fails in
--     its transaction and changes nothing (production had no app releases when 0008 was written).
--
-- Touches wos.email_signin_requests, wos.sessions and wos.app_releases only. Commutes with ws/protocol's 0007.

do $$
declare
  t text;
  c text;
begin
  foreach t in array array['email_signin_requests', 'sessions'] loop
    select conname into c from pg_constraint
     where conrelid = format('wos.%I', t)::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%client_kind%' and pg_get_constraintdef(oid) like '%''cli''%';
    if c is null then
      raise exception 'wos 0009: the 0001 client_kind check of wos.% was not found', t;
    end if;
    execute format('alter table wos.%I drop constraint %I', t, c);
    execute format(
      'alter table wos.%I add constraint %I check (client_kind in (''web'', ''desktop'', ''cli'', ''web_app''))',
      t, t || '_client_kind');
  end loop;
end $$;

alter table wos.app_releases drop constraint app_releases_desktop_bundle_sha256;
alter table wos.app_releases
  add constraint app_releases_desktop_bundle_sha256 check ((desktop_package is null) = (desktop_bundle_sha256 is null));

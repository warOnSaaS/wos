-- 0011_mobile_client.sql — contracts 5.11.0 (B-0001-mobile-runtime). Owner: Lead Architect.
-- PRODUCTION MIGRATION: the coordinator applies it to production through the runner (list with --check first).
--
-- `startEmailSignIn.clientKind` gained `mobile` (wOS Mobile on a phone: pollSecret and tokens in response bodies,
-- no device key, the user types the emailed code in the app). 0009 limits wos.email_signin_requests.client_kind and
-- wos.sessions.client_kind to web/desktop/cli/web_app, so a mobile sign-in could not be stored. Both now accept
-- `mobile`. wos.devices is unchanged: a phone registers no device key.
--
-- Touches only the two client_kind checks 0009 created (by name). Commutes with the draft 0007 and 0010.

alter table wos.email_signin_requests drop constraint email_signin_requests_client_kind;
alter table wos.email_signin_requests
  add constraint email_signin_requests_client_kind check (client_kind in ('web', 'desktop', 'cli', 'web_app', 'mobile'));
alter table wos.sessions drop constraint sessions_client_kind;
alter table wos.sessions
  add constraint sessions_client_kind check (client_kind in ('web', 'desktop', 'cli', 'web_app', 'mobile'));

-- Behavioural assertions for 0001_init.sql. Run by scripts/test-migrations.sh (superuser session,
-- then SET ROLE wos_app for the RLS/grant checks). Every block raises on failure.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

-- On Supabase the migrating role is not a superuser: it needs membership to SET ROLE in this test.
-- (Written as a DO block: a literal `grant ... to current_user` segfaults supautils in supabase/postgres 17.4.1.048.)
do $$ begin execute format('grant wos_app to %I', current_user); end $$;
create schema wos_test;
create or replace function wos_test.expect_error(stmt text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok (rejected): %', label;
    return;
  end;
  raise exception 'EXPECTED FAILURE did not happen: %', label;
end $$;

-- fixtures -----------------------------------------------------------------------------------
insert into wos.accounts (id, handle, github_user_id, github_login, github_created_at, github_linked_at)
values ('00000000-0000-0000-0000-00000000000a', 'alice', 1001, 'alice', now() - interval '400 days', now()),
       ('00000000-0000-0000-0000-00000000000b', 'bob',   1002, 'bob',   now() - interval '400 days', now()),
       ('00000000-0000-0000-0000-00000000000c', 'carol', 1003, 'carol', now() - interval '400 days', now());
insert into wos.account_emails (account_id, email, email_normalized, verified_at) values
  ('00000000-0000-0000-0000-00000000000a', 'Alice@example.com', 'alice@example.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', 'bob@example.com', now());
insert into wos.devices (id, account_id, name, client_kind, public_key) values
  ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-00000000000a', 'mac', 'cli', 'pkA'),
  ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-00000000000b', 'mac', 'cli', 'pkB'),
  ('00000000-0000-0000-0000-0000000000dc', '00000000-0000-0000-0000-00000000000c', 'mac', 'cli', 'pkC');

select wos_test.expect_error($$insert into wos.account_emails (account_id, email, email_normalized, verified_at)
  values ('00000000-0000-0000-0000-00000000000c', 'ALICE@example.com', 'alice@example.com', now())$$, 'duplicate normalized email');
select wos_test.expect_error($$update wos.accounts set github_login = null where handle = 'alice'$$, 'github link must be all-or-nothing');

-- seeds: ten targets, 0 progress --------------------------------------------------------------
do $$ begin
  if (select count(*) from wos.targets) <> 11 then raise exception 'expected 11 seeded targets (TGT-00 + 10)'; end if;
  if exists (select 1 from wos.v_target_progress where mapped_bp <> 0 or specified_bp <> 0 or built_bp <> 0) then
    raise exception 'seeded progress must be 0';
  end if;
end $$;

-- one canonical open roadmap per target -------------------------------------------------------
insert into wos.documents (id, kind, target_id, version, state, branch)
select '00000000-0000-0000-0000-0000000000d1', 'roadmap', id, 1, 'drafting', 'wos/roadmap/salesforce/v1' from wos.targets where slug = 'salesforce';
select wos_test.expect_error($$insert into wos.documents (kind, target_id, version, state, branch)
  select 'roadmap', id, 2, 'drafting', 'x' from wos.targets where slug = 'salesforce'$$, 'second open roadmap for same target');

-- rounds, tasks, leases -----------------------------------------------------------------------
insert into wos.rounds (id, subject_kind, document_id, round_number, head_sha, submission_sha256, state)
values ('00000000-0000-0000-0000-0000000000e1', 'roadmap', '00000000-0000-0000-0000-0000000000d1', 1,
        repeat('a', 40), 'sha256:' || repeat('1', 64), 'awaiting_reviews');
insert into wos.tasks (id, kind, state, role, reviewer_slot, target_id, document_id, round_id)
select '00000000-0000-0000-0000-0000000000f1', 'roadmap_review', 'leased', 'roadmap_reviewer_fable', 'fable', id,
       '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1' from wos.targets where slug = 'salesforce';
select wos_test.expect_error($$insert into wos.tasks (kind, state, role, reviewer_slot, target_id, document_id, round_id)
  select 'roadmap_review', 'open', 'roadmap_reviewer_fable', 'fable', id, '00000000-0000-0000-0000-0000000000d1',
         '00000000-0000-0000-0000-0000000000e1' from wos.targets where slug = 'salesforce'$$, 'second live review task for same slot');

insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000b',
        '00000000-0000-0000-0000-0000000000db', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours');
select wos_test.expect_error($$insert into wos.leases (task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000dc',
          'active', '{}', now() + interval '30 minutes', now() + interval '3 hours')$$, 'second active lease on one task');

insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-00000000000b', 'roadmap_reviewer_fable', 'claude-fable-5-1', 'max', 'ctx-1', '{}', 'sha256:' || repeat('2', 64));

-- reviews bind to the round's head + submission hash --------------------------------------------
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-00000000000b', 1002, 'fable', 'claude_cli', 'claude-fable-5-1', 'max',
          repeat('b', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a1', 'independent')$$,
  'review bound to a different head sha');

insert into wos.reviews (id, round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b', 1002, 'fable', 'claude_cli', 'claude-fable-5-1', 'max',
        repeat('a', 40), 'sha256:' || repeat('1', 64), 'MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a1', 'independent');
select wos_test.expect_error($$update wos.reviews set verdict = 'NO_MATERIAL_GAPS'$$, 'reviews are append-only');

-- RLS: sealed review invisible to others until revealed ---------------------------------------
grant usage on schema wos_test to wos_app;
grant execute on all functions in schema wos_test to wos_app;
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false), set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from wos.reviews) <> 0 then raise exception 'sealed review leaked to another account'; end if;
  if (select count(*) from wos.account_emails) <> 1 then raise exception 'account_emails must show only own row'; end if;
end $$;
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select count(*) from wos.reviews) <> 1 then raise exception 'reviewer must see own sealed review'; end if;
end $$;
-- app role cannot update append-only tables even without the trigger
select wos_test.expect_error($$update wos.events set type = 'x.y'$$, 'app role UPDATE on events');
select wos_test.expect_error($$delete from wos.ledger_entries$$, 'app role DELETE on ledger');
reset role;
select set_config('wos.actor_kind', 'system', false), set_config('wos.actor_id', '', false);
update wos.rounds set state = 'revealed', outcome = 'gaps', independence = 'independent', revealed_at = now()
 where id = '00000000-0000-0000-0000-0000000000e1';
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false), set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from wos.reviews) <> 1 then raise exception 'revealed review must be visible'; end if;
end $$;
reset role;
select set_config('wos.actor_kind', 'system', false);

-- ledger: sign rules, hash chain, append-only, derived balances --------------------------------
insert into wos.contributions (id, account_id, github_user_id, category, state, independence, idempotency_key, accepted_at)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000000a', 1001, 'implementation', 'accepted', 'independent', 'c1', now());
insert into wos.ledger_entries (id, account_id, kind, bucket, amount, category, contribution_id, idempotency_key, schedule_version, memo, release_after, created_by_kind)
values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000000a', 'award', 'held', 60, 'implementation',
        '00000000-0000-0000-0000-000000000c01', 'award:c1', 'rewards.v1', 'ABU crm.contacts#01', now() + interval '14 days', 'system');
insert into wos.ledger_entries (account_id, kind, bucket, amount, related_entry_id, pair_id, idempotency_key, schedule_version, memo, created_by_kind) values
  ('00000000-0000-0000-0000-00000000000a', 'release', 'held', -60, '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000fa11', 'release:c1:h', 'rewards.v1', 'release', 'system'),
  ('00000000-0000-0000-0000-00000000000a', 'release', 'available', 60, '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000fa11', 'release:c1:a', 'rewards.v1', 'release', 'system');
insert into wos.ledger_entries (account_id, kind, bucket, amount, idempotency_key, schedule_version, memo, created_by_kind)
values ('00000000-0000-0000-0000-00000000000a', 'debit', 'available', -10, 'debit:1', 'rewards.v1', 'future spending', 'system');
select wos_test.expect_error($$insert into wos.ledger_entries (account_id, kind, bucket, amount, category, idempotency_key, schedule_version, memo, release_after, created_by_kind)
  values ('00000000-0000-0000-0000-00000000000a', 'award', 'held', -5, 'review', 'bad', 'rewards.v1', 'neg award', now(), 'system')$$, 'negative award');
select wos_test.expect_error($$insert into wos.ledger_entries (account_id, kind, bucket, amount, idempotency_key, schedule_version, memo, created_by_kind)
  values ('00000000-0000-0000-0000-00000000000a', 'adjustment', 'available', 5, 'adj', 'rewards.v1', 'system adjustment', 'system')$$, 'adjustment by non-maintainer');
select wos_test.expect_error($$insert into wos.ledger_entries (account_id, kind, bucket, amount, category, idempotency_key, schedule_version, memo, release_after, created_by_kind)
  values ('00000000-0000-0000-0000-00000000000a', 'award', 'held', 5, 'review', 'award:c1', 'rewards.v1', 'dupe', now(), 'system')$$, 'duplicate idempotency key');
select wos_test.expect_error($$update wos.ledger_entries set amount = 1000 where entry_no = 1$$, 'ledger UPDATE (owner)');
select wos_test.expect_error($$delete from wos.ledger_entries$$, 'ledger DELETE (owner)');
select wos_test.expect_error($$truncate wos.ledger_entries cascade$$, 'ledger TRUNCATE (owner)');
do $$
declare b record; prev bytea := '\x00'; r record;
begin
  select * into b from wos.v_balances where account_id = '00000000-0000-0000-0000-00000000000a';
  if b.held <> 0 or b.available <> 50 or b.score <> 60 then
    raise exception 'balances wrong: held % available % score %', b.held, b.available, b.score;
  end if;
  for r in select * from wos.ledger_entries order by entry_no loop
    if r.prev_hash <> prev then raise exception 'hash chain broken at %', r.entry_no; end if;
    prev := r.entry_hash;
  end loop;
  if (select max(entry_no) from wos.ledger_entries) <> 4 then raise exception 'entry_no must be gapless'; end if;
end $$;

-- progress snapshots enforce built <= specified <= mapped ------------------------------------
select wos_test.expect_error($$insert into wos.progress_snapshots (target_id, scope, mapped_bp, specified_bp, built_bp, input_sha256, detail)
  select id, 'app', 100, 200, 0, 'sha256:' || repeat('3', 64), '{}' from wos.targets where slug = 'slack'$$, 'specified > mapped');
insert into wos.progress_snapshots (target_id, scope, mapped_bp, specified_bp, built_bp, input_sha256, detail)
  select id, 'app', 0, 0, 0, 'sha256:' || repeat('3', 64), '{}' from wos.targets where slug = 'slack';

-- D12: capability weights need a real rationale ---------------------------------------------
select wos_test.expect_error($$insert into wos.capabilities (target_id, key, title, summary, position, weight_bp, weight_rationale, mapped, roadmap_version)
  select id, 'crm', 'CRM', 'x', 1, 5000, 'because', true, 1 from wos.targets where slug = 'salesforce'$$, 'weight without rationale');

-- migration ledger is append-only --------------------------------------------------------------
insert into wos_meta.schema_migrations (version, name, checksum, execution_ms) values ('0001', 'init', 'sha256:' || repeat('0', 64), 1);
select wos_test.expect_error($$delete from wos_meta.schema_migrations$$, 'migration ledger DELETE');

\echo 'all db assertions passed'

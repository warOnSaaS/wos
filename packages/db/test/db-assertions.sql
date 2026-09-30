-- Behavioural assertions for 0001_init.sql. Run by scripts/test-migrations.sh (superuser session,
-- then SET ROLE wos_app for the RLS/grant checks). Every block raises on failure.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

-- On Supabase the migrating role is not a superuser: it needs membership to SET ROLE in this test.
-- (Written as a DO block: a literal `grant ... to current_user` segfaults supautils in supabase/postgres 17.4.1.048.)
do $$ begin execute format('grant wos_app to %I', current_user); end $$;
create schema wos_test;
create or replace function wos_test.expect_error(stmt text, label text, pattern text default null) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if pattern is not null and sqlerrm !~ pattern then
      raise exception 'REJECTED FOR THE WRONG REASON: % (got: %)', label, sqlerrm;
    end if;
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
  ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-00000000000a', 'mac', 'cli', repeat('A', 42) || 'A='),
  ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-00000000000b', 'mac', 'cli', repeat('A', 42) || 'E='),
  ('00000000-0000-0000-0000-0000000000dc', '00000000-0000-0000-0000-00000000000c', 'mac', 'cli', repeat('A', 42) || 'I=');
select wos_test.expect_error($$insert into wos.devices (account_id, name, client_kind, public_key)
  values ('00000000-0000-0000-0000-00000000000c', 'pem', 'cli', '-----BEGIN PUBLIC KEY-----')$$, 'device key not raw base64 Ed25519');

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
insert into wos.documents (id, kind, target_id, version, state, branch, repo_full_name)
select '00000000-0000-0000-0000-0000000000d1', 'roadmap', id, 1, 'drafting', 'wos/roadmap/salesforce/v1', 'waronsaas/product' from wos.targets where slug = 'salesforce';
select wos_test.expect_error($$insert into wos.documents (kind, target_id, version, state, branch, repo_full_name)
  select 'roadmap', id, 1, 'drafting', 'x', 'waronsaas/product' from wos.targets where slug = 'waronsaas'$$, 'TGT-00 roadmap outside the platform repo', 'parent is in');
select wos_test.expect_error($$insert into wos.documents (kind, target_id, version, state, branch, repo_full_name)
  select 'roadmap', id, 2, 'drafting', 'x', 'waronsaas/product' from wos.targets where slug = 'salesforce'$$, 'second open roadmap for same target');

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
insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid)
values ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', '{}', true);

-- reviews bind to the round's head + submission hash --------------------------------------------
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-00000000000b', 1002, 'fable', 'claude_cli', 'claude-fable-5-1', 'max',
          repeat('b', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a1', 'independent', '00000000-0000-0000-0000-00000000e0a1')$$,
  'review bound to a different head sha');

insert into wos.reviews (id, round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000b', 1002, 'fable', 'claude_cli', 'claude-fable-5-1', 'max',
        repeat('a', 40), 'sha256:' || repeat('1', 64), 'MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a1', 'independent', '00000000-0000-0000-0000-00000000e0a1');
select wos_test.expect_error($$update wos.reviews set verdict = 'NO_MATERIAL_GAPS'$$, 'reviews are append-only');

-- distinct reviewers per round: bob cannot also take the astra slot (independent review) --------
insert into wos.tasks (id, kind, state, role, reviewer_slot, target_id, document_id, round_id)
select '00000000-0000-0000-0000-0000000000f2', 'roadmap_review', 'leased', 'roadmap_reviewer_astra', 'astra', id,
       '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1' from wos.targets where slug = 'salesforce';
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000b',
        '00000000-0000-0000-0000-0000000000db', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours');
insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f2',
        '00000000-0000-0000-0000-00000000000b', 'roadmap_reviewer_astra', 'gpt-6-astra', 'max', 'ctx-1', '{}', 'sha256:' || repeat('4', 64));
insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid)
values ('00000000-0000-0000-0000-00000000e0a2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', '{}', true);
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2',
          '00000000-0000-0000-0000-00000000000b', 1002, 'astra', 'codex_cli', 'gpt-6-astra', 'max',
          repeat('a', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a2', 'independent', '00000000-0000-0000-0000-00000000e0a2')$$,
  'same account in both slots of a round', 'distinct reviewers');

-- a review must cite a signed run of its own lease and manifest (0003)
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2',
          '00000000-0000-0000-0000-00000000000b', 1002, 'astra', 'codex_cli', 'gpt-6-astra', 'max',
          repeat('a', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a2', 'independent', '00000000-0000-0000-0000-00000000e0a1')$$,
  'review citing another lease''s agent run', 'agent run');

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

-- ============================================================================================
-- 0002_backstops (B-0003-verification)
-- ============================================================================================
select set_config('wos.actor_kind', 'system', false), set_config('wos.actor_id', '', false);

-- private events: hidden from other contributors, visible to the account concerned
insert into wos.events (type, visibility, aggregate_kind, aggregate_id, actor_account_id, actor_kind, payload, contracts_version)
values ('account.github_unlinked', 'private', 'account', '00000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-00000000000a', 'contributor', '{"accountId":"00000000-0000-0000-0000-00000000000a"}', '2.0.0');
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false), set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  if (select count(*) from wos.events where visibility = 'private') <> 0 then raise exception 'private event leaked to another contributor'; end if;
end $$;
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from wos.events where visibility = 'private') <> 1 then raise exception 'own private event must be visible'; end if;
end $$;
reset role;
select set_config('wos.actor_kind', 'system', false), set_config('wos.actor_id', '', false);

-- a second open round on the same document, same public head and diff hash
insert into wos.rounds (id, subject_kind, document_id, round_number, head_sha, submission_sha256, state)
values ('00000000-0000-0000-0000-0000000000e2', 'roadmap', '00000000-0000-0000-0000-0000000000d1', 2,
        repeat('a', 40), 'sha256:' || repeat('1', 64), 'awaiting_reviews');
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-00000000000b', 1002, 'fable', 'claude_cli', 'claude-fable-5-1', 'max',
          repeat('a', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a1', 'independent', '00000000-0000-0000-0000-00000000e0a1')$$,
  'lease for round 1 posting into round 2 (same head and hash)', 'is not the fable review task');

insert into wos.tasks (id, kind, state, role, reviewer_slot, target_id, document_id, round_id)
select '00000000-0000-0000-0000-0000000000f3', 'roadmap_review', 'leased', 'roadmap_reviewer_astra', 'astra', id,
       '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2' from wos.targets where slug = 'salesforce';
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000c',
        '00000000-0000-0000-0000-0000000000dc', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours');
insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f3',
        '00000000-0000-0000-0000-00000000000c', 'roadmap_reviewer_astra', 'gpt-6-astra', 'max', 'ctx-1', '{}', 'sha256:' || repeat('5', 64));
insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid)
values ('00000000-0000-0000-0000-00000000e0a3', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000dc', '{}', true);
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c3',
          '00000000-0000-0000-0000-00000000000c', 1003, 'fable', 'claude_cli', 'claude-fable-5-1', 'max',
          repeat('a', 40), 'sha256:' || repeat('1', 64), 'MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a3', 'independent', '00000000-0000-0000-0000-00000000e0a3')$$,
  'review slot differs from its task slot', 'is not the fable review task');
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c3',
          '00000000-0000-0000-0000-00000000000c', 1003, 'astra', 'codex_cli', 'gpt-6-astra', 'max',
          repeat('a', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a3', 'bootstrap_self', '00000000-0000-0000-0000-00000000e0a3')$$,
  'bootstrap_self by a non-maintainer', 'non-maintainer');
insert into wos.account_roles (account_id, role) values ('00000000-0000-0000-0000-00000000000c', 'maintainer');
insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c3',
        '00000000-0000-0000-0000-00000000000c', 1003, 'astra', 'codex_cli', 'gpt-6-astra', 'max',
        repeat('a', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a3', 'bootstrap_maintainer', '00000000-0000-0000-0000-00000000e0a3');

-- bootstrap mode is one-way, and bootstrap labels stop working once it is off
update wos.platform_settings set value = '{"enabled": false, "since": null}' where key = 'bootstrap_mode';
select wos_test.expect_error($$update wos.platform_settings set value = '{"enabled": true, "since": null}' where key = 'bootstrap_mode'$$,
  'bootstrap re-entered after it ended', 're-entered');
select wos_test.expect_error($$delete from wos.platform_settings where key = 'bootstrap_mode'$$, 'deleting the bootstrap flag');
insert into wos.tasks (id, kind, state, role, reviewer_slot, target_id, document_id, round_id)
select '00000000-0000-0000-0000-0000000000f4', 'roadmap_review', 'leased', 'roadmap_reviewer_fable', 'fable', id,
       '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2' from wos.targets where slug = 'salesforce';
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
values ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000000c',
        '00000000-0000-0000-0000-0000000000dc', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours');
insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000f4',
        '00000000-0000-0000-0000-00000000000c', 'roadmap_reviewer_fable', 'claude-fable-5-1', 'max', 'ctx-1', '{}', 'sha256:' || repeat('6', 64));
insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid)
values ('00000000-0000-0000-0000-00000000e0a4', '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000dc', '{}', true);
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000c4',
          '00000000-0000-0000-0000-00000000000c', 1003, 'fable', 'claude_cli', 'claude-fable-5-1', 'max',
          repeat('a', 40), 'sha256:' || repeat('1', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0000-0000000000a4', 'bootstrap_self', '00000000-0000-0000-0000-00000000e0a4')$$,
  'bootstrap_self after bootstrap ended', 'outside bootstrap mode');

-- ---- 0006 one product (Amendment 01, contracts 5.0.0) ---------------------------------------------
reset role;
do $$ begin
  if (select count(*) from wos.organizations o join wos.memberships m on m.organization_id = o.id and m.role = 'owner'
       where o.kind = 'personal' and o.personal_account_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')) <> 2 then
    raise exception 'every new account gets a personal organization with itself as owner';
  end if;
  if exists (select 1 from wos.app_entitlements e join wos.organizations o on o.id = e.organization_id
              where o.personal_account_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'Build is off by default for new accounts (D16)';
  end if;
  raise notice 'ok: personal organizations, Build off by default';
end $$;
select wos_test.expect_error($$insert into wos.memberships (organization_id, account_id, role)
  select id, '00000000-0000-0000-0000-00000000000b', 'member' from wos.organizations where personal_account_id = '00000000-0000-0000-0000-00000000000a'$$,
  'a second member in a personal organization', 'personal');
select wos_test.expect_error($$delete from wos.memberships where account_id = '00000000-0000-0000-0000-00000000000a'
  and organization_id = (select id from wos.organizations where personal_account_id = '00000000-0000-0000-0000-00000000000a')$$,
  'removing the owner of a personal organization', 'personal');

-- registry: core and modules are never entitled; entitlement transitions follow EntitlementMachine
insert into wos.app_registry (app_id, name, kind, billing) values ('crm', 'wOS CRM', 'app', 'addon'), ('contacts', 'Contacts', 'module', 'free');
select wos_test.expect_error($$insert into wos.app_registry (app_id, name, kind, billing) values ('shop', 'x', 'module', 'addon')$$, 'a priced module');
select wos_test.expect_error($$insert into wos.app_entitlements (organization_id, app_id, state)
  select id, 'core', 'enabled' from wos.organizations where personal_account_id = '00000000-0000-0000-0000-00000000000a'$$, 'entitling core', 'only kind app');
select wos_test.expect_error($$insert into wos.app_entitlements (organization_id, app_id, state)
  select id, 'contacts', 'enabled' from wos.organizations where personal_account_id = '00000000-0000-0000-0000-00000000000a'$$, 'entitling a module', 'only kind app');
insert into wos.app_entitlements (organization_id, app_id, state)
select id, 'crm', 'enabled' from wos.organizations where personal_account_id = '00000000-0000-0000-0000-00000000000a';
update wos.app_entitlements set state = 'disabled' where app_id = 'crm';
select wos_test.expect_error($$update wos.app_entitlements set state = 'suspended', suspended_reason = 'x' where app_id = 'crm'$$,
  'disabled -> suspended', 'illegal entitlement transition');
select wos_test.expect_error($$delete from wos.app_entitlements where app_id = 'crm'$$, 'deleting an entitlement');

-- releases: immutable, monotonic, one-way yank; current_version follows
insert into wos.app_releases (app_id, version, manifest, manifest_sha256, surfaces, source_repo, source_tag, source_commit)
values ('crm', '0.2.0', '{}', 'sha256:' || repeat('a', 64), array['web', 'api'], 'waronsaas/product', 'crm@0.2.0', repeat('b', 40));
select wos_test.expect_error($$insert into wos.app_releases (app_id, version, manifest, manifest_sha256, surfaces, source_repo, source_tag, source_commit)
  values ('crm', '0.1.9', '{}', 'sha256:' || repeat('a', 64), array['web'], 'waronsaas/product', 'crm@0.1.9', repeat('b', 40))$$,
  'an older release (downgrade)', 'not newer');
select wos_test.expect_error($$insert into wos.app_releases (app_id, version, manifest, manifest_sha256, surfaces, source_repo, source_tag, source_commit)
  values ('crm', '0.3.0', '{}', 'sha256:' || repeat('a', 64), array['desktop'], 'waronsaas/product', 'crm@0.3.0', repeat('b', 40))$$,
  'a desktop release without a signed package');
select wos_test.expect_error($$update wos.app_releases set manifest = '{"x": 1}' where app_id = 'crm'$$, 'editing a published release', 'immutable');
select wos_test.expect_error($$delete from wos.app_releases where app_id = 'crm'$$, 'deleting a release', 'never deleted');
do $$ begin
  if (select current_version from wos.app_registry where app_id = 'crm') is distinct from '0.2.0' then
    raise exception 'current_version follows the latest release';
  end if;
end $$;
update wos.app_releases set state = 'yanked', yanked_at = now(), yank_reason = 'broken' where app_id = 'crm' and version = '0.2.0';
do $$ begin
  if (select current_version from wos.app_registry where app_id = 'crm') is not null then
    raise exception 'a yanked release is not current';
  end if;
  raise notice 'ok: releases immutable, monotonic, yank updates current_version';
end $$;
select wos_test.expect_error($$update wos.app_releases set state = 'published', yanked_at = null, yank_reason = null where app_id = 'crm'$$,
  'un-yanking a release', 'illegal release transition');

-- RLS: organizations and entitlements are visible to members only; the registry is public
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if exists (select 1 from wos.organizations where personal_account_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'bob sees alice''s personal organization';
  end if;
  if exists (select 1 from wos.app_entitlements where app_id = 'crm') then
    raise exception 'bob sees alice''s entitlements';
  end if;
  if not exists (select 1 from wos.app_registry where app_id = 'crm') then
    raise exception 'the registry is public';
  end if;
  raise notice 'ok: tenancy is private, the registry is public';
end $$;
do $$
declare n int;
begin
  update wos.app_entitlements set state = 'enabled' where app_id = 'crm';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'bob changed alice''s entitlement'; end if;
end $$;
select wos_test.expect_error($$insert into wos.app_registry (app_id, name, kind, billing) values ('evil', 'x', 'app', 'addon')$$,
  'a non-privileged registry write');
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare oid uuid;
begin
  if not exists (select 1 from wos.organizations where personal_account_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'alice cannot see her own organization';
  end if;
  update wos.app_entitlements set state = 'enabled' where app_id = 'crm';
  oid := wos.create_team_organization('acme', 'Acme');
  if (select role from wos.memberships where organization_id = oid and account_id = '00000000-0000-0000-0000-00000000000a') <> 'owner' then
    raise exception 'the creator owns a new team organization';
  end if;
  raise notice 'ok: members manage their organization; team organizations get their creator as owner';
end $$;
reset role;

-- ============================================================================================
-- 0007 (DRAFT v3) Proof of Contribution — Astra review 02 repros A–G and review 03 repros A3-*, which must be REJECTED.
-- Every A3-* case below was ACCEPTED by the pre-fix migration (docs/protocol/reviews/ASTRA-REVIEW-03-repros-prefix.txt).
-- Base-table fixtures (tasks, leases, changesets, rounds, reviews: 0001 tables, not under test here) are inserted with
-- triggers off (session_replication_role = replica); every 0007 row under test is inserted with triggers ON.
-- ============================================================================================
-- carol and alice are maintainers (alice is the co-signer of two-person actions); bootstrap mode is OFF by now.
insert into wos.account_roles (account_id, role) values ('00000000-0000-0000-0000-00000000000a', 'maintainer');
-- A3-7: the fixture writes the exact payload and, for two-person kinds, alice's SEPARATE approval of the operation hash.
create or replace function wos_test.aa(act text, tkind text, tid text, pl jsonb default '{}', approve boolean default true) returns uuid
language plpgsql as $$
declare
  i uuid := gen_random_uuid();
begin
  insert into wos.admin_actions (id, actor_account_id, action, target_kind, target_id, reason, payload, previous_state, resulting_state, co_signer_account_id)
  values (i, '00000000-0000-0000-0000-00000000000c', act, tkind, tid, 'db assertion fixture for ' || act, pl, '{}', '{}',
          case when wos.two_person_action(act) then '00000000-0000-0000-0000-00000000000a'::uuid end);
  if approve and wos.two_person_action(act) then
    insert into wos.admin_action_approvals (admin_action_id, approver_account_id, operation_sha256)
    select i, '00000000-0000-0000-0000-00000000000a', operation_sha256 from wos.admin_actions where id = i;
  end if;
  return i;
end $$;

-- H12: two-person is derived from the kind; a caller's requires_co_signer=false label is ignored.
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer)
  values ('00000000-0000-0000-0000-00000000000b', 'hold_receipt', 'receipt', 'x', 'bob is not a maintainer at all here', '{}', '{}', false)$$,
  'admin action by a non-maintainer', 'non-maintainer');
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer)
  values ('00000000-0000-0000-0000-00000000000c', 'invalidate_receipt', 'receipt', 'x', 'claiming no co-signer is needed does not work', '{}', '{}', false)$$,
  'two-person action labelled one-person by the caller (H12)', 'second maintainer');
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state)
  values ('00000000-0000-0000-0000-00000000000c', 'bootstrap_merge', 'attempt', 'x', 'merging my own work under bootstrap authority', '{}', '{}')$$,
  'bootstrap_merge outside bootstrap mode', 'outside bootstrap');
select wos_test.aa('start_test_epochs', 'platform', 'epochs');
select wos_test.expect_error($$update wos.admin_actions set reason = 'rewritten history is not allowed'$$, 'admin actions are append-only');
-- A3-7: the approval is the NAMED co-signer's, of the exact operation hash.
select wos_test.expect_error($$insert into wos.admin_action_approvals (admin_action_id, approver_account_id, operation_sha256)
  values (wos_test.aa('record_offset', 'beneficiary', 'x', '{}', false), '00000000-0000-0000-0000-00000000000c', wos.operation_sha256('record_offset', 'beneficiary', 'x', '{}', '{}'))$$,
  'A3-7: the actor approving their own two-person action', 'named co-signer');
select wos_test.expect_error($$insert into wos.admin_action_approvals (admin_action_id, approver_account_id, operation_sha256)
  values (wos_test.aa('record_offset', 'beneficiary', 'x', '{}', false), '00000000-0000-0000-0000-00000000000a', 'sha256:' || repeat('0', 64))$$,
  'A3-7: an approval of a different operation hash', 'named co-signer');
do $$ begin
  if (select min(entry_no) from wos.admin_actions) <> 1 or exists (select 1 from wos.leases where generation is null or generation < 1) then
    raise exception 'admin actions chain from 1; every lease has a generation';
  end if;
  raise notice 'ok: admin actions are chained; leases carry generations';
end $$;
select wos_test.expect_error($$update wos.leases set generation = generation + 1$$, 'lease generation is immutable', 'immutable');

-- Epochs (H6, H7); epochs 2 and 3 pin the oracle and reward policy
select wos_test.expect_error($$insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
  values (90, 'test', 'mainnet-beta', now(), now() + interval '7 days', 48, 48, '{}')$$, 'a test epoch on mainnet (H7)');
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base)
values (1, 'test', 'devnet', now() - interval '8 days', now() - interval '1 day', 48, 48, '{"oracle": "oracle.v1", "reward": "reward-policy.v1"}', 100000000, 1000000000000),
       (2, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{"oracle": "oracle.v1", "reward": "reward-policy.v1"}', 100000000, 1000000000000),
       (5, 'live', 'mainnet-beta', now() - interval '1 day', now() + interval '6 days', 48, 48, '{"oracle": "oracle.v1", "reward": "reward-policy.v1"}', 100000000, 1000000000000),
       (8, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{"reward": "reward-policy.v1"}', 100000000, 500000000);
-- Astra-02 repro A: a first transition straight to FINALIZED skipped every window. Now rejected.
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
values (99001, 'test', 'devnet', now(), now() + interval '7 days', 48, 48, '{}');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (99001, null, 'FINALIZED', 'system')$$,
  'repro A: skipping every epoch window (H6)', 'not allowed');
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, null, 'OPEN', 'system'), (2, null, 'OPEN', 'system'), (5, null, 'OPEN', 'system'), (8, null, 'OPEN', 'system');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'PROPOSED', 'system')$$, 'skipping CALCULATING', 'not allowed');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (2, 'OPEN', 'CALCULATING', 'system')$$, 'closing before the end', 'not allowed');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'CALCULATING', 'maintainer')$$,
  'a maintainer transition without its admin action');
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'CALCULATING', 'system');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor, receipts_root, allocations_root, result_sha256)
  values (1, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64))$$,
  'proposing inside the risk review window', 'not allowed');

-- Base-table fixtures for qualification (A3-5), audits (A3-6) and relatedness: dave and eve are unrelated to everyone.
insert into wos.accounts (id, handle, github_user_id, github_login, github_created_at, github_linked_at)
values ('00000000-0000-0000-0000-00000000000d', 'dave', 1004, 'dave', now() - interval '400 days', now()),
       ('00000000-0000-0000-0000-00000000000e', 'eve', 1005, 'eve', now() - interval '400 days', now());
insert into wos.devices (id, account_id, name, client_kind, public_key) values
  ('00000000-0000-0000-0000-0000000000dd', '00000000-0000-0000-0000-00000000000d', 'mac', 'cli', repeat('A', 42) || 'M='),
  ('00000000-0000-0000-0000-0000000000de', '00000000-0000-0000-0000-00000000000e', 'mac', 'cli', repeat('A', 42) || 'Q=');
set session_replication_role = replica;
insert into wos.tasks (id, kind, state, role, reviewer_slot, target_id, document_id, round_id, abu_id)
select v.id::uuid, v.kind, v.state, v.role, v.slot, case when v.doc then t.id end, case when v.doc then '00000000-0000-0000-0000-0000000000d1'::uuid end, v.round::uuid, v.abu::uuid
  from wos.targets t, (values
    ('00000000-0000-0000-0007-0000000000f3', 'roadmap_author', 'completed', 'roadmap_author', null, true, null, null),
    ('00000000-0000-0000-0007-0000000000f4', 'roadmap_author', 'completed', 'roadmap_author', null, true, null, null),
    ('00000000-0000-0000-0007-0000000000f5', 'abu_build', 'completed', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab1'),
    ('00000000-0000-0000-0007-0000000000f9', 'abu_build', 'completed', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab2'),
    ('00000000-0000-0000-0007-0000000000f6', 'payout_audit', 'leased', 'payout_auditor', null, false, null, null),
    ('00000000-0000-0000-0007-0000000000f7', 'payout_audit', 'leased', 'payout_auditor', null, false, null, null),
    ('00000000-0000-0000-0007-0000000000f8', 'roadmap_review', 'leased', 'roadmap_reviewer_astra', 'astra', true, '00000000-0000-0000-0007-0000000000e3', null),
    ('00000000-0000-0000-0007-000000000fb1', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab3'),
    ('00000000-0000-0000-0007-000000000fb2', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab4'),
    ('00000000-0000-0000-0007-000000000fb3', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab5'),
    ('00000000-0000-0000-0007-000000000fb4', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab6')
  ) as v(id, kind, state, role, slot, doc, round, abu) where t.slug = 'salesforce';
set session_replication_role = origin;
-- D49: budgets are fixed BEFORE any lease exists on the task. Objective ob2 has 10 ACU for its tasks.
insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values
  ('00000000-0000-0000-0007-0000000000b1', 'planning_deliverable', 'salesforce roadmap v1', 10000000, 'budget-model.v1'),
  ('00000000-0000-0000-0007-0000000000b2', 'feature_criterion', 'contacts: create and edit', 10000000, 'budget-model.v1'),
  ('00000000-0000-0000-0007-0000000000b3', 'feature_criterion', 'contacts: import', 100000000, 'budget-model.v1');
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch) values
  ('00000000-0000-0000-0007-0000000000f3', '00000000-0000-0000-0007-0000000000b1', 'planning', 3000000, 3000000, '{"sizePoints": null}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000c', 2),
  ('00000000-0000-0000-0007-000000000fb1', '00000000-0000-0000-0007-0000000000b2', 'execution', 6000000, 6000000, '{"sizePoints": 1}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000c', 2);
set session_replication_role = replica;

insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, issued_at, expires_at, hard_deadline_at, ended_at, generation) values
  ('00000000-0000-0000-0007-0000000000c3', '00000000-0000-0000-0007-0000000000f3', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', 'completed', '{}', now() - interval '3 hours', now() - interval '1 hour', now() + interval '1 hour', now() - interval '10 minutes', 1),
  ('00000000-0000-0000-0007-0000000000c4', '00000000-0000-0000-0007-0000000000f4', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', 'completed', '{}', now() - interval '3 hours', now() - interval '1 hour', now() + interval '1 hour', now() - interval '10 minutes', 1),
  ('00000000-0000-0000-0007-0000000000c5', '00000000-0000-0000-0007-0000000000f5', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', 'completed', '{}', now() - interval '3 hours', now() - interval '1 hour', now() + interval '1 hour', now() - interval '10 minutes', 1),
  ('00000000-0000-0000-0007-0000000000c9', '00000000-0000-0000-0007-0000000000f9', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', 'completed', '{}', now() - interval '3 hours', now() - interval '1 hour', now() + interval '1 hour', now() - interval '10 minutes', 1),
  ('00000000-0000-0000-0007-0000000000c6', '00000000-0000-0000-0007-0000000000f6', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000dd', 'active', '{}', now(), now() + interval '30 minutes', now() + interval '3 hours', null, 1),
  ('00000000-0000-0000-0007-0000000000c7', '00000000-0000-0000-0007-0000000000f7', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000de', 'active', '{}', now(), now() + interval '30 minutes', now() + interval '3 hours', null, 1),
  ('00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0007-0000000000f8', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', 'active', '{}', now(), now() + interval '30 minutes', now() + interval '3 hours', null, 1);
insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256) values
  ('00000000-0000-0000-0007-0000000000a8', '00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0007-0000000000f8', '00000000-0000-0000-0000-00000000000a', 'roadmap_reviewer_astra', 'gpt-6-astra', 'max', 'ctx-1', '{}', 'sha256:' || repeat('8', 64));
insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid) values
  ('00000000-0000-0000-0007-00000000e0a3', '00000000-0000-0000-0007-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', '{"provider": "claude_cli"}', true),
  ('00000000-0000-0000-0007-00000000e0a4', '00000000-0000-0000-0007-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', '{"provider": "claude_cli"}', true),
  ('00000000-0000-0000-0007-00000000e0a6', '00000000-0000-0000-0007-0000000000c6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000dd', '{"provider": "claude_cli"}', true),
  ('00000000-0000-0000-0007-00000000e0a7', '00000000-0000-0000-0007-0000000000c7', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000de', '{"provider": "codex_cli"}', true),
  ('00000000-0000-0000-0007-00000000e0a8', '00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0007-0000000000a8', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', '{"provider": "codex_cli"}', true);
insert into wos.changesets (id, lease_id, task_id, account_id, device_id, parent_sha, manifest_sha256, submission_sha256, signature_valid, file_manifest, total_bytes, validation, ok, summary, created_at)
select v.id::uuid, v.lease::uuid, v.task::uuid, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', repeat('0', 40), 'sha256:' || repeat('0', 64),
       'sha256:' || repeat(v.sub, 64), true, '[]', 1, '{}', true, '{}', now() - interval '30 minutes'
  from (values ('00000000-0000-0000-0000-000000c5c001', '00000000-0000-0000-0007-0000000000c3', '00000000-0000-0000-0007-0000000000f3', '9'),
               ('00000000-0000-0000-0000-000000c5c002', '00000000-0000-0000-0007-0000000000c4', '00000000-0000-0000-0007-0000000000f4', '9'),
               ('00000000-0000-0000-0000-000000c5c005', '00000000-0000-0000-0007-0000000000c5', '00000000-0000-0000-0007-0000000000f5', '8'),
               ('00000000-0000-0000-0000-000000c5c009', '00000000-0000-0000-0007-0000000000c9', '00000000-0000-0000-0007-0000000000f9', '8')) v(id, lease, task, sub);
insert into wos.attempts (id, abu_id, account_id, github_user_id, state, base_sha, head_sha, merged_sha, max_lifetime_at) values
  ('00000000-0000-0000-0000-00000000a701', '00000000-0000-0000-0000-000000000ab1', '00000000-0000-0000-0000-00000000000b', 1002, 'merged', repeat('0', 40), repeat('c', 40), repeat('c', 40), now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000a702', '00000000-0000-0000-0000-000000000ab2', '00000000-0000-0000-0000-00000000000b', 1002, 'merged', repeat('0', 40), repeat('c', 40), repeat('e', 40), now() - interval '2 hours');
update wos.rounds set state = 'cancelled' where id = '00000000-0000-0000-0000-0000000000e2';   -- the older open round of d1 is done
insert into wos.rounds (id, subject_kind, document_id, attempt_id, round_number, head_sha, submission_sha256, state, outcome, independence, revealed_at) values
  ('00000000-0000-0000-0007-0000000000e2', 'roadmap', '00000000-0000-0000-0000-0000000000d1', null, 12, repeat('b', 40), 'sha256:' || repeat('9', 64), 'revealed', 'consensus', 'independent', now()),
  ('00000000-0000-0000-0007-0000000000e5', 'implementation', null, '00000000-0000-0000-0000-00000000a701', 1, repeat('c', 40), 'sha256:' || repeat('8', 64), 'revealed', 'consensus', 'independent', now()),
  ('00000000-0000-0000-0007-0000000000e3', 'roadmap', '00000000-0000-0000-0000-0000000000d1', null, 13, repeat('d', 40), 'sha256:' || repeat('7', 64), 'awaiting_reviews', null, null, null);
insert into wos.reviews (id, round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning, head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
select gen_random_uuid(), v.round::uuid, gen_random_uuid(), gen_random_uuid(), v.acct::uuid, 1, v.slot, v.provider, 'm', 'max', v.head, 'sha256:' || repeat(v.sub, 64), 'NO_MATERIAL_GAPS', '{}', gen_random_uuid(), 'independent', gen_random_uuid()
  from (values ('00000000-0000-0000-0007-0000000000e2', '00000000-0000-0000-0000-00000000000d', 'astra', 'codex_cli', repeat('b', 40), '9'),
               ('00000000-0000-0000-0007-0000000000e2', '00000000-0000-0000-0000-00000000000e', 'fable', 'claude_cli', repeat('b', 40), '9'),
               ('00000000-0000-0000-0007-0000000000e5', '00000000-0000-0000-0000-00000000000d', 'astra', 'codex_cli', repeat('c', 40), '8'),
               ('00000000-0000-0000-0007-0000000000e5', '00000000-0000-0000-0000-00000000000e', 'fable', 'claude_cli', repeat('c', 40), '8')) v(round, acct, slot, provider, head, sub);
insert into wos.verification_runs (id, subject, attempt_id, source, head_sha, conclusion, github_check_suite_id)
values ('00000000-0000-0000-0007-0000000000b5', 'attempt', '00000000-0000-0000-0000-00000000a701', 'ci', repeat('c', 40), 'success', 1);
set session_replication_role = origin;

-- Consent, snapshots, usage receipts (H7, A3-5; D49: usage is telemetry)
insert into wos.publication_consents (account_id, disclosure_version, disclosure_sha256) values ('00000000-0000-0000-0000-00000000000b', 'disclosure.v1', 'sha256:' || repeat('d', 64));
insert into wos.run_policy_snapshots (lease_id, generation, body, snapshot_sha256) values
  ('00000000-0000-0000-0007-0000000000c3', 1, '{"humanReviewRequired": false}', 'sha256:' || repeat('5', 64)),
  ('00000000-0000-0000-0007-0000000000c4', 1, '{"humanReviewRequired": true}', 'sha256:' || repeat('4', 64)),
  ('00000000-0000-0000-0007-0000000000c5', 1, '{"humanReviewRequired": false}', 'sha256:' || repeat('3', 64)),
  ('00000000-0000-0000-0007-0000000000c9', 1, '{"humanReviewRequired": false}', 'sha256:' || repeat('2', 64)),
  ('00000000-0000-0000-0000-0000000000c1', 1, '{}', 'sha256:' || repeat('6', 64));
select wos_test.expect_error($$insert into wos.usage_receipts (agent_run_id, lease_id, lease_generation, account_id, provider, model_id_requested, reasoning_requested, verification_level, log_consistent,
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, usage_event_count, oracle_version, acu_micro, run_policy_snapshot_sha256, body, receipt_sha256)
  values ('00000000-0000-0000-0007-00000000e0a3', '00000000-0000-0000-0007-0000000000c3', 2, '00000000-0000-0000-0000-00000000000b', 'claude_cli', 'claude-fable-5-1', 'max', 'ATTESTED', true,
          1, 0, 0, 1, 0, 1, 'oracle.v1', 1, 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('6', 64))$$, 'usage receipt from a stale lease generation', 'generation');
insert into wos.usage_receipts (id, agent_run_id, lease_id, lease_generation, account_id, provider, model_id_requested, reasoning_requested, verification_level, log_consistent,
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, usage_event_count, oracle_version, acu_micro, run_policy_snapshot_sha256, body, receipt_sha256)
values ('00000000-0000-0000-0000-0000000ad001', '00000000-0000-0000-0007-00000000e0a3', '00000000-0000-0000-0007-0000000000c3', 1, '00000000-0000-0000-0000-00000000000b',
        'claude_cli', 'claude-fable-5-1', 'max', 'ATTESTED', true, 1000, 5000, 0, 200, 50, 2, 'oracle.v1', 12000, 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('6', 64)),
       ('00000000-0000-0000-0000-0000000ad002', '00000000-0000-0000-0007-00000000e0a4', '00000000-0000-0000-0007-0000000000c3', 1, '00000000-0000-0000-0000-00000000000b',
        'claude_cli', 'claude-fable-5-1', 'max', 'ATTESTED', false, 100, 0, 0, 10, 0, 1, 'oracle.v1', 1000, 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('7', 64)),
       ('00000000-0000-0000-0000-0000000ad003', '00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000000c1', 1, '00000000-0000-0000-0000-00000000000b',
        'claude_cli', 'claude-fable-5-1', 'max', 'ATTESTED', true, 100, 0, 0, 10, 0, 1, 'oracle.v1', 12000, 'sha256:' || repeat('6', 64), '{}', 'sha256:' || repeat('8', 64));
insert into wos.usage_event_ids (id_sha256, usage_receipt_id) values ('sha256:' || repeat('f', 64), '00000000-0000-0000-0000-0000000ad001');
select wos_test.expect_error($$insert into wos.usage_event_ids (id_sha256, usage_receipt_id) values ('sha256:' || repeat('f', 64), '00000000-0000-0000-0000-0000000ad001')$$,
  'a replayed provider response id');

-- Qualification (H7, A3-5): relationships, not assertions
create or replace function wos_test.q(qid uuid, kind text, subj uuid, rev text, lease uuid, gen int, cs uuid, rnd uuid, vr uuid, snap text) returns void
language sql as $$
  insert into wos.qualification_results (id, subject_kind, subject_id, subject_revision, lease_id, lease_generation, changeset_id, round_id,
    verification_run_id, policy_snapshot_sha256, evidence, evidence_sha256)
  values (qid, kind, subj, rev, lease, gen, cs, rnd, vr, 'sha256:' || repeat(snap, 64), '{}', 'sha256:' || repeat('e', 64))
$$;
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'document', '00000000-0000-0000-0000-0000000000d1', repeat('c', 40), '00000000-0000-0000-0007-0000000000c3', 1,
  '00000000-0000-0000-0000-000000c5c001', '00000000-0000-0000-0007-0000000000e2', null, '5')$$,
  'A3-5 repro: a qualification asserting an arbitrary revision', 'consensus round');
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'document', '00000000-0000-0000-0000-0000000000d1', repeat('a', 40), '00000000-0000-0000-0007-0000000000c3', 1,
  '00000000-0000-0000-0000-000000c5c001', '00000000-0000-0000-0000-0000000000e1', null, '5')$$,
  'A3-5: a qualification citing a round that ended in gaps', 'consensus round');
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'document', '00000000-0000-0000-0000-0000000000d1', repeat('b', 40), '00000000-0000-0000-0000-0000000000c1', 1,
  '00000000-0000-0000-0000-000000c5c001', '00000000-0000-0000-0007-0000000000e2', null, '6')$$,
  'A3-5: a qualification citing a changeset of another lease', 'not accepted on this lease');
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'document', '00000000-0000-0000-0000-0000000000d1', repeat('b', 40), '00000000-0000-0000-0007-0000000000c3', 2,
  '00000000-0000-0000-0000-000000c5c001', '00000000-0000-0000-0007-0000000000e2', null, '5')$$, 'a qualification on a stale lease generation', 'generation');
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'document', '00000000-0000-0000-0000-0000000000d1', repeat('b', 40), '00000000-0000-0000-0007-0000000000c4', 1,
  '00000000-0000-0000-0000-000000c5c002', '00000000-0000-0000-0007-0000000000e2', null, '4')$$,
  'A3-5: the pinned snapshot requires a human approval that is missing', 'human pre-merge');
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'attempt', '00000000-0000-0000-0000-00000000a701', repeat('c', 40), '00000000-0000-0000-0007-0000000000c5', 1,
  '00000000-0000-0000-0000-000000c5c005', '00000000-0000-0000-0007-0000000000e5', null, '3')$$,
  'A3-5: an implementation qualified without green CI at its head', 'green CI');
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'attempt', '00000000-0000-0000-0000-00000000a701', repeat('c', 40), '00000000-0000-0000-0007-0000000000c9', 1,
  '00000000-0000-0000-0000-000000c5c009', '00000000-0000-0000-0007-0000000000e5', '00000000-0000-0000-0007-0000000000b5', '2')$$,
  'A3-5 repro: another attempt''s changeset cited for this attempt', 'another attempt');
select wos_test.expect_error($$select wos_test.q(gen_random_uuid(), 'attempt', '00000000-0000-0000-0000-00000000a702', repeat('c', 40), '00000000-0000-0000-0007-0000000000c9', 1,
  '00000000-0000-0000-0000-000000c5c009', '00000000-0000-0000-0007-0000000000e5', '00000000-0000-0000-0007-0000000000b5', '2')$$,
  'A3-5: a submission accepted after the attempt''s hard lifetime', 'hard lifetime');
select wos_test.q('00000000-0000-0000-0000-0000000fa001', 'document', '00000000-0000-0000-0000-0000000000d1', repeat('b', 40), '00000000-0000-0000-0007-0000000000c3', 1,
  '00000000-0000-0000-0000-000000c5c001', '00000000-0000-0000-0007-0000000000e2', null, '5');
select wos_test.q('00000000-0000-0000-0000-0000000fa005', 'attempt', '00000000-0000-0000-0000-00000000a701', repeat('c', 40), '00000000-0000-0000-0007-0000000000c5', 1,
  '00000000-0000-0000-0000-000000c5c005', '00000000-0000-0000-0007-0000000000e5', '00000000-0000-0000-0007-0000000000b5', '3');

-- D49 task budgets: fixed before work, bounded by the model, approved above the human threshold, capped per objective,
-- reserved against the epoch's capacity; the proposer never works under their own budget.
create or replace function wos_test.budget(task uuid, obj text, b bigint, m bigint, epoch int, just text, aid uuid) returns void
language sql as $$
  insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, justification, budget_model_version,
    proposer_account_id, approval_admin_action_id, issued_epoch)
  values (task, ('00000000-0000-0000-0007-0000000000' || obj)::uuid, 'execution', b, m, '{"sizePoints": 1}', just, 'budget-model.v1',
          '00000000-0000-0000-0000-00000000000c', aid, epoch)
$$;
select wos_test.expect_error($$insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
  values ('00000000-0000-0000-0007-0000000000f4', '00000000-0000-0000-0007-0000000000b1', 'planning', 1000000, 1000000, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000c', 2)$$,
  'D49: a budget set after work started (the task already has a lease)', 'before work starts');
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-000000000fb2', 'b2', 20000000, 6000000, 2, repeat('x', 40), null)$$,
  'D49: a budget above the hard maximum of the model', 'hard maximum');
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-000000000fb2', 'b2', 3000000, 2000000, 2, '', null)$$,
  'D49: a budget above the model without a written justification', 'justification');
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-000000000fb2', 'b2', 3000000, 2000000, 2, repeat('x', 40), null)$$,
  'D49: a budget above the model without a human (two-person) approval', 'does not authorize');
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-000000000fb2', 'b2', 5000000, 5000000, 2, '', null)$$,
  'D49: task budgets under one objective exceeding it (splitting / stacking)', 'objective');
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-000000000fb3', 'b3', 6000000, 6000000, 8, '', null)$$,
  'D49: issuing beyond the epoch''s task capacity (reservation at issuance, never scaled)', 'capacity is exhausted');
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-000000000fb3', 'b3', 1000000, 1000000, 5, '', null)$$,
  'D49: issuing a task on mainnet', 'mainnet');
select wos_test.budget('00000000-0000-0000-0007-000000000fb2', 'b2', 4000000, 4000000, 2, '', null);
select wos_test.budget('00000000-0000-0000-0007-000000000fb4', 'b3', 7000000, 5000000, 2, 'shared dependency of three features: auth adapter',
  wos_test.aa('approve_budget', 'task', '00000000-0000-0000-0007-000000000fb4', '{"budget_acu_micro": 7000000}'));
do $$ begin
  if (select reserved_base || '/' || expires_epoch || '/' || issuance_rate_base_per_acu from wos.task_budgets where task_id = '00000000-0000-0000-0007-000000000fb4')
     <> '700000000/6/100000000' then
    raise exception 'the server pins rate, reservation and expiry on the budget';
  end if;
  raise notice 'ok: rate, reservation and expiry are server-pinned';
end $$;
select wos_test.expect_error($$insert into wos.leases (task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
  values ('00000000-0000-0000-0007-000000000fb4', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000dc', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours')$$,
  'D49: the proposer of a budget taking its lease', 'proposer');

-- Receipts (H7, D49): consent, qualification, the TASK BUDGET (never a usage figure), declared shares, telemetry rules
insert into wos.work_dedup_keys (dedup_key, source) values
  ('work:waronsaas/product:contacts#01', 'receipt'), ('work:waronsaas/product:contacts#02', 'receipt'), ('work:waronsaas/product:contacts#03', 'receipt'),
  ('work:waronsaas/product:proposal#01', 'receipt'), ('work:waronsaas/wos:ledger#01', 'genesis'), ('work:dave#1', 'receipt'),
  ('work:fb1:dave', 'receipt'), ('work:fb1:alice', 'receipt'), ('work:fb1:bob', 'receipt'), ('work:fb2:dave', 'receipt');
create or replace function wos_test.receipt(rid uuid, acct uuid, ctype text, slc text, ev text, wt bigint, task uuid, share int, usage uuid[], qid uuid,
                                             subj_kind text, subj uuid, lease uuid, gen int, dkey text, epoch int) returns void
language sql as $$
  insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
    weight_micro, task_id, share_bp, lowest_verification, usage_receipt_ids, qualification_id, subject_kind, subject_id,
    lease_id, lease_generation, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values (rid, acct, ctype, slc, ev, 'document_merged', 'independent', 'ACTIVE', wt, task, share, case when cardinality(usage) > 0 then 'ATTESTED' end,
          usage, qid, subj_kind, subj, lease, gen, dkey, epoch, '{"feature": "contacts"}', 'sha256:' || md5(rid::text) || md5(dkey), now())
$$;
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{}', null, 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#02', 2)$$,
  'a receipt without the publication disclosure (D47)', 'disclosure');
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{}', null, 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#02', 2)$$,
  'a leased contribution without a qualification (H7)', 'qualification');
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 12000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{00000000-0000-0000-0000-0000000ad001}', '00000000-0000-0000-0000-0000000fa001', 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#02', 2)$$,
  'D49: a receipt weighted by its usage instead of its task budget', 'never a usage figure');
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{00000000-0000-0000-0000-0000000ad003}', '00000000-0000-0000-0000-0000000fa001', 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#02', 2)$$,
  'A3-5 (telemetry): usage of another run (lease) attached to this contribution', 'of this lease');
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'IMPLEMENTATION', 'execution', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{}', '00000000-0000-0000-0000-0000000fa001', 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#02', 2)$$,
  'an IMPLEMENTATION receipt without a merged attempt (H7)', 'attempt');
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{}', '00000000-0000-0000-0000-0000000fa001', 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#02', 1)$$,
  'admission to an epoch that is not OPEN', 'OPEN epoch');
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{}', '00000000-0000-0000-0000-0000000fa001', 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#02', 5)$$,
  'a receipt on a mainnet epoch (readiness gate)', 'mainnet');
select wos_test.receipt('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000000b', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000f3', 10000, '{00000000-0000-0000-0000-0000000ad001}', '00000000-0000-0000-0000-0000000fa001', 'document', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0007-0000000000c3', 1, 'work:waronsaas/product:contacts#01', 2);
insert into wos.publication_consents (account_id, disclosure_version, disclosure_sha256) values
  ('00000000-0000-0000-0000-00000000000a', 'disclosure.v1', 'sha256:' || repeat('d', 64)), ('00000000-0000-0000-0000-00000000000d', 'disclosure.v1', 'sha256:' || repeat('d', 64));
select wos_test.receipt('00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-00000000000a', 'PROPOSAL', 'outcomes', 'outcome', 10000000, null, null,
  '{}', null, 'proposal', gen_random_uuid(), null, null, 'work:waronsaas/product:proposal#01', 2);
select wos_test.receipt('00000000-0000-0000-0000-0000000cc0d1', '00000000-0000-0000-0000-00000000000d', 'PROPOSAL', 'outcomes', 'outcome', 1, null, null,
  '{}', null, 'proposal', gen_random_uuid(), null, null, 'work:dave#1', 2);
-- D49 declared shares: collaborators' shares of one task sum to exactly 10000 bp at commit.
do $$ begin
  set constraints wos.contribution_receipts_shares immediate;
  begin
    perform wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000d', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
      '00000000-0000-0000-0007-000000000fb1', 6000, '{}', null, 'proposal', gen_random_uuid(), null, null, 'work:fb1:dave', 2);
    raise exception 'EXPECTED FAILURE did not happen: D49: declared shares of a task summing to less than 10000 bp';
  exception when check_violation then raise notice 'ok (rejected): D49: declared shares of a task summing to less than 10000 bp';
  end;
end $$;
do $$ begin
  perform wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000d', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
    '00000000-0000-0000-0007-000000000fb1', 6000, '{}', null, 'proposal', gen_random_uuid(), null, null, 'work:fb1:dave', 2);
  perform wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
    '00000000-0000-0000-0007-000000000fb1', 4000, '{}', null, 'proposal', gen_random_uuid(), null, null, 'work:fb1:alice', 2);
  raise notice 'ok: two collaborators accept one task at 60/40';
end $$;
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
  '00000000-0000-0000-0007-000000000fb1', 1, '{}', null, 'proposal', gen_random_uuid(), null, null, 'work:fb1:bob', 2)$$,
  'D49: a third share on a fully declared task (reward stacking)', 'exceed 10000');
select wos_test.expect_error($$insert into wos.task_budget_releases (task_id, reason) values ('00000000-0000-0000-0007-000000000fb1', 'cancelled')$$,
  'D49: releasing the budget of an accepted task', 'was accepted');
insert into wos.task_budget_releases (task_id, reason) values ('00000000-0000-0000-0007-000000000fb2', 'abandoned');
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000d', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 4000000,
  '00000000-0000-0000-0007-000000000fb2', 10000, '{}', null, 'proposal', gen_random_uuid(), null, null, 'work:fb2:dave', 2)$$,
  'D49: accepting a task whose budget was released', 'released');
do $$ begin
  if wos.receipt_status('00000000-0000-0000-0000-0000000cc001') <> 'ACTIVE' then raise exception 'a receipt is born ACTIVE with its issued event'; end if;
  if (select receipt_id from wos.contribution_usage where usage_receipt_id = '00000000-0000-0000-0000-0000000ad001') <> '00000000-0000-0000-0000-0000000cc001' then
    raise exception 'usage telemetry is attributed durably';
  end if;
  raise notice 'ok: receipts carry their task budgets; telemetry attributed once';
end $$;
select wos_test.expect_error($$insert into wos.work_dedup_keys (dedup_key, source) values ('work:waronsaas/product:contacts#01', 'genesis')$$, 'genesis credit for work that has a receipt');
select wos_test.expect_error($$update wos.contribution_receipts set weight_micro = 1$$, 'receipts are immutable');

-- Receipt status (H12, A3-7: kind, target, exact operation, approval, one use)
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, human_review_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'RATIFIED', 'human_signoff', gen_random_uuid())$$, 'ratifying a receipt that is not provisional', 'not allowed');
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'REVOKED', 'revoked', (select id from wos.admin_actions where action = 'start_test_epochs'))$$,
  'revoking with an unrelated admin action (H12)', 'does not authorize');
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
  values ('00000000-0000-0000-0000-0000000cc002', 'ACTIVE', 'REVOKED', 'revoked', wos_test.aa('resolve_dispute', 'receipt', '00000000-0000-0000-0000-0000000cc002'))$$,
  'A3-7 repro: revoking with a one-person resolve_dispute action and no resolution', 'does not authorize');
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'REVOKED', 'revoked', wos_test.aa('invalidate_receipt', 'receipt', '00000000-0000-0000-0000-0000000cc001', '{"to_status": "REVOKED"}', false))$$,
  'A3-7: a two-person revocation without the co-signer''s separate approval', 'co-signer approval');
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'REVOKED', 'revoked', wos_test.aa('invalidate_receipt', 'receipt', '00000000-0000-0000-0000-0000000cc001', '{"to_status": "ACTIVE"}'))$$,
  'A3-7: an action approved for another operation', 'authorizes payload');
insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'REVOKED', 'revoked', wos_test.aa('invalidate_receipt', 'receipt', '00000000-0000-0000-0000-0000000cc001', '{"to_status": "REVOKED"}'));
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'REVOKED', 'RATIFIED', 'restored', wos_test.aa('restore_receipt', 'receipt', '00000000-0000-0000-0000-0000000cc001', '{"to_status": "RATIFIED"}'))$$,
  'restoring to a status it never had', 'not allowed');
insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
values ('00000000-0000-0000-0000-0000000cc001', 'REVOKED', 'ACTIVE', 'restored', wos_test.aa('restore_receipt', 'receipt', '00000000-0000-0000-0000-0000000cc001', '{"to_status": "ACTIVE"}'));
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'REVOKED', 'revoked', (select admin_action_id from wos.receipt_status_events where receipt_id = '00000000-0000-0000-0000-0000000cc001' and kind = 'revoked'))$$,
  'A3-7 repro: one admin action used for a second mutation', 'already used');

-- Human review: scoped qualification (H8)
select wos_test.expect_error($$insert into wos.reviewer_qualification_events (account_id, action, domains, level, contribution_types, risk_classes, admin_action_id)
  values ('00000000-0000-0000-0000-00000000000c', 'grant', '{general}', 1, '{IMPLEMENTATION}', '{standard}', (select id from wos.admin_actions where action = 'start_test_epochs'))$$,
  'a qualification granted by an unrelated admin action', 'does not authorize');
insert into wos.reviewer_qualification_events (account_id, action, domains, level, contribution_types, risk_classes, admin_action_id)
values ('00000000-0000-0000-0000-00000000000c', 'grant', '{general}', 1, '{APPLICATION_ROADMAP}', '{standard}', wos_test.aa('authorize_reviewer', 'account', '00000000-0000-0000-0000-00000000000c')),
       ('00000000-0000-0000-0000-00000000000b', 'grant', '{general}', 1, '{APPLICATION_ROADMAP}', '{standard}', wos_test.aa('authorize_reviewer', 'account', '00000000-0000-0000-0000-00000000000b'));
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('audit', 'receipt', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000c', 'security', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('7', 64))$$,
  'a human review outside the reviewer''s risk classes (H8)', 'not an authorized');
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('audit', 'receipt', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000b', 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('8', 64))$$,
  'a human reviewing their own receipt', 'own work');
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, round_id, head_sha, submission_sha256, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('pre_merge', 'attempt', gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', repeat('a', 40), 'sha256:' || repeat('1', 64), 'sha256:' || repeat('1', 64),
          '00000000-0000-0000-0000-00000000000c', 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('9', 64))$$,
  'a pre-merge approval bound to a round of a different subject (H8)', 'bound to a round of this subject');

-- Payout audits (repro B, H8, H11, A3-6): server assignments, redeemed once, provider from the signed run
select wos_test.expect_error($$insert into wos.payout_audit_quorums (receipt_id, purpose, size, review_policy_version, outcome)
  values ('00000000-0000-0000-0000-0000000cc001', 'sampled', 2, 'review-policy.v1', 'ratified')$$, 'repro B: a quorum inserted already ratified (H7)', 'without an outcome');
insert into wos.payout_audit_quorums (id, receipt_id, purpose, size, review_policy_version) values
  ('00000000-0000-0000-0000-0000000ae001', '00000000-0000-0000-0000-0000000cc001', 'sampled', 2, 'review-policy.v1'),
  ('00000000-0000-0000-0000-0000000ae002', '00000000-0000-0000-0000-0000000cc002', 'sampled', 2, 'review-policy.v1');
create or replace function wos_test.assign(aid uuid, qid uuid, slot int, acct uuid, task uuid, lease uuid, provider text) returns void
language sql as $$
  insert into wos.payout_audit_assignments (id, quorum_id, slot, outside_feature, packet_sha256, reviewer_account_id, task_id, lease_id, lease_generation, permitted_provider, review_policy_version)
  values (aid, qid, slot, false, 'sha256:' || repeat('a', 64), acct, task, lease, 1, provider, 'review-policy.v1')
$$;
create or replace function wos_test.verdict(aid uuid, qid uuid, slot int, acct uuid, task uuid, lease uuid, run uuid, provider text, packet text) returns void
language sql as $$
  insert into wos.payout_audit_verdicts (assignment_id, quorum_id, slot, outside_feature, packet_sha256, reviewer_account_id, task_id, lease_id, agent_run_id, provider, judgment, body, verdict_sha256)
  values (aid, qid, slot, false, 'sha256:' || repeat(packet, 64), acct, task, lease, run, provider, 'plausible', '{}', 'sha256:' || md5(aid::text || run::text) || md5(qid::text))
$$;
select wos_test.expect_error($$select wos_test.assign(gen_random_uuid(), '00000000-0000-0000-0000-0000000ae001', 1, '00000000-0000-0000-0000-00000000000c',
  '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'claude_cli')$$,
  'an audit seat on someone else''s non-audit lease (H8)', 'own payout_audit task');
select wos_test.expect_error($$insert into wos.payout_audit_assignments (quorum_id, slot, outside_feature, packet_sha256, reviewer_account_id, task_id, lease_id, lease_generation, permitted_provider, review_policy_version)
  values ('00000000-0000-0000-0000-0000000ae001', 1, true, 'sha256:' || repeat('a', 64), '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0007-0000000000f6',
          '00000000-0000-0000-0007-0000000000c6', 1, 'claude_cli', 'review-policy.v1')$$, 'an outside-feature seat for an auditor with receipts on the feature', 'outside-feature seat');
select wos_test.assign('00000000-0000-0000-0000-0000000a5001', '00000000-0000-0000-0000-0000000ae001', 1, '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0007-0000000000f6', '00000000-0000-0000-0007-0000000000c6', 'claude_cli');
select wos_test.expect_error($$select wos_test.assign(gen_random_uuid(), '00000000-0000-0000-0000-0000000ae001', 2, '00000000-0000-0000-0000-00000000000e',
  '00000000-0000-0000-0007-0000000000f7', '00000000-0000-0000-0007-0000000000c7', 'claude_cli')$$, 'the last seat without a second provider', 'second provider');
select wos_test.expect_error($$select wos_test.assign(gen_random_uuid(), '00000000-0000-0000-0000-0000000ae002', 1, '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0007-0000000000f6', '00000000-0000-0000-0007-0000000000c6', 'claude_cli')$$, 'A3-6: one audit task assigned to two quorums', 'duplicate key');
select wos_test.expect_error($$select wos_test.verdict('00000000-0000-0000-0000-0000000a5001', '00000000-0000-0000-0000-0000000ae001', 1, '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0007-0000000000f6', '00000000-0000-0000-0007-0000000000c6', '00000000-0000-0000-0007-00000000e0a6', 'codex_cli', 'a')$$,
  'A3-6 repro: a claude run declared as the codex seat', 'redeem its own assignment');
select wos_test.expect_error($$select wos_test.verdict('00000000-0000-0000-0000-0000000a5001', '00000000-0000-0000-0000-0000000ae002', 1, '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0007-0000000000f6', '00000000-0000-0000-0007-0000000000c6', '00000000-0000-0000-0007-00000000e0a6', 'claude_cli', 'a')$$,
  'A3-6 repro: an assignment redeemed on an unrelated quorum', 'redeem its own assignment');
select wos_test.expect_error($$select wos_test.verdict('00000000-0000-0000-0000-0000000a5001', '00000000-0000-0000-0000-0000000ae001', 1, '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0007-0000000000f6', '00000000-0000-0000-0007-0000000000c6', '00000000-0000-0000-0007-00000000e0a6', 'claude_cli', 'b')$$,
  'A3-6: a verdict on another packet than the assigned one', 'redeem its own assignment');
select wos_test.verdict('00000000-0000-0000-0000-0000000a5001', '00000000-0000-0000-0000-0000000ae001', 1, '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0007-0000000000f6', '00000000-0000-0000-0007-0000000000c6', '00000000-0000-0000-0007-00000000e0a6', 'claude_cli', 'a');
select wos_test.assign('00000000-0000-0000-0000-0000000a5002', '00000000-0000-0000-0000-0000000ae001', 2, '00000000-0000-0000-0000-00000000000e',
  '00000000-0000-0000-0007-0000000000f7', '00000000-0000-0000-0007-0000000000c7', 'codex_cli');
select wos_test.expect_error($$select wos_test.verdict('00000000-0000-0000-0000-0000000a5002', '00000000-0000-0000-0000-0000000ae001', 2, '00000000-0000-0000-0000-00000000000e',
  '00000000-0000-0000-0007-0000000000f7', '00000000-0000-0000-0007-0000000000c7', '00000000-0000-0000-0007-00000000e0a6', 'codex_cli', 'a')$$,
  'A3-6 repro: a run reused for another seat (the run is bound to its own lease''s single assignment)', 'signed run');
select wos_test.expect_error($$update wos.payout_audit_quorums set outcome = 'ratified' where id = '00000000-0000-0000-0000-0000000ae001'$$, 'ratifying a quorum without verdicts', 'lacks');

-- Proposed allocations (repro C, H2): epoch 3 is CALCULATING (fixture transitions backdated with the check disabled)
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
values (3, 'test', 'devnet', now() - interval '12 days', now() - interval '5 days', 48, 48, '{"oracle": "oracle.v1", "reward": "reward-policy.v1"}');
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values
  (3, 1, null, 'OPEN', 'system', now() - interval '12 days'), (3, 2, 'OPEN', 'CALCULATING', 'system', now() - interval '4 days');
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.epoch_manifest_entries (epoch_number, mode, receipt_id, receipt_sha256, disposition, deferral_count) values
  (3, 'test', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('c', 64), 'included', 0),
  (3, 'test', '00000000-0000-0000-0000-0000000cc002', 'sha256:' || repeat('c', 64), 'included', 0);
select wos_test.expect_error($$insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
  select gen_random_uuid(), 3, 'test', '00000000-0000-0000-0000-00000000000a'::uuid, 'person', '00000000-0000-0000-0000-00000000000a'::uuid,
         '00000000-0000-0000-0000-0000000cc001'::uuid, s, 3000000, 300000000, '{}', 'sha256:' || repeat('a', 64) from unnest(array['execution', 'planning']) s$$,
  'repro C: allocating Bob''s receipt to Alice, twice (H2)', 'slice, contributor and beneficiary');
select wos_test.expect_error($$insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
  values (gen_random_uuid(), 2, 'test', '00000000-0000-0000-0000-00000000000b', 'person', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 1, 1, '{}', 'sha256:' || repeat('a', 64))$$,
  'an allocation while the epoch is OPEN', 'CALCULATING');
select wos_test.expect_error($$insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
  values (gen_random_uuid(), 3, 'test', '00000000-0000-0000-0000-00000000000b', 'person', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 3000000, 300000001, '{}', 'sha256:' || repeat('1', 64))$$,
  'D49: allocating more than the task''s reserved budget', 'reserved budget');
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256) values
  ('00000000-0000-0000-0000-0000000a1001', 3, 'test', '00000000-0000-0000-0000-00000000000b', 'person', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 12000, 300000000, '{}', 'sha256:' || repeat('1', 64)),
  ('00000000-0000-0000-0000-0000000a1002', 3, 'test', '00000000-0000-0000-0000-00000000000a', 'person', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000cc002', 'outcomes', 10000000, 900000000, '{}', 'sha256:' || repeat('2', 64));
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at) values
  (3, 3, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64), now() - interval '1 hour');
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
select wos_test.expect_error($$insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
  values (gen_random_uuid(), 3, 'test', '00000000-0000-0000-0000-00000000000b', 'person', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 1, 1, '{}', 'sha256:' || repeat('1', 64))$$,
  'an allocation added after publication', 'CALCULATING');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (3, 'PROPOSED', 'FINALIZED', 'system')$$,
  'finalizing inside the challenge window', 'not allowed');

-- Disputes (repro E, H10, D43, A3-3)
select wos_test.expect_error($$insert into wos.allocation_disputes (id, epoch_number, disputer_account_id, stake_base, body)
  values ('00000000-0000-0000-0000-0000000d2002', 3, '00000000-0000-0000-0000-00000000000b', 0, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a1002", "reason": "other"}]}')$$,
  'repro E: a zero-stake dispute (H10)');
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (3, '00000000-0000-0000-0000-00000000000b', 6000000, '{"items": []}')$$, 'an empty dispute bundle', 'items');
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (3, '00000000-0000-0000-0000-00000000000c', 1000000, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a1002", "reason": "other"}]}')$$,
  'a non-participant disputing', 'only participants');
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (3, '00000000-0000-0000-0000-00000000000b', 6000000, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a1001", "reason": "other"}]}')$$,
  'disputing one''s own allocation', 'own allocation');
insert into wos.allocation_disputes (id, epoch_number, disputer_account_id, stake_base, note_untrusted, body)
values ('00000000-0000-0000-0000-0000000d1001', 3, '00000000-0000-0000-0000-00000000000b', 6000000, 'usage is 3x peers for a size-2 unit',
        '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a1002", "reason": "budget_mismatch", "evidence": [{"kind": "anomaly_metric", "ref": "rank 1", "note": "3x peer P50"}]}]}');
select wos_test.expect_error($$insert into wos.dispute_items (dispute_id, allocation_id, reason, evidence, stake_base)
  values ('00000000-0000-0000-0000-0000000d1001', '00000000-0000-0000-0000-0000000a1001', 'other', '[]', 1)$$, 'appending an item after submission (H10)', 'frozen bundle');
do $$ begin
  if (select stake_base from wos.dispute_items where dispute_id = '00000000-0000-0000-0000-0000000d1001') <> 6000000
     or not exists (select 1 from wos.dispute_gates where allocation_id = '00000000-0000-0000-0000-0000000a1002' and priority_dispute_id = '00000000-0000-0000-0000-0000000d1001') then
    raise exception 'the frozen bundle carries its per-item stake and opens the gate with priority';
  end if;
  raise notice 'ok: dispute bundle frozen with per-item stake; gate opened';
end $$;
select wos_test.expect_error($$insert into wos.dispute_replies (allocation_id, account_id, body_untrusted)
  values ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-00000000000b', 'not mine to answer')$$, 'a reply by someone other than the accused', 'accused');
insert into wos.dispute_replies (allocation_id, account_id, body_untrusted, created_at)
values ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-00000000000a', 'three repair loops: the CI matrix failed twice on WebKit', now() - interval '10 years');
do $$ begin
  if (select created_at from wos.dispute_replies limit 1) < now() - interval '1 minute' then raise exception 'reply times are server-stamped (H6)'; end if;
  raise notice 'ok: reply time is server-stamped';
end $$;
select wos_test.expect_error($$insert into wos.dispute_item_resolutions (allocation_id, outcome, admin_action_id, resulting_amount_base, excess_base, recovered_base)
  values ('00000000-0000-0000-0000-0000000a1002', 'CLIPPED', wos_test.aa('resolve_dispute', 'allocation', '00000000-0000-0000-0000-0000000a1002', '{"outcome": "CLIPPED", "resulting_amount_base": 500000000}'), 500000000, 100000000, 0)$$,
  'a resolution whose amounts do not add up', 'must equal');
insert into wos.dispute_item_resolutions (allocation_id, outcome, admin_action_id, resulting_amount_base, excess_base, recovered_base)
values ('00000000-0000-0000-0000-0000000a1002', 'CLIPPED', wos_test.aa('resolve_dispute', 'allocation', '00000000-0000-0000-0000-0000000a1002', '{"outcome": "CLIPPED", "resulting_amount_base": 600000000}'), 600000000, 300000000, 300000000);
-- repro E, continued: joining an already-resolved allocation is refused.
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (3, '00000000-0000-0000-0000-00000000000b', 6000000, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a1002", "reason": "other"}]}')$$,
  'repro E: joining an already-resolved allocation', 'already resolved');
select wos_test.expect_error($$insert into wos.dispute_appeals (allocation_id, appellant_account_id, statement_untrusted)
  values ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-00000000000c', 'an outsider cannot appeal this one')$$, 'an appeal by an outsider', 'accused or the priority');
insert into wos.dispute_appeals (allocation_id, appellant_account_id, statement_untrusted)
values ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-00000000000a', 'the repair loops were caused by a flaky WebKit runner');
select wos_test.expect_error($$insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
  values ('00000000-0000-0000-0000-0000000d1001', 300000000, 300000000, 60000000, 0, 3)$$, 'settling while an appeal is pending', 'finally adjudicated');
select wos_test.expect_error($$insert into wos.dispute_appeal_decisions (allocation_id, decision, final_amount_base, admin_action_id)
  values ('00000000-0000-0000-0000-0000000a1002', 'confirmed', 700000000, wos_test.aa('decide_appeal', 'allocation', '00000000-0000-0000-0000-0000000a1002', '{"decision": "confirmed", "final_amount_base": 700000000}'))$$,
  'A3-3: a "confirmed" appeal that changes the amount', 'confirmed appeal keeps');
insert into wos.dispute_appeal_decisions (allocation_id, decision, final_amount_base, admin_action_id)
values ('00000000-0000-0000-0000-0000000a1002', 'confirmed', 600000000, wos_test.aa('decide_appeal', 'allocation', '00000000-0000-0000-0000-0000000a1002', '{"decision": "confirmed", "final_amount_base": 600000000}'));
select wos_test.expect_error($$insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
  values ('00000000-0000-0000-0000-0000000d1001', 300000000, 300000000, 60000001, 0, 3)$$, 'a bounty above 20% of what was recovered (D41)', 'derived values');
select wos_test.expect_error($$insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
  values ('00000000-0000-0000-0000-0000000d1001', 600000000, 600000000, 0, 0, 3)$$, 'a settlement claiming excess it does not hold priority on', 'derived values');
insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
values ('00000000-0000-0000-0000-0000000d1001', 300000000, 300000000, 60000000, 0, 3);

-- A3-3 with epochs 6 and 7 (PROPOSED; fixture allocations inserted with triggers off, as in CALCULATING)
set session_replication_role = replica;
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
select e, 'test', 'devnet', now() - interval '10 days', now() - interval '3 days', 48, 48, '{"oracle": "oracle.v1", "reward": "reward-policy.v1"}' from unnest(array[6, 7]) e;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
select e, s.seq, s.f, s.t, 'system', case when s.t = 'PROPOSED' then 'sha256:' || repeat('1', 64) end, case when s.t = 'PROPOSED' then 'sha256:' || repeat('2', 64) end,
       case when s.t = 'PROPOSED' then 'sha256:' || repeat('3', 64) end, now() - s.ago
  from unnest(array[6, 7]) e, (values (1, null, 'OPEN', interval '10 days'), (2, 'OPEN', 'CALCULATING', interval '3 days'), (3, 'CALCULATING', 'PROPOSED', interval '1 hour')) s(seq, f, t, ago);
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, pool_key, weight_micro, amount_base, explanation, explanation_sha256)
select v.id::uuid, v.e, 'test', v.acct::uuid, v.bk, coalesce(v.bid::uuid, (select id from wos.organizations where slug = 'acme')), null, 'completion_payout', 'p', 1, v.amt, '{}', 'sha256:' || repeat('1', 64)
  from (values ('00000000-0000-0000-0000-0000000a6001', 6, '00000000-0000-0000-0000-00000000000a', 'person', '00000000-0000-0000-0000-00000000000a', 100000000),
               ('00000000-0000-0000-0000-0000000a6002', 6, '00000000-0000-0000-0000-00000000000d', 'person', '00000000-0000-0000-0000-00000000000d', 50000000),
               ('00000000-0000-0000-0000-0000000a6003', 6, '00000000-0000-0000-0000-00000000000a', 'person', '00000000-0000-0000-0000-00000000000a', 100000000),
               ('00000000-0000-0000-0000-0000000a7001', 7, '00000000-0000-0000-0000-00000000000a', 'person', '00000000-0000-0000-0000-00000000000a', 100000000),
               ('00000000-0000-0000-0000-0000000a7002', 7, '00000000-0000-0000-0000-00000000000d', 'organization', null, 1000000)) v(id, e, acct, bk, bid, amt);
set session_replication_role = origin;
insert into wos.allocation_disputes (id, epoch_number, disputer_account_id, stake_base, body) values
  ('00000000-0000-0000-0000-0000000d6001', 6, '00000000-0000-0000-0000-00000000000d', 1000000, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a6001", "reason": "budget_mismatch"}]}'),
  ('00000000-0000-0000-0000-0000000d6002', 6, '00000000-0000-0000-0000-00000000000d', 1000000, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a6003", "reason": "budget_mismatch"}]}');
insert into wos.dispute_replies (allocation_id, account_id, body_untrusted) values
  ('00000000-0000-0000-0000-0000000a6001', '00000000-0000-0000-0000-00000000000a', 'the loops came from a flaky runner'),
  ('00000000-0000-0000-0000-0000000a6003', '00000000-0000-0000-0000-00000000000a', 'the loops came from a flaky runner');
insert into wos.dispute_item_resolutions (allocation_id, outcome, admin_action_id, resulting_amount_base, excess_base, recovered_base) values
  ('00000000-0000-0000-0000-0000000a6001', 'CLIPPED', wos_test.aa('resolve_dispute', 'allocation', '00000000-0000-0000-0000-0000000a6001', '{"outcome": "CLIPPED", "resulting_amount_base": 60000000}'), 60000000, 40000000, 40000000),
  ('00000000-0000-0000-0000-0000000a6003', 'CLIPPED', wos_test.aa('resolve_dispute', 'allocation', '00000000-0000-0000-0000-0000000a6003', '{"outcome": "CLIPPED", "resulting_amount_base": 70000000}'), 70000000, 30000000, 30000000);
select wos_test.expect_error($$insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
  values ('00000000-0000-0000-0000-0000000d6002', 30000000, 30000000, 6000000, 0, 6)$$,
  'A3-3 repro: settling before the appeal window closed (a timely appeal would then face an immutable settlement)', 'finally adjudicated');
insert into wos.dispute_appeals (allocation_id, appellant_account_id, statement_untrusted) values
  ('00000000-0000-0000-0000-0000000a6001', '00000000-0000-0000-0000-00000000000a', 'the usage was legitimate: flaky WebKit CI'),
  ('00000000-0000-0000-0000-0000000a6003', '00000000-0000-0000-0000-00000000000d', 'the clip is too small for the evidence shown');
insert into wos.dispute_appeal_decisions (allocation_id, decision, final_amount_base, admin_action_id)
values ('00000000-0000-0000-0000-0000000a6001', 'reversed', 100000000, wos_test.aa('decide_appeal', 'allocation', '00000000-0000-0000-0000-0000000a6001', '{"decision": "reversed", "final_amount_base": 100000000}'));
select wos_test.expect_error($$insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
  values ('00000000-0000-0000-0000-0000000d6001', 40000000, 40000000, 8000000, 0, 6)$$,
  'A3-3 repro: a settlement paying a bounty on excess the appeal reversed', 'derived values');
insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
values ('00000000-0000-0000-0000-0000000d6001', 0, 0, 0, 1000000, 6);
insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
values (7, '00000000-0000-0000-0000-00000000000d', 1000000, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a7001", "reason": "other"}]}');
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (7, '00000000-0000-0000-0000-00000000000d', 1000000, '{"items": [{"allocationId": "00000000-0000-0000-0000-0000000a7001", "reason": "other"}]}')$$,
  'A3-3 repro: a second dispute staking the same 1 WOS of pending allocation', 'exceed your pending');
-- epoch 6 finalized: dave's stakes (1 forfeited + 1 still reserved) bound what his 50 WOS allocation can release now.
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values (6, 4, 'PROPOSED', 'FINALIZED', 'system', now());
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
values (6, 'person', '00000000-0000-0000-0000-00000000000d', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a6002', 25000000);
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (6, 'person', '00000000-0000-0000-0000-00000000000d', 'holdback_tranche', 'allocation', '00000000-0000-0000-0000-0000000a6002', 25000000)$$,
  'A3-3: entitling the part of an allocation reserved as dispute stake', 'reserved as dispute stake');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (6, 'person', '00000000-0000-0000-0000-00000000000a', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a6003', 1)$$,
  'A3-3: entitling an allocation whose appeal is still pending', 'not final');

-- Entitlements (H2, A3-1): sourced, once per (source, kind), never ahead of the holdback, never early
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1001', 150000000)$$, 'an entitlement before FINALIZED', 'FINALIZED');
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values (3, 4, 'PROPOSED', 'FINALIZED', 'system', now());
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base) values
  ('00000000-0000-0000-0000-00000000e001', 3, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1001', 150000000),
  ('00000000-0000-0000-0000-00000000e002', 3, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_tranche', 'allocation', '00000000-0000-0000-0000-0000000a1001', 150000000),
  ('00000000-0000-0000-0000-00000000e003', 3, 'person', '00000000-0000-0000-0000-00000000000a', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1002', 300000000),
  ('00000000-0000-0000-0000-00000000e004', 3, 'person', '00000000-0000-0000-0000-00000000000a', 'holdback_tranche', 'allocation', '00000000-0000-0000-0000-0000000a1002', 300000000),
  ('00000000-0000-0000-0000-00000000e005', 3, 'person', '00000000-0000-0000-0000-00000000000b', 'bounty', 'dispute_settlement', '00000000-0000-0000-0000-0000000d1001', 60000000);
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1001', 150000000)$$,
  'A3-1 repro: the same reward entitled twice (balance, then the (source, kind) key)', 'remaining balance');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'withheld_release', 'allocation', '00000000-0000-0000-0000-0000000a1001', 1)$$,
  'A3-1: entitling more than the allocation holds', 'remaining balance');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (6, 'person', '00000000-0000-0000-0000-00000000000a', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a6001', 80000001)$$,
  'A3-1: a release that dips into the holdback share (20% pinned on the epoch)', 'holdback');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_matured', 'tranche', '00000000-0000-0000-0000-00000000e002', 150000000)$$,
  'A3-1 repro: a tranche matured in its own epoch', 'matures in epoch 9');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'withheld_release', 'allocation', '00000000-0000-0000-0000-0000000a1002', 1)$$,
  'A3-1: an entitlement naming someone else''s allocation', 'own epoch, mode and beneficiary');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000a', 'bounty', 'dispute_settlement', '00000000-0000-0000-0000-0000000d1001', 1)$$,
  'A3-1: a bounty entitlement to someone other than the disputer', 'to its disputer');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'genesis_vesting', 'genesis', gen_random_uuid(), 1)$$,
  'A3-1: Genesis vesting outside the Genesis finalization (mainnet-only)', 'Genesis');
do $$ begin
  if (select matures_epoch from wos.entitlements where id = '00000000-0000-0000-0000-00000000e002') <> 9
     or (select cluster || '/' || mode || '/' || policy_version from wos.entitlements where id = '00000000-0000-0000-0000-00000000e002') <> 'devnet/test/reward-policy.v1' then
    raise exception 'the server stamps maturity, settlement domain and policy on each entitlement';
  end if;
  raise notice 'ok: tranche maturity, domain and policy pinned by the server';
end $$;

-- Wallets (repro D, H9, review-02 M17), leaves and settlement (H3, A3-2, A3-9)
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000a', false);
insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
values (wos.actor_id(), 'devnet', repeat('2', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('2', 32), repeat('s', 88));
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000b', false);
-- Astra-02 repro D: under contributor RLS, Bob could bind Alice's wallet. The privileged registry now refuses it.
select wos_test.expect_error($$insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
  values (wos.actor_id(), 'devnet', repeat('2', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('2', 32), repeat('s', 88))$$,
  'repro D: one wallet bound to two accounts under RLS (H9)', 'already bound');
insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
values (wos.actor_id(), 'devnet', repeat('3', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('3', 32), repeat('s', 88));
insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
values (wos.actor_id(), 'mainnet-beta', repeat('5', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('5', 32), repeat('s', 88));
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000c', false);
select wos_test.expect_error($$insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
  values (wos.actor_id(), 'devnet', repeat('6', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('6', 32), repeat('s', 88))$$,
  'review-02 M17 (Astra-03): a wallet bound before the publication disclosure', 'disclosure');
reset role;
select wos_test.expect_error($$insert into wos.wallet_bindings (account_id, organization_id, cluster, wallet, kind, action, message, multisig_tx_signature)
  select '00000000-0000-0000-0000-00000000000b', id, 'devnet', repeat('4', 32), 'multisig_pda', 'bind',
         '00000000-0000-0000-0000-00000000000b ' || id::text || ' ' || repeat('4', 32), repeat('t', 64) from wos.organizations where slug = 'acme'$$,
  'an organization wallet bound by a non-admin', 'owner or admin');
insert into wos.wallet_bindings (account_id, organization_id, cluster, wallet, kind, action, message, multisig_tx_signature)
select '00000000-0000-0000-0000-00000000000a', id, 'devnet', repeat('4', 32), 'multisig_pda', 'bind',
       '00000000-0000-0000-0000-00000000000a ' || id::text || ' ' || repeat('4', 32), repeat('t', 64) from wos.organizations where slug = 'acme';
select wos_test.expect_error($$insert into wos.claim_leaves (cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
  values ('devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('2', 32), 150000000, 1, 'sha256:' || repeat('1', 64))$$,
  'a leaf to a wallet bound to someone else', 'not currently bound');
select wos_test.expect_error($$insert into wos.claim_leaves (cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
  values ('mainnet-beta', 'person', '00000000-0000-0000-0000-00000000000b', repeat('5', 32), 150000000, 1, 'sha256:' || repeat('1', 64))$$,
  'A3-1 repro: a devnet entitlement routed to a mainnet leaf (default-deny at the settlement boundary)', 'mainnet settlement is closed');
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
values ('00000000-0000-0000-0000-0000000f1001', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 150000000, 1, 'sha256:' || repeat('1', 64));
select wos_test.expect_error($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000f1001', 150000000)$$,
  'claiming an unmatured holdback tranche (D40)', 'matured');
select wos_test.expect_error($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000f1001', 149999999)$$,
  'A3-2: a claim of less than the remaining balance', 'whole remaining balance');
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000f1001', 150000000);
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
values ('00000000-0000-0000-0000-0000000f1002', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 150000000, 1, 'sha256:' || repeat('2', 64));
select wos_test.expect_error($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000f1002', 150000000)$$,
  'the same entitlement in two live leaves (H3)', 'already in a live leaf');
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
values ('00000000-0000-0000-0000-0000000f1001', 1, 1, '\x01', 'sha256:' || repeat('1', 64), 'sig-1-' || repeat('a', 40), 100);
select wos_test.expect_error($$insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
  values ('00000000-0000-0000-0000-0000000f1001', 2, 1, '\x02', 'sha256:' || repeat('2', 64), 'sig-2-' || repeat('a', 40), 200)$$,
  'a second attempt while the first is unresolved (H3)', 'unresolved attempt');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome) values ('00000000-0000-0000-0000-0000000f1001', 1, 'failed_before_broadcast')$$,
  'A3-9 repro: signed bytes declared failed-before-broadcast (only a proven expiry frees the leaf)');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked) values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', false)$$,
  'declaring an attempt expired without a historical search (H3)');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
  values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', true, 100, '{"value": [null]}')$$,
  'A3-9: expiry declared at a block height that has not passed the last valid height', 'block height');
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', true, 101, '{"value": [null], "searchTransactionHistory": true}');
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
values ('00000000-0000-0000-0000-0000000f1001', 2, 1, '\x02', 'sha256:' || repeat('2', 64), 'sig-2-' || repeat('a', 40), 200);
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, commitment, slot) values ('00000000-0000-0000-0000-0000000f1001', 2, 'confirmed', 'confirmed', 1)$$,
  'confirming before finalized commitment (H3)');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome) values ('00000000-0000-0000-0000-0000000f1001', 2, 'confirmed')$$,
  'A3-9 repro: confirmed with a NULL commitment');
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, commitment, history_checked, slot) values ('00000000-0000-0000-0000-0000000f1001', 2, 'confirmed', 'finalized', true, 1234);
select wos_test.expect_error($$insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
  values ('00000000-0000-0000-0000-0000000f1001', 3, 1, '\x03', 'sha256:' || repeat('3', 64), 'sig-3-' || repeat('a', 40), 300)$$, 'paying a settled leaf again', 'already settled');
select wos_test.expect_error($$insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1001', (select id from wos.admin_actions where action = 'start_test_epochs'))$$,
  'A3-2 repro: voiding a leaf with an unrelated admin action', 'does not authorize');
select wos_test.expect_error($$insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1001', wos_test.aa('void_leaf', 'leaf', '00000000-0000-0000-0000-0000000f1001'))$$,
  'A3-2 repro: voiding a settled leaf to re-claim its entitlement', 'never voided');
insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1002', wos_test.aa('void_leaf', 'leaf', '00000000-0000-0000-0000-0000000f1002'));
select wos_test.expect_error($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-0000000f1002', 60000000)$$,
  'A3-2: claiming into a void leaf', 'frozen');

-- Confiscation (D39, A3-4): hold at notice, an actual appeal, targeted decisions, partial balances, execution windows
select wos_test.expect_error($$insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at)
  values ('00000000-0000-0000-0000-0000000c0f01', 'person', '00000000-0000-0000-0000-00000000000b', 150000000, 'gate a1002', wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0000-0000000c0f01'),
          now() + interval '1 hour', now() + interval '2 hours')$$, 'confiscation without the reply and appeal windows', 'reply');
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at) values
  ('00000000-0000-0000-0000-0000000c0f02', 'person', '00000000-0000-0000-0000-00000000000b', 200000000, 'pattern finding, epochs 1-3',
   wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0000-0000000c0f02', '{"beneficiary_id": "00000000-0000-0000-0000-00000000000b", "proven_excess_base": 200000000}'), now() + interval '73 hours', now() + interval '242 hours'),
  ('00000000-0000-0000-0000-0000000c0f03', 'person', '00000000-0000-0000-0000-00000000000a', 10000000, 'gate a1002',
   wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0000-0000000c0f03', '{"beneficiary_id": "00000000-0000-0000-0000-00000000000a", "proven_excess_base": 10000000}'), now() + interval '73 hours', now() + interval '242 hours'),
  ('00000000-0000-0000-0000-0000000c0f04', 'person', '00000000-0000-0000-0000-00000000000a', 50000000, 'gate a1002',
   wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0000-0000000c0f04', '{"beneficiary_id": "00000000-0000-0000-0000-00000000000a", "proven_excess_base": 50000000}'), now() + interval '73 hours', now() + interval '242 hours');
-- A3-4: the hold starts at notice, so nothing claimable leaves during the windows.
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base)
values ('00000000-0000-0000-0000-0000000c0f02', 'holdback', '00000000-0000-0000-0000-00000000e002', 150000000);
select wos_test.expect_error($$insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base)
  values ('00000000-0000-0000-0000-0000000c0f02', 'holdback', '00000000-0000-0000-0000-00000000e002', 1)$$, 'holding more of a tranche than remains (D39)', 'enough remaining');
select wos_test.expect_error($$insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base)
  values ('00000000-0000-0000-0000-0000000c0f02', 'unclaimed_entitlement', '00000000-0000-0000-0000-00000000e001', 10)$$,
  'confiscating an entitlement already in a live (settled) leaf: released tokens are never seized', 'unreleased');
select wos_test.expect_error($$insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base)
  values ('00000000-0000-0000-0000-0000000c0f02', 'unclaimed_entitlement', '00000000-0000-0000-0000-00000000e005', 50000001)$$, 'confiscating above the proven excess', 'never exceeds');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values
  ('00000000-0000-0000-0000-0000000c0f03', 'unclaimed_entitlement', '00000000-0000-0000-0000-00000000e003', 10000000),
  ('00000000-0000-0000-0000-0000000c0f04', 'holdback', '00000000-0000-0000-0000-00000000e004', 10000000);
-- A3-4 repro (b): the other 290 of a partly held entitlement stays claimable, exactly once.
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
values ('00000000-0000-0000-0000-0000000f1003', 'devnet', 'person', '00000000-0000-0000-0000-00000000000a', repeat('2', 32), 290000000, 1, 'sha256:' || repeat('3', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000f1003', 290000000);
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
values ('00000000-0000-0000-0000-0000000f1003', 1, 1, '\x31', 'sha256:' || repeat('4', 64), 'sig-31-' || repeat('a', 40), 500);
select wos_test.expect_error($$insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1003', wos_test.aa('void_leaf', 'leaf', '00000000-0000-0000-0000-0000000f1003'))$$,
  'A3-2: voiding a leaf whose signed attempt may still land', 'may still land');
-- A3-4 repro (c): a tranche with 10 held matures only its remaining 290, and only at its pinned epoch (3 + 6).
set session_replication_role = replica;
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
values (9, 'test', 'devnet', now() - interval '10 days', now() - interval '3 days', 48, 48, '{"oracle": "oracle.v1", "reward": "reward-policy.v1"}');
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
values (9, 1, null, 'OPEN', 'system', null, null, null, now() - interval '10 days'), (9, 2, 'OPEN', 'CALCULATING', 'system', null, null, null, now() - interval '3 days'),
       (9, 3, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64), now() - interval '2 days'),
       (9, 4, 'PROPOSED', 'FINALIZED', 'system', null, null, null, now());
set session_replication_role = origin;
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (9, 'person', '00000000-0000-0000-0000-00000000000a', 'holdback_matured', 'tranche', '00000000-0000-0000-0000-00000000e004', 300000000)$$,
  'A3-4 repro: maturing the full tranche although 10 is held', 'remaining balance');
insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
values (9, 'person', '00000000-0000-0000-0000-00000000000a', 'holdback_matured', 'tranche', '00000000-0000-0000-0000-00000000e004', 290000000);
-- A3-4 repro (a): no decision without an actual appeal, before the reply window, or with an untargeted action.
select wos_test.expect_error($$insert into wos.confiscation_appeal_decisions (confiscation_id, decision, admin_action_id)
  values ('00000000-0000-0000-0000-0000000c0f02', 'upheld', wos_test.aa('decide_confiscation_appeal', 'confiscation', '00000000-0000-0000-0000-0000000c0f02', '{"decision": "upheld"}'))$$,
  'A3-4 repro: an immediate "upheld" decision with no appeal filed', 'no appeal was filed');
select wos_test.expect_error($$insert into wos.confiscation_appeals (confiscation_id, appellant_account_id, statement_untrusted)
  values ('00000000-0000-0000-0000-0000000c0f02', '00000000-0000-0000-0000-00000000000a', 'alice appealing for bob is not allowed')$$, 'a confiscation appeal by someone else', 'affected beneficiary');
insert into wos.confiscation_appeals (confiscation_id, appellant_account_id, statement_untrusted)
values ('00000000-0000-0000-0000-0000000c0f02', '00000000-0000-0000-0000-00000000000b', 'the pattern is explained by the flaky WebKit runner');
select wos_test.expect_error($$insert into wos.confiscation_appeal_decisions (confiscation_id, decision, admin_action_id)
  values ('00000000-0000-0000-0000-0000000c0f02', 'upheld', (select id from wos.admin_actions where action = 'start_test_epochs'))$$,
  'A3-4 repro: an appeal decided with an unrelated action', 'does not authorize');
select wos_test.expect_error($$insert into wos.confiscation_appeal_decisions (confiscation_id, decision, admin_action_id)
  values ('00000000-0000-0000-0000-0000000c0f02', 'upheld', wos_test.aa('decide_confiscation_appeal', 'confiscation', '00000000-0000-0000-0000-0000000c0f02', '{"decision": "upheld"}'))$$,
  'A3-4: deciding before the reply window closed', 'after the reply window');
select wos_test.expect_error($$insert into wos.confiscation_executions (confiscation_id) values ('00000000-0000-0000-0000-0000000c0f02')$$,
  'A3-4: executing while the appeal is open', 'executes only after');
-- Windows in the past need a backdated fixture (notice times are server-stamped): c0f09 closed, c0f10 reply closed.
set session_replication_role = replica;
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, notice_at, reply_closes_at, appeal_closes_at, hold_expires_at) values
  ('00000000-0000-0000-0000-0000000c0f09', 'person', '00000000-0000-0000-0000-00000000000b', 5, 'x', (select id from wos.admin_actions limit 1), now() - interval '12 days', now() - interval '9 days', now() - interval '1 hour', now() + interval '13 days'),
  ('00000000-0000-0000-0000-0000000c0f10', 'person', '00000000-0000-0000-0000-00000000000b', 20000000, 'x', (select id from wos.admin_actions limit 1), now() - interval '4 days', now() - interval '1 hour', now() + interval '6 days', now() + interval '20 days');
set session_replication_role = origin;
insert into wos.confiscation_executions (confiscation_id) values ('00000000-0000-0000-0000-0000000c0f09');
select wos_test.expect_error($$insert into wos.confiscation_appeals (confiscation_id, appellant_account_id, statement_untrusted)
  values ('00000000-0000-0000-0000-0000000c0f09', '00000000-0000-0000-0000-00000000000b', 'an appeal after the window closed')$$, 'a confiscation appeal after its window', 'window has closed');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base)
values ('00000000-0000-0000-0000-0000000c0f10', 'unclaimed_entitlement', '00000000-0000-0000-0000-00000000e005', 20000000);
insert into wos.confiscation_appeals (confiscation_id, appellant_account_id, statement_untrusted)
values ('00000000-0000-0000-0000-0000000c0f10', '00000000-0000-0000-0000-00000000000b', 'the finding confuses two different runs');
select wos_test.expect_error($$insert into wos.confiscation_appeal_decisions (confiscation_id, decision, admin_action_id)
  values ('00000000-0000-0000-0000-0000000c0f10', 'overturned', wos_test.aa('decide_confiscation_appeal', 'confiscation', '00000000-0000-0000-0000-0000000c0f10', '{"decision": "upheld"}'))$$,
  'A3-7: a decision action approved for the opposite outcome', 'authorizes payload');
do $$ begin
  if wos.entitlement_remaining('00000000-0000-0000-0000-00000000e005') <> 40000000 then raise exception 'a hold reduces the remaining balance at once'; end if;
end $$;
insert into wos.confiscation_appeal_decisions (confiscation_id, decision, admin_action_id)
values ('00000000-0000-0000-0000-0000000c0f10', 'overturned', wos_test.aa('decide_confiscation_appeal', 'confiscation', '00000000-0000-0000-0000-0000000c0f10', '{"decision": "overturned"}'));
do $$ begin
  if wos.entitlement_remaining('00000000-0000-0000-0000-00000000e005') <> 60000000 then raise exception 'an overturned confiscation releases its holds'; end if;
  raise notice 'ok: holds apply at notice and are released when overturned';
end $$;

-- Policy activation (repro F, H6, A3-7)
insert into wos.policy_documents (kind, version, body, sha256) values ('reward', 'reward-policy.v2', '{}', 'sha256:' || repeat('1', 64));
select wos_test.expect_error($$insert into wos.policy_activations (kind, version, effective_epoch, announced_at, preview_sha256, admin_action_id)
  select 'reward', 'reward-policy.v2', 3, starts_at - interval '73 hours', 'sha256:' || repeat('4', 64), wos_test.aa('activate_policy', 'policy', 'reward:reward-policy.v2', '{"effective_epoch": 3, "emergency": false}')
  from wos.epochs where epoch_number = 3$$, 'repro F: an ordinary policy change on published epoch 3 with a backdated announcement (H6)', 'never change a published');
select wos_test.expect_error($$insert into wos.policy_activations (kind, version, effective_epoch, emergency, admin_action_id)
  values ('reward', 'reward-policy.v2', 3, true, wos_test.aa('activate_policy', 'policy', 'reward:reward-policy.v2', '{"effective_epoch": 3, "emergency": true}'))$$, 'an emergency change on published allocations', 'published');
select wos_test.expect_error($$insert into wos.policy_activations (kind, version, effective_epoch, preview_sha256, admin_action_id)
  values ('reward', 'reward-policy.v2', 100000, 'sha256:' || repeat('2', 64), (select id from wos.admin_actions where action = 'start_test_epochs'))$$,
  'an activation authorized by an unrelated admin action (H12)', 'does not authorize');
select wos_test.expect_error($$insert into wos.policy_activations (kind, version, effective_epoch, preview_sha256, admin_action_id)
  values ('reward', 'reward-policy.v2', 100000, 'sha256:' || repeat('2', 64), wos_test.aa('activate_policy', 'policy', 'reward:reward-policy.v2', '{"effective_epoch": 99999, "emergency": false}'))$$,
  'A3-7: an activation approved for another epoch', 'authorizes payload');
select wos_test.expect_error($$insert into wos.policy_activations (kind, version, effective_epoch, preview_sha256, admin_action_id)
  values ('reward', 'reward-policy.v2', 100000, 'sha256:' || repeat('2', 64), wos_test.aa('activate_policy', 'policy', 'reward:reward-policy.v2', '{"effective_epoch": 100000, "emergency": false}', false))$$,
  'A3-7: a two-person activation without the second approval', 'co-signer approval');
insert into wos.policy_activations (kind, version, effective_epoch, preview_sha256, admin_action_id)
values ('reward', 'reward-policy.v2', 100000, 'sha256:' || repeat('2', 64), wos_test.aa('activate_policy', 'policy', 'reward:reward-policy.v2', '{"effective_epoch": 100000, "emergency": false}'));

-- Offsets (A3-7 repro): one record_offset action, one offset of exactly its amount
select set_config('wos_test.offset_aid', wos_test.aa('record_offset', 'beneficiary', '00000000-0000-0000-0000-00000000000b', '{"amount_base": 1, "receipt_id": null}')::text, false);
insert into wos.offsets (beneficiary_kind, beneficiary_id, amount_base, admin_action_id) values ('person', '00000000-0000-0000-0000-00000000000b', 1, current_setting('wos_test.offset_aid')::uuid);
select wos_test.expect_error($$insert into wos.offsets (beneficiary_kind, beneficiary_id, amount_base, admin_action_id)
  values ('person', '00000000-0000-0000-0000-00000000000b', 999999999, current_setting('wos_test.offset_aid')::uuid)$$,
  'A3-7 repro: an old record_offset action reused for a different amount', 'authorizes payload');
select wos_test.expect_error($$insert into wos.offsets (beneficiary_kind, beneficiary_id, amount_base, admin_action_id)
  values ('person', '00000000-0000-0000-0000-00000000000b', 1, current_setting('wos_test.offset_aid')::uuid)$$,
  'A3-7 repro: an old record_offset action reused for the same amount', 'already used');

-- Off-ramp (repro G, H3, D46, A3-9)
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, admin_action_id, created_at, expires_at)
  values ('pause', 'paused_accrual', 'security_incident', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual', '{"action": "pause"}'), now() + interval '1 year', now() + interval '1 year 13 days')$$,
  'repro G: a pause expiring a year from now via a future created_at (H6)', '14 days');
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, admin_action_id)
  values ('pause', 'paused_accrual', 'security_incident', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual', '{"action": "pause"}'))$$, 'a pause without an expiry');
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, expires_at, admin_action_id)
  values ('pause', 'paused_accrual', 'price_fell', now() + interval '1 day', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual', '{"action": "pause"}'))$$, 'a price-based trigger');
select wos_test.expect_error($$insert into wos.migration_snapshots (at_epoch, from_adapter, to_adapter, finalized_slot, body, snapshot_sha256)
  values (3, 'solana_wos', 'in_app_credits', 1, '{}', 'sha256:' || repeat('1', 64))$$, 'a migration snapshot without fencing settlement first (H3)', 'pause');
insert into wos.settlement_adapter_events (action, adapter, trigger_kind, expires_at, admin_action_id)
values ('pause', 'paused_accrual', 'security_incident', now() + interval '7 days', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual', '{"action": "pause"}'));
select wos_test.expect_error($$insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
  values ('00000000-0000-0000-0000-0000000f1003', 2, 1, '\x32', 'sha256:' || repeat('9', 64), 'sig-9-' || repeat('a', 40), 900)$$, 'settling while paused', 'paused');
do $$ begin
  if wos.may_broadcast('00000000-0000-0000-0000-0000000f1003', 1) then raise exception 'the broadcaster is fenced while paused (A3-9)'; end if;
  raise notice 'ok: the broadcaster is fenced while paused';
end $$;
select wos_test.expect_error($$insert into wos.migration_snapshots (at_epoch, from_adapter, to_adapter, finalized_slot, body, snapshot_sha256)
  values (3, 'solana_wos', 'in_app_credits', 1234, '{}', 'sha256:' || repeat('1', 64))$$, 'a snapshot with an in-flight signed attempt (A3-9)', 'drain');
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
values ('00000000-0000-0000-0000-0000000f1003', 1, 'expired_not_landed', true, 501, '{"value": [null], "searchTransactionHistory": true}');
insert into wos.migration_snapshots (at_epoch, from_adapter, to_adapter, finalized_slot, body, snapshot_sha256)
values (3, 'solana_wos', 'in_app_credits', 1234, '{}', 'sha256:' || repeat('1', 64));
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, admin_action_id)
  values ('resume', 'solana_wos', 'security_incident', wos_test.aa('resume_settlement', 'settlement', 'solana_wos', '{"action": "resume"}'))$$, 'resuming without a safety confirmation (D46)');
insert into wos.settlement_adapter_events (action, adapter, trigger_kind, safety_confirmation, admin_action_id)
values ('resume', 'solana_wos', 'security_incident', 'incident closed: key rotated, worker patched, reconciled', wos_test.aa('resume_settlement', 'settlement', 'solana_wos', '{"action": "resume"}'));
insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1003', wos_test.aa('void_leaf', 'leaf', '00000000-0000-0000-0000-0000000f1003'));
do $$ begin
  if wos.entitlement_remaining('00000000-0000-0000-0000-00000000e003') <> 290000000 then
    raise exception 'voiding a proven-expired leaf releases its claims (and only its claims)';
  end if;
  raise notice 'ok: a proven-expired leaf is voided and its entitlement is claimable again';
end $$;

-- Pools: one terminal disposition (H13)
insert into wos.completion_pools (id, kind, pool_key) values ('00000000-0000-0000-0000-0000000b0001', 'feature', 'salesforce/contacts');
select wos_test.expect_error($$insert into wos.pool_events (pool_id, event, epoch_number, amount_base) values ('00000000-0000-0000-0000-0000000b0001', 'paid', 3, 1)$$,
  'paying a pool that never became payable', 'payable');
insert into wos.pool_events (pool_id, event, epoch_number, amount_base) values ('00000000-0000-0000-0000-0000000b0001', 'payable', 3, 1), ('00000000-0000-0000-0000-0000000b0001', 'paid', 3, 1);
select wos_test.expect_error($$insert into wos.pool_events (pool_id, event, epoch_number, amount_base) values ('00000000-0000-0000-0000-0000000b0001', 'returned', 3, 1)$$,
  'a pool both paid and returned (H13)');

-- Organizations: org-mates and ever-sponsored accounts are related (H8)
do $$
declare
  acme uuid;
begin
  select id into acme from wos.organizations where slug = 'acme';
  begin
    insert into wos.sponsorship_links (organization_id, contributor_account_id, approved_by_account_id)
    values (acme, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b');
    raise exception 'EXPECTED FAILURE did not happen: sponsorship approved by a non-admin';
  exception when check_violation then raise notice 'ok (rejected): sponsorship approved by a non-admin';
  end;
  insert into wos.sponsorship_links (organization_id, contributor_account_id, approved_by_account_id)
  values (acme, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a'),
         (acme, '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a');
  if not (wos.related_accounts('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c')
          and wos.related_accounts('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')) then
    raise exception 'sponsored accounts and team members must be related';
  end if;
  raise notice 'ok: team members and sponsored contributors are related accounts';
end $$;
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('audit', 'receipt', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000c', 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('0', 64))$$,
  'a human review of an org-mate''s receipt', 'related');
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0007-0000000000e3', '00000000-0000-0000-0007-0000000000f8', '00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0000-00000000000a', 1001,
          'astra', 'codex_cli', 'gpt-6-astra', 'max', repeat('d', 40), 'sha256:' || repeat('7', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0007-0000000000a8', 'independent',
          '00000000-0000-0000-0007-00000000e0a8')$$,
  'A3-6: a document review by an account related to the document''s author', 'author of this document');

-- Duty events (M14), run-log retention (M17), governance server time (H6), Genesis (M16, A3-12)
insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind, deadline_at) values ('00000000-0000-0000-0000-0000000d0001', 1, '00000000-0000-0000-0000-00000000000b', 3, 'offered', now() + interval '1 day');
insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind) values ('00000000-0000-0000-0000-0000000d0001', 2, '00000000-0000-0000-0000-00000000000b', 3, 'completed');
select wos_test.expect_error($$insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind) values ('00000000-0000-0000-0000-0000000d0001', 3, '00000000-0000-0000-0000-00000000000b', 3, 'expired_no_fault')$$,
  'ending a duty offer twice (M14)', 'exactly once');
insert into wos.run_log_commitments (agent_run_id, log_sha256, turns, repair_loops, tool_calls, totals_match, body_expires_at)
values ('00000000-0000-0000-0000-00000000e0a1', 'sha256:' || repeat('7', 64), 3, 0, 5, true, now() + interval '365 days');
insert into wos.run_log_bodies (agent_run_id, size_bytes, body) values ('00000000-0000-0000-0000-00000000e0a1', 10, '{}');
select wos_test.expect_error($$delete from wos.run_log_bodies where agent_run_id = '00000000-0000-0000-0000-00000000e0a1'$$, 'deleting a run log body before retention expires (M17)', 'retention');
insert into wos.governance_proposals (id, kind, tier, body, snapshot_epoch, voting_opens_at, voting_closes_at)
values ('00000000-0000-0000-0000-0000000e0901', 'policy_change', 'routine', '{}', 3, now() - interval '9 days', now() - interval '2 days');
insert into wos.governance_weight_snapshots (proposal_id, account_id, group_id, locked_base, contribution_micro)
values ('00000000-0000-0000-0000-0000000e0901', '00000000-0000-0000-0000-00000000000b', 'owner:b', 0, 12000);
select wos_test.expect_error($$insert into wos.governance_votes (proposal_id, account_id, choice, body, created_at)
  values ('00000000-0000-0000-0000-0000000e0901', '00000000-0000-0000-0000-00000000000b', 'yes', '{}', now() - interval '5 days')$$,
  'a vote backdated into a closed window (H6)', 'closed');
insert into wos.genesis_contributions (id, contributor_account_id, evidence_kind, evidence_refs, evidence_sha256, dedup_key, size_points, genesis_policy_version, body, admin_action_id)
values ('00000000-0000-0000-0000-0000000ae501', '00000000-0000-0000-0000-00000000000c', 'retro_abu', '{waronsaas/wos@abc}', 'sha256:' || repeat('e', 64), 'work:waronsaas/wos:ledger#01', 5, 'genesis-policy.v1', '{}',
        wos_test.aa('record_genesis', 'genesis', 'work:waronsaas/wos:ledger#01', jsonb_build_object('contributor_account_id', '00000000-0000-0000-0000-00000000000c', 'size_points', 5, 'evidence_sha256', 'sha256:' || repeat('e', 64))));
insert into wos.genesis_commit_claims (commit_sha, genesis_contribution_id) values (repeat('1', 40), '00000000-0000-0000-0000-0000000ae501');
select wos_test.expect_error($$insert into wos.genesis_commit_claims (commit_sha, genesis_contribution_id) values (repeat('1', 40), '00000000-0000-0000-0000-0000000ae501')$$,
  'one commit credited to two retro units (M16)');
select wos_test.expect_error($$insert into wos.genesis_commit_claims (commit_sha, genesis_contribution_id) values (repeat('c', 40), '00000000-0000-0000-0000-0000000ae501')$$,
  'A3-12: a merged live attempt claimed as Genesis history', 'live work');
insert into wos.work_dedup_keys (dedup_key, source) values ('work:gen:x1', 'genesis'), ('work:gen:x2', 'genesis'), ('work:gen:dave', 'genesis');
do $$ begin
  set constraints wos.genesis_commit_coverage immediate;
  begin
    insert into wos.genesis_contributions (contributor_account_id, evidence_kind, evidence_refs, evidence_sha256, dedup_key, size_points, genesis_policy_version, body, admin_action_id)
    values ('00000000-0000-0000-0000-00000000000c', 'git_commit', array[repeat('2', 40)], 'sha256:' || repeat('e', 64), 'work:gen:x1', 3, 'genesis-policy.v1', '{}',
            wos_test.aa('record_genesis', 'genesis', 'work:gen:x1', jsonb_build_object('contributor_account_id', '00000000-0000-0000-0000-00000000000c', 'size_points', 3, 'evidence_sha256', 'sha256:' || repeat('e', 64))));
    raise exception 'EXPECTED FAILURE did not happen: A3-12 repro: commit evidence without its canonical commit mapping';
  exception when check_violation then raise notice 'ok (rejected): A3-12 repro: commit evidence without its canonical commit mapping';
  end;
end $$;
do $$
declare
  g uuid := gen_random_uuid();
begin
  insert into wos.genesis_contributions (id, contributor_account_id, evidence_kind, evidence_refs, evidence_sha256, dedup_key, size_points, genesis_policy_version, body, admin_action_id)
  values (g, '00000000-0000-0000-0000-00000000000c', 'git_commit', array[repeat('2', 40)], 'sha256:' || repeat('e', 64), 'work:gen:x1', 3, 'genesis-policy.v1', '{}',
          wos_test.aa('record_genesis', 'genesis', 'work:gen:x1', jsonb_build_object('contributor_account_id', '00000000-0000-0000-0000-00000000000c', 'size_points', 3, 'evidence_sha256', 'sha256:' || repeat('e', 64))));
  insert into wos.genesis_commit_claims (commit_sha, genesis_contribution_id) values (repeat('2', 40), g);
  raise notice 'ok: commit evidence with its canonical mapping is accepted at commit';
end $$;
select wos_test.expect_error($$insert into wos.genesis_reference_manifests (version, cutoff_epoch, rules, receipt_ids, manifest_sha256, admin_action_id)
  values ('reference.v0', 2, '{}', '{00000000-0000-0000-0000-0000000cc002}', 'sha256:' || repeat('a', 64),
          wos_test.aa('approve_genesis_reference', 'genesis_reference', 'reference.v0', '{"manifest_sha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'))$$,
  'a Genesis beneficiary''s related party in the reference population (M16)', 'reference population');
insert into wos.genesis_reference_manifests (version, cutoff_epoch, rules, receipt_ids, manifest_sha256, admin_action_id)
values ('reference.v1', 2, '{"types": ["PROPOSAL"]}', '{00000000-0000-0000-0000-0000000cc0d1}', 'sha256:' || repeat('b', 64),
        wos_test.aa('approve_genesis_reference', 'genesis_reference', 'reference.v1', '{"manifest_sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'));
select wos_test.expect_error($$insert into wos.genesis_contributions (contributor_account_id, evidence_kind, evidence_refs, evidence_sha256, dedup_key, size_points, genesis_policy_version, body, admin_action_id)
  values ('00000000-0000-0000-0000-00000000000d', 'retro_abu', '{waronsaas/wos@def}', 'sha256:' || repeat('e', 64), 'work:gen:dave', 3, 'genesis-policy.v1', '{}',
          wos_test.aa('record_genesis', 'genesis', 'work:gen:dave', jsonb_build_object('contributor_account_id', '00000000-0000-0000-0000-00000000000d', 'size_points', 3, 'evidence_sha256', 'sha256:' || repeat('e', 64))))$$,
  'A3-12 repro: a member of the frozen reference population added later as a Genesis beneficiary', 'reference population');
select wos_test.expect_error($$update wos.genesis_reference_manifests set receipt_ids = receipt_ids || '{00000000-0000-0000-0000-0000000cc002}'::uuid[]$$,
  'A3-12: adding to a finalized reference manifest');

-- RLS: canary classification, abuse signals, assignments and the wallet registry are private; approvals are own-session
insert into wos.abuse_signals (kind, severity, subject_kind, subject_id, detector, detector_version, evidence)
values ('payout_canary_passed', 'high', 'account', 'x', 'canary', 'v1', '{}');
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if exists (select 1 from wos.abuse_signals) or exists (select 1 from wos.payout_audit_quorums) or exists (select 1 from wos.wallet_registry)
     or exists (select 1 from wos.payout_audit_assignments) then
    raise exception 'abuse signals, quorum classification, assignments or the wallet registry leaked to a contributor';
  end if;
  if not exists (select 1 from wos.contribution_receipts) then raise exception 'receipts are public'; end if;
  raise notice 'ok: canaries, signals, assignments and the registry are private; receipts public';
end $$;
select wos_test.expect_error($$update wos.contribution_receipts set weight_micro = 1$$, 'app role updating a receipt');
select wos_test.expect_error($$insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
  values (19, 'live', 'devnet', now(), now() + interval '1 day', 48, 48, '{}')$$, 'a contributor creating an epoch');
select set_config('wos.actor_kind', 'maintainer', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000c', false);
select wos_test.expect_error($$insert into wos.admin_action_approvals (admin_action_id, approver_account_id, operation_sha256)
  select id, '00000000-0000-0000-0000-00000000000a', operation_sha256 from wos.admin_actions where requires_co_signer limit 1$$,
  'A3-7: a maintainer session writing the co-signer''s approval', 'row-level security');
reset role;
select set_config('wos.actor_kind', 'system', false);

\echo 'all db assertions passed'

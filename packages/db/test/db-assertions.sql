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
-- 0007 (DRAFT) Proof of Contribution
-- ============================================================================================
-- carol is a maintainer (granted above); bootstrap mode is OFF by now (ended above).
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer, prev_hash, entry_hash, created_at, entry_no)
  values ('00000000-0000-0000-0000-00000000000a', 'hold_receipt', 'receipt', 'x', 'alice is not a maintainer here at all', '{}', '{}', false, '\x00', '\x01', now(), 0)$$,
  'admin action by a non-maintainer', 'non-maintainer');
insert into wos.admin_actions (id, actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer, prev_hash, entry_hash, created_at, entry_no)
values ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-00000000000c', 'start_test_epochs', 'platform', 'epochs',
        'rehearse the devnet pipeline while alone', '{}', '{"test": true}', false, '\x00', '\x00', now(), 0);
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer, prev_hash, entry_hash, created_at, entry_no)
  values ('00000000-0000-0000-0000-00000000000c', 'invalidate_receipt', 'receipt', 'x', 'two-person action without a co-signer', '{}', '{}', true, '\x00', '\x02', now(), 0)$$,
  'two-person action without co-signer');
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer, prev_hash, entry_hash, created_at, entry_no)
  values ('00000000-0000-0000-0000-00000000000c', 'bootstrap_merge', 'attempt', 'x', 'merging my own work under bootstrap authority', '{}', '{}', false, '\x00', '\x03', now(), 0)$$,
  'bootstrap_merge outside bootstrap mode', 'outside bootstrap');
select wos_test.expect_error($$update wos.admin_actions set reason = 'rewritten history is not allowed'$$, 'admin actions are append-only');
do $$ begin
  if (select entry_no from wos.admin_actions where id = '00000000-0000-0000-0000-0000000aa001') <> 1 then raise exception 'admin action chain must start at 1'; end if;
  if (select prev_hash from wos.admin_actions where id = '00000000-0000-0000-0000-0000000aa001') <> '\x00'::bytea then raise exception 'first prev_hash is 0x00'; end if;
  if exists (select 1 from wos.leases where generation is null or generation < 1) then raise exception 'every lease has a generation'; end if;
  raise notice 'ok: admin actions are chained; leases carry generations';
end $$;
select wos_test.expect_error($$update wos.leases set generation = generation + 1$$, 'lease generation is immutable', 'immutable');

-- epochs: append-only transitions in machine order, bounded windows enforced by the database
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
values (1, 'test', 'devnet', now() - interval '8 days', now() - interval '1 day', 72, 48, '{}'),
       (2, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 72, 48, '{}');
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, null, 'OPEN', 'system');
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (2, null, 'OPEN', 'system');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'PROPOSED', 'system')$$,
  'skipping CALCULATING', 'not allowed');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (2, 'OPEN', 'CALCULATING', 'system')$$,
  'closing an epoch before it ends', 'cannot close');
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'CALCULATING', 'system');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor, receipts_root, allocations_root, result_sha256)
  values (1, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64))$$,
  'proposing inside the risk review window', 'risk review window');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'CALCULATING', 'FINALIZED', 'system')$$,
  'finalizing without a challenge window', 'not allowed');

-- receipts: immutable, admitted only to an OPEN epoch, fail closed on weak evidence, one shared dedup namespace
insert into wos.work_dedup_keys (dedup_key, source) values ('work:waronsaas/product:contacts#01', 'receipt'), ('work:waronsaas/wos:ledger#01', 'genesis');
insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, attested_acu_micro, cap_acu_micro, lowest_verification, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
values ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000000b', 'IMPLEMENTATION', 'execution', 'attested_usage', 'pr_merged',
        'independent', 'ACTIVE', 3000000, 3000000, 12000000, 'ATTESTED', 'attempt', gen_random_uuid(),
        'work:waronsaas/product:contacts#01', 2, '{"feature": "contacts"}', 'sha256:' || repeat('c', 64), now());
do $$ begin
  if wos.receipt_status('00000000-0000-0000-0000-0000000cc001') <> 'ACTIVE' then raise exception 'a receipt is born with its issued event'; end if;
  raise notice 'ok: receipt issued ACTIVE';
end $$;
select wos_test.expect_error($$insert into wos.work_dedup_keys (dedup_key, source) values ('work:waronsaas/product:contacts#01', 'genesis')$$,
  'genesis credit for work that already has a receipt');
select wos_test.expect_error($$insert into wos.contribution_receipts (account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, attested_acu_micro, cap_acu_micro, lowest_verification, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values ('00000000-0000-0000-0000-00000000000c', 'IMPLEMENTATION', 'execution', 'attested_usage', 'pr_merged', 'founder_bootstrap', 'PROVISIONAL',
          1, 1, 1, 'ATTESTED', 'attempt', gen_random_uuid(), 'work:waronsaas/product:contacts#01', 2, '{}', 'sha256:' || repeat('d', 64), now())$$,
  'founder_bootstrap receipt outside bootstrap mode', 'bootstrap');
insert into wos.work_dedup_keys (dedup_key, source) values ('work:waronsaas/product:contacts#02', 'receipt');
select wos_test.expect_error($$insert into wos.contribution_receipts (account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, attested_acu_micro, cap_acu_micro, lowest_verification, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values ('00000000-0000-0000-0000-00000000000a', 'IMPLEMENTATION', 'execution', 'attested_usage', 'pr_merged', 'independent', 'ACTIVE',
          1, 1, 5, 'UNVERIFIED', 'attempt', gen_random_uuid(), 'work:waronsaas/product:contacts#02', 2, '{}', 'sha256:' || repeat('e', 64), now())$$,
  'attested_usage weight on UNVERIFIED usage', 'fail closed');
select wos_test.expect_error($$insert into wos.contribution_receipts (account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, attested_acu_micro, cap_acu_micro, lowest_verification, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values ('00000000-0000-0000-0000-00000000000a', 'IMPLEMENTATION', 'execution', 'attested_usage', 'pr_merged', 'independent', 'ACTIVE',
          9, 9, 5, 'ATTESTED', 'attempt', gen_random_uuid(), 'work:waronsaas/product:contacts#02', 2, '{}', 'sha256:' || repeat('e', 64), now())$$,
  'weight above the compute cap');
select wos_test.expect_error($$insert into wos.contribution_receipts (account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, attested_acu_micro, cap_acu_micro, lowest_verification, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values ('00000000-0000-0000-0000-00000000000a', 'IMPLEMENTATION', 'execution', 'attested_usage', 'pr_merged', 'independent', 'ACTIVE',
          1, 1, 5, 'ATTESTED', 'attempt', gen_random_uuid(), 'work:waronsaas/product:contacts#02', 1, '{}', 'sha256:' || repeat('e', 64), now())$$,
  'admission to an epoch that is not OPEN', 'OPEN epoch');
select wos_test.expect_error($$update wos.contribution_receipts set weight_micro = 1$$, 'receipts are immutable');

-- receipt status follows the machine; ratification needs a real quorum or a human sign-off
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, human_review_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'RATIFIED', 'human_signoff', gen_random_uuid())$$,
  'ratifying a receipt that is not provisional', 'not allowed');
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind)
  values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'REVOKED', 'revoked')$$,
  'revocation without an admin action', 'not allowed');
insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
values ('00000000-0000-0000-0000-0000000cc001', 'ACTIVE', 'REVOKED', 'revoked', '00000000-0000-0000-0000-0000000aa001');
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
  values ('00000000-0000-0000-0000-0000000cc001', 'REVOKED', 'RATIFIED', 'restored', '00000000-0000-0000-0000-0000000aa001')$$,
  'restoring to a status it never had', 'not allowed');
insert into wos.receipt_status_events (receipt_id, from_status, to_status, kind, admin_action_id)
values ('00000000-0000-0000-0000-0000000cc001', 'REVOKED', 'ACTIVE', 'restored', '00000000-0000-0000-0000-0000000aa001');

-- human reviews: only authorized, never one's own work
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('ratification_signoff', 'receipt', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000c', 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('7', 64))$$,
  'human review by an unauthorized account', 'not an authorized');
insert into wos.reviewer_qualification_events (account_id, action, domains, level, contribution_types, risk_classes, admin_action_id)
values ('00000000-0000-0000-0000-00000000000c', 'grant', '{general}', 1, '{IMPLEMENTATION}', '{standard}', '00000000-0000-0000-0000-0000000aa001'),
       ('00000000-0000-0000-0000-00000000000b', 'grant', '{general}', 1, '{IMPLEMENTATION}', '{standard}', '00000000-0000-0000-0000-0000000aa001');
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('ratification_signoff', 'receipt', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000b', 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('8', 64))$$,
  'a human reviewing their own receipt', 'own work');
insert into wos.human_reviews (id, purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
values ('00000000-0000-0000-0000-0000000ab001', 'ratification_signoff', 'receipt', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('1', 64),
        '00000000-0000-0000-0000-00000000000c', 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('9', 64));

-- payout audit quorums: the author never audits their own receipt; ratification needs the verdicts
insert into wos.payout_audit_quorums (id, receipt_id, size, review_policy_version)
values ('00000000-0000-0000-0000-0000000ae001', '00000000-0000-0000-0000-0000000cc001', 2, 'review-policy.v1');
select wos_test.expect_error($$insert into wos.payout_audit_verdicts (quorum_id, slot, outside_feature, packet_id, reviewer_account_id, task_id, lease_id, agent_run_id, provider, judgment, body, verdict_sha256)
  values ('00000000-0000-0000-0000-0000000ae001', 1, true, gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000e0a1', 'claude_cli', 'plausible', '{}', 'sha256:' || repeat('a', 64))$$,
  'auditing one''s own receipt', 'own receipt');
select wos_test.expect_error($$update wos.payout_audit_quorums set outcome = 'ratified' where id = '00000000-0000-0000-0000-0000000ae001'$$,
  'ratifying a quorum without plausible verdicts', 'lacks');

-- clips never raise weight; manifests and allocations are frozen windows
select wos_test.expect_error($$insert into wos.receipt_clips (receipt_id, new_weight_micro, admin_action_id, auditor_account_ids)
  values ('00000000-0000-0000-0000-0000000cc001', 4000000, '00000000-0000-0000-0000-0000000aa001', '{00000000-0000-0000-0000-00000000000a}')$$,
  'a clip that raises the weight', 'never raises');
select wos_test.expect_error($$insert into wos.allocations (id, epoch_number, account_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
  values (gen_random_uuid(), 2, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'execution', 1, 1, '{}', 'sha256:' || repeat('1', 64))$$,
  'allocations while the epoch is OPEN', 'CALCULATING');
select wos_test.expect_error($$insert into wos.epoch_manifest_entries (epoch_number, mode, receipt_id, receipt_sha256, disposition, deferral_count)
  values (1, 'live', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('c', 64), 'included', 0)$$, 'manifest mode differs from the epoch', 'mode');

-- usage receipts: bound to lease generation + snapshot; provider response ids back usage once
insert into wos.run_policy_snapshots (lease_id, generation, body, snapshot_sha256)
values ('00000000-0000-0000-0000-0000000000c1', 1, '{}', 'sha256:' || repeat('5', 64));
select wos_test.expect_error($$insert into wos.usage_receipts (agent_run_id, lease_id, lease_generation, account_id, provider, model_id_requested, reasoning_requested, verification_level,
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, usage_event_count, oracle_version, acu_micro, run_policy_snapshot_sha256, body, receipt_sha256)
  values ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000000c1', 2, '00000000-0000-0000-0000-00000000000b', 'claude_cli', 'claude-fable-5-1', 'max', 'ATTESTED',
          1, 0, 0, 1, 0, 1, 'oracle.v1', 1, 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('6', 64))$$,
  'usage receipt from a stale lease generation', 'generation');
insert into wos.usage_receipts (id, agent_run_id, lease_id, lease_generation, account_id, provider, model_id_requested, reasoning_requested, verification_level,
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, usage_event_count, oracle_version, acu_micro, run_policy_snapshot_sha256, body, receipt_sha256)
values ('00000000-0000-0000-0000-0000000ad001', '00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000000c1', 1, '00000000-0000-0000-0000-00000000000b',
        'claude_cli', 'claude-fable-5-1', 'max', 'ATTESTED', 1000, 5000, 0, 200, 50, 2, 'oracle.v1', 12000, 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('6', 64));
insert into wos.usage_event_ids (id_sha256, usage_receipt_id) values ('sha256:' || repeat('f', 64), '00000000-0000-0000-0000-0000000ad001');
select wos_test.expect_error($$insert into wos.usage_event_ids (id_sha256, usage_receipt_id) values ('sha256:' || repeat('f', 64), '00000000-0000-0000-0000-0000000ad001')$$,
  'a replayed provider response id');

-- wallets: one account per wallet per cluster; the signed message names both
insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
values ('00000000-0000-0000-0000-00000000000a', 'devnet', 'So11111111111111111111111111111111111111112', 'external', 'bind',
        'wOS wallet binding account: 00000000-0000-0000-0000-00000000000a wallet: So11111111111111111111111111111111111111112', 'sig');
select wos_test.expect_error($$insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
  values ('00000000-0000-0000-0000-00000000000b', 'devnet', 'So11111111111111111111111111111111111111112', 'external', 'bind',
          'wOS wallet binding account: 00000000-0000-0000-0000-00000000000b wallet: So11111111111111111111111111111111111111112', 'sig')$$,
  'binding a wallet held by another account', 'another account');

-- optimistic payouts: an epoch in PROPOSED (fixture transitions are backdated with the check trigger disabled)
insert into wos.work_dedup_keys (dedup_key, source) values ('work:waronsaas/product:contacts#03', 'receipt');
insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, attested_acu_micro, cap_acu_micro, lowest_verification, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
values ('00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-00000000000a', 'IMPLEMENTATION', 'execution', 'attested_usage', 'pr_merged',
        'independent', 'ACTIVE', 9000000, 9000000, 12000000, 'ATTESTED', 'attempt', gen_random_uuid(),
        'work:waronsaas/product:contacts#03', 2, '{"feature": "contacts"}', 'sha256:' || repeat('b', 64), now());
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, max_items_per_dispute)
values (3, 'test', 'devnet', now() - interval '12 days', now() - interval '5 days', 48, 48, '{}', 2);
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values
  (3, 1, null, 'OPEN', 'system', now() - interval '12 days'),
  (3, 2, 'OPEN', 'CALCULATING', 'system', now() - interval '4 days');
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.allocations (id, epoch_number, account_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256) values
  ('00000000-0000-0000-0000-0000000a1001', 3, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'execution', 3000000, 300000000, '{}', 'sha256:' || repeat('1', 64)),
  ('00000000-0000-0000-0000-0000000a1002', 3, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000cc002', 'execution', 9000000, 900000000, '{}', 'sha256:' || repeat('2', 64));
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at) values
  (3, 3, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64), now() - interval '1 hour');
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
select wos_test.expect_error($$insert into wos.allocations (id, epoch_number, account_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
  values (gen_random_uuid(), 3, '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000cc002', 'planning', 1, 1, '{}', 'sha256:' || repeat('1', 64))$$,
  'an allocation added after publication', 'CALCULATING');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (3, 'PROPOSED', 'FINALIZED', 'system')$$,
  'finalizing inside the challenge window', 'challenge window');
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (3, '00000000-0000-0000-0000-00000000000c', 0, '{}')$$, 'a non-participant disputing', 'only participants');
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (3, '00000000-0000-0000-0000-00000000000b', 400000000, '{}')$$, 'a stake above the disputer''s pending allocation', 'stake');
insert into wos.allocation_disputes (id, epoch_number, disputer_account_id, stake_base, note_untrusted, body)
values ('00000000-0000-0000-0000-0000000d1001', 3, '00000000-0000-0000-0000-00000000000b', 6000000, 'usage is 3x peers for a size-2 unit', '{}');
select wos_test.expect_error($$insert into wos.dispute_items (dispute_id, allocation_id, reason, evidence)
  values ('00000000-0000-0000-0000-0000000d1001', '00000000-0000-0000-0000-0000000a1001', 'other', '[]')$$, 'disputing one''s own allocation', 'own allocation');
insert into wos.dispute_items (dispute_id, allocation_id, reason, evidence)
values ('00000000-0000-0000-0000-0000000d1001', '00000000-0000-0000-0000-0000000a1002', 'inflated_usage', '[{"kind": "anomaly_metric", "ref": "rank 1", "note": "3x peer P50"}]');
do $$ begin
  if not exists (select 1 from wos.dispute_gates where allocation_id = '00000000-0000-0000-0000-0000000a1002'
                   and first_dispute_id = '00000000-0000-0000-0000-0000000d1001') then
    raise exception 'the first dispute opens the allocation''s gate';
  end if;
  raise notice 'ok: dispute opened a gate with bounty priority';
end $$;
select wos_test.expect_error($$insert into wos.dispute_replies (allocation_id, account_id, body_untrusted)
  values ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-00000000000b', 'not mine to answer')$$, 'a reply by someone other than the accused', 'accused');
insert into wos.dispute_replies (allocation_id, account_id, body_untrusted)
values ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-00000000000a', 'three repair loops: the CI matrix failed twice on WebKit');
select wos_test.expect_error($$insert into wos.dispute_item_resolutions (allocation_id, outcome, admin_action_id, resulting_amount_base, excess_base)
  values ('00000000-0000-0000-0000-0000000a1002', 'CLIPPED', '00000000-0000-0000-0000-0000000aa001', 500000000, 100000000)$$,
  'a resolution whose amounts do not add up', 'must equal');
insert into wos.dispute_item_resolutions (allocation_id, outcome, admin_action_id, resulting_amount_base, excess_base)
values ('00000000-0000-0000-0000-0000000a1002', 'CLIPPED', '00000000-0000-0000-0000-0000000aa001', 600000000, 300000000);
select wos_test.expect_error($$insert into wos.dispute_settlements (dispute_id, total_excess_base, bounty_base, stake_forfeited_base, settled_in_epoch)
  values ('00000000-0000-0000-0000-0000000d1001', 300000000, 60000000, 6000000, 3)$$, 'forfeiting the stake of a dispute that clipped something');
insert into wos.dispute_settlements (dispute_id, total_excess_base, bounty_base, stake_forfeited_base, settled_in_epoch)
values ('00000000-0000-0000-0000-0000000d1001', 300000000, 60000000, 0, 3);

-- policy activations are forward-only
insert into wos.policy_documents (kind, version, body, sha256) values ('reward', 'reward-policy.v2', '{}', 'sha256:' || repeat('1', 64));
select wos_test.expect_error($$insert into wos.policy_activations (kind, version, effective_epoch, preview_sha256, admin_action_id)
  values ('reward', 'reward-policy.v2', 2, 'sha256:' || repeat('2', 64), '00000000-0000-0000-0000-0000000aa001')$$,
  'a policy change applied to the open epoch', 'next epoch');
select wos_test.expect_error($$insert into wos.policy_activations (kind, version, effective_epoch, emergency, admin_action_id)
  values ('reward', 'reward-policy.v2', 3, true, '00000000-0000-0000-0000-0000000aa001')$$,
  'an emergency change on published allocations', 'published');
insert into wos.policy_activations (kind, version, effective_epoch, preview_sha256, admin_action_id)
values ('reward', 'reward-policy.v2', 10, 'sha256:' || repeat('2', 64), '00000000-0000-0000-0000-0000000aa001');

-- organizations (D38): org-mates are related accounts for every independence rule
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
  if not wos.related_accounts('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c') then
    raise exception 'org-mates must be related accounts';
  end if;
  raise notice 'ok: sponsorship links make org-mates related';
end $$;
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('audit', 'receipt', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000c', 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat('0', 64))$$,
  'a human review of an org-mate''s receipt', 'related accounts');

-- off-ramp: an emergency pause always expires (<= 14 days); price is never a trigger (no such trigger value exists)
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, admin_action_id)
  values ('pause', 'paused_accrual', 'security_incident', '00000000-0000-0000-0000-0000000aa001')$$, 'a pause without an expiry');
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, expires_at, admin_action_id)
  values ('pause', 'paused_accrual', 'price_fell', now() + interval '1 day', '00000000-0000-0000-0000-0000000aa001')$$, 'a price-based trigger');
insert into wos.settlement_adapter_events (action, adapter, trigger_kind, expires_at, admin_action_id)
values ('pause', 'paused_accrual', 'security_incident', now() + interval '7 days', '00000000-0000-0000-0000-0000000aa001');

-- RLS: canaries and abuse signals are private; the app role cannot rewrite protocol records
insert into wos.abuse_signals (kind, severity, subject_kind, subject_id, detector, detector_version, evidence)
values ('payout_canary_passed', 'high', 'account', 'x', 'canary', 'v1', '{}');
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if exists (select 1 from wos.abuse_signals) then raise exception 'abuse signals leaked to a contributor'; end if;
  if not exists (select 1 from wos.contribution_receipts) then raise exception 'receipts are public'; end if;
  raise notice 'ok: abuse signals private, receipts public';
end $$;
select wos_test.expect_error($$update wos.contribution_receipts set weight_micro = 1$$, 'app role updating a receipt');
select wos_test.expect_error($$insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
  values (9, 'live', 'devnet', now(), now() + interval '1 day', 72, 48, '{}')$$, 'a contributor creating an epoch');
reset role;

\echo 'all db assertions passed'

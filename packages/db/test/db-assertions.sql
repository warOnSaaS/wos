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
-- 0007 (DRAFT v5, D51 engine-first) Proof of Contribution — the HARD INVARIANTS kept in SQL (migration section I).
-- Every Astra review 02/03 repro and D49 rule is rejected either here (label names the repro) or by the rule the service
-- must call before writing (packages/contracts/test/protocol-rules.test.ts); REVIEW-PACKET §3e maps each one.
-- Fixtures for rows that are not under test are written with triggers off (session_replication_role = replica).
-- ============================================================================================
insert into wos.account_roles (account_id, role) values ('00000000-0000-0000-0000-00000000000a', 'maintainer');
create or replace function wos_test.aa(act text, tkind text, tid text, pl jsonb default '{}') returns uuid
language plpgsql as $$
declare
  i uuid := gen_random_uuid();
begin
  insert into wos.admin_actions (id, actor_account_id, action, target_kind, target_id, reason, payload, previous_state, resulting_state, co_signer_account_id)
  values (i, '00000000-0000-0000-0000-00000000000c', act, tkind, tid, 'db assertion fixture for ' || act, pl, '{}', '{}',
          case when wos.two_person_action(act) then '00000000-0000-0000-0000-00000000000a'::uuid end);
  return i;
end $$;

-- Deferred (commit-time) invariants are checked with constraints set IMMEDIATE inside a savepoint.
create or replace function wos_test.over(stmt text, label text, pattern text default null) returns void
language plpgsql as $$
begin
  set constraints all immediate;
  begin
    execute stmt;
    raise exception 'EXPECTED FAILURE did not happen: %', label;
  exception when check_violation then
    if pattern is not null and sqlerrm !~ pattern then raise exception 'REJECTED FOR THE WRONG REASON: % (got: %)', label, sqlerrm; end if;
    raise notice 'ok (rejected): %', label;
  end;
  set constraints all deferred;
end $$;

-- A typed status observation (review 04 finding 8): a history search for one signature on devnet that found nothing.
create or replace function wos_test.obs(sig text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('signature', sig, 'cluster', 'devnet', 'searchTransactionHistory', true, 'observedBlockHeight', 0, 'value', jsonb_build_array(null))
$$;

-- I3 admin actions (H12): maintainer actor, two-person derived from the kind, bootstrap only in bootstrap, hash chain.
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer)
  values ('00000000-0000-0000-0000-00000000000b', 'hold_receipt', 'receipt', 'x', 'bob is not a maintainer at all here', '{}', '{}', false)$$,
  'H12: admin action by a non-maintainer', 'non-maintainer');
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state, requires_co_signer)
  values ('00000000-0000-0000-0000-00000000000c', 'invalidate_receipt', 'receipt', 'x', 'claiming no co-signer is needed does not work', '{}', '{}', false)$$,
  'H12: two-person action labelled one-person by the caller', 'second maintainer');
select wos_test.expect_error($$insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, previous_state, resulting_state)
  values ('00000000-0000-0000-0000-00000000000c', 'bootstrap_merge', 'attempt', 'x', 'merging my own work under bootstrap authority', '{}', '{}')$$,
  'bootstrap_merge outside bootstrap mode', 'outside bootstrap');
select wos_test.aa('start_test_epochs', 'platform', 'epochs');
select wos_test.expect_error($$update wos.admin_actions set reason = 'rewritten history is not allowed'$$, 'I1: admin actions are append-only');
-- I4: one action, one mutation (the service records each use; a second use fails on the key).
select set_config('wos_test.aid', wos_test.aa('record_offset', 'beneficiary', 'x', '{"amount_base": 1}')::text, false);
insert into wos.admin_action_uses (admin_action_id, consumer) values (current_setting('wos_test.aid')::uuid, 'beneficiary/x');
select wos_test.expect_error($$insert into wos.admin_action_uses (admin_action_id, consumer) values (current_setting('wos_test.aid')::uuid, 'beneficiary/x')$$,
  'A3-7 repro: one admin action used for a second mutation', 'duplicate key');
do $$ begin
  if (select min(entry_no) from wos.admin_actions) <> 1 or exists (select 1 from wos.admin_actions where operation_sha256 !~ '^sha256:') then
    raise exception 'admin actions chain from 1 and carry their operation hash';
  end if;
  raise notice 'ok: admin actions are chained with operation hashes';
end $$;
-- I5 lease generation fencing.
select wos_test.expect_error($$update wos.leases set generation = generation + 1$$, 'H7: lease generation is immutable', 'immutable');

-- I7 serialized epoch publication (H6)
select wos_test.expect_error($$insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
  values (90, 'test', 'mainnet-beta', now(), now() + interval '7 days', 48, 48, '{}')$$, 'H7: a test epoch on mainnet');
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base,
  reserve_snapshot_base, demand_forecast_acu_micro) values
  (1, 'test', 'devnet', now() - interval '8 days', now() - interval '1 day', 48, 48, '{}', 100000000, 1000000000000, 20000000000000, 0),
  (2, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{}', 100000000, 1000000000000, 20000000000000, 0),
  (8, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{}', 100000000, 500000000, 10000000000, 0),
  (99001, 'test', 'devnet', now(), now() + interval '7 days', 48, 48, '{}', null, null, null, null);
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (99001, null, 'FINALIZED', 'system')$$,
  'repro A: skipping every epoch window (H6)', 'not allowed');
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, null, 'OPEN', 'system'), (2, null, 'OPEN', 'system'), (8, null, 'OPEN', 'system');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'PROPOSED', 'system')$$, 'H6: skipping CALCULATING', 'not allowed');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (2, 'OPEN', 'CALCULATING', 'system')$$, 'H6: closing before the end', 'not allowed');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'CALCULATING', 'maintainer')$$,
  'H6: a maintainer transition without its admin action');
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (1, 'OPEN', 'CALCULATING', 'system');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor, receipts_root, allocations_root, result_sha256)
  values (1, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64))$$,
  'H6: proposing inside the risk review window', 'not allowed');

-- Fixtures: dave and eve (unrelated to everyone), tasks, a document author changeset, an attempt, epoch 3 CALCULATING.
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
    ('00000000-0000-0000-0007-0000000000f8', 'roadmap_review', 'leased', 'roadmap_reviewer_astra', 'astra', true, '00000000-0000-0000-0007-0000000000e3', null),
    ('00000000-0000-0000-0007-0000000000fa', 'roadmap_author', 'open', 'roadmap_author', null, true, null, null),
    ('00000000-0000-0000-0007-000000000fb1', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab3'),
    ('00000000-0000-0000-0007-000000000fb2', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab4'),
    ('00000000-0000-0000-0007-000000000fb3', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab5'),
    ('00000000-0000-0000-0007-000000000fb4', 'abu_build', 'open', 'builder', null, false, null, '00000000-0000-0000-0000-000000000ab6')
  ) as v(id, kind, state, role, slot, doc, round, abu) where t.slug = 'salesforce';
update wos.rounds set state = 'cancelled' where id = '00000000-0000-0000-0000-0000000000e2';
insert into wos.rounds (id, subject_kind, document_id, round_number, head_sha, submission_sha256, state)
values ('00000000-0000-0000-0007-0000000000e3', 'roadmap', '00000000-0000-0000-0000-0000000000d1', 13, repeat('d', 40), 'sha256:' || repeat('7', 64), 'awaiting_reviews');
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, issued_at, expires_at, hard_deadline_at, ended_at, generation) values
  ('00000000-0000-0000-0007-0000000000c3', '00000000-0000-0000-0007-0000000000f3', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db', 'completed', '{}', now() - interval '3 hours', now() - interval '1 hour', now() + interval '1 hour', now() - interval '10 minutes', 1),
  ('00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0007-0000000000f8', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', 'active', '{}', now(), now() + interval '30 minutes', now() + interval '3 hours', null, 1);
insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256) values
  ('00000000-0000-0000-0007-0000000000a8', '00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0007-0000000000f8', '00000000-0000-0000-0000-00000000000a', 'roadmap_reviewer_astra', 'gpt-6-astra', 'max', 'ctx-1', '{}', 'sha256:' || repeat('8', 64));
insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid) values
  ('00000000-0000-0000-0007-00000000e0a8', '00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0007-0000000000a8', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', '{"provider": "codex_cli"}', true);
insert into wos.changesets (id, lease_id, task_id, account_id, device_id, parent_sha, manifest_sha256, submission_sha256, signature_valid, file_manifest, total_bytes, validation, ok, summary, created_at)
values ('00000000-0000-0000-0000-000000c5c001', '00000000-0000-0000-0007-0000000000c3', '00000000-0000-0000-0007-0000000000f3', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000db',
        repeat('0', 40), 'sha256:' || repeat('0', 64), 'sha256:' || repeat('9', 64), true, '[]', 1, '{}', true, '{}', now() - interval '30 minutes');
set session_replication_role = origin;

-- I5 (D49): budgets fixed before any lease; the proposer never takes the lease; I8 capacity and objective caps at commit.
insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values
  ('00000000-0000-0000-0007-0000000000b1', 'planning_deliverable', 'salesforce roadmap v1', 10000000, 'budget-model.v1'),
  ('00000000-0000-0000-0007-0000000000b2', 'feature_criterion', 'contacts: create and edit', 10000000, 'budget-model.v1');
create or replace function wos_test.budget(task uuid, obj text, b bigint, epoch int) returns void
language sql as $$
  insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
  values (task, ('00000000-0000-0000-0007-0000000000' || obj)::uuid, 'execution', b, b, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000c', epoch)
$$;
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
values ('00000000-0000-0000-0007-0000000000fa', '00000000-0000-0000-0007-0000000000b1', 'planning', 3000000, 3000000, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000c', 2);
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-0000000000f3', 'b1', 3000000, 2)$$,
  'D49: a budget set after work started (the task already has a lease)', 'before work starts');
select wos_test.budget('00000000-0000-0000-0007-000000000fb1', 'b2', 6000000, 2);
select wos_test.budget('00000000-0000-0000-0007-000000000fb2', 'b2', 4000000, 2);
select wos_test.over($$select wos_test.budget('00000000-0000-0000-0007-000000000fb3', 'b2', 1000000, 2)$$,
  'D49: task budgets under one objective exceeding it (splitting / stacking)', 'objective');
select wos_test.over($$select wos_test.budget('00000000-0000-0000-0007-000000000fb3', 'b1', 6000000, 8)$$,
  'D49: issuing beyond the epoch''s task capacity (reservation at issuance, never scaled)', 'capacity is exhausted');
select wos_test.expect_error($$select wos_test.budget('00000000-0000-0000-0007-000000000fb3', 'b1', 1000000, 99001)$$,
  'D49: issuing in an epoch without a pinned issuance rate', 'pinned issuance rate');
select wos_test.expect_error($$insert into wos.leases (task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
  values ('00000000-0000-0000-0007-000000000fb1', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000dc', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours')$$,
  'D49: the proposer of a budget taking its lease', 'proposer');
select wos_test.expect_error($$update wos.task_budgets set budget_acu_micro = 1$$, 'D49: budgets are immutable', 'append-only');
do $$ begin
  if (select reserved_base || '/' || expires_epoch from wos.task_budgets where task_id = '00000000-0000-0000-0007-000000000fb1') <> '600000000/6' then
    raise exception 'the server pins the reservation and the expiry of a budget';
  end if;
  raise notice 'ok: reservation and expiry are server-pinned';
end $$;

-- Receipts: dedup keys shared with Genesis, budget-paid receipts with declared shares summing to 10000 at commit (I8).
insert into wos.publication_consents (account_id, disclosure_version, disclosure_sha256) values
  ('00000000-0000-0000-0000-00000000000a', 'disclosure.v1', 'sha256:' || repeat('d', 64)), ('00000000-0000-0000-0000-00000000000b', 'disclosure.v1', 'sha256:' || repeat('d', 64)),
  ('00000000-0000-0000-0000-00000000000d', 'disclosure.v1', 'sha256:' || repeat('d', 64));
insert into wos.work_dedup_keys (dedup_key, source) values
  ('work:contacts#01', 'receipt'), ('work:proposal#01', 'receipt'), ('work:wos:ledger#01', 'genesis'),
  ('work:fb1:dave', 'receipt'), ('work:fb1:alice', 'receipt'), ('work:fb1:bob', 'receipt');
create or replace function wos_test.receipt(rid uuid, acct uuid, ctype text, slc text, ev text, wt bigint, task uuid, share int, dkey text, epoch int) returns void
language sql as $$
  insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
    weight_micro, task_id, share_bp, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values (rid, acct, ctype, slc, ev, 'document_merged', 'independent', 'ACTIVE', wt, task, share, 'proposal', gen_random_uuid(), dkey, epoch,
          '{"feature": "contacts"}', 'sha256:' || md5(rid::text) || md5(dkey), now())
$$;
select wos_test.receipt('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000000b', 'APPLICATION_ROADMAP', 'planning', 'accepted_budget', 3000000,
  '00000000-0000-0000-0007-0000000000fa', 10000, 'work:contacts#01', 2);
select wos_test.receipt('00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-00000000000a', 'PROPOSAL', 'outcomes', 'outcome', 10000000, null, null, 'work:proposal#01', 2);
select wos_test.expect_error($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
  null, null, 'work:fb1:bob', 2)$$, 'D49: a budget-paid receipt without its task', 'check constraint');
do $$ begin
  set constraints wos.contribution_receipts_conservation immediate;
  begin
    perform wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000d', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
      '00000000-0000-0000-0007-000000000fb1', 6000, 'work:fb1:dave', 2);
    raise exception 'EXPECTED FAILURE did not happen: D49: declared shares of a task summing to less than 10000 bp';
  exception when check_violation then raise notice 'ok (rejected): D49: declared shares of a task summing to less than 10000 bp';
  end;
end $$;
do $$ begin
  perform wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000d', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
    '00000000-0000-0000-0007-000000000fb1', 6000, 'work:fb1:dave', 2);
  perform wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
    '00000000-0000-0000-0007-000000000fb1', 4000, 'work:fb1:alice', 2);
  raise notice 'ok: two collaborators accept one task at 60/40';
end $$;
select wos_test.over($$select wos_test.receipt(gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 6000000,
  '00000000-0000-0000-0007-000000000fb1', 1, 'work:fb1:bob', 2)$$, 'D49: a third share on a fully declared task (reward stacking)', '10000');
select wos_test.over($$insert into wos.task_budget_releases (task_id, reason) values ('00000000-0000-0000-0007-000000000fb1', 'cancelled')$$,
  'D49: releasing the budget of an accepted task', 'was accepted');
select wos_test.expect_error($$insert into wos.work_dedup_keys (dedup_key, source) values ('work:contacts#01', 'genesis')$$, 'D10: Genesis credit for work that has a receipt');
select wos_test.expect_error($$update wos.contribution_receipts set weight_micro = 1$$, 'I1: receipts are immutable');
select wos_test.expect_error($$insert into wos.receipt_status_events (receipt_id, seq, from_status, to_status, kind) values ('00000000-0000-0000-0000-0000000cc001', 1, null, 'ACTIVE', 'issued'),
  ('00000000-0000-0000-0000-0000000cc001', 1, 'ACTIVE', 'REVOKED', 'revoked')$$, 'I4: one status event per sequence number', 'duplicate key');

-- I4: a provider response id is attributed once, across all runs (telemetry integrity).
insert into wos.usage_receipts (id, agent_run_id, lease_id, lease_generation, account_id, provider, model_id_requested, reasoning_requested, verification_level, log_consistent,
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, usage_event_count, oracle_version, acu_micro, run_policy_snapshot_sha256, body, receipt_sha256)
values ('00000000-0000-0000-0000-0000000ad001', '00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000000c1', 1, '00000000-0000-0000-0000-00000000000b',
        'claude_cli', 'claude-fable-5-1', 'max', 'ATTESTED', true, 1000, 5000, 0, 200, 50, 2, 'oracle.v1', 12000, 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('6', 64));
insert into wos.usage_event_ids (id_sha256, usage_receipt_id) values ('sha256:' || repeat('f', 64), '00000000-0000-0000-0000-0000000ad001');
select wos_test.expect_error($$insert into wos.usage_event_ids (id_sha256, usage_receipt_id) values ('sha256:' || repeat('f', 64), '00000000-0000-0000-0000-0000000ad001')$$,
  'a replayed provider response id', 'duplicate key');
select wos_test.expect_error($$insert into wos.usage_receipts (agent_run_id, lease_id, lease_generation, account_id, provider, model_id_requested, reasoning_requested, verification_level, log_consistent,
  input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, usage_event_count, oracle_version, acu_micro, run_policy_snapshot_sha256, body, receipt_sha256)
  values ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-0000000000c1', 1, '00000000-0000-0000-0000-00000000000b', 'claude_cli', 'm', 'max', 'ATTESTED', true,
          1, 0, 0, 1, 0, 1, 'oracle.v1', 1, 'sha256:' || repeat('5', 64), '{}', 'sha256:' || repeat('7', 64))$$, 'one usage receipt per agent run', 'duplicate key');

-- I6 independence and no self-review (H8).
insert into wos.reviewer_qualification_events (account_id, action, domains, level, contribution_types, risk_classes, admin_action_id)
values ('00000000-0000-0000-0000-00000000000c', 'grant', '{general}', 1, '{APPLICATION_ROADMAP}', '{standard}', wos_test.aa('authorize_reviewer', 'account', '00000000-0000-0000-0000-00000000000c')),
       ('00000000-0000-0000-0000-00000000000b', 'grant', '{general}', 1, '{APPLICATION_ROADMAP}', '{standard}', wos_test.aa('authorize_reviewer', 'account', '00000000-0000-0000-0000-00000000000b'));
create or replace function wos_test.hr(reviewer uuid, subj uuid, sha text) returns void
language sql as $$
  insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256)
  values ('audit', 'receipt', subj, 'sha256:' || repeat('1', 64), reviewer, 'standard', 'PASS', 'review-policy.v1', '{}', 'sha256:' || repeat(sha, 64))
$$;
select wos_test.expect_error($$select wos_test.hr('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', '8')$$, 'H8: a human reviewing their own receipt', 'own work');

-- Payout audits: set-once quorum outcome (repro B), independent seats (H8).
select wos_test.expect_error($$insert into wos.payout_audit_quorums (receipt_id, purpose, size, review_policy_version, outcome)
  values ('00000000-0000-0000-0000-0000000cc001', 'sampled', 2, 'review-policy.v1', 'ratified')$$, 'repro B: a quorum inserted already ratified (H7)', 'without an outcome');
insert into wos.payout_audit_quorums (id, receipt_id, purpose, size, review_policy_version) values
  ('00000000-0000-0000-0000-0000000ae001', '00000000-0000-0000-0000-0000000cc001', 'sampled', 2, 'review-policy.v1');
update wos.payout_audit_quorums set outcome = 'findings' where id = '00000000-0000-0000-0000-0000000ae001';
select wos_test.expect_error($$update wos.payout_audit_quorums set outcome = 'ratified' where id = '00000000-0000-0000-0000-0000000ae001'$$,
  'H11: a quorum outcome changed after it was set', 'set once');
-- Audit tasks and leases per auditor (fixtures, FKs only).
set session_replication_role = replica;
insert into wos.tasks (id, kind, state, role) select ('00000000-0000-0000-0007-000000000a' || n)::uuid, 'payout_audit', 'leased', 'payout_auditor' from unnest(array['b1', 'c1', 'd1', 'd2']) n;
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at, generation)
select ('00000000-0000-0000-0007-000000000c' || n)::uuid, ('00000000-0000-0000-0007-000000000a' || n)::uuid, ('00000000-0000-0000-0000-00000000000' || left(n, 1))::uuid,
       '00000000-0000-0000-0000-0000000000db', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours', 1 from unnest(array['b1', 'c1', 'd1', 'd2']) n;
set session_replication_role = origin;
create or replace function wos_test.assign(qid uuid, slot int, who text) returns void
language sql as $$
  insert into wos.payout_audit_assignments (quorum_id, slot, outside_feature, packet_sha256, reviewer_account_id, task_id, lease_id, lease_generation, permitted_provider, review_policy_version)
  values (qid, slot, false, 'sha256:' || repeat('a', 64), ('00000000-0000-0000-0000-00000000000' || left(who, 1))::uuid,
          ('00000000-0000-0000-0007-000000000a' || who)::uuid, ('00000000-0000-0000-0007-000000000c' || who)::uuid, 1, 'claude_cli', 'review-policy.v1')
$$;
insert into wos.payout_audit_quorums (id, receipt_id, purpose, size, review_policy_version) values
  ('00000000-0000-0000-0000-0000000ae002', '00000000-0000-0000-0000-0000000cc001', 'sampled', 2, 'review-policy.v1');
select wos_test.expect_error($$select wos_test.assign('00000000-0000-0000-0000-0000000ae002', 1, 'b1')$$,
  'H8: the contributor auditing their own receipt', 'may not audit');

-- I7: allocations only while CALCULATING (repro C: nothing lands after publication); entitlements only from FINALIZED.
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
values (3, 'test', 'devnet', now() - interval '12 days', now() - interval '5 days', 48, 48, '{}');
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values
  (3, 1, null, 'OPEN', 'system', now() - interval '12 days'), (3, 2, 'OPEN', 'CALCULATING', 'system', now() - interval '4 days');
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.epoch_manifest_entries (epoch_number, mode, receipt_id, receipt_sha256, disposition, deferral_count) values
  (3, 'test', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('c', 64), 'included', 0),
  (3, 'test', '00000000-0000-0000-0000-0000000cc002', 'sha256:' || repeat('c', 64), 'included', 0);
select wos_test.expect_error($$insert into wos.epoch_manifest_entries (epoch_number, mode, receipt_id, receipt_sha256, disposition, deferral_count)
  values (3, 'live', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('c', 64), 'included', 0),
         (3, 'live', '00000000-0000-0000-0000-0000000cc001', 'sha256:' || repeat('c', 64), 'included', 0)$$, 'H2: a receipt in the manifest twice', 'duplicate key');
create or replace function wos_test.alloc(aid uuid, epoch int, acct uuid, rid uuid, slc text, amt bigint) returns void
language sql as $$
  insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
  values (aid, epoch, 'test', acct, 'person', acct, rid, slc, 1, amt, '{}', 'sha256:' || repeat('1', 64))
$$;
select wos_test.expect_error($$select wos_test.alloc(gen_random_uuid(), 2, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 1)$$,
  'H2: an allocation while the epoch is OPEN', 'CALCULATING');
do $$ begin
  set constraints wos.allocations_conservation immediate;
  begin
    perform wos_test.alloc(gen_random_uuid(), 3, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 300000001);
    raise exception 'EXPECTED FAILURE did not happen: D49: allocating more than the task''s reserved budget';
  exception when check_violation then raise notice 'ok (rejected): D49: allocating more than the task''s reserved budget';
  end;
end $$;
select wos_test.alloc('00000000-0000-0000-0000-0000000a1001', 3, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 300000000);
select wos_test.alloc('00000000-0000-0000-0000-0000000a1002', 3, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000cc002', 'outcomes', 900000000);
select wos_test.expect_error($$select wos_test.alloc(gen_random_uuid(), 3, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 'planning', 1)$$,
  'H2: the same receipt, slice and beneficiary allocated twice', 'duplicate key');
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at) values
  (3, 3, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64), now() - interval '1 hour');
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
select wos_test.expect_error($$select wos_test.alloc(gen_random_uuid(), 3, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000cc002', 'planning', 1)$$,
  'repro C / H2: an allocation added after publication', 'CALCULATING');
select wos_test.expect_error($$insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (3, 'PROPOSED', 'FINALIZED', 'system')$$,
  'H6: finalizing inside the challenge window', 'not allowed');

-- Disputes: positive stakes, frozen bundles (H10, repro E), stakes within pending at commit (A3-3 repro), set-once gates.
select wos_test.expect_error($$insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body)
  values (3, '00000000-0000-0000-0000-00000000000b', 0, '{}')$$, 'repro E: a zero-stake dispute (H10)', 'check constraint');
insert into wos.allocation_disputes (id, epoch_number, disputer_account_id, stake_base, body)
values ('00000000-0000-0000-0000-0000000d1001', 3, '00000000-0000-0000-0000-00000000000b', 6000000, '{}');
insert into wos.dispute_items (dispute_id, allocation_id, reason, evidence, stake_base)
select '00000000-0000-0000-0000-0000000d1001', '00000000-0000-0000-0000-0000000a1002', 'budget_mismatch', '[]', 6000000
  from wos.allocation_disputes where id = '00000000-0000-0000-0000-0000000d1001' and false;  -- (a later transaction, below)
select wos_test.expect_error($$insert into wos.dispute_items (dispute_id, allocation_id, reason, evidence, stake_base)
  values ('00000000-0000-0000-0000-0000000d1001', '00000000-0000-0000-0000-0000000a1002', 'budget_mismatch', '[]', 6000000)$$,
  'repro E / H10: appending an item after the dispute was opened', 'frozen bundle');
do $$ begin
  set constraints wos.allocation_disputes_conservation immediate;
  begin
    insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body) values (3, '00000000-0000-0000-0000-00000000000b', 295000000, '{}');
    raise exception 'EXPECTED FAILURE did not happen: A3-3 repro: stakes of all disputes exceeding the pending allocation';
  exception when check_violation then raise notice 'ok (rejected): A3-3 repro: stakes of all disputes exceeding the pending allocation';
  end;
end $$;
insert into wos.dispute_gates (allocation_id, priority_dispute_id, reply_deadline_at) values ('00000000-0000-0000-0000-0000000a1002', null, now());
update wos.dispute_gates set priority_dispute_id = '00000000-0000-0000-0000-0000000d1001' where allocation_id = '00000000-0000-0000-0000-0000000a1002';
select wos_test.expect_error($$update wos.dispute_gates set priority_dispute_id = null where allocation_id = '00000000-0000-0000-0000-0000000a1002'$$,
  'D43: a gate''s bounty priority taken twice', 'set once');
insert into wos.dispute_replies (allocation_id, account_id, body_untrusted, created_at)
values ('00000000-0000-0000-0000-0000000a1002', '00000000-0000-0000-0000-00000000000a', 'three repair loops: the CI matrix failed twice on WebKit', now() - interval '10 years');
do $$ begin
  if (select created_at from wos.dispute_replies limit 1) < now() - interval '1 minute' then raise exception 'reply times are server-stamped (H6)'; end if;
  raise notice 'ok: I2 server time (a backdated reply is stamped now)';
end $$;
insert into wos.dispute_settlements (dispute_id, total_excess_base, recovered_base, bounty_base, stake_forfeited_base, settled_in_epoch)
values ('00000000-0000-0000-0000-0000000d1001', 300000000, 300000000, 60000000, 0, 3);

-- Entitlements (A3-1, A3-2, A3-4): one per (source, kind); nothing over-consumed at commit.
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1001', 150000000)$$, 'H2: an entitlement before FINALIZED', 'FINALIZED');
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values (3, 4, 'PROPOSED', 'FINALIZED', 'system', now());
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, matures_epoch) values
  ('00000000-0000-0000-0000-00000000e001', 3, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1001', 150000000, null),
  ('00000000-0000-0000-0000-00000000e002', 3, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_tranche', 'allocation', '00000000-0000-0000-0000-0000000a1001', 150000000, 9),
  ('00000000-0000-0000-0000-00000000e003', 3, 'person', '00000000-0000-0000-0000-00000000000a', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1002', 300000000, null),
  ('00000000-0000-0000-0000-00000000e005', 3, 'person', '00000000-0000-0000-0000-00000000000b', 'bounty', 'dispute_settlement', '00000000-0000-0000-0000-0000000d1001', 60000000, null);
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1001', 1)$$,
  'A3-1 repro: the same reward entitled twice (one per source and kind)', 'duplicate key');
select wos_test.over($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'withheld_release', 'allocation', '00000000-0000-0000-0000-0000000a1001', 1)$$,
  'A3-1: entitling more than the allocation holds');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'bounty', 'dispute_settlement', '00000000-0000-0000-0000-0000000d1001', 1)$$,
  'A3-1: a second bounty entitlement for one settlement', 'duplicate key');

-- Wallets (repro D, H9) under contributor RLS, leaves to the bound wallet, devnet only.
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000a', false);
insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
values (wos.actor_id(), 'devnet', repeat('2', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('2', 32), repeat('s', 88));
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000b', false);
select wos_test.expect_error($$insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
  values (wos.actor_id(), 'devnet', repeat('2', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('2', 32), repeat('s', 88))$$,
  'repro D: one wallet bound to two accounts under RLS (H9)', 'already bound');
insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
values (wos.actor_id(), 'devnet', repeat('3', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('3', 32), repeat('s', 88));
select wos_test.expect_error($$insert into wos.wallet_bindings (account_id, cluster, wallet, kind, action, message, signature)
  values (wos.actor_id(), 'devnet', repeat('7', 32), 'external', 'bind', wos.actor_id()::text || ' ' || repeat('7', 32), repeat('s', 88))$$,
  'H9: a second wallet for one beneficiary on one cluster', 'already bound');
reset role;
select wos_test.expect_error($$insert into wos.claim_leaves (cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
  values ('devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('2', 32), 150000000, 1, 'sha256:' || repeat('1', 64))$$,
  'H9: a leaf to a wallet bound to someone else', 'bound wallet');
select wos_test.expect_error($$insert into wos.claim_leaves (cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
  values ('mainnet-beta', 'person', '00000000-0000-0000-0000-00000000000b', repeat('5', 32), 150000000, 1, 'sha256:' || repeat('1', 64))$$,
  'A3-1 repro: a mainnet leaf (default-deny at the settlement boundary; also a CHECK)', 'mainnet');
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256) values
  ('00000000-0000-0000-0000-0000000f1001', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 150000000, 1, 'sha256:' || repeat('1', 64)),
  ('00000000-0000-0000-0000-0000000f1002', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 150000000, 1, 'sha256:' || repeat('2', 64)),
  ('00000000-0000-0000-0000-0000000f1003', 'devnet', 'person', '00000000-0000-0000-0000-00000000000a', repeat('2', 32), 290000000, 1, 'sha256:' || repeat('3', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000f1001', 150000000);
select wos_test.over($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000f1002', 150000000)$$,
  'H3 / A3-2: the same entitlement in two live leaves');

-- Settlement finality (H3, A3-9): signed attempts, proven expiry, finalized confirmation, no void of what may pay.
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
values ('00000000-0000-0000-0000-0000000f1001', 1, 1, '\x01', 'sha256:' || repeat('1', 64), 'sig-1-' || repeat('a', 40), 100);
select wos_test.expect_error($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-0000000f1001', 60000000)$$,
  'A3-2: claiming into a leaf that is already signed', 'frozen');
select wos_test.expect_error($$insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
  values ('00000000-0000-0000-0000-0000000f1001', 2, 1, '\x02', 'sha256:' || repeat('2', 64), 'sig-2-' || repeat('a', 40), 200)$$,
  'H3: a second attempt while the first is unresolved', 'unresolved attempt');
select wos_test.expect_error($$insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1001', wos_test.aa('void_leaf', 'leaf', '00000000-0000-0000-0000-0000000f1001'))$$,
  'A3-2: voiding a leaf whose signed attempt may still land', 'may still land');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome) values ('00000000-0000-0000-0000-0000000f1001', 1, 'failed_before_broadcast')$$,
  'A3-9 repro: signed bytes declared failed-before-broadcast', 'check constraint');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
  values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', false, 101, '{}')$$,
  'H3: declaring an attempt expired without a historical search', 'check constraint');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
  values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', true, 100, wos_test.obs('sig-1-' || repeat('a', 40)))$$,
  'A3-9: expiry declared at a block height that has not passed the last valid height', 'block height');
-- Review 04 finding 8: expiry over an observation that shows the transaction finalized, or over {}, is refused.
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
  values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', true, 101,
          wos_test.obs('sig-1-' || repeat('a', 40)) || '{"value": [{"confirmationStatus": "finalized", "err": null, "slot": 5}]}')$$,
  'R04-8 repro: expiry declared over an observation of a finalized transaction', 'found no transaction');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
  values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', true, 101, '{}')$$,
  'R04-8 repro: expiry declared over an empty observation', 'this attempt''s signature');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
  values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', true, 101, wos_test.obs('sig-of-another-attempt'))$$,
  'R04-8: expiry proven by an observation of another signature', 'this attempt''s signature');
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
values ('00000000-0000-0000-0000-0000000f1001', 1, 'expired_not_landed', true, 101, wos_test.obs('sig-1-' || repeat('a', 40)));
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
values ('00000000-0000-0000-0000-0000000f1001', 2, 1, '\x02', 'sha256:' || repeat('2', 64), 'sig-2-' || repeat('a', 40), 200);
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, commitment, slot) values ('00000000-0000-0000-0000-0000000f1001', 2, 'confirmed', 'confirmed', 1)$$,
  'H3: confirming before finalized commitment', 'check constraint');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome) values ('00000000-0000-0000-0000-0000000f1001', 2, 'confirmed')$$,
  'A3-9 repro: confirmed with a NULL commitment', 'check constraint');
select wos_test.expect_error($$insert into wos.settlement_outcomes (leaf_id, attempt, outcome, commitment, history_checked, slot, status_observation)
  values ('00000000-0000-0000-0000-0000000f1001', 2, 'confirmed', 'finalized', true, 1234,
          wos_test.obs('sig-2-' || repeat('a', 40)) || '{"value": [{"confirmationStatus": "finalized", "err": {"InstructionError": [0, "Custom"]}, "slot": 1234}]}')$$,
  'R04-8: a transaction finalized WITH an error recorded as confirmed', 'without error');
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, commitment, history_checked, slot, status_observation) values ('00000000-0000-0000-0000-0000000f1001', 2, 'confirmed', 'finalized', true, 1234,
  wos_test.obs('sig-2-' || repeat('a', 40)) || '{"value": [{"confirmationStatus": "finalized", "err": null, "slot": 1234}]}');
select wos_test.expect_error($$insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
  values ('00000000-0000-0000-0000-0000000f1001', 3, 1, '\x03', 'sha256:' || repeat('3', 64), 'sig-3-' || repeat('a', 40), 300)$$, 'H3: paying a settled leaf again', 'already settled');
select wos_test.expect_error($$insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1001', wos_test.aa('void_leaf', 'leaf', '00000000-0000-0000-0000-0000000f1001'))$$,
  'A3-2 repro: voiding a settled leaf to re-claim its entitlement', 'never voided');

-- Confiscation holds (D39, A3-4): capped at the proven excess and by each source's balance at commit; releases restore.
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at) values
  ('00000000-0000-0000-0000-0000000c0f02', 'person', '00000000-0000-0000-0000-00000000000b', 200000000, 'pattern finding',
   wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0000-0000000c0f02'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours'),
  ('00000000-0000-0000-0000-0000000c0f03', 'person', '00000000-0000-0000-0000-00000000000a', 10000000, 'gate a1002',
   wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0000-0000000c0f03'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
select wos_test.expect_error($$insert into wos.confiscations (beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
  values ('person', '00000000-0000-0000-0000-00000000000b', 1, 'r04-4', wos_test.aa('confiscate', 'confiscation', 'r04-4'), now() + interval '73 hours', now() + interval '10 years', 'infinity')$$,
  'R04-4a repro: a confiscation hold that never lapses', 'check constraint');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values
  ('00000000-0000-0000-0000-0000000c0f02', 'holdback', '00000000-0000-0000-0000-00000000e002', 150000000),
  ('00000000-0000-0000-0000-0000000c0f03', 'unclaimed_entitlement', '00000000-0000-0000-0000-00000000e003', 10000000);
select wos_test.over($$insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base)
  values ('00000000-0000-0000-0000-0000000c0f02', 'unclaimed_entitlement', '00000000-0000-0000-0000-00000000e001', 10)$$,
  'D39: confiscating an entitlement already in a live (settled) leaf: released tokens are never seized');
select wos_test.over($$insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base)
  values ('00000000-0000-0000-0000-0000000c0f02', 'unclaimed_entitlement', '00000000-0000-0000-0000-00000000e005', 50000001)$$,
  'D39: confiscating above the proven excess');
select wos_test.over($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_matured', 'tranche', '00000000-0000-0000-0000-00000000e002', 1)$$,
  'A3-4 repro: maturing a tranche that is fully held');
select wos_test.over($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000f1003', 300000000)$$,
  'A3-4: claiming the held part of an entitlement');
-- A3-4 repro (b): the other 290 stays claimable.
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000f1003', 290000000);
insert into wos.confiscation_releases (confiscation_id, reason) values ('00000000-0000-0000-0000-0000000c0f02', 'overturned');
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
values ('00000000-0000-0000-0000-0000000f1004', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 60000000, 1, 'sha256:' || repeat('4', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-0000000f1004', 60000000);
do $$ begin raise notice 'ok: a released (overturned) hold stops counting; the bounty is claimable'; end $$;

-- ---------------------------------------------------------------------------------- Astra reviews 04 and 05 (fix pass)
-- R04-2: a tranche released in parts around a lifted hold — nothing stranded, nothing over-released (I4 key + I8).
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
values ('00000000-0000-0000-0045-0000000000c2', 'person', '00000000-0000-0000-0000-00000000000b', 10, 'r04-2',
        wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0045-0000000000c2'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('00000000-0000-0000-0045-0000000000c2', 'holdback', '00000000-0000-0000-0000-00000000e002', 10);
insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_matured', 'tranche', '00000000-0000-0000-0000-00000000e002', 149999990, 1);
insert into wos.confiscation_releases (confiscation_id, reason) values ('00000000-0000-0000-0045-0000000000c2', 'overturned');
insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_matured', 'tranche', '00000000-0000-0000-0000-00000000e002', 10, 2);
do $$ begin raise notice 'ok: R04-2 repro: the restored 10 of a tranche matures in a second release after the hold is lifted'; end $$;
select wos_test.over($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_matured', 'tranche', '00000000-0000-0000-0000-00000000e002', 1, 3)$$,
  'R04-2: a third release of a fully released tranche', 'over-consumed');
select wos_test.expect_error($$insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values (3, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0000-0000000a1001', 1, 2)$$,
  'R04-2: only matured and withheld releases come in parts', 'check constraint');
-- R04-4: a confiscation ends once; a lapse is not declared before the hold expires.
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
values ('00000000-0000-0000-0045-0000000000c4', 'person', '00000000-0000-0000-0000-00000000000b', 10, 'r04-4',
        wos_test.aa('confiscate', 'confiscation', '00000000-0000-0000-0045-0000000000c4'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
select wos_test.expect_error($$insert into wos.confiscation_releases (confiscation_id, reason) values ('00000000-0000-0000-0045-0000000000c4', 'lapsed')$$,
  'R04-4b repro: a hold released as lapsed before it expires', 'lapses only at');
insert into wos.confiscation_executions (confiscation_id) values ('00000000-0000-0000-0045-0000000000c4');
select wos_test.expect_error($$insert into wos.confiscation_releases (confiscation_id, reason) values ('00000000-0000-0000-0045-0000000000c4', 'overturned')$$,
  'R04-4b repro: an executed confiscation also released', 'already ended');
-- B1: one objective per canonical work identity; B9: the floor, as the engine.
select wos_test.expect_error($$insert into wos.acceptance_objectives (kind, ref, budget_acu_micro, budget_model_version)
  values ('feature_criterion', 'contacts: create and edit', 10000000, 'budget-model.v1')$$, 'B1b repro: a second objective for the same criterion', 'duplicate key');
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base,
  reserve_snapshot_base, demand_forecast_acu_micro)
values (30, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{}', 500000, 1000000000, 10000000000000, 0);
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (30, null, 'OPEN', 'system');
select wos_test.expect_error($$insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
  values (gen_random_uuid(), '00000000-0000-0000-0007-0000000000b1', 'execution', 1, 1, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000c', 30)$$,
  'B9 repro: a budget that reserves 0 at the rate (1 micro-ACU x 500000 / 1e6 floors to 0, as the engine)', 'reserves nothing');
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
values ('00000000-0000-0000-0045-0000000000f9', '00000000-0000-0000-0007-0000000000b1', 'execution', 3, 3, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000c', 30);
do $$ begin
  if (select reserved_base from wos.task_budgets where task_id = '00000000-0000-0000-0045-0000000000f9') <> 1 then
    raise exception 'B9: 3 micro-ACU x 500000 / 1e6 = 1.5 must floor to 1 (the engine''s budgetToBase)';
  end if;
  raise notice 'ok: B9 cross-language vector: 3 micro-ACU at 500000/ACU reserves 1 in SQL and in the engine';
end $$;
select wos_test.expect_error($$insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base)
  values (32, 'test', 'devnet', now(), now() + interval '7 days', 48, 48, '{}', 100, 100)$$,
  'B3: a pinned rate and capacity without the reserve snapshot and forecast they were computed from', 'check constraint');
-- B6: one human review per assignment.
insert into wos.human_review_assignments (task_id, reviewer_account_id, subject_kind, subject_id, risk_class)
values ('00000000-0000-0000-0045-0000000000f6', '00000000-0000-0000-0000-00000000000d', 'receipt', '00000000-0000-0000-0000-0000000cc002', 'standard');
insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256, assignment_task_id)
values ('audit', 'receipt', '00000000-0000-0000-0000-0000000cc002', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000d', 'standard', 'PASS', 'review-policy.v1', '{}',
        'sha256:' || repeat('4', 64), '00000000-0000-0000-0045-0000000000f6');
select wos_test.expect_error($$insert into wos.human_reviews (purpose, subject_kind, subject_id, context_sha256, reviewer_account_id, risk_class, verdict, review_policy_version, body, review_sha256, assignment_task_id)
  values ('audit', 'receipt', '00000000-0000-0000-0000-0000000cc002', 'sha256:' || repeat('1', 64), '00000000-0000-0000-0000-00000000000d', 'standard', 'PASS', 'review-policy.v1', '{}',
          'sha256:' || repeat('5', 64), '00000000-0000-0000-0045-0000000000f6')$$,
  'B6: a second human review redeeming the same assignment', 'duplicate key');
-- D54: in bootstrap a two-person action is single-signed (labelled in the chain), never blocked on a second person.
do $$
declare
  i uuid;
begin
  begin
    -- (bootstrap ended earlier in this file and is one-way; re-enter it only inside this rolled-back block)
    alter table wos.platform_settings disable trigger platform_settings_bootstrap_one_way;
    update wos.platform_settings set value = '{"enabled": true, "since": null}' where key = 'bootstrap_mode';
    insert into wos.admin_actions (actor_account_id, action, target_kind, target_id, reason, payload, previous_state, resulting_state)
    values ('00000000-0000-0000-0000-00000000000c', 'approve_budget', 'task', 'd54', 'founder alone in bootstrap approves a budget above the model', '{}', '{}', '{}')
    returning id into i;
    if not (select bootstrap_single_signer and not requires_co_signer from wos.admin_actions where id = i) then
      raise exception 'D54: a bootstrap two-person action must be recorded as single-signed';
    end if;
    raise exception 'rollback-d54';
  exception when raise_exception then
    if sqlerrm <> 'rollback-d54' then raise; end if;
  end;
  raise notice 'ok: D54 a two-person action in bootstrap is single-signed and labelled; outside bootstrap it still needs a co-signer';
end $$;

-- Off-ramp (repro G, H3, D46, A3-9): server time and 14-day expiry, the fence, drained snapshots, explicit resumption.
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, admin_action_id, created_at, expires_at)
  values ('pause', 'paused_accrual', 'security_incident', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual'), now() + interval '1 year', now() + interval '1 year 13 days')$$,
  'repro G: a pause expiring a year from now via a future created_at (H6)', '14 days');
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, admin_action_id)
  values ('pause', 'paused_accrual', 'security_incident', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual'))$$, 'D46: a pause without an expiry', 'check constraint');
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, expires_at, admin_action_id)
  values ('pause', 'paused_accrual', 'price_fell', now() + interval '1 day', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual'))$$, 'D35: a price-based trigger', 'check constraint');
select wos_test.expect_error($$insert into wos.migration_snapshots (at_epoch, from_adapter, to_adapter, finalized_slot, body, snapshot_sha256)
  values (3, 'solana_wos', 'in_app_credits', 1, '{}', 'sha256:' || repeat('1', 64))$$, 'H3: a migration snapshot without fencing settlement first', 'pause');
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
values ('00000000-0000-0000-0000-0000000f1003', 1, 1, '\x31', 'sha256:' || repeat('4', 64), 'sig-31-' || repeat('a', 40), 500);
insert into wos.settlement_adapter_events (action, adapter, trigger_kind, expires_at, admin_action_id)
values ('pause', 'paused_accrual', 'security_incident', now() + interval '7 days', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual'));
select wos_test.expect_error($$insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
  values ('00000000-0000-0000-0000-0000000f1004', 1, 1, '\x32', 'sha256:' || repeat('9', 64), 'sig-9-' || repeat('a', 40), 900)$$, 'H3: settling while paused', 'paused');
do $$ begin
  if wos.may_broadcast('00000000-0000-0000-0000-0000000f1003', 1) then raise exception 'the broadcaster is fenced while paused (A3-9)'; end if;
  raise notice 'ok: the broadcaster is fenced while paused';
end $$;
select wos_test.expect_error($$insert into wos.migration_snapshots (at_epoch, from_adapter, to_adapter, finalized_slot, body, snapshot_sha256)
  values (3, 'solana_wos', 'in_app_credits', 1234, '{}', 'sha256:' || repeat('1', 64))$$, 'A3-9: a snapshot with an in-flight signed attempt', 'drain');
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation)
values ('00000000-0000-0000-0000-0000000f1003', 1, 'expired_not_landed', true, 501, wos_test.obs('sig-31-' || repeat('a', 40)));
insert into wos.migration_snapshots (at_epoch, from_adapter, to_adapter, finalized_slot, body, snapshot_sha256)
values (3, 'solana_wos', 'in_app_credits', 1234, '{}', 'sha256:' || repeat('1', 64));
select wos_test.expect_error($$insert into wos.settlement_adapter_events (action, adapter, trigger_kind, admin_action_id)
  values ('resume', 'solana_wos', 'security_incident', wos_test.aa('resume_settlement', 'settlement', 'solana_wos'))$$, 'D46: resuming without a safety confirmation', 'check constraint');
insert into wos.settlement_adapter_events (action, adapter, trigger_kind, safety_confirmation, admin_action_id)
values ('resume', 'solana_wos', 'security_incident', 'incident closed: key rotated, worker patched, reconciled', wos_test.aa('resume_settlement', 'settlement', 'solana_wos'));
insert into wos.leaf_voids (leaf_id, admin_action_id) values ('00000000-0000-0000-0000-0000000f1003', wos_test.aa('void_leaf', 'leaf', '00000000-0000-0000-0000-0000000f1003'));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000f1002', 290000000);
do $$ begin raise notice 'ok: a proven-expired leaf is voided and its entitlement is claimable again, once'; end $$;
select wos_test.expect_error($$insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000f1003', 1)$$,
  'A3-2: claiming into a void leaf', 'frozen');

-- Epoch funding equation (I8) by CHECK.
select wos_test.expect_error($$insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
  values (3, 1000, 900, 0, 0, 0, 101, 0, 0, 'sha256:' || repeat('1', 64))$$, 'H1: an epoch result that breaks the funding equation', 'check constraint');
select wos_test.expect_error($$insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
  values (3, 1000, 1060, 0, 0, 0, -60, 0, 0, 'sha256:' || repeat('1', 64))$$, 'H1: negative issuance', 'check constraint');
select wos_test.expect_error($$insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
  values (3, 1000, 900, 0, 0, 0, 100, 60, 41, 'sha256:' || repeat('1', 64))$$, 'A3-10: holdback + claimable above issuance', 'check constraint');
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
values (3, 1000, 800, 50, 20, 30, 100, 40, 60, 'sha256:' || repeat('1', 64));

-- Pools (H13), organizations and relatedness (H8), duty (M14), retention (M17), Genesis keys (M16).
insert into wos.completion_pools (id, kind, pool_key) values ('00000000-0000-0000-0000-0000000b0001', 'feature', 'salesforce/contacts');
insert into wos.pool_events (pool_id, event, epoch_number, amount_base) values ('00000000-0000-0000-0000-0000000b0001', 'payable', 3, 1), ('00000000-0000-0000-0000-0000000b0001', 'paid', 3, 1);
select wos_test.expect_error($$insert into wos.pool_events (pool_id, event, epoch_number, amount_base) values ('00000000-0000-0000-0000-0000000b0001', 'returned', 3, 1)$$,
  'H13: a pool both paid and returned', 'duplicate key');
do $$
declare
  acme uuid;
begin
  select id into acme from wos.organizations where slug = 'acme';
  insert into wos.sponsorship_links (organization_id, contributor_account_id, approved_by_account_id)
  values (acme, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a'),
         (acme, '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a');
  if not (wos.related_accounts('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c')
          and wos.related_accounts('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')) then
    raise exception 'sponsored accounts and team members must be related';
  end if;
  raise notice 'ok: team members and sponsored contributors are related accounts';
end $$;
select wos_test.expect_error($$select wos_test.hr('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000cc001', '0')$$,
  'H8: a human review of an org-mate''s receipt', 'related');
select wos_test.expect_error($$select wos_test.assign('00000000-0000-0000-0000-0000000ae002', 1, 'c1')$$,
  'H8: a related account auditing the receipt', 'may not audit');
select wos_test.assign('00000000-0000-0000-0000-0000000ae002', 1, 'd1');
select wos_test.expect_error($$select wos_test.assign('00000000-0000-0000-0000-0000000ae002', 2, 'd2')$$,
  'H8: one reviewer (or a related account) in two seats of a quorum', 'two seats');
select wos_test.expect_error($$insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
  head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
  values ('00000000-0000-0000-0007-0000000000e3', '00000000-0000-0000-0007-0000000000f8', '00000000-0000-0000-0007-0000000000c8', '00000000-0000-0000-0000-00000000000a', 1001,
          'astra', 'codex_cli', 'gpt-6-astra', 'max', repeat('d', 40), 'sha256:' || repeat('7', 64), 'NO_MATERIAL_GAPS', '{}', '00000000-0000-0000-0007-0000000000a8', 'independent',
          '00000000-0000-0000-0007-00000000e0a8')$$,
  'A3-6: a document review by an account related to the document''s author', 'author of this subject');
insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind, deadline_at) values ('00000000-0000-0000-0000-0000000d0001', 1, '00000000-0000-0000-0000-00000000000b', 3, 'offered', now() + interval '1 day');
insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind) values ('00000000-0000-0000-0000-0000000d0001', 2, '00000000-0000-0000-0000-00000000000b', 3, 'completed');
select wos_test.expect_error($$insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind) values ('00000000-0000-0000-0000-0000000d0001', 3, '00000000-0000-0000-0000-00000000000b', 3, 'expired_no_fault')$$,
  'M14: ending a duty offer twice', 'duplicate key');
insert into wos.run_log_commitments (agent_run_id, log_sha256, turns, repair_loops, tool_calls, totals_match, body_expires_at)
values ('00000000-0000-0000-0000-00000000e0a1', 'sha256:' || repeat('7', 64), 3, 0, 5, true, now() + interval '365 days');
insert into wos.run_log_bodies (agent_run_id, size_bytes, body) values ('00000000-0000-0000-0000-00000000e0a1', 10, '{}');
select wos_test.expect_error($$delete from wos.run_log_bodies where agent_run_id = '00000000-0000-0000-0000-00000000e0a1'$$, 'M17: deleting a run log body before retention expires', 'retention');
insert into wos.genesis_contributions (id, contributor_account_id, evidence_kind, evidence_refs, evidence_sha256, dedup_key, size_points, genesis_policy_version, body, admin_action_id)
values ('00000000-0000-0000-0000-0000000ae501', '00000000-0000-0000-0000-00000000000c', 'retro_abu', '{waronsaas/wos@abc}', 'sha256:' || repeat('e', 64), 'work:wos:ledger#01', 5, 'genesis-policy.v1', '{}',
        wos_test.aa('record_genesis', 'genesis', 'work:wos:ledger#01'));
insert into wos.genesis_commit_claims (commit_sha, genesis_contribution_id) values (repeat('1', 40), '00000000-0000-0000-0000-0000000ae501');
select wos_test.expect_error($$insert into wos.genesis_commit_claims (commit_sha, genesis_contribution_id) values (repeat('1', 40), '00000000-0000-0000-0000-0000000ae501')$$,
  'M16: one commit credited to two retro units', 'duplicate key');
insert into wos.genesis_reference_manifests (version, cutoff_epoch, rules, receipt_ids, manifest_sha256, admin_action_id)
values ('reference.v1', 2, '{"types": ["PROPOSAL"]}', '{00000000-0000-0000-0000-0000000cc002}', 'sha256:' || repeat('b', 64),
        wos_test.aa('approve_genesis_reference', 'genesis_reference', 'reference.v1', '{"manifest_sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'));
select wos_test.expect_error($$update wos.genesis_reference_manifests set receipt_ids = receipt_ids || '{00000000-0000-0000-0000-0000000cc001}'::uuid[]$$,
  'A3-12: adding to a finalized reference manifest', 'append-only');
select wos_test.expect_error($$insert into wos.genesis_reference_manifests (version, cutoff_epoch, rules, receipt_ids, manifest_sha256, admin_action_id)
  values ('reference.v1', 2, '{}', '{00000000-0000-0000-0000-0000000cc001}', 'sha256:' || repeat('c', 64), wos_test.aa('approve_genesis_reference', 'genesis_reference', 'reference.v1'))$$,
  'A3-12: a second manifest for the same version', 'duplicate key');

-- D58: a disputed finding is never resolved by the lab that raised it; the raising lab is derived from the review.
set session_replication_role = replica;
insert into wos.findings (id, review_id, round_id, document_id, local_id, severity, category, title, detail, state)
values ('00000000-0000-0000-0058-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000d1', 'F-58', 'material', 'scope', 'd58 fixture', 'raised by the Fable seat', 'disputed');
insert into wos.rulings (id, task_id, lease_id, account_id, body, state)
values ('00000000-0000-0000-0058-0000000000a1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-00000000000d', '{}', 'awaiting_maintainer');
set session_replication_role = origin;
select wos_test.expect_error($$insert into wos.ruling_lab_records (ruling_id, finding_id, resolved_by_lab, outcome)
  values ('00000000-0000-0000-0058-0000000000a1', '00000000-0000-0000-0058-0000000000f1', 'anthropic', 'overruled')$$,
  'D58: a Fable-raised finding resolved by a resolver of the same lab', 'same lab');
insert into wos.ruling_lab_records (ruling_id, finding_id, raised_by_lab, resolved_by_lab, outcome)
values ('00000000-0000-0000-0058-0000000000a1', '00000000-0000-0000-0058-0000000000f1', 'openai', 'openai', 'upheld');
do $$ begin
  if (select raised_by_lab from wos.ruling_lab_records where finding_id = '00000000-0000-0000-0058-0000000000f1') <> 'anthropic' then
    raise exception 'D58: the raising lab must be derived from the review (a caller-supplied value is ignored)';
  end if;
  raise notice 'ok: D58 raising lab derived from the review; an other-lab ruling is recorded (raised, resolved, outcome)';
end $$;

-- RLS: canary classification, abuse signals, assignments and the wallet registry are private; approvals are own-session.
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

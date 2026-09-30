-- Migration 0010 (versioned additions after the v1 freeze): D61 invariants B1-B4, the D60 delta H1, D63 Q1.
-- Runs after db-assertions.sql and reuses its fixtures: alice (a) and carol (c) are maintainers; a, bob (b) and c are
-- related (acme team and sponsorships); dave (d) and eve (e) are unrelated to everyone. Bob's receipt ...cc001
-- (qualified now) is the introducing receipt: bob is the introducer, inside the window.
-- 'reward-policy.test-d61' is a TEST fixture carrying only the bug fields the database reads, with a cap of 1 paid report
-- per reporter per epoch so the cap is exercised; it is not a published policy. Epoch 99100 is the one containing now
-- with the highest number (maintainer decisions pin the policy of the epoch they are made in).
\set ON_ERROR_STOP 1
set client_min_messages = notice;
\pset tuples_only on

insert into wos.policy_documents (kind, version, body, sha256) values
  ('reward', 'reward-policy.test-d61',
   '{"bugs": {"introducerWindowDays": 14, "maxBugReportsPaidPerAccountPerEpoch": 1, "introducerOffsetEqualsReportPay": true}, "queue": {"queueBonusBp": 2000}}', 'sha256:' || repeat('6', 64));
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base,
  reserve_snapshot_base, demand_forecast_acu_micro)
values (99100, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{"reward": "reward-policy.test-d61"}', 100000000, 1000000000000, 20000000000000, 0);
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (99100, null, 'OPEN', 'system');
insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values
  ('00000000-0000-0000-0061-0000000000b1', 'feature_criterion', 'd61 fixture: bug triage and fixes', 100000000, 'budget-model.v1');

create or replace function wos_test.b61(task text, epoch int, basis jsonb default '{}') returns void
language sql as $$
  insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
  values (('00000000-0000-0000-0061-00000000' || task)::uuid, '00000000-0000-0000-0061-0000000000b1', 'execution', 1000000, 1000000, basis, 'budget-model.v1',
          '00000000-0000-0000-0000-00000000000c', epoch)
$$;
-- Triage budgets (bug_triage, one bug each; review 09 R09-3): t0 (epoch 30: no bug rules pinned), t1, t3, t5-t9. Fix
-- budgets are commissioned AFTER triage (F1, below). be01 (a release label); be02-be04 (the queue bonus, Q1).
select wos_test.b61('00f0', 30, '{"taskKind": "bug_triage", "bug": "BUG-100"}');
select wos_test.b61('00f' || n, 99100, jsonb_build_object('taskKind', 'bug_triage', 'bug', 'BUG-10' || n)) from unnest(array['1', '3', '5', '6', '7', '8']) n;
select wos_test.b61('00f9', 99100, '{"taskKind": "bug_triage", "bug": "BUG-190"}');
select wos_test.b61(t, 99100) from unnest(array['be01', 'be02', 'be03', 'be04']) t;
select wos_test.expect_error($$select wos_test.b61('0f0a', 99100, '{"taskKind": "bug_triage"}')$$,
  'R09-3: a bug_triage budget commissioned for no bug', 'commissioned for one bug');
-- Tasks and leases (fixtures, inserted without their triggers as in db-assertions): dave holds the triage leases,
-- eve t7's and the fix and queue leases, carol t8's.
set session_replication_role = replica;
insert into wos.tasks (id, kind, state, role, abu_id)
select ('00000000-0000-0000-0061-00000000' || t)::uuid, 'abu_build', 'leased', 'builder', gen_random_uuid()
  from unnest(array['00f0', '00f1', '00f3', '00f5', '00f6', '00f7', '00f8', '00f9', '0f01', '0f03', '0f05', 'be02', 'be03', 'be04']) t;
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at, ended_at, generation)
select ('00000000-0000-0000-0061-0000000' || l)::uuid, ('00000000-0000-0000-0061-00000000' || t)::uuid, ('00000000-0000-0000-0000-00000000000' || a)::uuid,
       ('00000000-0000-0000-0000-0000000000d' || a)::uuid, 'completed', '{}', now() + interval '30 minutes', now() + interval '3 hours', now(), 1
  from (values ('0c0f0', '00f0', 'd'), ('0c0f1', '00f1', 'd'), ('0c0f3', '00f3', 'd'), ('0c0f5', '00f5', 'd'), ('0c0f6', '00f6', 'd'),
               ('0c0f7', '00f7', 'e'), ('0c0f8', '00f8', 'c'), ('0c0f9', '00f9', 'd'), ('0cbe2', 'be02', 'e'), ('0cbe3', 'be03', 'e'),
               ('0cbe5', 'be04', 'e')) as v(l, t, a);
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at, ended_at, generation)
values ('00000000-0000-0000-0061-00000000cbe4', '00000000-0000-0000-0061-00000000be03', '00000000-0000-0000-0000-00000000000d',
        '00000000-0000-0000-0000-0000000000dd', 'completed', '{}', now() + interval '30 minutes', now() + interval '3 hours', now(), 2);
set session_replication_role = origin;
create or replace function wos_test.lease61(l text, t text, a text) returns void
language sql as $$
  insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at, ended_at, generation)
  values (('00000000-0000-0000-0061-0000000' || l)::uuid, ('00000000-0000-0000-0061-00000000' || t)::uuid, ('00000000-0000-0000-0000-00000000000' || a)::uuid,
          ('00000000-0000-0000-0000-0000000000d' || a)::uuid, 'completed', '{}', now() + interval '30 minutes', now() + interval '3 hours', now(), 1)
$$;

create or replace function wos_test.tri(bug text, key text, outcome text, sev text, task text, reporter text, intro uuid default null, dup text default null) returns void
language sql as $$
  insert into wos.bug_triage_decisions (bug_id, bug_key, decision_sha256, outcome, severity, duplicate_of_bug_key, decided_by, triage_task_id, triage_lease_id,
    decider_account_id, reporter_account_id, introducing_receipt_id, introducer_account_id, introduced_within_window)
  values (('00000000-0000-0000-0061-0000000000' || bug)::uuid, key, 'sha256:' || md5(key) || md5(key || 'x'), outcome, sev, dup, 'agent',
          ('00000000-0000-0000-0061-00000000' || task)::uuid, ('00000000-0000-0000-0061-0000000' || replace(task, '00f', '0c0f'))::uuid,
          '00000000-0000-0000-0000-00000000000e', ('00000000-0000-0000-0000-00000000000' || reporter)::uuid, intro,
          '00000000-0000-0000-0000-00000000000e', false)
$$;

-- B1
select wos_test.expect_error($$select wos_test.tri('a0', 'BUG-100', 'fix', 'low', '00f0', 'e')$$,
  'D61 B1: a triage budget pinned to a reward policy without bug rules (v1) fails closed', 'no bug rules');
select wos_test.expect_error($$select wos_test.tri('a7', 'BUG-107', 'fix', 'low', '00f7', 'e')$$,
  'D61 B1: the reporter triaging its own report', 'own report');
select wos_test.expect_error($$select wos_test.tri('a8', 'BUG-108', 'fix', 'high', '00f8', 'e', '00000000-0000-0000-0000-0000000cc001')$$,
  'D61 B1: a relative of the introducer triaging the bug blamed on its receipt', 'introducer');
select wos_test.expect_error($$select wos_test.tri('a1', 'BUG-101', 'fix', null, '00f1', 'e')$$,
  'D61 B1: an acting outcome without a severity', 'check constraint');
select wos_test.expect_error($$select wos_test.tri('a1', 'BUG-101', 'wont_fix', null, '00f1', 'e')$$,
  'D61 B1: an agent deciding wont_fix (a maintainer''s decision)', 'check constraint');
select wos_test.tri('a1', 'BUG-101', 'fix', 'high', '00f1', 'e', '00000000-0000-0000-0000-0000000cc001');
do $$ begin
  if (select decider_account_id::text || '/' || introducer_account_id::text || '/' || introduced_within_window || '/' || window_days || '/' || policy_version
        from wos.bug_triage_decisions where bug_key = 'BUG-101')
     <> '00000000-0000-0000-0000-00000000000d/00000000-0000-0000-0000-00000000000b/true/14/reward-policy.test-d61' then
    raise exception 'D61 B1: decider (the lease holder), introducer, window flag, window and policy are derived, never supplied';
  end if;
  raise notice 'ok: D61 B1: decider, introducer, within-window flag, window and pinned policy are derived by the database';
end $$;
select wos_test.expect_error($$insert into wos.bug_triage_decisions (bug_id, bug_key, decision_sha256, outcome, decided_by, decider_account_id, reporter_account_id)
  values ('00000000-0000-0000-0061-0000000000a9', 'BUG-101', 'sha256:' || repeat('5', 64), 'not_a_bug', 'maintainer', '00000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-00000000000e')$$, 'D61 B1: a second record for one bug', 'duplicate key');
select wos_test.expect_error($$select wos_test.tri('a9', 'BUG-109', 'fix', 'low', '00f9', 'e')$$,
  'R09-3 repro C: a triage decided on a bug_triage budget commissioned for another bug', 'commissioned for this bug');
select wos_test.tri('a3', 'BUG-103', 'not_a_bug', null, '00f3', 'e');
select wos_test.tri('a5', 'BUG-105', 'fix', 'critical', '00f5', 'e');
select wos_test.expect_error($$select wos_test.tri('a6', 'BUG-106', 'duplicate', null, '00f6', 'e', null, 'BUG-103')$$,
  'D61 B1: a duplicate of a bug whose outcome does not act', 'EARLIER bug');
select wos_test.expect_error($$insert into wos.bug_triage_decisions (bug_id, bug_key, decision_sha256, outcome, duplicate_of_bug_key, decided_by, decider_account_id, reporter_account_id)
  values ('00000000-0000-0000-0061-0000000000a9', 'BUG-99', 'sha256:' || repeat('5', 64), 'duplicate', 'BUG-101', 'maintainer', '00000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-00000000000e')$$,
  'D61 B1: a duplicate pointing at a LATER report (the chain decides who was first)', 'EARLIER bug');
select wos_test.tri('a6', 'BUG-106', 'duplicate', null, '00f6', 'e', null, 'BUG-101');
insert into wos.bug_triage_decisions (bug_id, bug_key, decision_sha256, outcome, decided_by, decider_account_id, reporter_account_id)
values ('00000000-0000-0000-0061-0000000000a4', 'BUG-104', 'sha256:' || repeat('4', 64), 'wont_fix', 'maintainer', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e');
select wos_test.expect_error($$insert into wos.bug_triage_decisions (bug_id, bug_key, decision_sha256, outcome, decided_by, decider_account_id, reporter_account_id)
  values ('00000000-0000-0000-0061-0000000000a2', 'BUG-102', 'sha256:' || repeat('2', 64), 'not_a_bug', 'maintainer', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e')$$,
  'D61 B1: a "maintainer" decision by a non-maintainer', 'maintainer');
select wos_test.expect_error($$update wos.bug_triage_decisions set outcome = 'not_a_bug'$$, 'D61 B1: triage records are append-only', 'append-only');

-- B2
create or replace function wos_test.conf(bug text, kind text, sev text, who text default 'a') returns void
language sql as $$
  insert into wos.bug_triage_confirmations (bug_id, kind, corrected_severity, maintainer_account_id)
  values (('00000000-0000-0000-0061-0000000000' || bug)::uuid, kind, sev, ('00000000-0000-0000-0000-00000000000' || who)::uuid)
$$;
select wos_test.expect_error($$select wos_test.conf('a3', 'ratified', null, 'd')$$, 'D61 B2: a ratification by a non-maintainer', 'maintainer');
select wos_test.expect_error($$select wos_test.conf('a1', 'resolved', null)$$, 'D61 B2: resolved on a fix (a fix resolves by its BUG_FIX receipt)', 'contract revision');
select wos_test.expect_error($$select wos_test.conf('a3', 'severity_corrected', 'low')$$, 'D61 B2: a severity correction of a non-acting outcome', 'acting outcome');
do $$ begin
  if wos.bug_effective_severity('00000000-0000-0000-0061-0000000000a5') is not null then
    raise exception 'D61 B2: an unconfirmed critical severity is not effective';
  end if;
  raise notice 'ok: D61 B2: an unconfirmed critical severity is not effective';
end $$;

-- Review 09 R09-5 (introducer-window anchor, section 5): the window is measured from the triage decision's server
-- time back to the introducing receipt's acceptance (qualified_at), not from the report's intake.
insert into wos.work_dedup_keys (dedup_key, source) values ('d61:w13', 'receipt'), ('d61:w15', 'receipt');
insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
values ('00000000-0000-0000-0061-000000000a13', '00000000-0000-0000-0000-00000000000d', 'PROPOSAL', 'outcomes', 'outcome', 'proposal_incorporated', 'independent', 'ACTIVE',
        1000000, 'proposal', gen_random_uuid(), 'd61:w13', 99100, '{}', 'sha256:' || md5('w13') || md5('w13x'), now() - interval '13 days' - interval '23 hours')
on conflict do nothing;
insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, subject_kind, subject_id, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
values ('00000000-0000-0000-0061-000000000a15', '00000000-0000-0000-0000-00000000000d', 'PROPOSAL', 'outcomes', 'outcome', 'proposal_incorporated', 'independent', 'ACTIVE',
        1000000, 'proposal', gen_random_uuid(), 'd61:w15', 99100, '{}', 'sha256:' || md5('w15') || md5('w15x'), now() - interval '14 days' - interval '1 hour');
insert into wos.bug_triage_decisions (bug_id, bug_key, decision_sha256, outcome, severity, decided_by, decider_account_id, reporter_account_id, introducing_receipt_id)
values ('00000000-0000-0000-0061-0000000000c3', 'BUG-120', 'sha256:' || repeat('c', 64), 'fix', 'low', 'maintainer', '00000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0061-000000000a13'),
       ('00000000-0000-0000-0061-0000000000c5', 'BUG-121', 'sha256:' || repeat('d', 64), 'fix', 'low', 'maintainer', '00000000-0000-0000-0000-00000000000a',
        '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0061-000000000a15');
do $$ begin
  if (select string_agg(bug_key || ':' || introduced_within_window, ',' order by bug_key) from wos.bug_triage_decisions where bug_key in ('BUG-120', 'BUG-121'))
     <> 'BUG-120:true,BUG-121:false' then
    raise exception 'R09 section 5: the introducer window is anchored at the decision (13 d 23 h inside, 14 d 1 h outside)';
  end if;
  raise notice 'ok: R09 section 5: the introducer window is anchored at the triage decision (13 d 23 h inside; 14 d 1 h outside)';
end $$;

-- F1 (review 09 R09-3, R09-6): fix budgets are commissioned after triage, at the severity effective at issuance.
select wos_test.expect_error($$select wos_test.b61('0f09', 99100, '{"taskKind": "abu_build", "bug": "BUG-101", "severity": "low"}')$$,
  'R09-6: a fix budget priced at another severity than the one effective at issuance', 'effective at its issuance');
select wos_test.expect_error($$select wos_test.b61('0f09', 99100, '{"taskKind": "abu_build", "bug": "BUG-103", "severity": "low"}')$$,
  'D61 F1: a fix budget for a bug whose outcome is not fix', 'outcome is fix');
select wos_test.expect_error($$select wos_test.b61('0f09', 99100, '{"taskKind": "feature_author", "bug": "BUG-101", "severity": "high"}')$$,
  'R09-3: a fix budget of another commissioned kind', 'abu_build or abu_revision');
select wos_test.expect_error($$select wos_test.b61('0f05', 99100, '{"taskKind": "abu_build", "bug": "BUG-105", "severity": "critical"}')$$,
  'R09-6: a critical fix budget before a maintainer confirmed critical', 'effective at its issuance');
select wos_test.b61('0f01', 99100, '{"taskKind": "abu_build", "bug": "BUG-101", "severity": "high"}');
do $$ begin
  if (select basis ->> 'severityRevision' from wos.task_budgets where task_id = '00000000-0000-0000-0061-000000000f01') <> '0' then
    raise exception 'R09-6: the fix budget pins the decision revision it was priced at (server-set)';
  end if;
  raise notice 'ok: R09-6: the fix budget pins the decision revision it was priced at';
end $$;
set session_replication_role = replica;
select wos_test.lease61('0c101', '0f01', 'e');
set session_replication_role = origin;
select wos_test.expect_error($$insert into wos.bug_triage_decisions (bug_id, bug_key, decision_sha256, outcome, severity, decided_by, triage_task_id, triage_lease_id,
    decider_account_id, reporter_account_id)
  values ('00000000-0000-0000-0061-0000000000c9', 'BUG-199', 'sha256:' || repeat('9', 64), 'fix', 'low', 'agent', '00000000-0000-0000-0061-000000000f01',
          '00000000-0000-0000-0061-00000000c101', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000d')$$,
  'R09-3 repro C: a triage decided under a larger execution (fix) budget and its lease', 'bug_triage budget');
-- R09-6 after the lease: a maintainer downgrades BUG-101 to low; the high quote issued earlier stands.
select wos_test.conf('a1', 'severity_corrected', 'low');

-- B3
insert into wos.work_dedup_keys (dedup_key, source)
select k, 'receipt' from unnest(array['d61:t101:d', 'd61:t101:e', 'd61:t103:d', 'd61:fix101', 'd61:fix101c', 'd61:fix105', 'd61:subject', 'd61:rep',
  'd61:impl', 'd61:impl2', 'd61:fixbe', 'd61:tribe',
  'bug:BUG-101', 'bug:BUG-103', 'bug:BUG-105', 'd61:q1']) k;
create or replace function wos_test.bugr(rid text, acct text, ctype text, task text, dkey text, bug text, lease text default null,
  body jsonb default '{}', kind text default 'bug') returns void
language sql as $$
  insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
    weight_micro, task_id, share_bp, subject_kind, subject_id, lease_id, lease_generation, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values (('00000000-0000-0000-0061-00000000' || rid)::uuid, ('00000000-0000-0000-0000-00000000000' || acct)::uuid, ctype,
          case when task is null then 'outcomes' else 'execution' end, case when task is null then 'outcome' else 'accepted_budget' end,
          'd61', 'independent', 'ACTIVE', 1000000, ('00000000-0000-0000-0061-00000000' || task)::uuid, case when task is null then null else 10000 end, kind,
          ('00000000-0000-0000-0061-0000000000' || bug)::uuid, ('00000000-0000-0000-0061-0000000' || lease)::uuid,
          case when lease is null then null else 1 end, dkey, 99100, body, 'sha256:' || md5(rid) || md5(dkey), now())
$$;
create or replace function wos_test.h(key text) returns jsonb language sql as $$ select jsonb_build_object('decisionSha256', 'sha256:' || md5(key) || md5(key || 'x')) $$;
select wos_test.expect_error($$select wos_test.bugr('0e01', 'd', 'BUG_TRIAGE', '00f1', 'd61:t101:d', 'a1', '0c0f1', wos_test.h('BUG-101'))$$,
  'D61 B3: a fix triage paid before the fix is accepted or ratified', 'confirmed');
select wos_test.expect_error($$select wos_test.bugr('0e02', 'e', 'IMPLEMENTATION', '0f01', 'd61:impl', 'a1', '0c101', '{}', 'attempt')$$,
  'R09-3 repro B: a fix task''s receipt classified as IMPLEMENTATION', 'is BUG_FIX');
select wos_test.expect_error($$select wos_test.bugr('0e22', 'e', 'BUG_FIX', 'be02', 'd61:fixbe', 'a1', '0cbe2')$$,
  'R09-3: BUG_FIX on a task that is not a commissioned fix', 'is BUG_FIX');
select wos_test.expect_error($$select wos_test.bugr('0e23', 'd', 'IMPLEMENTATION', '00f1', 'd61:impl2', 'a1', '0c0f1', '{}', 'attempt')$$,
  'R09-3: a bug_triage task''s receipt classified as IMPLEMENTATION', 'is BUG_TRIAGE');
select wos_test.expect_error($$select wos_test.bugr('0e24', 'e', 'BUG_TRIAGE', 'be02', 'd61:tribe', 'a1', '0cbe2', wos_test.h('BUG-101'))$$,
  'R09-3: BUG_TRIAGE on a task that is not a bug_triage budget', 'is BUG_TRIAGE');
select wos_test.expect_error($$select wos_test.bugr('0e03', 'b', 'BUG_FIX', '0f01', 'd61:fix101', 'a1', '0c101')$$,
  'D61 B3: the in-window introducer fixing its own regression', 'introducer');
select wos_test.expect_error($$select wos_test.bugr('0e04', 'd', 'BUG_FIX', '0f01', 'd61:fix101', 'a1', '0c101')$$,
  'D61 B3: the triager fixing the bug it triaged', 'both triages and fixes');
select wos_test.expect_error($$select wos_test.bugr('0e05', 'e', 'BUG_FIX', '0f01', 'd61:fix101', 'a1')$$,
  'D61 B3: a BUG_FIX without its lease', 'lease');
select wos_test.expect_error($$select wos_test.bugr('0e06', 'e', 'BUG_FIX', '0f01', 'd61:subject', 'a1', '0c101', '{}', 'attempt')$$,
  'D61: a bug receipt whose subject is not the bug', 'subject is the bug');
select wos_test.bugr('0e08', 'e', 'BUG_FIX', '0f01', 'd61:fix101', 'a1', '0c101');
insert into wos.receipt_status_events (receipt_id, seq, from_status, to_status, kind) values ('00000000-0000-0000-0061-000000000e08', 1, null, 'ACTIVE', 'issued');
select 'ok: R09-6: a valid fix on the high quote passes after a downgrade to low (the quote pinned at issuance stands)';
select wos_test.expect_error($$select wos_test.bugr('0e09', 'd', 'BUG_TRIAGE', '00f1', 'd61:t101:d', 'a1', '0c0f1', '{"decisionSha256": "sha256:0000000000000000000000000000000000000000000000000000000000000000"}')$$,
  'D61 B3: a triage receipt citing another decision hash', 'canonical hash');
select wos_test.expect_error($$select wos_test.bugr('0e10', 'e', 'BUG_TRIAGE', '00f1', 'd61:t101:e', 'a1', '0c0f1', wos_test.h('BUG-101'))$$,
  'D61 B3: a triage receipt for someone other than the decider', 'decider');
select wos_test.bugr('0e11', 'd', 'BUG_TRIAGE', '00f1', 'd61:t101:d', 'a1', '0c0f1', wos_test.h('BUG-101'));
select wos_test.expect_error($$select wos_test.bugr('0e12', 'd', 'BUG_TRIAGE', '00f3', 'd61:t103:d', 'a3', '0c0f3', wos_test.h('BUG-103'))$$,
  'D61 B3: a not_a_bug triage paid before a maintainer ratified it', 'confirmed');
select wos_test.conf('a3', 'ratified', null);
select wos_test.bugr('0e13', 'd', 'BUG_TRIAGE', '00f3', 'd61:t103:d', 'a3', '0c0f3', wos_test.h('BUG-103'));
select wos_test.expect_error($$select wos_test.bugr('0e14', 'e', 'BUG_REPORT', null, 'd61:rep', 'a1')$$,
  'D61 B3: a bug report under any other dedup key than bug:<BUG-n>', 'dedup key');
select wos_test.expect_error($$select wos_test.bugr('0e15', 'd', 'BUG_REPORT', null, 'bug:BUG-101', 'a1')$$,
  'D61 B3: a report paid to someone other than the first reporter', 'first reporter');
select wos_test.expect_error($$select wos_test.bugr('0e16', 'e', 'BUG_REPORT', null, 'bug:BUG-103', 'a3')$$,
  'D61 B3: a report of a not_a_bug outcome', 'fix or contract_revision');
-- Review 09 R09-4 repro: the bug's only fix is REVOKED before the first report is admitted.
insert into wos.receipt_status_events (receipt_id, seq, from_status, to_status, kind, admin_action_id)
values ('00000000-0000-0000-0061-000000000e08', 2, 'ACTIVE', 'REVOKED', 'revoked', wos_test.aa('invalidate_receipt', 'receipt', '0e08'));
select wos_test.expect_error($$select wos_test.bugr('0e17', 'e', 'BUG_REPORT', null, 'bug:BUG-101', 'a1')$$,
  'R09-4 repro: a report admitted while the bug''s only fix is revoked', 'resolved');
-- R09-6 before issuance: a budget commissioned after the downgrade is priced low (revision 1); its ACTIVE fix resolves the bug.
select wos_test.expect_error($$select wos_test.b61('0f03', 99100, '{"taskKind": "abu_build", "bug": "BUG-101", "severity": "high"}')$$,
  'R09-6: a budget commissioned after a correction at the old severity', 'effective at its issuance');
select wos_test.b61('0f03', 99100, '{"taskKind": "abu_build", "bug": "BUG-101", "severity": "low"}');
set session_replication_role = replica;
select wos_test.lease61('0c103', '0f03', 'e');
set session_replication_role = origin;
select wos_test.bugr('0e21', 'e', 'BUG_FIX', '0f03', 'd61:fix101c', 'a1', '0c103');
insert into wos.receipt_status_events (receipt_id, seq, from_status, to_status, kind) values ('00000000-0000-0000-0061-000000000e21', 1, null, 'ACTIVE', 'issued');
do $$
declare
  s text;
  r uuid;
begin
  foreach s in array array['ACTIVE', 'RATIFIED', 'FINAL_BY_SILENCE', 'PROVISIONAL', 'REVOKED'] loop
    select e.receipt_id into r from wos.receipt_status_events e
     where e.seq = (select max(x.seq) from wos.receipt_status_events x where x.receipt_id = e.receipt_id) and e.to_status = s limit 1;
    if r is null then raise exception 'R09-4 fixture: no receipt currently %', s; end if;
    if wos.receipt_live(r) <> (s in ('ACTIVE', 'RATIFIED', 'FINAL_BY_SILENCE')) then
      raise exception 'R09-4: receipt_live(%) is wrong for status %', r, s;
    end if;
  end loop;
  raise notice 'ok: R09-4: live-countable = ACTIVE, RATIFIED, FINAL_BY_SILENCE; PROVISIONAL and REVOKED do not resolve a bug';
end $$;
select wos_test.bugr('0e17', 'e', 'BUG_REPORT', null, 'bug:BUG-101', 'a1');
select wos_test.expect_error($$select wos_test.bugr('0e18', 'e', 'BUG_REPORT', null, 'bug:BUG-101', 'a1')$$,
  'D61 B3: a second paid report of one bug', 'one paid report per bug');
select wos_test.conf('a5', 'ratified', null);
select wos_test.b61('0f05', 99100, '{"taskKind": "abu_build", "bug": "BUG-105", "severity": "critical"}');
set session_replication_role = replica;
select wos_test.lease61('0c105', '0f05', 'e');
set session_replication_role = origin;
select wos_test.bugr('0e19', 'e', 'BUG_FIX', '0f05', 'd61:fix105', 'a5', '0c105');
insert into wos.receipt_status_events (receipt_id, seq, from_status, to_status, kind) values ('00000000-0000-0000-0061-000000000e19', 1, null, 'ACTIVE', 'issued');
select wos_test.expect_error($$select wos_test.bugr('0e20', 'e', 'BUG_REPORT', null, 'bug:BUG-105', 'a5')$$,
  'D61 B3: a reporter past the pinned per-epoch cap of paid reports', 'cap');

-- B4: the introducer's offset equals the report's pay, cites the bug, the introducing receipt and the introducer, once.
set session_replication_role = replica;
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
values ('00000000-0000-0000-0061-0000000000e1', 99100, 'test', '00000000-0000-0000-0000-00000000000e', 'person', '00000000-0000-0000-0000-00000000000e',
        '00000000-0000-0000-0061-000000000e17', 'outcomes', 1, 70, '{}', 'sha256:' || repeat('1', 64));
set session_replication_role = origin;
create or replace function wos_test.boff(bug text, benef uuid, rid uuid, amt bigint) returns void
language sql as $$
  insert into wos.offsets (beneficiary_kind, beneficiary_id, receipt_id, amount_base, admin_action_id, bug_id)
  values ('person', benef, rid, amt, wos_test.aa('record_offset', 'beneficiary', benef::text, jsonb_build_object('amount_base', amt)),
          ('00000000-0000-0000-0061-0000000000' || bug)::uuid)
$$;
select wos_test.expect_error($$select wos_test.boff('a1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 69)$$,
  'D61 B4: an introducer offset different from the report''s pay', 'equals');
select wos_test.expect_error($$select wos_test.boff('a1', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000cc001', 70)$$,
  'D61 B4: an introducer offset charged to someone else than the introducer', 'introducer');
select wos_test.expect_error($$select wos_test.boff('a5', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 70)$$,
  'D61 B4: an introducer offset for a bug with no blamed receipt', 'introducer');
select wos_test.boff('a1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 70);
select wos_test.expect_error($$select wos_test.boff('a1', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000cc001', 70)$$,
  'D61 B4: a second introducer offset for one bug', 'duplicate key');

-- H1 (D60 delta item 4): public hold labels only on cancelled releases.
select wos_test.expect_error($$insert into wos.task_budget_releases (task_id, reason, hold_label) values ('00000000-0000-0000-0061-00000000be01', 'failed', 'architecture_hold:ADR-007')$$,
  'D60 H1: a hold label on a release that is not a cancel', 'hold_label_cancelled');
select wos_test.expect_error($$insert into wos.task_budget_releases (task_id, reason, hold_label) values ('00000000-0000-0000-0061-00000000be01', 'cancelled', 'held')$$,
  'D60 H1: a malformed hold label', 'check constraint');
insert into wos.task_budget_releases (task_id, reason, hold_label) values ('00000000-0000-0000-0061-00000000be01', 'cancelled', 'architecture_hold:ADR-007');

-- Q1 (D63; review 09 R09-1): claim terms are required for v2 work, complete, at the pinned coefficient; none for v1.
create or replace function wos_test.snap(lease text, body jsonb, h text) returns void
language sql as $$
  insert into wos.run_policy_snapshots (lease_id, generation, body, snapshot_sha256)
  values (('00000000-0000-0000-0061-0000000' || lease)::uuid, (select generation from wos.leases where id = ('00000000-0000-0000-0061-0000000' || lease)::uuid),
          body, 'sha256:' || repeat(h, 64))
$$;
select wos_test.expect_error($$select wos_test.snap('0cbe2', '{}', '7')$$, 'R09-1 repro: a v2 lease snapshot without claim terms', 'complete claim terms');
select wos_test.expect_error($$select wos_test.snap('0cbe2', '{"claim": null}', '7')$$, 'R09-1: null claim terms', 'complete claim terms');
select wos_test.expect_error($$select wos_test.snap('0cbe2', '{"claim": {"mode": "self_pick", "queueBonusBp": 2000, "bonusApplies": "no"}}', '7')$$,
  'R09-1: malformed claim terms', 'complete claim terms');
select wos_test.expect_error($$select wos_test.snap('0cbe2', '{"claim": {"mode": "self_pick", "queueBonusBp": 0, "bonusApplies": false}}', '7')$$,
  'R09-1 repro: a tampered queue-bonus coefficient (0 instead of the pinned 2000)', 'differs from the pinned');
select wos_test.expect_error($$select wos_test.snap('0cbe2', '{"claim": {"mode": "self_pick", "queueBonusBp": 2000, "bonusApplies": true}}', '7')$$,
  'D63 Q1: a self-picked claim earning the queue bonus', 'only a queue claim');
select wos_test.expect_error($$select wos_test.snap('0c0f0', '{"claim": {"mode": "queue", "queueBonusBp": 2000, "bonusApplies": true}}', '7')$$,
  'R09-1: claim terms on pinned v1 work', 'carries no claim terms');
select wos_test.snap('0cbe2', '{"claim": {"mode": "self_pick", "queueBonusBp": 2000, "bonusApplies": false}}', '8');
select wos_test.snap('0cbe3', '{"claim": {"mode": "self_pick", "queueBonusBp": 2000, "bonusApplies": false}}', 'a');
select wos_test.snap('0cbe4', '{"claim": {"mode": "queue", "queueBonusBp": 2000, "bonusApplies": true}}', 'b');
insert into wos.work_dedup_keys (dedup_key, source) values ('d61:q3e', 'receipt'), ('d61:q3d', 'receipt'), ('d61:q4', 'receipt');
insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, task_id, share_bp, subject_kind, subject_id, lease_id, lease_generation, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
values ('00000000-0000-0000-0061-00000000eee1', '00000000-0000-0000-0000-00000000000e', 'IMPLEMENTATION', 'execution', 'accepted_budget', 'pr_merged', 'independent', 'ACTIVE',
        1000000, '00000000-0000-0000-0061-00000000be02', 10000, 'attempt', gen_random_uuid(), '00000000-0000-0000-0061-00000000cbe2', 1, 'd61:q1', 99100, '{}',
        'sha256:' || repeat('9', 63) || 'a', now());
insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, task_id, share_bp, subject_kind, subject_id, lease_id, lease_generation, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
values ('00000000-0000-0000-0061-00000000eee3', '00000000-0000-0000-0000-00000000000e', 'IMPLEMENTATION', 'execution', 'accepted_budget', 'pr_merged', 'independent', 'ACTIVE',
        1000000, '00000000-0000-0000-0061-00000000be03', 5000, 'attempt', gen_random_uuid(), '00000000-0000-0000-0061-00000000cbe3', 1, 'd61:q3e', 99100, '{}',
        'sha256:' || repeat('9', 63) || 'b', now()),
       ('00000000-0000-0000-0061-00000000eee4', '00000000-0000-0000-0000-00000000000d', 'IMPLEMENTATION', 'execution', 'accepted_budget', 'pr_merged', 'independent', 'ACTIVE',
        1000000, '00000000-0000-0000-0061-00000000be03', 5000, 'attempt', gen_random_uuid(), '00000000-0000-0000-0061-00000000cbe4', 2, 'd61:q3d', 99100, '{}',
        'sha256:' || repeat('9', 63) || 'c', now());
insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, task_id, share_bp, subject_kind, subject_id, lease_id, lease_generation, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
values ('00000000-0000-0000-0061-00000000eee5', '00000000-0000-0000-0000-00000000000e', 'IMPLEMENTATION', 'execution', 'accepted_budget', 'pr_merged', 'independent', 'ACTIVE',
        1000000, '00000000-0000-0000-0061-00000000be04', 10000, 'attempt', gen_random_uuid(), '00000000-0000-0000-0061-00000000cbe5', 1, 'd61:q4', 99100, '{}',
        'sha256:' || repeat('9', 63) || 'd', now());
set session_replication_role = replica;
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
values (99102, 'test', 'devnet', now() - interval '9 days', now() - interval '2 days', 48, 48, '{}');
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values
  (99102, 1, null, 'OPEN', 'system', now() - interval '9 days'), (99102, 2, 'OPEN', 'CALCULATING', 'system', now() - interval '1 day');
set session_replication_role = origin;
do $$ begin
  if (select reserved_base from wos.task_budgets where task_id = '00000000-0000-0000-0061-00000000be02') <> 100000000 then
    raise exception 'D63 Q1 fixture: the reservation is the queue price (1 ACU x 100000000)';
  end if;
end $$;
select wos_test.over($$select wos_test.alloc('00000000-0000-0000-0061-0000000000e2', 99102, '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0061-00000000eee1', 'execution', 83333334)$$,
  'D63 Q1: a self-picked task allocated above its base price floor(100000000 x 10000 / 12000) = 83333333', 'base price');
select wos_test.alloc('00000000-0000-0000-0061-0000000000e3', 99102, '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0061-00000000eee1', 'execution', 83333333);
do $$ begin
  set constraints all immediate;
  raise notice 'ok: D63 Q1: a self-picked task is allocated its base price; the queue bonus (16666667) stays in R';
end $$;
select wos_test.over($$select wos_test.alloc('00000000-0000-0000-0061-0000000000e4', 99102, '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0061-00000000eee3', 'execution', 1)$$,
  'R09-1: one task-level entitlement (two participating leases with different claim terms)', 'different claim terms');
select wos_test.over($$select wos_test.alloc('00000000-0000-0000-0061-0000000000e5', 99102, '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0061-00000000eee5', 'execution', 1)$$,
  'R09-1 repro: an allocation of v2 work whose lease carries no claim snapshot', 'claim terms');

-- RLS: records are public and written only by privileged actors.
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  if not exists (select 1 from wos.bug_triage_decisions) or not exists (select 1 from wos.bug_triage_confirmations) then
    raise exception 'D61: triage records and confirmations are public';
  end if;
  raise notice 'ok: D61 triage records and confirmations are public';
end $$;
select wos_test.expect_error($$select wos_test.conf('a1', 'ratified', null)$$, 'D61: a contributor session writing a confirmation', 'row-level security');
reset role;
select set_config('wos.actor_kind', 'system', false);

\echo 'all 0010 assertions passed'

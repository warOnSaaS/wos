-- D61 bugs and maintenance (migration 0009): invariants B1-B4. Runs after db-assertions.sql and reuses its fixtures:
-- alice (a), bob (b) and carol (c) are related (acme team and sponsorships); dave (d) and eve (e) are unrelated to
-- everyone. Bob's receipt ...cc001 (qualified now) is the introducing receipt, so bob is the introducer in the window.
-- The policy document 'reward-policy.test-d61' is a TEST fixture carrying only the two bug fields the database reads,
-- with a cap of 1 report per reporter per epoch so the cap is exercised; it is never a published policy.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
\pset tuples_only on

insert into wos.policy_documents (kind, version, body, sha256) values
  ('reward', 'reward-policy.test-d61', '{"bugs": {"introducerWindowDays": 14, "maxBugReportsPaidPerAccountPerEpoch": 1}}', 'sha256:' || repeat('6', 64));
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base,
  reserve_snapshot_base, demand_forecast_acu_micro)
values (61, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{"reward": "reward-policy.test-d61"}', 100000000, 1000000000000, 20000000000000, 0);
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (61, null, 'OPEN', 'system');
insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values
  ('00000000-0000-0000-0061-0000000000b1', 'feature_criterion', 'd61 fixture: bug triage and fixes', 100000000, 'budget-model.v1');

-- Budgets: triage tasks t0 (epoch 30, no bug rules pinned), t1..t6 (epoch 61); fix tasks f1 (high), f2 (low: mismatch), f3.
create or replace function wos_test.b61(task text, kind text, epoch int, basis jsonb default '{}') returns void
language sql as $$
  insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
  values (('00000000-0000-0000-0061-00000000' || task)::uuid, '00000000-0000-0000-0061-0000000000b1', kind, 1000000, 1000000, basis, 'budget-model.v1',
          '00000000-0000-0000-0000-00000000000c', epoch)
$$;
select wos_test.b61('00f0', 'human_review', 30);
select wos_test.b61('00f1', 'human_review', 61);
select wos_test.b61('00f2', 'human_review', 61);
select wos_test.b61('00f3', 'human_review', 61);
select wos_test.b61('00f4', 'human_review', 61);
select wos_test.b61('00f5', 'human_review', 61);
select wos_test.b61('00f6', 'human_review', 61);
select wos_test.b61('00f7', 'human_review', 61);
select wos_test.b61('0f01', 'execution', 61, '{"bugId": "00000000-0000-0000-0061-0000000000a1", "severity": "high"}');
select wos_test.b61('0f02', 'execution', 61, '{"bugId": "00000000-0000-0000-0061-0000000000a1", "severity": "low"}');
select wos_test.b61('0f03', 'execution', 61, '{"bugId": "00000000-0000-0000-0061-0000000000a5", "severity": "low"}');
-- Leases of the fix tasks (fixtures: tasks and leases are inserted without their triggers, as in db-assertions).
set session_replication_role = replica;
insert into wos.tasks (id, kind, state, role, abu_id)
select ('00000000-0000-0000-0061-00000000' || t)::uuid, 'abu_build', 'leased', 'builder', gen_random_uuid() from unnest(array['0f01', '0f03']) t;
insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at, ended_at, generation) values
  ('00000000-0000-0000-0061-0000000000c1', '00000000-0000-0000-0061-000000000f01', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000de', 'completed', '{}', now() + interval '30 minutes', now() + interval '3 hours', now(), 1),
  ('00000000-0000-0000-0061-0000000000c3', '00000000-0000-0000-0061-000000000f03', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000de', 'completed', '{}', now() + interval '30 minutes', now() + interval '3 hours', now(), 1);
set session_replication_role = origin;

-- Triage assignments: dave triages bugs a0, a1, a3, a4, a5; alice (bob's org-mate) a2; carol (related to the introducer) a6.
insert into wos.human_review_assignments (task_id, reviewer_account_id, subject_kind, subject_id, risk_class) values
  ('00000000-0000-0000-0061-0000000000f0', '00000000-0000-0000-0000-00000000000d', 'bug', '00000000-0000-0000-0061-0000000000a0', 'standard'),
  ('00000000-0000-0000-0061-0000000000f1', '00000000-0000-0000-0000-00000000000d', 'bug', '00000000-0000-0000-0061-0000000000a1', 'standard'),
  ('00000000-0000-0000-0061-0000000000f2', '00000000-0000-0000-0000-00000000000a', 'bug', '00000000-0000-0000-0061-0000000000a2', 'standard'),
  ('00000000-0000-0000-0061-0000000000f3', '00000000-0000-0000-0000-00000000000d', 'bug', '00000000-0000-0000-0061-0000000000a3', 'standard'),
  ('00000000-0000-0000-0061-0000000000f4', '00000000-0000-0000-0000-00000000000d', 'bug', '00000000-0000-0000-0061-0000000000a4', 'standard'),
  ('00000000-0000-0000-0061-0000000000f5', '00000000-0000-0000-0000-00000000000d', 'bug', '00000000-0000-0000-0061-0000000000a5', 'standard'),
  ('00000000-0000-0000-0061-0000000000f6', '00000000-0000-0000-0000-00000000000c', 'bug', '00000000-0000-0000-0061-0000000000a6', 'standard'),
  ('00000000-0000-0000-0061-0000000000f7', '00000000-0000-0000-0000-00000000000d', 'bug', '00000000-0000-0000-0061-0000000000a1', 'standard');

create or replace function wos_test.triage(bug text, task text, decider text, outcome text, sev text, reporter text, intro uuid, dup text default null) returns void
language sql as $$
  insert into wos.bug_triage_decisions (bug_id, triage_task_id, outcome, severity, duplicate_of_bug_id, first_reporter_account_id, first_report_ref,
    introducing_receipt_id, introducer_account_id, introduced_within_window, decided_by_account_id)
  values (('00000000-0000-0000-0061-0000000000' || bug)::uuid, ('00000000-0000-0000-0061-0000000000' || task)::uuid, outcome, sev,
          ('00000000-0000-0000-0061-0000000000' || dup)::uuid, ('00000000-0000-0000-0000-00000000000' || reporter)::uuid, 'issue #' || bug, intro,
          '00000000-0000-0000-0000-00000000000e', false, ('00000000-0000-0000-0000-00000000000' || decider)::uuid)
$$;

-- B1
select wos_test.expect_error($$select wos_test.triage('a0', 'f0', 'd', 'confirmed', 'low', 'e', null)$$,
  'D61 B1: a triage task pinned to a reward policy without bug rules (v1) fails closed', 'no bug rules');
select wos_test.expect_error($$select wos_test.triage('a1', 'f1', 'e', 'confirmed', 'high', 'e', null)$$,
  'D61 B1: a decision by someone other than the assigned reviewer', 'assigned reviewer');
select wos_test.expect_error($$select wos_test.triage('a9', 'f1', 'd', 'confirmed', 'high', 'e', null)$$,
  'D61 B1: a decision on another bug than the triage task''s', 'assigned reviewer');
select wos_test.expect_error($$select wos_test.triage('a2', 'f2', 'a', 'confirmed', 'high', 'b', null)$$,
  'D61 B1: an org-mate of the reporter confirming the report', 'reporter');
select wos_test.expect_error($$select wos_test.triage('a6', 'f6', 'c', 'confirmed', 'high', 'e', '00000000-0000-0000-0000-0000000cc001')$$,
  'D61 B1: a relative of the introducer triaging the bug blamed on its receipt', 'introducer');
select wos_test.expect_error($$select wos_test.triage('a1', 'f1', 'd', 'confirmed', null, 'e', null)$$,
  'D61 B1: a confirmed bug without a severity', 'check constraint');
select wos_test.triage('a1', 'f1', 'd', 'confirmed', 'high', 'e', '00000000-0000-0000-0000-0000000cc001');
do $$ begin
  if (select introducer_account_id::text || '/' || introduced_within_window || '/' || window_days || '/' || policy_version
        from wos.bug_triage_decisions where bug_id = '00000000-0000-0000-0061-0000000000a1')
     <> '00000000-0000-0000-0000-00000000000b/true/14/reward-policy.test-d61' then
    raise exception 'D61 B1: the introducer, the window flag, the window and the policy are derived (a supplied introducer is overwritten)';
  end if;
  raise notice 'ok: D61 B1: introducer, within-window flag, window and pinned policy are derived by the database';
end $$;
select wos_test.expect_error($$select wos_test.triage('a1', 'f7', 'd', 'rejected', null, 'e', null)$$, 'D61 B1: a second decision for one bug', 'duplicate key');
select wos_test.triage('a3', 'f3', 'd', 'rejected', null, 'e', null);
select wos_test.expect_error($$select wos_test.triage('a4', 'f4', 'd', 'duplicate', null, 'e', null, 'a3')$$,
  'D61 B1: a duplicate of a rejected bug', 'confirmed bug');
select wos_test.triage('a4', 'f4', 'd', 'duplicate', null, 'e', null, 'a1');
select wos_test.triage('a5', 'f5', 'd', 'confirmed', 'low', 'e', null);
select wos_test.expect_error($$update wos.bug_triage_decisions set outcome = 'rejected'$$, 'D61 B1: triage decisions are append-only', 'append-only');

-- B2, B3: receipts.
insert into wos.work_dedup_keys (dedup_key, source) values
  ('d61:triage:a1:d', 'receipt'), ('d61:triage:a1:e', 'receipt'), ('d61:fix:a1:b', 'receipt'), ('d61:fix:a1:e', 'receipt'), ('d61:fix:a1:e2', 'receipt'),
  ('d61:fix:a5:e', 'receipt'), ('d61:report:x', 'receipt'), ('d61:subject', 'receipt'),
  ('bug:00000000-0000-0000-0061-0000000000a1', 'receipt'), ('bug:00000000-0000-0000-0061-0000000000a3', 'receipt'),
  ('bug:00000000-0000-0000-0061-0000000000a5', 'receipt');
create or replace function wos_test.bugr(rid text, acct text, ctype text, slc text, task text, dkey text, bug text, lease text default null, kind text default 'bug')
returns void language sql as $$
  insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
    weight_micro, task_id, share_bp, subject_kind, subject_id, lease_id, lease_generation, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values (('00000000-0000-0000-0061-00000000' || rid)::uuid, ('00000000-0000-0000-0000-00000000000' || acct)::uuid, ctype, slc,
          case when task is null then 'outcome' else 'accepted_budget' end, 'd61', 'independent', 'ACTIVE', 1000000,
          ('00000000-0000-0000-0061-00000000' || task)::uuid, case when task is null then null else 10000 end, kind,
          ('00000000-0000-0000-0061-0000000000' || bug)::uuid, ('00000000-0000-0000-0061-0000000000' || lease)::uuid,
          case when lease is null then null else 1 end, dkey, 61, '{}', 'sha256:' || md5(rid) || md5(dkey), now())
$$;
select wos_test.expect_error($$select wos_test.bugr('0e01', 'e', 'BUG_TRIAGE', 'human_review', '00f1', 'd61:triage:a1:e', 'a1')$$,
  'D61 B3: a BUG_TRIAGE receipt for someone other than the decider', 'decider');
select wos_test.bugr('0e02', 'd', 'BUG_TRIAGE', 'human_review', '00f1', 'd61:triage:a1:d', 'a1');
select wos_test.expect_error($$select wos_test.bugr('0e03', 'e', 'BUG_REPORT', 'outcomes', null, 'bug:00000000-0000-0000-0061-0000000000a1', 'a1')$$,
  'D61 B2: a bug report paid before its fix is accepted', 'fix is accepted');
select wos_test.expect_error($$select wos_test.bugr('0e04', 'b', 'BUG_FIX', 'execution', '0f01', 'd61:fix:a1:b', 'a1', 'c1')$$,
  'D61 B3: the introducer fixing (and being paid for) its own regression within the window', 'introducer');
select wos_test.expect_error($$select wos_test.bugr('0e05', 'e', 'BUG_FIX', 'execution', '0f01', 'd61:fix:a1:e', 'a1')$$,
  'D61 B3: a BUG_FIX without the lease it was done under', 'lease');
select wos_test.expect_error($$select wos_test.bugr('0e06', 'e', 'BUG_FIX', 'execution', '0f02', 'd61:fix:a1:e2', 'a1', 'c1')$$,
  'D61 B3: a fix budget priced at another severity than the confirmed one', 'confirmed severity');
select wos_test.expect_error($$select wos_test.bugr('0e07', 'e', 'BUG_FIX', 'execution', '0f01', 'd61:fix:a1:e', 'a3', 'c1')$$,
  'D61 B3: a fix of a rejected bug', 'confirmed triage');
select wos_test.expect_error($$select wos_test.bugr('0e08', 'e', 'BUG_FIX', 'execution', '0f01', 'd61:subject', 'a1', 'c1', 'attempt')$$,
  'D61: a bug receipt whose subject is not the bug', 'subject is the bug');
select wos_test.bugr('0e09', 'e', 'BUG_FIX', 'execution', '0f01', 'd61:fix:a1:e', 'a1', 'c1');
select wos_test.expect_error($$select wos_test.bugr('0e10', 'e', 'BUG_REPORT', 'outcomes', null, 'd61:report:x', 'a1')$$,
  'D61 B2: a bug report under any other dedup key than bug:<id>', 'dedup key');
select wos_test.expect_error($$select wos_test.bugr('0e11', 'd', 'BUG_REPORT', 'outcomes', null, 'bug:00000000-0000-0000-0061-0000000000a1', 'a1')$$,
  'D61 B2: a later (not first) reporter paid', 'first valid report');
select wos_test.expect_error($$select wos_test.bugr('0e12', 'e', 'BUG_REPORT', 'outcomes', null, 'bug:00000000-0000-0000-0061-0000000000a3', 'a3')$$,
  'D61 B2: a report of a rejected bug', 'confirmed triage');
select wos_test.bugr('0e13', 'e', 'BUG_REPORT', 'outcomes', null, 'bug:00000000-0000-0000-0061-0000000000a1', 'a1');
select wos_test.expect_error($$select wos_test.bugr('0e14', 'e', 'BUG_REPORT', 'outcomes', null, 'bug:00000000-0000-0000-0061-0000000000a1', 'a1')$$,
  'D61 B2: a second paid report of one bug', 'one paid report per bug');
select wos_test.bugr('0e15', 'e', 'BUG_FIX', 'execution', '0f03', 'd61:fix:a5:e', 'a5', 'c3');
select wos_test.expect_error($$select wos_test.bugr('0e16', 'e', 'BUG_REPORT', 'outcomes', null, 'bug:00000000-0000-0000-0061-0000000000a5', 'a5')$$,
  'D61 B2: a reporter past the pinned per-epoch cap of paid reports', 'cap');

-- B4: the introducer's offset equals the report's pay, cites the bug, the introducing receipt and the introducer, once.
set session_replication_role = replica;
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, weight_micro, amount_base, explanation, explanation_sha256)
values ('00000000-0000-0000-0061-0000000000e1', 61, 'test', '00000000-0000-0000-0000-00000000000e', 'person', '00000000-0000-0000-0000-00000000000e',
        '00000000-0000-0000-0061-000000000e13', 'outcomes', 1, 70, '{}', 'sha256:' || repeat('1', 64));
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

-- RLS: triage decisions are public records written only by privileged actors.
set role wos_app;
select set_config('wos.actor_kind', 'contributor', false);
select set_config('wos.actor_id', '00000000-0000-0000-0000-00000000000d', false);
do $$ begin
  if not exists (select 1 from wos.bug_triage_decisions) then raise exception 'D61: triage decisions are public'; end if;
  raise notice 'ok: D61 triage decisions are public';
end $$;
select wos_test.expect_error($$select wos_test.triage('a6', 'f6', 'c', 'rejected', null, 'e', null)$$,
  'D61: a contributor session writing a triage decision', 'row-level security');
reset role;
select set_config('wos.actor_kind', 'system', false);

\echo 'all D61 bug assertions passed'

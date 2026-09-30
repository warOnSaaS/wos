\echo 'lifecycle trace: engine vs database (review 06)'
set constraints all immediate;
insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values ('00000000-0000-0000-0070-0000000000b0', 'feature_criterion', 'lifecycle trace', 20000000, 'budget-model.v1');
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (101, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    100, 2495250, 1000000000, 0, 2000, 6, 4, 2);
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select 101, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = 101), 0), 0) i;
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
    values ('00000000-0000-0000-0070-0000000000a1', '00000000-0000-0000-0070-0000000000b0', 'execution', 5000000, 5000000, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000e', 101);
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
    values ('00000000-0000-0000-0070-0000000000a2', '00000000-0000-0000-0070-0000000000b0', 'execution', 3000000, 3000000, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000e', 101);
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
    values ('00000000-0000-0000-0070-0000000000a3', '00000000-0000-0000-0070-0000000000b0', 'execution', 2000000, 2000000, '{}', 'budget-model.v1', '00000000-0000-0000-0000-00000000000e', 101);
insert into wos.task_submissions (task_id, submitted_epoch, submission_sha256) values ('00000000-0000-0000-0070-0000000000a1', 101, 'sha256:' || repeat('a', 64));
do $$ begin if not ((select reserved_base = 500 and expires_epoch = 105 and review_grace_epochs = 2 from wos.task_budgets where task_id = '00000000-0000-0000-0070-0000000000a1')) then raise exception 'TRACE MISMATCH: E1 t1: reservation 500, expiry 105, grace 2'; end if; raise notice 'ok (trace): E1 t1: reservation 500, expiry 105, grace 2'; end $$;
do $$ begin if not ((select reserved_base = 300 and expires_epoch = 105 and review_grace_epochs = 2 from wos.task_budgets where task_id = '00000000-0000-0000-0070-0000000000a2')) then raise exception 'TRACE MISMATCH: E1 t2: reservation 300, expiry 105, grace 2'; end if; raise notice 'ok (trace): E1 t2: reservation 300, expiry 105, grace 2'; end $$;
do $$ begin if not ((select reserved_base = 200 and expires_epoch = 105 and review_grace_epochs = 2 from wos.task_budgets where task_id = '00000000-0000-0000-0070-0000000000a3')) then raise exception 'TRACE MISMATCH: E1 t3: reservation 200, expiry 105, grace 2'; end if; raise notice 'ok (trace): E1 t3: reservation 200, expiry 105, grace 2'; end $$;
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (101, 1000000000, 999998939, 0, 0, 1061, 0, 0, 0, 'sha256:' || repeat('e', 64));
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (102, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    100, 2495247, 999998939, 0, 2000, 6, 4, 2);
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select 102, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = 102), 0), 0) i;
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.work_dedup_keys (dedup_key, source) values ('work:trace:t1', 'receipt');
select wos_test.receipt('00000000-0000-0000-0070-0000000000c1', '00000000-0000-0000-0000-00000000000b', 'IMPLEMENTATION', 'execution', 'accepted_budget', 5000000, '00000000-0000-0000-0070-0000000000a1', 10000, 'work:trace:t1', 102);
insert into wos.task_budget_releases (task_id, reason) values ('00000000-0000-0000-0070-0000000000a2', 'failed');
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select 102, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = 102), 0), 1) i;
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
select wos_test.alloc('00000000-0000-0000-0070-0000000000d1', 102, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0070-0000000000c1', 'execution', 500);
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select 102, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = 102), 0), 3) i;
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base) values
  ('00000000-0000-0000-0070-0000000000e1', 102, 'person', '00000000-0000-0000-0000-00000000000b', 'release_now', 'allocation', '00000000-0000-0000-0070-0000000000d1', 400),
  ('00000000-0000-0000-0070-0000000000e2', 102, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_tranche', 'allocation', '00000000-0000-0000-0070-0000000000d1', 100);
do $$ begin if not ((select matures_epoch from wos.entitlements where id = '00000000-0000-0000-0070-0000000000e2') = 108) then raise exception 'TRACE MISMATCH: E2 tranche matures at 108'; end if; raise notice 'ok (trace): E2 tranche matures at 108'; end $$;
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(x.amount_base) from wos.entitlement_claims x where x.entitlement_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind in ('release_now', 'holdback_matured')) = 400) then raise exception 'TRACE MISMATCH: E2 accept: claimable 400'; end if; raise notice 'ok (trace): E2 accept: claimable 400'; end $$;
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(m.amount_base) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind = 'holdback_tranche') = 100) then raise exception 'TRACE MISMATCH: E2 accept: tranche remaining 100'; end if; raise notice 'ok (trace): E2 accept: tranche remaining 100'; end $$;
do $$ begin if not ((select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s join wos.entitlements n on n.id = s.source_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id)) = 0) then raise exception 'TRACE MISMATCH: E2 accept: held 0'; end if; raise notice 'ok (trace): E2 accept: held 0'; end $$;
do $$ begin if not ((select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100) = 0) then raise exception 'TRACE MISMATCH: E2 accept: delivered 0'; end if; raise notice 'ok (trace): E2 accept: delivered 0'; end $$;
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (102, 1000000000, 999999257, 0, 31, 212, 500, 100, 400, 'sha256:' || repeat('e', 64));
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
    values ('00000000-0000-0000-0070-00000000f001', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 400, wos.adapter_generation(), 'sha256:' || repeat('1', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0070-0000000000e1', '00000000-0000-0000-0070-00000000f001', 400);
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (103, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    100, 2495248, 999999257, 0, 2000, 6, 4, 2);
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
  values ('00000000-0000-0000-0070-0000000000f1', 'person', '00000000-0000-0000-0000-00000000000b', 10, 'lifecycle trace hold', wos_test.aa('confiscate', 'confiscation', 'trace'),
          now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('00000000-0000-0000-0070-0000000000f1', 'holdback', '00000000-0000-0000-0070-0000000000e2', 10);
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(x.amount_base) from wos.entitlement_claims x where x.entitlement_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind in ('release_now', 'holdback_matured')) = 0) then raise exception 'TRACE MISMATCH: E3 hold + claim: claimable 0'; end if; raise notice 'ok (trace): E3 hold + claim: claimable 0'; end $$;
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(m.amount_base) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind = 'holdback_tranche') = 100) then raise exception 'TRACE MISMATCH: E3 hold + claim: tranche remaining 100'; end if; raise notice 'ok (trace): E3 hold + claim: tranche remaining 100'; end $$;
do $$ begin if not ((select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s join wos.entitlements n on n.id = s.source_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id)) = 10) then raise exception 'TRACE MISMATCH: E3 hold + claim: held 10'; end if; raise notice 'ok (trace): E3 hold + claim: held 10'; end $$;
do $$ begin if not ((select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100) = 400) then raise exception 'TRACE MISMATCH: E3 hold + claim: delivered 400'; end if; raise notice 'ok (trace): E3 hold + claim: delivered 400'; end $$;
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (103, 1000000000, 999999257, 0, 31, 212, 500, 100, 0, 'sha256:' || repeat('e', 64));
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (105, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    100, 2495248, 999999257, 0, 2000, 6, 4, 2);
insert into wos.task_budget_releases (task_id, reason) values ('00000000-0000-0000-0070-0000000000a3', 'expired');
do $$ begin if not ((select count(*) from wos.task_budget_releases where task_id in ('00000000-0000-0000-0070-0000000000a2', '00000000-0000-0000-0070-0000000000a3')) = 2 and not exists (select 1 from wos.task_budget_releases where task_id = '00000000-0000-0000-0070-0000000000a1')) then raise exception 'TRACE MISMATCH: E5 T1 accepted, T2 failed and T3 expired are the only ended budgets'; end if; raise notice 'ok (trace): E5 T1 accepted, T2 failed and T3 expired are the only ended budgets'; end $$;
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (105, 1000000000, 999999469, 0, 31, 0, 500, 100, 0, 'sha256:' || repeat('e', 64));
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (108, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    100, 2495249, 999999469, 0, 2000, 6, 4, 2);
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select 108, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = 108), 0), 3) i;
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values ('00000000-0000-0000-0070-0000000000e3', 108, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_matured', 'tranche', '00000000-0000-0000-0070-0000000000e2', 90, 1);
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(x.amount_base) from wos.entitlement_claims x where x.entitlement_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind in ('release_now', 'holdback_matured')) = 90) then raise exception 'TRACE MISMATCH: E8 mature the unheld part: claimable 90'; end if; raise notice 'ok (trace): E8 mature the unheld part: claimable 90'; end $$;
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(m.amount_base) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind = 'holdback_tranche') = 10) then raise exception 'TRACE MISMATCH: E8 mature the unheld part: tranche remaining 10'; end if; raise notice 'ok (trace): E8 mature the unheld part: tranche remaining 10'; end $$;
do $$ begin if not ((select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s join wos.entitlements n on n.id = s.source_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id)) = 10) then raise exception 'TRACE MISMATCH: E8 mature the unheld part: held 10'; end if; raise notice 'ok (trace): E8 mature the unheld part: held 10'; end $$;
do $$ begin if not ((select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100) = 400) then raise exception 'TRACE MISMATCH: E8 mature the unheld part: delivered 400'; end if; raise notice 'ok (trace): E8 mature the unheld part: delivered 400'; end $$;
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (108, 1000000000, 999999469, 0, 31, 0, 500, 10, 90, 'sha256:' || repeat('e', 64));
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
    values ('00000000-0000-0000-0070-00000000f002', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 90, wos.adapter_generation(), 'sha256:' || repeat('2', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0070-0000000000e3', '00000000-0000-0000-0070-00000000f002', 90);
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (109, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    100, 2495249, 999999469, 0, 2000, 6, 4, 2);
alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select 109, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = 109), 0), 3) i;
alter table wos.epoch_transitions enable trigger epoch_transitions_check;
insert into wos.confiscation_releases (confiscation_id, reason) values ('00000000-0000-0000-0070-0000000000f1', 'overturned');
insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values ('00000000-0000-0000-0070-0000000000e4', 109, 'person', '00000000-0000-0000-0000-00000000000b', 'holdback_matured', 'tranche', '00000000-0000-0000-0070-0000000000e2', 10, 2);
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(x.amount_base) from wos.entitlement_claims x where x.entitlement_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind in ('release_now', 'holdback_matured')) = 10) then raise exception 'TRACE MISMATCH: E9 hold released, remainder matured: claimable 10'; end if; raise notice 'ok (trace): E9 hold released, remainder matured: claimable 10'; end $$;
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(m.amount_base) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind = 'holdback_tranche') = 0) then raise exception 'TRACE MISMATCH: E9 hold released, remainder matured: tranche remaining 0'; end if; raise notice 'ok (trace): E9 hold released, remainder matured: tranche remaining 0'; end $$;
do $$ begin if not ((select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s join wos.entitlements n on n.id = s.source_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id)) = 0) then raise exception 'TRACE MISMATCH: E9 hold released, remainder matured: held 0'; end if; raise notice 'ok (trace): E9 hold released, remainder matured: held 0'; end $$;
do $$ begin if not ((select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100) = 490) then raise exception 'TRACE MISMATCH: E9 hold released, remainder matured: delivered 490'; end if; raise notice 'ok (trace): E9 hold released, remainder matured: delivered 490'; end $$;
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (109, 1000000000, 999999469, 0, 31, 0, 500, 0, 10, 'sha256:' || repeat('e', 64));
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
    values ('00000000-0000-0000-0070-00000000f003', 'devnet', 'person', '00000000-0000-0000-0000-00000000000b', repeat('3', 32), 10, wos.adapter_generation(), 'sha256:' || repeat('3', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0070-0000000000e4', '00000000-0000-0000-0070-00000000f003', 10);
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (110, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    100, 2495249, 999999469, 0, 2000, 6, 4, 2);
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(x.amount_base) from wos.entitlement_claims x where x.entitlement_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind in ('release_now', 'holdback_matured')) = 0) then raise exception 'TRACE MISMATCH: E10 everything claimed once: claimable 0'; end if; raise notice 'ok (trace): E10 everything claimed once: claimable 0'; end $$;
do $$ begin if not ((select coalesce(sum(n.amount_base - coalesce((select sum(m.amount_base) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and n.kind = 'holdback_tranche') = 0) then raise exception 'TRACE MISMATCH: E10 everything claimed once: tranche remaining 0'; end if; raise notice 'ok (trace): E10 everything claimed once: tranche remaining 0'; end $$;
do $$ begin if not ((select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s join wos.entitlements n on n.id = s.source_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100 and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id)) = 0) then raise exception 'TRACE MISMATCH: E10 everything claimed once: held 0'; end if; raise notice 'ok (trace): E10 everything claimed once: held 0'; end $$;
do $$ begin if not ((select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '00000000-0000-0000-0000-00000000000b' and n.epoch_number > 100) = 500) then raise exception 'TRACE MISMATCH: E10 everything claimed once: delivered 500'; end if; raise notice 'ok (trace): E10 everything claimed once: delivered 500'; end $$;
insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (110, 1000000000, 999999469, 0, 31, 0, 500, 0, 0, 'sha256:' || repeat('e', 64));
set constraints all deferred;
\echo 'lifecycle trace: engine and database agree at every checkpoint'

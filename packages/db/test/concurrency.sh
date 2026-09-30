#!/usr/bin/env bash
# Two-session races for migration 0007 (Astra review 03: A3-2, A3-4, A3-9 and the review-02 M14 residual).
# Run by scripts/test-migrations.sh after db-assertions.sql, in the same throwaway container. Each race holds the
# first session's transaction open while the second writes; the invariant is then checked on the committed state. Since
# D51 the money invariants are checked at COMMIT (deferred, serialized), so the later committer is the one refused.
# All four races were ACCEPTED (invariant broken) on the pre-fix migration: docs/protocol/reviews/ASTRA-REVIEW-03-repros-prefix.txt.
set -euo pipefail
NAME="$1"
DB="$2"
PSQL=(docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -t -A -U postgres -d "$DB")
B=00000000-0000-0000-0000-00000000000b
D=00000000-0000-0000-0000-00000000000d
E=00000000-0000-0000-0000-00000000000e
X=00000000-0000-0000-0020

"${PSQL[@]}" >/dev/null <<SQL
set session_replication_role = replica;
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions)
values (20, 'test', 'devnet', now() - interval '10 days', now() - interval '3 days', 48, 48, '{"reward": "reward-policy.v1"}');
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at) values
  (20, 1, null, 'OPEN', 'system', null, null, null, now() - interval '10 days'), (20, 2, 'OPEN', 'CALCULATING', 'system', null, null, null, now() - interval '3 days'),
  (20, 3, 'CALCULATING', 'PROPOSED', 'system', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64), 'sha256:' || repeat('3', 64), now() - interval '2 days'),
  (20, 4, 'PROPOSED', 'FINALIZED', 'system', null, null, null, now());
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, pool_key, weight_micro, amount_base, explanation, explanation_sha256)
select ('$X-0000000000a' || n)::uuid, 20, 'test', '$B', 'person', '$B', null, 'completion_payout', 'p', 1, amt, '{}', 'sha256:' || repeat('1', 64)
  from (values (1, 20), (2, 200), (3, 200), (4, 22)) v(n, amt);
set session_replication_role = origin;
insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base)
select ('$X-0000000000e' || n)::uuid, 20, 'person', '$B', 'release_now', 'allocation', ('$X-0000000000a' || n)::uuid, amt
  from (values (1, 10), (2, 100), (3, 100), (4, 11)) v(n, amt);
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
select ('$X-0000000000f' || n)::uuid, 'devnet', 'person', '$B', repeat('3', 32), amt, 1, 'sha256:' || repeat(n::text, 64)
  from (values (1, 10), (2, 10), (4, 11)) v(n, amt);
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('$X-0000000000e4', '$X-0000000000f4', 11);
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
values ('$X-0000000000c0', 'person', '$B', 60, 'race fixture',
        wos_test.aa('confiscate', 'confiscation', '$X-0000000000c0', '{"beneficiary_id": "$B", "proven_excess_base": 60}'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind, deadline_at) values ('$X-0000000000d0', 1, '$B', 20, 'offered', now() + interval '1 day');
-- D49: epoch 21 has room for one 3-ACU task (300 WOS of 500).
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base,
  reserve_snapshot_base, demand_forecast_acu_micro)
values (21, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{}', 100000000, 500000000, 10000000000, 0);
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (21, null, 'OPEN', 'system');
set session_replication_role = replica;
insert into wos.tasks (id, kind, state, role, abu_id) values ('$X-0000000000a1', 'abu_build', 'open', 'builder', gen_random_uuid()), ('$X-0000000000a2', 'abu_build', 'open', 'builder', gen_random_uuid());
set session_replication_role = origin;
insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values ('$X-0000000000b0', 'feature_criterion', 'race', 100000000, 'budget-model.v1');
-- Reviews 04/05 races: a confiscation executed while released (R04-4), task a3 (budget vs its proposer's lease), a 50/50
-- task allocated in two CALCULATING epochs (cross-epoch reservation). Fixtures a5/a6/c6 serve the dormant races (D55).
set session_replication_role = replica;
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, pool_key, weight_micro, amount_base, explanation, explanation_sha256) values
  ('$X-0000000000a5', 20, 'test', '$E', 'person', '$E', null, 'completion_payout', 'p', 1, 100000000, '{}', 'sha256:' || repeat('1', 64)),
  ('$X-0000000000a6', 20, 'test', '$D', 'person', '$D', null, 'completion_payout', 'p', 1, 1000000, '{}', 'sha256:' || repeat('1', 64));
insert into wos.tasks (id, kind, state, role, abu_id) values ('$X-0000000000a3', 'abu_build', 'open', 'builder', gen_random_uuid()), ('$X-0000000000a4', 'abu_build', 'open', 'builder', gen_random_uuid());
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions) values
  (22, 'test', 'devnet', now() - interval '9 days', now() - interval '2 days', 48, 48, '{}'), (23, 'test', 'devnet', now() - interval '9 days', now() - interval '2 days', 48, 48, '{}');
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) select e, 1, null, 'OPEN', 'system', now() - interval '9 days' from unnest(array[22, 23]) e;
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) select e, 2, 'OPEN', 'CALCULATING', 'system', now() - interval '1 day' from unnest(array[22, 23]) e;
set session_replication_role = origin;
insert into wos.dispute_gates (allocation_id, reply_deadline_at) values ('$X-0000000000a5', now() - interval '1 day');
insert into wos.dispute_item_resolutions (allocation_id, outcome, admin_action_id, resulting_amount_base, excess_base, recovered_base)
values ('$X-0000000000a5', 'CLIPPED', wos_test.aa('resolve_dispute', 'allocation', '$X-0000000000a5'), 60000000, 40000000, 0);
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
values ('$X-0000000000c5', 'person', '$D', 1000000, 'race fixture', wos_test.aa('confiscate', 'confiscation', '$X-0000000000c5', '{"beneficiary_id": "$D", "proven_excess_base": 1000000}'),
        now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours'),
       ('$X-0000000000c6', 'person', '$D', 1000000, 'race fixture', wos_test.aa('confiscate', 'confiscation', '$X-0000000000c6', '{"beneficiary_id": "$D", "proven_excess_base": 1000000}'),
        now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
values ('$X-0000000000a4', '$X-0000000000b0', 'execution', 1, 1, '{}', 'budget-model.v1', '$E', 21);  -- reserves 100
insert into wos.work_dedup_keys (dedup_key, source) values ('work:race:a4:b', 'receipt'), ('work:race:a4:d', 'receipt');
select wos_test.receipt('$X-0000000000e7', '$B', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 1, '$X-0000000000a4', 3333, 'work:race:a4:b', 21),
       wos_test.receipt('$X-0000000000e8', '$D', 'OTHER_PROTOCOL_APPROVED', 'execution', 'accepted_budget', 1, '$X-0000000000a4', 6667, 'work:race:a4:d', 21);
SQL

fail=0
race() { # label, first session (held open), second session, invariant query that must print ok
  local out1
  out1=$(mktemp)
  printf 'BEGIN;\n%s\nselect pg_sleep(2);\nCOMMIT;\n' "$2" | "${PSQL[@]}" >"$out1" 2>&1 &
  local first=$!
  sleep 0.7
  local second
  second=$(printf '%s\n' "$3" | "${PSQL[@]}" 2>&1 | grep -E '^ERROR' | head -1 || true)
  wait "$first" || true
  local verdict
  verdict=$(printf '%s\n' "$4" | "${PSQL[@]}" 2>&1 | tail -1)
  local firstmsg
  firstmsg=$(grep -E '^ERROR' "$out1" | head -1 || true)
  rm -f "$out1"
  if [ "$verdict" = "ok" ]; then
    echo "ok (race): $1 — first session: ${firstmsg:-committed}; second session: ${second:-committed}"
  else
    echo "RACE FAILED: $1 — invariant: $verdict"
    fail=1
  fi
}

race "A3-2: one entitlement claimed into two leaves concurrently" \
  "insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('$X-0000000000e1', '$X-0000000000f1', 10);" \
  "insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('$X-0000000000e1', '$X-0000000000f2', 10);" \
  "select case when count(*) = 1 then 'ok' else count(*) || ' live claims' end from wos.entitlement_claims where entitlement_id = '$X-0000000000e1';"
race "A3-4: two 50 holds against 60 proven excess concurrently" \
  "insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('$X-0000000000c0', 'unclaimed_entitlement', '$X-0000000000e2', 50);" \
  "insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('$X-0000000000c0', 'unclaimed_entitlement', '$X-0000000000e3', 50);" \
  "select case when sum(amount_base) <= 60 then 'ok' else sum(amount_base) || ' held against 60' end from wos.confiscation_sources where confiscation_id = '$X-0000000000c0';"
race "A3-9: a settlement attempt racing a pause and a migration snapshot" \
  "insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height) values ('$X-0000000000f4', 1, 1, '\\x44', 'sha256:' || repeat('4', 64), 'sig-race-4', 990);" \
  "insert into wos.settlement_adapter_events (action, adapter, trigger_kind, expires_at, admin_action_id) values ('pause', 'paused_accrual', 'security_incident', now() + interval '7 days', wos_test.aa('pause_settlement', 'settlement', 'paused_accrual', '{\"action\": \"pause\"}'));
   insert into wos.migration_snapshots (at_epoch, from_adapter, to_adapter, finalized_slot, body, snapshot_sha256) values (20, 'solana_wos', 'in_app_credits', 7777, '{}', 'sha256:' || repeat('7', 64));" \
  "select case when exists (select 1 from wos.migration_snapshots where finalized_slot = 7777)
                and exists (select 1 from wos.settlement_attempts a where a.leaf_id = '$X-0000000000f4' and not exists (select 1 from wos.settlement_outcomes o where o.leaf_id = a.leaf_id))
               then 'a snapshot was written beside an in-flight attempt' else 'ok' end;"
race "M14 (review 02): a duty offer ended twice concurrently" \
  "insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind) values ('$X-0000000000d0', 2, '$B', 20, 'completed');" \
  "insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind) values ('$X-0000000000d0', 3, '$B', 20, 'expired_no_fault');" \
  "select case when count(*) = 1 then 'ok' else count(*) || ' terminal events' end from wos.duty_events where offer_id = '$X-0000000000d0' and seq > 1;"
race "D49: two task issuances racing for the last epoch capacity" \
  "insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch) values ('$X-0000000000a1', '$X-0000000000b0', 'execution', 3000000, 3000000, '{}', 'budget-model.v1', '$B', 21);" \
  "insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch) values ('$X-0000000000a2', '$X-0000000000b0', 'execution', 3000000, 3000000, '{}', 'budget-model.v1', '$B', 21);" \
  "select case when sum(reserved_base) <= 500000000 then 'ok' else sum(reserved_base) || ' reserved against 500000000' end from wos.task_budgets where issued_epoch = 21;"
# R04-3 (stake vs hold) and R04-5 (appeal vs finalization) concern dormant modules (D55: dispute stakes, appeals):
# their pre-fix races are recorded in docs/protocol/reviews/ASTRA-REVIEW-04-05-repros-prefix.txt and deferred to activation.
race "R04-4: a confiscation executed while its hold is released" \
  "insert into wos.confiscation_executions (confiscation_id) values ('$X-0000000000c5');" \
  "insert into wos.confiscation_releases (confiscation_id, reason) values ('$X-0000000000c5', 'overturned');" \
  "select case when exists (select 1 from wos.confiscation_executions where confiscation_id = '$X-0000000000c5') and exists (select 1 from wos.confiscation_releases where confiscation_id = '$X-0000000000c5')
               then 'executed and released' else 'ok' end;"
race "B1/I5 (review 05): a budget racing its proposer's lease on the same task" \
  "insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch) values ('$X-0000000000a3', '$X-0000000000b0', 'execution', 1000000, 1000000, '{}', 'budget-model.v1', '$B', 21);" \
  "insert into wos.leases (task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at) values ('$X-0000000000a3', '$B', '00000000-0000-0000-0000-0000000000db', 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours');" \
  "select case when exists (select 1 from wos.task_budgets where task_id = '$X-0000000000a3') and exists (select 1 from wos.leases where task_id = '$X-0000000000a3')
               then 'a budget and a lease of the same task both committed' else 'ok' end;"
race "B2 (review 05): one task's reservation allocated in two epochs concurrently" \
  "select wos_test.alloc(gen_random_uuid(), 22, '$B', '$X-0000000000e7', 'execution', 34);" \
  "select wos_test.alloc(gen_random_uuid(), 23, '$D', '$X-0000000000e8', 'execution', 67);" \
  "select case when (select coalesce(sum(amount_base), 0) from wos.allocations where receipt_id in ('$X-0000000000e7', '$X-0000000000e8')) <= 100
               then 'ok' else (select sum(amount_base) from wos.allocations where receipt_id in ('$X-0000000000e7', '$X-0000000000e8')) || ' allocated against 100' end;"
[ "$fail" = 0 ] && echo "all concurrency races hold"
exit "$fail"

#!/usr/bin/env bash
# Two-session races for migration 0007 (Astra review 03: A3-2, A3-4, A3-9 and the review-02 M14 residual).
# Run by scripts/test-migrations.sh after db-assertions.sql, in the same throwaway container. Each race holds the
# first session's transaction open while the second writes; the invariant is then checked on the committed state.
# All four races were ACCEPTED (invariant broken) on the pre-fix migration: docs/protocol/reviews/ASTRA-REVIEW-03-repros-prefix.txt.
set -euo pipefail
NAME="$1"
DB="$2"
PSQL=(docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -q -t -A -U postgres -d "$DB")
B=00000000-0000-0000-0000-00000000000b
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
insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at)
values ('$X-0000000000c0', 'person', '$B', 60, 'race fixture',
        wos_test.aa('confiscate', 'confiscation', '$X-0000000000c0', '{"beneficiary_id": "$B", "proven_excess_base": 60}'), now() + interval '73 hours', now() + interval '242 hours');
insert into wos.duty_events (offer_id, seq, account_id, epoch_number, kind, deadline_at) values ('$X-0000000000d0', 1, '$B', 20, 'offered', now() + interval '1 day');
SQL

fail=0
race() { # label, first session (held open), second session, invariant query that must print ok
  printf 'BEGIN;\n%s\nselect pg_sleep(2);\nCOMMIT;\n' "$2" | "${PSQL[@]}" >/dev/null 2>&1 &
  local first=$!
  sleep 0.7
  local second
  second=$(printf '%s\n' "$3" | "${PSQL[@]}" 2>&1 | grep -E '^ERROR' | head -1 || true)
  wait "$first" || true
  local verdict
  verdict=$(printf '%s\n' "$4" | "${PSQL[@]}" 2>&1 | tail -1)
  if [ "$verdict" = "ok" ]; then
    echo "ok (race): $1 — second session: ${second:-committed}"
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
[ "$fail" = 0 ] && echo "all concurrency races hold"
exit "$fail"

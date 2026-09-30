#!/usr/bin/env bash
# Astra reviews 04 and 05: reproduce every SQL sequence against the CURRENT migration 0007 (run before and after the fix
# pass). Each sequence runs in its own transaction after the full db-assertions fixture and is rolled back.
#   ACCEPTED / REPRODUCED = the finding's sequence went through (or the honest case failed);
#   REJECTED = the database refused it (the message says why).
# Pre-fix output: docs/protocol/reviews/ASTRA-REVIEW-04-05-repros-prefix.txt. The two-session races are in
# packages/db/test/concurrency.sh.
cd "$(dirname "$0")/.." || exit 1
# The post-fix schema numbers partial releases (release_seq) and pins the envelope with the epoch; the pre-fix run used
# neither (its output is the prefix file). SEQCOL/SEQVAL add the second release's sequence number when the column exists.
if grep -q "release_seq" packages/db/migrations/0007_proof_of_contribution.sql; then SEQCOL=", release_seq"; SEQVAL=", 2"; ENVCOL=", reserve_snapshot_base, demand_forecast_acu_micro"; ENVVAL=", 10000000000, 0"
else SEQCOL=""; SEQVAL=""; ENVCOL=""; ENVVAL=""; fi
KEEP=1 bash packages/db/scripts/test-migrations.sh >/dev/null 2>&1 || echo "(assertions failed; container kept)"
C=$(docker ps --format '{{.Names}}' | grep wos-migrations-test | head -1)
PSQL=(docker exec -i "$C" psql -q -t -A -U postgres -d wos -v ON_ERROR_STOP=1)
A=00000000-0000-0000-0000-00000000000a; B=00000000-0000-0000-0000-00000000000b; D=00000000-0000-0000-0000-00000000000d; E=00000000-0000-0000-0000-00000000000e
Z=00000000-0000-0000-0045
run(){ local out; out=$(printf 'BEGIN;\nset constraints all immediate;\n%s\nROLLBACK;\n' "$2" | "${PSQL[@]}" 2>&1 | grep -v '^$' | grep -v '^ok' | grep -v '^NOTICE' | grep -v '^SET'); if grep -q '^ERROR' <<<"$out"; then echo "$1 => REJECTED: $(grep '^ERROR' <<<"$out" | head -1)"; else echo "$1 => $(tail -1 <<<"$out")"; fi; }
CALC="alter table wos.epoch_transitions disable trigger epoch_transitions_check;
insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions) values (31, 'test', 'devnet', now() - interval '9 days', now() - interval '2 days', 48, 48, '{}');
insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, at) values (31, 1, null, 'OPEN', 'system', now() - interval '9 days'), (31, 2, 'OPEN', 'CALCULATING', 'system', now() - interval '1 day');
alter table wos.epoch_transitions enable trigger epoch_transitions_check;"
ALLOC_D="set session_replication_role = replica;
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, pool_key, weight_micro, amount_base, explanation, explanation_sha256)
values ('$Z-0000000000a1', 3, 'test', '$D', 'person', '$D', null, 'completion_payout', 'p', 1, 1000000, '{}', 'sha256:' || repeat('1', 64)),
       ('$Z-0000000000a2', 3, 'test', '$E', 'person', '$E', null, 'completion_payout', 'p', 1, 100000000, '{}', 'sha256:' || repeat('1', 64));
set session_replication_role = origin;"
CONF="insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)"

echo "---- review 05 (B1a, B4, B6 and R04-11 are refused by rules the service must call — budgetRefusals, budgetReleaseRefusals,"
echo "     receiptRouteRefusals, genesisReferenceManifestRefusals — not by SQL (D51); R04-3 and R04-5 are dormant modules, D55)"
echo "---- review 05"
run "B1a a budget equal to a caller-supplied model 100x the policy model (2 size points = 8 ACU)" "insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values ('$Z-0000000000b1', 'feature_criterion', 'b1 probe', 1000000000, 'budget-model.v1');
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch) values (gen_random_uuid(), '$Z-0000000000b1', 'execution', 800000000, 800000000, '{\"taskKind\": \"abu_build\", \"sizePoints\": 2}', 'budget-model.v1', '$B', 2);
select 'ACCEPTED: 800 ACU budget for a 2-point build (policy model 8 ACU)';"
run "B1b two objectives with the same kind and ref, each funded in full" "insert into wos.acceptance_objectives (kind, ref, budget_acu_micro, budget_model_version) values ('feature_criterion', 'contacts: create and edit', 10000000, 'budget-model.v1'), ('feature_criterion', 'contacts: create and edit', 10000000, 'budget-model.v1');
select 'ACCEPTED: ' || count(*) || ' objectives for one criterion' from wos.acceptance_objectives where ref = 'contacts: create and edit';"
run "B2 a 60/40 task allocated wholly to one collaborator" "$CALC
select wos_test.alloc(gen_random_uuid(), 31, '$A', (select id from wos.contribution_receipts where task_id = '00000000-0000-0000-0007-000000000fb1' and account_id = '$A'), 'execution', 600000000);
select 'ACCEPTED: alice (40%) allocated the whole 600000000 reservation';"
run "B4 a budget released as expired four epochs before its expiry" "insert into wos.task_budget_releases (task_id, reason) values ('00000000-0000-0000-0007-000000000fb2', 'expired');
select 'ACCEPTED: released as expired; expires_epoch is ' || expires_epoch from wos.task_budgets where task_id = '00000000-0000-0000-0007-000000000fb2';"
run "B6 a human_review budget for an arbitrary id, paid by a HUMAN_REVIEW receipt with no review" "insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch) values ('$Z-0000000000f6', '00000000-0000-0000-0007-0000000000b1', 'human_review', 1000000, 1000000, '{}', 'budget-model.v1', '$A', 2);
insert into wos.work_dedup_keys (dedup_key, source) values ('work:b6', 'receipt');
select wos_test.receipt(gen_random_uuid(), '$D', 'HUMAN_REVIEW', 'human_review', 'accepted_budget', 1000000, '$Z-0000000000f6', 10000, 'work:b6', 2);
select 'ACCEPTED: HUMAN_REVIEW receipt paid from an arbitrary commissioned id, no human review row';"
run "B9 a 1 micro-ACU budget at 500000 base units per ACU (the engine reserves 0)" "insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions, issuance_rate_base_per_acu, task_capacity_base $ENVCOL) values (33, 'test', 'devnet', now() - interval '1 day', now() + interval '6 days', 48, 48, '{}', 500000, 1000000000 $ENVVAL);
insert into wos.epoch_transitions (epoch_number, from_state, to_state, actor) values (33, null, 'OPEN', 'system');
insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch) values ('$Z-0000000000f9', '00000000-0000-0000-0007-0000000000b1', 'execution', 1, 1, '{}', 'budget-model.v1', '$B', 33);
select case when reserved_base = 0 then 'FIXED: SQL reserves 0 like the engine' else 'REPRODUCED: SQL reserves ' || reserved_base || ', the engine 0' end from wos.task_budgets where task_id = '$Z-0000000000f9';"

echo "---- review 04 (and its carry-forward in review 05)"
run "R04-2 tranche 150: hold 10, mature the other 140, lift the hold, mature the restored 10" "set session_replication_role = replica;
insert into wos.allocations (id, epoch_number, mode, account_id, beneficiary_kind, beneficiary_id, receipt_id, slice, pool_key, weight_micro, amount_base, explanation, explanation_sha256)
values ('$Z-0000000000a3', 3, 'test', '$B', 'person', '$B', null, 'completion_payout', 'p', 1, 150, '{}', 'sha256:' || repeat('1', 64));
set session_replication_role = origin;
insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, matures_epoch) values ('$Z-0000000000e3', 3, 'person', '$B', 'holdback_tranche', 'allocation', '$Z-0000000000a3', 150, 9);
$CONF values ('$Z-0000000000c7', 'person', '$B', 10, 'r04-2', wos_test.aa('confiscate', 'confiscation', '$Z-0000000000c7'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('$Z-0000000000c7', 'holdback', '$Z-0000000000e3', 10);
insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base) values (3, 'person', '$B', 'holdback_matured', 'tranche', '$Z-0000000000e3', 140);
insert into wos.confiscation_releases (confiscation_id, reason) values ('$Z-0000000000c7', 'overturned');
insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base $SEQCOL) values (3, 'person', '$B', 'holdback_matured', 'tranche', '$Z-0000000000e3', 10 $SEQVAL);
select 'FIXED: the restored 10 matured in a second release';"
run "R04-3 one 1-WOS pending allocation used as a dispute stake and held for a confiscation" "$ALLOC_D
insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body) values (3, '$D', 1000000, '{}');
$CONF values ('$Z-0000000000c3', 'person', '$D', 1000000, 'r04-3', wos_test.aa('confiscate', 'confiscation', '$Z-0000000000c3'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('$Z-0000000000c3', 'pending_allocation', '$Z-0000000000a1', 1000000);
select 'ACCEPTED: 1000000 staked and 1000000 held against one 1000000 allocation';"
run "R04-3b the same, hold first then stake" "$ALLOC_D
$CONF values ('$Z-0000000000c3', 'person', '$D', 1000000, 'r04-3', wos_test.aa('confiscate', 'confiscation', '$Z-0000000000c3'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('$Z-0000000000c3', 'pending_allocation', '$Z-0000000000a1', 1000000);
insert into wos.allocation_disputes (epoch_number, disputer_account_id, stake_base, body) values (3, '$D', 1000000, '{}');
select 'ACCEPTED: held first, then staked in full';"
run "R04-4a a confiscation hold with an appeal window ten years long and no hold expiry" "$CONF values ('$Z-0000000000c8', 'person', '$B', 10, 'r04-4', wos_test.aa('confiscate', 'confiscation', '$Z-0000000000c8'), now() + interval '73 hours', now() + interval '10 years', 'infinity');
select 'ACCEPTED: hold until ' || hold_expires_at from wos.confiscations where id = '$Z-0000000000c8';"
run "R04-4b a lapsed hold released and the same confiscation executed" "$CONF values ('$Z-0000000000c8', 'person', '$B', 10, 'r04-4', wos_test.aa('confiscate', 'confiscation', '$Z-0000000000c8'), now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');
insert into wos.confiscation_releases (confiscation_id, reason) values ('$Z-0000000000c8', 'lapsed');
insert into wos.confiscation_executions (confiscation_id) values ('$Z-0000000000c8');
select 'ACCEPTED: released as lapsed (before its hold expiry) and executed';"
run "R04-5 an appeal accepted after the allocation's money was entitled" "$ALLOC_D
insert into wos.dispute_gates (allocation_id, reply_deadline_at) values ('$Z-0000000000a2', now() - interval '1 day');
insert into wos.dispute_item_resolutions (allocation_id, outcome, admin_action_id, resulting_amount_base, excess_base, recovered_base) values ('$Z-0000000000a2', 'CLIPPED', wos_test.aa('resolve_dispute', 'allocation', '$Z-0000000000a2'), 60000000, 40000000, 0);
insert into wos.entitlements (epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base) values (3, 'person', '$E', 'release_now', 'allocation', '$Z-0000000000a2', 48000000);
insert into wos.dispute_appeals (allocation_id, appellant_account_id, statement_untrusted) values ('$Z-0000000000a2', '$E', 'the clip ignored the CI evidence I attached');
select 'ACCEPTED: appeal filed after the allocation was entitled';"
run "R04-8 expiry declared with an observation that says the transaction finalized" "set session_replication_role = replica;
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256) values ('$Z-0000000000f8', 'devnet', 'person', '$B', repeat('3', 32), 5, 1, 'sha256:' || repeat('8', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e002', '$Z-0000000000f8', 5);
set session_replication_role = origin;
insert into wos.settlement_adapter_events (action, adapter, trigger_kind, safety_confirmation, admin_action_id) values ('resume', 'solana_wos', 'security_incident', 'race fixture pause closed: nothing in flight', wos_test.aa('resume_settlement', 'settlement', 'solana_wos'));
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height) values ('$Z-0000000000f8', 1, 1, '\x88', 'sha256:' || repeat('8', 64), 'sig-r048', 100);
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation) values ('$Z-0000000000f8', 1, 'expired_not_landed', true, 101, '{\"signature\": \"sig-r048\", \"cluster\": \"devnet\", \"searchTransactionHistory\": true, \"value\": [{\"confirmationStatus\": \"finalized\", \"err\": null, \"slot\": 5}]}');
select 'ACCEPTED: expired_not_landed recorded over an observation of a finalized transaction';"
run "R04-8b expiry declared with an empty observation" "set session_replication_role = replica;
insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256) values ('$Z-0000000000f8', 'devnet', 'person', '$B', repeat('3', 32), 5, 1, 'sha256:' || repeat('8', 64));
insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('00000000-0000-0000-0000-00000000e002', '$Z-0000000000f8', 5);
set session_replication_role = origin;
insert into wos.settlement_adapter_events (action, adapter, trigger_kind, safety_confirmation, admin_action_id) values ('resume', 'solana_wos', 'security_incident', 'race fixture pause closed: nothing in flight', wos_test.aa('resume_settlement', 'settlement', 'solana_wos'));
insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height) values ('$Z-0000000000f8', 1, 1, '\x88', 'sha256:' || repeat('8', 64), 'sig-r048', 100);
insert into wos.settlement_outcomes (leaf_id, attempt, outcome, history_checked, observed_block_height, status_observation) values ('$Z-0000000000f8', 1, 'expired_not_landed', true, 101, '{}');
select 'ACCEPTED: expired_not_landed recorded over {}';"
run "R04-11 a Genesis reference manifest listing one receipt twice" "insert into wos.genesis_reference_manifests (version, cutoff_epoch, rules, receipt_ids, manifest_sha256, admin_action_id) values ('reference.v2', 2, '{\"types\": [\"PROPOSAL\"]}', '{00000000-0000-0000-0000-0000000cc002,00000000-0000-0000-0000-0000000cc002}', 'sha256:' || repeat('e', 64), wos_test.aa('approve_genesis_reference', 'genesis_reference', 'reference.v2'));
select 'ACCEPTED: ' || cardinality(receipt_ids) || ' ids, ' || (select count(distinct x) from unnest(receipt_ids) x) || ' distinct' from wos.genesis_reference_manifests where version = 'reference.v2';"
docker rm -f "$C" >/dev/null

// The ACCOUNTING-PROJECTION differential trace (review 06; renamed and tightened after review 07 R07-3).
//
// What it is: one scenario run through the ENGINE and through the DATABASE (migration 0007), in which every engine output
// is written through the database's invariants and, at each checkpoint, balances DERIVED FROM THE DATABASE'S SOURCE
// RECORDS are compared with the engine state. What it is NOT: the full acceptance path (lease -> snapshot ->
// qualification -> challenge is covered by the rule tests and db assertions, not here), and it does not reconstruct
// completion pools or the security reserve independently (the database stores them only as rows written from engine
// output); the epoch_balances rows it writes exercise the funding CHECK only and are never counted as verification.
//
// Scenario: issue 4 tasks at the frozen envelope -> T1 submitted on time (changeset evidence) -> accept T1 (alice) and T4
// (bob + dave, 50/50 of an odd reservation) -> release T2 (failed, never submitted) -> hold 10 of alice's tranche ->
// claim her release into a leaf, broadcast and CONFIRM it -> T3 expires -> the unheld 90 mature -> claim them into a leaf
// that is never broadcast and is VOIDED -> claim again and confirm -> release the hold -> the remaining 10 mature ->
// claim and confirm. The engine counts delivery only on a confirmed settlement.
//
// Usage (test-migrations.sh, after the assertions and races): node --experimental-strip-types
//   packages/db/test/accounting-trace.mjs | docker exec -i <container> psql -v ON_ERROR_STOP=1 -q -U postgres -d <db>
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.startsWith("file:")) {
      const u = new URL(`${spec.slice(0, -3)}.ts`, ctx.parentURL);
      if (existsSync(fileURLToPath(u))) return next(u.href, ctx);
    }
    return next(spec, ctx);
  },
});
const E = await import(new URL("packages/contracts/src/protocol/engine.ts", root).href);
const read = (n) => JSON.parse(readFileSync(new URL(`packages/contracts/src/protocol/data/${n}.v1.json`, root), "utf8"));
const p = {
  ...E.engineParamsFrom(read("reward-policy"), read("completion-policy")),
  emissionReserve: 1_000_000_000n,
  rateCeilingInitialBasePerAcu: 100n,
  rateCeilingDecayPpm: 0n,
  holdbackBp: 2000n,
  holdbackEpochs: 6,
  budgetExpiryEpochs: 4,
  reviewGraceEpochs: 2,
};

const OFF = 100; // SQL epoch = OFF + engine epoch
const ALICE = "00000000-0000-0000-0000-00000000000b"; // bound devnet wallet repeat('3', 32) in the fixtures
const BOB = "00000000-0000-0000-0000-00000000000a";
const DAVE = "00000000-0000-0000-0000-00000000000d";
const EVE = "00000000-0000-0000-0000-00000000000e"; // the proposer, unrelated to the builders
const T = {
  t1: "00000000-0000-0000-0070-0000000000a1",
  t2: "00000000-0000-0000-0070-0000000000a2",
  t3: "00000000-0000-0000-0070-0000000000a3",
  t4: "00000000-0000-0000-0070-0000000000a4",
};
const OBJ = "00000000-0000-0000-0070-0000000000b0";
const TRACE_EPOCHS = `epoch_number > ${OFF} and epoch_number < ${OFF + 100}`;
const out = [];
const sql = (s) => out.push(s);
let checks = 0;
const check = (label, cond) => {
  checks += 1;
  sql(`do $$ begin if not (${cond}) then raise exception 'TRACE MISMATCH: ${label}'; end if; raise notice 'ok (trace): ${label}'; end $$;`);
};

let state = E.initialState(p.emissionReserve);
const consumed = new Set();
function run(e, input) {
  const r = E.computeEpoch({ epochNumber: e, state, consumedIds: new Set(consumed), ...input }, p);
  for (const id of r.consumedIds) consumed.add(id);
  state = r.state;
  return r;
}
function epochRow(e, env) {
  sql(`insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (${OFF + e}, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "reward-policy.v1"}',
    ${env.rate}, ${env.taskCapacity}, ${env.reserveSnapshot}, ${env.demandForecastAcuMicro}, ${p.holdbackBp}, ${p.holdbackEpochs}, ${p.budgetExpiryEpochs}, ${p.reviewGraceEpochs});`);
}
const STATES = ["OPEN", "CALCULATING", "PROPOSED", "FINALIZED"];
function moveTo(e, target) {
  // Fixture transitions (the windows are exercised by the db assertions): the epoch walks OPEN -> ... -> target.
  const upto = STATES.indexOf(target);
  sql("alter table wos.epoch_transitions disable trigger epoch_transitions_check;");
  sql(`insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select ${OFF + e}, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = ${OFF + e}), 0), ${upto}) i;`);
  sql("alter table wos.epoch_transitions enable trigger epoch_transitions_check;");
}
function fundingRow(e) {
  // Exercises the epoch_balances funding CHECK with the engine's numbers; NOT a verification (see the header).
  const s = state;
  const sum = (m) => [...m.values()].reduce((t, v) => t + v, 0n);
  const q = [...s.reserved.values()].reduce((t, r) => t + E.reservationTotal(r), 0n);
  const held = s.holdback.reduce((t, x) => t + x.amount, 0n);
  sql(`insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (${OFF + e}, ${p.emissionReserve}, ${s.remainingReserve}, ${sum(s.poolBalances)}, ${s.securityReserve}, ${q}, ${s.cumulativeIssued}, ${held}, ${sum(s.claimable)}, 'sha256:' || repeat('e', 64));`);
}

// ---- projections DERIVED from the database's source records (never from a copy of an engine balance)
const tr = `n.${TRACE_EPOCHS.replace(/epoch_number/g, "epoch_number")}`;
const liveClaim = "not exists (select 1 from wos.leaf_voids v where v.leaf_id = x.leaf_id)";
const confirmedClaim = "exists (select 1 from wos.settlement_outcomes o where o.leaf_id = x.leaf_id and o.outcome = 'confirmed')";
const deliveredSql = (
  who,
) => `(select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '${who}' and ${tr} and ${liveClaim} and ${confirmedClaim})`;
const pendingSql = (
  who,
) => `(select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '${who}' and ${tr} and ${liveClaim} and not ${confirmedClaim})`;
// The engine's claimable = released (release_now + matured) entitlements not yet DELIVERED (pending claims stay owned).
const claimableSql = (who) => `((select coalesce(sum(n.amount_base), 0) from wos.entitlements n where n.beneficiary_id = '${who}' and ${tr}
   and n.kind in ('release_now', 'holdback_matured')) - ${deliveredSql(who)})`;
const trancheSql = (
  who,
) => `(select coalesce(sum(n.amount_base - coalesce((select sum(m.amount_base) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '${who}' and ${tr} and n.kind = 'holdback_tranche')`;
const heldSql = (
  who,
) => `(select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s join wos.entitlements n on n.id = s.source_id
   where n.beneficiary_id = '${who}' and ${tr} and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id))`;
const issuedSql = `(select coalesce(sum(amount_base), 0) from wos.allocations where ${TRACE_EPOCHS})`;
const openReservationsSql = `(select coalesce(sum(b.reserved_base), 0) from wos.task_budgets b where b.task_id in ('${Object.values(T).join("','")}')
   and not exists (select 1 from wos.task_budget_releases r where r.task_id = b.task_id)
   and not exists (select 1 from wos.contribution_receipts c where c.task_id = b.task_id))`;
function compare(label, pending = 0n) {
  const tranche = state.holdback.filter((t) => t.beneficiaryId === ALICE).reduce((t, x) => t + x.amount, 0n);
  const held = [...state.holds.values()].filter((h) => h.beneficiaryId === ALICE).reduce((t, h) => t + h.amount, 0n);
  const openRes = [...state.reserved.values()].reduce((t, r) => t + r.amount, 0n);
  check(`${label}: alice claimable ${state.claimable.get(ALICE) ?? 0n}`, `${claimableSql(ALICE)} = ${state.claimable.get(ALICE) ?? 0n}`);
  check(`${label}: alice delivered (confirmed settlements) ${state.delivered}`, `${deliveredSql(ALICE)} = ${state.delivered}`);
  check(`${label}: alice pending in unconfirmed leaves ${pending}`, `${pendingSql(ALICE)} = ${pending}`);
  check(`${label}: alice tranche remaining ${tranche}, held ${held}`, `${trancheSql(ALICE)} = ${tranche} and ${heldSql(ALICE)} = ${held}`);
  check(`${label}: issued ${state.cumulativeIssued}`, `${issuedSql} = ${state.cumulativeIssued}`);
  check(`${label}: open reservations (budget part) ${openRes}`, `${openReservationsSql} = ${openRes}`);
}
let leafN = 0;
function reserveLeaf(entitlements, amount) {
  leafN += 1;
  const leaf = `00000000-0000-0000-0070-00000000f0${String(leafN).padStart(2, "0")}`;
  sql(`insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
    values ('${leaf}', 'devnet', 'person', '${ALICE}', repeat('3', 32), ${amount}, wos.adapter_generation(), 'sha256:' || repeat('${leafN % 10}', 64));`);
  for (const [id, amt] of entitlements)
    sql(`insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('${id}', '${leaf}', ${amt});`);
  return { leaf, amount };
}
function confirm(l) {
  const sig = `sig-trace-${leafN}-${l.leaf.slice(-4)}`;
  sql(`insert into wos.settlement_attempts (leaf_id, attempt, adapter_generation, signed_tx, signed_tx_sha256, signature, last_valid_block_height)
    values ('${l.leaf}', 1, wos.adapter_generation(), '\\x01', 'sha256:' || repeat('a', 64), '${sig}', 1000);`);
  sql(`insert into wos.settlement_outcomes (leaf_id, attempt, outcome, commitment, history_checked, slot, status_observation)
    values ('${l.leaf}', 1, 'confirmed', 'finalized', true, 77, jsonb_build_object('signature', '${sig}', 'cluster', 'devnet', 'searchTransactionHistory', true,
      'value', jsonb_build_array(jsonb_build_object('confirmationStatus', 'finalized', 'err', null, 'slot', 77))));`);
  return { id: `delivered-${l.leaf}`, beneficiaryId: ALICE, amount: l.amount };
}
function voidLeaf(l) {
  sql(`insert into wos.leaf_voids (leaf_id, admin_action_id) values ('${l.leaf}', wos_test.aa('void_leaf', 'leaf', '${l.leaf}'));`);
}

sql("\\echo 'accounting-projection trace: engine vs database'");
sql("set constraints all immediate;");
// Settlement may have been paused by an earlier race; resume it (a public, safety-confirmed admin event).
sql(`insert into wos.settlement_adapter_events (action, adapter, trigger_kind, safety_confirmation, admin_action_id)
  values ('resume', 'solana_wos', 'security_incident', 'trace: no attempt in flight; resuming for the accounting trace', wos_test.aa('resume_settlement', 'settlement', 'solana_wos'));`);
sql(
  `insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values ('${OBJ}', 'feature_criterion', 'accounting trace', 20000000, 'budget-model.v1');`,
);

// E1: issue four tasks at the frozen envelope; T1's work is submitted on time (its changeset is the evidence).
const issue = (taskId, micro) => ({
  taskId,
  kind: "execution",
  budgetAcuMicro: BigInt(micro),
  featurePoolKeys: ["trace/feature"],
  applicationPoolKeys: ["trace"],
});
const budgets = { t1: 5_000_000, t2: 3_000_000, t3: 2_000_000, t4: 1_050_000 };
const env1 = E.openEpoch(state, 1, 0n, p);
const r1 = run(1, { issuances: Object.entries(budgets).map(([k, m]) => issue(T[k], m)), submissions: [{ taskId: T.t1 }] });
epochRow(1, env1);
moveTo(1, "OPEN");
for (const [k, m] of Object.entries(budgets))
  sql(`insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
    values ('${T[k]}', '${OBJ}', 'execution', ${m}, ${m}, '{}', 'budget-model.v1', '${EVE}', ${OFF + 1});`);
sql(
  `insert into wos.task_submissions (task_id, changeset_id) values ('${T.t1}', wos_test.changeset(gen_random_uuid(), '${T.t1}', clock_timestamp()));`,
);
for (const k of Object.keys(budgets)) {
  const res = r1.state.reserved.get(T[k]);
  check(
    `E1 ${k}: reservation ${res.amount} (floored in both layers), expiry ${OFF + res.expiresAtEpoch}, grace ${res.reviewGraceEpochs}`,
    `(select reserved_base = ${res.amount} and expires_epoch = ${OFF + res.expiresAtEpoch} and review_grace_epochs = ${res.reviewGraceEpochs} from wos.task_budgets where task_id = '${T[k]}')`,
  );
}
compare("E1 issued");
fundingRow(1);

// E2: accept T1 (alice) and T4 (bob and dave, 50/50 of an odd 105); release T2 as failed (never submitted).
const env2 = E.openEpoch(state, 2, 0n, p);
const r2 = run(2, {
  acceptances: [
    { taskId: T.t1, shares: [{ accountId: ALICE, beneficiaryId: ALICE, shareBp: 10000 }] },
    { taskId: T.t4, shares: [BOB, DAVE].map((a) => ({ accountId: a, beneficiaryId: a, shareBp: 5000 })) },
  ],
  releases: [{ taskId: T.t2 }],
});
if ((state.poolBalances.get("trace/feature") ?? 0n) === 0n) throw new Error("accepted work should have funded its completion pool");
epochRow(2, env2);
moveTo(2, "OPEN");
const receipts = [
  ["c1", ALICE, T.t1, budgets.t1, 10000],
  ["c4", BOB, T.t4, budgets.t4, 5000],
  ["c5", DAVE, T.t4, budgets.t4, 5000],
];
for (const [rid] of receipts) {
  sql(`insert into wos.work_dedup_keys (dedup_key, source) values ('work:trace:${rid}', 'receipt');`);
}
sql(
  `select ${receipts
    .map(
      ([rid, who, task, m, share]) =>
        `wos_test.receipt('00000000-0000-0000-0070-0000000000${rid}', '${who}', 'IMPLEMENTATION', 'execution', 'accepted_budget', ${m}, '${task}', ${share}, 'work:trace:${rid}', ${OFF + 2})`,
    )
    .join(", ")};`,
);
sql(`insert into wos.task_budget_releases (task_id, reason) values ('${T.t2}', 'failed');`);
moveTo(2, "CALCULATING");
const allocId = {
  c1: "00000000-0000-0000-0070-0000000000d1",
  c4: "00000000-0000-0000-0070-0000000000d4",
  c5: "00000000-0000-0000-0070-0000000000d5",
};
for (const [rid, who, task] of receipts) {
  const line = r2.allocations.find((a) => a.receiptId === task && a.accountId === who);
  sql(
    `select wos_test.alloc('${allocId[rid]}', ${OFF + 2}, '${who}', '00000000-0000-0000-0070-0000000000${rid}', 'execution', ${line.amountBase});`,
  );
}
check(
  "E2 the odd 105 of T4 split 53/52 by the shared function, accepted by the per-receipt bound",
  `(select array_agg(amount_base order by account_id) = array[${[BOB, DAVE].map((a) => r2.allocations.find((l) => l.receiptId === T.t4 && l.accountId === a).amountBase).join(",")}]::bigint[] from wos.allocations where id in ('${allocId.c4}', '${allocId.c5}'))`,
);
moveTo(2, "FINALIZED");
const ent2 = r2.entitlements.get(ALICE);
const E_NOW = "00000000-0000-0000-0070-0000000000e1";
const E_TR = "00000000-0000-0000-0070-0000000000e2";
sql(`insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base) values
  ('${E_NOW}', ${OFF + 2}, 'person', '${ALICE}', 'release_now', 'allocation', '${allocId.c1}', ${ent2.releasedNow}),
  ('${E_TR}', ${OFF + 2}, 'person', '${ALICE}', 'holdback_tranche', 'allocation', '${allocId.c1}', ${ent2.heldBack});`);
const aliceTranche = () => state.holdback.find((t) => t.beneficiaryId === ALICE);
check(
  `E2 tranche matures at ${OFF + aliceTranche().maturesAtEpoch}`,
  `(select matures_epoch from wos.entitlements where id = '${E_TR}') = ${OFF + aliceTranche().maturesAtEpoch}`,
);
compare("E2 accepted");
fundingRow(2);

// E3: a simple hold of 10 on alice's tranche; her release is claimed into a leaf, broadcast and CONFIRMED.
const env3 = E.openEpoch(state, 3, 0n, p);
sql(`insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
  values ('00000000-0000-0000-0070-0000000000f1', 'person', '${ALICE}', 10, 'accounting trace hold', wos_test.aa('confiscate', 'confiscation', 'trace'),
          now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');`);
sql(
  `insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('00000000-0000-0000-0070-0000000000f1', 'holdback', '${E_TR}', 10);`,
);
const l1 = reserveLeaf([[E_NOW, ent2.releasedNow]], ent2.releasedNow);
const d1 = confirm(l1);
run(3, { holds: [{ id: "h1", beneficiaryId: ALICE, source: "tranche", trancheId: aliceTranche().trancheId, amount: 10n }], claims: [d1] });
epochRow(3, env3);
compare("E3 hold + confirmed delivery");
fundingRow(3);

// E5: T3 was never submitted and expires (issue epoch + 4).
const env5 = E.openEpoch(state, 5, 0n, p);
const r5 = run(5, {});
if (!r5.expired.includes(T.t3)) throw new Error("engine did not expire T3 at epoch 5");
epochRow(5, env5);
sql(`insert into wos.task_budget_releases (task_id, reason) values ('${T.t3}', 'expired');`);
compare("E5 T3 expired");
fundingRow(5);

// E8: the tranche matures: only the unheld 90. They are claimed into a leaf that is never broadcast (PENDING).
const env8 = E.openEpoch(state, 8, 0n, p);
const r8 = run(8, {});
const matured8 = r8.entitlements.get(ALICE).maturedHoldback;
const E_M1 = "00000000-0000-0000-0070-0000000000e3";
epochRow(8, env8);
moveTo(8, "FINALIZED");
sql(`insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values ('${E_M1}', ${OFF + 8}, 'person', '${ALICE}', 'holdback_matured', 'tranche', '${E_TR}', ${matured8}, 1);`);
const l2 = reserveLeaf([[E_M1, matured8]], matured8);
compare("E8 unheld 90 matured; a pending, unbroadcast leaf holds them", matured8);
// The pending leaf is VOIDED (never broadcast): nothing was delivered and the 90 are claimable again.
voidLeaf(l2);
compare("E8 the pending leaf is voided: nothing delivered, still claimable");
fundingRow(8);

// E9: claim the 90 again and confirm; the hold is released; the remaining 10 mature (release 2).
const env9 = E.openEpoch(state, 9, 0n, p);
const l3 = reserveLeaf([[E_M1, matured8]], matured8);
const d3 = confirm(l3);
const r9 = run(9, { claims: [d3], holdReleases: [{ holdId: "h1" }] });
epochRow(9, env9);
moveTo(9, "FINALIZED");
sql(`insert into wos.confiscation_releases (confiscation_id, reason) values ('00000000-0000-0000-0070-0000000000f1', 'overturned');`);
const matured9 = r9.entitlements.get(ALICE).maturedHoldback;
const E_M2 = "00000000-0000-0000-0070-0000000000e4";
sql(`insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values ('${E_M2}', ${OFF + 9}, 'person', '${ALICE}', 'holdback_matured', 'tranche', '${E_TR}', ${matured9}, 2);`);
compare("E9 re-claimed and confirmed; hold released; remainder matured");
fundingRow(9);

// E10: the remaining 10 are claimed and confirmed: everything alice was allocated is delivered exactly once.
const env10 = E.openEpoch(state, 10, 0n, p);
const d4 = confirm(reserveLeaf([[E_M2, matured9]], matured9));
run(10, { claims: [d4] });
epochRow(10, env10);
compare("E10 everything delivered once");
fundingRow(10);
const allocated = r2.allocations.find((a) => a.receiptId === T.t1).amountBase;
if (state.delivered !== allocated) throw new Error(`engine delivered ${state.delivered}, allocated ${allocated}`);
sql("set constraints all deferred;");
sql(`\\echo 'accounting-projection trace: engine and database agree at every checkpoint (${checks} checks)'`);
console.log(out.join("\n"));

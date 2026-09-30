// Review 06: ONE end-to-end differential trace of the active V1 lifecycle, run through the ENGINE and through the
// DATABASE (migration 0007), which must accept every engine output and end in the same balances:
//   issue (3 tasks) -> on-time submit -> accept -> release (failed) -> expire -> hold 10 of a tranche -> mature the
//   unheld 90 -> claim -> release the hold -> mature the restored 10 -> claim.
// Usage (from test-migrations.sh, after db-assertions and the races): node --experimental-strip-types
//   packages/db/test/lifecycle-trace.mjs | docker exec -i <container> psql -v ON_ERROR_STOP=1 -q -U postgres -d <db>
// It prints SQL: the service's writes of each engine output, then a check per checkpoint comparing SQL-derived balances
// with the engine state (a mismatch or any refused write stops psql with an error).
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
const ALICE = "00000000-0000-0000-0000-00000000000b"; // has a bound devnet wallet in the fixtures
const EVE = "00000000-0000-0000-0000-00000000000e"; // proposer, unrelated to alice
const T = {
  t1: "00000000-0000-0000-0070-0000000000a1",
  t2: "00000000-0000-0000-0070-0000000000a2",
  t3: "00000000-0000-0000-0070-0000000000a3",
};
const OBJ = "00000000-0000-0000-0070-0000000000b0";
const out = [];
const sql = (s) => out.push(s);
const check = (label, cond) =>
  sql(`do $$ begin if not (${cond}) then raise exception 'TRACE MISMATCH: ${label}'; end if; raise notice 'ok (trace): ${label}'; end $$;`);

let state = E.initialState(p.emissionReserve);
const consumed = new Set();
const results = {};
function run(e, input) {
  const r = E.computeEpoch({ epochNumber: e, state, consumedIds: new Set(consumed), ...input }, p);
  for (const id of r.consumedIds) consumed.add(id);
  state = r.state;
  results[e] = r;
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
  // Fixture transitions (the windows are exercised elsewhere): the epoch walks OPEN -> ... -> target.
  const upto = STATES.indexOf(target);
  sql("alter table wos.epoch_transitions disable trigger epoch_transitions_check;");
  sql(`insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select ${OFF + e}, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = ${OFF + e}), 0), ${upto}) i;`);
  sql("alter table wos.epoch_transitions enable trigger epoch_transitions_check;");
}
function balances(e) {
  const s = state;
  const sum = (m) => [...m.values()].reduce((t, v) => t + v, 0n);
  const q = [...s.reserved.values()].reduce((t, r) => t + E.reservationTotal(r), 0n);
  const held = s.holdback.reduce((t, x) => t + x.amount, 0n);
  sql(`insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
    values (${OFF + e}, ${p.emissionReserve}, ${s.remainingReserve}, ${sum(s.poolBalances)}, ${s.securityReserve}, ${q}, ${s.cumulativeIssued}, ${held}, ${sum(s.claimable)}, 'sha256:' || repeat('e', 64));`);
}
const aliceClaimableSql = `(select coalesce(sum(n.amount_base - coalesce((select sum(x.amount_base) from wos.entitlement_claims x where x.entitlement_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '${ALICE}' and n.epoch_number > ${OFF} and n.kind in ('release_now', 'holdback_matured'))`;
const aliceTrancheSql = `(select coalesce(sum(n.amount_base - coalesce((select sum(m.amount_base) from wos.entitlements m where m.source_kind = 'tranche' and m.source_id = n.id), 0)), 0)
   from wos.entitlements n where n.beneficiary_id = '${ALICE}' and n.epoch_number > ${OFF} and n.kind = 'holdback_tranche')`;
const aliceDeliveredSql = `(select coalesce(sum(x.amount_base), 0) from wos.entitlement_claims x join wos.entitlements n on n.id = x.entitlement_id
   where n.beneficiary_id = '${ALICE}' and n.epoch_number > ${OFF})`;
const aliceHeldSql = `(select coalesce(sum(s.amount_base), 0) from wos.confiscation_sources s join wos.entitlements n on n.id = s.source_id
   where n.beneficiary_id = '${ALICE}' and n.epoch_number > ${OFF} and not exists (select 1 from wos.confiscation_releases r where r.confiscation_id = s.confiscation_id))`;
function compareOwnership(label) {
  const trancheAmt = state.holdback.filter((t) => t.beneficiaryId === ALICE).reduce((t, x) => t + x.amount, 0n);
  const held = [...state.holds.values()].filter((h) => h.beneficiaryId === ALICE).reduce((t, h) => t + h.amount, 0n);
  check(`${label}: claimable ${state.claimable.get(ALICE) ?? 0n}`, `${aliceClaimableSql} = ${state.claimable.get(ALICE) ?? 0n}`);
  check(`${label}: tranche remaining ${trancheAmt}`, `${aliceTrancheSql} = ${trancheAmt}`);
  check(`${label}: held ${held}`, `${aliceHeldSql} = ${held}`);
  check(`${label}: delivered ${state.delivered}`, `${aliceDeliveredSql} = ${state.delivered}`);
}
let leafN = 0;
function claim(e, entitlementIds, amount) {
  leafN += 1;
  const leaf = `00000000-0000-0000-0070-00000000f0${String(leafN).padStart(2, "0")}`;
  sql(`insert into wos.claim_leaves (id, cluster, beneficiary_kind, beneficiary_id, wallet, amount_base, adapter_generation, leaf_sha256)
    values ('${leaf}', 'devnet', 'person', '${ALICE}', repeat('3', 32), ${amount}, wos.adapter_generation(), 'sha256:' || repeat('${leafN % 10}', 64));`);
  for (const [id, amt] of entitlementIds)
    sql(`insert into wos.entitlement_claims (entitlement_id, leaf_id, amount_base) values ('${id}', '${leaf}', ${amt});`);
  return { id: `claim-${e}-${leafN}`, beneficiaryId: ALICE, amount };
}

sql("\\echo 'lifecycle trace: engine vs database (review 06)'");
sql("set constraints all immediate;");
sql(
  `insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values ('${OBJ}', 'feature_criterion', 'lifecycle trace', 20000000, 'budget-model.v1');`,
);

// E1: issue three tasks at the frozen envelope; T1's work is submitted on time.
const issue = (taskId, acu) => ({
  taskId,
  kind: "execution",
  budgetAcuMicro: BigInt(acu) * 1_000_000n,
  featurePoolKeys: [],
  applicationPoolKeys: [],
});
const env1 = E.openEpoch(state, 1, 0n, p);
const r1 = run(1, { issuances: [issue(T.t1, 5), issue(T.t2, 3), issue(T.t3, 2)], submissions: [{ taskId: T.t1 }] });
epochRow(1, env1);
moveTo(1, "OPEN");
for (const [k, acu] of [
  ["t1", 5],
  ["t2", 3],
  ["t3", 2],
])
  sql(`insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
    values ('${T[k]}', '${OBJ}', 'execution', ${acu * 1_000_000}, ${acu * 1_000_000}, '{}', 'budget-model.v1', '${EVE}', ${OFF + 1});`);
sql(
  `insert into wos.task_submissions (task_id, submitted_epoch, submission_sha256) values ('${T.t1}', ${OFF + 1}, 'sha256:' || repeat('a', 64));`,
);
for (const k of ["t1", "t2", "t3"]) {
  const res = r1.state.reserved.get(T[k]);
  check(
    `E1 ${k}: reservation ${res.amount}, expiry ${OFF + res.expiresAtEpoch}, grace ${res.reviewGraceEpochs}`,
    `(select reserved_base = ${res.amount} and expires_epoch = ${OFF + res.expiresAtEpoch} and review_grace_epochs = ${res.reviewGraceEpochs} from wos.task_budgets where task_id = '${T[k]}')`,
  );
}
balances(1);

// E2: accept T1 (alice 100%), release T2 as failed (never submitted, task terminal).
const env2 = E.openEpoch(state, 2, 0n, p);
const r2 = run(2, {
  acceptances: [{ taskId: T.t1, shares: [{ accountId: ALICE, beneficiaryId: ALICE, shareBp: 10000 }] }],
  releases: [{ taskId: T.t2 }],
});
epochRow(2, env2);
moveTo(2, "OPEN");
sql(`insert into wos.work_dedup_keys (dedup_key, source) values ('work:trace:t1', 'receipt');`);
sql(
  `select wos_test.receipt('00000000-0000-0000-0070-0000000000c1', '${ALICE}', 'IMPLEMENTATION', 'execution', 'accepted_budget', 5000000, '${T.t1}', 10000, 'work:trace:t1', ${OFF + 2});`,
);
sql(`insert into wos.task_budget_releases (task_id, reason) values ('${T.t2}', 'failed');`);
moveTo(2, "CALCULATING");
const line = r2.allocations.find((a) => a.receiptId === T.t1);
sql(
  `select wos_test.alloc('00000000-0000-0000-0070-0000000000d1', ${OFF + 2}, '${ALICE}', '00000000-0000-0000-0070-0000000000c1', 'execution', ${line.amountBase});`,
);
moveTo(2, "FINALIZED");
const ent2 = r2.entitlements.get(ALICE);
const E_NOW = "00000000-0000-0000-0070-0000000000e1";
const E_TR = "00000000-0000-0000-0070-0000000000e2";
sql(`insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base) values
  ('${E_NOW}', ${OFF + 2}, 'person', '${ALICE}', 'release_now', 'allocation', '00000000-0000-0000-0070-0000000000d1', ${ent2.releasedNow}),
  ('${E_TR}', ${OFF + 2}, 'person', '${ALICE}', 'holdback_tranche', 'allocation', '00000000-0000-0000-0070-0000000000d1', ${ent2.heldBack});`);
check(
  `E2 tranche matures at ${OFF + state.holdback[0].maturesAtEpoch}`,
  `(select matures_epoch from wos.entitlements where id = '${E_TR}') = ${OFF + state.holdback[0].maturesAtEpoch}`,
);
compareOwnership("E2 accept");
balances(2);

// E3: a simple hold of 10 on alice's tranche; alice claims her released amount.
const env3 = E.openEpoch(state, 3, 0n, p);
const c3 = claim(3, [[E_NOW, ent2.releasedNow]], ent2.releasedNow);
run(3, {
  holds: [{ id: "h1", beneficiaryId: ALICE, source: "tranche", trancheId: state.holdback[0].trancheId, amount: 10n }],
  claims: [c3],
});
epochRow(3, env3);
sql(`insert into wos.confiscations (id, beneficiary_kind, beneficiary_id, proven_excess_base, finding_ref, admin_action_id, reply_closes_at, appeal_closes_at, hold_expires_at)
  values ('00000000-0000-0000-0070-0000000000f1', 'person', '${ALICE}', 10, 'lifecycle trace hold', wos_test.aa('confiscate', 'confiscation', 'trace'),
          now() + interval '73 hours', now() + interval '242 hours', now() + interval '256 hours');`);
sql(
  `insert into wos.confiscation_sources (confiscation_id, source_kind, source_id, amount_base) values ('00000000-0000-0000-0070-0000000000f1', 'holdback', '${E_TR}', 10);`,
);
compareOwnership("E3 hold + claim");
balances(3);

// E5: T3 was never submitted and expires (issue epoch + 4).
const env5 = E.openEpoch(state, 5, 0n, p);
const r5 = run(5, {});
epochRow(5, env5);
if (!r5.expired.includes(T.t3)) throw new Error("engine did not expire T3 at epoch 5");
sql(`insert into wos.task_budget_releases (task_id, reason) values ('${T.t3}', 'expired');`);
check(
  "E5 T1 accepted, T2 failed and T3 expired are the only ended budgets",
  `(select count(*) from wos.task_budget_releases where task_id in ('${T.t2}', '${T.t3}')) = 2 and not exists (select 1 from wos.task_budget_releases where task_id = '${T.t1}')`,
);
balances(5);

// E8: the tranche matures: only the unheld 90 (the held 10 stays in the tranche); alice claims them next.
const env8 = E.openEpoch(state, 8, 0n, p);
const r8 = run(8, {});
const matured8 = r8.entitlements.get(ALICE).maturedHoldback;
const E_M1 = "00000000-0000-0000-0070-0000000000e3";
const c8 = { id: "claim-8", beneficiaryId: ALICE, amount: matured8 };
epochRow(8, env8);
moveTo(8, "FINALIZED");
sql(`insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values ('${E_M1}', ${OFF + 8}, 'person', '${ALICE}', 'holdback_matured', 'tranche', '${E_TR}', ${matured8}, 1);`);
compareOwnership("E8 mature the unheld part");
balances(8);
claim(8, [[E_M1, matured8]], matured8);

// E9: alice's claim of the 90 settles; the hold is released; the restored 10 matures (release 2) and is claimed.
const env9 = E.openEpoch(state, 9, 0n, p);
const r9 = run(9, { claims: [c8], holdReleases: [{ holdId: "h1" }] });
epochRow(9, env9);
moveTo(9, "FINALIZED");
sql(`insert into wos.confiscation_releases (confiscation_id, reason) values ('00000000-0000-0000-0070-0000000000f1', 'overturned');`);
const matured9 = r9.entitlements.get(ALICE).maturedHoldback;
const E_M2 = "00000000-0000-0000-0070-0000000000e4";
sql(`insert into wos.entitlements (id, epoch_number, beneficiary_kind, beneficiary_id, kind, source_kind, source_id, amount_base, release_seq)
  values ('${E_M2}', ${OFF + 9}, 'person', '${ALICE}', 'holdback_matured', 'tranche', '${E_TR}', ${matured9}, 2);`);
compareOwnership("E9 hold released, remainder matured");
balances(9);
const env10 = E.openEpoch(state, 10, 0n, p);
const c10 = claim(10, [[E_M2, matured9]], matured9);
run(10, { claims: [c10] });
epochRow(10, env10);
compareOwnership("E10 everything claimed once");
balances(10);
if (state.delivered !== line.amountBase) throw new Error(`engine delivered ${state.delivered}, allocated ${line.amountBase}`);
sql("set constraints all deferred;");
sql("\\echo 'lifecycle trace: engine and database agree at every checkpoint'");
console.log(out.join("\n"));

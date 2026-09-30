// The v2 CROSS-LAYER accounting trace (review 09, required regression for R09-1 / R09-2).
//
// One scenario through the ENGINE (reward-policy.v2, its queue bonus), the RULES (nextClaimTerms, claimTermsRefusals,
// taskClaimOf, taskAllocationRefusals) and the DATABASE (0007 + 0010): the real reward-policy.v2 document is stored,
// the epochs pin it, every lease snapshot carries the claim terms derived from an authoritative claim history, the
// snapshots pass the 0010 Q1 snapshot guard, the allocations pass the Q1 allocation guard, and at each checkpoint the
// balances DERIVED FROM THE DATABASE'S SOURCE RECORDS equal the engine's.
//
// Scenario (awkward integers throughout; rate 100 base units per ACU):
//   Q  queue claim, bonus applies        reservation 1001 -> paid 1001, returned 0
//   S  self-picked                        reservation 1001 -> paid  834, returned 167
//   W  queue claim right after the contributor released an assigned task (decline: bonus withheld)
//                                         reservation  707 -> paid  589, returned 118
//   M  self-picked by two contributors 3333/6667 (one task-level entitlement, identical terms on both leases)
//                                         reservation  997 -> paid  830 split 277/553, returned 167
// Then: replay (engine refuses a second acceptance; the database refuses a second allocation above the payable base),
// the bonus is never also RELEASED (0007 refuses releasing an accepted task), and the single Q-B reserve credit equals
// the engine's queueBonusReturnedBase.
//
// Usage (test-migrations.sh, after the v1 trace): node --experimental-strip-types
//   packages/db/test/accounting-trace-v2.mjs | docker exec -i <container> psql -v ON_ERROR_STOP=1 -q -U postgres -d <db>
import { createHash } from "node:crypto";
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
const R = await import(new URL("packages/contracts/src/protocol/rules.ts", root).href);
const rewardBytes = readFileSync(new URL("packages/contracts/src/protocol/data/reward-policy.v2.json", root));
const reward = JSON.parse(rewardBytes.toString("utf8"));
const completion = JSON.parse(readFileSync(new URL("packages/contracts/src/protocol/data/completion-policy.v1.json", root), "utf8"));
const BONUS = reward.queue.queueBonusBp;
const p = {
  ...E.engineParamsFrom(reward, completion),
  emissionReserve: 1_000_000_000n,
  rateCeilingInitialBasePerAcu: 100n,
  rateCeilingDecayPpm: 0n,
  holdbackBp: 2000n,
  holdbackEpochs: 6,
  budgetExpiryEpochs: 4,
  reviewGraceEpochs: 2,
};
if (p.queueBonusBpByPolicy[reward.policyVersion] !== BONUS) throw new Error("the engine does not carry the v2 queue bonus");

const OFF = 300;
const ALICE = "00000000-0000-0000-0000-00000000000b";
const BOB = "00000000-0000-0000-0000-00000000000a";
const DAVE = "00000000-0000-0000-0000-00000000000d";
const EVE = "00000000-0000-0000-0000-00000000000e";
const id = (s) => `00000000-0000-0000-0090-${s.padStart(12, "0")}`;
const T = { Q: id("a1"), S: id("a2"), W: id("a3"), M: id("a4") };
const OBJ = id("b0");
const out = [];
const sql = (s) => out.push(s);
let checks = 0;
const check = (label, cond) => {
  checks += 1;
  sql(
    `do $$ begin if not (${cond}) then raise exception 'TRACE V2 MISMATCH: ${label}'; end if; raise notice 'ok (trace v2): ${label}'; end $$;`,
  );
};
const expectError = (label, stmt, pattern) => {
  checks += 1;
  sql(`select wos_test.expect_error($q$${stmt}$q$, 'trace v2: ${label}', '${pattern}');`);
};

let state = E.initialState(p.emissionReserve);
const consumed = new Set();
function run(e, input) {
  const r = E.computeEpoch({ epochNumber: e, state, consumedIds: new Set(consumed), ...input }, p);
  for (const c of r.consumedIds) consumed.add(c);
  state = r.state;
  return r;
}
function epochRow(e, env) {
  sql(`insert into wos.epochs (epoch_number, mode, cluster, starts_at, ends_at, risk_review_hours, challenge_hours, policy_versions,
    issuance_rate_base_per_acu, task_capacity_base, reserve_snapshot_base, demand_forecast_acu_micro, holdback_bp, holdback_epochs, budget_expiry_epochs, review_grace_epochs)
    values (${OFF + e}, 'test', 'devnet', now() - interval '2 days', now() + interval '5 days', 48, 48, '{"reward": "${reward.policyVersion}"}',
    ${env.rate}, ${env.taskCapacity}, ${env.reserveSnapshot}, ${env.demandForecastAcuMicro}, ${p.holdbackBp}, ${p.holdbackEpochs}, ${p.budgetExpiryEpochs}, ${p.reviewGraceEpochs});`);
}
function moveTo(e, target) {
  const upto = ["OPEN", "CALCULATING", "PROPOSED", "FINALIZED"].indexOf(target);
  sql("alter table wos.epoch_transitions disable trigger epoch_transitions_check;");
  sql(`insert into wos.epoch_transitions (epoch_number, seq, from_state, to_state, actor, receipts_root, allocations_root, result_sha256, at)
    select ${OFF + e}, i + 1, case when i = 0 then null else (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i] end, (array['OPEN','CALCULATING','PROPOSED','FINALIZED'])[i + 1], 'system',
      case when i = 2 then 'sha256:' || repeat('1', 64) end, case when i = 2 then 'sha256:' || repeat('2', 64) end, case when i = 2 then 'sha256:' || repeat('3', 64) end, now()
    from generate_series(coalesce((select max(seq) from wos.epoch_transitions where epoch_number = ${OFF + e}), 0), ${upto}) i;`);
  sql("alter table wos.epoch_transitions enable trigger epoch_transitions_check;");
}

sql("\\echo 'v2 cross-layer accounting trace: engine, rules and database'");
sql("set constraints all immediate;");
sql(`insert into wos.policy_documents (kind, version, body, sha256) values ('reward', '${reward.policyVersion}', '${rewardBytes.toString("utf8").replace(/'/g, "''")}'::jsonb,
  'sha256:${createHash("sha256").update(rewardBytes).digest("hex")}') on conflict do nothing;`);
sql(
  `insert into wos.acceptance_objectives (id, kind, ref, budget_acu_micro, budget_model_version) values ('${OBJ}', 'feature_criterion', 'v2 accounting trace', 100000000, 'budget-model.v1');`,
);

// ---- claim terms from an AUTHORITATIVE claim history (rules), validated against the pinned policy (rules and SQL)
const H = 3_600_000;
const now = 1_000 * H;
const declines = { windowHours: 168, cooldownAfter: 3, cooldownHours: 24 };
const terms = (mode, releases) =>
  R.nextClaimTerms({ mode, queueBonusBp: BONUS, assignedReleases: releases, claimedSinceLastRelease: false, nowMs: now, declines }).claim;
const claims = {
  Q: terms("queue", []),
  S: terms("self_pick", []),
  W: terms("queue", [{ atMs: now - H, cause: "contributor" }]),
  M: terms("self_pick", []),
};
if (!claims.Q.bonusApplies || claims.S.bonusApplies || claims.W.bonusApplies || claims.W.mode !== "queue")
  throw new Error("claim history derivation changed");
for (const [k, c] of Object.entries(claims)) {
  const refusals = R.claimTermsRefusals({ pinnedQueueBonusBp: BONUS, claim: c, derived: { mode: c.mode, bonusApplies: c.bonusApplies } });
  if (refusals.length) throw new Error(`${k}: ${refusals.join("; ")}`);
}

// ---- E1: issue four tasks with awkward reservations
const budgets = { Q: 10_010_000, S: 10_010_000, W: 7_070_000, M: 9_970_000 };
const env1 = E.openEpoch(state, 1, 0n, p);
const r1 = run(1, {
  issuances: Object.entries(budgets).map(([k, m]) => ({
    taskId: T[k],
    kind: "execution",
    budgetAcuMicro: BigInt(m),
    featurePoolKeys: [],
    applicationPoolKeys: [],
  })),
});
epochRow(1, env1);
moveTo(1, "OPEN");
for (const [k, m] of Object.entries(budgets))
  sql(`insert into wos.task_budgets (task_id, objective_id, kind, budget_acu_micro, model_acu_micro, basis, budget_model_version, proposer_account_id, issued_epoch)
    values ('${T[k]}', '${OBJ}', 'execution', ${m}, ${m}, '{"taskKind": "abu_build"}', 'budget-model.v1', '${EVE}', ${OFF + 1});`);
for (const k of Object.keys(budgets)) {
  const res = r1.state.reserved.get(T[k]);
  check(
    `E1 ${k}: reservation ${res.amount} pinned to ${reward.policyVersion} in both layers`,
    `(select reserved_base = ${res.amount} and policy_version = '${reward.policyVersion}' and wos.queue_bonus(policy_version) = ${BONUS} from wos.task_budgets where task_id = '${T[k]}')`,
  );
}

// ---- leases and their snapshots (persisted; each passes the 0010 Q1 snapshot guard). M has two participating leases.
const leases = [
  ["Q", "c1", ALICE, 1],
  ["S", "c2", ALICE, 1],
  ["W", "c3", ALICE, 1],
  ["M", "c4", BOB, 1],
  ["M", "c5", DAVE, 2],
];
sql("set session_replication_role = replica;");
for (const k of Object.keys(T))
  sql(`insert into wos.tasks (id, kind, state, role, abu_id) values ('${T[k]}', 'abu_build', 'leased', 'builder', gen_random_uuid());`);
for (const [k, l, who, gen] of leases)
  sql(`insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at, ended_at, generation)
    values ('${id(l)}', '${T[k]}', '${who}', '00000000-0000-0000-0000-0000000000d${who.slice(-1)}', 'completed', '{}', now() + interval '30 minutes', now() + interval '3 hours', now(), ${gen});`);
sql("set session_replication_role = origin;");
for (const [k, l, , gen] of leases)
  sql(`insert into wos.run_policy_snapshots (lease_id, generation, body, snapshot_sha256)
    values ('${id(l)}', ${gen}, '${JSON.stringify({ claim: claims[k] })}', 'sha256:' || md5('${l}') || md5('${l}x'));`);
expectError(
  "a snapshot whose terms differ from the pinned policy is refused",
  `insert into wos.run_policy_snapshots (lease_id, generation, body, snapshot_sha256) values ('${id("c1")}', 1, '{"claim": {"mode": "queue", "queueBonusBp": 1000, "bonusApplies": true}}', 'sha256:' || repeat('0', 64))`,
  "differs",
);
const taskClaim = R.taskClaimOf(
  BONUS,
  leases.filter(([k]) => k === "M").map(([k]) => claims[k]),
);
if (!("claim" in taskClaim)) throw new Error(`M: ${taskClaim.refusal}`);

// ---- E2: accept all four (M: 3333/6667); the engine returns the bonus portions to R, once.
const env2 = E.openEpoch(state, 2, 0n, p);
const before = state.remainingReserve;
const shares = {
  Q: [[ALICE, 10000]],
  S: [[ALICE, 10000]],
  W: [[ALICE, 10000]],
  M: [
    [BOB, 3333],
    [DAVE, 6667],
  ],
};
const r2 = run(2, {
  acceptances: Object.keys(T).map((k) => ({
    taskId: T[k],
    shares: shares[k].map(([a, s]) => ({ accountId: a, beneficiaryId: a, shareBp: s })),
    claim: k === "M" ? taskClaim.claim : claims[k],
  })),
});
E.assertConserved(p.emissionReserve, state);
epochRow(2, env2);
moveTo(2, "OPEN");
const receipts = [
  ["d1", "Q", ALICE, "c1", 10000],
  ["d2", "S", ALICE, "c2", 10000],
  ["d3", "W", ALICE, "c3", 10000],
  ["d4", "M", BOB, "c4", 3333],
  ["d5", "M", DAVE, "c5", 6667],
];
for (const [rid] of receipts) sql(`insert into wos.work_dedup_keys (dedup_key, source) values ('work:trace2:${rid}', 'receipt');`);
const receiptSql = ([rid, k, who, l, share]) =>
  `('${id(rid)}', '${who}', 'IMPLEMENTATION', 'execution', 'accepted_budget', 'pr_merged', 'independent', 'ACTIVE', ${budgets[k]}, '${T[k]}', ${share}, 'attempt', gen_random_uuid(),
    '${id(l)}', ${leases.find((x) => x[1] === l)[3]}, 'work:trace2:${rid}', ${OFF + 2}, '{}', 'sha256:' || md5('${rid}') || md5('${rid}t2'), now())`;
sql(`insert into wos.contribution_receipts (id, account_id, contribution_type, slice, evidence_class, acceptance_event, independence, initial_status,
  weight_micro, task_id, share_bp, subject_kind, subject_id, lease_id, lease_generation, dedup_key, admitted_epoch, body, receipt_sha256, qualified_at)
  values ${receipts.map(receiptSql).join(",\n")};`);
moveTo(2, "CALCULATING");
for (const [rid, k, who] of receipts) {
  const line = r2.allocations.find((a) => a.receiptId === T[k] && a.accountId === who);
  sql(`select wos_test.alloc('${id(`f${rid}`)}', ${OFF + 2}, '${who}', '${id(rid)}', 'execution', ${line.amountBase});`);
}
// Each task: the engine's lines satisfy the versioned allocation rule from the REAL reservation and the task's claim.
for (const k of Object.keys(T)) {
  const res = r1.state.reserved.get(T[k]).amount;
  const recs = receipts
    .filter((x) => x[1] === k)
    .map(([rid, , who, , share]) => ({ receiptId: rid, accountId: who, shareBp: share, orgShareBp: 0 }));
  const lines = receipts
    .filter((x) => x[1] === k)
    .map(([rid, , who]) => ({
      receiptId: rid,
      beneficiary: "person",
      amount: r2.allocations.find((a) => a.receiptId === T[k] && a.accountId === who).amountBase,
    }));
  const refusals = R.taskAllocationRefusals({
    reservedBase: res,
    receipts: recs,
    lines,
    pinnedQueueBonusBp: BONUS,
    claim: k === "M" ? taskClaim.claim : claims[k],
  });
  if (refusals.length) throw new Error(`${k}: ${refusals.join("; ")}`);
  const paid = lines.reduce((t, l) => t + l.amount, 0n);
  const payable = E.taskPayableBase(res, BONUS, k === "M" ? taskClaim.claim : claims[k]).payable;
  if (paid !== payable) throw new Error(`${k}: engine paid ${paid}, payable ${payable}`);
  check(
    `E2 ${k}: exact allocations ${lines.map((l) => l.amount).join("/")} = payable ${payable} of reservation ${res}`,
    `(select coalesce(sum(x.amount_base), 0) = ${payable} from wos.allocations x join wos.contribution_receipts c on c.id = x.receipt_id where c.task_id = '${T[k]}')
     and (select array_agg(x.amount_base order by c.account_id) = array[${receipts
       .filter((x) => x[1] === k)
       .sort((a, b) => (a[2] < b[2] ? -1 : 1))
       .map(([, , who]) => r2.allocations.find((a) => a.receiptId === T[k] && a.accountId === who).amountBase)
       .join(",")}]::bigint[] from wos.allocations x join wos.contribution_receipts c on c.id = x.receipt_id where c.task_id = '${T[k]}')`,
  );
}
// The single Q-B reserve credit: derived from the database's own records (reservation, pinned policy, snapshot terms).
const returnedSql = `(select sum(b.reserved_base - case when (s.body -> 'claim' ->> 'bonusApplies')::boolean then b.reserved_base
     else floor(b.reserved_base::numeric * 10000 / (10000 + wos.queue_bonus(b.policy_version))) end)
   from wos.task_budgets b join lateral (select s.body from wos.contribution_receipts c join wos.run_policy_snapshots s on s.lease_id = c.lease_id
     where c.task_id = b.task_id limit 1) s on true where b.task_id in ('${Object.values(T).join("','")}'))`;
check(
  `E2 the single Q-B reserve credit ${r2.queueBonusReturnedBase} (engine) = the derivation from the database records`,
  `${returnedSql} = ${r2.queueBonusReturnedBase}`,
);
check(
  `E2 issued ${state.cumulativeIssued} = allocations`,
  `(select coalesce(sum(amount_base), 0) from wos.allocations where epoch_number > ${OFF} and epoch_number < ${OFF + 100}) = ${state.cumulativeIssued}`,
);
if (state.remainingReserve - before < r2.queueBonusReturnedBase) throw new Error("the bonus portion did not reach R");
// Replay and double credit.
let replayed = false;
try {
  run(3, { acceptances: [{ taskId: T.S, shares: [{ accountId: ALICE, beneficiaryId: ALICE, shareBp: 10000 }], claim: claims.S }] });
} catch {
  replayed = true;
}
if (!replayed) throw new Error("the engine accepted a task twice");
expectError(
  "a replayed allocation of the same receipt (one allocation per receipt; Q1 caps the task at its payable base)",
  `select wos_test.alloc('${id("fd9")}', ${OFF + 2}, '${ALICE}', '${id("d2")}', 'execution', 1)`,
  "allocations_receipt_once",
);
checks += 1;
sql(`select wos_test.over($q$insert into wos.task_budget_releases (task_id, reason) values ('${T.S}', 'cancelled')$q$,
  'trace v2: the bonus portion is never also released (an accepted task is not released)', 'paid, not released');`);
// Funding equation with the engine's balances (the R credit included).
const sum = (m) => [...m.values()].reduce((t, v) => t + v, 0n);
const q = [...state.reserved.values()].reduce((t, r) => t + E.reservationTotal(r), 0n);
const held = state.holdback.reduce((t, x) => t + x.amount, 0n);
sql(`insert into wos.epoch_balances (epoch_number, emission_reserve, remaining_reserve, pools, security_reserve, reserved_budgets, issued, holdback, claimable, result_sha256)
  values (${OFF + 2}, ${p.emissionReserve}, ${state.remainingReserve}, ${sum(state.poolBalances)}, ${state.securityReserve}, ${q}, ${state.cumulativeIssued}, ${held}, ${sum(state.claimable)}, 'sha256:' || repeat('e', 64));`);
sql("set constraints all deferred;");
sql(
  `\\echo 'v2 cross-layer accounting trace: engine, rules and database agree (${checks} checks; returned ${r2.queueBonusReturnedBase} to R once)'`,
);
console.log(out.join("\n"));

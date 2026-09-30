ACCEPT AFTER THE LISTED CHANGES

warOnSaaS protocol review 09 — supplied snapshot identified as commit 50202b8
Scope: D61 economy, D60 protocol delta, D63, reward-policy.v2, capability-policy.v2 and migration 0010. Conditional acceptance for devnet/shadow only. Do not join these additions to the frozen implementation baseline until R09-1 through R09-6 below are corrected. Frozen v1 and its settled economic choices are not reopened.

Evidence and limits

I inspected the supplied rules, engine, policies, migration 0010, relevant 0007 guards, work-next tests, database assertions, review packet and decision/planning documents. The archive is a selected-file snapshot, not a runnable complete checkout. I did not independently verify its Git commit identity or byte equality to an earlier checkout.

EXECUTED: selected original TypeScript function bodies under Node 24.19.0, with type annotations removed and imports adapted because supporting source files are omitted. The engine body is unchanged. Rules used unchanged redGreenRefusals and receiptCountsIn helpers. Policies came directly from the supplied JSON. These are focused probes, not a replacement for npm run check.

EXECUTED: the actual Q1 functions and triggers extracted unchanged from migration 0010 in PGlite, against minimal fixture tables. This verifies those guards in isolation, not the entire SQL admission path, RLS or concurrent transactions.

NOT independently completed: the full repository suite, SQL assertion suite, accounting trace or concurrency suite. An attempted full PGlite run applied the supplied migrations but the assertions encountered the omitted wos_meta bootstrap. I do not count that as a successful database test run. TEST-RESULTS.txt reports 1,695 passing/303 skipped check tests, successful database tests and 242 passing narrow-subset tests; those are supplied evidence. The new probes below expose combinations those results do not establish.

1. Section 3l verification table

| Addition | Assessment | Evidence / remaining gap |
|---|---|---|
| D61 commissioned triage, outcome confirmation, decision hash and lease | PARTIAL | Outcome branches and decision-hash/lease-owner checks match the stated paths. B1 checks execution slice, not actual bug_triage task kind. The fix-confirmation SQL predicate accepts mere receipt existence. R09-3, R09-4. |
| Critical severity only after maintainer; penalty-free correction | PARTIAL | Effective-severity derivation and maintainer independence are present; no triager penalty is introduced. A later correction invalidates an already pinned fix budget. R09-6. |
| Fix budget, bounded severity, red/green, independent fixer | FAIL | abu_build pricing works; abu_revision has no matching budget row. A red/green record for another bug passes the route rule. A fix can enter the ordinary IMPLEMENTATION route without these additional checks. R09-3, R09-5, R09-6. |
| First reporter once, resolved bug, per-epoch cap; sweep only through reports | PARTIAL | First-reporter equality, bug-key deduplication and a locked per-account/epoch count are present. No direct sweep receipt route. SQL resolution does not require a live-countable fix receipt. R09-4. |
| Introducer offset equal to report allocation, 14-day window, switch | CONDITIONAL PASS for the stated local guards | B4 checks a supplied offset's bug, introducing receipt, beneficiary, amount and uniqueness. The helper signals whether an offset is required. It does not itself create one; admission/payment must consume that signal. Equality is to recorded report allocations, not independently to a later challenge-adjusted net payment. See integration boundaries below; F35 remains a policy switch. |
| D60 holds, migration boost, ageing continuity, public labels | PASS at helper level | Held candidates are excluded; migration boost is present; ageing follows hold-labelled generations. Non-null labels must identify an active hold and cancellation. SQL H1 enforces syntax/cancellation, not the causal hold relationship. Authoritative release history remains required. |
| D63 all-kind ranking, common eligibility, derived kind base, boosts, dormant vote | PARTIAL | Ranking/eligibility helpers implement the intended ordering, independence and holds for their supplied candidates. Dormant votes contribute zero. Payment coverage does not support every advertised kind: R09-5. |
| D63 base/queue prices, full reservation, return of unearned bonus, snapshot | FAIL | Explicit valid claims conserve funds in the engine, but the allocation rule rejects the discounted result. Omitted or altered claim terms bypass the intended discount in both engine and isolated Q1. R09-1, R09-2. |
| D63 decline/cooldown and coarse limits | PASS at helper level; payment enforcement blocked | Contributor-caused releases withhold the next queue bonus and repeated releases trigger cooldown; system/hold cancellations are excluded. The strict limit schema rejects named tasks/features/targets. R09-1 currently permits bypassing the resulting payment terms. |

Nearby gaming assessment

Known related-account exclusions cover reporter/triager, triager/fixer and in-window introducer/report/fix relationships when the authoritative records are supplied. Those checks do not discover an undeclared relationship between apparently unrelated accounts; stronger Sybil detection is explicitly dormant and is not made a new launch condition here.

A duplicate reporter cannot collect a second report reward through the duplicate outcome. Paid duplicate triage remains permitted by D61 when it references an earlier acting bug. Many commissioned duplicate triages could consume their authorized budgets; the per-reporter report cap does not cap triage pay. This is a commissioning/consensus boundary, not evidence that arbitrary uncommissioned spam receives money. I do not change that settled decision.

High severity has a bounded premium and critical requires maintainer confirmation. The actual bypasses are wrong-route/evidence acceptance and mutable severity after issuance, not an unlimited multiplier. Coarse size/provider/surface limits necessarily select subsets of the queue; this is allowed by D63. Named-target filters are rejected. Caller-supplied release history, limits and candidate metadata must be constructed authoritatively, rather than trusted from the contributor.

2. Conservation and rounding

For reservation Q and pinned bonus b, B = floor(Q * 10000 / (10000 + b)). A no-bonus acceptance pays B and returns Q-B; a bonus-eligible acceptance pays Q and returns zero. The engine removes the reservation once. I executed a v2 issue/accept sequence with Q=1,200,000,000: self-pick paid 1,000,000,000 and returned 200,000,000; queue paid 1,200,000,000 and returned zero. assertConserved passed. Reacceptance was rejected. Integer boundary probes also matched the stated formula.

This is correct arithmetic for explicit, valid, consistent claim terms. It is not yet consistent enforcement across layers:
- taskAllocationRefusals expects the full Q and rejects the engine's legitimate B (R09-2).
- Missing claim and bonus=0 cases both pay full Q without breaking conservation; conservation does not establish entitlement (R09-1).
- Isolated SQL Q1 rejects 1,200 against a 1,200 reservation with a 2,000-bp no-bonus claim; it accepts 1,000. It also accepts 999. Q1 is an upper bound, not exact payout or reserve reconciliation.
- Q1 itself performs no R ledger credit. The engine is the source of the Q-B return. A projection must not also issue a full budget release or credit the difference twice. Include the v2 acceptance and return in the database accounting trace.
- The authoritative final floor is in base units. An ACU display rounded first and converted afterwards can differ; do not use that display as a second settlement formula.

Required regression: one cross-layer trace for queue, self-pick and decline-withheld acceptance; awkward integer reservations; multiple beneficiary splits; replay; persisted snapshot/policy validation; exact allocations plus the single Q-B reserve credit. A Q1 upper-bound test alone cannot establish this.

3. R08 status

R08-1: CLOSED on this review's evidence. Executed allocationChallengeRefusals accepts ACTIVE, RATIFIED and FINAL_BY_SILENCE and refuses PROVISIONAL and REVOKED under otherwise valid challenge inputs. SQL 0007 check_allocation_challenge has the same explicit whitelist and retains window/root/revision checks; 0010 does not replace it. Supplied SQL regressions report success. This does not excuse R09-4's separate new existence-only query.

R08-2: STILL CLOSED BY INSPECTION, supported by supplied regression results. 0007 pins task_budgets.expires_at from the issue epoch, refuses a missing issuing calendar and pre-issue evidence, derives submitted_epoch arithmetically, and rejects at/after the pinned deadline. It does not rely on the expiry epoch having a calendar row. 0010 does not replace that guard. I did not independently rerun its full SQL regression.

4. Blocking findings and smallest fixes

R09-1 — HIGH — V2 claim terms are optional and not bound to authoritative policy
Locations: protocol/entities.ts RunPolicySnapshot.claim; protocol/engine.ts TaskAcceptance and computeEpoch acceptance branch; 0010 check_claim_snapshot/check_queue_bonus.

Failing sequence (EXECUTED engine and isolated Q1): issue under reward-policy.v2; reserve Q; self-pick the task; omit claim from acceptance/snapshot. The engine pays Q, returns zero, and Q1 finds no withheld-bonus snapshot and permits Q. Keeping a self_pick claim but setting queueBonusBp=0 has the same result. The v2 capability document specifies 2000. The snapshot schema makes claim optional regardless of policy version and only checks the queue-mode implication when present. SQL does not enforce coefficient equality to policy.

Smallest fix: preserve absent-claim behavior only for explicitly pinned v1 work. Require complete validated claim terms for v2, derive the coefficient and eligibility from the lease's pinned policy and authoritative claim history, and bind acceptance to that persisted snapshot. Reject missing snapshots/terms and policy mismatches in Q1. Define a single task-level entitlement when several receipt leases participate; taking min(bonus) is not a sufficient binding rule if their terms differ. Regress omission, null/malformed terms, coefficient tampering, acceptance/snapshot mismatch and mixed receipt snapshots.

R09-2 — HIGH — Correct self-pick payment cannot pass the allocation rule
Locations: protocol/engine.ts acceptance branch; protocol/rules.ts taskAllocationRefusals (around line 1260).

Failing sequence (EXECUTED): a v2 task reserves 1,200,000,000. Its valid self-pick acceptance pays 1,000,000,000 and returns 200,000,000. Feed those allocation lines and the actual reservation to taskAllocationRefusals. It refuses: "allocation t/person is 1000000000, the declared shares give 1200000000". Paying the full reservation satisfies that validator but violates Q1 for the correctly recorded claim. Passing a reduced number as the reservation merely moves an unvalidated derivation into the caller.

Smallest fix: add a versioned allocation-validation path sharing the engine's payable-base derivation from the real reservation and validated claim. Split that payable amount using the existing canonical account rounding. Preserve frozen v1 behavior. Validate the returned difference alongside payment in the accounting projection.

R09-3 — HIGH — New bug routes are not bound in both directions to commissioned work/evidence
Locations: protocol/rules.ts receiptRouteRefusals; bugs.ts redGreenRefusals; 0010 check_bug_triage_decision/check_bug_receipt.

Failing sequence A (EXECUTED pure rule): submit BUG_FIX for task fix-BUG-20, with valid high severity and independence flags, but supply internally consistent red/green evidence for BUG-21 in another feature and on unrelated commits. The rule returns no refusals: its input carries no expected bug/feature/parent/head to compare. redGreenRefusals checks the red/green relationship, not ownership of that evidence by this accepted fix. SQL deliberately delegates CI evidence to this layer.

Failing sequence B (EXECUTED pure rule; SQL bypass inspected): classify a bug-fix task's receipt as IMPLEMENTATION. Even with no red/green evidence and both forbidden-fixer flags true, receiptRouteRefusals returns no refusals. The D61 SQL trigger immediately returns for non-bug contribution types. An ordinary merged implementation qualification does not add the missing D61 independence/evidence bindings. This demonstrates the missing gate, not an end-to-end live payout exploit.

Failing sequence C (SQL inspected): commission a larger v2 execution/build budget and its lease, then use it as triage_task_id. B1 checks b.kind='execution', not the actual bug_triage commissioning kind. B3 binds the decision back to that same task, so the binding alone does not prove the flat triage price/route was used.

Smallest fix: derive the required receipt route from immutable commissioned task/budget metadata. A fix task must use BUG_FIX; a triage receipt/decision must use a bug_triage budget. Validate evidence against the accepted fix's exact bug, feature, changeset parent/head and regression artifact. Keep CI verification in rules as D51 allows; SQL needs only the minimal task/route backstop. Add all three negative cases and their legitimate controls.

R09-4 — HIGH — A revoked or provisional fix still resolves the bug in SQL
Location: 0010 check_bug_receipt, has_fix query around line 207.

Failing sequence (INSPECTION, not full SQL execution): create the bug's BUG_FIX receipt, then revoke it before admitting the first BUG_REPORT. The SQL has_fix query still returns true because it filters only contribution_type and subject. The report passes the fix-resolution branch despite there being no surviving accepted fix. The same predicate can confirm a fix-outcome triage without ratification. A still-provisional receipt is also not excluded by this query.

Smallest fix: derive fix acceptance from a bound accepted fix with the appropriate current live-countable status, not row existence; use the same definition when supplying fixAccepted to the pure helpers. Add active/ratified/final-by-silence positive cases and provisional/revoked negative cases. Define the dependency action when an already-rewarded supporting fix is later revoked, using the existing challenge/recovery path rather than introducing new penalties.

R09-5 — MEDIUM — The v2 price model does not cover advertised paid task kinds
Locations: capability-policy.v2.json budgets; protocol/rules.ts budgetModelMicro.

Failing sequence (EXECUTED): request a high-severity size-2 abu_revision fix with difficulty/importance 10000. budgetModelMicro returns "no budget model for task kind abu_revision". The equivalent abu_build returns 10,000,000 micro-ACU. architecture_author is in the new all-kind queue but also returns "no budget model for task kind architecture_author".

Smallest fix: provide explicit v2 model rows or documented versioned aliases for the claimed paid kinds. At minimum abu_revision fixes need the promised build pricing. If architecture_author is represented through another commissioned kind, make and test that mapping; do not claim direct coverage otherwise. bug_sweep remains intentionally unpaid. This finding concerns the new coverage claims, not a demand to reopen v1.

R09-6 — MEDIUM — Severity correction invalidates an already promised budget
Locations: DECISIONS D61 "pinned at issuance"; receiptRouteRefusals BUG_FIX severity comparison; 0010 B3 comparison to bug_effective_severity.

Failing sequence (EXECUTED rule, SQL inspected): a high-severity bug receives a high-priced immutable fix budget and lease. While work proceeds, a maintainer correctly downgrades it to low. The contributor completes valid work. Admission now rejects the receipt because budgetSeverity remains high while current effectiveSeverity is low. An upgrade causes the symmetric mismatch. Existing leased/submitted budget protections prevent simply rewriting the quote.

Smallest fix: pin the severity decision/confirmation revision used at budget issuance, and validate that it was effective then. Later corrections affect future commissions and current ranking, without silently changing a valid existing quote. If a particular correction must stop work, use an explicit authorized cancellation/reissue path with its stated treatment of the contributor. Regress correction before issuance, after lease and after submission.

5. Integration boundaries that must not be mistaken for executed guarantees

B4 validates an offset that is inserted; it does not enforce existence of an offset for every eligible report payment. The payment adapter must consume introducerOffset and record/reconcile its obligation with that payment. The current equality uses allocation amounts. A later challenge reduction requires an explicit reconciliation rule before claiming equality to final net pay. No new economic decision is imposed here: retain compensatory treatment and the configured F35 switch.

The SQL introducer window is measured against server-set decided_at, not report intake time: a day-13 report triaged on day 15 can fall outside a 14-day window. That is the implementation's present semantics, not proof of a report-time guarantee. Document the anchor and regression-test the boundary; if the intended window protects timely reports, pin intake time instead. I have not assumed an unstated report-time rule to label this a separate blocker.

Hold labels and decline history require authoritative cause records. A nullable label is not proof that every hold-driven release gets labelled. A successful pure helper test is likewise not evidence that a deployed service always invokes it; this protocol has not yet been implemented. These dependencies should be explicit in the implementation contract.

Acceptance gate: fix R09-1 through R09-6 in the versioned additions; run their negative/positive regressions and the v2 cross-layer accounting trace; rerun the existing review-08 gates. No unrelated redesign or mainnet approval is requested.

Appendix A — Executed probe outputs

Node engine/rules probes
{"name":"self_pick","result":{"reserved":"1200000000","paid":"1000000000","returned":"200000000","refusals":["allocation t/person is 1000000000, the declared shares give 1200000000"],"conserved":true}}
{"name":"replay","result":{"rejected":true}}
{"name":"queue","result":{"reserved":"1200000000","paid":"1200000000","returned":"0","refusals":[],"conserved":true}}
{"name":"omitted","result":{"reserved":"1200000000","paid":"1200000000","returned":"0","refusals":[],"conserved":true}}
{"name":"zero_bonus","result":{"reserved":"1200000000","paid":"1200000000","returned":"0","refusals":[],"conserved":true}}
{"name":"budget_abu_build","result":{"modelMicro":"10000000"}}
{"name":"budget_abu_revision","result":{"refusal":"no budget model for task kind abu_revision"}}
{"name":"budget_architecture_author","result":{"refusal":"no budget model for task kind architecture_author"}}
{"name":"unrelated_red_green","result":[]}
{"name":"fix_disguised_as_implementation","result":[]}
{"name":"correction_after_issue","result":["the fix budget is priced at high severity; the effective severity is low"]}
{"name":"R08-1_ACTIVE","result":[]}
{"name":"R08-1_RATIFIED","result":[]}
{"name":"R08-1_FINAL_BY_SILENCE","result":[]}
{"name":"R08-1_PROVISIONAL","result":["the free allocation challenge is for live-countable receipts (ACTIVE, RATIFIED, FINAL_BY_SILENCE)"]}
{"name":"R08-1_REVOKED","result":["the free allocation challenge is for live-countable receipts (ACTIVE, RATIFIED, FINAL_BY_SILENCE)"]}
{"name":"rounding","result":{"reserved":"0","base":"0","returned":"0"}}
{"name":"rounding","result":{"reserved":"1","base":"0","returned":"1"}}
{"name":"rounding","result":{"reserved":"5","base":"4","returned":"1"}}
{"name":"rounding","result":{"reserved":"1001","base":"834","returned":"167"}}
{"name":"rounding","result":{"reserved":"1200","base":"1000","returned":"200"}}
{"name":"rounding","result":{"reserved":"999999999999999999","base":"833333333333333332","returned":"166666666666666667"}}

Isolated actual Q1 SQL guards
{"i":1,"claim":{"mode":"self_pick","queueBonusBp":2000,"bonusApplies":false},"amount":1200,"accepted":false,"error":"wos: a task claimed without the queue bonus is allocated at most its base price (the bonus stays in R)"}
{"i":2,"amount":1200,"accepted":true}
{"i":3,"claim":{"mode":"self_pick","queueBonusBp":0,"bonusApplies":false},"amount":1200,"accepted":true}
{"i":4,"claim":{"mode":"self_pick","queueBonusBp":2000,"bonusApplies":false},"amount":1000,"accepted":true}
{"i":5,"claim":{"mode":"self_pick","queueBonusBp":2000,"bonusApplies":false},"amount":999,"accepted":true}

Appendix B — Reproduction scripts
Run in a sibling directory to the extracted review09 tree with Node 24, zod 4 and @electric-sql/pglite installed. No source file in the supplied snapshot is changed. The scripts adapt imports only for the selected probes; they do not provide a full test runner.

--- prepare.mjs ---
import {readFileSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const root='../review09/packages/contracts/src/';
const read=p=>readFileSync(new URL(root+p,import.meta.url),'utf8');
const strip=s=>stripTypeScriptTypes(s,{mode:'strip'});
const body=(p,n)=>{const s=strip(read(p)); const start=s.indexOf('export function '+n+'('); if(start<0)throw Error(n); const end=s.indexOf('\n}',start)+2; return s.slice(start,end);};
writeFileSync(new URL('engine.mjs',import.meta.url),strip(read('protocol/engine.ts')));
let rules=strip(read('protocol/rules.ts')).replace(/^import[\s\S]*?;\n/gm,'');
const helpers=body('bugs.ts','redGreenRefusals')+'\n'+body('protocol/entities.ts','receiptCountsIn');
writeFileSync(new URL('rules.mjs',import.meta.url),'import {z} from "zod";\nimport {splitTaskReservation} from "./engine.mjs";\n'+helpers+'\n'+rules);
console.log('Prepared unchanged engine and rules function bodies; only imports/type annotations adapted. Missing unrelated support modules are not mocked or exercised.');

--- probes.mjs ---
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as E from './engine.mjs';
import * as R from './rules.mjs';
const read=n=>JSON.parse(readFileSync('../review09/packages/contracts/src/protocol/data/'+n+'.json'));
const reward=read('reward-policy.v2'),cap=read('capability-policy.v2'),completion=read('completion-policy.v1');
const params=E.engineParamsFrom(reward,completion),reserve=BigInt(reward.emission.emissionReserveBase);
const log=(name,result)=>console.log(JSON.stringify({name,result},(_,v)=>typeof v==='bigint'?v.toString():v));
const state=()=>E.computeEpoch({epochNumber:1,state:E.initialState(reserve),consumedIds:new Set(),issuances:[{taskId:'t',kind:'execution',budgetAcuMicro:12000000n,featurePoolKeys:[],applicationPoolKeys:[]}]},params);
for(const [name,claim] of Object.entries({self_pick:{mode:'self_pick',queueBonusBp:2000,bonusApplies:false},queue:{mode:'queue',queueBonusBp:2000,bonusApplies:true},omitted:undefined,zero_bonus:{mode:'self_pick',queueBonusBp:0,bonusApplies:false}})){
 const a=state(),reserved=a.state.reserved.get('t').amount;
 const b=E.computeEpoch({epochNumber:2,state:a.state,consumedIds:new Set(a.consumedIds),acceptances:[{taskId:'t',shares:[{accountId:'a',beneficiaryId:'a',shareBp:10000}],...(claim?{claim}:{})}]},params);
 E.assertConserved(reserve,b.state);
 const paid=b.allocations.filter(x=>x.receiptId==='t').reduce((s,x)=>s+x.amountBase,0n);
 const refusals=R.taskAllocationRefusals({reservedBase:reserved,receipts:[{receiptId:'t',accountId:'a',shareBp:10000,orgShareBp:0}],lines:[{receiptId:'t',beneficiary:'person',amount:paid}]});
 log(name,{reserved,paid,returned:b.queueBonusReturnedBase,refusals,conserved:true});
 if(name==='self_pick') {assert(refusals.length);let rejected=false;try{E.computeEpoch({epochNumber:3,state:b.state,consumedIds:new Set([...a.consumedIds,...b.consumedIds]),acceptances:[{taskId:'t',shares:[{accountId:'a',beneficiaryId:'a',shareBp:10000}],claim}]},params);}catch{rejected=true;}assert(rejected);log('replay',{rejected});}
}
for(const kind of ['abu_build','abu_revision','architecture_author'])log('budget_'+kind,R.budgetModelMicro({capabilityBudgets:cap.budgets,model:reward.budgets.model,humanReviewWeights:{},bugs:reward.bugs},{taskKind:kind,sizePoints:2,difficultyBp:10000,importanceBp:10000,...(kind.startsWith('abu')?{severity:'high'}:{})}));
const green={bug:'BUG-21',feature:'unrelated',regressionTest:'features/unrelated/acceptance/regressions/BUG-21.spec.ts',parent:{sha:'a'.repeat(40),conclusion:'failure',failedTests:['features/unrelated/acceptance/regressions/BUG-21.spec.ts']},head:{sha:'b'.repeat(40),conclusion:'success',failedTests:[]},testSha256:'sha256:'+'c'.repeat(64)};
const route={acceptance:reward.acceptance,contributionType:'BUG_FIX',slice:'execution',evidenceClass:'accepted_budget',taskKind:'execution',hasLease:true,receiptAccountId:'fixer',taskId:'fix-BUG-20',humanReview:null,bugFix:{outcome:'fix',effectiveSeverity:'high',budgetSeverity:'high',redGreen:green,fixerTriagedIt:false,fixerIsBarredIntroducer:false}};
log('unrelated_red_green',R.receiptRouteRefusals(route));
log('fix_disguised_as_implementation',R.receiptRouteRefusals({...route,contributionType:'IMPLEMENTATION',bugFix:{...route.bugFix,redGreen:null,fixerTriagedIt:true,fixerIsBarredIntroducer:true}}));
log('correction_after_issue',R.receiptRouteRefusals({...route,bugFix:{...route.bugFix,effectiveSeverity:'low'}}));
for(const status of ['ACTIVE','RATIFIED','FINAL_BY_SILENCE','PROVISIONAL','REVOKED'])log('R08-1_'+status,R.allocationChallengeRefusals({epochState:'PROPOSED',nowMs:1,windowClosesAtMs:2,receiptStatus:status,frozenReceiptSha256:'h',currentReceiptSha256:'h',publishedAllocationsRoot:'r',citedAllocationsRoot:'r',allocationOfReceiptInEpoch:true,challengerIsAccusedOrRelated:false,alreadyChallengedUndecided:false}));
for(const n of [0n,1n,5n,1001n,1200n,999999999999999999n]){const b=E.queueBasePrice(n,2000);assert(b>=0n&&b<=n);assert.equal(b,(n*10000n)/12000n);log('rounding',{reserved:n,base:b,returned:n-b});}

--- q1.mjs ---
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
const db=new PGlite();
await db.exec('create schema wos; create table wos.run_policy_snapshots(lease_id uuid, body jsonb); create table wos.contribution_receipts(id uuid,task_id uuid,lease_id uuid); create table wos.task_budgets(task_id uuid,reserved_base bigint); create table wos.allocations(receipt_id uuid,amount_base bigint);');
let sql=readFileSync('../review09/packages/db/migrations/0010_bugs_and_maintenance.sql','utf8');sql=sql.slice(sql.indexOf('create or replace function wos.check_claim_snapshot()'),sql.indexOf('-- Append-only, grants, RLS'));
await db.exec(sql);
for (const [i,claim,amount] of [[1,{mode:'self_pick',queueBonusBp:2000,bonusApplies:false},1200],[2,undefined,1200],[3,{mode:'self_pick',queueBonusBp:0,bonusApplies:false},1200],[4,{mode:'self_pick',queueBonusBp:2000,bonusApplies:false},1000],[5,{mode:'self_pick',queueBonusBp:2000,bonusApplies:false},999]]) {
const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');
await db.query('insert into wos.task_budgets values($1,1200)',[id]);await db.query('insert into wos.run_policy_snapshots values($1,$2)',[id,claim?{claim}:{}]);await db.query('insert into wos.contribution_receipts values($1,$1,$1)',[id]);
try{await db.query('insert into wos.allocations values($1,$2)',[id,amount]);console.log(JSON.stringify({i,claim,amount,accepted:true}));}catch(e){console.log(JSON.stringify({i,claim,amount,accepted:false,error:e.message}));}}
await db.close();

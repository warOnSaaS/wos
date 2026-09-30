import { registerHooks } from 'node:module';
import { readFileSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(spec,ctx,next){if(spec==='@waronsaas/contracts/protocol')return next(new URL('./packages/contracts/src/protocol/index.ts',import.meta.url).href,ctx);if(spec.startsWith('.')&&spec.endsWith('.js')&&ctx.parentURL?.startsWith('file:')){const u=new URL(spec.slice(0,-3)+'.ts',ctx.parentURL);if(existsSync(fileURLToPath(u)))return next(u.href,ctx);}return next(spec,ctx);}});
const e=await import('./packages/contracts/src/protocol/engine.ts');
const g=await import('./packages/contracts/src/protocol/governance.ts');
const u=await import('./packages/contracts/src/protocol/usage.ts');
const read=n=>JSON.parse(readFileSync(new URL('./packages/contracts/src/protocol/data/'+n+'.v1.json',import.meta.url),'utf8'));
const p0=e.engineParamsFrom(read('reward-policy'),read('completion-policy'));

const r=await import('./packages/contracts/src/protocol/rules.ts');
const m=await import('./packages/contracts/src/protocol/machines.ts');
const ent=await import('./packages/contracts/src/protocol/entities.ts');
const run=(name,fn)=>{try{console.log(JSON.stringify({name,result:fn()},(_,v)=>typeof v==='bigint'?v.toString():v instanceof Map?Object.fromEntries(v):v));}catch(err){console.log(JSON.stringify({name,error:err.message}));}};
const small={...p0,emissionReserve:1000n,budgetPpm:1000000n,rateCeilingInitialBasePerAcu:100n,rateCeilingDecayPpm:0n,budgetExpiryEpochs:4,reviewGraceEpochs:2,holdbackBp:0n};
const fresh=(state=e.initialState(1000n),epochNumber=1,ids=[])=>({epochNumber,state,consumedIds:new Set(ids)});
const iss=(taskId,budgetAcuMicro=1000000n)=>({taskId,kind:'execution',budgetAcuMicro,featurePoolKeys:['feature'],applicationPoolKeys:['app']});
const acc=taskId=>({taskId,shares:[{accountId:'alice',beneficiaryId:'alice',shareBp:10000}]});
const snap={schema:'wos-run-policy-snapshot.v1',leaseId:'00000000-0000-4000-8000-000000000c03',leaseGeneration:1,policyVersions:{reward:'reward-policy.v1',oracle:'cost-oracle.v1',review:'review-policy.v1',usageProof:'usage-proof-policy.v1',agent:'agent-policy.v1',capability:'capability-policy.v1',risk:'risk-policy.v1',merge:'merge-policy.v1',completion:'completion-policy.v1'},capabilityClass:'PLAN_L1',provider:'claude_cli',modelId:'claude-opus-5-5',reasoningRequired:'max',reservedCapAcuMicro:'60000000',humanReviewRequired:true,riskClass:'standard',issuedAt:'2026-09-30T00:00:00.000Z'};
const q={subjectKind:'document',subjectId:'d1',revision:'b'.repeat(40),lease:{id:snap.leaseId,generation:1,accountId:'bob',taskKind:'roadmap_author',taskAttemptId:null,taskAbuId:null,taskDocumentId:'d1',issuedAtMs:0,expiresAtMs:100,hardDeadlineAtMs:200,endedAtMs:null},citedGeneration:1,changeset:{leaseId:snap.leaseId,ok:true,signatureValid:true,createdAtMs:50,submissionSha256:'s9'},round:{state:'revealed',outcome:'consensus',headSha:'b'.repeat(40),submissionSha256:'s9',attemptId:null,documentId:'d1',reviewVerdicts:[{slot:'astra',verdict:'NO_MATERIAL_GAPS'},{slot:'fable',verdict:'NO_MATERIAL_GAPS'}]},greenCiAtHead:false,snapshotBody:snap,humanPreMergePassOnRound:true};

const hash=await import('./packages/contracts/src/protocol/receipts.ts');
const review=read('review-policy'),cap=read('capability-policy');
const bind=body=>{const sha=hash.runPolicySnapshotSha256(body);return {snapshotBody:body,snapshotRow:{leaseId:body.leaseId,generation:body.leaseGeneration,snapshotSha256:sha},qualificationSnapshotSha256:sha};};
const base={...q,...bind(snap),pinnedReviewPolicy:review,pinnedCapabilityPolicy:cap,receiptLabels:[{label:'single_lab_review',reason:'fable_unavailable'}],round:{...q.round,reviewVerdicts:[{slot:'astra',verdict:'NO_MATERIAL_GAPS',provider:'codex_cli',modelId:'gpt-6-astra',reasoning:'max'}]}};

run('R07-1_valid_fallback',()=>r.qualificationRefusals(base));
run('R07-1_unknown_risk_refused',()=>r.qualificationRefusals({...base,...bind({...snap,riskClass:'unknown-risk'}),round:{...base.round,reviewVerdicts:[]}}));
run('R07-1_wrong_capability_version_refused',()=>r.qualificationRefusals({...base,pinnedCapabilityPolicy:{...cap,policyVersion:'capability-policy.v2'}}));
run('R07-1_wrong_provider_refused',()=>r.qualificationRefusals({...base,round:{...base.round,reviewVerdicts:[{...base.round.reviewVerdicts[0],provider:'claude_cli'}]}}));
run('R07-5_machine_endpoints_declared',()=>m.ReceiptStatusMachine.transitions.filter(t=>!m.ReceiptStatusMachine.states.includes(t.to)||!m.ReceiptStatusMachine.states.includes(t.from)));
run('R07-6_in_epoch_hold_and_release',()=>{const s={...e.initialState(1000n),remainingReserve:900n,cumulativeIssued:100n,claimable:new Map([['alice',100n]])};const out=e.computeEpoch({...fresh(s),holds:[{id:'h',beneficiaryId:'alice',source:'claimable',amount:10n}],holdReleases:[{holdId:'h'}]},small);return {holds:out.state.holds,claimable:out.state.claimable,consumed:out.consumedIds};});
const challenge={epochState:'PROPOSED',nowMs:10,windowClosesAtMs:100,frozenReceiptSha256:'same',currentReceiptSha256:'same',publishedAllocationsRoot:'root',citedAllocationsRoot:'root',allocationOfReceiptInEpoch:true,challengerIsAccusedOrRelated:false,alreadyChallengedUndecided:false};
for(const receiptStatus of ['ACTIVE','RATIFIED','FINAL_BY_SILENCE'])run('R08-1_allocation_challenge_'+receiptStatus,()=>r.allocationChallengeRefusals({...challenge,receiptStatus}));
run('R08-1_old_D54_window_already_closed',()=>r.challengeAdmissionRefusals({publication:{receiptSha256:'same',bootstrapEndedAtMs:0,publishedAtMs:1,closesAtMs:5,notified:true},nowMs:10,finalized:true}));
run('R07-7_confirmed_ruling_records',()=>r.rulingLabRecordsFromConfirmedRuling({id:'r',state:'confirmed',rulings:[{findingId:'f',decision:'upheld'}]},{kind:'human'},[{findingId:'f',raisedByProvider:'codex_cli'}]));
run('R07-7_unconfirmed_ruling_refused',()=>r.rulingLabRecordsFromConfirmedRuling({id:'r',state:'awaiting_maintainer',rulings:[{findingId:'f',decision:'upheld'}]},{kind:'human'},[{findingId:'f',raisedByProvider:'codex_cli'}]));

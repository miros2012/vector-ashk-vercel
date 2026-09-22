import test from 'node:test';import assert from 'node:assert/strict';
import { financeCycleHealth, verifiedFinanceCycleHealth } from '../lib/finance-cycle-status.js';
test('green sources cannot turn partial, failed, corrupt or absent cycles green',()=>{
 for(const state of [null,{status:'COMPLETE'},{status:'FAILED'},{status:'RUNNING'}])assert.equal(financeCycleHealth(state).ok,false);
});
test('only verified completed cycle is overall OK; internal tail explicitly allows own verified running cycle',()=>{
 const names=['tochkaDds','reports','payments','receivablesSource','ropPublish','balances','reportVerification','dataHealth','decisions'];
 const state={version:1,id:'id',mode:'intraday',status:'COMPLETE',cursor:9,attempt:0,startedAt:'2026-09-22T10:00:00Z',finishedAt:'2026-09-22T10:10:00Z',completed:names.map(stage=>({stage,ok:true,fingerprint:'a'.repeat(64)}))};
 const now=new Date('2026-09-22T10:11:00Z');assert.equal(financeCycleHealth(state,{now}).ok,true);
 state.cursor=7;state.completed=state.completed.slice(0,7);state.status='RUNNING';delete state.finishedAt;
 assert.equal(financeCycleHealth(state,{now}).ok,false);
 assert.equal(financeCycleHealth(state,{now,internalCycleId:'id'}).ok,true);
 state.pendingFull=true; assert.equal(financeCycleHealth(state,{now,internalCycleId:'id'}).ok,true);
 assert.equal(financeCycleHealth(state,{now,internalCycleId:'other'}).ok,false);
});

test('completed-cycle consumer cannot return OK after independent report invalidation',async()=>{
 const names=['tochkaDds','reports','payments','receivablesSource','ropPublish','balances','reportVerification','dataHealth','decisions'];
 const state={version:1,id:'id',mode:'intraday',status:'COMPLETE',cursor:9,attempt:0,startedAt:'2026-09-22T10:00:00Z',finishedAt:'2026-09-22T10:10:00Z',completed:names.map(stage=>({stage,ok:true,fingerprint:'a'.repeat(64)}))};
 const result=await verifiedFinanceCycleHealth(state,{now:new Date('2026-09-22T10:11:00Z')},async fingerprint=>({ok:false,errorClass:'REPORT_STALE'}));
 assert.equal(result.ok,false);assert.equal(result.reason,'finance-report-stale');
});

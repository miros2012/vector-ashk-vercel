import test from 'node:test';import assert from 'node:assert/strict';
import { createFinanceCycleHandler, financeHealthFailure, invokeFinanceStage } from '../lib/finance-cycle-handler.js';
import { financeRouteHarness, cronRequest } from './helpers/finance-route-harness.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}});
test('health distinguishes pending bank import, stale reports and other blocked data',async()=>{
 const pending=financeHealthFailure({ok:false,tochkaDds:{ok:false,missingFingerprint:'b'.repeat(64)},cycle:{reason:'finance-report-stale'}});
 assert.equal(pending.errorClass,'DDS_PENDING');
 const result=await invokeFinanceStage(async(req,res)=>res.status(503).json({ok:false,...pending}),'secret');
 assert.equal(result.sourceFingerprint,'b'.repeat(64));assert.equal(result.ok,false);
 assert.equal(financeHealthFailure({ok:false,tochkaDds:{ok:true},cycle:{reason:'finance-report-stale'}}).errorClass,'REPORT_STALE');
 assert.equal(financeHealthFailure({ok:false,tochkaDds:{ok:true},cycle:{ok:true}}).errorClass,'DATA_HEALTH_BLOCKED');
});
test('native cron query selects intraday without undocumented schedule header',async t=>{
 const f=await financeRouteHarness(t);const req=cronRequest();delete req.headers['x-vercel-cron-schedule'];req.url='/api/nightly-finance-orchestrator?kind=intraday';
 await f.route.default(req,response());assert.equal(f.cycle.mode,'intraday');
});
test('native recovery query never starts a new cycle',async t=>{
 const f=await financeRouteHarness(t);const req=cronRequest();delete req.headers['x-vercel-cron-schedule'];req.url='/api/nightly-finance-orchestrator?kind=recovery';
 const r=response();await f.route.default(req,r);assert.equal(r.body.mode,'recovery_idle');assert.equal(f.cycle,null);
});
test('native cron modes still require the server secret',async t=>{
 const f=await financeRouteHarness(t);
 for(const kind of ['full','intraday','recovery']){
 const r=response();await f.route.default({method:'GET',headers:{},query:{kind}},r);
 assert.equal(r.statusCode,403);assert.equal(f.cycle,null);
 }
});
test('unauthenticated requests cannot create a cycle or access its state',async()=>{let calls=0;const h=createFinanceCycleHandler({cronSecret:'secret',run:async()=>{calls++;}});const r=response();await h({method:'GET',headers:{}},r);assert.equal(r.statusCode,403);assert.equal(calls,0);});
test('recovery dispatch and pending response expose partial completion honestly',async()=>{let options;const h=createFinanceCycleHandler({cronSecret:'secret',run:async o=>{options=o;return {ok:true,pending:true,complete:false,stage:'reports',statusCode:202};}});const r=response();await h({method:'GET',headers:{authorization:'Bearer secret','x-vector-finance-recovery-only':'true'}},r);assert.equal(options.recoveryOnly,true);assert.equal(r.statusCode,202);assert.equal(r.body.complete,false);});
test('native recovery drains successive checkpointed stages in one invocation',async()=>{
 let calls=0;
 const h=createFinanceCycleHandler({cronSecret:'secret',recoveryOnly:true,maxStages:10,run:async()=>{
  calls++;
  return {ok:true,pending:calls<3,complete:calls===3,stage:`stage${calls}`,statusCode:calls<3?202:200};
 }});
 const r=response();await h({method:'GET',headers:{authorization:'Bearer secret'}},r);
 assert.equal(calls,3);assert.equal(r.statusCode,200);assert.equal(r.body.complete,true);
});
test('native recovery stops at deferred stage and never loops on waiting data',async()=>{
 let calls=0;
 const h=createFinanceCycleHandler({cronSecret:'secret',recoveryOnly:true,maxStages:10,run:async()=>{
  calls++;return {ok:true,pending:true,deferred:true,statusCode:202};
 }});
 const r=response();await h({method:'GET',headers:{authorization:'Bearer secret'}},r);
 assert.equal(calls,1);assert.equal(r.body.deferred,true);
});
test('resumed data-health checkpoint refreshes the bank marker before evaluating health',async t=>{
 const f=await financeRouteHarness(t);const req=cronRequest();delete req.headers['x-vercel-cron-schedule'];req.url='/api/nightly-finance-orchestrator?kind=intraday';
 for(let i=0;i<8;i++)await f.route.default(req,response());
 f.events.length=0;const r=response();await f.route.default(req,r);
 assert.deepEqual(f.events.filter(event=>['tochkaDds','balances','dataHealth'].includes(event)),['balances','dataHealth']);
 assert.equal(r.statusCode,202);assert.equal(r.body.stage,'dataHealth');
});
test('resumed data-health checkpoint stays fail-closed when the bank marker refresh fails',async t=>{
 const f=await financeRouteHarness(t);const req=cronRequest();delete req.headers['x-vercel-cron-schedule'];req.url='/api/nightly-finance-orchestrator?kind=intraday';
 for(let i=0;i<8;i++)await f.route.default(req,response());
 f.setStageStatus('balances',502);f.events.length=0;const failed=response();await f.route.default(req,failed);
 assert.deepEqual(f.events.filter(event=>['tochkaDds','balances','dataHealth','decisions','ownerActionQueue'].includes(event)),['balances']);
 assert.equal(failed.statusCode,503);assert.equal(failed.body.stage,'dataHealth');assert.equal(f.cycle.cursor,7);
 f.setStageStatus('balances',200);f.events.length=0;const retried=response();await f.route.default(req,retried);
 assert.deepEqual(f.events.filter(event=>['tochkaDds','balances','dataHealth','decisions','ownerActionQueue'].includes(event)),['balances','dataHealth']);
 assert.equal(retried.statusCode,202);assert.equal(f.cycle.cursor,8);
});

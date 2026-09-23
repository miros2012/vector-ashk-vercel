import test from 'node:test';import assert from 'node:assert/strict';
import { createFinanceCycleHandler } from '../lib/finance-cycle-handler.js';
import { financeRouteHarness, cronRequest } from './helpers/finance-route-harness.js';
const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}});
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

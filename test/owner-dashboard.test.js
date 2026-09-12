import test from 'node:test';
import assert from 'node:assert/strict';
import { issueSession, verifySession } from '../lib/owner-dashboard-session.js';
import { createOwnerDashboardApi } from '../lib/owner-dashboard-api.js';
import { ownerDashboardView } from '../lib/owner-dashboard-view-model.js';
const secret='a-dedicated-owner-secret-of-at-least-32-characters';
const now=Date.parse('2026-09-12T10:00:00Z');
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};}
const request=(route,method='GET',extra={})=>({method,query:{ownerRoute:route},headers:{host:'owner.example',origin:'https://owner.example'},...extra});
test('sessions expire, reject tampering and rotation; contain no secret',()=>{
 const token=issueSession(secret,now); assert.equal(verifySession(token,secret,now),true);
 assert.equal(verifySession(token,secret,now+8*3600000),false);
 assert.equal(verifySession(token+'x',secret,now),false);
 assert.equal(verifySession(token,'another-secret-of-at-least-32-characters',now),false);
 assert.equal(verifySession(token,'',now),false); assert.ok(!token.includes(secret));
});
test('login rejects wrong keys and cross-origin posts, cookie has security flags',async()=>{
 const api=createOwnerDashboardApi({secret,now:()=>now,readPackage:()=>{throw Error('should not read');}});
 for(const [body,origin,code] of [[{secret:'bad'},'https://owner.example',403],[{secret},'https://evil.example',403],[{secret},undefined,403],[{secret},'https://owner.example',200]]){
 const res=response();await api(request('dashboard-session','POST',{body,headers:{host:'owner.example',origin}}),res);assert.equal(res.code,code);
 if(code===200){assert.match(res.headers['Set-Cookie'],/^__Host-vector_owner=/);for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age='])assert.ok(res.headers['Set-Cookie'].includes(flag));assert.deepEqual(res.body,{ok:true});}
 assert.equal(res.headers['Cache-Control'],'no-store');
 }
});
test('data authorization precedes reads; logout clears cookie; unsupported methods fail',async()=>{
 let reads=0;const api=createOwnerDashboardApi({secret,now:()=>now,readPackage:async()=>{reads++;return {snapshot:{availableCash:0}};}});
 const denied=response();await api(request('dashboard-data'),denied);assert.equal(denied.code,401);assert.equal(reads,0);
 const allowed=response();await api(request('dashboard-data','GET',{headers:{cookie:`__Host-vector_owner=${issueSession(secret,now)}`}}),allowed);assert.equal(allowed.code,200);assert.equal(reads,1);
 const method=response();await api(request('dashboard-data','POST'),method);assert.equal(method.code,405);assert.equal(reads,1);
 const logout=response();await api(request('dashboard-session','DELETE'),logout);assert.equal(logout.code,200);assert.match(logout.headers['Set-Cookie'],/Max-Age=0/);
});
test('unconfigured auth and source failure fail closed without leaking errors',async()=>{
 let reads=0;const api=createOwnerDashboardApi({secret:'',readPackage:async()=>{reads++;}});const res=response();await api(request('dashboard-session','POST',{body:{secret:''}}),res);assert.equal(res.code,503);assert.equal(reads,0);
 const failed=createOwnerDashboardApi({secret,now:()=>now,readPackage:async()=>{throw Error('private sheet and key');}});const r=response();await failed(request('dashboard-data','GET',{headers:{cookie:`__Host-vector_owner=${issueSession(secret,now)}`}}),r);assert.equal(r.code,503);assert.ok(!JSON.stringify(r.body).includes('private'));
});
test('projection preserves zero and missing; policy blocks withdrawal; no private fields',()=>{
 const view=ownerDashboardView({snapshot:{availableCash:0,safeWithdrawal:100,dataHealth:{status:'OK',reasons:[]}},policy:{blockers:['OPERATING_RESERVE_UNDEFINED']},privateKey:'hidden'});
 assert.equal(view.metrics.availableCash,0);assert.equal(view.metrics.receivables,null);assert.equal(view.metrics.safeWithdrawal,null);assert.equal(view.health.status,'OK');assert.ok(!JSON.stringify(view).includes('hidden'));
});
test('forecast contains only source days, never invents horizon; actions use current agenda',()=>{
 const view=ownerDashboardView({snapshot:{businessDate:'2026-09-12'},cashScenario:{forecast:{scenarios:[{name:'base',daily:[{date:'2026-09-13',closingBalance:-20}],minimumBalance:-20,minimumBalanceDate:'2026-09-13',cashGap:20}]}},agenda:{actions:[{id:'live',action:'Collect',amount:0}]},history:[{action:'closed'}]});
 assert.deepEqual(view.scenarios[0].daily,[{date:'2026-09-13',closingBalance:-20}]);assert.equal(view.actions.length,1);assert.equal(view.actions[0].id,'live');assert.ok(!JSON.stringify(view).includes('closed'));
});

test('verified blocked zero remains zero with explicit withdrawal gate',()=>{
 const view=ownerDashboardView({snapshot:{safeWithdrawal:0,dataHealth:{status:'BLOCKED',reasons:['stale']}},policy:{blockers:[]}});
 assert.equal(view.metrics.safeWithdrawal,0);assert.equal(view.withdrawalBlocked,true);
});

test('unknown obligation amounts never appear as zero or complete totals',()=>{
 const view=ownerDashboardView({snapshot:{safeWithdrawal:0,unconfirmedObligations:0,openObligations:100000,dataHealth:{status:'OK',reasons:[]}},policy:{blockers:['UNCONFIRMED_OBLIGATION_AMOUNT_MISSING']}});
 assert.equal(view.metrics.unconfirmedObligations,null);assert.equal(view.metrics.openObligations,null);assert.equal(view.metrics.safeWithdrawal,0);
});

test('deployed dispatcher protects both rewritten and direct dashboard routes without Google secrets',async()=>{
 const {default:handler}=await import('../api/decision-event.js');
 const saved=process.env.VECTOR_OWNER_DASHBOARD_SECRET;
 delete process.env.VECTOR_OWNER_DASHBOARD_SECRET;
 try {
  for(const url of ['/api/decision-event?ownerRoute=dashboard-data','/api/owner-dashboard-data?ownerRoute=dashboard-data']){
   const res=response();await handler({url,method:'GET',headers:{}},res);assert.equal(res.code,503);assert.deepEqual(res.body,{ok:false,error:'authentication_unavailable'});assert.equal(res.headers['Cache-Control'],'no-store');
  }
 }finally{if(saved===undefined)delete process.env.VECTOR_OWNER_DASHBOARD_SECRET;else process.env.VECTOR_OWNER_DASHBOARD_SECRET=saved;}
});

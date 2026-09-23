import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceCycle } from '../lib/finance-cycle.js';

function fixture() {
  let state = null;
  let busy = false;
  const events = [];
  const store = {
    acquire: async () => busy ? { ok: false, busy: true } : (busy = true, { ok: true }),
    release: async () => { busy = false; },
    read: async () => structuredClone(state),
    write: async value => { state = structuredClone(value); events.push(`save:${value.status}:${value.cursor}`); }
  };
  const stages = Object.fromEntries(['import', 'reports', 'verify'].map(name => [name, async () => {
    events.push(name); assert.equal(state.status, 'RUNNING'); return { ok: true };
  }]));
  const run = createFinanceCycle({ store, stages, sequence: () => ['import', 'reports', 'verify'], now: () => new Date('2026-09-22T10:00:00Z') });
  return { run, store, stages, events, state: () => state, set: v => { state = v; } };
}

test('each invocation checkpoints one stage and only final verified stage completes cycle', async () => {
  const f = fixture();
  assert.equal((await f.run({ mode: 'full' })).pending, true);
  assert.deepEqual(f.events.slice(0, 3), ['save:RUNNING:0', 'import', 'save:PENDING:1']);
  assert.equal((await f.run({ recoveryOnly: true })).stage, 'reports');
  const done = await f.run({ recoveryOnly: true });
  assert.equal(done.complete, true);
  assert.equal(f.state().status, 'COMPLETE');
  assert.equal((await f.run({ recoveryOnly: true })).mode, 'recovery_idle');
  assert.deepEqual(f.events.filter(e => !e.startsWith('save:')), ['import', 'reports', 'verify']);
});

test('crash before completion resumes same stage and keeps prior successes', async () => {
  const f = fixture(); await f.run({});
  const state = structuredClone(f.state()); state.status = 'RUNNING'; f.set(state);
  await f.run({ recoveryOnly: true });
  assert.equal(f.state().cursor, 2);
  assert.equal(f.events.filter(e => e === 'import').length, 1);
});

test('failed stages never advance or claim complete; retry stops after three failures', async () => {
  const f = fixture(); f.stages.import = async () => ({ ok: false, errorClass: 'SHEETS_READBACK' });
  for (let i = 0; i < 3; i++) assert.equal((await f.run({ recoveryOnly: i > 0 })).ok, false);
  assert.equal(f.state().cursor, 0); assert.equal(f.state().status, 'BLOCKED');
  assert.equal((await f.run({ recoveryOnly: true })).blocked, true);
  f.stages.import = async () => ({ ok: true });
  assert.equal((await f.run({})).pending, true);
});

test('checkpoint failure prevents side effects and competing lease cannot execute', async () => {
  const f = fixture(); f.store.write = async () => { throw Error('offline'); };
  assert.equal((await f.run({})).ok, false);
  assert.deepEqual(f.events, []);
  f.store.acquire = async () => ({ ok: false, busy: true });
  assert.equal((await f.run({})).busy, true);
});

test('unknown stage or corrupted cursor blocks instead of silently starting over', async () => {
  const f = fixture(); await f.run({}); f.state().cursor = 99;
  assert.equal((await f.run({})).ok, false);
  assert.equal(f.events.filter(e => e === 'import').length, 1);
});

test('three hard runtime kills block recovery without a fourth side effect',async()=>{
 const f=fixture();await f.run({});
 const state=structuredClone(f.state());state.status='RUNNING';state.attempt=3;f.set(state);
 assert.equal((await f.run({recoveryOnly:true})).blocked,true);
 assert.equal(f.state().cursor,1);
 assert.equal(f.events.includes('reports'),false);
});
test('lease release transport failure does not erase durable successful checkpoint',async()=>{
 const f=fixture();f.store.release=async()=>{throw Error('transport');};
 assert.equal((await f.run({})).pending,true);
 assert.equal(f.state().cursor,1);
});

test('full request during an intraday cycle is retained and drained by recovery',async()=>{
 let state=null;const seen=[];
 const store={acquire:async()=>({ok:true}),release:async()=>{},read:async()=>structuredClone(state),write:async s=>{state=structuredClone(s);}};
 const stages=Object.fromEntries(['import','hours'].map(stage=>[stage,async()=>{seen.push(stage);return {ok:true};}]));
 const run=createFinanceCycle({store,stages,sequence:mode=>mode==='full'?['import','hours']:['import','import']});
 await run({mode:'intraday'});const queued=await run({mode:'full'});
 assert.equal(queued.pending,true);
 await run({recoveryOnly:true});assert.equal(state.mode,'full');
 assert.equal((await run({recoveryOnly:true})).complete,true);
 assert.ok(seen.includes('hours'));
});
test('stale report during tail rewinds only report verification and later stages',async()=>{
 let state=null;let fail=true;
 const store={acquire:async()=>({ok:true}),release:async()=>{},read:async()=>structuredClone(state),write:async s=>{state=structuredClone(s);}};
 const sequence=()=>['import','reportVerification','decisions'];
 const run=createFinanceCycle({store,sequence,stages:{import:async()=>({ok:true}),reportVerification:async()=>({ok:true,fingerprint:'a'.repeat(64)}),decisions:async()=>fail?{ok:false,errorClass:'REPORT_STALE'}:{ok:true}}});
 await run({});await run({recoveryOnly:true});
 assert.equal(state.completed[1].fingerprint,'a'.repeat(64));
 await run({recoveryOnly:true});assert.equal(state.cursor,1);assert.equal(state.completed.length,1);
 fail=false;await run({recoveryOnly:true});assert.equal((await run({recoveryOnly:true})).complete,true);
});

function movingSourceFixture() {
 let state=null, clock=new Date('2026-09-23T05:00:00Z'); const calls=[];
 let missing='', reportStale=false;
 const sequence=()=>['tochkaDds','payments','balances','reportVerification','dataHealth','decisions'];
 const stages=Object.fromEntries(sequence().map(stage=>[stage,async()=>{calls.push(stage);return {ok:true,fingerprint:'a'.repeat(64)};}]));
 stages.dataHealth=async()=>{calls.push('dataHealth');return missing?{ok:false,errorClass:'DDS_PENDING',sourceFingerprint:missing}:{ok:true};};
 stages.decisions=async()=>reportStale?{ok:false,errorClass:'REPORT_STALE'}:{ok:true};
 const store={acquire:async()=>({ok:true}),release:async()=>{},read:async()=>structuredClone(state),write:async s=>{state=structuredClone(s);}};
 const run=createFinanceCycle({store,stages,sequence,now:()=>clock});
 return {run,calls,stages,state:()=>state,missing:v=>{missing=v;},stale:v=>{reportStale=v;},advance:()=>{clock=new Date(clock.getTime()+300001);}};
}
test('final bank import runs before report verification without replaying payments',async()=>{
 const f=movingSourceFixture();for(let i=0;i<4;i++)await f.run({});
 assert.deepEqual(f.calls,['tochkaDds','payments','balances','tochkaDds']);
 assert.equal(f.state().cursor,3);assert.equal(f.state().finalImportDone,true);
 await f.run({recoveryOnly:true});assert.equal(f.state().cursor,4);
});
test('late bank data rewinds only the tail and completes after catch-up',async()=>{
 const f=movingSourceFixture();for(let i=0;i<5;i++)await f.run({});
 f.missing('b'.repeat(64));const pending=await f.run({recoveryOnly:true});
 assert.equal(pending.ok,true);assert.equal(pending.statusCode,202);assert.equal(pending.complete,false);
 assert.equal(f.state().cursor,3);assert.equal(f.state().finalImportDone,false);
 f.missing('');for(let i=0;i<4;i++)await f.run({recoveryOnly:true});
 assert.equal(f.state().status,'COMPLETE');assert.equal(f.calls.filter(s=>s==='payments').length,1);
});
test('same missing bank operations after repair remain a real visible failure',async()=>{
 const f=movingSourceFixture();for(let i=0;i<5;i++)await f.run({});f.missing('b'.repeat(64));
 await f.run({recoveryOnly:true});await f.run({recoveryOnly:true});await f.run({recoveryOnly:true});
 const failed=await f.run({recoveryOnly:true});assert.equal(failed.ok,false);assert.equal(failed.errorClass,'DDS_IMPORT_INCOMPLETE');
 assert.notEqual(f.state().status,'COMPLETE');
});
test('continuous data changes yield a durable cooldown and resume without claiming completion',async()=>{
 const f=movingSourceFixture();for(let i=0;i<5;i++)await f.run({});
 for(const digit of ['b','c']) {f.missing(digit.repeat(64));await f.run({recoveryOnly:true});await f.run({recoveryOnly:true});await f.run({recoveryOnly:true});}
 f.missing('d'.repeat(64));const waiting=await f.run({recoveryOnly:true});
 assert.equal(waiting.deferred,true);assert.equal(waiting.complete,false);assert.equal(f.state().status,'PENDING');
 const count=f.calls.length;assert.equal((await f.run({recoveryOnly:true})).deferred,true);assert.equal(f.calls.length,count);
 f.advance();f.missing('');for(let i=0;i<4;i++)await f.run({recoveryOnly:true});assert.equal(f.state().status,'COMPLETE');
});
test('final import failure cannot advance reports and retains the attempt limit',async()=>{
 const f=movingSourceFixture();for(let i=0;i<3;i++)await f.run({});
 f.stages.tochkaDds=async()=>({ok:false,errorClass:'IMPORT_FAILED'});
 for(let i=0;i<3;i++)assert.equal((await f.run({recoveryOnly:true})).ok,false);
 assert.equal(f.state().status,'BLOCKED');assert.equal(f.state().cursor,3);
 assert.equal(f.calls.includes('reportVerification'),false);
});
test('third transient import timeout defers recovery without replaying prior stages',async()=>{
 const f=movingSourceFixture();for(let i=0;i<3;i++)await f.run({});
 f.stages.tochkaDds=async()=>({ok:false,errorClass:'DDS_TRANSPORT'});
 for(let i=0;i<2;i++)assert.equal((await f.run({recoveryOnly:true})).errorClass,'DDS_TRANSPORT');
 const deferred=await f.run({recoveryOnly:true});
 assert.equal(deferred.ok,true);assert.equal(deferred.deferred,true);
 assert.equal(deferred.reason,'UPSTREAM_UNAVAILABLE');
 assert.equal(f.state().status,'PENDING');assert.equal(f.state().cursor,3);
 assert.equal(f.state().attempt,0);assert.equal(f.state().errorClass,'DDS_TRANSPORT');
 assert.equal((await f.run({recoveryOnly:true})).deferred,true);
 f.advance();f.stages.tochkaDds=async()=>({ok:true});
 for(let i=0;i<4;i++)await f.run({recoveryOnly:true});
 assert.equal(f.state().status,'COMPLETE');assert.equal(f.calls.filter(s=>s==='payments').length,1);
});
test('three hours transport failures defer without restarting the completed payments stage',async()=>{
 const f=movingSourceFixture();for(let i=0;i<2;i++)await f.run({});
 f.stages.balances=async()=>({ok:false,errorClass:'HOURS_TRANSPORT'});
 for(let i=0;i<2;i++)assert.equal((await f.run({recoveryOnly:true})).errorClass,'HOURS_TRANSPORT');
 const delayed=await f.run({recoveryOnly:true});assert.equal(delayed.deferred,true);
 assert.equal(f.state().cursor,2);assert.equal(f.state().errorClass,'HOURS_TRANSPORT');
 assert.equal(f.calls.filter(s=>s==='payments').length,1);
});
test('input changing during the report calculation rewinds and stays pending',async()=>{
 const f=movingSourceFixture();for(let i=0;i<4;i++)await f.run({});
 f.stages.reportVerification=async()=>({ok:false,errorClass:'SOURCE_CHANGED'});
 const result=await f.run({recoveryOnly:true});assert.equal(result.ok,true);assert.equal(result.complete,false);
 assert.equal(f.state().status,'PENDING');assert.equal(f.state().cursor,3);assert.equal(f.state().finalImportDone,false);
});

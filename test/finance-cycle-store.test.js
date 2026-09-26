import test from 'node:test';import assert from 'node:assert/strict';
import { createFinanceCycleStore, cycleFromControlRows } from '../lib/google-sheets-finance-cycle-store.js';
function fixture(){let rows=[['existing','keep']];const events=[];const sheets={spreadsheets:{values:{
 get:async()=>({data:{values:structuredClone(rows)}}),
 append:async({requestBody})=>{rows.push(...requestBody.values);},
 update:async({range,requestBody})=>{const n=Number(range.match(/B(\d+)/)[1]);rows[n-1][1]=requestBody.values[0][0];events.push(range);}
}}};const lease={ensureSchema:async()=>({ok:true}),acquireLease:async()=>({ok:true}),releaseLease:async()=>({ok:true})};
return {store:createFinanceCycleStore({sheets,spreadsheetId:'test',lease,sleep:async()=>{}}),sheets,rows:()=>rows,events};}
test('checkpoint is one cell with readback and unrelated controls preserved',async()=>{const f=fixture();await f.store.acquire('owner');const s={id:'cycle',cursor:1};await f.store.write(s);assert.deepEqual(await f.store.read(),s);assert.deepEqual(f.rows()[0],['existing','keep']);await f.store.write({...s,cursor:2});assert.equal(f.events.length,1);assert.equal((await f.store.read()).cursor,2);});
test('duplicate and malformed checkpoint stop recovery',async()=>{const f=fixture();f.rows().push(['finance_cycle_v1','bad']);await assert.rejects(f.store.read);f.rows()[1][1]='{}';f.rows().push(['finance_cycle_v1','{}']);await assert.rejects(f.store.read);});

test('existing blank and JSON-null checkpoints block corruption rather than silently resetting',()=>{
 for(const value of ['', 'null', 'false', '0']) assert.throws(()=>cycleFromControlRows([['finance_cycle_v1',value]]));
});

test('temporary readback outage after committed checkpoint does not replay append',async()=>{
 const f=fixture();const api=f.sheets.spreadsheets.values;const get=api.get;const append=api.append;let failed=false,committed=false,writes=0;
 api.append=async args=>{writes++;await append(args);committed=true;};
 api.get=async args=>{if(committed&&!failed){failed=true;throw Object.assign(Error('temporary'),{code:503});}return get(args);};
 await f.store.write({id:'cycle',cursor:3});
 assert.equal(writes,1);assert.equal((await f.store.read()).cursor,3);
});
test('permanent read failure is not retried or converted to success',async()=>{
 const f=fixture();let reads=0;f.sheets.spreadsheets.values.get=async()=>{reads++;throw Object.assign(Error('denied'),{code:403});};
 await assert.rejects(f.store.read);assert.equal(reads,1);
});
test('stalled checkpoint reads fail within the configured request budget',async()=>{
 const f=fixture();f.sheets.spreadsheets.values.get=async()=>new Promise(()=>{});
 const store=createFinanceCycleStore({sheets:f.sheets,spreadsheetId:'test',requestTimeoutMs:5,sleep:async()=>{}});
 const guard=new Promise((_,reject)=>setTimeout(()=>reject(Error('checkpoint store did not time out')),100));
 await assert.rejects(Promise.race([store.read(),guard]),/Google Sheets request timed out/);
});

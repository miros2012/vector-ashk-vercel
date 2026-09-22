import test from 'node:test';import assert from 'node:assert/strict';
import { createFinanceCycleStore, cycleFromControlRows } from '../lib/google-sheets-finance-cycle-store.js';
function fixture(){let rows=[['existing','keep']];const events=[];const sheets={spreadsheets:{values:{
 get:async()=>({data:{values:structuredClone(rows)}}),
 append:async({requestBody})=>{rows.push(...requestBody.values);},
 update:async({range,requestBody})=>{const n=Number(range.match(/B(\d+)/)[1]);rows[n-1][1]=requestBody.values[0][0];events.push(range);}
}}};const lease={ensureSchema:async()=>({ok:true}),acquireLease:async()=>({ok:true}),releaseLease:async()=>({ok:true})};
return {store:createFinanceCycleStore({sheets,spreadsheetId:'test',lease}),rows:()=>rows,events};}
test('checkpoint is one cell with readback and unrelated controls preserved',async()=>{const f=fixture();await f.store.acquire('owner');const s={id:'cycle',cursor:1};await f.store.write(s);assert.deepEqual(await f.store.read(),s);assert.deepEqual(f.rows()[0],['existing','keep']);await f.store.write({...s,cursor:2});assert.equal(f.events.length,1);assert.equal((await f.store.read()).cursor,2);});
test('duplicate and malformed checkpoint stop recovery',async()=>{const f=fixture();f.rows().push(['finance_cycle_v1','bad']);await assert.rejects(f.store.read);f.rows()[1][1]='{}';f.rows().push(['finance_cycle_v1','{}']);await assert.rejects(f.store.read);});

test('existing blank and JSON-null checkpoints block corruption rather than silently resetting',()=>{
 for(const value of ['', 'null', 'false', '0']) assert.throws(()=>cycleFromControlRows([['finance_cycle_v1',value]]));
});

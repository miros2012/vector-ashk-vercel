import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinanceReportsAdapter} from '../lib/google-sheets-finance-reports.js';
test('report adapter reads bounded canonical ranges and writes only numeric P&L body',async()=>{
 const calls=[];
 const api={
  batchGet:async(a,o)=>{calls.push({a,o});return {data:{valueRanges:[{values:[[1]]},{values:[[2]]},{values:[[3]]},{values:[['label']]}]}};},
  update:async(a,o)=>{calls.push({a,o});},
  get:async(a,o)=>{calls.push({a,o});return {data:{values:[[42]]}};}
 };
 const adapter=createFinanceReportsAdapter({sheets:{spreadsheets:{values:api}},spreadsheetId:'fixture'});
 assert.deepEqual(await adapter.read(),{dds:[[1]],directory:[[2]],revenue:[[3]],layout:['label']});
 await adapter.write([[42]]);assert.deepEqual(await adapter.readOutput(),[[42]]);
 assert.equal(calls[0].a.ranges[0],"'ДДС: месяц'!A5:M30000");
 assert.equal(calls[1].a.range,"'P&L'!B4:M14");assert.equal(calls[1].a.valueInputOption,'RAW');
 assert.equal(calls[2].a.valueRenderOption,'UNFORMATTED_VALUE');
 assert.ok(calls.every(c=>c.o.timeout===45000));
});

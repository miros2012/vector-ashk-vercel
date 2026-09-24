import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTochkaAckRowsReader,
  evaluateTochkaOperationAck,
  normalizeExpectedOperationIdentifiers
} from '../lib/tochka-operation-ack.js';

test('parallel ack polls share a short-lived Sheets snapshot and recheck after expiry',async()=>{
 let reads=0,clock=0,release;
 const reader=createTochkaAckRowsReader({ttlMs:15000,now:()=>clock,load:async()=>{
   reads++;
   if(reads===1)await new Promise(resolve=>{release=resolve;});
   return reads===1?[]:[['tx-later','pay-later']];
 }});
 const first=reader(),second=reader();await Promise.resolve();
 assert.equal(reads,1);release();
 const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);
 assert.equal((await reader()).length,0);assert.equal(reads,1);
 clock=15000;const fresh=await reader();assert.equal(reads,2);
 assert.equal(evaluateTochkaOperationAck({rows:fresh,transactionIds:['tx-later']}).ok,true);
});

test('failed ack snapshot is never cached as success',async()=>{
 let reads=0;const reader=createTochkaAckRowsReader({load:async()=>{
   if(++reads===1)throw Error('Sheets quota');return [['tx-1','pay-1']];
 }});
 await assert.rejects(reader(),/Sheets quota/);
 assert.deepEqual(await reader(),[['tx-1','pay-1']]);assert.equal(reads,2);
});

test('normalizes and deduplicates expected Tochka identifiers', () => {
  assert.deepEqual(normalizeExpectedOperationIdentifiers({
    transactionIds: [' tx-1 ', 'tx-1', '', null],
    paymentIds: ['pay-1', ' pay-2 ']
  }), {
    transactionIds: ['tx-1'],
    paymentIds: ['pay-1', 'pay-2']
  });
});

test('acknowledges only when every expected identifier is visible in Tochka_API', () => {
  const result = evaluateTochkaOperationAck({
    rows: [
      ['tx-1', 'pay-1'],
      ['tx-2', 'pay-2']
    ],
    transactionIds: ['tx-1', 'tx-2'],
    paymentIds: ['pay-2']
  });

  assert.equal(result.ok, true);
  assert.equal(result.expectedCount, 3);
  assert.equal(result.matchedCount, 3);
  assert.deepEqual(result.missingTransactionIds, []);
  assert.deepEqual(result.missingPaymentIds, []);
});

test('fails closed while a webhook operation is not visible in Tochka_API', () => {
  const result = evaluateTochkaOperationAck({
    rows: [['tx-1', 'pay-1']],
    transactionIds: ['tx-1', 'tx-missing'],
    paymentIds: ['pay-1']
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'operation_not_visible_yet');
  assert.deepEqual(result.missingTransactionIds, ['tx-missing']);
});

test('fails closed when no operation identifier was supplied', () => {
  const result = evaluateTochkaOperationAck({ rows: [['tx-1', 'pay-1']] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'identifiers_missing');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTochkaOperationAck,
  normalizeExpectedOperationIdentifiers
} from '../lib/tochka-operation-ack.js';

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

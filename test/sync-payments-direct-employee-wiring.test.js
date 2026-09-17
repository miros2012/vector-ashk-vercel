import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/sync-payments.js', import.meta.url), 'utf8');

test('payment sync uses direct PaymentRecordDebitList employee source with strict reconciliation', () => {
  assert.match(source, /createAshkPaymentEmployeeSource/);
  assert.match(source, /reconcilePaymentEmployees/);
  assert.match(source, /paymentEmployeeSource\.fetchPeriod/);
  assert.match(source, /paymentEmployeeReconciliation\.items/);
});

test('canonical PaymentEmployeeName is not produced by cashbox timestamp and amount reconstruction', () => {
  assert.doesNotMatch(source, /const comparisonAttribution = attributePaymentsToCashboxOperations\(rawItems, operations\)/);
  assert.doesNotMatch(source, /const items = saleAttribution\.items;/);
});

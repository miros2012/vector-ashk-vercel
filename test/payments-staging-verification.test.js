import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentMetrics, paymentMetricsMatch } from '../lib/payments-staging-verification.js';

test('payment staging verification matches exact row count, debit total and date bounds', () => {
  const expected = paymentMetrics([
    [1,'2026-09-01 10:00:00',101,1,1,'Курс',50000,50000],
    [2,'2026-09-02 11:00:00',102,2,1,'Курс',40000,10000]
  ]);
  const actual = paymentMetrics([
    [1,'2026-09-01 10:00:00',101,1,1,'Курс',50000,50000],
    [2,'2026-09-02 11:00:00',102,2,1,'Курс',40000,10000]
  ]);
  assert.equal(paymentMetricsMatch(actual, expected), true);
  assert.deepEqual(expected, {
    rows: 2,
    debitTotal: 60000,
    minPayDate: '2026-09-01 10:00:00',
    maxPayDate: '2026-09-02 11:00:00'
  });
});

test('payment staging verification rejects silent row or amount loss', () => {
  const expected = paymentMetrics([
    [1,'2026-09-01 10:00:00',101,1,1,'Курс',50000,50000],
    [2,'2026-09-02 11:00:00',102,2,1,'Курс',40000,10000]
  ]);
  assert.equal(paymentMetricsMatch(paymentMetrics([
    [1,'2026-09-01 10:00:00',101,1,1,'Курс',50000,49999]
  ]), expected), false);
});

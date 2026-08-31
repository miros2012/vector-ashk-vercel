import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecisionCatalog } from '../lib/decision-rule-engine.js';

const now = new Date('2026-08-31T17:00:00.000Z');

const snapshot = {
  asOfDate: '2026-08-31',
  cash: { gapAmount: 0, gapDate: null },
  obligations: {
    estimatedAdjustments: { count: 2, amount: 857000, objectIds: ['OBJ-1'] },
    unconfirmed: { count: 1, amount: null, objectIds: ['OBJ-2'] },
    criticalPayments: [{ id: 'PAY-1', dueDate: '2026-09-03', amount: 100000 }]
  }
};

test('catalog engine evaluates enabled rules and preserves disabled rules as inactive', () => {
  const catalog = [
    { ruleId: 'R1', evaluatorKey: 'estimated_obligation_adjustments', enabled: true, version: 1 },
    { ruleId: 'R2', evaluatorKey: 'unconfirmed_obligations', enabled: false, version: 3 },
    { ruleId: 'R3', evaluatorKey: 'critical_payment_due_3d', enabled: true, version: 2 }
  ];

  const result = evaluateDecisionCatalog(catalog, snapshot, now);

  assert.equal(result.length, 3);
  assert.equal(result[0].ruleId, 'R1');
  assert.equal(result[0].active, true);
  assert.equal(result[0].amount, 857000);
  assert.equal(result[1].ruleId, 'R2');
  assert.equal(result[1].enabled, false);
  assert.equal(result[1].active, false);
  assert.equal(result[1].version, 3);
  assert.equal(result[2].active, true);
  assert.equal(result[2].dueDate, '2026-09-03');
});

test('catalog engine derives an SLA deadline when evaluator has no intrinsic due date', () => {
  const result = evaluateDecisionCatalog([
    { ruleId: 'R-SLA', evaluatorKey: 'estimated_obligation_adjustments', enabled: true, version: 1, slaDays: 1 }
  ], snapshot, now);

  assert.equal(result[0].active, true);
  assert.equal(result[0].dueDate, '2026-09-01');
});

test('catalog engine keeps intrinsic evaluator due date instead of replacing it with SLA', () => {
  const result = evaluateDecisionCatalog([
    { ruleId: 'R-DUE', evaluatorKey: 'critical_payment_due_3d', enabled: true, version: 1, slaDays: 0 }
  ], snapshot, now);

  assert.equal(result[0].dueDate, '2026-09-03');
});

test('catalog engine rejects duplicate rule ids', () => {
  assert.throws(
    () => evaluateDecisionCatalog([
      { ruleId: 'DUP', evaluatorKey: 'cash_gap_30d', enabled: true },
      { ruleId: 'DUP', evaluatorKey: 'critical_payment_due_3d', enabled: true }
    ], snapshot, now),
    /duplicate ruleId/
  );
});

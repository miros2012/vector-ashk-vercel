import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecisionRule } from '../lib/decision-rule-evaluators.js';

const now = new Date('2026-08-31T17:00:00.000Z');

function snapshot(overrides = {}) {
  return {
    cash: { gapAmount: 0, gapDate: null },
    obligations: {
      estimatedAdjustments: { count: 0, amount: 0, objectIds: [] },
      unconfirmed: { count: 0, amount: 0, objectIds: [] },
      criticalPayments: []
    },
    ...overrides
  };
}

test('cash_gap_30d activates only for positive projected deficit', () => {
  const active = evaluateDecisionRule('cash_gap_30d', snapshot({
    cash: { gapAmount: 494805.62, gapDate: '2026-09-06' }
  }), now);
  assert.equal(active.active, true);
  assert.equal(active.amount, 494805.62);
  assert.equal(active.dueDate, '2026-09-06');

  const inactive = evaluateDecisionRule('cash_gap_30d', snapshot(), now);
  assert.equal(inactive.active, false);
  assert.equal(inactive.amount, 0);
});

test('estimated_obligation_adjustments returns amount and linked objects', () => {
  const result = evaluateDecisionRule('estimated_obligation_adjustments', snapshot({
    obligations: {
      estimatedAdjustments: { count: 2, amount: 857000, objectIds: ['MASTERS-2026-08'] },
      unconfirmed: { count: 0, amount: 0, objectIds: [] },
      criticalPayments: []
    }
  }), now);
  assert.equal(result.active, true);
  assert.equal(result.amount, 857000);
  assert.deepEqual(result.linkedObjects, ['MASTERS-2026-08']);
  assert.equal(result.facts.count, 2);
});

test('unconfirmed_obligations exposes count and linked objects without inventing amount', () => {
  const result = evaluateDecisionRule('unconfirmed_obligations', snapshot({
    obligations: {
      estimatedAdjustments: { count: 0, amount: 0, objectIds: [] },
      unconfirmed: { count: 1, amount: null, objectIds: ['TAX-RESERVE'] },
      criticalPayments: []
    }
  }), now);
  assert.equal(result.active, true);
  assert.equal(result.amount, null);
  assert.deepEqual(result.linkedObjects, ['TAX-RESERVE']);
  assert.equal(result.facts.count, 1);
});

test('critical_payment_due_3d selects earliest date and sums critical payments on it', () => {
  const result = evaluateDecisionRule('critical_payment_due_3d', snapshot({
    obligations: {
      estimatedAdjustments: { count: 0, amount: 0, objectIds: [] },
      unconfirmed: { count: 0, amount: 0, objectIds: [] },
      criticalPayments: [
        { id: 'ROYALTY', dueDate: '2026-09-03', amount: 1179607.47 },
        { id: 'SECOND', dueDate: '2026-09-03', amount: 100000 },
        { id: 'LATER', dueDate: '2026-09-06', amount: 500000 }
      ]
    }
  }), now);
  assert.equal(result.active, true);
  assert.equal(result.dueDate, '2026-09-03');
  assert.equal(result.amount, 1279607.47);
  assert.deepEqual(result.linkedObjects, ['ROYALTY', 'SECOND']);
});

test('unknown evaluator key fails explicitly', () => {
  assert.throws(
    () => evaluateDecisionRule('unknown_rule', snapshot(), now),
    /unsupported evaluator/
  );
});

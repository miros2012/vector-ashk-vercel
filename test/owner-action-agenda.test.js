import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerActionAgenda } from '../lib/owner-action-agenda.js';

const AS_OF = '2026-09-06T10:00:00.000Z';

function candidate(overrides = {}) {
  return {
    id: 'action-1',
    category: 'active_decision',
    priority: 'medium',
    deadline: '2026-09-07T10:00:00.000Z',
    amount: 100,
    responsible: 'owner',
    action: 'Review the supplied decision',
    blocking: false,
    financialExecution: false,
    ...overrides
  };
}

function build(candidates, overrides = {}) {
  return buildOwnerActionAgenda({
    asOf: AS_OF,
    dataHealthStatus: 'OK',
    candidates,
    ...overrides
  });
}

test('returns at most three unique actions in deterministic priority order', () => {
  const result = build([
    candidate({ id: 'low', priority: 'low', amount: 900 }),
    candidate({ id: 'critical', priority: 'critical', amount: 10 }),
    candidate({ id: 'high', priority: 'high', amount: 20 }),
    candidate({ id: 'medium', priority: 'medium', amount: 30 }),
    candidate({ id: 'critical', priority: 'critical', amount: 10 })
  ]);

  assert.deepEqual(result.actions.map((item) => item.id), ['critical', 'high', 'medium']);
  assert.equal(result.totalCandidates, 4);
  assert.equal(result.selectedCount, 3);
});

test('orders blockers before priority and marks overdue deadlines', () => {
  const result = build([
    candidate({ id: 'critical', priority: 'critical', amount: 1 }),
    candidate({
      id: 'health',
      category: 'data_health',
      priority: 'low',
      deadline: '2026-09-05T10:00:00.000Z',
      amount: 0,
      blocking: true,
      action: 'Restore supplied data health blocker'
    })
  ]);

  assert.deepEqual(result.actions.map((item) => item.id), ['health', 'critical']);
  assert.equal(result.actions[0].overdue, true);
  assert.equal(result.actions[1].overdue, false);
});

test('uses overdue status, amount, deadline and stable id as deterministic tie breakers', () => {
  const result = build([
    candidate({ id: 'z', priority: 'high', deadline: '2026-09-05T12:00:00.000Z', amount: 100 }),
    candidate({ id: 'amount-high', priority: 'high', deadline: '2026-09-07T12:00:00.000Z', amount: 500 }),
    candidate({ id: 'deadline-early', priority: 'high', deadline: '2026-09-07T11:00:00.000Z', amount: 200 }),
    candidate({ id: 'b', priority: 'high', deadline: '2026-09-07T12:00:00.000Z', amount: 200 }),
    candidate({ id: 'a', priority: 'high', deadline: '2026-09-07T12:00:00.000Z', amount: 200 })
  ]);

  assert.deepEqual(result.actions.map((item) => item.id), ['z', 'amount-high', 'deadline-early']);

  const tied = build([
    candidate({ id: 'b', priority: 'high', deadline: '2026-09-07T12:00:00.000Z', amount: 200 }),
    candidate({ id: 'a', priority: 'high', deadline: '2026-09-07T12:00:00.000Z', amount: 200 })
  ]);
  assert.deepEqual(tied.actions.map((item) => item.id), ['a', 'b']);
});

test('deduplicates equivalent ids and rejects conflicting duplicate facts', () => {
  const duplicate = candidate({ id: 'same', amount: 42 });
  const result = build([duplicate, { ...duplicate }]);
  assert.equal(result.totalCandidates, 1);

  assert.throws(() => build([
    duplicate,
    { ...duplicate, amount: 43 }
  ]), /conflicting duplicate candidate id: same/i);

  assert.throws(() => build([
    duplicate,
    { ...duplicate, action: 'A different supplied action' }
  ]), /conflicting duplicate candidate id: same/i);
});

test('blocks financial execution actions when Data Health is blocked without inventing replacements', () => {
  const suppliedAction = 'Pay the supplied critical obligation';
  const result = build([
    candidate({
      id: 'health',
      category: 'data_health',
      priority: 'critical',
      amount: 0,
      blocking: true,
      action: 'Resolve the supplied data health blocker'
    }),
    candidate({
      id: 'payment',
      category: 'critical_obligation',
      priority: 'critical',
      amount: 1000,
      action: suppliedAction,
      financialExecution: true
    }),
    candidate({
      id: 'verify',
      category: 'decision_effect_verification',
      priority: 'high',
      amount: 100,
      action: 'Verify supplied evidence',
      financialExecution: false
    })
  ], { dataHealthStatus: 'BLOCKED' });

  const payment = result.actions.find((item) => item.id === 'payment');
  const health = result.actions.find((item) => item.id === 'health');
  const verify = result.actions.find((item) => item.id === 'verify');
  assert.equal(payment.executable, false);
  assert.deepEqual(payment.nonExecutableReasons, ['DATA_HEALTH_BLOCKED']);
  assert.equal(payment.action, suppliedAction);
  assert.equal(health.executable, true);
  assert.equal(verify.executable, true);
  assert.equal(result.blockedFinancialActions, 1);
});

test('supports every declared source category', () => {
  const categories = [
    'liquidity',
    'critical_obligation',
    'decision_effect_verification',
    'active_decision',
    'data_health',
    'sales_collection_deficit'
  ];
  for (const category of categories) {
    const result = build([candidate({ id: category, category })]);
    assert.equal(result.actions[0].category, category);
  }
});

test('fails closed on unsupported status, category, priority, malformed deadlines and missing text', () => {
  assert.throws(() => build([candidate()], { dataHealthStatus: 'UNKNOWN' }), /dataHealthStatus/i);
  assert.throws(() => build([candidate({ category: 'other' })]), /category/i);
  assert.throws(() => build([candidate({ priority: 'urgent' })]), /priority/i);
  assert.throws(() => build([candidate({ deadline: 'tomorrow' })]), /deadline/i);
  assert.throws(() => build([candidate({ responsible: '   ' })]), /responsible/i);
  assert.throws(() => build([candidate({ action: '' })]), /action/i);
  assert.throws(() => build([candidate({ blocking: 'yes' })]), /blocking/i);
  assert.throws(() => build([candidate({ financialExecution: 1 })]), /financialExecution/i);
});

test('rejects non-finite and negative amounts while normalizing negative zero', () => {
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01]) {
    assert.throws(() => build([candidate({ amount })]), /amount/i);
  }
  const result = build([candidate({ amount: -0 })]);
  assert.equal(Object.is(result.actions[0].amount, -0), false);
  assert.equal(result.actions[0].amount, 0);
});

test('does not mutate frozen inputs and returns immutable detached output', () => {
  const frozenCandidate = Object.freeze(candidate({ id: 'immutable' }));
  const candidates = Object.freeze([frozenCandidate]);
  const input = Object.freeze({
    asOf: AS_OF,
    dataHealthStatus: 'OK',
    candidates
  });

  const result = buildOwnerActionAgenda(input);
  assert.equal(result.actions[0].id, 'immutable');
  assert.notEqual(result.actions[0], frozenCandidate);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.actions), true);
  assert.equal(Object.isFrozen(result.actions[0]), true);
  assert.throws(() => result.actions.push(candidate()), TypeError);
});

test('rejects invalid top-level input and invalid candidate identity', () => {
  assert.throws(() => buildOwnerActionAgenda(), /input/i);
  assert.throws(() => buildOwnerActionAgenda({ asOf: AS_OF, dataHealthStatus: 'OK', candidates: {} }), /candidates/i);
  assert.throws(() => build([candidate({ id: '' })]), /id/i);
  assert.throws(() => build([null]), /candidate/i);
  assert.throws(() => build([candidate()], { asOf: 'not-a-date' }), /asOf/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerActionAgenda } from '../lib/owner-action-agenda.js';

const AS_OF = '2026-09-06T12:00:00.000Z';

function candidate(overrides = {}) {
  return {
    id: 'action-1',
    category: 'LIQUIDITY',
    priority: 'HIGH',
    deadline: '2026-09-06T11:00:00.000Z',
    amount: 1000,
    responsible: 'Owner',
    action: 'Collect confirmed receivables',
    blocking: false,
    financialExecution: true,
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

test('selects at most three actions using the required deterministic precedence', () => {
  const result = build([
    candidate({
      id: 'sales-future',
      category: 'SALES_COLLECTION',
      priority: 'HIGH',
      deadline: '2026-09-07T12:00:00.000Z',
      amount: 9000,
      action: 'Close the sales collection deficit'
    }),
    candidate({
      id: 'critical-liquidity',
      priority: 'CRITICAL',
      amount: 1000,
      action: 'Close the cash gap'
    }),
    candidate({
      id: 'health-blocker',
      category: 'DATA_HEALTH',
      priority: 'HIGH',
      deadline: '2026-09-07T10:00:00.000Z',
      amount: 0,
      action: 'Resolve the Data Health blocker',
      blocking: true,
      financialExecution: false
    }),
    candidate({
      id: 'overdue-obligation',
      category: 'CRITICAL_OBLIGATION',
      priority: 'HIGH',
      amount: 5000,
      action: 'Confirm the critical obligation'
    })
  ]);

  assert.equal(result.actions.length, 3);
  assert.deepEqual(result.actions.map(item => item.id), [
    'health-blocker',
    'critical-liquidity',
    'overdue-obligation'
  ]);
  assert.deepEqual(result.actions.map(item => item.rank), [1, 2, 3]);
  assert.equal(result.actions[1].overdue, true);
});

test('orders ties by overdue status, amount, deadline and stable id', () => {
  const result = build([
    candidate({ id: 'z', amount: 5000, deadline: '2026-09-06T11:00:00.000Z' }),
    candidate({ id: 'c', amount: 7000, deadline: '2026-09-06T11:30:00.000Z' }),
    candidate({ id: 'b', amount: 7000, deadline: '2026-09-06T10:00:00.000Z' }),
    candidate({ id: 'a', amount: 7000, deadline: '2026-09-06T10:00:00.000Z' }),
    candidate({ id: 'future', amount: 999999, deadline: '2026-09-06T13:00:00.000Z' })
  ]);

  assert.deepEqual(result.actions.map(item => item.id), ['a', 'b', 'c']);
});

test('produces the same agenda regardless of candidate input order', () => {
  const candidates = [
    candidate({ id: 'b', amount: 20 }),
    candidate({ id: 'a', amount: 20 }),
    candidate({ id: 'c', amount: 10 })
  ];

  const forward = build(candidates);
  const reverse = build([...candidates].reverse());

  assert.deepEqual(forward, reverse);
});

test('deduplicates equivalent stable ids without mutating inputs', () => {
  const first = candidate({ id: 'same', responsible: ' Owner ', action: ' Act now ' });
  const duplicate = candidate({ id: ' same ', responsible: 'Owner', action: 'Act now' });
  const input = [first, duplicate];
  const before = structuredClone(input);

  const result = build(input);

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].id, 'same');
  assert.equal(result.actions[0].responsible, 'Owner');
  assert.equal(result.actions[0].action, 'Act now');
  assert.deepEqual(input, before);
});

test('fails closed when duplicate ids contain conflicting monetary or action facts', () => {
  assert.throws(() => build([
    candidate({ id: 'same', amount: 100 }),
    candidate({ id: 'same', amount: 101 })
  ]), /conflicting duplicate candidate: same/i);

  assert.throws(() => build([
    candidate({ id: 'same', action: 'Action A' }),
    candidate({ id: 'same', action: 'Action B' })
  ]), /conflicting duplicate candidate: same/i);
});

test('blocks only supplied financial execution actions when Data Health is blocked', () => {
  const result = build([
    candidate({ id: 'financial', financialExecution: true }),
    candidate({
      id: 'health',
      category: 'DATA_HEALTH',
      action: 'Repair source freshness',
      amount: 0,
      blocking: true,
      financialExecution: false
    }),
    candidate({
      id: 'verify',
      category: 'DECISION_VERIFICATION',
      action: 'Verify completed decision evidence',
      financialExecution: false
    })
  ], { dataHealthStatus: 'BLOCKED' });

  assert.equal(result.blocked, true);
  const byId = Object.fromEntries(result.actions.map(item => [item.id, item]));
  assert.equal(byId.financial.executable, false);
  assert.equal(byId.financial.nonExecutableReason, 'DATA_HEALTH_BLOCKED');
  assert.equal(byId.health.executable, true);
  assert.equal(byId.health.nonExecutableReason, null);
  assert.equal(byId.verify.executable, true);
});

test('keeps financial actions executable when Data Health is OK', () => {
  const result = build([candidate()]);
  assert.equal(result.blocked, false);
  assert.equal(result.actions[0].executable, true);
  assert.equal(result.actions[0].nonExecutableReason, null);
});

test('normalizes negative zero amount to zero and treats exact deadline as not overdue', () => {
  const result = build([
    candidate({ amount: -0, deadline: AS_OF })
  ]);

  assert.equal(Object.is(result.actions[0].amount, -0), false);
  assert.equal(result.actions[0].amount, 0);
  assert.equal(result.actions[0].overdue, false);
});

test('returns a deeply immutable result', () => {
  const result = build([candidate()]);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.actions), true);
  assert.equal(Object.isFrozen(result.actions[0]), true);
  assert.throws(() => { result.actions[0].amount = 2; }, TypeError);
  assert.throws(() => { result.actions.push(candidate()); }, TypeError);
});

test('fails closed for invalid top-level inputs', () => {
  assert.throws(() => buildOwnerActionAgenda(), /input is required/i);
  assert.throws(() => build([], { asOf: 'not-a-date' }), /asOf is invalid/i);
  assert.throws(() => build([], { dataHealthStatus: 'WARNING' }), /dataHealthStatus is unsupported/i);
  assert.throws(() => buildOwnerActionAgenda({ asOf: AS_OF, dataHealthStatus: 'OK', candidates: {} }), /candidates must be an array/i);
});

test('fails closed for unsupported, malformed or missing candidate facts', () => {
  const invalidCases = [
    [candidate({ id: ' ' }), /candidate id is required/i],
    [candidate({ category: 'OTHER' }), /category is unsupported/i],
    [candidate({ priority: 'URGENT' }), /priority is unsupported/i],
    [candidate({ priority: 'toString' }), /priority is unsupported/i],
    [candidate({ deadline: '2026-09-06' }), /deadline is invalid/i],
    [candidate({ deadline: '2026-02-30T10:00:00.000Z' }), /deadline is invalid/i],
    [candidate({ amount: Number.NaN }), /amount must be finite/i],
    [candidate({ amount: Number.POSITIVE_INFINITY }), /amount must be finite/i],
    [candidate({ amount: -1 }), /amount must be non-negative/i],
    [candidate({ responsible: ' ' }), /responsible is required/i],
    [candidate({ action: ' ' }), /action is required/i],
    [candidate({ blocking: 'yes' }), /blocking must be boolean/i],
    [candidate({ financialExecution: 1 }), /financialExecution must be boolean/i]
  ];

  for (const [value, expected] of invalidCases) {
    assert.throws(() => build([value]), expected);
  }
});

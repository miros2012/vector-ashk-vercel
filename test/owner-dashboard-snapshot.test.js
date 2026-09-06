import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOwnerDashboardSnapshot,
  verifyOwnerDashboardSnapshot
} from '../lib/owner-dashboard-snapshot.js';

function input(overrides = {}) {
  return {
    snapshotId: ' snapshot-2026-09-06 ',
    businessDate: '2026-09-06',
    generatedAt: '2026-09-06T12:34:56+05:00',
    modelVersion: ' owner-dashboard-v1 ',
    availableCash: 150000,
    cashGap: 0,
    safeWithdrawal: 50000,
    salesPlanToDate: 1000000,
    salesFact: 900000,
    receivables: 300000,
    openObligations: 700000,
    unconfirmedObligations: 50000,
    drivingFundReserve: 400000,
    drivingFundDeficit: 100000,
    dataHealth: {
      status: 'WARNING',
      reasons: [' source-delay:hours ', 'cash-review', 'cash-review']
    },
    actions: [
      {
        id: 'collect-receivables',
        priority: 'high',
        responsible: 'Senior manager',
        deadline: '2026-09-07T12:00:00+05:00',
        riskEffectAmount: 300000
      },
      {
        id: 'protect-driving-fund',
        priority: 'critical',
        responsible: 'Owner',
        deadline: '2026-09-06T18:00:00+05:00',
        riskEffectAmount: 100000
      },
      {
        id: 'review-sales-gap',
        priority: 'medium',
        responsible: 'Head of sales',
        deadline: '2026-09-08T09:00:00+05:00',
        riskEffectAmount: 100000
      }
    ],
    ...overrides
  };
}

test('normalizes the daily snapshot and fingerprints normalized business fields', () => {
  const result = createOwnerDashboardSnapshot(input());

  assert.equal(result.snapshotId, 'snapshot-2026-09-06');
  assert.equal(result.businessDate, '2026-09-06');
  assert.equal(result.generatedAt, '2026-09-06T07:34:56.000Z');
  assert.equal(result.modelVersion, 'owner-dashboard-v1');
  assert.deepEqual(result.dataHealth, {
    status: 'WARNING',
    reasons: ['cash-review', 'source-delay:hours']
  });
  assert.deepEqual(result.actions.map(action => action.id), [
    'protect-driving-fund',
    'collect-receivables',
    'review-sales-gap'
  ]);
  assert.equal(result.actions[0].deadline, '2026-09-06T13:00:00.000Z');
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(verifyOwnerDashboardSnapshot(result), true);
});

test('is order independent for actions and Data Health reasons', () => {
  const firstInput = input();
  const secondInput = input({
    generatedAt: '2026-09-06T07:34:56Z',
    dataHealth: {
      status: 'WARNING',
      reasons: ['cash-review', 'source-delay:hours']
    },
    actions: [...firstInput.actions].reverse()
  });

  const first = createOwnerDashboardSnapshot(firstInput);
  const second = createOwnerDashboardSnapshot(secondInput);

  assert.deepEqual(first, second);
  assert.equal(first.fingerprint, second.fingerprint);
});

test('sorts actions by priority, deadline, larger effect, then stable id', () => {
  const result = createOwnerDashboardSnapshot(input({
    actions: [
      {
        id: 'b',
        priority: 'high',
        responsible: 'Owner',
        deadline: '2026-09-08T10:00:00Z',
        riskEffectAmount: 500
      },
      {
        id: 'c',
        priority: 'critical',
        responsible: 'Owner',
        deadline: '2026-09-09T10:00:00Z',
        riskEffectAmount: 1
      },
      {
        id: 'a',
        priority: 'high',
        responsible: 'Owner',
        deadline: '2026-09-08T10:00:00Z',
        riskEffectAmount: 700
      }
    ]
  }));

  assert.deepEqual(result.actions.map(action => action.id), ['c', 'a', 'b']);
});

test('allows an empty owner action set without inventing actions', () => {
  const result = createOwnerDashboardSnapshot(input({
    dataHealth: { status: 'OK', reasons: [] },
    actions: []
  }));

  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.dataHealth.reasons, []);
});

test('rejects more than three actions and duplicate action ids', () => {
  const baseAction = {
    priority: 'low',
    responsible: 'Owner',
    deadline: '2026-09-10T10:00:00Z',
    riskEffectAmount: 1
  };

  assert.throws(() => createOwnerDashboardSnapshot(input({
    actions: ['a', 'b', 'c', 'd'].map(id => ({ ...baseAction, id }))
  })), /at most three actions/i);

  assert.throws(() => createOwnerDashboardSnapshot(input({
    actions: [
      { ...baseAction, id: 'same' },
      { ...baseAction, id: 'same' }
    ]
  })), /duplicate action id: same/i);
});

test('fails closed for missing ids and versions, malformed dates and timestamps', () => {
  assert.throws(() => createOwnerDashboardSnapshot(input({ snapshotId: ' ' })), /snapshotId.*required/i);
  assert.throws(() => createOwnerDashboardSnapshot(input({ modelVersion: '' })), /modelVersion.*required/i);
  assert.throws(() => createOwnerDashboardSnapshot(input({ businessDate: '2026-02-30' })), /businessDate.*date/i);
  assert.throws(() => createOwnerDashboardSnapshot(input({ generatedAt: 'not-a-timestamp' })), /generatedAt.*timestamp/i);

  const source = input();
  source.actions[0] = { ...source.actions[0], deadline: '2026-09-31T10:00:00Z' };
  assert.throws(() => createOwnerDashboardSnapshot(source), /deadline.*timestamp/i);
});

test('fails closed for unsupported Data Health statuses and action priorities', () => {
  assert.throws(() => createOwnerDashboardSnapshot(input({
    dataHealth: { status: 'RISK', reasons: [] }
  })), /unsupported data health status: RISK/i);

  const source = input();
  source.actions[0] = { ...source.actions[0], priority: 'urgent' };
  assert.throws(() => createOwnerDashboardSnapshot(source), /unsupported action priority: urgent/i);
});

test('fails closed for non-finite and negative financial values', () => {
  for (const [field, value] of [
    ['availableCash', Number.NaN],
    ['cashGap', Number.POSITIVE_INFINITY],
    ['safeWithdrawal', -1],
    ['salesPlanToDate', -1],
    ['salesFact', Number.NaN],
    ['receivables', -1],
    ['openObligations', Number.POSITIVE_INFINITY],
    ['unconfirmedObligations', -1],
    ['drivingFundReserve', -1],
    ['drivingFundDeficit', Number.NaN]
  ]) {
    assert.throws(
      () => createOwnerDashboardSnapshot(input({ [field]: value })),
      new RegExp(`${field}.*(?:finite|non-negative)`, 'i'),
      field
    );
  }

  const source = input();
  source.actions[0] = { ...source.actions[0], riskEffectAmount: -1 };
  assert.throws(() => createOwnerDashboardSnapshot(source), /riskEffectAmount.*non-negative/i);
});

test('normalizes negative zero in all zero-safe money fields', () => {
  const money = {
    availableCash: -0,
    cashGap: -0,
    safeWithdrawal: -0,
    salesPlanToDate: -0,
    salesFact: -0,
    receivables: -0,
    openObligations: -0,
    unconfirmedObligations: -0,
    drivingFundReserve: -0,
    drivingFundDeficit: -0
  };
  const result = createOwnerDashboardSnapshot(input({ ...money, actions: [] }));

  for (const field of Object.keys(money)) {
    assert.equal(Object.is(result[field], -0), false, field);
  }
});

test('detects later business-field or fingerprint tampering', () => {
  const result = createOwnerDashboardSnapshot(input());

  const changedMoney = structuredClone(result);
  changedMoney.availableCash += 1;
  assert.throws(() => verifyOwnerDashboardSnapshot(changedMoney), /fingerprint mismatch/i);

  const changedFingerprint = structuredClone(result);
  changedFingerprint.fingerprint = '0'.repeat(64);
  assert.throws(() => verifyOwnerDashboardSnapshot(changedFingerprint), /fingerprint mismatch/i);
});

test('does not mutate inputs and returns a deeply immutable snapshot', () => {
  const source = input();
  const before = structuredClone(source);

  const result = createOwnerDashboardSnapshot(source);

  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.dataHealth), true);
  assert.equal(Object.isFrozen(result.dataHealth.reasons), true);
  assert.equal(Object.isFrozen(result.actions), true);
  assert.equal(Object.isFrozen(result.actions[0]), true);
  assert.throws(() => { result.availableCash = 0; }, TypeError);
  assert.throws(() => { result.actions[0].responsible = 'Changed'; }, TypeError);
});

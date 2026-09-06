import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSafeWithdrawal } from '../lib/safe-withdrawal-policy.js';

function input(overrides = {}) {
  return {
    availableCash: 1000,
    confirmedObligations: 100,
    unconfirmedObligationReserve: 50,
    requiredOperatingReserve: 200,
    drivingFundDeficit: 100,
    scenarioCaps: {
      conservative: 700,
      base: 800,
      target: 900
    },
    dataHealthStatus: 'OK',
    blockingReasons: [],
    policyMode: 'ALL',
    ...overrides
  };
}

test('limits withdrawal by cash left after every protected component', () => {
  const result = calculateSafeWithdrawal(input());

  assert.equal(result.safeWithdrawal, 550);
  assert.equal(result.liquidityRemaining, 450);
  assert.equal(result.uncommittedLiquidityRemaining, 0);
  assert.equal(result.protectionShortfall, 0);
  assert.deepEqual(result.limits.protectedComponents, {
    confirmedObligations: 100,
    unconfirmedObligationReserve: 50,
    requiredOperatingReserve: 200,
    drivingFundDeficit: 100
  });
  assert.equal(result.limits.protectedNeedsTotal, 450);
  assert.equal(result.limits.liquidityCapacity, 550);
  assert.deepEqual(result.bindingLimit, {
    id: 'LIQUIDITY_CAP',
    amount: 550
  });
});

test('each protected component independently reduces the maximum withdrawal', () => {
  const fields = [
    'confirmedObligations',
    'unconfirmedObligationReserve',
    'requiredOperatingReserve',
    'drivingFundDeficit'
  ];

  for (const field of fields) {
    const result = calculateSafeWithdrawal(input({
      confirmedObligations: 0,
      unconfirmedObligationReserve: 0,
      requiredOperatingReserve: 0,
      drivingFundDeficit: 0,
      [field]: 250,
      scenarioCaps: { conservative: 1000, base: 1000, target: 1000 }
    }));
    assert.equal(result.safeWithdrawal, 750, field);
    assert.equal(result.liquidityRemaining, 250, field);
  }
});

test('supported policy modes select only their mandatory scenario caps', () => {
  const cases = [
    ['CONSERVATIVE', { conservative: 120, base: 80, target: 60 }, 120, 'SCENARIO_CONSERVATIVE'],
    ['BASE', { conservative: 60, base: 130, target: 70 }, 130, 'SCENARIO_BASE'],
    ['TARGET', { conservative: 70, base: 60, target: 140 }, 140, 'SCENARIO_TARGET'],
    ['ALL', { conservative: 160, base: 150, target: 170 }, 150, 'SCENARIO_BASE']
  ];

  for (const [policyMode, scenarioCaps, expected, expectedBinding] of cases) {
    const result = calculateSafeWithdrawal(input({
      policyMode,
      scenarioCaps,
      confirmedObligations: 0,
      unconfirmedObligationReserve: 0,
      requiredOperatingReserve: 0,
      drivingFundDeficit: 0
    }));
    assert.equal(result.safeWithdrawal, expected, policyMode);
    assert.equal(result.bindingLimit.id, expectedBinding, policyMode);
  }
});

test('reports deterministic selected constraints and binding limit on exact ties', () => {
  const result = calculateSafeWithdrawal(input({
    availableCash: 600,
    confirmedObligations: 100,
    unconfirmedObligationReserve: 100,
    requiredOperatingReserve: 100,
    drivingFundDeficit: 100,
    scenarioCaps: { conservative: 200, base: 200, target: 300 },
    policyMode: 'ALL'
  }));

  assert.equal(result.safeWithdrawal, 200);
  assert.deepEqual(result.limits.requiredScenarioCaps, ['conservative', 'base', 'target']);
  assert.deepEqual(result.bindingLimit, { id: 'LIQUIDITY_CAP', amount: 200 });
  assert.deepEqual(result.explanation.constraintOrder, [
    'LIQUIDITY_CAP',
    'SCENARIO_CONSERVATIVE',
    'SCENARIO_BASE',
    'SCENARIO_TARGET'
  ]);
});

test('floors safe withdrawal at zero and exposes the protection shortfall', () => {
  const result = calculateSafeWithdrawal(input({
    availableCash: 100,
    confirmedObligations: 120,
    unconfirmedObligationReserve: 30,
    requiredOperatingReserve: 20,
    drivingFundDeficit: 10
  }));

  assert.equal(result.safeWithdrawal, 0);
  assert.equal(result.liquidityRemaining, 100);
  assert.equal(result.limits.liquidityCapacity, 0);
  assert.equal(result.protectionShortfall, 80);
  assert.deepEqual(result.bindingLimit, { id: 'LIQUIDITY_CAP', amount: 0 });
});

test('non-OK Data Health always forces zero and normalizes supplied reasons', () => {
  for (const status of ['DELAYED', 'ERROR', 'BLOCKED']) {
    const result = calculateSafeWithdrawal(input({
      dataHealthStatus: status,
      blockingReasons: ['  Tochka   stale ', 'DDS blocked']
    }));

    assert.equal(result.blocked, true, status);
    assert.equal(result.safeWithdrawal, 0, status);
    assert.equal(result.liquidityRemaining, 1000, status);
    assert.deepEqual(result.reasons, ['DDS blocked', 'Tochka stale'], status);
    assert.deepEqual(result.bindingLimit, { id: 'DATA_HEALTH', amount: 0 }, status);
  }
});

test('OK Data Health requires no blocking reasons and blocked health requires at least one', () => {
  assert.throws(() => calculateSafeWithdrawal(input({
    dataHealthStatus: 'OK',
    blockingReasons: ['unexpected']
  })), /OK Data Health cannot contain blocking reasons/i);

  assert.throws(() => calculateSafeWithdrawal(input({
    dataHealthStatus: 'ERROR',
    blockingReasons: []
  })), /non-OK Data Health requires blocking reasons/i);
});

test('duplicate normalized blocking reasons fail closed', () => {
  assert.throws(() => calculateSafeWithdrawal(input({
    dataHealthStatus: 'BLOCKED',
    blockingReasons: ['DDS   blocked', ' DDS blocked ']
  })), /duplicate blocking reason: DDS blocked/i);
});

test('normalizes negative zero values without mutating the input', () => {
  const source = input({
    confirmedObligations: -0,
    unconfirmedObligationReserve: -0,
    scenarioCaps: { conservative: -0, base: 800, target: 900 },
    policyMode: 'CONSERVATIVE'
  });
  const before = structuredClone(source);

  const result = calculateSafeWithdrawal(source);

  assert.equal(result.safeWithdrawal, 0);
  assert.equal(Object.is(result.limits.protectedComponents.confirmedObligations, -0), false);
  assert.equal(Object.is(result.limits.scenarioCaps.conservative, -0), false);
  assert.deepEqual(source, before);
});

test('requires every scenario cap even when one mode selects a single cap', () => {
  for (const missing of ['conservative', 'base', 'target']) {
    const scenarioCaps = { conservative: 1, base: 2, target: 3 };
    delete scenarioCaps[missing];
    assert.throws(() => calculateSafeWithdrawal(input({
      policyMode: 'BASE',
      scenarioCaps
    })), new RegExp(`scenarioCaps\\.${missing} must be finite`, 'i'));
  }
});

test('fails closed for unsupported modes and Data Health statuses', () => {
  assert.throws(() => calculateSafeWithdrawal(input({ policyMode: 'OPTIMISTIC' })), /policyMode is unsupported/i);
  assert.throws(() => calculateSafeWithdrawal(input({ dataHealthStatus: 'UNKNOWN' })), /dataHealthStatus is unsupported/i);
});

test('fails closed for malformed reasons and numeric values', () => {
  assert.throws(() => calculateSafeWithdrawal(input({ blockingReasons: {} })), /blockingReasons must be an array/i);
  assert.throws(() => calculateSafeWithdrawal(input({
    dataHealthStatus: 'ERROR',
    blockingReasons: ['   ']
  })), /blocking reason is required/i);

  const numericPaths = [
    ['availableCash', Number.NaN],
    ['confirmedObligations', Number.POSITIVE_INFINITY],
    ['unconfirmedObligationReserve', -1],
    ['requiredOperatingReserve', '100'],
    ['drivingFundDeficit', null]
  ];
  for (const [field, value] of numericPaths) {
    assert.throws(() => calculateSafeWithdrawal(input({ [field]: value })), new RegExp(field, 'i'));
  }

  assert.throws(() => calculateSafeWithdrawal(input({
    scenarioCaps: { conservative: 1, base: -1, target: 3 }
  })), /scenarioCaps\.base must be non-negative/i);
});

test('returns a deeply immutable recommendation and deterministic explanation facts', () => {
  const result = calculateSafeWithdrawal(input());

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reasons), true);
  assert.equal(Object.isFrozen(result.limits), true);
  assert.equal(Object.isFrozen(result.limits.scenarioCaps), true);
  assert.equal(Object.isFrozen(result.explanation), true);
  assert.deepEqual(result.explanation, {
    policyMode: 'ALL',
    requiredScenarioCaps: ['conservative', 'base', 'target'],
    constraintOrder: [
      'LIQUIDITY_CAP',
      'SCENARIO_CONSERVATIVE',
      'SCENARIO_BASE',
      'SCENARIO_TARGET'
    ],
    calculation: 'MIN_OF_MANDATORY_LIMITS'
  });
  assert.throws(() => { result.safeWithdrawal = 1; }, TypeError);
  assert.throws(() => { result.limits.scenarioCaps.base = 1; }, TypeError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfiguredCashScenarioPolicy } from '../lib/configured-cash-scenario-policy.js';

function configuration(overrides = {}) {
  return {
    configurationId: 'owner-cash-policy',
    version: 'v1',
    effectiveFrom: '2026-09-01T00:00:00Z',
    requiredSafetyReserve: 100,
    scenarios: [
      { name: 'target', inflowMultiplier: 1.5, outflowMultiplier: 0.5 },
      { name: 'conservative', inflowMultiplier: 0.5, outflowMultiplier: 1.5 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 }
    ],
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    configurations: [configuration()],
    asOf: '2026-09-06T12:00:00Z',
    openingCash: 1000,
    flows: [
      { date: '2026-09-07', inflow: 100, outflow: 200 }
    ],
    availableCash: 1000,
    confirmedObligations: 0,
    unconfirmedObligationReserve: 0,
    requiredOperatingReserve: 0,
    drivingFundDeficit: 0,
    dataHealthStatus: 'OK',
    blockingReasons: [],
    policyMode: 'ALL',
    ...overrides
  };
}

test('selects the effective config, builds three scenarios and uses their withdrawals as caps', () => {
  const result = buildConfiguredCashScenarioPolicy(input());

  assert.equal(result.configuration.version, 'v1');
  assert.equal(result.forecast.safetyReserve, 100);
  assert.deepEqual(result.forecast.scenarios.map(item => ({
    name: item.name,
    safeOwnerWithdrawal: item.safeOwnerWithdrawal
  })), [
    { name: 'conservative', safeOwnerWithdrawal: 650 },
    { name: 'base', safeOwnerWithdrawal: 800 },
    { name: 'target', safeOwnerWithdrawal: 950 }
  ]);
  assert.deepEqual(result.scenarioCaps, {
    conservative: 650,
    base: 800,
    target: 950
  });
  assert.equal(result.withdrawal.safeWithdrawal, 650);
  assert.deepEqual(result.withdrawal.bindingLimit, {
    id: 'SCENARIO_CONSERVATIVE',
    amount: 650
  });
});

test('keeps liquidity protections independent from scenario safety reserve', () => {
  const result = buildConfiguredCashScenarioPolicy(input({
    confirmedObligations: 200,
    unconfirmedObligationReserve: 100,
    requiredOperatingReserve: 200,
    drivingFundDeficit: 100
  }));

  assert.equal(result.forecast.safetyReserve, 100);
  assert.equal(result.withdrawal.limits.protectedNeedsTotal, 600);
  assert.equal(result.withdrawal.limits.liquidityCapacity, 400);
  assert.equal(result.withdrawal.safeWithdrawal, 400);
  assert.deepEqual(result.withdrawal.bindingLimit, {
    id: 'LIQUIDITY_CAP',
    amount: 400
  });
});

test('selects the latest effective version before calculating the forecast', () => {
  const result = buildConfiguredCashScenarioPolicy(input({
    configurations: [
      configuration({ version: 'v1', effectiveFrom: '2026-09-01T00:00:00Z' }),
      configuration({
        version: 'v2',
        effectiveFrom: '2026-09-05T00:00:00Z',
        requiredSafetyReserve: 200
      }),
      configuration({ version: 'v3', effectiveFrom: '2026-09-10T00:00:00Z' })
    ]
  }));

  assert.equal(result.configuration.version, 'v2');
  assert.equal(result.forecast.safetyReserve, 200);
  assert.deepEqual(result.scenarioCaps, {
    conservative: 550,
    base: 700,
    target: 850
  });
});

test('Data Health remains fail-closed after scenario calculation', () => {
  const result = buildConfiguredCashScenarioPolicy(input({
    dataHealthStatus: 'BLOCKED',
    blockingReasons: ['DDS incomplete']
  }));

  assert.equal(result.forecast.scenarios[0].safeOwnerWithdrawal, 650);
  assert.equal(result.withdrawal.blocked, true);
  assert.equal(result.withdrawal.safeWithdrawal, 0);
  assert.deepEqual(result.withdrawal.bindingLimit, {
    id: 'DATA_HEALTH',
    amount: 0
  });
});

test('passes through explicit policy mode without inventing another scenario rule', () => {
  const result = buildConfiguredCashScenarioPolicy(input({ policyMode: 'BASE' }));

  assert.equal(result.withdrawal.policyMode, 'BASE');
  assert.equal(result.withdrawal.safeWithdrawal, 800);
  assert.deepEqual(result.withdrawal.limits.requiredScenarioCaps, ['base']);
});

test('rejects tampered stored configurations through the existing fingerprint verifier', async () => {
  const { normalizeCashScenarioConfig } = await import('../lib/cash-scenario-config.js');
  const stored = structuredClone(normalizeCashScenarioConfig(configuration()));
  stored.requiredSafetyReserve = 101;

  assert.throws(
    () => buildConfiguredCashScenarioPolicy(input({ configurations: [stored] })),
    /fingerprint mismatch/i
  );
});

test('does not mutate caller inputs and returns a deeply immutable result', () => {
  const source = input();
  const before = structuredClone(source);
  const result = buildConfiguredCashScenarioPolicy(source);

  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.configuration), true);
  assert.equal(Object.isFrozen(result.forecast), true);
  assert.equal(Object.isFrozen(result.scenarioCaps), true);
  assert.equal(Object.isFrozen(result.withdrawal), true);
  assert.throws(() => { result.scenarioCaps.base = 1; }, TypeError);
  assert.throws(() => { result.forecast.scenarios.push({}); }, TypeError);
});

test('delegates invalid explicit financial inputs to the existing fail-closed cores', () => {
  assert.throws(
    () => buildConfiguredCashScenarioPolicy(input({ availableCash: Number.NaN })),
    /availableCash must be finite/i
  );
  assert.throws(
    () => buildConfiguredCashScenarioPolicy(input({ openingCash: -1 })),
    /openingCash must be non-negative/i
  );
  assert.throws(
    () => buildConfiguredCashScenarioPolicy(input({ policyMode: 'OPTIMISTIC' })),
    /policyMode is unsupported/i
  );
});

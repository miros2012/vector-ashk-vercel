import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashScenarioForecast } from '../lib/cash-scenario-forecast.js';

function input(overrides = {}) {
  return {
    openingCash: 1000,
    flows: [
      { date: '2026-09-07', inflow: 200, outflow: 100 },
      { date: '2026-09-08', inflow: 100, outflow: 50 }
    ],
    scenarios: [
      { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1.2, outflowMultiplier: 0.9 }
    ],
    safetyReserve: 200,
    ...overrides
  };
}

test('builds deterministic daily balances and zero-safe positive metrics', () => {
  const result = buildCashScenarioForecast(input({
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
    ]
  }));

  assert.deepEqual(result.horizon, ['2026-09-07', '2026-09-08']);
  assert.deepEqual(result.scenarios.map(item => item.name), ['conservative', 'base', 'target']);

  const base = result.scenarios[1];
  assert.deepEqual(base.daily, [
    { date: '2026-09-07', inflow: 200, outflow: 100, closingBalance: 1100 },
    { date: '2026-09-08', inflow: 100, outflow: 50, closingBalance: 1150 }
  ]);
  assert.equal(base.minimumBalance, 1100);
  assert.equal(base.minimumBalanceDate, '2026-09-07');
  assert.equal(base.cashGap, 0);
  assert.equal(base.requiredCollection, 0);
  assert.equal(base.safeOwnerWithdrawal, 900);
});

test('reports a cash gap and required collection when balance falls below zero', () => {
  const result = buildCashScenarioForecast(input({
    openingCash: 100,
    flows: [{ date: '2026-09-07', inflow: 0, outflow: 250 }],
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
    ],
    safetyReserve: 0
  }));

  const base = result.scenarios[1];
  assert.equal(base.minimumBalance, -150);
  assert.equal(base.minimumBalanceDate, '2026-09-07');
  assert.equal(base.cashGap, 150);
  assert.equal(base.requiredCollection, 150);
  assert.equal(base.safeOwnerWithdrawal, 0);
});

test('preserves the supplied safety reserve in collection and withdrawal calculations', () => {
  const result = buildCashScenarioForecast(input({
    openingCash: 500,
    flows: [{ date: '2026-09-07', inflow: 0, outflow: 200 }],
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
    ],
    safetyReserve: 400
  }));

  const base = result.scenarios[1];
  assert.equal(base.minimumBalance, 300);
  assert.equal(base.cashGap, 0);
  assert.equal(base.requiredCollection, 100);
  assert.equal(base.safeOwnerWithdrawal, 0);
});

test('applies caller-supplied scenario multipliers without inventing coefficients', () => {
  const result = buildCashScenarioForecast(input({
    openingCash: 1000,
    flows: [{ date: '2026-09-07', inflow: 200, outflow: 100 }],
    scenarios: [
      { name: 'conservative', inflowMultiplier: 0.5, outflowMultiplier: 2 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1.5, outflowMultiplier: 0.5 }
    ],
    safetyReserve: 0
  }));

  assert.equal(result.scenarios[0].daily[0].closingBalance, 900);
  assert.equal(result.scenarios[1].daily[0].closingBalance, 1100);
  assert.equal(result.scenarios[2].daily[0].closingBalance, 1250);
});

test('is independent of input ordering and normalizes deterministic scenario order', () => {
  const first = buildCashScenarioForecast(input({
    flows: [
      { date: '2026-09-08', inflow: 100, outflow: 50 },
      { date: '2026-09-07', inflow: 200, outflow: 100 }
    ],
    scenarios: [
      { name: 'target', inflowMultiplier: 1.2, outflowMultiplier: 0.9 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'conservative', inflowMultiplier: 0.8, outflowMultiplier: 1.1 }
    ]
  }));
  const second = buildCashScenarioForecast(input());

  assert.deepEqual(first, second);
});

test('uses the earliest date for an exact minimum-balance tie', () => {
  const result = buildCashScenarioForecast(input({
    openingCash: 100,
    flows: [
      { date: '2026-09-07', inflow: 0, outflow: 50 },
      { date: '2026-09-08', inflow: 50, outflow: 50 }
    ],
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
    ],
    safetyReserve: 0
  }));

  assert.equal(result.scenarios[1].minimumBalance, 50);
  assert.equal(result.scenarios[1].minimumBalanceDate, '2026-09-07');
});

test('normalizes negative zero in inputs and calculations', () => {
  const result = buildCashScenarioForecast(input({
    openingCash: -0,
    flows: [{ date: '2026-09-07', inflow: -0, outflow: -0 }],
    scenarios: [
      { name: 'conservative', inflowMultiplier: -0, outflowMultiplier: -0 },
      { name: 'base', inflowMultiplier: -0, outflowMultiplier: -0 },
      { name: 'target', inflowMultiplier: -0, outflowMultiplier: -0 }
    ],
    safetyReserve: -0
  }));

  const base = result.scenarios[1];
  assert.equal(Object.is(result.openingCash, -0), false);
  assert.equal(Object.is(result.safetyReserve, -0), false);
  assert.equal(Object.is(base.daily[0].closingBalance, -0), false);
  assert.equal(Object.is(base.cashGap, -0), false);
  assert.equal(Object.is(base.requiredCollection, -0), false);
  assert.equal(Object.is(base.safeOwnerWithdrawal, -0), false);
});

test('rejects malformed and impossible business dates', () => {
  for (const date of ['2026-9-07', '2026-02-30', 'not-a-date']) {
    assert.throws(() => buildCashScenarioForecast(input({
      flows: [{ date, inflow: 1, outflow: 0 }]
    })), /date/i, date);
  }
});

test('rejects duplicate flow dates rather than merging them silently', () => {
  assert.throws(() => buildCashScenarioForecast(input({
    flows: [
      { date: '2026-09-07', inflow: 1, outflow: 0 },
      { date: '2026-09-07', inflow: 2, outflow: 0 }
    ]
  })), /duplicate flow date: 2026-09-07/i);
});

test('rejects duplicate scenario names and missing base scenario', () => {
  assert.throws(() => buildCashScenarioForecast(input({
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 }
    ]
  })), /duplicate scenario name: base/i);

  assert.throws(() => buildCashScenarioForecast(input({
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'stress', inflowMultiplier: 1, outflowMultiplier: 1 }
    ]
  })), /base scenario is required/i);
});

test('requires exactly the conservative, base, and target scenarios', () => {
  assert.throws(() => buildCashScenarioForecast(input({
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'optimistic', inflowMultiplier: 1, outflowMultiplier: 1 }
    ]
  })), /unsupported scenario name: optimistic/i);

  assert.throws(() => buildCashScenarioForecast(input({
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 }
    ]
  })), /exactly three scenarios are required/i);
});

test('rejects empty forecast horizons', () => {
  assert.throws(() => buildCashScenarioForecast(input({ flows: [] })), /flows must not be empty/i);
});

test('fails closed for non-finite or negative financial inputs', () => {
  const invalidTopLevel = [
    ['openingCash', Number.NaN],
    ['openingCash', Number.POSITIVE_INFINITY],
    ['safetyReserve', Number.NaN],
    ['safetyReserve', -1]
  ];
  for (const [field, value] of invalidTopLevel) {
    assert.throws(() => buildCashScenarioForecast(input({ [field]: value })), new RegExp(field, 'i'));
  }

  assert.throws(() => buildCashScenarioForecast(input({
    flows: [{ date: '2026-09-07', inflow: Number.POSITIVE_INFINITY, outflow: 0 }]
  })), /inflow/i);
  assert.throws(() => buildCashScenarioForecast(input({
    flows: [{ date: '2026-09-07', inflow: -1, outflow: 0 }]
  })), /inflow.*non-negative/i);
  assert.throws(() => buildCashScenarioForecast(input({
    flows: [{ date: '2026-09-07', inflow: 0, outflow: -1 }]
  })), /outflow.*non-negative/i);

  assert.throws(() => buildCashScenarioForecast(input({
    scenarios: [
      { name: 'conservative', inflowMultiplier: Number.NaN, outflowMultiplier: 1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
    ]
  })), /inflowMultiplier/i);
  assert.throws(() => buildCashScenarioForecast(input({
    scenarios: [
      { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: -1 },
      { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
      { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
    ]
  })), /outflowMultiplier.*non-negative/i);
});

test('does not mutate inputs and returns a deeply immutable result', () => {
  const source = input();
  const before = structuredClone(source);

  const result = buildCashScenarioForecast(source);

  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.horizon), true);
  assert.equal(Object.isFrozen(result.scenarios), true);
  assert.equal(Object.isFrozen(result.scenarios[0]), true);
  assert.equal(Object.isFrozen(result.scenarios[0].daily), true);
  assert.equal(Object.isFrozen(result.scenarios[0].daily[0]), true);
  assert.throws(() => { result.scenarios[0].daily[0].closingBalance = 0; }, TypeError);
});

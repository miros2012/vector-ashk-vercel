import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashScenarioForecast } from '../lib/cash-scenario-forecast.js';

const scenarios = [
  { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
  { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
  { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
];

test('accepts a negative projected opening and measures cash gap from daily closing balances', () => {
  const result = buildCashScenarioForecast({
    openingCash: -641803.42,
    flows: [
      { date: '2026-09-08', inflow: 275931.40275, outflow: 92718 },
      { date: '2026-09-09', inflow: 245667.79575, outflow: 0 }
    ],
    scenarios,
    safetyReserve: 300000
  });

  const base = result.scenarios.find(item => item.name === 'base');
  assert.equal(result.openingCash, -641803.42);
  assert.equal(base.daily[0].closingBalance, -458590.01725);
  assert.equal(base.minimumBalance, -458590.01725);
  assert.equal(base.minimumBalanceDate, '2026-09-08');
  assert.equal(base.cashGap, 458590.01725);
  assert.equal(base.safeOwnerWithdrawal, 0);
});

test('still rejects non-finite projected opening balances', () => {
  for (const openingCash of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => buildCashScenarioForecast({
      openingCash,
      flows: [{ date: '2026-09-08', inflow: 1, outflow: 0 }],
      scenarios,
      safetyReserve: 0
    }), /openingCash.*finite/i);
  }
});

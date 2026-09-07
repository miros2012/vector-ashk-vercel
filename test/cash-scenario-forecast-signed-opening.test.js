import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashScenarioForecast } from '../lib/cash-scenario-forecast.js';

const scenarios = [
  { name: 'conservative', inflowMultiplier: 1, outflowMultiplier: 1 },
  { name: 'base', inflowMultiplier: 1, outflowMultiplier: 1 },
  { name: 'target', inflowMultiplier: 1, outflowMultiplier: 1 }
];

test('accepts a negative projected opening and measures cash gap from daily closing balances', () => {
  const openingCash = -641803.42;
  const dayOneInflow = 275931.40275;
  const dayOneOutflow = 92718;
  const expectedDayOneClosing = openingCash + dayOneInflow - dayOneOutflow;

  const result = buildCashScenarioForecast({
    openingCash,
    flows: [
      { date: '2026-09-08', inflow: dayOneInflow, outflow: dayOneOutflow },
      { date: '2026-09-09', inflow: 245667.79575, outflow: 0 }
    ],
    scenarios,
    safetyReserve: 300000
  });

  const base = result.scenarios.find(item => item.name === 'base');
  assert.equal(result.openingCash, openingCash);
  assert.equal(base.daily[0].closingBalance, expectedDayOneClosing);
  assert.equal(base.minimumBalance, expectedDayOneClosing);
  assert.equal(base.minimumBalanceDate, '2026-09-08');
  assert.equal(base.cashGap, Math.max(0, -expectedDayOneClosing));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBalances } from '../lib/tochka-balances.js';

test('normalizes five Vektor funds from Tochka balance list', () => {
  const payload = {
    Data: {
      Balance: [
        { accountId: '40702810212500010112/044525104', type: 'ClosingAvailable', Amount: { amount: '170000.00', currency: 'RUB' }, dateTime: '2026-08-31T07:00:00Z' },
        { accountId: '40702810212500010112/044525104', type: 'Expected', Amount: { amount: '1500.00', currency: 'RUB' }, dateTime: '2026-08-31T07:00:00Z' },
        { accountId: '40702810020000282959/044525104', type: 'ClosingAvailable', Amount: { amount: '824000', currency: 'RUB' } },
        { accountId: '40702810720000282958/044525104', type: 'ClosingAvailable', Amount: { amount: '868000', currency: 'RUB' } },
        { accountId: '40702810420000308886/044525104', type: 'ClosingAvailable', Amount: { amount: '121000', currency: 'RUB' } },
        { accountId: '40702810420000289507/044525104', type: 'ClosingAvailable', Amount: { amount: '750', currency: 'RUB' } }
      ]
    }
  };

  const result = normalizeBalances(payload);
  assert.equal(result.summary.complete, true);
  assert.equal(result.summary.liveCount, 5);
  assert.equal(result.summary.totalAvailable, 1983750);
  assert.equal(result.summary.totalExpected, 1500);
  assert.equal(result.funds.find(x => x.fund === 'Налоги').closingAvailable, 121000);
});

test('does not silently replace missing live balances with zero', () => {
  const result = normalizeBalances({ Data: { Balance: [
    { accountId: '40702810212500010112/044525104', type: 'ClosingAvailable', Amount: { amount: '170000', currency: 'RUB' } }
  ] } });

  assert.equal(result.summary.complete, false);
  assert.equal(result.summary.liveCount, 1);
  assert.equal(result.funds.find(x => x.fund === 'Вождение').closingAvailable, null);
});

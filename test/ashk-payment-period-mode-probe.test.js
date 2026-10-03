import test from 'node:test';
import assert from 'node:assert/strict';
import { PAYMENT_PERIOD_CANDIDATES } from '../lib/ashk-payment-period-candidate-probe.js';

test('period candidates include explicit Month and Custom modes', () => {
  const byName = new Map(PAYMENT_PERIOD_CANDIDATES.map(item => [item.name, item]));
  assert.deepEqual(byName.get('period-month')?.staticParams, { Period: 'Month' });
  assert.deepEqual(byName.get('period-custom-start-date')?.staticParams, { Period: 'Custom' });
  assert.equal(byName.get('period-custom-start-date')?.fromKey, 'StartDate');
  assert.equal(byName.get('period-custom-start-date')?.toKey, 'EndDate');
  assert.deepEqual(byName.get('period-custom-pay-date')?.staticParams, { Period: 'Custom' });
  assert.equal(byName.get('period-custom-pay-date')?.fromKey, 'PayDateFrom');
  assert.equal(byName.get('period-custom-pay-date')?.toKey, 'PayDateTo');
});

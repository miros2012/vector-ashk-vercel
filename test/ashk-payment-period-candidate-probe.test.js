import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_PERIOD_CANDIDATES,
  probeAshkPaymentPeriodCandidates
} from '../lib/ashk-payment-period-candidate-probe.js';

test('tries a bounded candidate set and returns aggregate-only employee totals', async () => {
  const calls = [];
  const session = {
    requestJson: async (path, params) => {
      calls.push({ path, params });
      const hasPayDates = 'PayDateFrom' in params && 'PayDateTo' in params;
      return hasPayDates
        ? { total_count: 3, data: [
            { Id: 1, EmployeeName: 'Кумаритова Алина', Debit: 100000, PayDate: '2026-09-01 10:00:00' },
            { Id: 2, EmployeeName: 'Кумаритова Алина', Debit: 63150, PayDate: '2026-09-02 10:00:00' },
            { Id: 3, EmployeeName: 'Другой', Debit: 5000, PayDate: '2026-09-03 10:00:00' }
          ] }
        : { total_count: 1, data: [{ Id: 9, EmployeeName: 'Другой', Debit: 2700, PayDate: '2026-09-17 06:54:01' }] };
    }
  };

  const result = await probeAshkPaymentPeriodCandidates({
    session,
    startDate: '2026-09-01',
    endDate: '2026-09-17'
  });

  assert.equal(result.length, PAYMENT_PERIOD_CANDIDATES.length);
  const correct = result.find(item => item.name === 'pay-date');
  assert.deepEqual(correct, {
    name: 'pay-date',
    fromKey: 'PayDateFrom',
    toKey: 'PayDateTo',
    rows: 3,
    totalCount: 3,
    debitTotal: 168150,
    alinaPositive: 163150,
    alinaNet: 163150,
    minPayDate: '2026-09-01 10:00:00',
    maxPayDate: '2026-09-03 10:00:00'
  });
  assert.ok(calls.every(call => call.path === '/api/PaymentRecordDebitList'));
  assert.ok(calls.every(call => call.params.start === 0 && call.params.count === 1000));
});

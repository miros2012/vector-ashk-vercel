import test from 'node:test';
import assert from 'node:assert/strict';
import { probeAshkPaymentReportDiagnostics } from '../lib/ashk-payment-report-probe.js';

test('payment report diagnostic includes bounded period candidate aggregates', async () => {
  const session = {
    requestText: async path => {
      if (path === '/') return '<script src="/app.js"></script>';
      if (path === '/app.js') return 'define("views/paymentrecord/list",[],function(){return {command:"PaymentRecordDebitList"}})';
      throw new Error('unexpected asset');
    },
    requestJson: async (path, params) => {
      if (path !== '/api/PaymentRecordDebitList') throw new Error('ASHK web request failed: 404');
      return {
        success: true,
        data: [{
          Id: 1,
          PayDate: '2026-09-01 10:00:00',
          Debit: 163150,
          EmployeeName: 'Кумаритова Алина'
        }],
        pos: 0,
        total_count: 1
      };
    }
  };

  const result = await probeAshkPaymentReportDiagnostics({
    session,
    startDate: '2026-09-01',
    endDate: '2026-09-17',
    pageSize: 200
  });

  assert.equal(Array.isArray(result.periodCandidates), true);
  assert.equal(result.periodCandidates.length > 0, true);
  const payDate = result.periodCandidates.find(item => item.name === 'pay-date');
  assert.equal(payDate.fromKey, 'PayDateFrom');
  assert.equal(payDate.toKey, 'PayDateTo');
  assert.equal(payDate.alinaPositive, 163150);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_REPORT_CANDIDATES,
  probeAshkPaymentReportEndpoints,
  summarizePayloadShape
} from '../lib/ashk-payment-report-probe.js';

test('payment report candidate list stays bounded and includes the likely internal payment journal endpoint', () => {
  assert.ok(PAYMENT_REPORT_CANDIDATES.length >= 3);
  assert.ok(PAYMENT_REPORT_CANDIDATES.length <= 6);
  assert.ok(PAYMENT_REPORT_CANDIDATES.includes('/api/PaymentRecordList'));
});

test('summarizePayloadShape exposes schema and row count without row values', () => {
  const summary = summarizePayloadShape({
    success: true,
    data: [
      { Id: 1, Debit: 100, EmployeeName: 'Кумаритова Алина', StudentName: 'Скрыто' },
      { Id: 2, Debit: 50, EmployeeName: 'Другой сотрудник', StudentName: 'Скрыто 2' }
    ]
  });

  assert.deepEqual(summary, {
    topLevelKeys: ['data', 'success'],
    rowCount: 2,
    rowFields: ['Debit', 'EmployeeName', 'Id', 'StudentName'],
    staffFields: ['EmployeeName'],
    moneyFields: ['Debit']
  });
  assert.equal(JSON.stringify(summary).includes('Кумаритова Алина'), false);
  assert.equal(JSON.stringify(summary).includes('Скрыто'), false);
});

test('probe returns only endpoint status and schema and continues after unsupported candidates', async () => {
  const calls = [];
  const session = {
    requestJson: async (path, params) => {
      calls.push({ path, params });
      if (path === '/api/PaymentRecordList') {
        return {
          success: true,
          data: [{ Id: 1, Amount: 100, EmployeeName: 'Кумаритова Алина' }]
        };
      }
      throw new Error('ASHK web request failed: 404');
    }
  };

  const result = await probeAshkPaymentReportEndpoints({
    session,
    startDate: '2026-09-01',
    endDate: '2026-09-15'
  });

  assert.equal(result.length, PAYMENT_REPORT_CANDIDATES.length);
  assert.deepEqual(result[0], {
    endpoint: '/api/PaymentRecordList',
    ok: true,
    status: 200,
    schema: {
      topLevelKeys: ['data', 'success'],
      rowCount: 1,
      rowFields: ['Amount', 'EmployeeName', 'Id'],
      staffFields: ['EmployeeName'],
      moneyFields: ['Amount']
    }
  });
  assert.equal(result.slice(1).every(item => item.ok === false && item.status === 404), true);
  assert.equal(calls.every(call => call.params.StartDate === '2026-09-01' && call.params.EndDate === '2026-09-15'), true);
  assert.equal(JSON.stringify(result).includes('Кумаритова Алина'), false);
});

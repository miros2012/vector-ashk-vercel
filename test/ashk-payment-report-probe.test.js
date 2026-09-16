import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_REPORT_CANDIDATES,
  probeAshkPaymentReportDiagnostics,
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

test('full diagnostic compares complete internal payment set and exposes only compact period hints plus Alina aggregate', async () => {
  const session = {
    requestText: async path => {
      if (path === '/') return '<script src="/app.js"></script>';
      if (path === '/app.js') return [
        'define("views/paymentrecord/filter",[],function(){return {rows:[{name:"Start",label:"Дата с"},{name:"Finish",label:"Дата по"}]}}),',
        'define("views/paymentrecord/list",[],function(){return {command:"PaymentRecordDebitList",queryParams:function(){return {Start:1,Finish:2}}}})'
      ].join('');
      throw new Error('unexpected asset');
    },
    requestJson: async (path, params) => {
      if (path !== '/api/PaymentRecordDebitList') throw new Error('ASHK web request failed: 404');
      if (!Object.hasOwn(params, 'start')) {
        return {
          success: true,
          data: [{ Id: 1, Debit: 100, EmployeeName: 'Кумаритова Алина' }],
          pos: 0,
          total_count: 3
        };
      }
      if (params.start === 0) {
        return {
          success: true,
          data: [
            { Id: 1, PayDate: '2026-09-01 10:00:00', Debit: 100, EmployeeName: 'Кумаритова Алина' },
            { Id: 2, PayDate: '2026-09-01 11:00:00', Debit: 200, EmployeeName: 'Другой сотрудник' }
          ],
          pos: 0,
          total_count: 3
        };
      }
      return {
        success: true,
        data: [{ Id: 3, PayDate: '2026-09-02 12:00:00', Debit: 50, EmployeeName: 'Кумаритова Алина' }],
        pos: 2,
        total_count: 3
      };
    }
  };

  const result = await probeAshkPaymentReportDiagnostics({
    session,
    startDate: '2026-09-01',
    endDate: '2026-09-16',
    pageSize: 2
  });

  assert.equal(result.endpoints.find(item => item.endpoint === '/api/PaymentRecordDebitList').ok, true);
  assert.deepEqual(result.periodHints, {
    asset: '/app.js',
    found: true,
    candidateKeys: ['Finish', 'Start'],
    filterFields: [
      { name: 'Finish', label: 'Дата по' },
      { name: 'Start', label: 'Дата с' }
    ]
  });
  assert.equal(Object.hasOwn(result.periodHints, 'context'), false);
  assert.equal(Object.hasOwn(result.periodHints, 'filterContext'), false);
  assert.deepEqual(result.employeeSource, {
    metrics: { rows: 3, totalCount: 3, pages: 2, debitTotal: 350, minPayDate: '2026-09-01 10:00:00', maxPayDate: '2026-09-02 12:00:00' },
    alinaCandidates: [{ employee: 'Кумаритова Алина', positive: 150, negative: 0, net: 150, rows: 2 }],
    unattributedRows: 0,
    unattributedAmount: 0
  });
  assert.equal(JSON.stringify(result.employeeSource).includes('Другой сотрудник'), false);
});

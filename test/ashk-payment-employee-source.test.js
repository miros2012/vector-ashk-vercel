import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAshkPaymentEmployeeSource,
  summarizePaymentEmployeeTotals
} from '../lib/ashk-payment-employee-source.js';

test('loads every PaymentRecordDebitList page with stable start/count pagination', async () => {
  const calls = [];
  const session = {
    requestJson: async (path, params) => {
      calls.push({ path, params });
      if (params.start === 0) {
        return {
          success: true,
          data: [
            { Id: 1, PayDate: '2026-09-01 10:00:00', Debit: 100, EmployeeName: 'Алина' },
            { Id: 2, PayDate: '2026-09-01 11:00:00', Debit: 200, EmployeeName: 'Марина' }
          ],
          pos: 0,
          total_count: 3
        };
      }
      assert.equal(params.start, 2);
      return {
        success: true,
        data: [
          { Id: 3, PayDate: '2026-09-02 12:00:00', Debit: 300, EmployeeName: 'Алина' }
        ],
        pos: 2,
        total_count: 3
      };
    }
  };

  const source = createAshkPaymentEmployeeSource({ session, pageSize: 2 });
  const result = await source.fetchPeriod({ startDate: '2026-09-01', endDate: '2026-09-16' });

  assert.deepEqual(calls, [
    { path: '/api/PaymentRecordDebitList', params: { StartDate: '2026-09-01', EndDate: '2026-09-16', start: 0, count: 2 } },
    { path: '/api/PaymentRecordDebitList', params: { StartDate: '2026-09-01', EndDate: '2026-09-16', start: 2, count: 2 } }
  ]);
  assert.deepEqual(result.rows.map(row => row.Id), [1, 2, 3]);
  assert.deepEqual(result.metrics, {
    rows: 3,
    totalCount: 3,
    pages: 2,
    debitTotal: 600,
    minPayDate: '2026-09-01 10:00:00',
    maxPayDate: '2026-09-02 12:00:00'
  });
});

test('fails closed when PaymentRecordDebitList pagination repeats without progress', async () => {
  const session = {
    requestJson: async () => ({
      success: true,
      data: [{ Id: 1, Debit: 100, EmployeeName: 'Алина' }],
      pos: 0,
      total_count: 2
    })
  };
  const source = createAshkPaymentEmployeeSource({ session, pageSize: 1 });
  await assert.rejects(
    () => source.fetchPeriod({ startDate: '2026-09-01', endDate: '2026-09-16' }),
    /pagination made no progress/i
  );
});

test('summarizes positive accepted payments by EmployeeName and keeps negatives out of personal KPI', () => {
  const result = summarizePaymentEmployeeTotals([
    { Id: 1, Debit: 100, EmployeeName: 'Кумаритова Алина' },
    { Id: 2, Debit: 50, EmployeeName: 'Кумаритова Алина' },
    { Id: 3, Debit: -40, EmployeeName: 'Кумаритова Алина' },
    { Id: 4, Debit: 70, EmployeeName: 'Кузнецова Марина' },
    { Id: 5, Debit: 20, EmployeeName: '' }
  ]);

  assert.deepEqual(result, {
    totals: [
      { employee: 'Кузнецова Марина', positive: 70, negative: 0, net: 70, rows: 1 },
      { employee: 'Кумаритова Алина', positive: 150, negative: -40, net: 110, rows: 3 }
    ],
    unattributedRows: 1,
    unattributedAmount: 20
  });
});

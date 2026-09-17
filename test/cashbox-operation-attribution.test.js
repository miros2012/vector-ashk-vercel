import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCashboxOperations } from '../api/sync-payments.js';

test('cashbox remains diagnostic-only and aggregates operations by employee and cashier', () => {
  const result = summarizeCashboxOperations([
    { Id: 1, Created: '2026-09-01 10:00:00', Amount: 100, EmployeeName: 'Алина', CashierName: 'Марина', Kind: 'Приход' },
    { Id: 2, Created: '2026-09-01 11:00:00', Amount: -20, EmployeeName: 'Алина', CashierName: 'Марина', Kind: 'Возврат' },
    { Id: 3, Created: '2026-09-01 12:00:00', Amount: 50, EmployeeName: 'Борис', CashierName: 'Алина', Kind: 'Приход' },
    { Id: 4, Created: '2026-09-01 13:00:00', Amount: 30, EmployeeName: '', CashierName: '', Kind: 'Приход' }
  ]);

  assert.deepEqual(result.fields, ['Amount', 'CashierName', 'Created', 'EmployeeName', 'Id', 'Kind']);
  assert.deepEqual(result.employeeTotals, [
    { employee: 'Алина', rows: 2, positive: 100, negative: -20, net: 80 },
    { employee: 'Борис', rows: 1, positive: 50, negative: 0, net: 50 }
  ]);
  assert.deepEqual(result.cashierTotals, [
    { cashier: 'Алина', rows: 1, positive: 50, negative: 0, net: 50 },
    { cashier: 'Марина', rows: 2, positive: 100, negative: -20, net: 80 }
  ]);
  assert.equal(result.unattributedRows, 1);
  assert.equal(result.cashierUnattributedRows, 1);
});

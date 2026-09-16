import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePaymentEmployees } from '../lib/payment-employee-reconciliation.js';

const external = [
  { Id: 1, PayDate: '2026-09-01 10:00:00', Debit: 100, StudentId: 10, SaleId: 100 },
  { Id: 2, PayDate: '2026-09-01 11:00:00', Debit: 200, StudentId: 20, SaleId: 200 }
];

const internal = [
  { Id: 1, PayDate: '2026-09-01 10:00:00', Debit: 100, StudentId: 10, SaleId: 100, EmployeeName: 'Менеджер А' },
  { Id: 2, PayDate: '2026-09-01 11:00:00', Debit: 200, StudentId: 20, SaleId: 200, EmployeeName: 'Менеджер Б' }
];

test('maps direct ASHK EmployeeName only after exact payment coverage matches', () => {
  const result = reconcilePaymentEmployees(external, internal);
  assert.deepEqual(result.items.map(row => [row.Id, row.PaymentEmployeeName]), [
    [1, 'Менеджер А'],
    [2, 'Менеджер Б']
  ]);
  assert.deepEqual(result.metrics, {
    rows: 2,
    debitTotal: 300,
    employeeAttributed: 2,
    employeeEmpty: 0
  });
});

test('allows an explicitly empty employee but still requires the payment row itself', () => {
  const rows = [{ ...internal[0], EmployeeName: '' }, internal[1]];
  const result = reconcilePaymentEmployees(external, rows);
  assert.equal(result.items[0].PaymentEmployeeName, '');
  assert.deepEqual(result.metrics, {
    rows: 2,
    debitTotal: 300,
    employeeAttributed: 1,
    employeeEmpty: 1
  });
});

test('fails closed on missing or extra payment ids', () => {
  assert.throws(() => reconcilePaymentEmployees(external, internal.slice(0, 1)), /payment id coverage mismatch/i);
  assert.throws(() => reconcilePaymentEmployees(external, [...internal, { ...internal[0], Id: 3 }]), /payment id coverage mismatch/i);
});

test('fails closed on duplicate ids in either source', () => {
  assert.throws(() => reconcilePaymentEmployees([...external, external[0]], internal), /duplicate external payment id/i);
  assert.throws(() => reconcilePaymentEmployees(external, [...internal, internal[0]]), /duplicate internal payment id/i);
});

test('fails closed on amount, date, student or sale mismatch', () => {
  for (const bad of [
    { Debit: 101 },
    { PayDate: '2026-09-01 10:00:01' },
    { StudentId: 11 },
    { SaleId: 101 }
  ]) {
    assert.throws(
      () => reconcilePaymentEmployees(external, [{ ...internal[0], ...bad }, internal[1]]),
      /payment row mismatch/i
    );
  }
});

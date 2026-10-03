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

test('direct ASHK EmployeeName is accepted only after exact payment identity coverage', () => {
  const result = reconcilePaymentEmployees(external, internal);
  assert.deepEqual(result.items.map(row => [row.Id, row.PaymentEmployeeName]), [[1,'Менеджер А'],[2,'Менеджер Б']]);
  assert.deepEqual(result.metrics, { rows: 2, debitTotal: 300, employeeAttributed: 2, employeeEmpty: 0 });
});

test('empty EmployeeName is explicit but payment coverage remains mandatory', () => {
  const result = reconcilePaymentEmployees(external, [{ ...internal[0], EmployeeName: '' }, internal[1]]);
  assert.equal(result.items[0].PaymentEmployeeName, '');
  assert.equal(result.metrics.employeeEmpty, 1);
});

test('fails closed on missing extra or duplicate payment ids', () => {
  assert.throws(() => reconcilePaymentEmployees(external, internal.slice(0,1)), /coverage mismatch/i);
  assert.throws(() => reconcilePaymentEmployees(external, [...internal, { ...internal[0], Id: 3 }]), /coverage mismatch/i);
  assert.throws(() => reconcilePaymentEmployees([...external, external[0]], internal), /duplicate external/i);
  assert.throws(() => reconcilePaymentEmployees(external, [...internal, internal[0]]), /duplicate internal/i);
});

test('fails closed when same payment id has different business identity', () => {
  for (const patch of [
    { Debit: 101 },
    { PayDate: '2026-09-01 10:00:01' },
    { StudentId: 11 },
    { SaleId: 101 }
  ]) {
    assert.throws(() => reconcilePaymentEmployees(external, [{ ...internal[0], ...patch }, internal[1]]), /row mismatch/i);
  }
});

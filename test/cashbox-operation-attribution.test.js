import test from 'node:test';
import assert from 'node:assert/strict';
import { attributePaymentsToCashboxOperations } from '../api/sync-payments.js';

test('attributes a payment to the employee from the matching cashbox operation', () => {
  const result = attributePaymentsToCashboxOperations([
    { Id: 10, PayDate: '2026-09-02T10:15:00', Debit: 15100 }
  ], [
    { Id: 900, Created: '2026-09-02 10:15:00', Amount: 15100, EmployeeName: 'Шумилова Полина' }
  ]);

  assert.equal(result.items[0].PaymentEmployeeName, 'Шумилова Полина');
  assert.deepEqual(result.metrics, {
    total: 1,
    attributed: 1,
    noMatch: 0,
    ambiguous: 0,
    employeeEmpty: 0
  });
});

test('does not guess when matching operations belong to different employees', () => {
  const result = attributePaymentsToCashboxOperations([
    { Id: 10, PayDate: '2026-09-02 10:15:00', Debit: '5 000,00' }
  ], [
    { Id: 900, Created: '2026-09-02T10:15:00', Amount: 5000, EmployeeName: 'Шумилова Полина' },
    { Id: 901, Created: '2026-09-02T10:15:00', Amount: 5000, EmployeeName: 'Другой сотрудник' }
  ]);

  assert.equal(result.items[0].PaymentEmployeeName, '');
  assert.equal(result.metrics.ambiguous, 1);
  assert.equal(result.metrics.attributed, 0);
});

test('accepts duplicate matching operation rows when their employee is the same', () => {
  const result = attributePaymentsToCashboxOperations([
    { Id: 10, PayDate: '2026-09-02T10:15:00', Debit: 5000 }
  ], [
    { Id: 900, Created: '2026-09-02 10:15:00', Amount: 5000, EmployeeName: 'Шумилова Полина' },
    { Id: 901, Created: '2026-09-02 10:15:00', Amount: 5000, EmployeeName: 'Шумилова Полина' }
  ]);

  assert.equal(result.items[0].PaymentEmployeeName, 'Шумилова Полина');
  assert.equal(result.metrics.attributed, 1);
});

test('leaves payment unattributed when the operation employee is empty or no operation matches', () => {
  const result = attributePaymentsToCashboxOperations([
    { Id: 10, PayDate: '2026-09-02T10:15:00', Debit: 5000 },
    { Id: 11, PayDate: '2026-09-02T11:00:00', Debit: 10000 }
  ], [
    { Id: 900, Created: '2026-09-02 10:15:00', Amount: 5000, EmployeeName: '' }
  ]);

  assert.equal(result.items[0].PaymentEmployeeName, '');
  assert.equal(result.items[1].PaymentEmployeeName, '');
  assert.equal(result.metrics.employeeEmpty, 1);
  assert.equal(result.metrics.noMatch, 1);
});

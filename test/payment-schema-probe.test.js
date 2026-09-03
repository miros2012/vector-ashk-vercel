import test from 'node:test';
import assert from 'node:assert/strict';
import * as payments from '../api/sync-payments.js';

test('payment schema probe exposes only field metadata and staff-like samples', () => {
  assert.equal(typeof payments.summarizePaymentSchema, 'function');
  const result = payments.summarizePaymentSchema([
    {
      Id: 10,
      StudentId: 100,
      StudentName: 'Не должен попасть в результат',
      PayDate: '2026-09-02 10:00:00',
      EmployeeId: 55,
      EmployeeName: 'Шумилова Полина'
    },
    {
      Id: 11,
      StudentId: 101,
      StudentName: 'Тоже не должен попасть',
      PayDate: '2026-09-02 11:00:00',
      EmployeeId: 56,
      EmployeeName: 'Фурман Валерия'
    }
  ]);

  assert.deepEqual(result.staffCandidates, [
    { field: 'EmployeeId', types: ['number'], samples: ['55', '56'] },
    { field: 'EmployeeName', types: ['string'], samples: ['Шумилова Полина', 'Фурман Валерия'] }
  ]);
  assert.equal(JSON.stringify(result).includes('Не должен попасть'), false);
});

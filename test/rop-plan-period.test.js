import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRopPlanApproved, ropPlanSheetForMonth } from '../lib/rop-plan-period.js';

test('October finance cycle cannot silently reuse the September ROP plan', () => {
  assert.equal(ropPlanSheetForMonth('2026-09'), 'РОП_План_Сентябрь');
  assert.equal(ropPlanSheetForMonth('2026-10'), 'РОП_План_Октябрь');
});

test('invalid report month fails closed before any plan is read', () => {
  assert.throws(() => ropPlanSheetForMonth('2026-13'), /valid YYYY-MM/);
});

test('missing or header-only current-month plan is reported as not approved', () => {
  for (const values of [[], [['Менеджер', 'Филиал']]]) {
    assert.throws(
      () => assertRopPlanApproved(values, '2026-10'),
      error => error?.errorClass === 'ROP_PLAN_NOT_APPROVED'
    );
  }
});

test('an explicit active manager row approves the current-month plan', () => {
  const values = [
    ['Менеджер', 'Филиал', 'Филиал АШК', 'План филиала', 'План менеджера', 'График', 'Активен'],
    ['Анна', 'Ямская', 'Ямская', 1000000, 1000000, '5/2', 'Да']
  ];
  assert.equal(assertRopPlanApproved(values, '2026-10'), values);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterPayrollSheetValues } from '../lib/master-payroll-sheet-adapter.js';

test('sheet output separates full gross, confirmed deductions, blocked vehicle costs and net', () => {
  const rows = buildMasterPayrollSheetValues({
    masters: [{
      masterKey: 'a',
      masterName: 'Master A',
      gross: 50000,
      components: {
        'Основное вождение (120 минут)': { group: 'B', gross: 30000 },
        'Мото': { group: 'MOTO', gross: 10000 },
        'Дополнительное вождение МОТО': { group: 'EXTRA_MOTO', gross: 5000 },
        'Тренажер': { group: 'TRAINER', gross: 5000 }
      },
      advances: 4000,
      officialPayments: 3000,
      statutoryDeductions: 2000,
      otherConfirmedDeductions: 1000,
      confirmedDeductions: 10000,
      outstandingNet: 40000,
      status: 'INTERIM'
    }],
    totals: { gross: 50000, confirmedDeductions: 10000, outstandingNet: 40000, blocked: 9000 },
    blocked: [
      { type: 'FUEL', amount: 3000 },
      { type: 'LEASING', amount: 6000 }
    ],
    gates: { VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED: false },
    promotionStatus: 'BLOCKED'
  });

  assert.deepEqual(rows[0].slice(0, 5), ['Мастер', 'Verified gross', 'Подтверждено удержаний/выплат', 'Outstanding net', 'Статус']);
  assert.equal(rows[1][0], 'Master A');
  assert.equal(rows[1][1], 50000);
  assert.equal(rows[1][2], 10000);
  assert.equal(rows[1][3], 40000);
  assert.equal(rows[1][5], 30000);
  assert.equal(rows[1][6], 10000);
  assert.equal(rows[1][7], 5000);
  assert.equal(rows[1][8], 5000);
});

test('aggregate row contains unresolved fuel and leasing while master rows do not allocate them', () => {
  const rows = buildMasterPayrollSheetValues({
    masters: [{ masterKey: 'a', masterName: 'Master A', gross: 10000, components: {}, confirmedDeductions: 0, outstandingNet: 10000, status: 'INTERIM' }],
    totals: { gross: 10000, confirmedDeductions: 0, outstandingNet: 10000, blocked: 9000 },
    blocked: [
      { type: 'FUEL', amount: 3000 },
      { type: 'LEASING', amount: 6000 }
    ],
    gates: { VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED: false },
    promotionStatus: 'BLOCKED'
  });
  const totalRow = rows.find((row) => row[0] === 'ИТОГО');
  assert.equal(totalRow[13], 3000);
  assert.equal(totalRow[14], 6000);
  assert.equal(rows[1][13], 'не распределено');
  assert.equal(rows[1][14], 'не распределено');
});

test('gate summary is rendered and no production sheet name is exported', () => {
  const rows = buildMasterPayrollSheetValues({
    masters: [],
    totals: { gross: 0, confirmedDeductions: 0, outstandingNet: 0, blocked: 0 },
    blocked: [],
    gates: {
      ASHK_ARCHIVE_OK: true,
      ALL_SESSION_TYPES_RATED: true,
      VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED: false
    },
    promotionStatus: 'BLOCKED'
  });
  assert.ok(rows.some((row) => row[0] === 'PROMOTION_STATUS' && row[1] === 'BLOCKED'));
  assert.ok(rows.some((row) => row[0] === 'VEHICLE_ALLOCATIONS_RESOLVED_OR_EXCLUDED' && row[1] === false));

  const moduleExports = await import('../lib/master-payroll-sheet-adapter.js');
  assert.equal(Object.values(moduleExports).includes('Фонд вождения'), false);
});

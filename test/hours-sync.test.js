import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  buildHoursImportWorkbook,
  businessDateFromFactStart,
  compareHoursMetrics,
  isAuthorizedSyncKey,
  masterReportPeriodForMonth,
  metricsFromHoursSheetValues
} from '../lib/hours-sync.js';

const API_ROWS = [
  {
    EmployeeId: 12,
    MasterName: 'Иванов Иван',
    ContractName: 'B-102',
    FactStart: '2026-08-02 10:00:00',
    SessionTypeName: 'Доп. часы кат В (120 минут)',
    Hours: '3',
    ParallelHours: 3,
    VisitState: 0,
    MainProductName: 'Категория B',
    VehicleName: 'Car 1'
  },
  {
    EmployeeId: 12,
    MasterName: 'Иванов Иван',
    ContractName: 'B-102',
    FactStart: '2026-08-02 10:00:00',
    SessionTypeName: 'Доп. часы кат В (120 минут)',
    Hours: '3',
    ParallelHours: 3,
    VisitState: 0,
    MainProductName: 'Категория B',
    VehicleName: 'Car 1'
  },
  {
    EmployeeId: 9,
    MasterName: 'Петров Пётр',
    ContractName: 'B-101',
    FactStart: '2026-08-01 08:00:00',
    SessionTypeName: 'Основное вождение (120 минут)',
    Hours: 3,
    ParallelHours: 2.5,
    VisitState: 0,
    MainProductName: 'Категория B',
    VehicleName: 'Car 2'
  }
];

test('buildHoursImportWorkbook deduplicates exact ASHK rows and produces auditable totals', () => {
  const result = buildHoursImportWorkbook(API_ROWS, {
    month: '2026-08',
    loadedAt: '2026-08-31T10:00:00.000Z'
  });

  assert.equal(result.sourceRows, 3);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.metrics.rows, 2);
  assert.equal(result.metrics.hours, 6);
  assert.deepEqual(result.metrics.byDate, {
    '2026-08-01': { rows: 1, hours: 3 },
    '2026-08-02': { rows: 1, hours: 3 }
  });
  assert.deepEqual(result.metrics.byType, {
    'Доп. часы кат В (120 минут)': { rows: 1, hours: 3 },
    'Основное вождение (120 минут)': { rows: 1, hours: 3 }
  });
  assert.equal(result.rawValues.length, 3);
  assert.equal(result.rawValues[1][2], '2026-08-01');
  assert.equal(result.rawValues[2][2], '2026-08-02');
  assert.equal(result.rawValues[1][8], 3);
  assert.match(result.rawValues[1][0], /2026-08-01T08:00:00/);
  assert.equal(JSON.stringify(result.reconciliationValues).includes('Иванов'), false);
  assert.equal(JSON.stringify(result.reconciliationValues).includes('Asia/Yekaterinburg'), true);
});

test('businessDateFromFactStart converts offset timestamps to Tyumen business date', () => {
  assert.equal(businessDateFromFactStart('2026-08-31T20:30:00Z'), '2026-09-01');
  assert.equal(businessDateFromFactStart('2026-08-31 23:30:00'), '2026-08-31');
});

test('buildHoursImportWorkbook rejects rows outside the requested Tyumen business month', () => {
  assert.throws(
    () => buildHoursImportWorkbook([
      { ...API_ROWS[0], FactStart: '2026-08-31T20:30:00Z' }
    ], { month: '2026-08', loadedAt: '2026-08-31T10:00:00.000Z' }),
    /outside requested month/
  );
});

test('later ASHK correction replaces earlier row with the same stable business key', () => {
  const result = buildHoursImportWorkbook([
    API_ROWS[0],
    { ...API_ROWS[0], Hours: 4, ParallelHours: 4 }
  ], {
    month: '2026-08',
    loadedAt: '2026-08-31T10:00:00.000Z'
  });

  assert.equal(result.metrics.rows, 1);
  assert.equal(result.metrics.hours, 4);
  assert.equal(result.duplicateRows, 1);
});

test('masterReportPeriodForMonth returns the full calendar month and rejects invalid months', () => {
  assert.deepEqual(masterReportPeriodForMonth('2026-08'), {
    startDate: '2026-08-01T00:00:00',
    endDate: '2026-08-31T23:59:59'
  });
  assert.throws(() => masterReportPeriodForMonth('2026-13'), /valid YYYY-MM/);
});

test('metricsFromHoursSheetValues and compareHoursMetrics detect a staging write mismatch', () => {
  const workbook = buildHoursImportWorkbook(API_ROWS, {
    month: '2026-08',
    loadedAt: '2026-08-31T10:00:00.000Z'
  });
  const corrupted = workbook.rawValues.map((row) => [...row]);
  corrupted[1][8] = 2;

  const staging = metricsFromHoursSheetValues(corrupted);
  assert.deepEqual(compareHoursMetrics(workbook.metrics, staging), {
    ok: false,
    rowDiff: 0,
    hoursDiff: -1
  });
});

test('isAuthorizedSyncKey accepts configured or one-time hashed keys and rejects wrong keys', () => {
  const bootstrapHash = createHash('sha256').update('one-time').digest('hex');

  assert.equal(isAuthorizedSyncKey('permanent', { configuredKey: 'permanent' }), true);
  assert.equal(isAuthorizedSyncKey('one-time', { configuredKey: '', bootstrapHash }), true);
  assert.equal(isAuthorizedSyncKey('wrong', { configuredKey: 'permanent', bootstrapHash }), false);
  assert.equal(isAuthorizedSyncKey('', { configuredKey: '', bootstrapHash }), false);
});

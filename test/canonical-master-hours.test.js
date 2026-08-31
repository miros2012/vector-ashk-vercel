import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeMasterReportRows } from '../lib/master-hours.js';

test('canonicalizeMasterReportRows emits stable staging rows and deduplicates exact report duplicates', () => {
  const source = {
    EmployeeId: 2108903,
    MasterName: 'Жданов Александр Николаевич',
    ContractName: '2979B',
    FactStart: '2026-08-01 07:00:00',
    SessionTypeName: 'Доп. часы кат В (120 минут)',
    Hours: '3',
    ParallelHours: '3',
    VisitState: '0',
    MainProductName: 'Курс "Базовый"',
    VehicleName: 'LADA VESTA Р411ХН22'
  };

  const rows = canonicalizeMasterReportRows(
    [source, { ...source }],
    '2026-08-31T10:17:20.862Z'
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    Key: JSON.stringify([
      '2108903',
      '2026-08-01 07:00:00',
      '2979B',
      'Доп. часы кат В (120 минут)',
      3,
      3,
      0,
      'Курс "Базовый"',
      'LADA VESTA Р411ХН22'
    ]),
    Month: '2026-08',
    FactDate: '2026-08-01',
    FactStart: '2026-08-01 07:00:00',
    EmployeeId: '2108903',
    MasterName: 'Жданов Александр Николаевич',
    ContractName: '2979B',
    SessionTypeName: 'Доп. часы кат В (120 минут)',
    Hours: 3,
    ParallelHours: 3,
    VisitState: 0,
    MainProductName: 'Курс "Базовый"',
    VehicleName: 'LADA VESTA Р411ХН22',
    Source: 'MasterWorkReportDetails',
    LoadedAt: '2026-08-31T10:17:20.862Z'
  });
});

test('canonicalizeMasterReportRows drops rows without a valid FactStart date', () => {
  assert.deepEqual(
    canonicalizeMasterReportRows([{ FactStart: '', Hours: 3 }], 'x'),
    []
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMasterReportUrl,
  extractReportRows,
  summarizeMasterHours
} from '../lib/master-hours.js';

test('buildMasterReportUrl sends the documented bounded fact-period query', () => {
  const url = new URL(buildMasterReportUrl({
    baseUrl: 'https://app.dscontrol.ru',
    buildMode: 1,
    startDate: '2026-08-01T00:00:00',
    endDate: '2026-08-31T23:59:59'
  }));

  assert.equal(url.pathname, '/api/MasterWorkReportDetails');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    BuildMode: '1',
    PlanFact: '0',
    Period: '7',
    StartDate: '2026-08-01T00:00:00',
    EndDate: '2026-08-31T23:59:59'
  });
});

test('extractReportRows rejects an ASHK application error', () => {
  assert.throws(
    () => extractReportRows({ success: false, data: { Message: 'denied' } }),
    /denied/
  );
});

test('summarizeMasterHours returns privacy-safe totals and type breakdowns', () => {
  const result = summarizeMasterHours([
    {
      MasterName: 'Hidden One',
      ContractName: '42',
      FactStart: '2026-08-03T09:00:00',
      SessionTypeName: 'Осн',
      Hours: 2,
      PlanHours: 3,
      ParallelHours: 0.5,
      PlanParallelHours: 1
    },
    {
      MasterName: 'Hidden Two',
      FactStart: '2026-08-01T10:00:00',
      SessionTypeName: 'Осн',
      Hours: '4',
      PlanHours: '4',
      ParallelHours: 0,
      PlanParallelHours: 0
    },
    {
      FactStart: '2026-08-31T18:00:00',
      SessionTypeName: 'ДОП',
      Hours: 1,
      PlanHours: 1,
      ParallelHours: 1,
      PlanParallelHours: 1
    }
  ]);

  assert.deepEqual(result, {
    rows: 3,
    hours: 7,
    planHours: 8,
    parallelHours: 1.5,
    planParallelHours: 2,
    firstFactStart: '2026-08-01T10:00:00',
    lastFactStart: '2026-08-31T18:00:00',
    bySessionType: {
      'ДОП': { rows: 1, hours: 1, planHours: 1, parallelHours: 1 },
      'Осн': { rows: 2, hours: 6, planHours: 7, parallelHours: 0.5 }
    }
  });
  assert.equal(JSON.stringify(result).includes('Hidden'), false);
  assert.equal(JSON.stringify(result).includes('ContractName'), false);
});


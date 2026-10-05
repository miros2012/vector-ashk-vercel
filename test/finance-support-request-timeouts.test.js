import test from 'node:test';
import assert from 'node:assert/strict';
import { writeControlMarker } from '../lib/google-sheets-sync-marker.js';
import { formatDebtorPrioritySheet } from '../lib/rop-debtor-format.js';
import { expectBoundedFailure } from './helpers/bounded-failure.js';
import { boundedGoogleSheetsRequest } from '../lib/google-sheets-lease.js';
import { createSyncHoursHandler } from '../lib/sync-hours-handler.js';
import { createFinanceCycle } from '../lib/finance-cycle.js';
import { syncRopSourceThenPublishTarget } from '../lib/rop-publisher.js';
import { nextFinanceRetry } from '../lib/finance-retry-policy.js';

test('bounded request timeout preserves a transport code and retryable finance class', async () => {
  await assert.rejects(boundedGoogleSheetsRequest(() => new Promise(() => {}), 20, 'snapshot-write'), error => {
    assert.equal(error.code, 'ETIMEDOUT');
    assert.equal(error.errorClass, 'TIME_BUDGET');
    assert.equal(error.phase, 'snapshot-write');
    return true;
  });
});

test('Sheets timeout through hours handler defers recovery instead of permanently blocking the cycle', async () => {
  let state;
  let downstream = 0;
  const handler = createSyncHoursHandler({
    configuredKey: 'test-key', now: () => new Date('2026-08-31T10:00:00Z'),
    fetchReport: async () => [],
    writeRaw: () => boundedGoogleSheetsRequest(() => new Promise(() => {}), 20, 'hours-metadata'),
    readRaw: async () => { downstream++; return []; },
    writeReconciliation: async () => { downstream++; }
  });
  const run = createFinanceCycle({
    store: {
      acquire: async () => ({ ok: true }), release: async () => {},
      read: async () => structuredClone(state), write: async value => { state = structuredClone(value); }
    },
    sequence: () => ['hours'], now: () => new Date('2026-08-31T10:00:00Z'),
    stages: { hours: async () => {
      const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, setHeader() {} };
      await handler({ method: 'POST', headers: { 'x-vector-key': 'test-key' }, body: { month: '2026-08' } }, res);
      return { ...res.body, statusCode: res.statusCode };
    } }
  });
  await run({});
  await run({ recoveryOnly: true });
  const result = await run({ recoveryOnly: true });
  assert.equal(result.deferred, true);
  assert.equal(result.complete, false);
  assert.equal(state.status, 'PENDING');
  assert.equal(state.errorClass, 'HOURS_TRANSPORT');
  assert.equal(state.resumeAfter, '2026-08-31T10:05:00.000Z');
  assert.equal(downstream, 0);
});

test('ROP source Sheets timeout schedules retry without publishing unverified data', async () => {
  let publishes = 0;
  const failure = await syncRopSourceThenPublishTarget({
    refreshSource: () => boundedGoogleSheetsRequest(() => new Promise(() => {}), 20, 'finance-source-readback'),
    publishTarget: async () => { publishes++; return { ok: true }; }
  });
  assert.equal(failure.retryable, true);
  assert.equal(failure.errorClass, 'TIME_BUDGET');
  assert.equal(publishes, 0);
  assert.deepEqual(nextFinanceRetry({ failure, attempt: 1, now: new Date('2026-10-05T10:00:00Z'), runId: 'r1', stage: 'ropPublish' }), {
    finance_retry_stage: 'ropPublish', finance_retry_attempt: 2,
    finance_retry_after_utc: '2026-10-05T10:10:00.000Z',
    finance_retry_origin_run_id: 'r1', finance_retry_error_class: 'TIME_BUDGET'
  });
});

for (const phase of ['marker-read', 'marker-update', 'marker-append']) {
  test(`${phase}: stalled freshness marker I/O fails without replay`, async () => {
    const calls = [];
    const sheets = { spreadsheets: { values: {
      get: async () => {
        calls.push('read');
        if (phase === 'marker-read') return new Promise(() => {});
        return { data: { values: phase === 'marker-update' ? [['last_success', 'old']] : [] } };
      },
      update: async () => { calls.push('update'); return new Promise(() => {}); },
      append: async () => { calls.push('append'); return new Promise(() => {}); }
    } } };
    await expectBoundedFailure(writeControlMarker({ sheets, spreadsheetId: 'book', key: 'last_success', value: 'new', requestTimeoutMs: 20 }), phase);
    assert.deepEqual(calls, phase === 'marker-read' ? ['read'] : ['read', phase === 'marker-update' ? 'update' : 'append']);
  });
}

for (const phase of ['debtor-format-metadata', 'debtor-format-write']) {
  test(`${phase}: stalled ROP formatting returns failure`, async () => {
    let writes = 0;
    const sheets = { spreadsheets: {
      get: async () => phase === 'debtor-format-metadata' ? new Promise(() => {}) : {
        data: { sheets: [{ properties: { sheetId: 1, title: 'ROP', gridProperties: { rowCount: 100 } }, conditionalFormats: [] }] }
      },
      batchUpdate: async () => { writes++; return new Promise(() => {}); }
    } };
    await expectBoundedFailure(formatDebtorPrioritySheet({ sheets, spreadsheetId: 'book', sheetName: 'ROP', requestTimeoutMs: 20 }), phase);
    assert.equal(writes, phase === 'debtor-format-metadata' ? 0 : 1);
  });
}

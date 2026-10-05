import test from 'node:test';
import assert from 'node:assert/strict';
import { writeControlMarker } from '../lib/google-sheets-sync-marker.js';
import { formatDebtorPrioritySheet } from '../lib/rop-debtor-format.js';
import { expectBoundedFailure } from './helpers/bounded-failure.js';

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

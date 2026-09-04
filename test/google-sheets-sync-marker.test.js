import test from 'node:test';
import assert from 'node:assert/strict';
import { findControlMarkerRow, writeControlMarker } from '../lib/google-sheets-sync-marker.js';

test('finds an existing control marker by its exact key', () => {
  assert.equal(findControlMarkerRow([
    ['payments_live_enabled', 'true'],
    ['payments_last_success_utc', '2026-08-30T05:09:14.497Z']
  ], 'payments_last_success_utc'), 2);
  assert.equal(findControlMarkerRow([], 'payments_last_success_utc'), null);
});

test('updates an existing marker without rewriting unrelated control rows', async () => {
  const calls = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [
          ['payments_live_enabled', 'true'],
          ['payments_last_success_utc', '2026-08-30T05:09:14.497Z']
        ] } }),
        update: async payload => { calls.push(['update', payload]); return {}; },
        append: async payload => { calls.push(['append', payload]); return {}; }
      }
    }
  };

  const result = await writeControlMarker({
    sheets,
    spreadsheetId: 'sheet-id',
    key: 'payments_last_success_utc',
    value: '2026-09-04T13:30:00.000Z'
  });

  assert.deepEqual(result, {
    key: 'payments_last_success_utc',
    value: '2026-09-04T13:30:00.000Z',
    rowNumber: 2,
    created: false
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[0][1].range, "'__vercel_control'!B2");
  assert.deepEqual(calls[0][1].requestBody.values, [['2026-09-04T13:30:00.000Z']]);
});

test('appends a marker when the key does not exist yet', async () => {
  const calls = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [['payments_live_enabled', 'true']] } }),
        update: async payload => { calls.push(['update', payload]); return {}; },
        append: async payload => { calls.push(['append', payload]); return {}; }
      }
    }
  };

  const result = await writeControlMarker({
    sheets,
    spreadsheetId: 'sheet-id',
    key: 'receivables_last_success_utc',
    value: '2026-09-04T13:31:00.000Z'
  });

  assert.deepEqual(result, {
    key: 'receivables_last_success_utc',
    value: '2026-09-04T13:31:00.000Z',
    rowNumber: 2,
    created: true
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'append');
  assert.equal(calls[0][1].range, "'__vercel_control'!A:B");
  assert.deepEqual(calls[0][1].requestBody.values, [[
    'receivables_last_success_utc',
    '2026-09-04T13:31:00.000Z'
  ]]);
});

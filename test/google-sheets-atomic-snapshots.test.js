import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceSheetSnapshotsAtomically } from '../lib/google-sheets-atomic-snapshots.js';

test('replaces multiple snapshots in one fixed-width padded batch', async () => {
  const calls = { reads: [], writes: [] };
  const sheets = { spreadsheets: { values: {
    batchGet: async args => {
      calls.reads.push(args);
      return { data: { valueRanges: [
        { values: [['old-a', 'old-b', 'old-c'], ['old-2'], ['stale-3']] },
        { values: [['old-sale', 1]] }
      ] } };
    },
    batchUpdate: async args => { calls.writes.push(args); return { data: {} }; }
  } } };

  const result = await replaceSheetSnapshotsAtomically({
    sheets,
    spreadsheetId: 'book',
    snapshots: [
      { sheetName: "Pay'ments", columnCount: 3, values: [['h1', 'h2', 'h3'], ['new', 2]] },
      { sheetName: 'Sales', columnCount: 2, values: [['s1', 's2'], ['one'], ['two', 2]] }
    ]
  });

  assert.deepEqual(calls.reads, [{
    spreadsheetId: 'book',
    ranges: ["'Pay''ments'!A1:C", "'Sales'!A1:B"],
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.writes[0], {
    spreadsheetId: 'book',
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: "'Pay''ments'!A1:C3", values: [['h1', 'h2', 'h3'], ['new', 2, ''], ['', '', '']] },
        { range: "'Sales'!A1:B3", values: [['s1', 's2'], ['one', ''], ['two', 2]] }
      ]
    }
  });
  assert.deepEqual(result, { ranges: ["'Pay''ments'!A1:C3", "'Sales'!A1:B3"] });
});

test('rejects malformed snapshots before reading or writing Google Sheets', async () => {
  let calls = 0;
  const sheets = { spreadsheets: { values: {
    batchGet: async () => { calls += 1; },
    batchUpdate: async () => { calls += 1; }
  } } };

  await assert.rejects(
    replaceSheetSnapshotsAtomically({
      sheets,
      spreadsheetId: 'book',
      snapshots: [{ sheetName: 'Payments', columnCount: 2, values: [['a', 'b', 'too-wide']] }]
    }),
    /columnCount/
  );
  assert.equal(calls, 0);
});

test('a failed batch leaves both previously published snapshots intact', async () => {
  const state = {
    payments: [['old-payment-header'], ['old-payment']],
    sales: [['old-sales-header'], ['old-sale']]
  };
  let batchAttempts = 0;
  let sequentialWrites = 0;
  const sheets = { spreadsheets: { values: {
    batchGet: async () => ({ data: { valueRanges: [
      { values: structuredClone(state.payments) },
      { values: structuredClone(state.sales) }
    ] } }),
    batchUpdate: async () => { batchAttempts += 1; throw new Error('injected batch failure'); },
    clear: async () => { sequentialWrites += 1; },
    update: async () => { sequentialWrites += 1; }
  } } };

  await assert.rejects(
    replaceSheetSnapshotsAtomically({
      sheets,
      spreadsheetId: 'book',
      snapshots: [
        { sheetName: 'Payments', columnCount: 2, values: [['new-h', 'new-h2'], ['new', 1]] },
        { sheetName: 'Sales', columnCount: 2, values: [['new-s', 'new-s2'], ['new-sale', 2]] }
      ]
    }),
    /injected batch failure/
  );

  assert.deepEqual(state.payments, [['old-payment-header'], ['old-payment']]);
  assert.deepEqual(state.sales, [['old-sales-header'], ['old-sale']]);
  assert.equal(batchAttempts, 1);
  assert.equal(sequentialWrites, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { recordVerifiedPaymentSnapshot } from '../lib/payment-sync-metadata.js';

test('verified payment metadata reflects the current snapshot before success time advances', async () => {
  const state = [
    ['payments_last_success_utc', 'old'],
    ['payments_last_rows', '1027'],
    ['payments_last_debit_total', '7533362.7']
  ];
  const writes = [];
  const sheets = { spreadsheets: { values: {
    get: async () => ({ data: { values: state } }),
    update: async ({ range, requestBody }) => {
      writes.push(range);
      state[Number(range.slice(range.lastIndexOf('B') + 1)) - 1][1] = requestBody.values[0][0];
    }
  } } };

  await recordVerifiedPaymentSnapshot({
    sheets,
    spreadsheetId: 'sheet-id',
    metrics: { rows: 35, debitTotal: 244033 },
    successUtc: '2026-10-02T05:17:08.452Z'
  });

  assert.deepEqual(state, [
    ['payments_last_success_utc', '2026-10-02T05:17:08.452Z'],
    ['payments_last_rows', '35'],
    ['payments_last_debit_total', '244033']
  ]);
  assert.deepEqual(writes, [
    "'__vercel_control'!B2",
    "'__vercel_control'!B3",
    "'__vercel_control'!B1"
  ]);
});

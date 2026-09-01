import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionReconciliationAuditAppender } from '../lib/decision-reconciliation-audit-sheet.js';

test('sheet audit appender writes one append-only row to bounded audit columns', async () => {
  const calls = [];
  const sheets = {
    spreadsheets: {
      values: {
        append: async (input) => { calls.push(input); return { data: {} }; }
      }
    }
  };

  const appendRow = createDecisionReconciliationAuditAppender({
    sheets,
    spreadsheetId: 'sheet-1',
    sheetName: 'Rule Engine Audit'
  });

  await appendRow(['2026-09-01T10:30:00.000Z', 'balances', 'dry-run', 4, 4, 0, false, 16, 'OK']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].spreadsheetId, 'sheet-1');
  assert.equal(calls[0].range, "'Rule Engine Audit'!A:I");
  assert.equal(calls[0].valueInputOption, 'RAW');
  assert.equal(calls[0].insertDataOption, 'INSERT_ROWS');
  assert.deepEqual(calls[0].requestBody.values, [[
    '2026-09-01T10:30:00.000Z', 'balances', 'dry-run', 4, 4, 0, false, 16, 'OK'
  ]]);
});

test('sheet audit appender rejects rows wider than audit schema', async () => {
  const sheets = { spreadsheets: { values: { append: async () => ({ data: {} }) } } };
  const appendRow = createDecisionReconciliationAuditAppender({ sheets, spreadsheetId: 'sheet-1' });

  await assert.rejects(() => appendRow(new Array(10).fill('x')), /exactly 9 columns/);
});

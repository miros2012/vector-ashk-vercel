import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionSheetAdapter } from '../lib/decision-sheet-adapter.js';

function activeDecisionRow() {
  const row = Array(22).fill('');
  row[0] = 'DEC-CRIT-DUE';
  row[9] = 'Активно';
  row[10] = 'Не начато';
  row[12] = 1179607.47;
  row[20] = 'Не проверено';
  return row;
}

test('adapter commits decision state and history event in one Sheets batchUpdate', async () => {
  const batchUpdates = [];
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async () => ({
          data: {
            valueRanges: [
              { values: [activeDecisionRow()] },
              { values: [['EVT-1'], ['EVT-2'], ['EVT-3']] }
            ]
          }
        }),
        batchUpdate: async (request) => { batchUpdates.push(request); return { data: {} }; }
      }
    }
  };
  const adapter = createDecisionSheetAdapter({
    sheets,
    spreadsheetId: 'sheet-1',
    eventId: () => 'EVT-NEW'
  });

  const current = await adapter.getDecision('DEC-CRIT-DUE');
  await adapter.writeDecision('DEC-CRIT-DUE', {
    ...current,
    executionStatus: 'В работе',
    startedAt: '2026-08-31T15:56:00.000Z'
  });
  await adapter.appendEvent({
    ruleId: 'DEC-CRIT-DUE',
    type: 'Взято в работу',
    at: '2026-08-31T15:56:00.000Z',
    before: 'Не начато',
    after: 'В работе',
    actor: 'Ответственный за финансы',
    plannedEffect: 1179607.47,
    actualEffect: null,
    evidence: '',
    comment: ''
  });

  assert.equal(batchUpdates.length, 1);
  const request = batchUpdates[0];
  assert.equal(request.spreadsheetId, 'sheet-1');
  assert.equal(request.requestBody.valueInputOption, 'USER_ENTERED');
  assert.deepEqual(request.requestBody.data.map((item) => item.range), [
    "'Решения'!K2",
    "'Решения'!N2",
    "'Решения'!R2:V2",
    "'История решений'!A5:K5"
  ]);
  assert.equal(request.requestBody.data[3].values[0][0], 'EVT-NEW');
});

test('adapter returns null for unknown rule without writing', async () => {
  let writes = 0;
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async () => ({ data: { valueRanges: [{ values: [activeDecisionRow()] }, { values: [] }] } }),
        batchUpdate: async () => { writes += 1; }
      }
    }
  };
  const adapter = createDecisionSheetAdapter({ sheets, spreadsheetId: 'sheet-1', eventId: () => 'EVT' });
  const found = await adapter.getDecision('UNKNOWN');
  assert.equal(found, null);
  assert.equal(writes, 0);
});

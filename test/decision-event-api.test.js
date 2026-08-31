import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionEventApi } from '../lib/decision-event-api.js';

function activeDecisionRow() {
  const row = Array(22).fill('');
  row[0] = 'DEC-CRIT-DUE';
  row[9] = 'Активно';
  row[10] = 'Не начато';
  row[12] = 1179607.47;
  row[20] = 'Не проверено';
  return row;
}

function responseRecorder() {
  return {
    code: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('composed API starts active decision and persists one atomic Sheets batch', async () => {
  const writes = [];
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async () => ({
          data: { valueRanges: [{ values: [activeDecisionRow()] }, { values: [['EVT-OLD']] }] }
        }),
        batchUpdate: async (request) => { writes.push(request); return { data: {} }; }
      }
    }
  };
  const handler = createDecisionEventApi({
    sheets,
    spreadsheetId: 'sheet-1',
    configuredKey: 'secret',
    now: () => new Date('2026-08-31T15:56:00.000Z'),
    eventId: () => 'EVT-NEW'
  });
  const req = {
    method: 'POST',
    headers: { 'x-vector-key': 'secret' },
    body: { ruleId: 'DEC-CRIT-DUE', action: 'start', actor: 'Ответственный за финансы' }
  };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.code, 200);
  assert.equal(res.body.executionStatus, 'В работе');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].requestBody.data.at(-1).range, "'История решений'!A3:K3");
});

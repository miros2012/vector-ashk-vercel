import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionRequestSheetAdapter } from '../lib/owner-action-request-sheet-adapter.js';

function fakeSheets(controlRow = []) {
  const reads = [];
  const writes = [];
  return {
    reads,
    writes,
    sheets: { spreadsheets: { values: {
      batchGet: async (args) => { reads.push(args); return { data:{ valueRanges:[{values:[controlRow]}] } }; },
      batchUpdate: async (args) => { writes.push(args); return {data:{}}; }
    } } } }
  };
}

test('readControl maps only A:L from hidden control row', async () => {
  const f = fakeSheets(['DEC-1','Не начато','Не проверено','В работу','результат','ссылка','125','','','', '', '']);
  const adapter = createOwnerActionRequestSheetAdapter({ sheets:f.sheets, spreadsheetId:'sheet' });
  const control = await adapter.readControl();
  assert.deepEqual(f.reads[0].ranges, ["'Owner Action Control'!A2:L2"]);
  assert.equal(control.ruleId, 'DEC-1');
  assert.equal(control.requestedAction, 'В работу');
  assert.equal(control.actualEffect, 125);
});

test('claim writes transport columns H/J/K/L only', async () => {
  const f = fakeSheets();
  const adapter = createOwnerActionRequestSheetAdapter({ sheets:f.sheets, spreadsheetId:'sheet' });
  await adapter.claimRequest('req-1', new Date('2026-09-01T13:45:00Z'));
  const data = f.writes[0].requestBody.data;
  assert.deepEqual(data.map(x=>x.range), ["'Owner Action Control'!H2", "'Owner Action Control'!J2:L2"]);
  assert.deepEqual(data[0].values, [['req-1']]);
  assert.deepEqual(data[1].values, [['SENT','', '2026-09-01T13:45:00.000Z']]);
});

test('success writes processed id and success transport state without touching inputs', async () => {
  const f = fakeSheets();
  const adapter = createOwnerActionRequestSheetAdapter({ sheets:f.sheets, spreadsheetId:'sheet' });
  await adapter.markSuccess('req-1', {executionStatus:'В работе'}, new Date('2026-09-01T13:46:00Z'));
  const data = f.writes[0].requestBody.data;
  assert.deepEqual(data.map(x=>x.range), ["'Owner Action Control'!I2:L2"]);
  assert.deepEqual(data[0].values, [['req-1','SUCCESS','', '2026-09-01T13:46:00.000Z']]);
});

test('error is bounded and writes only transport state', async () => {
  const f = fakeSheets();
  const adapter = createOwnerActionRequestSheetAdapter({ sheets:f.sheets, spreadsheetId:'sheet' });
  await adapter.markError('req-1', 'x'.repeat(1000), new Date('2026-09-01T13:47:00Z'));
  const data = f.writes[0].requestBody.data;
  assert.deepEqual(data.map(x=>x.range), ["'Owner Action Control'!H2", "'Owner Action Control'!J2:L2"]);
  assert.equal(data[1].values[0][0], 'ERROR');
  assert.equal(data[1].values[0][1].length <= 300, true);
});

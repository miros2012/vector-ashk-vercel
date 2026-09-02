import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionControlSheetAdapter } from '../lib/owner-action-control-sheet-adapter.js';

test('reads the bounded control row with unformatted values', async () => {
  const calls = [];
  const sheets = { spreadsheets: { values: {
    async get(args) {
      calls.push(args);
      return { data: { values: [[
        'DEC-1','Не начато','Не проверено','В работу','Проверить деньги','ссылка',125000,'','','','',''
      ]] } };
    }
  } } };
  const adapter = createOwnerActionControlSheetAdapter({ sheets, spreadsheetId: 'sheet-1' });

  const result = await adapter.readControl();

  assert.deepEqual(calls, [{
    spreadsheetId: 'sheet-1',
    range: "'Owner Action Control'!A2:L2",
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);
  assert.equal(result.ruleId, 'DEC-1');
  assert.equal(result.requestedAction, 'В работу');
  assert.equal(result.actualEffect, 125000);
  assert.equal(result.currentRequestId, '');
});

test('appends the complete A:M transport contract', async () => {
  const calls = [];
  const sheets = { spreadsheets: { values: {
    async append(args) { calls.push(args); return { data: {} }; }
  } } };
  const adapter = createOwnerActionControlSheetAdapter({ sheets, spreadsheetId: 'sheet-1' });

  await adapter.appendCommand({
    requestId:'req-1', ruleId:'DEC-1', action:'В работу', expectedExecutionStatus:'Не начато',
    actor:'Собственник', result:'', verificationStatus:'', actualEffect:null, evidence:'',
    commandStatus:'READY', response:'', createdAt:'2026-09-02T06:00:00.000Z', processedAt:''
  });

  assert.deepEqual(calls, [{
    spreadsheetId: 'sheet-1',
    range: "'Owner Action Queue'!A2:M200",
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[
      'req-1','DEC-1','В работу','Не начато','Собственник','','','','','READY','',
      '2026-09-02T06:00:00.000Z',''
    ]] }
  }]);
});

test('writes transport state without touching control formulas A:G', async () => {
  const calls = [];
  const sheets = { spreadsheets: { values: {
    async update(args) { calls.push(args); return { data: {} }; }
  } } };
  const adapter = createOwnerActionControlSheetAdapter({ sheets, spreadsheetId: 'sheet-1' });

  await adapter.setControlState({
    currentRequestId:'req-1', processedRequestId:'', transportStatus:'READY', lastError:'',
    updatedAt:'2026-09-02T06:00:00.000Z'
  });

  assert.equal(calls[0].range, "'Owner Action Control'!H2:L2");
  assert.deepEqual(calls[0].requestBody.values, [['req-1','','READY','','2026-09-02T06:00:00.000Z']]);
});

test('clears only dashboard input cells after successful processing', async () => {
  const calls = [];
  const sheets = { spreadsheets: { values: {
    async clear(args) { calls.push(args); return { data: {} }; }
  } } };
  const adapter = createOwnerActionControlSheetAdapter({ sheets, spreadsheetId: 'sheet-1' });

  await adapter.clearDashboardInputs();

  assert.deepEqual(calls, [{ spreadsheetId:'sheet-1', range:"'Панель собственника'!O54:O57", requestBody:{} }]);
});

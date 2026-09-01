import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionSheetAdapter } from '../lib/owner-action-sheet-adapter.js';

test('reads bounded decisions range and returns normalized top owner action', async () => {
  const calls = [];
  const sheets = { spreadsheets: { values: { batchGet: async (args) => {
    calls.push(args);
    return { data: { valueRanges: [{ values: [[
      'DEC-1','Критический платёж','Платёж близко','Срок наступает','Провести платёж','Проверить резерв','Собственник',46268,'Критический','Активно','Не начато','Открыто',1261785.405,'','Обязательства','ROYALTY-2026-08',1,'','','','Не проверено',''
    ]] }] } };
  } } } };
  const adapter = createOwnerActionSheetAdapter({ sheets, spreadsheetId:'sheet' });
  const view = await adapter.readOwnerAction();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ranges, ["'Решения'!A2:V200"]);
  assert.equal(calls[0].valueRenderOption, 'UNFORMATTED_VALUE');
  assert.equal(view.top.ruleId, 'DEC-1');
  assert.equal(view.top.deadline, '2026-09-03');
  assert.equal(view.top.plannedEffect, 1261785.405);
  assert.deepEqual(view.top.allowedActions, ['start']);
  assert.equal('rank' in view.top, false);
});

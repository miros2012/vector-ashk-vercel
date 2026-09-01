import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionSheetAdapter } from '../lib/owner-action-sheet-adapter.js';

function row(values = {}) {
  const result = Array(22).fill('');
  result[0] = values.ruleId || '';
  result[1] = values.title || '';
  result[2] = values.deviation || '';
  result[4] = values.recommendation || '';
  result[5] = values.task || '';
  result[6] = values.assignee || '';
  result[7] = values.deadline ?? '';
  result[8] = values.priority || '';
  result[9] = values.ruleStatus || '';
  result[10] = values.executionStatus || '';
  result[12] = values.plannedEffect ?? '';
  result[13] = values.actualEffect ?? '';
  result[15] = values.linkedObject || '';
  result[16] = values.rank ?? '';
  result[19] = values.lastResult || '';
  result[20] = values.verificationStatus || '';
  result[21] = values.lastChecked || '';
  return result;
}

test('reads bounded decision range and returns normalized owner action view', async () => {
  const requests = [];
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async (request) => {
          requests.push(request);
          return { data: { valueRanges: [{ values: [
            row({ ruleId:'DEC-B', title:'B', ruleStatus:'Активно', executionStatus:'В работе', verificationStatus:'Не проверено', rank:2 }),
            row({ ruleId:'DEC-A', title:'A', deviation:'Почему', recommendation:'Сделать', task:'Задача', assignee:'Собственник', deadline:46268, priority:'Критический', ruleStatus:'Активно', executionStatus:'Не начато', plannedEffect:100000, linkedObject:'OBJ-1', rank:1, lastResult:'', verificationStatus:'Не проверено', lastChecked:'2026-09-01T10:00:00Z' })
          ] }] } };
        }
      }
    }
  };

  const adapter = createOwnerActionSheetAdapter({ sheets, spreadsheetId:'sheet-1' });
  const result = await adapter.readOwnerAction();

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].ranges, ["'Решения'!A2:V200"]);
  assert.equal(requests[0].valueRenderOption, 'UNFORMATTED_VALUE');
  assert.equal(result.top.ruleId, 'DEC-A');
  assert.equal(result.top.deadline, '2026-09-03');
  assert.equal(result.top.plannedEffect, 100000);
  assert.deepEqual(result.top.allowedActions, ['start']);
  assert.equal(result.activeCount, 2);
  assert.equal('rank' in result.top, false);
  assert.equal('_row' in result.top, false);
});

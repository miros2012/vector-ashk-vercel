import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionSheetAdapter } from '../lib/owner-action-sheet-adapter.js';

test('reads bounded decision range with unformatted values and returns normalized top action', async () => {
  const calls = [];
  const sheets = {
    spreadsheets: {
      values: {
        async get(args) {
          calls.push(args);
          return {
            data: {
              values: [
                [
                  'DEC-1','Критическая оплата через 2 дня','Есть обязательство','Срок близко','Подготовить оплату','Проверить фонд','Собственник',46268,'Критический','Активно','Не начато','Открыто',1261785.405,'','Обязательства','ROYALTY-2026-08',1,'','','','Не проверено',''
                ],
                [
                  'DEC-2','Другая задача','Отклонение','Причина','Решение','Задача','Финансы',46269,'Высокий','Активно','В работе','Открыто',857000,'','Источник','OBJ-2',2,'2026-09-01T10:00:00Z','','','Не проверено',''
                ]
              ]
            }
          };
        }
      }
    }
  };

  const adapter = createOwnerActionSheetAdapter({ sheets, spreadsheetId: 'sheet-1' });
  const result = await adapter.readOwnerAction();

  assert.deepEqual(calls, [{
    spreadsheetId: 'sheet-1',
    range: "'Решения'!A2:V200",
    valueRenderOption: 'UNFORMATTED_VALUE'
  }]);
  assert.equal(result.activeCount, 2);
  assert.equal(result.top.ruleId, 'DEC-1');
  assert.equal(result.top.title, 'Критическая оплата через 2 дня');
  assert.equal(result.top.plannedEffect, 1261785.405);
  assert.equal(result.top.linkedObject, 'ROYALTY-2026-08');
  assert.deepEqual(result.top.allowedActions, ['start']);
  assert.equal('rank' in result.top, false);
});

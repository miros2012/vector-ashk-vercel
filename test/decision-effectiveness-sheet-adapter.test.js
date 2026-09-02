import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionEffectivenessSheetAdapter } from '../lib/decision-effectiveness-sheet-adapter.js';

test('reads bounded decisions and history ranges and returns effectiveness metrics', async () => {
  const calls = [];
  const sheets = {
    spreadsheets: {
      values: {
        async batchGet(args) {
          calls.push(args);
          return { data: { valueRanges: [
            { values: [
              ['A','','','','','','','','','Активно','Готово','',100,80,'','',1,'','','','Подтверждено',''],
              ['B','','','','','','','','','Активно','В работе','',200,'','','',2,'','','','Не проверено','']
            ] },
            { values: [
              ['A0','A','Инициализация','2026-09-01T10:00:00Z','','','','100','','',''],
              ['A1','A','Взято в работу','2026-09-01T11:00:00Z','','','','100','','',''],
              ['A2','A','Завершено','2026-09-01T12:00:00Z','','','','100','','',''],
              ['A3','A','Проверено','2026-09-01T13:00:00Z','','','','100',80,'',''],
              ['B0','B','Инициализация','2026-09-01T10:00:00Z','','','','200','','',''],
              ['B1','B','Взято в работу','2026-09-01T12:00:00Z','','','','200','','','']
            ] }
          ] } };
        }
      }
    }
  };

  const adapter = createDecisionEffectivenessSheetAdapter({ sheets, spreadsheetId:'sheet-1' });
  const metrics = await adapter.readEffectiveness();

  assert.deepEqual(calls, [{
    spreadsheetId:'sheet-1',
    ranges:["'Решения'!A2:V200", "'История решений'!A2:K1000"],
    valueRenderOption:'UNFORMATTED_VALUE'
  }]);
  assert.equal(metrics.recommendationCount, 2);
  assert.equal(metrics.startedCount, 2);
  assert.equal(metrics.completedCount, 1);
  assert.equal(metrics.verifiedCount, 1);
  assert.equal(metrics.totalConfirmedEffect, 80);
  assert.equal(metrics.averageTimeToStartHours, 1.5);
});

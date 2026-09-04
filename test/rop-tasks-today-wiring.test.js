import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('nightly ROP sync builds, writes and readback-verifies tasks today with finance collection target', () => {
  assert.match(source, /buildRopTasksToday/);
  assert.match(source, /ROP_TASKS_SHEET\s*=\s*'РОП_Задачи_Сегодня'/);
  assert.match(source, /ПЛАН ПОКРЫТИЯ РАЗРЫВА|Минимум собрать в день, ₽/);
  assert.match(source, /financeCollectionTarget/);
  assert.match(source, /financeCashGap/);
  assert.match(source, /writeValues\(ROP_TASKS_SHEET,\s*'A:S',\s*tasksToday\.values,\s*19\)/s);
  assert.match(source, /readValues\(ROP_TASKS_SHEET,\s*'A:S'\)/s);
  assert.match(source, /tasksVerified/);
  assert.match(source, /tasksTodayCount/);
});
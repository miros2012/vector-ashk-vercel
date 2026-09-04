import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('nightly ROP sync builds tasks, reads bounded Q:X formulas, then builds the debtor queue', () => {
  assert.match(source, /buildRopTasksToday/);
  assert.match(source, /ROP_TASKS_SHEET\s*=\s*'РОП_Задачи_Сегодня'/);
  assert.match(source, /writeValues\(ROP_TASKS_SHEET,\s*'A:P',\s*tasksToday\.values,\s*16\)/s);
  assert.match(source, /const tasksFinanceRange = `A1:X\$\{tasksToday\.values\.length\}`/);
  assert.match(source, /readValues\(ROP_TASKS_SHEET,\s*tasksFinanceRange\)/s);
  assert.match(source, /taskValues:\s*tasksWithFinanceTargets/s);
  assert.match(source, /tasksVerified/);
  assert.match(source, /tasksTodayCount/);

  const persistStart = source.indexOf('async function persistRopOutputs');
  const taskWrite = source.indexOf("writeValues(ROP_TASKS_SHEET, 'A:P'", persistStart);
  const targetRange = source.indexOf('const tasksFinanceRange =', taskWrite);
  const targetRead = source.indexOf('readValues(ROP_TASKS_SHEET, tasksFinanceRange)', targetRange);
  const debtorBuild = source.indexOf('const debtorPriority = buildRopDebtorPriority', targetRead);
  assert.ok(
    persistStart >= 0
    && taskWrite > persistStart
    && targetRange > taskWrite
    && targetRead > targetRange
    && debtorBuild > targetRead
  );
});

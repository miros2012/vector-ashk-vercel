import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nightly = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('nightly ROP hook fetches details only for payments missing from current contract snapshot', () => {
  assert.match(nightly, /fallbackStudentIds/);
  assert.match(nightly, /receivablesSource\.fetchStudent/);
  assert.match(nightly, /fallbackStudents/);
  assert.match(nightly, /STUDENT_NOT_IN_CURRENT_SNAPSHOT/);
  assert.match(nightly, /buildRopDailyControlWorkbook\([\s\S]*fallbackStudents/);
});

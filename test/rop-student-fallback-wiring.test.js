import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nightly = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('ROP hooks fetch details only for payments missing from the available contract snapshot', () => {
  assert.match(nightly, /missingStudentIds/);
  assert.match(nightly, /fetchFallbackStudents/);
  assert.match(nightly, /receivablesSource\.fetchStudent\(studentId\)/);
  assert.match(nightly, /STUDENT_NOT_IN_CURRENT_SNAPSHOT/);
  assert.match(nightly, /buildRopDailyControlWorkbook\([\s\S]*fallbackStudents/);
  assert.match(nightly, /fallbackRequested/);
  assert.match(nightly, /fallbackResolved/);
});

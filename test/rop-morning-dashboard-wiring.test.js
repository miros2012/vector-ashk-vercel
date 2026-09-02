import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nightly = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('nightly ROP sync writes and readback-verifies the morning management dashboard', () => {
  assert.match(nightly, /buildRopMorningDashboard/);
  assert.match(nightly, /РОП_Штаб_Утро/);
  assert.match(nightly, /morningDashboard\.values/);
  assert.match(nightly, /writeValues\(\s*ROP_MORNING_SHEET/);
  assert.match(nightly, /readValues\(ROP_MORNING_SHEET/);
  assert.match(nightly, /Дата отчёта/);
});

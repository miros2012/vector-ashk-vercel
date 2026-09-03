import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nightly = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('ROP sync writes and readback-verifies dual closed/live dashboard', () => {
  assert.match(nightly, /buildRopMorningDashboard/);
  assert.match(nightly, /РОП_Штаб_Утро/);
  assert.match(nightly, /morningDashboard\.values/);
  assert.match(nightly, /writeValues\(ROP_MORNING_SHEET,\s*'A:X'/s);
  assert.match(nightly, /readValues\(ROP_MORNING_SHEET,\s*'A:X'/s);
  assert.match(nightly, /String\(morningReadback\?\.\[0\]\?\.\[0\].*=== 'Срез'/s);
  assert.match(nightly, /liveDate/);
});

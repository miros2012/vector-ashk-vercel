import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'api', 'balances.js'), 'utf8');

test('live balance refresh wires the shared Decision Engine reconciliation stack', () => {
  assert.match(source, /createDecisionShadowSheetAdapter/);
  assert.match(source, /createDecisionStateSynchronizer/);
  assert.match(source, /createDecisionReconciler/);
});

test('decision reconciliation runs only after a successful live mirror, not on cached return path', () => {
  const cacheReturn = source.indexOf("source: 'cached_live'");
  const mirror = source.indexOf('await mirrorToGoogleSheet(normalized, sheets)');
  const reconcile = source.indexOf("trigger: 'balances'");

  assert.ok(cacheReturn >= 0, 'cached balance path must remain present');
  assert.ok(mirror > cacheReturn, 'live mirror must happen after cached early-return block');
  assert.ok(reconcile > mirror, 'decision reconciliation must happen after the live balance mirror');
});

test('balance response includes non-sensitive reconciliation status and catches reconciliation failure', () => {
  assert.match(source, /decisionReconciliation/);
  assert.match(source, /balances-decision-reconciliation:/);
  assert.match(source, /mode:\s*'error'/);
  assert.match(source, /decisionReconciliation\s*[,}]/);
  assert.doesNotMatch(source, /decisionReconciliation[\s\S]{0,400}mismatches/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'decision-reconcile-daily.js');

test('daily reconciliation route wires Google Sheets, shared synchronizer, reconciler, and CRON_SECRET', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /createDecisionShadowSheetAdapter/);
  assert.match(source, /createDecisionStateSynchronizer/);
  assert.match(source, /createDecisionReconciler/);
  assert.match(source, /createDecisionDailyReconciliationHandler/);
  assert.match(source, /process\.env\.CRON_SECRET/);
});

test('daily route keeps backend writes behind the explicit feature flag', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /process\.env\.DECISION_STATE_WRITES_ENABLED\s*===\s*['"]true['"]/);
  assert.match(source, /scopes:\s*\[['"]https:\/\/www\.googleapis\.com\/auth\/spreadsheets['"]\]/);
});

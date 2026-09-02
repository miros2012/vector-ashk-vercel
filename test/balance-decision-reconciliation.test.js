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
  const reconcile = source.indexOf('decisionReconciliation = await reconcileDecisionState(sheets)');

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

test('owner action transport runs after a live mirror and never on the cached balance path', () => {
  const cacheReturn = source.indexOf("source: 'cached_live'");
  const mirror = source.indexOf('await mirrorToGoogleSheet(normalized, sheets)');
  const transport = source.indexOf('ownerActionQueue = await processOwnerActionQueue(sheets)');

  assert.ok(cacheReturn >= 0);
  assert.ok(transport > mirror, 'owner action transport must run only after a live balance mirror');
  assert.ok(transport > cacheReturn, 'cached early return must happen before owner action transport');
});

test('owner action transport failure cannot fail balance refresh or expose command details', () => {
  assert.match(source, /balances-owner-action-queue:/);
  assert.match(source, /failedOwnerActionQueueStatus/);
  assert.match(source, /ownerActionQueue\s*[,}]/);
  assert.doesNotMatch(source, /ownerActionQueue[\s\S]{0,300}(response|evidence|actualEffect)/);
});

test('internal owner action consumer does not depend on an external sync key', () => {
  assert.match(source, /INTERNAL_OWNER_ACTION_KEY/);
  assert.match(source, /VECTOR_SYNC_KEY\s*\|\|\s*process\.env\.TOCHKA_BRIDGE_KEY\s*\|\|\s*INTERNAL_OWNER_ACTION_KEY/);
});

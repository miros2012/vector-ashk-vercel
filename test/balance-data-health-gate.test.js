import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'api', 'balances.js'), 'utf8');

test('ordinary live balance refresh uses full Data Health before Decision Engine or Owner Action', () => {
  const handlerStart = source.indexOf('export default async function handler');
  const handlerSource = source.slice(handlerStart);

  const fetchAt = handlerSource.indexOf('fetchLiveBalances');
  const readinessAt = handlerSource.indexOf('readTochkaWebhookReadiness');
  const candidateAt = handlerSource.indexOf('evaluateCandidateBalanceReadiness');
  const mirrorAt = handlerSource.indexOf('mirrorToGoogleSheet');
  const healthAt = handlerSource.indexOf('readDecisionDataHealth');
  const healthGuardAt = handlerSource.indexOf('if (!dataHealth.ok)', healthAt);
  const reconcileAt = handlerSource.indexOf('reconcileDecisionState');
  const ownerActionAt = handlerSource.indexOf('processOwnerActionQueue');

  assert.ok(handlerStart >= 0, 'default balances handler must exist');
  assert.ok(fetchAt >= 0, 'ordinary refresh must fetch a candidate balance');
  assert.ok(readinessAt > fetchAt, 'operation readiness must be checked after fetching candidate balance');
  assert.ok(candidateAt > readinessAt, 'candidate skew gate must follow operation readiness');
  assert.ok(mirrorAt > candidateAt, 'LIVE mirror must advance only after candidate skew gate');
  assert.ok(healthAt > mirrorAt, 'full Data Health must be read after the new LIVE mirror is written');
  assert.ok(healthGuardAt > healthAt, 'Decision Engine must have an explicit fail-closed Data Health guard');
  assert.ok(reconcileAt > healthGuardAt, 'reconciliation must run only after Data Health gate');
  assert.ok(ownerActionAt > healthGuardAt, 'Owner Action transport must run only after Data Health gate');
  assert.match(handlerSource, /mode:\s*'blocked_data_health'/);
});

test('balance decision gate reuses canonical Data Health parser and evaluator', () => {
  assert.match(source, /data-health-snapshot\.js/);
  assert.match(source, /parseDataHealthSnapshot/);
  assert.match(source, /evaluateDataHealthSnapshot/);
  assert.match(source, /async function readDecisionDataHealth/);
  assert.match(source, /`'\$\{DATA_HEALTH_SHEET\}'!A1:H50`/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const balancesSource = await readFile(new URL('../api/balances.js', import.meta.url), 'utf8');
const financeRouteSource = await readFile(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('balances API exports a cron-authenticated mirror-only refresh path', () => {
  assert.match(balancesSource, /export\s+async\s+function\s+refreshBalancesMirrorOnly/);

  const start = balancesSource.indexOf('export async function refreshBalancesMirrorOnly');
  const end = balancesSource.indexOf('\nexport async function refreshBalancesFromTochkaWebhook', start);
  const mirrorOnlySource = balancesSource.slice(start, end > start ? end : undefined);
  assert.match(mirrorOnlySource, /readMirrorStatus/);
  assert.match(mirrorOnlySource, /fetchLiveBalances/);
  assert.match(mirrorOnlySource, /mirrorToGoogleSheet/);
  assert.doesNotMatch(mirrorOnlySource, /reconcileDecisionState/);
  assert.doesNotMatch(mirrorOnlySource, /processOwnerActionQueue/);
});

test('mirror-only refresh validates the fetched balance against operation freshness before advancing live marker', () => {
  const start = balancesSource.indexOf('export async function refreshBalancesMirrorOnly');
  const end = balancesSource.indexOf('\nexport async function refreshBalancesFromTochkaWebhook', start);
  const mirrorOnlySource = balancesSource.slice(start, end > start ? end : undefined);

  const statusAt = mirrorOnlySource.indexOf('readMirrorStatus');
  const fetchAt = mirrorOnlySource.indexOf('fetchLiveBalances');
  const readinessAt = mirrorOnlySource.indexOf('readTochkaWebhookReadiness');
  const candidateGateAt = mirrorOnlySource.indexOf('evaluateCandidateBalanceReadiness');
  const mirrorAt = mirrorOnlySource.indexOf('mirrorToGoogleSheet');

  assert.ok(statusAt >= 0, 'mirror-only path must check whether the current mirror is already fresh');
  assert.ok(fetchAt > statusAt, 'stale mirror must fetch the candidate live balance');
  assert.ok(readinessAt > fetchAt, 'operation readiness must be evaluated after fetching the candidate');
  assert.ok(candidateGateAt > readinessAt, 'candidate balance skew must be checked after operation readiness');
  assert.ok(mirrorAt > candidateGateAt, 'live marker must advance only after candidate skew check');
  assert.match(mirrorOnlySource, /if \(!readiness\.mirrorReady\)/);
  assert.match(mirrorOnlySource, /if \(!candidateReadiness\.ok\)/);
  assert.match(mirrorOnlySource, /status\(409\).*candidate balance is ahead of operation journal/s);
});

test('finance route wires the mirror-only balance refresh into nightly and intraday orchestrators', () => {
  assert.match(financeRouteSource, /import\s+\{\s*refreshBalancesMirrorOnly\s*\}\s+from\s+'\.\/balances\.js'/);
  const balanceBindings = financeRouteSource.match(/runBalances:\s*refreshBalancesMirrorOnly/g) || [];
  assert.equal(balanceBindings.length, 2);
});

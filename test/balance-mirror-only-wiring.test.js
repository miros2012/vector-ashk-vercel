import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const balancesSource = await readFile(new URL('../api/balances.js', import.meta.url), 'utf8');
const financeRouteSource = await readFile(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');

test('balances API exports a cron-authenticated mirror-only refresh path', () => {
  assert.match(balancesSource, /export\s+async\s+function\s+refreshBalancesMirrorOnly/);
  assert.match(balancesSource, /function\s+ensureBalanceMirror|async\s+function\s+ensureBalanceMirror/);

  const start = balancesSource.indexOf('export async function refreshBalancesMirrorOnly');
  const end = balancesSource.indexOf('\nexport async function refreshBalancesFromTochkaWebhook', start);
  const mirrorOnlySource = balancesSource.slice(start, end > start ? end : undefined);
  assert.match(mirrorOnlySource, /ensureBalanceMirror/);
  assert.doesNotMatch(mirrorOnlySource, /reconcileDecisionState/);
  assert.doesNotMatch(mirrorOnlySource, /processOwnerActionQueue/);
});

test('mirror-only balance refresh checks fresh Tochka operation detail before advancing the live balance marker', () => {
  const start = balancesSource.indexOf('export async function refreshBalancesMirrorOnly');
  const end = balancesSource.indexOf('\nexport async function refreshBalancesFromTochkaWebhook', start);
  const mirrorOnlySource = balancesSource.slice(start, end > start ? end : undefined);

  const readinessAt = mirrorOnlySource.indexOf('readTochkaWebhookReadiness');
  const gateAt = mirrorOnlySource.indexOf('!readiness.mirrorReady');
  const mirrorAt = mirrorOnlySource.indexOf('ensureBalanceMirror');

  assert.ok(readinessAt >= 0, 'mirror-only path must read Tochka operation readiness');
  assert.ok(gateAt > readinessAt, 'mirror-only path must fail closed when operation detail is stale');
  assert.ok(mirrorAt > gateAt, 'balance mirror must run only after the operation-readiness gate');
});

test('finance route wires the mirror-only balance refresh into nightly and intraday orchestrators', () => {
  assert.match(financeRouteSource, /import\s+\{\s*refreshBalancesMirrorOnly\s*\}\s+from\s+'\.\/balances\.js'/);
  const balanceBindings = financeRouteSource.match(/runBalances:\s*refreshBalancesMirrorOnly/g) || [];
  assert.equal(balanceBindings.length, 2);
});

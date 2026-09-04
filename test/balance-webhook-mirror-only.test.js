import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/balances.js', import.meta.url), 'utf8');

test('Tochka webhook refresh uses a force-live mirror-only path', () => {
  assert.match(source, /export\s+async\s+function\s+refreshBalancesFromTochkaWebhook/);

  const start = source.indexOf('export async function refreshBalancesFromTochkaWebhook');
  const end = source.indexOf('\nexport default async function handler', start);
  const webhookSource = source.slice(start, end > start ? end : undefined);

  assert.match(webhookSource, /fetchLiveBalances/);
  assert.match(webhookSource, /mirrorToGoogleSheet/);
  assert.doesNotMatch(webhookSource, /reconcileDecisionState/);
  assert.doesNotMatch(webhookSource, /processOwnerActionQueue/);
});

test('balances POST delegates Tochka webhook trigger before decision reconciliation', () => {
  assert.match(source, /x-vector-refresh/);
  assert.match(source, /tochka-webhook/);
  assert.match(source, /return\s+refreshBalancesFromTochkaWebhook\(req,\s*res\)/);

  const handlerStart = source.indexOf('export default async function handler');
  const handlerSource = source.slice(handlerStart);
  const delegateAt = handlerSource.indexOf('refreshBalancesFromTochkaWebhook');
  const reconcileAt = handlerSource.indexOf('reconcileDecisionState');
  assert.ok(delegateAt >= 0 && reconcileAt >= 0 && delegateAt < reconcileAt);
});

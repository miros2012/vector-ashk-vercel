import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateTochkaWebhookReadiness } from '../lib/tochka-webhook-readiness.js';

const balancesSource = await readFile(new URL('../api/balances.js', import.meta.url), 'utf8');

// Regression: live bank visibility must not depend on accounting classification cadence.
test('webhook readiness separates live balance mirror readiness from accounting readiness', () => {
  const ready = evaluateTochkaWebhookReadiness([
    ['Точка операции', 'последняя загрузка Точка_API', 46269.62, 0.1, 0.25, 2, 'OK'],
    ['Точка → ДДС', 'внешних операций сегодня не дошло', 0, 'OK']
  ]);
  assert.deepEqual(ready, {
    ok: true,
    mirrorReady: true,
    accountingReady: true,
    operationStatus: 'OK',
    missingDdsCount: 0,
    reasons: []
  });

  const blocked = evaluateTochkaWebhookReadiness([
    ['Точка операции', 'последняя загрузка Точка_API', 46269.62, 0.75, 0.25, 2, 'ОШИБКА'],
    ['Точка → ДДС', 'внешних операций сегодня не дошло', 17, 'RISK']
  ]);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.mirrorReady, false);
  assert.equal(blocked.accountingReady, false);
  assert.equal(blocked.operationStatus, 'ОШИБКА');
  assert.equal(blocked.missingDdsCount, 17);
  assert.deepEqual(blocked.reasons, ['operations_not_fresh', 'dds_incomplete']);
});

test('fresh operation journal permits live mirror while incomplete DDS stays fail-closed for decisions', () => {
  const result = evaluateTochkaWebhookReadiness([
    ['Точка операции', 'последняя загрузка Точка_API', 46269.62, 0.1, 0.25, 2, 'OK'],
    ['Точка → ДДС', 'внешних операций сегодня не дошло', 14, 'RISK']
  ]);

  assert.equal(result.mirrorReady, true);
  assert.equal(result.accountingReady, false);
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['dds_incomplete']);
});

test('webhook readiness fails closed when control rows are absent', () => {
  const result = evaluateTochkaWebhookReadiness([]);
  assert.equal(result.ok, false);
  assert.equal(result.mirrorReady, false);
  assert.equal(result.accountingReady, false);
  assert.deepEqual(result.reasons, ['operations_status_missing', 'dds_coverage_missing']);
});

test('Tochka webhook gates live balance mirroring on fresh operation journal, not DDS classification completeness', () => {
  const start = balancesSource.indexOf('export async function refreshBalancesFromTochkaWebhook');
  const end = balancesSource.indexOf('\nexport default async function handler', start);
  const webhookSource = balancesSource.slice(start, end > start ? end : undefined);

  const readinessAt = webhookSource.indexOf('readTochkaWebhookReadiness');
  const fetchAt = webhookSource.indexOf('fetchLiveBalances');
  const mirrorAt = webhookSource.indexOf('mirrorToGoogleSheet');

  assert.ok(readinessAt >= 0, 'webhook must read operation readiness');
  assert.ok(fetchAt > readinessAt, 'operation readiness must be checked before live balance fetch');
  assert.ok(mirrorAt > readinessAt, 'operation readiness must be checked before mirror write');
  assert.match(webhookSource, /if \(!readiness\.mirrorReady\)/);
  assert.match(webhookSource, /status\(409\).*Tochka operation journal not ready for balance mirror/s);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  evaluateTochkaWebhookReadiness,
  evaluateCandidateBalanceReadiness
} from '../lib/tochka-webhook-readiness.js';

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
    operationAgeHours: 0.1,
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
  assert.equal(blocked.operationAgeHours, 0.75);
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
  assert.equal(result.operationAgeHours, null);
  assert.deepEqual(result.reasons, ['operations_status_missing', 'dds_coverage_missing']);
});

test('candidate balance gate blocks a balance snapshot more than 15 minutes newer than operation journal', () => {
  const readiness = evaluateTochkaWebhookReadiness([
    ['Точка операции', 'последняя загрузка Точка_API', 46269.62, 0.5, 0.25, 2, 'OK'],
    ['Точка → ДДС', 'внешних операций сегодня не дошло', 0, 'OK']
  ]);
  const normalized = {
    funds: [
      { dateTime: '2026-09-04T17:50:00.000Z' },
      { dateTime: '2026-09-04T17:49:58.000Z' }
    ]
  };

  const result = evaluateCandidateBalanceReadiness({
    readiness,
    normalized,
    nowMs: Date.parse('2026-09-04T18:00:00.000Z')
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'candidate_balance_ahead_of_operations');
  assert.equal(result.skewMinutes, 20);
});

test('candidate balance gate permits a balance snapshot within the 15 minute operation skew', () => {
  const readiness = evaluateTochkaWebhookReadiness([
    ['Точка операции', 'последняя загрузка Точка_API', 46269.62, 0.25, 0.25, 2, 'OK'],
    ['Точка → ДДС', 'внешних операций сегодня не дошло', 0, 'OK']
  ]);
  const normalized = {
    funds: [{ dateTime: '2026-09-04T17:55:00.000Z' }]
  };

  const result = evaluateCandidateBalanceReadiness({
    readiness,
    normalized,
    nowMs: Date.parse('2026-09-04T18:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  assert.equal(result.skewMinutes, 10);
});

test('candidate balance gate fails closed when operation age or balance timestamp is missing', () => {
  const noOperationAge = evaluateCandidateBalanceReadiness({
    readiness: { mirrorReady: true, operationAgeHours: null },
    normalized: { funds: [{ dateTime: '2026-09-04T17:55:00.000Z' }] },
    nowMs: Date.parse('2026-09-04T18:00:00.000Z')
  });
  assert.equal(noOperationAge.ok, false);
  assert.equal(noOperationAge.reason, 'operation_age_missing');

  const noBalanceTimestamp = evaluateCandidateBalanceReadiness({
    readiness: { mirrorReady: true, operationAgeHours: 0.1 },
    normalized: { funds: [{ dateTime: null }] },
    nowMs: Date.parse('2026-09-04T18:00:00.000Z')
  });
  assert.equal(noBalanceTimestamp.ok, false);
  assert.equal(noBalanceTimestamp.reason, 'candidate_balance_timestamp_missing');
});

test('Tochka webhook validates the fetched balance timestamp against the operation journal before mirror write', () => {
  const start = balancesSource.indexOf('export async function refreshBalancesFromTochkaWebhook');
  const end = balancesSource.indexOf('\nexport default async function handler', start);
  const webhookSource = balancesSource.slice(start, end > start ? end : undefined);

  const fetchAt = webhookSource.indexOf('fetchLiveBalances');
  const readinessAt = webhookSource.indexOf('readTochkaWebhookReadiness');
  const candidateGateAt = webhookSource.indexOf('evaluateCandidateBalanceReadiness');
  const mirrorAt = webhookSource.indexOf('mirrorToGoogleSheet');

  assert.ok(fetchAt >= 0, 'webhook must fetch the candidate live balance');
  assert.ok(readinessAt > fetchAt, 'operation readiness must be evaluated for the fetched candidate balance');
  assert.ok(candidateGateAt > readinessAt, 'candidate balance skew must be checked after operation readiness');
  assert.ok(mirrorAt > candidateGateAt, 'mirror write must happen only after candidate balance skew check');
  assert.match(webhookSource, /if \(!readiness\.mirrorReady\)/);
  assert.match(webhookSource, /if \(!candidateReadiness\.ok\)/);
  assert.match(webhookSource, /status\(409\).*candidate balance is ahead of operation journal/s);
});

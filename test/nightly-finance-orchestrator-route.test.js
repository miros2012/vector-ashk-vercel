import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { financeRouteHarness, response, cronRequest } from './helpers/finance-route-harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'nightly-finance-orchestrator.js');

test('nightly finance route composes HOURS, receivables, decisions, and runtime CRON_SECRET', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /sync-hours\.js/);
  assert.match(source, /ashk-receivables-source\.js/);
  assert.match(source, /receivables-sync-handler\.js/);
  assert.match(source, /АШК_Дебиторка__vercel/);
  assert.match(source, /АШК_Дебиторка_Свод__vercel/);
  assert.match(source, /runReceivables/);
  assert.match(source, /markReceivablesSourceVerified/);
  assert.match(source, /afterSourceVerified/);
  assert.match(source, /refreshRopFromStagingAndPublish/);
  assert.match(source, /decision-reconcile-daily\.js/);
  assert.match(source, /createNightlyFinanceOrchestrator/);
  assert.match(source, /process\.env\.CRON_SECRET/);
});

test('nightly route records separate source and publish attempts with deployment metadata only', async t => {
  const { route, entries, stores, events } = await financeRouteHarness(t);
  const res = response();
  await route.default(cronRequest('30 21 * * *'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(entries.map(entry => [entry.stage, entry.trigger, entry.mode, entry.deploymentSha]), [
    ['receivablesSource', 'cron', 'nightly', 'deployment-sha-test'],
    ['ropPublish', 'cron', 'nightly', 'deployment-sha-test']
  ]);
  assert.equal(stores.length, 1);
  assert.equal(stores[0].spreadsheetId, '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10');
  assert.equal(stores[0].sheets.client, 'sheets');
  assert.equal(entries[0].runId, entries[1].runId);
  for (const entry of entries) assert.deepEqual(Object.keys(entry).sort(), [
    'runId', 'startedAtUtc', 'finishedAtUtc', 'trigger', 'mode', 'stage', 'attempt',
    'result', 'statusCode', 'errorClass', 'retryable', 'retryAfterUtc', 'deploymentSha'
  ].sort());
  const serializedEntries = JSON.stringify(entries);
  assert.doesNotMatch(serializedEntries, /PRIVATE_|route-secret/);
  assert.doesNotMatch(serializedEntries, /"debt"\s*:\s*999/);
  assert.ok(events.indexOf('schema') < events.indexOf('acquire'));
  assert.ok(events.indexOf('acquire') < events.indexOf('tochkaDds'));
  assert.ok(events.indexOf('marker:receivables_last_success_utc') < events.indexOf('ropPublish'));
  assert.equal(events.at(-1), 'release');
});

test('schema verification failure blocks lease and all finance stages', async t => {
  const { route, events } = await financeRouteHarness(t, { schemaOk: false });
  const res = response();
  await route.default(cronRequest('30 21 * * *'), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(events, ['google-authorize', 'google-client', 'store', 'schema']);
});

test('source failure never invokes the separate ROP publication dependency', async t => {
  const { route, events, entries } = await financeRouteHarness(t, { sourceOk: false });
  const res = response();
  await route.default(cronRequest('30 21 * * *'), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.stages.ropPublish?.skipped, true);
  assert.deepEqual(entries.map(entry => entry.stage), ['receivablesSource']);
  assert.equal(events.includes('ropPublish'), false);
  assert.equal(events.includes('marker:receivables_last_success_utc'), false);
});

test('signed recovery-only finance request does no source work when retry state is empty', async t => {
  const { route, events, entries } = await financeRouteHarness(t);
  const res = response();
  await route.default({
    ...cronRequest('0 7 * * *'),
    headers: {
      ...cronRequest('0 7 * * *').headers,
      'x-vector-finance-recovery-only': 'true'
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, mode: 'recovery_idle', stages: {} });
  assert.deepEqual(entries, []);
  assert.deepEqual(events, ['google-authorize', 'google-client', 'store', 'schema', 'acquire', 'release']);
});

test('mid-hour Vercel finance cron is recovery-only without a private routing header', async t => {
  const { route, events, entries } = await financeRouteHarness(t);
  const res = response();
  await route.default(cronRequest('30 4 * * *'), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, mode: 'recovery_idle', stages: {} });
  assert.deepEqual(entries, []);
  assert.deepEqual(events, ['google-authorize', 'google-client', 'store', 'schema', 'acquire', 'release']);
});

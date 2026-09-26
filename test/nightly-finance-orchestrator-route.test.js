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

test('nightly route checkpoints each stage and resumes without repeating completed work', async t => {
  const f = await financeRouteHarness(t);
  let res;
  for(let i=0;i<11;i++) {
    res=response(); await f.route.default(cronRequest('30 21 * * *'),res);
    assert.equal(res.statusCode,i===10?200:202);
    assert.equal(f.cycle.cursor,i<7?i+1:i);
    assert.equal(res.body.complete,i===10);
  }
  assert.equal(f.cycle.status,'COMPLETE');
  assert.equal(f.events.filter(e=>e==='tochkaDds').length,2);
  assert.equal(f.events.filter(e=>e==='balances').length,2);
  assert.equal(f.events.filter(e=>e==='reports').length,2);
  assert.equal(f.stores.length,11);
  assert.doesNotMatch(JSON.stringify(f.cycle),/PRIVATE_|route-secret|"debt"/);
  assert.ok(f.events.indexOf('schema')<f.events.indexOf('acquire'));
  assert.ok(f.events.indexOf('acquire')<f.events.indexOf('tochkaDds'));
  assert.ok(f.events.indexOf('marker:receivables_last_success_utc')<f.events.indexOf('ropPublish'));
  assert.equal(f.events.at(-1),'release');
});

test('schema verification failure blocks lease and all finance stages', async t => {
  const { route, events } = await financeRouteHarness(t, { schemaOk: false });
  const res = response();
  await route.default(cronRequest('30 21 * * *'), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(events, ['google-authorize', 'google-client', 'store', 'schema']);
});

test('source failure preserves cursor and never invokes ROP or decisions', async t => {
  const f=await financeRouteHarness(t,{sourceOk:false});
  let res;
  for(let i=0;i<5;i++){res=response();await f.route.default(cronRequest('30 21 * * *'),res);}
  assert.equal(res.statusCode,503);
  assert.equal(res.body.stage,'receivablesSource');
  assert.equal(f.cycle.cursor,4);
  assert.equal(f.cycle.status,'FAILED');
  assert.equal(f.events.includes('ropPublish'),false);
  assert.equal(f.events.includes('decisions'),false);
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
  assert.deepEqual(res.body, { ok: true, mode: 'recovery_idle', pending:false, complete:false });
  assert.deepEqual(entries, []);
  assert.deepEqual(events, ['google-authorize', 'google-client', 'store', 'schema', 'acquire', 'release']);
});

test('mid-hour Vercel finance cron is recovery-only without a private routing header', async t => {
  const { route, events, entries } = await financeRouteHarness(t);
  const res = response();
  await route.default(cronRequest('30 4 * * *'), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, mode: 'recovery_idle', pending:false, complete:false });
  assert.deepEqual(entries, []);
  assert.deepEqual(events, ['google-authorize', 'google-client', 'store', 'schema', 'acquire', 'release']);
});

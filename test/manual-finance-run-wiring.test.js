import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { financeRouteHarness, response, cronRequest } from './helpers/finance-route-harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'nightly-finance-orchestrator.js');
const vercelPath = path.join(here, '..', 'vercel.json');

test('manual token takes priority over schedule and starts a resumable full cycle', async t => {
  const fixture = await financeRouteHarness(t);
  const req = { ...cronRequest('0 4 * * *'), query: { finance_run_token: 'single-use' } };
  const res = response();
  await fixture.route.default(req, res);
  assert.equal(res.statusCode, 202);
  assert.equal(fixture.cycle.mode,'full');
  assert.equal(fixture.cycle.cursor,1);
  assert.equal(fixture.stores.length, 1);
  assert.equal(fixture.consumed, true);
  assert.ok(fixture.events.indexOf('token') < fixture.events.indexOf('store'));
  const replay = response();
  await fixture.route.default(req, replay);
  assert.equal(replay.statusCode, 403);
  assert.equal(fixture.stores.length, 1);
});

test('cron and manual requests respect the same busy lease and retain consume-before-run token semantics', async t => {
  const fixture = await financeRouteHarness(t, { busy: true });
  const cron = response();
  await fixture.route.default(cronRequest(), cron);
  assert.equal(cron.statusCode, 409);
  const manual = response();
  await fixture.route.default({ method: 'GET', query: { finance_run_token: 'single-use' } }, manual);
  assert.equal(manual.statusCode, 409);
  assert.equal(fixture.consumed, true, 'existing manual contract consumes before runNightly, including conflicts');
  assert.equal(fixture.entries.length, 0);
  assert.equal(fixture.events.some(event => ['hours', 'payments', 'receivablesSource', 'ropPublish'].includes(event)), false);
  assert.equal(fixture.events.includes('release'), false);
});

test('manual payments consumes its token then rejects a busy shared lease without payment work', async t => {
  const fixture = await financeRouteHarness(t, { busy: true });
  const res = response();
  await fixture.route.default({ method: 'GET', query: { finance_run_token: 'single-use', stage: 'payments' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(fixture.consumed, true);
  assert.ok(fixture.events.indexOf('token') < fixture.events.indexOf('acquire'));
  assert.equal(fixture.events.includes('payments'), false);
  assert.equal(fixture.events.includes('release'), false);
});

test('manual payments holds the shared lease through execution and releases it afterward', async t => {
  const fixture = await financeRouteHarness(t);
  const res = response();
  await fixture.route.default({ method: 'GET', query: { finance_run_token: 'single-use', stage: 'payments' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(fixture.events.indexOf('acquire') < fixture.events.indexOf('payments'));
  assert.equal(fixture.events.at(-1), 'release');
  assert.equal(fixture.events.includes('hours'), false);
});

test('manual finance run is handled inside the existing nightly route', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /one-time-finance-run-token\.js/);
  assert.match(source, /manual-finance-run-handler\.js/);
  assert.match(source, /consumeOneTimeFinanceRunToken/);
  assert.match(source, /createManualFinanceRunHandler/);
  assert.match(source, /hasManualFinanceRunToken\(req\)/);

  const manualCheck = source.lastIndexOf('hasManualFinanceRunToken(req)');
  const intradayDispatch = source.indexOf('INTRADAY_SCHEDULES.has');
  assert.ok(manualCheck >= 0 && intradayDispatch >= 0 && manualCheck < intradayDispatch);
});

test('manual run capability does not add a route alongside finance and recovery crons', () => {
  const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  const financeCrons = config.crons.filter(cron => cron.path.split("?")[0] === '/api/nightly-finance-orchestrator');
  assert.equal(Object.keys(config.functions || {}).length, 5);
  assert.equal(financeCrons.length, 37);
  assert.ok(!Object.keys(config.functions || {}).some(path => path.includes('manual')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { financeRouteHarness, response, cronRequest } from './helpers/finance-route-harness.js';

const api = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');
const decisionEventApi = readFileSync(new URL('../api/decision-event.js', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const financePath = '/api/nightly-finance-orchestrator';
const intradaySchedules = Array.from({ length: 12 }, (_, index) => `0 ${index + 4} * * *`);

test('all intraday schedules resume the same lightweight cycle and recovery avoids owner actions', async t => {
  const f = await financeRouteHarness(t);
  for (let i=0;i<intradaySchedules.length;i++) {
    const res=response(); await f.route.default(cronRequest(intradaySchedules[i]),res);
    assert.equal(res.statusCode,i===8?200:202);
    assert.equal(f.cycle.mode,'intraday');
  }
  assert.equal(f.stores.length,12);
  assert.equal(f.events.includes('hours'),false);
  assert.equal(f.events.filter(e=>e==='ownerActionQueue').length,1);
  const before=f.events.filter(e=>e==='ownerActionQueue').length;
  for(let i=0;i<7;i++){const res=response();await f.route.default(cronRequest('30 15 * * *'),res);}
  assert.equal(f.events.filter(e=>e==='ownerActionQueue').length,before);
  assert.equal(f.cycle.status,'COMPLETE');
});

test('source-only callable marks its snapshot without invoking publication', async t => {
  const { route, events, entries } = await financeRouteHarness(t);
  const res = response();
  await route.runReceivablesNow(cronRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.ok(events.includes('marker:receivables_last_success_utc'));
  assert.equal(events.includes('ropPublish'), false);
  assert.equal(entries.length, 0);
  await route.runIntradayRopNow();
  assert.equal(events.at(-1), 'ropPublish');
});

test('same protected finance endpoint has nightly, intraday, and recovery schedules', () => {
  const financeCrons = config.crons.filter((cron) => cron.path === financePath);
  assert.equal(financeCrons.length, 25);
  assert.ok(financeCrons.some((cron) => cron.schedule === '30 21 * * *'));
  for (const schedule of intradaySchedules) {
    assert.ok(financeCrons.some((cron) => cron.schedule === schedule), `missing ${schedule}`);
    const recoverySchedule = schedule.replace(/^0 /, '30 ');
    assert.ok(financeCrons.some((cron) => cron.schedule === recoverySchedule), `missing ${recoverySchedule}`);
  }
});

test('each Hobby-safe intraday schedule selects lightweight payments plus ROP refresh path', () => {
  assert.match(api, /createIntradayRopOrchestrator/);
  assert.match(api, /x-vercel-cron-schedule/i);
  assert.match(api, /INTRADAY_SCHEDULES/);
  assert.match(api, /INTRADAY_SCHEDULES\.has\(schedule\)/);
  assert.match(api, /refreshRopFromStaging/);
});

test('intraday finance continues through canonical Data Health, verified decisions, and existing Owner Action Queue', () => {
  assert.match(api, /processOwnerActionQueue/);
  assert.match(api, /runDataHealth:\s*reconcileDecisions\.dataHealth/);
  assert.match(api, /runDecisions:\s*reconcileDecisions/);
  assert.match(api, /runOwnerActionQueue:\s*runOwnerActionQueueNow/);
  assert.match(decisionEventApi, /export\s+async\s+function\s+processOwnerActionQueue\s*\(/);
});

test('intraday ROP refresh reconstructs debt from the full verified receivables staging sheet', () => {
  assert.match(api, /RECEIVABLES_DETAIL_SHEET/);
  assert.match(api, /receivablesValuesToStudents/);
  assert.match(api, /readValues\(RECEIVABLES_DETAIL_SHEET,\s*'A:N'\)/s);
});

test('receivables source marking and standalone ROP publication remain separate callables', () => {
  assert.match(api, /publishRopNow/);
  assert.match(api, /syncRopSourceThenPublishTarget/);
  assert.match(api, /markReceivablesSourceVerified/);
  assert.match(api, /refreshRopFromStagingAndPublish/);
  assert.doesNotMatch(api, /syncRopDailyControlAndPublish/);
});

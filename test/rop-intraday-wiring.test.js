import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const financePath = '/api/nightly-finance-orchestrator';
const intradaySchedules = Array.from({ length: 12 }, (_, index) => `0 ${index + 4} * * *`);

test('same protected finance endpoint has nightly plus twelve daily intraday Tyumen schedules', () => {
  const financeCrons = config.crons.filter((cron) => cron.path === financePath);
  assert.equal(financeCrons.length, 13);
  assert.ok(financeCrons.some((cron) => cron.schedule === '30 21 * * *'));
  for (const schedule of intradaySchedules) {
    assert.ok(financeCrons.some((cron) => cron.schedule === schedule), `missing ${schedule}`);
  }
});

test('each Hobby-safe intraday schedule selects lightweight payments plus ROP refresh path', () => {
  assert.match(api, /createIntradayRopOrchestrator/);
  assert.match(api, /x-vercel-cron-schedule/i);
  assert.match(api, /INTRADAY_SCHEDULES/);
  assert.match(api, /INTRADAY_SCHEDULES\.has\(schedule\)/);
  assert.match(api, /refreshRopFromStaging/);
});

test('intraday ROP refresh reconstructs debt from the full verified receivables staging sheet', () => {
  assert.match(api, /RECEIVABLES_DETAIL_SHEET/);
  assert.match(api, /receivablesValuesToStudents/);
  assert.match(api, /readValues\(RECEIVABLES_DETAIL_SHEET,\s*'A:N'\)/s);
});

test('every source refresh publishes the standalone ROP dashboard in the same execution', () => {
  assert.match(api, /publishRopNow/);
  assert.match(api, /syncRopSourceThenPublishTarget/);
  assert.match(api, /syncRopDailyControlAndPublish/);
  assert.match(api, /refreshRopFromStagingAndPublish/);
});

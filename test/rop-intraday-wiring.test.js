import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const financePath = '/api/nightly-finance-orchestrator';
const intradaySchedules = Array.from({ length: 12 }, (_, index) => `0 ${index + 4} * * *`);

test('same protected endpoint has nightly plus twelve daily intraday Tyumen schedules', () => {
  assert.equal(config.crons.length, 13);
  assert.ok(config.crons.every((cron) => cron.path === financePath));
  assert.ok(config.crons.some((cron) => cron.schedule === '30 21 * * *'));
  for (const schedule of intradaySchedules) {
    assert.ok(config.crons.some((cron) => cron.schedule === schedule), `missing ${schedule}`);
  }
});

test('each Hobby-safe intraday schedule selects lightweight payments plus ROP refresh path', () => {
  assert.match(api, /createIntradayRopOrchestrator/);
  assert.match(api, /x-vercel-cron-schedule/i);
  assert.match(api, /INTRADAY_SCHEDULES/);
  assert.match(api, /INTRADAY_SCHEDULES\.has\(schedule\)/);
  assert.match(api, /refreshRopFromStaging/);
});

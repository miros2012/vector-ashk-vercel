import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/nightly-finance-orchestrator.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

test('same protected endpoint has nightly and hourly Tyumen cron schedules', () => {
  assert.match(config, /"30 21 \* \* \*"/);
  assert.match(config, /"0 4-15 \* \* \*"/);
  const pathMatches = config.match(/"path": "\/api\/nightly-finance-orchestrator"/g) || [];
  assert.equal(pathMatches.length, 2);
});

test('hourly cron selects lightweight payments plus ROP refresh path', () => {
  assert.match(api, /createIntradayRopOrchestrator/);
  assert.match(api, /x-vercel-cron-schedule/i);
  assert.match(api, /0 4-15 \* \* \*/);
  assert.match(api, /refreshRopFromStaging/);
});

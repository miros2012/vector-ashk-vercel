import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.join(here, '..', 'api', 'nightly-finance-orchestrator.js');
const vercelPath = path.join(here, '..', 'vercel.json');

test('manual finance run is handled inside the existing nightly route', () => {
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /one-time-finance-run-token\.js/);
  assert.match(source, /manual-finance-run-handler\.js/);
  assert.match(source, /finance_run_token/);
  assert.match(source, /consumeOneTimeFinanceRunToken/);
  assert.match(source, /createManualFinanceRunHandler/);

  const manualCheck = source.indexOf('finance_run_token');
  const intradayDispatch = source.indexOf('INTRADAY_SCHEDULES.has');
  assert.ok(manualCheck >= 0 && intradayDispatch >= 0 && manualCheck < intradayDispatch);
});

test('manual run capability does not add a route or alter cron definitions', () => {
  const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  assert.equal(Object.keys(config.functions || {}).length, 5);
  assert.equal(config.crons.length, 14);
  assert.ok(!Object.keys(config.functions || {}).some(path => path.includes('manual')));
});

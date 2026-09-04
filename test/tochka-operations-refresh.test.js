import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/tochka-operations-refresh.js', import.meta.url), 'utf8');
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

test('scheduled operation source refresh is cron-authenticated and calls bridge without balance side effects', () => {
  assert.match(source, /requestBearer\(req\)/);
  assert.match(source, /process\.env\.CRON_SECRET/);
  assert.match(source, /getVercelOidcToken\(\)/);
  assert.match(source, /\$\{base\}\/operations\/refresh/);
  assert.match(source, /method:\s*'POST'/);
  assert.doesNotMatch(source, /\/balances/);
  assert.doesNotMatch(source, /decision/i);
  assert.match(source, /status\(502\).*operations source refresh failed/s);
});

test('Vercel refreshes the operation source before every scheduled finance orchestrator window', () => {
  const crons = vercel.crons || [];
  assert.ok(crons.some((cron) => cron.path === '/api/tochka-operations-refresh' && cron.schedule === '28 21 * * *'));
  assert.ok(crons.some((cron) => cron.path === '/api/tochka-operations-refresh' && cron.schedule === '58 3-14 * * *'));
  assert.ok(crons.some((cron) => cron.path === '/api/nightly-finance-orchestrator' && cron.schedule === '30 21 * * *'));
  assert.ok(crons.some((cron) => cron.path === '/api/nightly-finance-orchestrator' && cron.schedule === '0 4 * * *'));
});

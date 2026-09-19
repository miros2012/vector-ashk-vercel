import test from 'node:test';
import assert from 'node:assert/strict';
import { financeRouteHarness, response } from './helpers/finance-route-harness.js';

test('import and pre-authentication route rejections initialize no Google service or run store', async t => {
  const { route, events, stores } = await financeRouteHarness(t);
  assert.deepEqual(events, []);
  for (const [req, status] of [
    [{ method: 'GET', headers: {} }, 403],
    [{ method: 'GET', headers: { authorization: 'Bearer wrong', 'x-vercel-cron-schedule': '0 4 * * *' } }, 403],
    [{ method: 'POST', headers: { authorization: 'Bearer route-secret' } }, 405],
    [{ method: 'POST', query: { finance_run_token: 'single-use' } }, 405],
    [{ method: 'GET', query: { finance_run_token: 'single-use', stage: 'unsupported' } }, 400]
  ]) {
    const res = response();
    await route.default(req, res);
    assert.equal(res.statusCode, status);
  }
  assert.deepEqual(events, []);
  assert.deepEqual(stores, []);
});

test('production nightly finance entrypoint imports successfully', async () => {
  const previousApiKey = process.env.ASHK_API_KEY;
  process.env.ASHK_API_KEY = 'ci-runtime-import-placeholder';
  try {
    const module = await import('../api/nightly-finance-orchestrator.js');
    assert.equal(typeof module.default, 'function');
  } finally {
    if (previousApiKey === undefined) delete process.env.ASHK_API_KEY;
    else process.env.ASHK_API_KEY = previousApiKey;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualFinanceRunHandler } from '../lib/manual-finance-run-handler.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() {}
  };
}

test('consumes and strips the one-time token before running the existing nightly handler', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async token => {
      events.push(`consume:${token}`);
      return { ok: true, reason: 'consumed' };
    },
    runNightly: async (req, res) => {
      events.push('nightly');
      assert.equal(req.headers.authorization, 'Bearer cron-secret');
      assert.deepEqual(req.query, { source: 'manual' });
      assert.equal(req.url, '/api/nightly-finance-orchestrator?source=manual');
      assert.equal(req.originalUrl, '/api/nightly-finance-orchestrator?source=manual');
      return res.status(200).json({ ok: true });
    }
  });
  const req = {
    method: 'GET',
    headers: { 'user-agent': 'test', authorization: 'Bearer untrusted-caller-value' },
    query: { finance_run_token: 'single-use', source: 'manual' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=single-use&source=manual',
    originalUrl: '/api/nightly-finance-orchestrator?finance_run_token=single-use&source=manual'
  };
  const res = responseRecorder();

  await handler(req, res);

  assert.deepEqual(events, ['consume:single-use', 'nightly']);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(req.query.finance_run_token, 'single-use', 'original request must not be mutated');
  assert.equal(req.headers.authorization, 'Bearer untrusted-caller-value');
  assert.match(req.url, /finance_run_token=single-use/);
});

test('rejects wrong, expired or replayed tokens without invoking finance stages', async () => {
  let runs = 0;
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => ({ ok: false, reason: 'token-not-armed' }),
    runNightly: async () => { runs += 1; }
  });
  const res = responseRecorder();

  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'replayed' }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
  assert.equal(runs, 0);
});

test('rejects non-GET requests before consuming a token', async () => {
  let consumes = 0;
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => { consumes += 1; return { ok: true }; },
    runNightly: async () => {}
  });
  const res = responseRecorder();

  await handler({
    method: 'POST',
    headers: {},
    query: { finance_run_token: 'single-use' }
  }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { ok: false, error: 'Use GET' });
  assert.equal(consumes, 0);
});

test('fails closed when the internal cron secret is not configured', async () => {
  let consumes = 0;
  const handler = createManualFinanceRunHandler({
    cronSecret: '',
    consumeToken: async () => { consumes += 1; return { ok: true }; },
    runNightly: async () => {}
  });
  const res = responseRecorder();

  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'single-use' }
  }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: 'Manual finance run unavailable' });
  assert.equal(consumes, 0);
});

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

test('manual payment exception still releases its acquired finance lease', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => { events.push('consume'); return { ok: true }; },
    runControl: {
      begin: async () => { events.push('acquire'); return { ok: true, runId: 'manual' }; },
      finish: async context => { assert.equal(context.runId, 'manual'); events.push('release'); }
    },
    runNightly: async () => {},
    runPayments: async () => { events.push('payments'); throw new Error('payment failure'); }
  });
  await assert.rejects(handler({ method: 'GET', query: { finance_run_token: 'one', stage: 'payments' } }, responseRecorder()));
  assert.deepEqual(events, ['consume', 'acquire', 'payments', 'release']);
});

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

test('payments stage consumes the token and runs only the payment sync as an authorized POST', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async token => {
      events.push(`consume:${token}`);
      return { ok: true, reason: 'consumed' };
    },
    runNightly: async () => { events.push('nightly'); },
    runPayments: async (req, res) => {
      events.push('payments');
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.authorization, 'Bearer cron-secret');
      assert.deepEqual(req.query, { stage: 'payments' });
      assert.equal(req.url, '/api/nightly-finance-orchestrator?stage=payments');
      return res.status(200).json({ ok: true, stage: 'payments' });
    }
  });
  const req = {
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'single-use', stage: 'payments' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=single-use&stage=payments'
  };
  const res = responseRecorder();

  await handler(req, res);

  assert.deepEqual(events, ['consume:single-use', 'payments']);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, stage: 'payments' });
});

test('payment report probe runs only on the explicit manual payments query', async () => {
  const events = [];
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => ({ ok: true, reason: 'consumed' }),
    runNightly: async () => { events.push('nightly'); },
    runPaymentProbe: async () => {
      events.push('probe');
      return [{ endpoint: '/api/PaymentRecordList', ok: true, status: 200, schema: { rowCount: 1 } }];
    },
    runPayments: async (req, res) => {
      events.push('payments');
      return res.status(200).json({ ok: true });
    }
  });
  const res = responseRecorder();

  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'single-use', stage: 'payments', probe: 'payment-report' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=single-use&stage=payments&probe=payment-report'
  }, res);

  assert.deepEqual(events, ['probe', 'payments']);
  assert.equal(res.statusCode, 200);
});

test('rejects unsupported payment probes before consuming the token', async () => {
  let consumes = 0;
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => { consumes += 1; return { ok: true }; },
    runNightly: async () => {},
    runPayments: async () => {}
  });
  const res = responseRecorder();

  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'single-use', stage: 'payments', probe: 'other' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=single-use&stage=payments&probe=other'
  }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, error: 'Unsupported manual finance probe' });
  assert.equal(consumes, 0);
});

test('rejects unsupported manual stages before consuming the token', async () => {
  let consumes = 0;
  const handler = createManualFinanceRunHandler({
    cronSecret: 'cron-secret',
    consumeToken: async () => { consumes += 1; return { ok: true }; },
    runNightly: async () => {},
    runPayments: async () => {}
  });
  const res = responseRecorder();

  await handler({
    method: 'GET',
    headers: {},
    query: { finance_run_token: 'single-use', stage: 'unknown' },
    url: '/api/nightly-finance-orchestrator?finance_run_token=single-use&stage=unknown'
  }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, error: 'Unsupported manual finance stage' });
  assert.equal(consumes, 0);
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

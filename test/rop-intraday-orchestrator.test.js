import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntradayRopOrchestrator } from '../lib/rop-intraday-orchestrator.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('intraday orchestrator runs payments then ROP refresh only', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: async (req, res) => {
      calls.push(['payments', req.method]);
      return res.status(200).json({ ok: true });
    },
    refreshRop: async () => {
      calls.push(['rop']);
      return { ok: true, liveDate: '2026-09-02' };
    }
  });
  const req = { method: 'GET', headers: { authorization: 'Bearer secret' } };
  const res = responseRecorder();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [['payments', 'POST'], ['rop']]);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.stages.payments.ok, true);
  assert.equal(res.body.stages.rop.ok, true);
});

test('intraday orchestrator fails closed when payment sync fails', async () => {
  let refreshed = false;
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: async (_req, res) => res.status(502).json({ ok: false }),
    refreshRop: async () => { refreshed = true; return { ok: true }; }
  });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(refreshed, false);
});

test('intraday orchestrator refreshes balance mirror after ROP without blocking the ROP update path', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: async (req, res) => {
      calls.push(['payments', req.method]);
      return res.status(200).json({ ok: true });
    },
    refreshRop: async () => {
      calls.push(['rop']);
      return { ok: true, liveDate: '2026-09-04' };
    },
    runBalances: async (req, res) => {
      calls.push(['balances', req.method, req.headers.authorization]);
      return res.status(200).json({ ok: true, source: 'tochka_live' });
    }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [
    ['payments', 'POST'],
    ['rop'],
    ['balances', 'GET', 'Bearer secret']
  ]);
  assert.deepEqual(res.body.stages.balances, { ok: true, statusCode: 200 });
});

test('intraday orchestrator reports a balance refresh failure after preserving the successful ROP refresh', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: async (_req, res) => {
      calls.push('payments');
      return res.status(200).json({ ok: true });
    },
    refreshRop: async () => {
      calls.push('rop');
      return { ok: true, liveDate: '2026-09-04' };
    },
    runBalances: async (_req, res) => {
      calls.push('balances');
      return res.status(502).json({ ok: false });
    }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls, ['payments', 'rop', 'balances']);
  assert.equal(res.body.stages.rop.ok, true);
  assert.deepEqual(res.body.stages.balances, { ok: false, statusCode: 502 });
});

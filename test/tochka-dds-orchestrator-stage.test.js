import test from 'node:test';
import assert from 'node:assert/strict';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';
import { createIntradayRopOrchestrator } from '../lib/rop-intraday-orchestrator.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

function child(calls, name, statusCode = 200) {
  return async (req, res) => {
    calls.push([name, req.method]);
    return res.status(statusCode).json({ ok: statusCode >= 200 && statusCode < 300 });
  };
}

test('nightly finance imports current-day Tochka DDS after source refresh and before balances', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret',
    runHours: child(calls, 'hours'),
    runPayments: child(calls, 'payments'),
    runReceivables: child(calls, 'receivables'),
    runTochkaDds: child(calls, 'tochkaDds'),
    runBalances: child(calls, 'balances'),
    runDataHealth: child(calls, 'dataHealth'),
    runDecisions: child(calls, 'decisions')
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [
    ['hours', 'GET'],
    ['payments', 'POST'],
    ['receivables', 'GET'],
    ['tochkaDds', 'GET'],
    ['balances', 'GET'],
    ['dataHealth', 'GET'],
    ['decisions', 'GET']
  ]);
  assert.deepEqual(res.body.stages.tochkaDds, { ok: true, statusCode: 200 });
});

test('nightly finance stops before balances and decisions when current-day DDS import fails', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret',
    runHours: child(calls, 'hours'),
    runReceivables: child(calls, 'receivables'),
    runTochkaDds: child(calls, 'tochkaDds', 502),
    runBalances: child(calls, 'balances'),
    runDataHealth: child(calls, 'dataHealth'),
    runDecisions: child(calls, 'decisions')
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(call => call[0]), ['hours', 'receivables', 'tochkaDds']);
  assert.deepEqual(res.body.stages.tochkaDds, { ok: false, statusCode: 502 });
  assert.equal(res.body.stages.balances.skipped, true);
  assert.equal(res.body.stages.dataHealth.skipped, true);
  assert.equal(res.body.stages.decisions.skipped, true);
});

test('intraday ROP imports current-day Tochka DDS before refreshing balances', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => {
      calls.push(['rop', 'internal']);
      return { ok: true, liveDate: '2026-09-04' };
    },
    runTochkaDds: child(calls, 'tochkaDds'),
    runBalances: child(calls, 'balances')
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [
    ['payments', 'POST'],
    ['rop', 'internal'],
    ['tochkaDds', 'GET'],
    ['balances', 'GET']
  ]);
  assert.deepEqual(res.body.stages.tochkaDds, { ok: true, statusCode: 200 });
});

test('intraday ROP preserves refreshed sales data but blocks balance refresh when DDS import fails', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => {
      calls.push(['rop', 'internal']);
      return { ok: true, liveDate: '2026-09-04' };
    },
    runTochkaDds: child(calls, 'tochkaDds', 502),
    runBalances: child(calls, 'balances')
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(call => call[0]), ['payments', 'rop', 'tochkaDds']);
  assert.equal(res.body.stages.rop.ok, true);
  assert.deepEqual(res.body.stages.tochkaDds, { ok: false, statusCode: 502 });
  assert.equal(res.body.stages.balances.skipped, true);
});

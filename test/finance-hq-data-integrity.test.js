import test from 'node:test';
import assert from 'node:assert/strict';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';
import { createIntradayRopOrchestrator } from '../lib/rop-intraday-orchestrator.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

function child(calls, name, statusCode = 200, body = { ok: true }) {
  return async (req, res) => {
    calls.push([name, req.method]);
    return res.status(statusCode).json(body);
  };
}

function decisionBody() {
  return { ok: true, mode: 'commit', verified: true, matches: 1, total: 1 };
}

test('production nightly source refresh continues payments and receivables when hours fails', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret',
    runHours: child(calls, 'hours', 502, { ok: false }),
    runPayments: child(calls, 'payments'),
    runReceivables: child(calls, 'receivables'),
    runDecisions: child(calls, 'decisions')
  });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(([name]) => name), ['hours', 'payments', 'receivables']);
  assert.equal(res.body.stages.hours.ok, false);
  assert.equal(res.body.stages.payments.ok, true);
  assert.equal(res.body.stages.receivables.ok, true);
  assert.equal(res.body.stages.decisions.skipped, true);
});

test('intraday pipeline refreshes receivables before rebuilding ROP', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    runReceivables: child(calls, 'receivables'),
    refreshRop: async () => { calls.push(['rop', 'internal']); return { ok: true, liveDate: '2026-09-15' }; },
    runDataHealth: child(calls, 'dataHealth'),
    runDecisions: child(calls, 'decisions', 200, decisionBody()),
    runOwnerActionQueue: async () => ({ ok: true, staged: 0, ready: 0, succeeded: 0, failed: 0 })
  });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(([name]) => name), ['payments', 'receivables', 'rop', 'dataHealth', 'decisions']);
  assert.equal(res.body.stages.receivables.ok, true);
  assert.equal(res.body.stages.rop.liveDate, '2026-09-15');
});

test('intraday pipeline still refreshes receivables when payments fail', async () => {
  const calls = [];
  let ropCalled = false;
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments', 502, { ok: false }),
    runReceivables: child(calls, 'receivables'),
    refreshRop: async () => { ropCalled = true; return { ok: true }; },
    runDataHealth: child(calls, 'dataHealth'),
    runDecisions: child(calls, 'decisions', 200, decisionBody()),
    runOwnerActionQueue: async () => ({ ok: true })
  });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(([name]) => name), ['payments', 'receivables']);
  assert.equal(res.body.stages.receivables.ok, true);
  assert.equal(ropCalled, false);
});

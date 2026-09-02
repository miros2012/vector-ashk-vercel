import test from 'node:test';
import assert from 'node:assert/strict';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function child(name, calls, statusCode = 200, body = { ok: true }) {
  return async (req, res) => {
    calls.push({ name, method: req.method });
    return res.status(statusCode).json(body);
  };
}

test('nightly orchestrator runs current-month payments before receivables', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret',
    runHours: child('hours', calls),
    runPayments: child('payments', calls),
    runReceivables: child('receivables', calls),
    runDecisions: child('decisions', calls)
  });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(item => item.name), ['hours','payments','receivables','decisions']);
  assert.equal(calls.find(item => item.name === 'payments').method, 'POST');
  assert.equal(res.body.stages.payments.ok, true);
});

test('nightly orchestrator stops before receivables when payments sync fails', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret',
    runHours: child('hours', calls),
    runPayments: child('payments', calls, 502, { ok: false }),
    runReceivables: child('receivables', calls),
    runDecisions: child('decisions', calls)
  });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(item => item.name), ['hours','payments']);
  assert.equal(res.body.stages.receivables.skipped, true);
  assert.equal(res.body.stages.decisions.skipped, true);
});

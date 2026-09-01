import test from 'node:test';
import assert from 'node:assert/strict';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function handlerReturning(statusCode, body, calls, name) {
  return async (req, res) => {
    calls.push({ name, method: req.method, authorization: req.headers?.authorization });
    return res.status(statusCode).json(body);
  };
}

test('nightly orchestrator rejects non-GET and invalid cron auth before child handlers', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const postRes = responseRecorder();
  await handler({ method: 'POST', headers: {} }, postRes);
  assert.equal(postRes.statusCode, 405);
  assert.deepEqual(calls, []);

  const badAuthRes = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, badAuthRes);
  assert.equal(badAuthRes.statusCode, 403);
  assert.deepEqual(calls, []);
});

test('nightly orchestrator runs HOURS before decisions and returns aggregate stages', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true, month: '2026-09', source: { rows: 5, hours: 10 }, comparison: { ok: true } }, calls, 'hours'),
    runDecisions: handlerReturning(200, { ok: true, mode: 'dry_run', verified: true, total: 4, matches: 4 }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map((item) => item.name), ['hours', 'decisions']);
  assert.equal(calls[0].authorization, 'Bearer secret-value');
  assert.equal(calls[1].authorization, 'Bearer secret-value');
  assert.deepEqual(res.body, {
    ok: true,
    stages: {
      hours: { ok: true, statusCode: 200 },
      decisions: { ok: true, statusCode: 200 }
    }
  });
  assert.equal(JSON.stringify(res.body).includes('secret-value'), false);
});

test('nightly orchestrator skips decisions when HOURS fails', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(502, { ok: false, error: 'Staging verification failed' }, calls, 'hours'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map((item) => item.name), ['hours']);
  assert.deepEqual(res.body, {
    ok: false,
    stages: {
      hours: { ok: false, statusCode: 502 },
      decisions: { ok: false, statusCode: null, skipped: true }
    }
  });
});

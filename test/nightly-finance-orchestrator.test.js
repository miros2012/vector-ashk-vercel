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
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
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

test('nightly orchestrator runs HOURS, receivables, then decisions and returns aggregate stages', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true, month: '2026-09' }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true, total: { debt: 50000 } }, calls, 'receivables'),
    runDecisions: handlerReturning(200, { ok: true, mode: 'dry_run' }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map((item) => item.name), ['hours', 'receivables', 'decisions']);
  assert.equal(calls[0].authorization, 'Bearer secret-value');
  assert.equal(calls[1].authorization, 'Bearer secret-value');
  assert.equal(calls[2].authorization, 'Bearer secret-value');
  assert.deepEqual(res.body, {
    ok: true,
    stages: {
      hours: { ok: true, statusCode: 200 },
      receivables: { ok: true, statusCode: 200 },
      decisions: { ok: true, statusCode: 200 }
    }
  });
  assert.equal(JSON.stringify(res.body).includes('secret-value'), false);
});

test('nightly orchestrator skips receivables and decisions when HOURS fails', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(502, { ok: false, error: 'Staging verification failed' }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
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
      receivables: { ok: false, statusCode: null, skipped: true },
      decisions: { ok: false, statusCode: null, skipped: true }
    }
  });
});

test('nightly orchestrator skips decisions when receivables fails', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(500, { ok: false, error: 'Receivables sync failed' }, calls, 'receivables'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(calls.map((item) => item.name), ['hours', 'receivables']);
  assert.deepEqual(res.body, {
    ok: false,
    stages: {
      hours: { ok: true, statusCode: 200 },
      receivables: { ok: false, statusCode: 500 },
      decisions: { ok: false, statusCode: null, skipped: true }
    }
  });
});

test('nightly orchestrator runs Data Health after refreshed sources and before decisions', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runPayments: handlerReturning(200, { ok: true }, calls, 'payments'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
    runDataHealth: handlerReturning(200, { ok: true, status: 'WARNING' }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(item => item.name), ['hours', 'payments', 'receivables', 'dataHealth', 'decisions']);
  assert.deepEqual(res.body.stages.dataHealth, { ok: true, statusCode: 200 });
});

test('nightly orchestrator blocks decisions when Data Health rejects stale core sources', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
    runDataHealth: handlerReturning(503, { ok: false, error: 'Finance data health check failed' }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(calls.map(item => item.name), ['hours', 'receivables', 'dataHealth']);
  assert.deepEqual(res.body, {
    ok: false,
    stages: {
      hours: { ok: true, statusCode: 200 },
      receivables: { ok: true, statusCode: 200 },
      dataHealth: { ok: false, statusCode: 503 },
      decisions: { ok: false, statusCode: null, skipped: true }
    }
  });
});

test('nightly orchestrator discovers Data Health attached to the existing decisions handler', async () => {
  const calls = [];
  const decisions = handlerReturning(200, { ok: true }, calls, 'decisions');
  decisions.dataHealth = handlerReturning(200, { ok: true, status: 'WARNING' }, calls, 'dataHealth');
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
    runDecisions: decisions
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(item => item.name), ['hours', 'receivables', 'dataHealth', 'decisions']);
  assert.deepEqual(res.body.stages.dataHealth, { ok: true, statusCode: 200 });
});

test('nightly orchestrator refreshes the balance mirror before Data Health and decisions', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runPayments: handlerReturning(200, { ok: true }, calls, 'payments'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
    runBalances: handlerReturning(200, { ok: true, source: 'tochka_live' }, calls, 'balances'),
    runDataHealth: handlerReturning(200, { ok: true, status: 'WARNING' }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(item => item.name), ['hours', 'payments', 'receivables', 'balances', 'dataHealth', 'decisions']);
  assert.deepEqual(res.body.stages.balances, { ok: true, statusCode: 200 });
});

test('nightly orchestrator fails closed before Data Health when balance refresh fails', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
    runBalances: handlerReturning(502, { ok: false, error: 'balance mirror failed' }, calls, 'balances'),
    runDataHealth: handlerReturning(200, { ok: true }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(item => item.name), ['hours', 'receivables', 'balances']);
  assert.deepEqual(res.body.stages.balances, { ok: false, statusCode: 502 });
  assert.equal(res.body.stages.dataHealth.skipped, true);
  assert.equal(res.body.stages.decisions.skipped, true);
});

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

function child(calls, name, body = { ok: true }, statusCode = 200) {
  return async (req, res) => {
    calls.push([name, req.method, req.headers.authorization]);
    return res.status(statusCode).json(body);
  };
}

function verifiedDecisionBody(overrides = {}) {
  return {
    ok: true,
    mode: 'commit',
    verified: true,
    matches: 4,
    total: 4,
    writeCount: 12,
    ...overrides
  };
}

function requiredTail(calls, decisionBody = verifiedDecisionBody(), queueBody = { ok: true, staged: 0, ready: 0, succeeded: 0, failed: 0 }) {
  return {
    runDataHealth: child(calls, 'dataHealth', { ok: true, status: 'OK' }),
    runDecisions: child(calls, 'decisions', decisionBody),
    runOwnerActionQueue: async () => {
      calls.push(['ownerActionQueue', 'internal']);
      return queueBody;
    }
  };
}

test('intraday orchestrator requires final v1 Data Health, decisions, and Owner Action Queue stages', () => {
  const base = {
    cronSecret: 'secret',
    runPayments: async () => {},
    refreshRop: async () => ({ ok: true })
  };

  assert.throws(
    () => createIntradayRopOrchestrator({
      ...base,
      runDecisions: async () => {},
      runOwnerActionQueue: async () => ({ ok: true })
    }),
    /runDataHealth is required/
  );
  assert.throws(
    () => createIntradayRopOrchestrator({
      ...base,
      runDataHealth: async () => {},
      runOwnerActionQueue: async () => ({ ok: true })
    }),
    /runDecisions is required/
  );
  assert.throws(
    () => createIntradayRopOrchestrator({
      ...base,
      runDataHealth: async () => {},
      runDecisions: async () => {}
    }),
    /runOwnerActionQueue is required/
  );
});

test('intraday orchestrator runs full verified finance decision pipeline in order', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => {
      calls.push(['rop', 'internal']);
      return { ok: true, liveDate: '2026-09-09' };
    },
    runTochkaDds: child(calls, 'tochkaDds'),
    runBalances: child(calls, 'balances'),
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [
    ['payments', 'POST', 'Bearer secret'],
    ['rop', 'internal'],
    ['tochkaDds', 'GET', 'Bearer secret'],
    ['balances', 'GET', 'Bearer secret'],
    ['dataHealth', 'GET', 'Bearer secret'],
    ['decisions', 'GET', 'Bearer secret'],
    ['ownerActionQueue', 'internal']
  ]);
  assert.deepEqual(res.body.stages.dataHealth, { ok: true, statusCode: 200 });
  assert.deepEqual(res.body.stages.decisions, {
    ok: true,
    statusCode: 200,
    mode: 'commit',
    verified: true,
    matches: 4,
    total: 4
  });
  assert.deepEqual(res.body.stages.ownerActionQueue, {
    ok: true,
    staged: 0,
    ready: 0,
    succeeded: 0,
    failed: 0
  });
});

test('intraday orchestrator fails closed when payment sync fails', async () => {
  let refreshed = false;
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: async (_req, res) => res.status(502).json({ ok: false }),
    refreshRop: async () => { refreshed = true; return { ok: true }; },
    ...requiredTail(calls)
  });
  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(refreshed, false);
  assert.equal(res.body.stages.dataHealth.skipped, true);
  assert.equal(res.body.stages.decisions.skipped, true);
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
});

test('intraday orchestrator refreshes balance mirror before Data Health and decisions', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => {
      calls.push(['rop', 'internal']);
      return { ok: true, liveDate: '2026-09-09' };
    },
    runBalances: child(calls, 'balances', { ok: true, source: 'tochka_live' }),
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(call => call[0]), [
    'payments', 'rop', 'balances', 'dataHealth', 'decisions', 'ownerActionQueue'
  ]);
  assert.deepEqual(res.body.stages.balances, { ok: true, statusCode: 200 });
});

test('intraday orchestrator reports balance failure and skips all decision stages', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => {
      calls.push(['rop', 'internal']);
      return { ok: true, liveDate: '2026-09-09' };
    },
    runBalances: child(calls, 'balances', { ok: false }, 502),
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(call => call[0]), ['payments', 'rop', 'balances']);
  assert.equal(res.body.stages.rop.ok, true);
  assert.deepEqual(res.body.stages.balances, { ok: false, statusCode: 502 });
  assert.equal(res.body.stages.dataHealth.skipped, true);
  assert.equal(res.body.stages.decisions.skipped, true);
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
});

test('intraday orchestrator stops before decision writes when Data Health fails', async () => {
  const calls = [];
  let queueCalled = false;
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => ({ ok: true, liveDate: '2026-09-09' }),
    runTochkaDds: child(calls, 'tochkaDds'),
    runBalances: child(calls, 'balances'),
    runDataHealth: child(calls, 'dataHealth', { ok: false, status: 'BLOCKED' }, 503),
    runDecisions: child(calls, 'decisions', verifiedDecisionBody()),
    runOwnerActionQueue: async () => { queueCalled = true; return { ok: true }; }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(calls.map(call => call[0]), ['payments', 'tochkaDds', 'balances', 'dataHealth']);
  assert.deepEqual(res.body.stages.dataHealth, { ok: false, statusCode: 503 });
  assert.equal(res.body.stages.decisions.skipped, true);
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
  assert.equal(queueCalled, false);
});

test('intraday orchestrator rejects a successful decision dry-run and skips Owner Action Queue', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => ({ ok: true }),
    runDataHealth: child(calls, 'dataHealth', { ok: true, status: 'OK' }),
    runDecisions: child(calls, 'decisions', verifiedDecisionBody({ mode: 'dry-run', verified: false })),
    runOwnerActionQueue: async () => { calls.push(['ownerActionQueue', 'internal']); return { ok: true }; }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.stages.decisions.ok, false);
  assert.equal(res.body.stages.decisions.mode, 'dry-run');
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
  assert.equal(calls.some(call => call[0] === 'ownerActionQueue'), false);
});

test('intraday orchestrator rejects an unverified decision commit and skips Owner Action Queue', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => ({ ok: true }),
    runDataHealth: child(calls, 'dataHealth', { ok: true, status: 'OK' }),
    runDecisions: child(calls, 'decisions', verifiedDecisionBody({ verified: false })),
    runOwnerActionQueue: async () => { calls.push(['ownerActionQueue', 'internal']); return { ok: true }; }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.stages.decisions.ok, false);
  assert.equal(res.body.stages.decisions.verified, false);
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
  assert.equal(calls.some(call => call[0] === 'ownerActionQueue'), false);
});

test('intraday orchestrator rejects post-reconcile drift and skips Owner Action Queue', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => ({ ok: true }),
    runDataHealth: child(calls, 'dataHealth', { ok: true, status: 'OK' }),
    runDecisions: child(calls, 'decisions', verifiedDecisionBody({ matches: 3, total: 4 })),
    runOwnerActionQueue: async () => { calls.push(['ownerActionQueue', 'internal']); return { ok: true }; }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.stages.decisions.ok, false);
  assert.equal(res.body.stages.decisions.matches, 3);
  assert.equal(res.body.stages.decisions.total, 4);
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
  assert.equal(calls.some(call => call[0] === 'ownerActionQueue'), false);
});

test('intraday orchestrator reports Owner Action Queue failure after verified reconciliation', async () => {
  const calls = [];
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runPayments: child(calls, 'payments'),
    refreshRop: async () => ({ ok: true }),
    runDataHealth: child(calls, 'dataHealth', { ok: true, status: 'OK' }),
    runDecisions: child(calls, 'decisions', verifiedDecisionBody()),
    runOwnerActionQueue: async () => {
      calls.push(['ownerActionQueue', 'internal']);
      return { ok: false, staged: 1, ready: 1, succeeded: 0, failed: 1 };
    }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.stages.decisions.ok, true);
  assert.equal(res.body.stages.decisions.verified, true);
  assert.deepEqual(res.body.stages.ownerActionQueue, {
    ok: false,
    staged: 1,
    ready: 1,
    succeeded: 0,
    failed: 1
  });
});

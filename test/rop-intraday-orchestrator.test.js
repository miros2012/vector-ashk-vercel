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

function runControlFake({ begin = { ok: true, runId: 'intraday-run' }, recovery = null } = {}) {
  const calls = [];
  return {
    calls,
    async begin(input) {
      calls.push(['begin', input]);
      return begin;
    },
    async pendingRecovery(context) {
      calls.push(['pendingRecovery', context]);
      return recovery;
    },
    async runStage(context, input) {
      calls.push(['runStage', { stage: input.stage, attempt: input.attempt }]);
      const outcome = await input.execute();
      calls.push(['stageOutcome', { stage: input.stage, outcome }]);
      return outcome;
    },
    async finish(context) {
      calls.push(['finish', context]);
      return { ok: true };
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
    ['tochkaDds', 'GET', 'Bearer secret'],
    ['payments', 'POST', 'Bearer secret'],
    ['rop', 'internal'],
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

test('intraday orchestrator explicitly runs receivables source then ROP publish', async () => {
  const calls = [];
  const runControl = runControlFake();
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runControl,
    runPayments: child(calls, 'payments'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true, verified: true }),
    runRopPublish: async () => {
      calls.push(['ropPublish', 'internal']);
      return { ok: true, liveDate: '2026-09-17' };
    },
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(call => call[0]), [
    'payments', 'receivablesSource', 'ropPublish', 'dataHealth', 'decisions', 'ownerActionQueue'
  ]);
  assert.deepEqual(res.body.stages.receivablesSource, { ok: true, statusCode: 200 });
  assert.deepEqual(res.body.stages.ropPublish, { ok: true, statusCode: 200, liveDate: '2026-09-17' });
  assert.deepEqual(runControl.calls.filter(([name]) => name === 'runStage').map(([, input]) => input), [
    { stage: 'receivablesSource', attempt: 1 },
    { stage: 'ropPublish', attempt: 1 }
  ]);
});

test('intraday receivables recovery reruns only source, publish, and gated tail', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'receivablesSource', attempt: 2 } });
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runControl,
    runPayments: child(calls, 'payments'),
    runTochkaDds: child(calls, 'tochkaDds'),
    runBalances: child(calls, 'balances'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true, verified: true }),
    runRopPublish: async () => { calls.push(['ropPublish', 'internal']); return { ok: true, liveDate: '2026-09-17' }; },
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'recovery');
  assert.equal(res.body.retriedStage, 'receivablesSource');
  assert.deepEqual(calls.map(call => call[0]), [
    'receivablesSource', 'ropPublish', 'dataHealth', 'decisions', 'ownerActionQueue'
  ]);
  assert.deepEqual(Object.keys(res.body.stages), [
    'receivablesSource', 'ropPublish', 'dataHealth', 'decisions', 'ownerActionQueue'
  ]);
});

test('intraday ROP recovery reruns only publish and gated tail', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'ropPublish', attempt: 3 } });
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runControl,
    runPayments: child(calls, 'payments'),
    runTochkaDds: child(calls, 'tochkaDds'),
    runBalances: child(calls, 'balances'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true, verified: true }),
    runRopPublish: async () => { calls.push(['ropPublish', 'internal']); return { ok: true, liveDate: '2026-09-17' }; },
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'recovery');
  assert.equal(res.body.retriedStage, 'ropPublish');
  assert.deepEqual(calls.map(call => call[0]), ['ropPublish', 'dataHealth', 'decisions', 'ownerActionQueue']);
  assert.deepEqual(Object.keys(res.body.stages), ['ropPublish', 'dataHealth', 'decisions', 'ownerActionQueue']);
});

test('recovery-only intraday exits without source work when no retry is due', async () => {
  const calls = [];
  const runControl = runControlFake();
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    recoveryOnly: true,
    runControl,
    runPayments: child(calls, 'payments'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true, verified: true }),
    runRopPublish: async () => { calls.push(['ropPublish', 'internal']); return { ok: true }; },
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, mode: 'recovery_idle', stages: {} });
  assert.deepEqual(calls, []);
  assert.deepEqual(runControl.calls.map(([name]) => name), ['begin', 'pendingRecovery', 'finish']);
});

test('recovery-only retry verifies decisions without executing owner commands', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'ropPublish', attempt: 2 } });
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    recoveryOnly: true,
    runControl,
    runPayments: child(calls, 'payments'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true, verified: true }),
    runRopPublish: async () => { calls.push(['ropPublish', 'internal']); return { ok: true }; },
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(call => call[0]), ['ropPublish', 'dataHealth', 'decisions']);
  assert.deepEqual(res.body.stages.ownerActionQueue, { ok: false, skipped: true });
});

test('intraday recovery runs Owner Action Queue only after healthy verified decisions', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'ropPublish', attempt: 2 } });
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runControl,
    runPayments: child(calls, 'payments'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true }),
    runRopPublish: async () => { calls.push(['ropPublish', 'internal']); return { ok: true }; },
    runDataHealth: child(calls, 'dataHealth', { ok: false }, 503),
    runDecisions: child(calls, 'decisions', verifiedDecisionBody()),
    runOwnerActionQueue: async () => { calls.push(['ownerActionQueue', 'internal']); return { ok: true }; }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(calls.map(call => call[0]), ['ropPublish', 'dataHealth']);
  assert.equal(res.body.stages.decisions.skipped, true);
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
});

test('intraday recovery skips Owner Action Queue when decision verification fails', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'ropPublish', attempt: 2 } });
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runControl,
    runPayments: child(calls, 'payments'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true }),
    runRopPublish: async () => { calls.push(['ropPublish', 'internal']); return { ok: true }; },
    runDataHealth: child(calls, 'dataHealth', { ok: true }),
    runDecisions: child(calls, 'decisions', verifiedDecisionBody({ verified: false })),
    runOwnerActionQueue: async () => { calls.push(['ownerActionQueue', 'internal']); return { ok: true }; }
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(call => call[0]), ['ropPublish', 'dataHealth', 'decisions']);
  assert.equal(res.body.stages.ownerActionQueue.skipped, true);
});

test('intraday blocks normal work when recovery state cannot be read', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE' } });
  const handler = createIntradayRopOrchestrator({
    cronSecret: 'secret',
    runControl,
    runPayments: child(calls, 'payments'),
    runReceivablesSource: child(calls, 'receivablesSource', { ok: true }),
    runRopPublish: async () => { calls.push(['ropPublish', 'internal']); return { ok: true }; },
    ...requiredTail(calls)
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(calls, []);
  assert.equal(res.body.error, 'finance run control failed');
  assert.deepEqual(runControl.calls.map(([name]) => name), ['begin', 'pendingRecovery', 'finish']);
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
  assert.deepEqual(calls.map(call => call[0]), ['tochkaDds', 'payments', 'balances', 'dataHealth']);
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

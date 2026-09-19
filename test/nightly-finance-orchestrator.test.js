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

function directStageReturning(result, calls, name) {
  return async () => {
    calls.push({ name });
    return result;
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

test('nightly production continues through Data Health and decisions after a transient source failure', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runTochkaDds: handlerReturning(502, { ok: false, error: 'Google Sheets request timed out' }, calls, 'tochkaDds'),
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runPayments: handlerReturning(200, { ok: true }, calls, 'payments'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
    runBalances: handlerReturning(200, { ok: true }, calls, 'balances'),
    runDataHealth: handlerReturning(200, { ok: true, status: 'WARNING' }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(item => item.name), [
    'tochkaDds',
    'hours',
    'payments',
    'receivables',
    'balances',
    'dataHealth',
    'decisions'
  ]);
  assert.deepEqual(res.body.stages.dataHealth, { ok: true, statusCode: 200 });
  assert.deepEqual(res.body.stages.decisions, { ok: true, statusCode: 200 });
  assert.equal(res.body.ok, false);
});

test('nightly production still blocks decisions when Data Health rejects the snapshot after a source failure', async () => {
  const calls = [];
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runTochkaDds: handlerReturning(502, { ok: false }, calls, 'tochkaDds'),
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runPayments: handlerReturning(200, { ok: true }, calls, 'payments'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'receivables'),
    runBalances: handlerReturning(200, { ok: true }, calls, 'balances'),
    runDataHealth: handlerReturning(503, { ok: false, error: 'stale core source' }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(calls.map(item => item.name), [
    'tochkaDds',
    'hours',
    'payments',
    'receivables',
    'balances',
    'dataHealth'
  ]);
  assert.equal(res.body.stages.decisions.skipped, true);
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

function runControlFake({ begin = { ok: true, runId: 'nightly-run' }, recovery = null } = {}) {
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

test('nightly split normal flow preserves a verified receivables source when ROP publication fails', async () => {
  const calls = [];
  const runControl = runControlFake();
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivablesSource: handlerReturning(200, { ok: true, verified: true }, calls, 'receivablesSource'),
    runRopPublish: async () => {
      calls.push({ name: 'ropPublish' });
      return { ok: false, statusCode: 502, errorClass: 'ROP_PUBLISH' };
    },
    runDataHealth: handlerReturning(200, { ok: true }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(item => item.name), [
    'hours', 'receivablesSource', 'ropPublish', 'dataHealth', 'decisions'
  ]);
  assert.deepEqual(res.body.stages.receivablesSource, { ok: true, statusCode: 200 });
  assert.deepEqual(res.body.stages.ropPublish, { ok: false, statusCode: 502, errorClass: 'ROP_PUBLISH' });
  assert.deepEqual(runControl.calls.filter(([name]) => name === 'runStage').map(([, input]) => input), [
    { stage: 'receivablesSource', attempt: 1 },
    { stage: 'ropPublish', attempt: 1 }
  ]);
  assert.equal(runControl.calls.filter(([name]) => name === 'finish').length, 1);
});

test('nightly passes sanitized handler failure metadata to the tracked source stage', async () => {
  const calls = [];
  const runControl = runControlFake();
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivablesSource: handlerReturning(502, {
      ok: false,
      errorClass: 'ASHK_FETCH',
      retryable: true,
      error: 'upstream account details must not enter retry state'
    }, calls, 'receivablesSource'),
    runRopPublish: async () => {
      calls.push({ name: 'ropPublish' });
      return { ok: true, statusCode: 200 };
    },
    runDataHealth: handlerReturning(200, { ok: true }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(runControl.calls.filter(([name]) => name === 'stageOutcome'), [
    ['stageOutcome', {
      stage: 'receivablesSource',
      outcome: { ok: false, statusCode: 502, errorClass: 'ASHK_FETCH', retryable: true }
    }]
  ]);
});

test('nightly split normal flow does not publish ROP from a failed receivables source', async () => {
  const calls = [];
  const runControl = runControlFake();
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'legacyReceivables'),
    runReceivablesSource: handlerReturning(502, { ok: false, errorClass: 'SOURCE_FETCH' }, calls, 'receivablesSource'),
    runRopPublish: directStageReturning({ ok: true }, calls, 'ropPublish'),
    runDataHealth: handlerReturning(200, { ok: true }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(calls.map(item => item.name), ['hours', 'receivablesSource', 'dataHealth', 'decisions']);
  assert.deepEqual(res.body.stages.ropPublish, { ok: false, statusCode: null, skipped: true });
  assert.deepEqual(runControl.calls.filter(([name]) => name === 'runStage').map(([, input]) => input), [
    { stage: 'receivablesSource', attempt: 1 }
  ]);
});

test('nightly receivables recovery runs only its source, ROP, Data Health, and decisions', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'receivablesSource', attempt: 2 } });
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runPayments: handlerReturning(200, { ok: true }, calls, 'payments'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'legacyReceivables'),
    runBalances: handlerReturning(200, { ok: true }, calls, 'balances'),
    runReceivablesSource: handlerReturning(200, { ok: true }, calls, 'receivablesSource'),
    runRopPublish: directStageReturning({ ok: true }, calls, 'ropPublish'),
    runDataHealth: handlerReturning(200, { ok: true }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(item => item.name), ['receivablesSource', 'ropPublish', 'dataHealth', 'decisions']);
  assert.equal(res.body.mode, 'recovery');
  assert.equal(res.body.retriedStage, 'receivablesSource');
  assert.deepEqual(Object.keys(res.body.stages), ['receivablesSource', 'ropPublish', 'dataHealth', 'decisions']);
  assert.deepEqual(runControl.calls.filter(([name]) => name === 'runStage').map(([, input]) => input), [
    { stage: 'receivablesSource', attempt: 2 },
    { stage: 'ropPublish', attempt: 1 }
  ]);
  assert.equal(runControl.calls.filter(([name]) => name === 'finish').length, 1);
});

test('nightly ROP recovery runs only ROP, Data Health, and decisions', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'ropPublish', attempt: 3 } });
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'legacyReceivables'),
    runReceivablesSource: handlerReturning(200, { ok: true }, calls, 'receivablesSource'),
    runRopPublish: directStageReturning({ ok: true }, calls, 'ropPublish'),
    runDataHealth: handlerReturning(200, { ok: true }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(item => item.name), ['ropPublish', 'dataHealth', 'decisions']);
  assert.equal(res.body.mode, 'recovery');
  assert.equal(res.body.retriedStage, 'ropPublish');
  assert.deepEqual(Object.keys(res.body.stages), ['ropPublish', 'dataHealth', 'decisions']);
  assert.deepEqual(runControl.calls.filter(([name]) => name === 'runStage').map(([, input]) => input), [
    { stage: 'ropPublish', attempt: 3 }
  ]);
  assert.equal(runControl.calls.filter(([name]) => name === 'finish').length, 1);
});

test('nightly recovery still blocks decisions when Data Health fails', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { stage: 'ropPublish', attempt: 2 } });
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'legacyReceivables'),
    runReceivablesSource: handlerReturning(200, { ok: true }, calls, 'receivablesSource'),
    runRopPublish: directStageReturning({ ok: true }, calls, 'ropPublish'),
    runDataHealth: handlerReturning(503, { ok: false }, calls, 'dataHealth'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(calls.map(item => item.name), ['ropPublish', 'dataHealth']);
  assert.equal(res.body.mode, 'recovery');
  assert.equal(res.body.retriedStage, 'ropPublish');
  assert.equal(res.body.stages.decisions.skipped, true);
  assert.equal(runControl.calls.filter(([name]) => name === 'finish').length, 1);
});

test('nightly blocks safely instead of running normal work when retry state cannot be read', async () => {
  const calls = [];
  const runControl = runControlFake({ recovery: { ok: false, statusCode: 500, errorClass: 'LEDGER_WRITE' } });
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'legacyReceivables'),
    runReceivablesSource: handlerReturning(200, { ok: true }, calls, 'receivablesSource'),
    runRopPublish: directStageReturning({ ok: true }, calls, 'ropPublish'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(calls, []);
  assert.equal(res.body.error, 'finance run control failed');
  assert.deepEqual(runControl.calls.map(([name]) => name), ['begin', 'pendingRecovery', 'finish']);
});

test('nightly orchestrator returns 409 without child work when a foreign lease is held', async () => {
  const calls = [];
  const runControl = runControlFake({ begin: { ok: false, statusCode: 409 } });
  const handler = createNightlyFinanceOrchestrator({
    cronSecret: 'secret-value',
    runControl,
    runHours: handlerReturning(200, { ok: true }, calls, 'hours'),
    runReceivables: handlerReturning(200, { ok: true }, calls, 'legacyReceivables'),
    runReceivablesSource: handlerReturning(200, { ok: true }, calls, 'receivablesSource'),
    runRopPublish: directStageReturning({ ok: true }, calls, 'ropPublish'),
    runDecisions: handlerReturning(200, { ok: true }, calls, 'decisions')
  });

  const res = responseRecorder();
  await handler({ method: 'GET', headers: { authorization: 'Bearer secret-value' } }, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(calls, []);
  assert.deepEqual(runControl.calls.map(([name]) => name), ['begin']);
});

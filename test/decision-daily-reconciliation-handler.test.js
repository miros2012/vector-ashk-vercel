import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionDailyReconciliationHandler } from '../lib/decision-daily-reconciliation-handler.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('daily reconciliation is GET-only and rejects before reconcile', async () => {
  let calls = 0;
  const handler = createDecisionDailyReconciliationHandler({
    cronSecret: 'secret',
    reconcile: async () => { calls += 1; }
  });
  const res = responseRecorder();

  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { ok: false, error: 'Use GET' });
  assert.equal(calls, 0);
});

test('missing or wrong cron authorization is rejected before reconcile', async () => {
  let calls = 0;
  const handler = createDecisionDailyReconciliationHandler({
    cronSecret: 'secret',
    reconcile: async () => { calls += 1; }
  });

  for (const authorization of [undefined, 'Bearer wrong']) {
    const res = responseRecorder();
    await handler({ method: 'GET', headers: { authorization } }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'Unauthorized' });
  }
  assert.equal(calls, 0);
});

test('missing server cron secret fails closed before reconcile', async () => {
  let calls = 0;
  const handler = createDecisionDailyReconciliationHandler({
    cronSecret: '',
    reconcile: async () => { calls += 1; }
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer anything' } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: 'Cron unavailable' });
  assert.equal(calls, 0);
});

test('authorized GET returns only aggregate reconciliation result', async () => {
  const handler = createDecisionDailyReconciliationHandler({
    cronSecret: 'secret',
    reconcile: async (input) => ({
      ok: true,
      mode: 'dry-run',
      verified: false,
      total: 4,
      matches: 4,
      writeCount: 4,
      trigger: input.trigger,
      mismatches: [{ ruleId: 'SECRET', amount: 999999 }]
    })
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    mode: 'dry-run',
    verified: false,
    total: 4,
    matches: 4,
    writeCount: 4,
    trigger: 'daily-cron'
  });
  assert.equal(JSON.stringify(res.body).includes('SECRET'), false);
  assert.equal(JSON.stringify(res.body).includes('999999'), false);
});

test('internal reconciliation failure returns generic 500', async () => {
  const logged = [];
  const handler = createDecisionDailyReconciliationHandler({
    cronSecret: 'secret',
    logger: { error: (...args) => logged.push(args) },
    reconcile: async () => { throw new Error('sensitive DEC-X amount 123'); }
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'Daily reconciliation failed' });
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][1]?.message), /sensitive DEC-X/);
});

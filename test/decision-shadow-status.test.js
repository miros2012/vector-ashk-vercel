import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionShadowStatusHandler } from '../lib/decision-shadow-status.js';

function responseRecorder() {
  return {
    code: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('public shadow status exposes only non-sensitive aggregate health', async () => {
  const handler = createDecisionShadowStatusHandler({
    runShadow: async () => ({
      snapshot: { cash: { gapAmount: 999999 } },
      catalog: [{ ruleId: 'SECRET-RULE' }],
      currentDecisions: [{ ruleId: 'SECRET-RULE', amount: 999999 }],
      comparison: { matches: 4, total: 4, mismatches: [] }
    }),
    now: () => new Date('2026-09-01T02:15:00.000Z')
  });
  const req = { method: 'GET', headers: {} };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.code, 200);
  assert.deepEqual(res.body, {
    ok: true,
    status: 'MATCH',
    matches: 4,
    total: 4,
    drift: 0,
    checkedAt: '2026-09-01T02:15:00.000Z'
  });
  assert.equal(JSON.stringify(res.body).includes('999999'), false);
  assert.equal(JSON.stringify(res.body).includes('SECRET-RULE'), false);
});

test('shadow status reports drift count without exposing mismatch details', async () => {
  const handler = createDecisionShadowStatusHandler({
    runShadow: async () => ({
      comparison: { matches: 3, total: 4, mismatches: [{ ruleId: 'PRIVATE', fields: ['amount'] }] }
    }),
    now: () => new Date('2026-09-01T02:16:00.000Z')
  });
  const res = responseRecorder();

  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.code, 200);
  assert.equal(res.body.status, 'DRIFT');
  assert.equal(res.body.drift, 1);
  assert.equal(JSON.stringify(res.body).includes('PRIVATE'), false);
});

test('shadow status is GET-only', async () => {
  let runs = 0;
  const handler = createDecisionShadowStatusHandler({
    runShadow: async () => { runs += 1; return { comparison: { matches: 4, total: 4, mismatches: [] } }; }
  });
  const res = responseRecorder();

  await handler({ method: 'POST', headers: {} }, res);

  assert.equal(res.code, 405);
  assert.equal(runs, 0);
});

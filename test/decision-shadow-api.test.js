import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionShadowApi } from '../lib/decision-shadow-api.js';

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

test('protected shadow GET returns compact comparison without modifying state', async () => {
  let runs = 0;
  const api = createDecisionShadowApi({
    configuredKey: 'secret',
    runShadow: async () => {
      runs += 1;
      return {
        comparison: {
          total: 4,
          matches: 4,
          mismatches: [],
          results: [
            { ruleId: 'DEC-CASH-GAP', match: true, fields: [], shadow: { active: false, amount: 0, dueDate: '2026-09-06', linkedObjects: [] } }
          ]
        }
      };
    }
  });
  const req = { method: 'GET', headers: { 'x-vector-key': 'secret' } };
  const res = responseRecorder();

  await api(req, res);

  assert.equal(res.code, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, 'shadow');
  assert.equal(res.body.matches, 4);
  assert.equal(res.body.total, 4);
  assert.deepEqual(res.body.mismatches, []);
  assert.equal(res.body.rules[0].ruleId, 'DEC-CASH-GAP');
  assert.equal(runs, 1);
});

test('shadow endpoint rejects wrong key before reading Sheets', async () => {
  let runs = 0;
  const api = createDecisionShadowApi({
    configuredKey: 'secret',
    runShadow: async () => { runs += 1; return {}; }
  });
  const req = { method: 'GET', headers: { authorization: 'Bearer wrong' } };
  const res = responseRecorder();

  await api(req, res);

  assert.equal(res.code, 403);
  assert.equal(runs, 0);
});

test('shadow endpoint is read-only and rejects non-GET methods', async () => {
  const api = createDecisionShadowApi({ configuredKey: 'secret', runShadow: async () => ({}) });
  const req = { method: 'POST', headers: { 'x-vector-key': 'secret' } };
  const res = responseRecorder();

  await api(req, res);

  assert.equal(res.code, 405);
  assert.match(res.body.error, /GET/);
});

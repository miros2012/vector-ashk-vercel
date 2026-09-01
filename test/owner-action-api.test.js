import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerActionApi } from '../lib/owner-action-api.js';

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

test('authorized owner-action GET returns normalized view and no-store', async () => {
  const api = createOwnerActionApi({
    configuredKey: 'secret',
    now: () => new Date('2026-09-01T12:00:00Z'),
    readOwnerAction: async () => ({ top: { ruleId:'DEC-1', allowedActions:['start'] }, activeCount: 2 })
  });
  const req = { method:'GET', headers:{ 'x-vector-key':'secret' } };
  const res = responseRecorder();
  await api(req, res);
  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.top.ruleId, 'DEC-1');
  assert.equal(res.body.activeCount, 2);
  assert.equal(res.body.checkedAt, '2026-09-01T12:00:00.000Z');
});

test('owner-action rejects wrong key before reading sheets', async () => {
  let reads = 0;
  const api = createOwnerActionApi({ configuredKey:'secret', readOwnerAction: async () => { reads += 1; return {}; } });
  const res = responseRecorder();
  await api({ method:'GET', headers:{ authorization:'Bearer wrong' } }, res);
  assert.equal(res.code, 403);
  assert.equal(reads, 0);
});

test('owner-action is GET only', async () => {
  const api = createOwnerActionApi({ configuredKey:'secret', readOwnerAction: async () => ({}) });
  const res = responseRecorder();
  await api({ method:'POST', headers:{ 'x-vector-key':'secret' } }, res);
  assert.equal(res.code, 405);
});

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

test('authorized GET returns normalized owner action view with no-store', async () => {
  let reads = 0;
  const api = createOwnerActionApi({
    configuredKey: 'secret',
    now: () => new Date('2026-09-01T15:10:00Z'),
    readOwnerAction: async () => {
      reads += 1;
      return {
        activeCount: 3,
        top: {
          ruleId: 'DEC-CRIT-DUE',
          title: 'Критическая оплата',
          allowedActions: ['start'],
          executionStatus: 'Не начато'
        }
      };
    }
  });
  const req = { method: 'GET', headers: { 'x-vector-key': 'secret' } };
  const res = responseRecorder();

  await api(req, res);

  assert.equal(res.code, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.activeCount, 3);
  assert.equal(res.body.top.ruleId, 'DEC-CRIT-DUE');
  assert.equal(res.body.checkedAt, '2026-09-01T15:10:00.000Z');
  assert.equal('rank' in res.body.top, false);
  assert.equal('_row' in res.body.top, false);
  assert.equal(reads, 1);
});

test('rejects wrong key before any sheet read', async () => {
  let reads = 0;
  const api = createOwnerActionApi({
    configuredKey: 'secret',
    readOwnerAction: async () => { reads += 1; return { top:null, activeCount:0 }; }
  });
  const req = { method: 'GET', headers: { authorization: 'Bearer wrong' } };
  const res = responseRecorder();

  await api(req, res);

  assert.equal(res.code, 403);
  assert.equal(reads, 0);
});

test('rejects non-GET methods', async () => {
  const api = createOwnerActionApi({ configuredKey: 'secret', readOwnerAction: async () => ({}) });
  const req = { method: 'POST', headers: { 'x-vector-key': 'secret' } };
  const res = responseRecorder();

  await api(req, res);

  assert.equal(res.code, 405);
  assert.match(res.body.error, /GET/);
});

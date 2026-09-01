import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionStateSyncHandler } from '../lib/decision-state-sync-handler.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('wrong key is rejected before decision sync reads or writes anything', async () => {
  let calls = 0;
  const handler = createDecisionStateSyncHandler({
    configuredKey: 'secret',
    synchronize: async () => { calls += 1; return {}; }
  });
  const res = response();

  await handler({ method: 'POST', headers: { 'x-vector-key': 'wrong' }, body: {} }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(calls, 0);
});

test('POST defaults to dry-run and exposes only aggregate sync status', async () => {
  const calls = [];
  const handler = createDecisionStateSyncHandler({
    configuredKey: 'secret',
    synchronize: async (options) => {
      calls.push(options);
      return { ok: true, dryRun: true, total: 4, matchesBefore: 4, writeCount: 16, verified: false };
    }
  });
  const res = response();

  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: {} }, res);

  assert.deepEqual(calls, [{ dryRun: true }]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    ok: true,
    dryRun: true,
    total: 4,
    matchesBefore: 4,
    writeCount: 16,
    verified: false,
    matchesAfter: null
  });
});

test('commit true requests a guarded write and returns post-write verification count', async () => {
  const calls = [];
  const handler = createDecisionStateSyncHandler({
    configuredKey: 'secret',
    synchronize: async (options) => {
      calls.push(options);
      return { ok: true, dryRun: false, total: 4, matchesBefore: 4, writeCount: 16, verified: true, matchesAfter: 4 };
    }
  });
  const res = response();

  await handler({ method: 'POST', headers: { 'x-vector-key': 'secret' }, body: { commit: true } }, res);

  assert.deepEqual(calls, [{ dryRun: false }]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.verified, true);
  assert.equal(res.payload.matchesAfter, 4);
});

test('disabled server-side writes flag fails safely without exposing internals', async () => {
  const handler = createDecisionStateSyncHandler({
    configuredKey: 'secret',
    synchronize: async () => { throw new Error('decision state writes are disabled'); }
  });
  const res = response();

  await handler({ method: 'POST', headers: { 'x-vector-key': 'secret' }, body: { commit: true } }, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.payload, { ok: false, error: 'decision state writes are disabled' });
});

test('non-POST methods are rejected before sync', async () => {
  let calls = 0;
  const handler = createDecisionStateSyncHandler({
    configuredKey: 'secret',
    synchronize: async () => { calls += 1; return {}; }
  });
  const res = response();

  await handler({ method: 'GET', headers: {}, body: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(calls, 0);
});

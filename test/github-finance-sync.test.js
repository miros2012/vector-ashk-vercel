import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeFinanceSyncClaims,
  createGitHubFinanceSyncHandler
} from '../lib/github-finance-sync.js';

const CLAIMS = Object.freeze({
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'vector-finance-sync-v1',
  sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
  repository: 'miros2012/vector-ashk-vercel',
  repository_id: '1350493825',
  repository_owner_id: '46207692',
  ref: 'refs/heads/main',
  workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
  event_name: 'schedule',
  actor_id: '46207692',
  run_id: '123',
  run_attempt: '1'
});

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; }
  };
}

function runner(calls, name) {
  return async (req, res) => {
    calls.push({ name, method: req.method, authorization: req.headers.authorization });
    return res.status(200).json({ ok: true, mode: name });
  };
}

test('finance sync accepts only the exact signed main workflow identity', () => {
  assert.deepEqual(authorizeFinanceSyncClaims(CLAIMS), { eventName: 'schedule' });
  assert.throws(
    () => authorizeFinanceSyncClaims({ ...CLAIMS, ref: 'refs/heads/feature' }),
    /forbidden finance sync claims/
  );
  assert.throws(
    () => authorizeFinanceSyncClaims({ ...CLAIMS, workflow_ref: 'other.yml@refs/heads/main' }),
    /forbidden finance sync claims/
  );
});

test('finance sync OIDC handler routes intraday without exposing CRON_SECRET', async () => {
  const calls = [];
  const handler = createGitHubFinanceSyncHandler({
    verifyToken: async (token, options) => {
      assert.equal(token, 'signed-oidc');
      assert.equal(options.audience, 'vector-finance-sync-v1');
      return CLAIMS;
    },
    cronSecret: 'private-cron-secret',
    runIntraday: runner(calls, 'intraday'),
    runFull: runner(calls, 'full')
  });
  const res = responseRecorder();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer signed-oidc' },
    body: { mode: 'finance_sync', kind: 'intraday' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'intraday');
  assert.deepEqual(calls, [{
    name: 'intraday',
    method: 'GET',
    authorization: 'Bearer private-cron-secret'
  }]);
});

test('finance sync can request the bounded full refresh', async () => {
  const calls = [];
  const handler = createGitHubFinanceSyncHandler({
    verifyToken: async () => CLAIMS,
    cronSecret: 'secret',
    runIntraday: runner(calls, 'intraday'),
    runFull: runner(calls, 'full')
  });
  const res = responseRecorder();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer signed-oidc' },
    body: { mode: 'finance_sync', kind: 'full' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].name, 'full');
});

test('finance sync rejects unsupported modes and unsigned callers', async () => {
  const handler = createGitHubFinanceSyncHandler({
    verifyToken: async () => { throw new Error('invalid token'); },
    cronSecret: 'secret',
    runIntraday: async () => {},
    runFull: async () => {}
  });
  const res = responseRecorder();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer bad' },
    body: { mode: 'finance_sync', kind: 'intraday' }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { ok: false, error: 'forbidden' });
});

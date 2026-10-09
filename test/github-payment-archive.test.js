import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizePaymentArchiveClaims,
  createGitHubPaymentArchiveHandler
} from '../lib/github-payment-archive.js';

const CLAIMS = Object.freeze({
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'vector-finance-sync-v1',
  sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
  repository: 'miros2012/vector-ashk-vercel',
  repository_id: '1350493825',
  repository_owner_id: '46207692',
  ref: 'refs/heads/main',
  workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/ashk-payment-archive.yml@refs/heads/main',
  event_name: 'workflow_dispatch',
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

test('payment archive accepts only the owner-dispatched archive workflow on main', () => {
  assert.deepEqual(authorizePaymentArchiveClaims(CLAIMS), { eventName: 'workflow_dispatch' });
  for (const claims of [
    { ...CLAIMS, actor_id: '1' },
    { ...CLAIMS, ref: 'refs/heads/feature' },
    { ...CLAIMS, event_name: 'schedule' },
    { ...CLAIMS, workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/finance-recovery.yml@refs/heads/main' }
  ]) {
    assert.throws(() => authorizePaymentArchiveClaims(claims), /forbidden payment archive claims/);
  }
});

test('payment archive handler returns a read-only archive without exposing credentials', async () => {
  const calls = [];
  const handler = createGitHubPaymentArchiveHandler({
    verifyToken: async (token, options) => {
      assert.equal(token, 'signed-oidc');
      assert.equal(options.audience, 'vector-finance-sync-v1');
      return CLAIMS;
    },
    apiKey: 'private-ashk-key',
    buildArchive: async input => {
      calls.push(input);
      return {
        period: { startDate: input.startDate, endDate: input.endDate, dayCount: 30 },
        summary: { rows: 1, positive: 5000, refunds: 0, net: 5000 },
        sha256: 'a'.repeat(64),
        payments: [{ Id: 'pay-1', PayDate: '2026-09-01T08:00:00', Debit: 5000 }]
      };
    }
  });
  const res = responseRecorder();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer signed-oidc' },
    body: { mode: 'payment_archive', startDate: '2026-09-01', endDate: '2026-09-30' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, 'read_only_payment_archive');
  assert.equal(res.body.sha256, 'a'.repeat(64));
  assert.equal(JSON.stringify(res.body).includes('private-ashk-key'), false);
  assert.deepEqual(calls, [{
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    apiKey: 'private-ashk-key'
  }]);
});

test('payment archive handler rejects invalid identities and invalid periods before ASHK', async () => {
  let builds = 0;
  const handler = createGitHubPaymentArchiveHandler({
    verifyToken: async token => token === 'valid' ? CLAIMS : { ...CLAIMS, actor_id: '1' },
    apiKey: 'private-ashk-key',
    buildArchive: async () => { builds += 1; return {}; }
  });
  const unauthorized = responseRecorder();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer invalid' },
    body: { mode: 'payment_archive', startDate: '2026-09-01', endDate: '2026-09-30' }
  }, unauthorized);
  assert.equal(unauthorized.statusCode, 403);

  const invalidPeriod = responseRecorder();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer valid' },
    body: { mode: 'payment_archive', startDate: '2026-08-01', endDate: '2026-09-30' }
  }, invalidPeriod);
  assert.equal(invalidPeriod.statusCode, 400);
  assert.equal(builds, 0);
});

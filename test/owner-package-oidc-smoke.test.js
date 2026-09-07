import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

function validClaims(eventName = 'workflow_dispatch') {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'vector-hourly-agent-v1',
    sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
    repository: 'miros2012/vector-ashk-vercel',
    repository_id: '1350493825',
    repository_owner_id: '46207692',
    ref: 'refs/heads/main',
    workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
    event_name: eventName,
    actor_id: '46207692',
    run_id: '12345',
    run_attempt: '1',
    jti: 'test-jti'
  };
}

const attestation = Object.freeze({
  ok: true,
  status: 200,
  cacheControl: 'private, no-store',
  businessDate: '2026-09-07',
  generatedAt: '2026-09-07T15:59:30.000Z',
  ageMs: 30000,
  safeWithdrawal: 0,
  policyBlockers: Object.freeze(['OPERATING_RESERVE_UNDEFINED'])
});

test('owner-triggered workflow_dispatch runs the existing production smoke with Vercel-only key and returns compact attestation', async () => {
  const calls = [];
  const fetchImpl = async () => { throw new Error('fetch should be delegated only through executeSmoke'); };
  const service = createOwnerPackageOidcSmokeService({
    verifyToken: async (token) => {
      assert.equal(token, 'signed-token');
      return validClaims();
    },
    executeSmoke: async (options) => {
      calls.push(options);
      return attestation;
    },
    fetchImpl,
    now: () => '2026-09-07T16:00:00.000Z',
    keyProvider: () => 'owner-secret'
  });

  const result = await service({ authorization: 'Bearer signed-token' });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    mode: 'owner_package_smoke',
    attestation
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env.VECTOR_OWNER_PACKAGE_BASE_URL, 'https://vector-ashk-backend.vercel.app');
  assert.equal(calls[0].env.VECTOR_OWNER_API_KEY, 'owner-secret');
  assert.equal(calls[0].env.VECTOR_OWNER_PACKAGE_MAX_AGE_MS, '300000');
  assert.equal(calls[0].env.VECTOR_OWNER_EXPECTED_SAFE_WITHDRAWAL, '0');
  assert.equal(calls[0].env.VECTOR_OWNER_REQUIRED_POLICY_BLOCKER, 'OPERATING_RESERVE_UNDEFINED');
  assert.equal(calls[0].fetchImpl, fetchImpl);
  assert.equal(calls[0].now, '2026-09-07T16:00:00.000Z');
  assert.equal(typeof calls[0].writeOutput, 'function');
  assert.equal(JSON.stringify(result.body).includes('owner-secret'), false);
});

test('scheduled hourly run cannot invoke owner package smoke', async () => {
  let executed = 0;
  const service = createOwnerPackageOidcSmokeService({
    verifyToken: async () => validClaims('schedule'),
    executeSmoke: async () => { executed += 1; return attestation; },
    fetchImpl: async () => null,
    now: () => '2026-09-07T16:00:00.000Z',
    keyProvider: () => 'owner-secret'
  });

  const result = await service({ authorization: 'Bearer signed-token' });
  assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
  assert.equal(executed, 0);
});

test('missing or invalid bearer token fails closed before smoke execution', async () => {
  let verified = 0;
  let executed = 0;
  const service = createOwnerPackageOidcSmokeService({
    verifyToken: async () => { verified += 1; throw new Error('bad token'); },
    executeSmoke: async () => { executed += 1; return attestation; },
    fetchImpl: async () => null,
    now: () => '2026-09-07T16:00:00.000Z',
    keyProvider: () => 'owner-secret'
  });

  for (const authorization of ['', 'Basic abc', 'Bearer bad-token']) {
    const result = await service({ authorization });
    assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
  }
  assert.equal(verified, 1);
  assert.equal(executed, 0);
});

test('missing Vercel owner key or smoke failure returns generic 500 without leaking secrets', async () => {
  const base = {
    verifyToken: async () => validClaims(),
    fetchImpl: async () => null,
    now: () => '2026-09-07T16:00:00.000Z'
  };

  const missingKey = createOwnerPackageOidcSmokeService({
    ...base,
    executeSmoke: async () => attestation,
    keyProvider: () => ''
  });
  assert.deepEqual(
    await missingKey({ authorization: 'Bearer signed-token' }),
    { status: 500, body: { ok: false, error: 'owner package smoke unavailable' } }
  );

  const failing = createOwnerPackageOidcSmokeService({
    ...base,
    executeSmoke: async () => { throw new Error('owner-secret internal failure'); },
    keyProvider: () => 'owner-secret'
  });
  const result = await failing({ authorization: 'Bearer signed-token' });
  assert.deepEqual(result, { status: 500, body: { ok: false, error: 'owner package smoke failed' } });
  assert.equal(JSON.stringify(result).includes('owner-secret'), false);
});

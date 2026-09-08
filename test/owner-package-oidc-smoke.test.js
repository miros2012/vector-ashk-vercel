import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

const MAIN_SHA = '4abdd3e2e9ec80105c8c8bc6b85dc4a20f98ea5d';

function validClaims(eventName = 'workflow_dispatch', audience = 'vector-owner-package-smoke-v1') {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: audience,
    sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
    repository: 'miros2012/vector-ashk-vercel',
    repository_id: '1350493825',
    repository_owner_id: '46207692',
    ref: 'refs/heads/main',
    workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
    workflow_sha: MAIN_SHA,
    sha: MAIN_SHA,
    event_name: eventName,
    actor_id: '46207692',
    run_id: '12345',
    run_attempt: '1',
    runner_environment: 'github-hosted',
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

function serviceForClaims(claims, executedRef = { count: 0 }) {
  return createOwnerPackageOidcSmokeService({
    verifyToken: async () => claims,
    executeSmoke: async () => { executedRef.count += 1; return attestation; },
    fetchImpl: async () => null,
    now: () => '2026-09-07T16:00:00.000Z',
    keyProvider: () => 'owner-secret',
    deploymentShaProvider: () => MAIN_SHA
  });
}

test('owner-triggered workflow_dispatch runs the existing production smoke with dedicated Owner audience and Vercel-only key', async () => {
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
    keyProvider: () => 'owner-secret',
    deploymentShaProvider: () => MAIN_SHA
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
  assert.equal(typeof calls[0].now, 'function');
  assert.equal(calls[0].now(), '2026-09-07T16:00:00.000Z');
  assert.equal(typeof calls[0].writeOutput, 'function');
  assert.equal(JSON.stringify(result.body).includes('owner-secret'), false);
});

test('dedicated Owner audience may be one entry in an audience array', async () => {
  const executed = { count: 0 };
  const service = serviceForClaims(validClaims('workflow_dispatch', ['other-audience', 'vector-owner-package-smoke-v1']), executed);
  const result = await service({ authorization: 'Bearer signed-token' });
  assert.equal(result.status, 200);
  assert.equal(executed.count, 1);
});

test('shared hourly-agent audience cannot invoke owner package smoke', async () => {
  const executed = { count: 0 };
  const service = serviceForClaims(validClaims('workflow_dispatch', 'vector-hourly-agent-v1'), executed);

  const result = await service({ authorization: 'Bearer signed-token' });
  assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
  assert.equal(executed.count, 0);
});

test('owner smoke identity is independently bound to immutable repository, workflow, actor and run claims', async () => {
  const invalid = [
    { iss: 'https://example.invalid' },
    { sub: 'repo:other/repo:ref:refs/heads/main' },
    { repository: 'other/repo' },
    { repository_id: '999' },
    { repository_owner_id: '999' },
    { ref: 'refs/heads/feature' },
    { workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/test.yml@refs/heads/main' },
    { event_name: 'issues' },
    { actor_id: '999' },
    { run_id: '0' },
    { run_id: 'not-a-run' },
    { run_attempt: '0' },
    { run_attempt: '' }
  ];

  for (const override of invalid) {
    const executed = { count: 0 };
    const service = serviceForClaims({ ...validClaims(), ...override }, executed);
    const result = await service({ authorization: 'Bearer signed-token' });
    assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
    assert.equal(executed.count, 0);
  }
});

test('owner smoke fails closed when GitHub run, workflow, and deployed Vercel commit SHAs are not the same exact revision', async () => {
  const cases = [
    { claims: { ...validClaims(), sha: '' }, deploymentSha: MAIN_SHA },
    { claims: { ...validClaims(), workflow_sha: '' }, deploymentSha: MAIN_SHA },
    { claims: { ...validClaims(), sha: 'z'.repeat(40) }, deploymentSha: MAIN_SHA },
    { claims: { ...validClaims(), workflow_sha: '1'.repeat(40) }, deploymentSha: MAIN_SHA },
    { claims: validClaims(), deploymentSha: '' },
    { claims: validClaims(), deploymentSha: '2'.repeat(40) }
  ];

  for (const entry of cases) {
    let keyReads = 0;
    let executions = 0;
    const service = createOwnerPackageOidcSmokeService({
      verifyToken: async () => entry.claims,
      executeSmoke: async () => { executions += 1; return attestation; },
      fetchImpl: async () => null,
      now: () => '2026-09-07T16:00:00.000Z',
      keyProvider: () => { keyReads += 1; return 'owner-secret'; },
      deploymentShaProvider: () => entry.deploymentSha
    });

    const result = await service({ authorization: 'Bearer signed-token' });
    assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
    assert.equal(keyReads, 0);
    assert.equal(executions, 0);
  }
});

test('scheduled hourly run cannot invoke owner package smoke', async () => {
  const executed = { count: 0 };
  const service = serviceForClaims(validClaims('schedule'), executed);

  const result = await service({ authorization: 'Bearer signed-token' });
  assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
  assert.equal(executed.count, 0);
});

test('missing or invalid bearer token fails closed before smoke execution', async () => {
  let verified = 0;
  let executed = 0;
  const service = createOwnerPackageOidcSmokeService({
    verifyToken: async () => { verified += 1; throw new Error('bad token'); },
    executeSmoke: async () => { executed += 1; return attestation; },
    fetchImpl: async () => null,
    now: () => '2026-09-07T16:00:00.000Z',
    keyProvider: () => 'owner-secret',
    deploymentShaProvider: () => MAIN_SHA
  });

  for (const authorization of ['', 'Basic abc', 'Bearer bad-token']) {
    const result = await service({ authorization });
    assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
  }
  assert.equal(verified, 1);
  assert.equal(executed, 0);
});

test('missing Vercel owner key or smoke failure returns classified generic 500 without leaking secrets', async () => {
  const base = {
    verifyToken: async () => validClaims(),
    fetchImpl: async () => null,
    now: () => '2026-09-07T16:00:00.000Z',
    deploymentShaProvider: () => MAIN_SHA
  };

  const missingKey = createOwnerPackageOidcSmokeService({
    ...base,
    executeSmoke: async () => attestation,
    keyProvider: () => ''
  });
  assert.deepEqual(
    await missingKey({ authorization: 'Bearer signed-token' }),
    {
      status: 500,
      body: {
        ok: false,
        error: 'owner package smoke unavailable',
        failureCode: 'OWNER_PACKAGE_KEY_UNAVAILABLE'
      }
    }
  );

  const failing = createOwnerPackageOidcSmokeService({
    ...base,
    executeSmoke: async () => { throw new Error('owner-secret internal failure'); },
    keyProvider: () => 'owner-secret'
  });
  const result = await failing({ authorization: 'Bearer signed-token' });
  assert.deepEqual(result, {
    status: 500,
    body: {
      ok: false,
      error: 'owner package smoke failed',
      failureCode: 'OWNER_PACKAGE_VERIFY_FAILED'
    }
  });
  assert.equal(JSON.stringify(result).includes('owner-secret'), false);
});

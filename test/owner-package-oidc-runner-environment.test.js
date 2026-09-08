import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

const DEPLOYMENT_SHA = '5553bb7c98770bc5844993624217f8018d8dc06f';

function validClaims() {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'vector-owner-package-smoke-v1',
    sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
    repository: 'miros2012/vector-ashk-vercel',
    repository_id: '1350493825',
    repository_owner_id: '46207692',
    ref: 'refs/heads/main',
    workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
    workflow_sha: DEPLOYMENT_SHA,
    sha: DEPLOYMENT_SHA,
    event_name: 'workflow_dispatch',
    actor_id: '46207692',
    run_id: '12345',
    run_attempt: '1',
    runner_environment: 'github-hosted'
  };
}

function serviceForClaims(claims, counters) {
  return createOwnerPackageOidcSmokeService({
    verifyToken: async () => claims,
    executeSmoke: async () => {
      counters.executions += 1;
      return { ok: true };
    },
    fetchImpl: async () => null,
    now: () => '2026-09-08T02:45:00.000Z',
    keyProvider: () => {
      counters.keyReads += 1;
      return 'owner-secret';
    },
    deploymentShaProvider: () => DEPLOYMENT_SHA
  });
}

test('Owner smoke rejects self-hosted or missing runner environment before reading the Vercel-only key', async () => {
  for (const runnerEnvironment of ['self-hosted', undefined]) {
    const counters = { keyReads: 0, executions: 0 };
    const claims = { ...validClaims() };
    if (runnerEnvironment === undefined) delete claims.runner_environment;
    else claims.runner_environment = runnerEnvironment;

    const result = await serviceForClaims(claims, counters)({ authorization: 'Bearer signed-token' });

    assert.deepEqual(result, { status: 403, body: { ok: false, error: 'forbidden' } });
    assert.equal(counters.keyReads, 0);
    assert.equal(counters.executions, 0);
  }
});

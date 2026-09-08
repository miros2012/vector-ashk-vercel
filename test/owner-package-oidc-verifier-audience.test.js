import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

const DEPLOYMENT_SHA = '07cabe1a2db4274fd963c5207c497ce9c4c3bfba';

function validOwnerClaims() {
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
    runner_environment: 'github-hosted',
    jti: 'owner-smoke-audience-test'
  };
}

test('Owner smoke asks the shared GitHub OIDC verifier for the dedicated Owner audience', async () => {
  let verifierOptions;
  const service = createOwnerPackageOidcSmokeService({
    verifyToken: async (token, options) => {
      assert.equal(token, 'signed-token');
      verifierOptions = options;
      return validOwnerClaims();
    },
    executeSmoke: async () => Object.freeze({ ok: true }),
    fetchImpl: async () => null,
    now: () => '2026-09-07T22:50:00.000Z',
    keyProvider: () => 'owner-secret',
    deploymentShaProvider: () => DEPLOYMENT_SHA
  });

  const result = await service({ authorization: 'Bearer signed-token' });

  assert.equal(result.status, 200);
  assert.deepEqual(verifierOptions, { audience: 'vector-owner-package-smoke-v1' });
});

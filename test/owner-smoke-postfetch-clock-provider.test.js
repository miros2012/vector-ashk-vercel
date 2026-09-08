import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

const SHA = '9e0e34f511873d9dbb0ed24c8e54025c66f64cf9';

function claims() {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'vector-owner-package-smoke-v1',
    sub: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
    repository: 'miros2012/vector-ashk-vercel',
    repository_id: '1350493825',
    repository_owner_id: '46207692',
    ref: 'refs/heads/main',
    workflow_ref: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
    workflow_sha: SHA,
    sha: SHA,
    event_name: 'workflow_dispatch',
    actor_id: '46207692',
    run_id: '86',
    run_attempt: '1',
    runner_environment: 'github-hosted'
  };
}

test('OIDC smoke passes a lazy observation clock instead of capturing time before downstream GET', async () => {
  let clockReads = 0;
  let receivedNow;
  const now = () => {
    clockReads += 1;
    return '2026-09-08T14:51:53.000Z';
  };

  const service = createOwnerPackageOidcSmokeService({
    verifyToken: async () => claims(),
    executeSmoke: async (options) => {
      receivedNow = options.now;
      assert.equal(clockReads, 0);
      return Object.freeze({ ok: true });
    },
    fetchImpl: async () => null,
    now,
    keyProvider: () => 'x'.repeat(64),
    deploymentShaProvider: () => SHA
  });

  const result = await service({ authorization: 'Bearer signed-token' });

  assert.equal(result.status, 200);
  assert.equal(typeof receivedNow, 'function');
  assert.equal(clockReads, 0);
  assert.equal(receivedNow(), '2026-09-08T14:51:53.000Z');
  assert.equal(clockReads, 1);
});

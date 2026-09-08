import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

const MAIN_SHA = 'a'.repeat(40);

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
    workflow_sha: MAIN_SHA,
    sha: MAIN_SHA,
    event_name: 'workflow_dispatch',
    actor_id: '46207692',
    run_id: '12345',
    run_attempt: '1',
    runner_environment: 'github-hosted'
  };
}

async function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Owner smoke fails closed before execution when the dedicated key reuses a broader credential', async () => {
  await withEnv({
    VECTOR_OWNER_PACKAGE_KEY: 'same-secret',
    VECTOR_SYNC_KEY: 'same-secret',
    TOCHKA_BRIDGE_KEY: 'different-bridge-secret'
  }, async () => {
    let executions = 0;
    const service = createOwnerPackageOidcSmokeService({
      verifyToken: async () => validClaims(),
      executeSmoke: async () => {
        executions += 1;
        return { ok: true };
      },
      fetchImpl: async () => null,
      now: () => '2026-09-08T07:40:00.000Z',
      deploymentShaProvider: () => MAIN_SHA
    });

    const result = await service({ authorization: 'Bearer signed-token' });
    assert.deepEqual(result, {
      status: 500,
      body: {
        ok: false,
        error: 'owner package smoke unavailable',
        failureCode: 'OWNER_PACKAGE_KEY_UNAVAILABLE'
      }
    });
    assert.equal(executions, 0);
  });
});

test('shared Owner key resolver accepts only a non-empty credential distinct from sync and bridge keys', async () => {
  const { resolveOwnerPackageKey } = await import('../lib/owner-package-key.js');

  assert.equal(resolveOwnerPackageKey({
    VECTOR_OWNER_PACKAGE_KEY: 'owner-secret',
    VECTOR_SYNC_KEY: 'sync-secret',
    TOCHKA_BRIDGE_KEY: 'bridge-secret'
  }), 'owner-secret');
  assert.equal(resolveOwnerPackageKey({
    VECTOR_OWNER_PACKAGE_KEY: 'reused',
    VECTOR_SYNC_KEY: 'reused',
    TOCHKA_BRIDGE_KEY: 'bridge-secret'
  }), '');
  assert.equal(resolveOwnerPackageKey({
    VECTOR_OWNER_PACKAGE_KEY: 'reused',
    VECTOR_SYNC_KEY: 'sync-secret',
    TOCHKA_BRIDGE_KEY: 'reused'
  }), '');
  assert.equal(resolveOwnerPackageKey({
    VECTOR_OWNER_PACKAGE_KEY: '',
    VECTOR_SYNC_KEY: 'sync-secret',
    TOCHKA_BRIDGE_KEY: 'bridge-secret'
  }), '');

  const decisionSource = await fs.readFile(new URL('../api/decision-event.js', import.meta.url), 'utf8');
  const smokeSource = await fs.readFile(new URL('../lib/owner-package-oidc-smoke.js', import.meta.url), 'utf8');
  assert.match(decisionSource, /resolveOwnerPackageKey/);
  assert.match(smokeSource, /resolveOwnerPackageKey/);
});

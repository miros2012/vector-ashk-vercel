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

test('Owner smoke uses only VECTOR_OWNER_PACKAGE_KEY and never falls back to broader sync or bridge keys', async () => {
  await withEnv({
    VECTOR_OWNER_PACKAGE_KEY: 'dedicated-owner-key',
    VECTOR_SYNC_KEY: 'legacy-sync-key',
    TOCHKA_BRIDGE_KEY: 'legacy-bridge-key'
  }, async () => {
    let receivedKey = null;
    const service = createOwnerPackageOidcSmokeService({
      verifyToken: async () => validClaims(),
      executeSmoke: async ({ env }) => {
        receivedKey = env.VECTOR_OWNER_API_KEY;
        return { ok: true };
      },
      fetchImpl: async () => null,
      now: () => '2026-09-08T05:40:00.000Z',
      deploymentShaProvider: () => MAIN_SHA
    });

    const result = await service({ authorization: 'Bearer signed-token' });
    assert.equal(result.status, 200);
    assert.equal(receivedKey, 'dedicated-owner-key');
  });

  await withEnv({
    VECTOR_OWNER_PACKAGE_KEY: undefined,
    VECTOR_SYNC_KEY: 'legacy-sync-key',
    TOCHKA_BRIDGE_KEY: 'legacy-bridge-key'
  }, async () => {
    let executions = 0;
    const service = createOwnerPackageOidcSmokeService({
      verifyToken: async () => validClaims(),
      executeSmoke: async () => { executions += 1; return { ok: true }; },
      fetchImpl: async () => null,
      now: () => '2026-09-08T05:40:00.000Z',
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

test('read-only Owner package route is wired to its dedicated key instead of the generic sync key', async () => {
  const source = await fs.readFile(new URL('../api/decision-event.js', import.meta.url), 'utf8');
  assert.match(source, /function\s+ownerPackageKey\s*\(\)\s*{[\s\S]*VECTOR_OWNER_PACKAGE_KEY/);
  assert.match(source, /createOwnerPackageHandler\(\)[\s\S]*configuredKey:\s*ownerPackageKey\(\)/);
});

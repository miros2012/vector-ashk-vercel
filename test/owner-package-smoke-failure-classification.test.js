import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

const MAIN_SHA = 'e7a0a109d9d964e68206a607e7e864c3fb8d6a07';

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
    run_id: '34191500546',
    run_attempt: '1',
    runner_environment: 'github-hosted'
  };
}

function baseOptions() {
  return {
    verifyToken: async () => validClaims(),
    fetchImpl: async () => null,
    now: () => '2026-09-08T05:40:12.000Z',
    deploymentShaProvider: () => MAIN_SHA
  };
}

test('Owner smoke returns only allowlisted secret-safe failure codes for post-auth production failures', async () => {
  const missingKey = createOwnerPackageOidcSmokeService({
    ...baseOptions(),
    executeSmoke: async () => { throw new Error('must not execute'); },
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
    ...baseOptions(),
    executeSmoke: async () => { throw new Error('TOP-SECRET-OWNER-KEY raw downstream detail'); },
    keyProvider: () => 'TOP-SECRET-OWNER-KEY'
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
  assert.equal(JSON.stringify(result).includes('TOP-SECRET-OWNER-KEY'), false);
});

test('workflow logs only allowlisted Owner smoke failureCode rather than response bodies or secrets', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const workflow = fs.readFileSync(path.join(here, '..', '.github', 'workflows', 'hourly-project-continuation.yml'), 'utf8');
  assert.match(workflow, /OWNER_PACKAGE_KEY_UNAVAILABLE/);
  assert.match(workflow, /OWNER_PACKAGE_VERIFY_FAILED/);
  assert.match(workflow, /failureCode/);
  assert.doesNotMatch(workflow, /JSON\.stringify\(body\).*owner package smoke failed/);
});

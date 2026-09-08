import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOwnerPackageProduction } from '../lib/owner-package-production-smoke.js';
import { createOwnerPackageOidcSmokeService } from '../lib/owner-package-oidc-smoke.js';

const MAIN_SHA = '3fafbfb1cf77fc7e9bda097ab9364c6d15236778';

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

function response({ cacheControl = 'private', body = { ok: true, package: {} } } = {}) {
  return {
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'cache-control' ? cacheControl : null;
      }
    },
    async json() { return body; }
  };
}

async function verifierStageModule() {
  return import('../lib/owner-package-verifier-stage.js');
}

test('Owner verifier stage helper exposes only the approved allowlist and preserves original errors', async () => {
  const {
    OWNER_PACKAGE_VERIFIER_STAGES,
    runOwnerPackageVerifierStage,
    ownerPackageVerifierFailureStage
  } = await verifierStageModule();

  assert.deepEqual([...OWNER_PACKAGE_VERIFIER_STAGES], [
    'CACHE_CONTROL',
    'BODY_SHAPE',
    'SAFE_WITHDRAWAL',
    'POLICY',
    'BUSINESS_DATE',
    'FRESHNESS'
  ]);

  const original = new Error('internal verifier detail');
  let caught;
  try {
    await runOwnerPackageVerifierStage('POLICY', async () => { throw original; });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, original);
  assert.equal(caught.message, 'internal verifier detail');
  assert.equal(ownerPackageVerifierFailureStage(caught), 'POLICY');
  assert.equal(ownerPackageVerifierFailureStage(new Error('untagged')), 'UNCLASSIFIED');
});

test('production verifier tags cache-policy failures without replacing the existing fail-closed message', async () => {
  const { ownerPackageVerifierFailureStage } = await verifierStageModule();
  let caught;
  try {
    await verifyOwnerPackageProduction({
      baseUrl: 'https://vector.example.test',
      key: 'owner-secret',
      fetchImpl: async () => response(),
      now: '2026-09-08T14:07:15.000Z',
      maxAgeMs: 300000,
      expectedSafeWithdrawal: 0,
      requiredPolicyBlocker: 'OPERATING_RESERVE_UNDEFINED'
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /Cache-Control must include no-store/);
  assert.equal(ownerPackageVerifierFailureStage(caught), 'CACHE_CONTROL');
});

test('OIDC smoke logs only an allowlisted verifier stage while keeping its public 500 generic', async () => {
  const { runOwnerPackageVerifierStage } = await verifierStageModule();
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args.map(String).join(' '));
  try {
    const service = createOwnerPackageOidcSmokeService({
      verifyToken: async () => validClaims(),
      executeSmoke: async () => runOwnerPackageVerifierStage('CACHE_CONTROL', () => {
        throw new Error('owner-secret raw package body should stay private');
      }),
      fetchImpl: async () => null,
      now: () => '2026-09-08T14:07:15.000Z',
      keyProvider: () => 'owner-secret',
      deploymentShaProvider: () => MAIN_SHA
    });

    const result = await service({ authorization: 'Bearer signed-token' });
    assert.deepEqual(result, {
      status: 500,
      body: {
        ok: false,
        error: 'owner package smoke failed',
        failureCode: 'OWNER_PACKAGE_VERIFY_FAILED'
      }
    });
    assert.deepEqual(logged, ['owner-package-verifier-stage:CACHE_CONTROL']);
    assert.equal(JSON.stringify(result).includes('owner-secret'), false);
    assert.equal(logged.join('\n').includes('owner-secret'), false);
    assert.equal(logged.join('\n').includes('raw package body'), false);
  } finally {
    console.error = originalConsoleError;
  }
});

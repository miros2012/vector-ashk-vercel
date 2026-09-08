import { executeOwnerPackageProductionSmoke } from './owner-package-production-smoke-command.js';
import { resolveOwnerPackageKey } from './owner-package-key.js';
import { ownerPackageVerifierFailureStage } from './owner-package-verifier-stage.js';

const DEFAULT_BASE_URL = 'https://vector-ashk-backend.vercel.app';
const DEFAULT_MAX_AGE_MS = '300000';
const EXPECTED_SAFE_WITHDRAWAL = '0';
const REQUIRED_POLICY_BLOCKER = 'OPERATING_RESERVE_UNDEFINED';
const OWNER_SMOKE_IDENTITY = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  audience: 'vector-owner-package-smoke-v1',
  subject: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main',
  repository: 'miros2012/vector-ashk-vercel',
  repositoryId: '1350493825',
  ownerId: '46207692',
  ref: 'refs/heads/main',
  workflowRef: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main'
});

function bearerToken(value) {
  const match = String(value || '').match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
}

function generic(status, error, failureCode) {
  return {
    status,
    body: {
      ok: false,
      error,
      ...(failureCode ? { failureCode } : {})
    }
  };
}

function positiveIntegerClaim(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) throw new Error('forbidden owner package smoke claims');
  return normalized;
}

function commitShaClaim(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error('forbidden owner package smoke claims');
  return normalized;
}

export function authorizeOwnerPackageSmokeClaims(claims = {}, { deploymentSha } = {}) {
  const audience = Array.isArray(claims.aud)
    ? claims.aud.map((value) => String(value))
    : [String(claims.aud || '')];
  const valid = claims.iss === OWNER_SMOKE_IDENTITY.issuer
    && audience.includes(OWNER_SMOKE_IDENTITY.audience)
    && claims.sub === OWNER_SMOKE_IDENTITY.subject
    && claims.repository === OWNER_SMOKE_IDENTITY.repository
    && String(claims.repository_id) === OWNER_SMOKE_IDENTITY.repositoryId
    && String(claims.repository_owner_id) === OWNER_SMOKE_IDENTITY.ownerId
    && claims.ref === OWNER_SMOKE_IDENTITY.ref
    && claims.workflow_ref === OWNER_SMOKE_IDENTITY.workflowRef
    && claims.event_name === 'workflow_dispatch'
    && String(claims.actor_id) === OWNER_SMOKE_IDENTITY.ownerId
    && claims.runner_environment === 'github-hosted';
  if (!valid) throw new Error('forbidden owner package smoke claims');
  positiveIntegerClaim(claims.run_id);
  positiveIntegerClaim(claims.run_attempt);

  const runSha = commitShaClaim(claims.sha);
  const workflowSha = commitShaClaim(claims.workflow_sha);
  const deployedSha = commitShaClaim(deploymentSha);
  if (runSha !== workflowSha || runSha !== deployedSha) {
    throw new Error('forbidden owner package smoke claims');
  }

  return Object.freeze({ eventName: 'workflow_dispatch' });
}

export function createOwnerPackageOidcSmokeService({
  verifyToken,
  executeSmoke = executeOwnerPackageProductionSmoke,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  keyProvider = () => resolveOwnerPackageKey(process.env),
  deploymentShaProvider = () => process.env.VERCEL_GIT_COMMIT_SHA || '',
  baseUrl = DEFAULT_BASE_URL
} = {}) {
  if (typeof verifyToken !== 'function') throw new Error('verifyToken is required');
  if (typeof executeSmoke !== 'function') throw new Error('executeSmoke is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof now !== 'function') throw new Error('now is required');
  if (typeof keyProvider !== 'function') throw new Error('keyProvider is required');
  if (typeof deploymentShaProvider !== 'function') throw new Error('deploymentShaProvider is required');

  return async function ownerPackageOidcSmoke({ authorization } = {}) {
    const token = bearerToken(authorization);
    if (!token) return generic(403, 'forbidden');

    try {
      const claims = await verifyToken(token, { audience: OWNER_SMOKE_IDENTITY.audience });
      const deploymentSha = deploymentShaProvider();
      authorizeOwnerPackageSmokeClaims(claims, { deploymentSha });
    } catch {
      return generic(403, 'forbidden');
    }

    let key;
    try {
      key = String(keyProvider() || '').trim();
    } catch {
      return generic(500, 'owner package smoke unavailable', 'OWNER_PACKAGE_KEY_UNAVAILABLE');
    }
    if (!key) {
      return generic(500, 'owner package smoke unavailable', 'OWNER_PACKAGE_KEY_UNAVAILABLE');
    }

    try {
      const attestation = await executeSmoke({
        env: {
          VECTOR_OWNER_PACKAGE_BASE_URL: baseUrl,
          VECTOR_OWNER_API_KEY: key,
          VECTOR_OWNER_PACKAGE_MAX_AGE_MS: DEFAULT_MAX_AGE_MS,
          VECTOR_OWNER_EXPECTED_SAFE_WITHDRAWAL: EXPECTED_SAFE_WITHDRAWAL,
          VECTOR_OWNER_REQUIRED_POLICY_BLOCKER: REQUIRED_POLICY_BLOCKER
        },
        fetchImpl,
        now: now(),
        writeOutput() {}
      });
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'owner_package_smoke',
          attestation
        }
      };
    } catch (error) {
      console.error(`owner-package-verifier-stage:${ownerPackageVerifierFailureStage(error)}`);
      return generic(500, 'owner package smoke failed', 'OWNER_PACKAGE_VERIFY_FAILED');
    }
  };
}

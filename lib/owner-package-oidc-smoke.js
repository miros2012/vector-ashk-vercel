import { authorizeHourlyAgentClaims } from './hourly-project-agent.js';
import { executeOwnerPackageProductionSmoke } from './owner-package-production-smoke-command.js';

const DEFAULT_BASE_URL = 'https://vector-ashk-backend.vercel.app';
const DEFAULT_MAX_AGE_MS = '300000';
const EXPECTED_SAFE_WITHDRAWAL = '0';
const REQUIRED_POLICY_BLOCKER = 'OPERATING_RESERVE_UNDEFINED';

function bearerToken(value) {
  const match = String(value || '').match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
}

function generic(status, error) {
  return { status, body: { ok: false, error } };
}

export function createOwnerPackageOidcSmokeService({
  verifyToken,
  executeSmoke = executeOwnerPackageProductionSmoke,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  keyProvider = () => process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '',
  baseUrl = DEFAULT_BASE_URL
} = {}) {
  if (typeof verifyToken !== 'function') throw new Error('verifyToken is required');
  if (typeof executeSmoke !== 'function') throw new Error('executeSmoke is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof now !== 'function') throw new Error('now is required');
  if (typeof keyProvider !== 'function') throw new Error('keyProvider is required');

  return async function ownerPackageOidcSmoke({ authorization } = {}) {
    const token = bearerToken(authorization);
    if (!token) return generic(403, 'forbidden');

    try {
      const claims = await verifyToken(token);
      const authorized = authorizeHourlyAgentClaims(claims);
      if (authorized.eventName !== 'workflow_dispatch') {
        return generic(403, 'forbidden');
      }
    } catch {
      return generic(403, 'forbidden');
    }

    let key;
    try {
      key = String(keyProvider() || '').trim();
    } catch {
      return generic(500, 'owner package smoke unavailable');
    }
    if (!key) return generic(500, 'owner package smoke unavailable');

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
    } catch {
      return generic(500, 'owner package smoke failed');
    }
  };
}

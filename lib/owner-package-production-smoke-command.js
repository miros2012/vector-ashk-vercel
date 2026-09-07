import { verifyOwnerPackageProduction } from './owner-package-production-smoke.js';

function requireEnvObject(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error('env is required');
  }
  return env;
}

function requiredString(env, name) {
  const value = typeof env[name] === 'string' ? env[name].trim() : '';
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalString(env, name) {
  const value = typeof env[name] === 'string' ? env[name].trim() : '';
  return value || undefined;
}

function nonNegativeNumber(value, name, { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

export async function executeOwnerPackageProductionSmoke({
  env,
  fetchImpl,
  now,
  writeOutput
} = {}) {
  const source = requireEnvObject(env);
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof writeOutput !== 'function') throw new Error('writeOutput is required');

  const baseUrl = requiredString(source, 'VECTOR_OWNER_PACKAGE_BASE_URL');
  const key = requiredString(source, 'VECTOR_OWNER_API_KEY');
  const maxAgeMs = nonNegativeNumber(
    source.VECTOR_OWNER_PACKAGE_MAX_AGE_MS,
    'VECTOR_OWNER_PACKAGE_MAX_AGE_MS',
    { required: true }
  );
  const expectedSafeWithdrawal = nonNegativeNumber(
    source.VECTOR_OWNER_EXPECTED_SAFE_WITHDRAWAL,
    'VECTOR_OWNER_EXPECTED_SAFE_WITHDRAWAL'
  );
  const requiredPolicyBlocker = optionalString(source, 'VECTOR_OWNER_REQUIRED_POLICY_BLOCKER');

  const attestation = await verifyOwnerPackageProduction({
    baseUrl,
    key,
    fetchImpl,
    now,
    maxAgeMs,
    expectedSafeWithdrawal,
    requiredPolicyBlocker
  });

  writeOutput(JSON.stringify(attestation));
  return attestation;
}

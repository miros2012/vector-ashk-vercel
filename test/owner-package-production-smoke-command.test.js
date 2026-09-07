import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeOwnerPackageProductionSmoke } from '../lib/owner-package-production-smoke-command.js';

function response({
  status = 200,
  cacheControl = 'private, no-store',
  body
} = {}) {
  return {
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'cache-control' ? cacheControl : null;
      }
    },
    async json() {
      return body;
    }
  };
}

function validBody() {
  return {
    ok: true,
    package: {
      policy: {
        blockers: ['OPERATING_RESERVE_UNDEFINED']
      },
      withdrawal: {
        safeWithdrawal: 0
      },
      summary: {
        safeWithdrawal: 0
      },
      snapshot: {
        businessDate: '2026-09-07',
        generatedAt: '2026-09-07T15:44:30.000Z'
      },
      sensitiveExample: 'must-never-be-printed'
    }
  };
}

const validEnv = {
  VECTOR_OWNER_PACKAGE_BASE_URL: 'https://vector.example.test',
  VECTOR_OWNER_API_KEY: 'owner-secret',
  VECTOR_OWNER_PACKAGE_MAX_AGE_MS: '60000',
  VECTOR_OWNER_EXPECTED_SAFE_WITHDRAWAL: '0',
  VECTOR_OWNER_REQUIRED_POLICY_BLOCKER: 'OPERATING_RESERVE_UNDEFINED'
};

test('executes one read-only production verification from explicit environment inputs and prints only the compact attestation', async () => {
  const calls = [];
  const output = [];

  const result = await executeOwnerPackageProductionSmoke({
    env: { ...validEnv },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ body: validBody() });
    },
    now: '2026-09-07T15:45:00.000Z',
    writeOutput(line) {
      output.push(line);
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers['x-vector-key'], 'owner-secret');
  assert.equal(output.length, 1);
  const printed = JSON.parse(output[0]);
  assert.deepEqual(printed, result);
  assert.equal(printed.safeWithdrawal, 0);
  assert.deepEqual(printed.policyBlockers, ['OPERATING_RESERVE_UNDEFINED']);
  assert.equal(output[0].includes('owner-secret'), false);
  assert.equal(output[0].includes('must-never-be-printed'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('fails before fetch when required command environment is missing or malformed', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response({ body: validBody() });
  };

  for (const env of [
    { ...validEnv, VECTOR_OWNER_PACKAGE_BASE_URL: '' },
    { ...validEnv, VECTOR_OWNER_API_KEY: '' },
    { ...validEnv, VECTOR_OWNER_PACKAGE_MAX_AGE_MS: '' },
    { ...validEnv, VECTOR_OWNER_PACKAGE_MAX_AGE_MS: '-1' },
    { ...validEnv, VECTOR_OWNER_PACKAGE_MAX_AGE_MS: 'not-a-number' },
    { ...validEnv, VECTOR_OWNER_EXPECTED_SAFE_WITHDRAWAL: '-1' }
  ]) {
    await assert.rejects(
      executeOwnerPackageProductionSmoke({
        env,
        fetchImpl,
        now: '2026-09-07T15:45:00.000Z',
        writeOutput() {}
      })
    );
  }

  assert.equal(calls, 0);
});

test('allows optional expectation fields to be omitted without inventing business assumptions', async () => {
  const env = {
    VECTOR_OWNER_PACKAGE_BASE_URL: 'https://vector.example.test',
    VECTOR_OWNER_API_KEY: 'owner-secret',
    VECTOR_OWNER_PACKAGE_MAX_AGE_MS: '60000'
  };

  const result = await executeOwnerPackageProductionSmoke({
    env,
    fetchImpl: async () => response({ body: validBody() }),
    now: '2026-09-07T15:45:00.000Z',
    writeOutput() {}
  });

  assert.equal(result.safeWithdrawal, 0);
  assert.deepEqual(result.policyBlockers, ['OPERATING_RESERVE_UNDEFINED']);
});

test('the executable fails closed without leaking the owner API key', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/verify-owner-package-production.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VECTOR_OWNER_PACKAGE_BASE_URL: 'http://unsafe.example.test',
      VECTOR_OWNER_API_KEY: 'TOP-SECRET-OWNER-KEY',
      VECTOR_OWNER_PACKAGE_MAX_AGE_MS: '60000'
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /owner package production smoke failed/i);
  assert.equal(result.stderr.includes('TOP-SECRET-OWNER-KEY'), false);
  assert.equal(result.stdout, '');
});

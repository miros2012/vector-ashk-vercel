import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOwnerPackageProduction } from '../lib/owner-package-production-smoke.js';

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

function validBody(overrides = {}) {
  const body = {
    ok: true,
    package: {
      policy: {
        operatingReserve: { defined: false, amount: null },
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
        generatedAt: '2026-09-07T14:44:30.000Z'
      }
    }
  };
  return {
    ...body,
    ...overrides,
    package: {
      ...body.package,
      ...(overrides.package || {})
    }
  };
}

test('verifies one authenticated GET and returns a compact immutable attestation', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response({ body: validBody() });
  };

  const result = await verifyOwnerPackageProduction({
    baseUrl: 'https://vector.example.test',
    key: 'owner-secret',
    fetchImpl,
    now: '2026-09-07T14:45:00.000Z',
    maxAgeMs: 60_000,
    expectedSafeWithdrawal: 0,
    requiredPolicyBlocker: 'OPERATING_RESERVE_UNDEFINED'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://vector.example.test/api/owner-package');
  assert.deepEqual(calls[0].options, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-vector-key': 'owner-secret'
    },
    redirect: 'error',
    cache: 'no-store'
  });
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    cacheControl: 'private, no-store',
    businessDate: '2026-09-07',
    generatedAt: '2026-09-07T14:44:30.000Z',
    ageMs: 30_000,
    safeWithdrawal: 0,
    operatingReserveDefined: false,
    policyBlockers: ['OPERATING_RESERVE_UNDEFINED']
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.policyBlockers), true);
});

test('fails before fetch for unsafe or incomplete invocation', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return response({ body: validBody() });
  };

  await assert.rejects(
    verifyOwnerPackageProduction({
      baseUrl: 'http://vector.example.test',
      key: 'owner-secret',
      fetchImpl,
      now: '2026-09-07T14:45:00.000Z',
      maxAgeMs: 60_000,
      expectedSafeWithdrawal: 0
    }),
    /baseUrl must use https/
  );
  await assert.rejects(
    verifyOwnerPackageProduction({
      baseUrl: 'https://vector.example.test',
      key: '   ',
      fetchImpl,
      now: '2026-09-07T14:45:00.000Z',
      maxAgeMs: 60_000,
      expectedSafeWithdrawal: 0
    }),
    /key is required/
  );
  assert.equal(called, false);
});

test('fails closed on status, cache policy, malformed body, and conflicting withdrawal facts', async () => {
  const base = {
    baseUrl: 'https://vector.example.test',
    key: 'owner-secret',
    now: '2026-09-07T14:45:00.000Z',
    maxAgeMs: 60_000,
    expectedSafeWithdrawal: 0
  };

  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({ status: 403, body: { ok: false } })
    }),
    /unexpected HTTP status: 403/
  );
  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({ cacheControl: 'private', body: validBody() })
    }),
    /Cache-Control must include no-store/
  );
  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({ body: { ok: true } })
    }),
    /package is required/
  );
  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({
        body: validBody({
          package: {
            withdrawal: { safeWithdrawal: 1 },
            summary: { safeWithdrawal: 0 }
          }
        })
      })
    }),
    /safeWithdrawal facts conflict/
  );
});

test('fails closed on stale/future snapshots and invalid blocker lists', async () => {
  const base = {
    baseUrl: 'https://vector.example.test',
    key: 'owner-secret',
    now: '2026-09-07T14:45:00.000Z',
    maxAgeMs: 60_000,
    expectedSafeWithdrawal: 0,
    requiredPolicyBlocker: 'OPERATING_RESERVE_UNDEFINED'
  };

  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({
        body: validBody({
          package: { snapshot: { businessDate: '2026-09-07', generatedAt: '2026-09-07T14:43:00.000Z' } }
        })
      })
    }),
    /snapshot is stale/
  );
  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({
        body: validBody({
          package: { snapshot: { businessDate: '2026-09-07', generatedAt: '2026-09-07T14:46:00.000Z' } }
        })
      })
    }),
    /snapshot is from the future/
  );
  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({
        body: validBody({ package: { policy: { blockers: ['', 'X', 'X'] } } })
      })
    }),
    /policy blockers must be unique non-empty strings/
  );
});

test('requires explicit expected withdrawal/blocker contracts without mutating them', async () => {
  const input = {
    baseUrl: 'https://vector.example.test/',
    key: 'owner-secret',
    fetchImpl: async () => response({ body: validBody() }),
    now: '2026-09-07T14:45:00.000Z',
    maxAgeMs: 60_000,
    expectedSafeWithdrawal: 10,
    requiredPolicyBlocker: 'OPERATING_RESERVE_UNDEFINED'
  };
  const before = { ...input };

  await assert.rejects(
    verifyOwnerPackageProduction(input),
    /safeWithdrawal does not match expectation/
  );
  assert.deepEqual(input, before);

  await assert.rejects(
    verifyOwnerPackageProduction({
      ...input,
      expectedSafeWithdrawal: 0,
      requiredPolicyBlocker: 'OTHER_BLOCKER'
    }),
    /required policy blocker is missing/
  );
});

test('fails closed when undefined operating-reserve blocker contradicts a numeric or defined reserve', async () => {
  const base = {
    baseUrl: 'https://vector.example.test',
    key: 'owner-secret',
    now: '2026-09-07T14:45:00.000Z',
    maxAgeMs: 60_000,
    expectedSafeWithdrawal: 0,
    requiredPolicyBlocker: 'OPERATING_RESERVE_UNDEFINED'
  };

  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({
        body: validBody({
          package: {
            policy: {
              operatingReserve: { defined: true, amount: 300_000 },
              blockers: ['OPERATING_RESERVE_UNDEFINED']
            }
          }
        })
      })
    }),
    /operating reserve policy conflicts with blockers/
  );

  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response({
        body: validBody({
          package: {
            policy: {
              operatingReserve: { defined: false, amount: 300_000 },
              blockers: ['OPERATING_RESERVE_UNDEFINED']
            }
          }
        })
      })
    }),
    /undefined operating reserve must not include an amount/
  );
});

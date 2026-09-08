import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOwnerPackageProduction } from '../lib/owner-package-production-smoke.js';

function response(body) {
  return {
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'cache-control' ? 'private, no-store' : null;
      }
    },
    async json() {
      return body;
    }
  };
}

function ownerBody({ businessDate }) {
  return {
    ok: true,
    package: {
      policy: {
        operatingReserve: { defined: false, amount: null },
        blockers: ['OPERATING_RESERVE_UNDEFINED']
      },
      withdrawal: { safeWithdrawal: 0 },
      summary: { safeWithdrawal: 0 },
      snapshot: {
        businessDate,
        generatedAt: '2026-09-07T21:30:00.000Z'
      }
    }
  };
}

const base = {
  baseUrl: 'https://vector.example.test',
  key: 'owner-secret',
  now: '2026-09-07T21:30:30.000Z',
  maxAgeMs: 60_000,
  expectedSafeWithdrawal: 0,
  requiredPolicyBlocker: 'OPERATING_RESERVE_UNDEFINED'
};

test('fails closed when a fresh snapshot carries the previous Tyumen business date', async () => {
  await assert.rejects(
    verifyOwnerPackageProduction({
      ...base,
      fetchImpl: async () => response(ownerBody({ businessDate: '2026-09-07' }))
    }),
    /snapshot businessDate does not match current business date/
  );
});

test('accepts the Tyumen business date across the UTC date boundary', async () => {
  const result = await verifyOwnerPackageProduction({
    ...base,
    fetchImpl: async () => response(ownerBody({ businessDate: '2026-09-08' }))
  });

  assert.equal(result.businessDate, '2026-09-08');
});

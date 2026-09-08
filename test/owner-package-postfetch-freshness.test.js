import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOwnerPackageProduction } from '../lib/owner-package-production-smoke.js';

function response({ generatedAt }) {
  return {
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'cache-control' ? 'private, no-store' : null;
      }
    },
    async json() {
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
            businessDate: '2026-09-08',
            generatedAt
          }
        }
      };
    }
  };
}

function base({ fetchImpl, now }) {
  return {
    baseUrl: 'https://vector.example.test',
    key: 'owner-secret',
    fetchImpl,
    now,
    maxAgeMs: 300_000,
    expectedSafeWithdrawal: 0,
    requiredPolicyBlocker: 'OPERATING_RESERVE_UNDEFINED'
  };
}

test('freshness observes time after downstream GET so a package generated during the request is not falsely future', async () => {
  const order = [];
  const fetchImpl = async () => {
    order.push('fetch');
    return response({ generatedAt: '2026-09-08T14:51:52.000Z' });
  };
  const now = () => {
    order.push('now');
    return '2026-09-08T14:51:53.000Z';
  };

  const attestation = await verifyOwnerPackageProduction(base({ fetchImpl, now }));

  assert.deepEqual(order, ['fetch', 'now']);
  assert.equal(attestation.generatedAt, '2026-09-08T14:51:52.000Z');
  assert.equal(attestation.ageMs, 1_000);
});

test('post-fetch observation still fails closed for a truly future snapshot', async () => {
  const fetchImpl = async () => response({ generatedAt: '2026-09-08T14:51:54.000Z' });

  await assert.rejects(
    verifyOwnerPackageProduction(base({
      fetchImpl,
      now: () => '2026-09-08T14:51:53.000Z'
    })),
    /snapshot is from the future/
  );
});

test('post-fetch observation still fails closed when snapshot age exceeds 300 seconds', async () => {
  const fetchImpl = async () => response({ generatedAt: '2026-09-08T14:46:52.999Z' });

  await assert.rejects(
    verifyOwnerPackageProduction(base({
      fetchImpl,
      now: () => '2026-09-08T14:51:53.000Z'
    })),
    /snapshot is stale/
  );
});

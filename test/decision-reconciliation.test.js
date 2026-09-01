import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionReconciler } from '../lib/decision-reconciliation.js';

test('reconciler runs synchronizer in dry-run while backend writes are disabled', async () => {
  const calls = [];
  const reconcile = createDecisionReconciler({
    writesEnabled: false,
    synchronize: async (options) => {
      calls.push(options);
      return {
        ok: true,
        dryRun: true,
        total: 4,
        matchesBefore: 4,
        writeCount: 4,
        verified: false
      };
    }
  });

  const result = await reconcile({ trigger: 'balances' });

  assert.deepEqual(calls, [{ dryRun: true }]);
  assert.deepEqual(result, {
    ok: true,
    mode: 'dry-run',
    verified: false,
    total: 4,
    matches: 4,
    writeCount: 4,
    trigger: 'balances'
  });
});

test('reconciler requests guarded commit when backend writes are enabled', async () => {
  const calls = [];
  const reconcile = createDecisionReconciler({
    writesEnabled: true,
    synchronize: async (options) => {
      calls.push(options);
      return {
        ok: true,
        dryRun: false,
        total: 4,
        matchesBefore: 4,
        writeCount: 4,
        verified: true,
        matchesAfter: 4
      };
    }
  });

  const result = await reconcile({ trigger: 'daily-cron' });

  assert.deepEqual(calls, [{ dryRun: false }]);
  assert.deepEqual(result, {
    ok: true,
    mode: 'commit',
    verified: true,
    total: 4,
    matches: 4,
    writeCount: 4,
    trigger: 'daily-cron'
  });
});

test('reconciler records aggregate audit after a successful run', async () => {
  const audited = [];
  const reconcile = createDecisionReconciler({
    writesEnabled: false,
    synchronize: async () => ({ ok: true, dryRun: true, total: 4, matchesBefore: 4, writeCount: 16, verified: false }),
    audit: { record: async (value) => audited.push(value) }
  });

  const result = await reconcile({ trigger: 'balances' });

  assert.equal(audited.length, 1);
  assert.deepEqual(audited[0], result);
});

test('audit recording failure never fails reconciliation', async () => {
  const reconcile = createDecisionReconciler({
    writesEnabled: false,
    synchronize: async () => ({ ok: true, dryRun: true, total: 4, matchesBefore: 4, writeCount: 16, verified: false }),
    audit: { record: async () => { throw new Error('audit unavailable'); } },
    logger: { error: () => {} }
  });

  const result = await reconcile({ trigger: 'balances' });
  assert.equal(result.ok, true);
  assert.equal(result.matches, 4);
});

test('reconciler logs internal failure but throws only a generic public error', async () => {
  const logged = [];
  const reconcile = createDecisionReconciler({
    writesEnabled: false,
    logger: { error: (...args) => logged.push(args) },
    synchronize: async () => {
      throw new Error('sensitive mismatch details DEC-SECRET amount=999999');
    }
  });

  await assert.rejects(
    () => reconcile({ trigger: 'balances' }),
    (error) => {
      assert.equal(error.message, 'decision reconciliation failed');
      assert.ok(error.cause instanceof Error);
      return true;
    }
  );

  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'decision-reconciliation:');
  assert.match(String(logged[0][1]?.message), /sensitive mismatch details/);
});

test('reconciler validates required synchronize dependency', () => {
  assert.throws(
    () => createDecisionReconciler({ writesEnabled: false }),
    /synchronize is required/
  );
});

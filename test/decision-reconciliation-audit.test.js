import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionReconciliationAudit } from '../lib/decision-reconciliation-audit.js';

test('audit appends only aggregate reconciliation facts', async () => {
  const calls = [];
  const audit = createDecisionReconciliationAudit({
    appendRow: async (row) => calls.push(row),
    now: () => new Date('2026-09-01T10:30:00.000Z')
  });

  await audit.record({
    ok: true,
    mode: 'dry-run',
    verified: false,
    total: 4,
    matches: 4,
    writeCount: 16,
    trigger: 'balances',
    secretDetail: 'DEC-CRIT-DUE amount=1179607'
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    '2026-09-01T10:30:00.000Z',
    'balances',
    'dry-run',
    4,
    4,
    0,
    false,
    16,
    'OK'
  ]);
  assert.equal(JSON.stringify(calls[0]).includes('DEC-CRIT-DUE'), false);
  assert.equal(JSON.stringify(calls[0]).includes('1179607'), false);
});

test('audit computes drift and records failed aggregate status without throwing sensitive data', async () => {
  const calls = [];
  const audit = createDecisionReconciliationAudit({
    appendRow: async (row) => calls.push(row),
    now: () => new Date('2026-09-01T10:31:00.000Z')
  });

  await audit.record({
    ok: false,
    mode: 'commit',
    verified: false,
    total: 4,
    matches: 3,
    writeCount: 16,
    trigger: 'daily-cron'
  });

  assert.deepEqual(calls[0], [
    '2026-09-01T10:31:00.000Z',
    'daily-cron',
    'commit',
    3,
    4,
    1,
    false,
    16,
    'FAIL'
  ]);
});

test('audit failure never changes reconciliation result path', async () => {
  const logged = [];
  const audit = createDecisionReconciliationAudit({
    appendRow: async () => { throw new Error('sheet unavailable DEC-SECRET'); },
    logger: { error: (...args) => logged.push(args) }
  });

  const result = await audit.record({ ok: true, mode: 'dry-run', total: 4, matches: 4, trigger: 'balances' });

  assert.equal(result.ok, false);
  assert.equal(result.recorded, false);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'decision-reconciliation-audit:');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFinanceRunId,
  nextFinanceRetry,
  recoveryStages
} from '../lib/finance-retry-policy.js';

test('schedules retry attempts with the specified 10- and 30-minute delays', () => {
  const now = new Date('2026-09-18T00:00:00.000Z');
  assert.deepEqual(nextFinanceRetry({
    failure: { retryable: true, errorClass: 'ASHK_FETCH' },
    attempt: 1, now, runId: 'r1', stage: 'receivablesSource'
  }), {
    finance_retry_stage: 'receivablesSource',
    finance_retry_attempt: 2,
    finance_retry_after_utc: '2026-09-18T00:10:00.000Z',
    finance_retry_origin_run_id: 'r1',
    finance_retry_error_class: 'ASHK_FETCH'
  });
  assert.equal(nextFinanceRetry({
    failure: { retryable: true, errorClass: 'ROP_PUBLISH' },
    attempt: 2, now, runId: 'r1', stage: 'ropPublish'
  }).finance_retry_after_utc, '2026-09-18T00:30:00.000Z');
});

test('does not schedule permanent failures or an attempt-3 failure', () => {
  const input = { attempt: 1, now: new Date(), runId: 'r1', stage: 'ropPublish' };
  assert.equal(nextFinanceRetry({ ...input, failure: { retryable: false, errorClass: 'AUTH' } }), null);
  assert.equal(nextFinanceRetry({ ...input, attempt: 3, failure: { retryable: true } }), null);
});

test('does not persist retries for unsupported stages', () => {
  assert.equal(nextFinanceRetry({
    failure: { retryable: true, errorClass: 'TIME_BUDGET' },
    attempt: 1, now: new Date('2026-09-18T00:00:00.000Z'), runId: 'r1', stage: 'dataHealth'
  }), null);
  assert.equal(nextFinanceRetry({
    failure: { retryable: true, errorClass: 'TIME_BUDGET' },
    attempt: 1, now: new Date('2026-09-18T00:00:00.000Z'), runId: 'r1', stage: 'arbitraryStage'
  }), null);
});

test('returns the exact recovery stage sequence and owner-action option', () => {
  assert.deepEqual(recoveryStages('receivablesSource'), ['receivablesSource', 'ropPublish', 'dataHealth', 'decisions']);
  assert.deepEqual(recoveryStages('ropPublish', { includeOwnerActions: true }), ['ropPublish', 'dataHealth', 'decisions', 'ownerActionQueue']);
  assert.deepEqual(recoveryStages('unknown'), []);
});

test('creates a run ID from the UTC start timestamp and supplied random bytes', () => {
  assert.equal(createFinanceRunId(new Date('2026-09-18T00:00:00.000Z'), Buffer.from([0xab, 0xcd])), '2026-09-18T00:00:00.000Z-abcd');
});

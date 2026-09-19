import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFinanceStageFailure, financeStageSuccess } from '../lib/finance-stage-result.js';

test('sanitizes a retryable stage failure without exposing the exception', () => {
  assert.deepEqual(sanitizeFinanceStageFailure({
    stage: 'receivablesSource', statusCode: 503, errorClass: 'ASHK_FETCH',
    error: new Error('student Иван api-key=secret')
  }), { ok: false, statusCode: 503, errorClass: 'ASHK_FETCH', retryable: true });
});

test('maps an unknown class to non-retryable UNCLASSIFIED', () => {
  assert.deepEqual(sanitizeFinanceStageFailure({
    stage: 'ropPublish', statusCode: 500, errorClass: 'SyntaxError'
  }), { ok: false, statusCode: 500, errorClass: 'UNCLASSIFIED', retryable: false });
});

for (const [errorClass, retryable] of [
  ['ASHK_FETCH', true], ['SHEETS_WRITE', true], ['SHEETS_READBACK', true],
  ['ROP_PUBLISH', true], ['TIME_BUDGET', true], ['READBACK_MISMATCH', false],
  ['ROP_BUILD', false], ['LEDGER_WRITE', false], ['AUTH', false],
  ['VALIDATION', false], ['UNCLASSIFIED', false]
]) {
  test(`${errorClass} has the allowlisted retry policy and excludes raw metadata`, () => {
    assert.deepEqual(sanitizeFinanceStageFailure({
      statusCode: '503', errorClass, retryable: !retryable,
      error: new Error('PRIVATE'), providerBody: 'PRIVATE'
    }), { ok: false, statusCode: 503, errorClass, retryable });
  });
}

test('financeStageSuccess normalizes status and preserves its body without copying unrelated fields', () => {
  assert.deepEqual(financeStageSuccess(), { ok: true, statusCode: 200, body: undefined });
  assert.deepEqual(financeStageSuccess({ statusCode: '201', body: { verified: true }, error: 'PRIVATE' }), {
    ok: true, statusCode: 201, body: { verified: true }
  });
  assert.equal(financeStageSuccess({ statusCode: 'invalid' }).statusCode, 200);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FINANCE_LEDGER_HEADERS, financeLedgerRow } from '../lib/finance-run-ledger.js';

test('serializes a ledger entry into the exact 13-column schema', () => {
  assert.equal(FINANCE_LEDGER_HEADERS.length, 13);
  assert.deepEqual(financeLedgerRow({
    runId: 'r1', startedAtUtc: 's', finishedAtUtc: 'f', trigger: 'cron', mode: 'intraday',
    stage: 'ropPublish', attempt: 2, result: 'FAILED', statusCode: 502,
    errorClass: 'ROP_PUBLISH', retryable: true, retryAfterUtc: 'n', deploymentSha: 'sha'
  }), ['r1', 's', 'f', 'cron', 'intraday', 'ropPublish', 2, 'FAILED', 502, 'ROP_PUBLISH', true, 'n', 'sha']);
});

test('rejects an invalid ledger result', () => {
  assert.throws(() => financeLedgerRow({ result: 'INVALID', body: 'secret' }), /invalid ledger result/);
});

test('rejects payload-bearing fields even when the result is valid', () => {
  assert.throws(() => financeLedgerRow({ result: 'FAILED', responseBody: { secret: 'must not persist' } }), /unknown ledger field/);
});

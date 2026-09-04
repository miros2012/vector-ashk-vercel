import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeOneTimeFinanceRunToken,
  hashOneTimeFinanceRunToken,
  verifyOneTimeFinanceRunToken
} from '../lib/one-time-finance-run-token.js';

const NOW = new Date('2026-09-04T14:00:00.000Z');
const TOKEN = 'manual-run-token-with-enough-entropy';

function controlRows({
  hash = hashOneTimeFinanceRunToken(TOKEN),
  expires = '2026-09-04T14:05:00.000Z',
  consumed = ''
} = {}) {
  return [
    ['payments_live_enabled', 'true'],
    ['finance_manual_run_token_sha256', hash],
    ['finance_manual_run_expires_utc', expires],
    ['finance_manual_run_consumed_utc', consumed]
  ];
}

test('hashes a finance run token as lowercase sha256 hex', () => {
  const hash = hashOneTimeFinanceRunToken(TOKEN);
  assert.match(hash, /^[a-f\d]{64}$/);
  assert.equal(hash, hashOneTimeFinanceRunToken(TOKEN));
});

test('accepts only the exact unexpired token hash', () => {
  const expectedHash = hashOneTimeFinanceRunToken(TOKEN);
  assert.deepEqual(
    verifyOneTimeFinanceRunToken(TOKEN, {
      expectedHash,
      expiresUtc: '2026-09-04T14:05:00.000Z',
      now: NOW
    }),
    { ok: true, reason: 'authorized' }
  );
  assert.deepEqual(
    verifyOneTimeFinanceRunToken('wrong-token', {
      expectedHash,
      expiresUtc: '2026-09-04T14:05:00.000Z',
      now: NOW
    }),
    { ok: false, reason: 'token-mismatch' }
  );
  assert.deepEqual(
    verifyOneTimeFinanceRunToken(TOKEN, {
      expectedHash,
      expiresUtc: '2026-09-04T13:59:59.999Z',
      now: NOW
    }),
    { ok: false, reason: 'token-expired' }
  );
});

test('consumes the token before authorization completes and verifies the cleared readback', async () => {
  let rows = controlRows();
  const events = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => {
          events.push('read');
          return { data: { values: rows.map(row => [...row]) } };
        },
        batchUpdate: async payload => {
          events.push('consume');
          const data = payload.requestBody.data;
          assert.deepEqual(data.map(item => item.range), [
            "'__vercel_control'!B2",
            "'__vercel_control'!B3",
            "'__vercel_control'!B4"
          ]);
          rows = controlRows({
            hash: '',
            expires: '',
            consumed: '2026-09-04T14:00:00.000Z'
          });
          return {};
        }
      }
    }
  };

  const result = await consumeOneTimeFinanceRunToken({
    sheets,
    spreadsheetId: 'sheet-id',
    providedToken: TOKEN,
    now: () => NOW
  });

  assert.deepEqual(result, {
    ok: true,
    reason: 'consumed',
    consumedAt: '2026-09-04T14:00:00.000Z'
  });
  assert.deepEqual(events, ['read', 'consume', 'read']);
});

test('rejects a replay without writing again', async () => {
  let writes = 0;
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: controlRows({
          hash: '',
          expires: '',
          consumed: '2026-09-04T14:00:00.000Z'
        }) } }),
        batchUpdate: async () => { writes += 1; }
      }
    }
  };

  const result = await consumeOneTimeFinanceRunToken({
    sheets,
    spreadsheetId: 'sheet-id',
    providedToken: TOKEN,
    now: () => NOW
  });

  assert.deepEqual(result, { ok: false, reason: 'token-not-armed' });
  assert.equal(writes, 0);
});

test('fails closed when a required control marker is missing', async () => {
  let writes = 0;
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: controlRows().slice(0, 3) } }),
        batchUpdate: async () => { writes += 1; }
      }
    }
  };

  const result = await consumeOneTimeFinanceRunToken({
    sheets,
    spreadsheetId: 'sheet-id',
    providedToken: TOKEN,
    now: () => NOW
  });

  assert.deepEqual(result, { ok: false, reason: 'control-marker-missing' });
  assert.equal(writes, 0);
});

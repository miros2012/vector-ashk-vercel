import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeOneTimeFinanceRunToken,
  hashOneTimeFinanceRunToken,
  verifyOneTimeFinanceRunToken
} from '../lib/one-time-finance-run-token.js';

const NOW = new Date('2026-09-04T14:00:00.000Z');
const TOKEN = 'manual-run-token-with-enough-entropy';
const CONTROL_SHEET_ID = 628637437;

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

test('atomically claims the token before finalizing consumption and verifies readback', async () => {
  let rows = controlRows();
  const events = [];
  const expectedHash = hashOneTimeFinanceRunToken(TOKEN);
  const sheets = {
    spreadsheets: {
      get: async () => {
        events.push('metadata');
        return { data: { sheets: [{ properties: { title: '__vercel_control', sheetId: CONTROL_SHEET_ID } }] } };
      },
      batchUpdate: async payload => {
        events.push('claim');
        const claim = payload.requestBody.requests[0].findReplace;
        assert.deepEqual(claim, {
          find: expectedHash,
          replacement: '',
          range: {
            sheetId: CONTROL_SHEET_ID,
            startRowIndex: 1,
            endRowIndex: 2,
            startColumnIndex: 1,
            endColumnIndex: 2
          },
          matchCase: true,
          matchEntireCell: true
        });
        rows[1][1] = '';
        return { data: { replies: [{ findReplace: { occurrencesChanged: 1 } }] } };
      },
      values: {
        get: async () => {
          events.push('read');
          return { data: { values: rows.map(row => [...row]) } };
        },
        batchUpdate: async payload => {
          events.push('finalize');
          const data = payload.requestBody.data;
          assert.deepEqual(data.map(item => item.range), [
            "'__vercel_control'!B3",
            "'__vercel_control'!B4"
          ]);
          rows[2][1] = '';
          rows[3][1] = '2026-09-04T14:00:00.000Z';
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
  assert.deepEqual(events, ['read', 'metadata', 'claim', 'finalize', 'read']);
});

test('rejects a concurrent loser when the atomic hash claim changed zero cells', async () => {
  let finalizes = 0;
  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: { sheets: [{ properties: { title: '__vercel_control', sheetId: CONTROL_SHEET_ID } }] }
      }),
      batchUpdate: async () => ({
        data: { replies: [{ findReplace: { occurrencesChanged: 0 } }] }
      }),
      values: {
        get: async () => ({ data: { values: controlRows() } }),
        batchUpdate: async () => { finalizes += 1; }
      }
    }
  };

  const result = await consumeOneTimeFinanceRunToken({
    sheets,
    spreadsheetId: 'sheet-id',
    providedToken: TOKEN,
    now: () => NOW
  });

  assert.deepEqual(result, { ok: false, reason: 'token-already-claimed' });
  assert.equal(finalizes, 0);
});

test('rejects a replay without writing again', async () => {
  let writes = 0;
  const sheets = {
    spreadsheets: {
      get: async () => { writes += 1; },
      batchUpdate: async () => { writes += 1; },
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
      get: async () => { writes += 1; },
      batchUpdate: async () => { writes += 1; },
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
import test from 'node:test';
import assert from 'node:assert/strict';
import { withGoogleSheetsLease } from '../lib/google-sheets-lease.js';

const KEY = 'tochka_dds_import_lock';
const NOW = new Date('2026-09-04T16:40:00.000Z');

function sheetsLeaseMock(initial = 'IDLE') {
  let state = initial;
  const calls = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: async () => {
          calls.push(['get', state]);
          return { data: { values: [[KEY, state]] } };
        }
      },
      get: async () => ({ data: { sheets: [{ properties: { sheetId: 17, title: '__vercel_control' } }] } }),
      batchUpdate: async ({ requestBody }) => {
        const op = requestBody.requests[0].findReplace;
        calls.push(['cas', op.find, op.replacement]);
        const changed = state === op.find ? 1 : 0;
        if (changed) state = op.replacement;
        return { data: { replies: [{ findReplace: { occurrencesChanged: changed } }] } };
      }
    }
  };
  return { sheets, calls, get state() { return state; } };
}

test('lease atomically claims IDLE, runs once, and releases back to IDLE', async () => {
  const mock = sheetsLeaseMock();
  let runs = 0;
  const result = await withGoogleSheetsLease({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    key: KEY,
    now: () => NOW,
    run: async () => { runs += 1; return { ok: true }; }
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(runs, 1);
  assert.equal(mock.state, 'IDLE');
  assert.equal(mock.calls.filter(call => call[0] === 'cas').length, 2);
});

test('second contender fails closed while a live lease is held', async () => {
  const heldUntil = new Date(NOW.getTime() + 60_000).toISOString();
  const mock = sheetsLeaseMock(`LOCK|other-run|${heldUntil}`);
  let runs = 0;

  await assert.rejects(() => withGoogleSheetsLease({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    key: KEY,
    now: () => NOW,
    run: async () => { runs += 1; }
  }), /lease is held/i);

  assert.equal(runs, 0);
  assert.equal(mock.calls.filter(call => call[0] === 'cas').length, 0);
});

test('expired lease is reclaimed with compare-and-swap', async () => {
  const expired = new Date(NOW.getTime() - 1_000).toISOString();
  const mock = sheetsLeaseMock(`LOCK|dead-run|${expired}`);

  const result = await withGoogleSheetsLease({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    key: KEY,
    now: () => NOW,
    run: async () => 42
  });

  assert.equal(result, 42);
  assert.equal(mock.state, 'IDLE');
  assert.match(mock.calls.find(call => call[0] === 'cas')[1], /^LOCK\|dead-run\|/);
});

test('lease releases in finally when protected work fails', async () => {
  const mock = sheetsLeaseMock();

  await assert.rejects(() => withGoogleSheetsLease({
    sheets: mock.sheets,
    spreadsheetId: 'sheet-id',
    key: KEY,
    now: () => NOW,
    run: async () => { throw new Error('import failed'); }
  }), /import failed/i);

  assert.equal(mock.state, 'IDLE');
});

test('missing or malformed lease marker fails closed', async () => {
  const malformed = sheetsLeaseMock('BROKEN');
  await assert.rejects(() => withGoogleSheetsLease({
    sheets: malformed.sheets,
    spreadsheetId: 'sheet-id',
    key: KEY,
    now: () => NOW,
    run: async () => true
  }), /lease state invalid/i);
});

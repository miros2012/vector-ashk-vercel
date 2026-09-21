import test from 'node:test';
import assert from 'node:assert/strict';
import { FINANCE_LEDGER_HEADERS } from '../lib/finance-run-ledger.js';
import { createGoogleSheetsFinanceRunStore } from '../lib/google-sheets-finance-run-store.js';

const RETRY_STATE = {
  finance_retry_stage: 'ropPublish',
  finance_retry_attempt: 2,
  finance_retry_after_utc: '2026-09-18T00:10:00.000Z',
  finance_retry_origin_run_id: 'r1',
  finance_retry_error_class: 'ROP_PUBLISH'
};

function sheetsFake({ ledgerExists = false, controlRows = [], appendFailure = false, controlReadGate, beforeFindReplace } = {}) {
  const state = {
    ledgerExists,
    ledgerHidden: false,
    ledgerHeader: ledgerExists ? [...FINANCE_LEDGER_HEADERS] : [],
    ledgerRows: [],
    controlRows: controlRows.map(row => [...row])
  };
  const calls = [];
  const sheetId = 41;
  const controlId = 9;
  const titleFor = range => range.match(/^'(.+)'!/)?.[1]?.replace(/''/g, "'");
  const rowsFor = title => {
    if (title === 'Finance Run Ledger') return [state.ledgerHeader, ...state.ledgerRows];
    if (title === '__vercel_control') return state.controlRows;
    return [];
  };
  const sheets = {
    spreadsheets: {
      get: async payload => {
        calls.push(['metadata', payload]);
        const listed = [{ properties: { sheetId: controlId, title: '__vercel_control', hidden: false } }];
        if (state.ledgerExists) listed.push({ properties: { sheetId, title: 'Finance Run Ledger', hidden: state.ledgerHidden } });
        return { data: { sheets: listed } };
      },
      batchUpdate: async payload => {
        calls.push(['batchUpdate', payload]);
        for (const request of payload.requestBody.requests) {
          if (request.addSheet) {
            state.ledgerExists = true;
            state.ledgerHidden = Boolean(request.addSheet.properties.hidden);
            state.ledgerHeader = [];
          }
          if (request.updateSheetProperties?.properties?.sheetId === sheetId) {
            state.ledgerHidden = Boolean(request.updateSheetProperties.properties.hidden);
          }
          if (request.findReplace) {
            const operation = request.findReplace;
            await beforeFindReplace?.(operation);
            const row = state.controlRows[operation.range.startRowIndex];
            const changed = operation.searchByRegex
              ? Number(operation.find === '^$' && row?.[1] === '')
              : Number(row?.[1] === operation.find);
            if (changed) row[1] = operation.replacement;
            return { data: { replies: [{ findReplace: { occurrencesChanged: changed } }] } };
          }
        }
        return { data: {} };
      },
      values: {
        get: async payload => {
          calls.push(['get', payload]);
          const rows = rowsFor(titleFor(payload.range));
          if (payload.range.endsWith('A1:M1')) return { data: { values: [rows[0] || []] } };
          if (payload.range.endsWith('A2:G')) return { data: { values: state.ledgerRows.map(row => row.slice(0, 7)) } };
          if (payload.range.endsWith('A2:M')) return { data: { values: state.ledgerRows.map(row => [...row]) } };
          if (titleFor(payload.range) === '__vercel_control') await controlReadGate?.();
          return { data: { values: rows.map(row => [...row]) } };
        },
        append: async payload => {
          calls.push(['append', payload]);
          if (appendFailure) throw new Error('provider detail must not escape');
          const title = titleFor(payload.range);
          if (title === 'Finance Run Ledger') state.ledgerRows.push(...payload.requestBody.values.map(row => [...row]));
          if (title === '__vercel_control') state.controlRows.push(...payload.requestBody.values.map(row => [...row]));
          return { data: {} };
        },
        update: async payload => {
          calls.push(['update', payload]);
          const title = titleFor(payload.range);
          if (title === 'Finance Run Ledger') state.ledgerHeader = [...payload.requestBody.values[0]];
          if (title === '__vercel_control') {
            const rowNumber = Number(payload.range.match(/B(\d+)$/)?.[1]);
            state.controlRows[rowNumber - 1][1] = payload.requestBody.values[0][0];
          }
          return { data: {} };
        }
      }
    }
  };
  return { sheets, calls, state };
}

test('ensureSchema creates one hidden ledger sheet and verifies the exact 13 headers', async () => {
  const fake = sheetsFake();
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });

  const result = await store.ensureSchema();

  assert.deepEqual(result, { ok: true });
  assert.equal(fake.state.ledgerHidden, true);
  assert.deepEqual(fake.state.ledgerHeader, FINANCE_LEDGER_HEADERS);
  assert.equal(fake.calls.filter(([kind]) => kind === 'metadata').length, 1);
  assert.equal(fake.calls.filter(([kind, payload]) => kind === 'batchUpdate' && payload.requestBody.requests[0].addSheet).length, 1);
});

test('ensureSchema provisions every missing retry and lease control marker without changing unrelated rows', async () => {
  const fake = sheetsFake({ controlRows: [['unrelated_control', 'preserve']] });
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });

  assert.deepEqual(await store.ensureSchema(), { ok: true });
  assert.deepEqual(Object.fromEntries(fake.state.controlRows), {
    unrelated_control: 'preserve',
    finance_retry_stage: '',
    finance_retry_attempt: '',
    finance_retry_after_utc: '',
    finance_retry_origin_run_id: '',
    finance_retry_error_class: '',
    finance_orchestrator_lock: 'IDLE',
    finance_orchestrator_lock_until_utc: ''
  });
});

test('appendAttempt writes one 13-column row and verifies a unique attempt key', async () => {
  const fake = sheetsFake();
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });

  const result = await store.appendAttempt({ runId: 'r1', stage: 'ropPublish', attempt: 2, result: 'FAILED', statusCode: 502,
    errorClass: 'ROP_PUBLISH', retryable: true, startedAtUtc: 's', finishedAtUtc: 'f', trigger: 'cron', mode: 'intraday', retryAfterUtc: 'n', deploymentSha: 'sha' });

  assert.deepEqual(result, { ok: true, attemptKey: 'r1:ropPublish:2' });
  assert.equal(fake.state.ledgerRows[0].length, 13);
  assert.equal(fake.state.ledgerRows.filter(row => `${row[0]}:${row[5]}:${row[6]}` === 'r1:ropPublish:2').length, 1);
});

test('appendAttempt returns only LEDGER_WRITE when the Sheets write fails', async () => {
  const fake = sheetsFake({ appendFailure: true });
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });

  const result = await store.appendAttempt({ runId: 'r1', stage: 'ropPublish', attempt: 2, result: 'FAILED' });

  assert.deepEqual(result, { ok: false, errorClass: 'LEDGER_WRITE' });
  assert.equal(JSON.stringify(result).includes('provider detail'), false);
});

test('writeRetry, readRetry, and clearRetry use only the five exact retry control keys', async () => {
  const fake = sheetsFake({ controlRows: [
    ['unrelated_control', 'preserve'],
    ...Object.keys(RETRY_STATE).map(key => [key, ''])
  ] });
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });

  assert.deepEqual(await store.writeRetry(RETRY_STATE), { ok: true, state: RETRY_STATE });
  assert.deepEqual(await store.readRetry(), RETRY_STATE);
  assert.deepEqual(await store.clearRetry(), { ok: true });
  assert.equal(await store.readRetry(), null);
  assert.deepEqual(fake.state.controlRows[0], ['unrelated_control', 'preserve']);
});

test('acquireLease rejects a live foreign owner, takes an expired lease, and releases only its own lease', async () => {
  const now = new Date('2026-09-18T00:00:00.000Z');
  const fake = sheetsFake({ controlRows: [
    ['finance_orchestrator_lock', 'other-run|2026-09-18T00:01:00.000Z'],
    ['finance_orchestrator_lock_until_utc', '2026-09-18T00:01:00.000Z']
  ] });
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book', now: () => now });

  assert.deepEqual(await store.acquireLease({ runId: 'r1', leaseMs: 30_000 }), { ok: false, busy: true });
  fake.state.controlRows[0][1] = 'other-run|2026-09-17T23:59:59.000Z';
  fake.state.controlRows[1][1] = '2026-09-17T23:59:59.000Z';
  assert.deepEqual(await store.acquireLease({ runId: 'r1', leaseMs: 30_000 }), {
    ok: true,
    leaseUntilUtc: '2026-09-18T00:00:30.000Z',
    reclaimedLeaseOwner: 'other-run',
    reclaimedLeaseUntilUtc: '2026-09-17T23:59:59.000Z'
  });
  assert.deepEqual(await store.releaseLease({ runId: 'other-run' }), { ok: true, released: false });
  assert.deepEqual(await store.releaseLease({ runId: 'r1' }), { ok: true, released: true });
  assert.deepEqual(fake.state.controlRows.slice(0, 2), [
    ['finance_orchestrator_lock', 'IDLE'],
    ['finance_orchestrator_lock_until_utc', '']
  ]);
});

test('acquireLease does not overwrite a malformed foreign lease', async () => {
  const fake = sheetsFake({ controlRows: [
    ['finance_orchestrator_lock', 'other-run'],
    ['finance_orchestrator_lock_until_utc', 'not-a-time']
  ] });
  const store = createGoogleSheetsFinanceRunStore({
    sheets: fake.sheets,
    spreadsheetId: 'book',
    now: () => new Date('2026-09-18T00:00:00.000Z')
  });

  assert.deepEqual(await store.acquireLease({ runId: 'r1', leaseMs: 30_000 }), { ok: false, busy: true });
  assert.deepEqual(fake.state.controlRows, [
    ['finance_orchestrator_lock', 'other-run'],
    ['finance_orchestrator_lock_until_utc', 'not-a-time']
  ]);
});

test('acquireLease atomically normalizes an empty legacy lock before claiming it', async () => {
  const fake = sheetsFake({ controlRows: [
    ['finance_orchestrator_lock', ''],
    ['finance_orchestrator_lock_until_utc', '']
  ] });
  const store = createGoogleSheetsFinanceRunStore({
    sheets: fake.sheets,
    spreadsheetId: 'book',
    now: () => new Date('2026-09-18T00:00:00.000Z')
  });

  assert.deepEqual(await store.acquireLease({ runId: 'r1', leaseMs: 30_000 }), {
    ok: true,
    leaseUntilUtc: '2026-09-18T00:00:30.000Z'
  });
  const replacements = fake.calls.filter(([kind, payload]) => kind === 'batchUpdate'
    && payload.requestBody.requests[0].findReplace).map(([, payload]) => payload.requestBody.requests[0].findReplace);
  assert.deepEqual(replacements.map(operation => [operation.find, operation.replacement, operation.searchByRegex]), [
    ['^$', 'IDLE', true],
    ['IDLE', 'r1|2026-09-18T00:00:30.000Z', undefined]
  ]);
});

test('only one contender can replace the same IDLE lease token', async () => {
  let arrived = 0;
  let releaseReads;
  const bothRead = new Promise(resolve => { releaseReads = resolve; });
  const fake = sheetsFake({
    controlRows: [
      ['finance_orchestrator_lock', 'IDLE'],
      ['finance_orchestrator_lock_until_utc', '']
    ],
    controlReadGate: async () => {
      arrived += 1;
      if (arrived === 2) releaseReads();
      await bothRead;
    }
  });
  const options = { sheets: fake.sheets, spreadsheetId: 'book', now: () => new Date('2026-09-18T00:00:00.000Z') };

  const results = await Promise.all([
    createGoogleSheetsFinanceRunStore(options).acquireLease({ runId: 'r1', leaseMs: 30_000 }),
    createGoogleSheetsFinanceRunStore(options).acquireLease({ runId: 'r2', leaseMs: 30_000 })
  ]);

  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.busy).length, 1);
  assert.match(fake.state.controlRows[0][1], /^(r1|r2)\|2026-09-18T00:00:30.000Z$/);
});

test('release snapshots a token then conditionally fails after a successor claims it', async () => {
  let entered;
  let continueReplace;
  const replaceStarted = new Promise(resolve => { entered = resolve; });
  let staleOperation = true;
  const fake = sheetsFake({
    controlRows: [
      ['finance_orchestrator_lock', 'r1|2026-09-18T00:00:30.000Z'],
      ['finance_orchestrator_lock_until_utc', '2026-09-18T00:00:30.000Z']
    ],
    beforeFindReplace: async operation => {
      if (!staleOperation || operation.find !== 'r1|2026-09-18T00:00:30.000Z') return;
      staleOperation = false;
      entered();
      await new Promise(resolve => { continueReplace = resolve; });
    }
  });
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });

  const staleRelease = store.releaseLease({ runId: 'r1' });
  await Promise.race([
    replaceStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error('release never reached conditional replace')), 100))
  ]);
  fake.state.controlRows[0][1] = 'r2|2026-09-18T00:01:00.000Z';
  fake.state.controlRows[1][1] = '2026-09-18T00:01:00.000Z';
  continueReplace();

  assert.deepEqual(await staleRelease, { ok: true, released: false });
  assert.deepEqual(fake.state.controlRows.slice(0, 2), [
    ['finance_orchestrator_lock', 'r2|2026-09-18T00:01:00.000Z'],
    ['finance_orchestrator_lock_until_utc', '2026-09-18T00:01:00.000Z']
  ]);
});

test('a partial retry clear remains durably blocked at every failed write', async () => {
  for (let failAt = 1; failAt <= 6; failAt += 1) {
    const fake = sheetsFake({ controlRows: Object.entries({ ...RETRY_STATE, finance_retry_after_utc: 'CLAIMED' }) });
    const update = fake.sheets.spreadsheets.values.update;
    let writes = 0;
    fake.sheets.spreadsheets.values.update = async payload => {
      if (++writes === failAt) throw new Error('private write failure');
      return update(payload);
    };
    const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });
    assert.deepEqual(await store.clearRetry(), { ok: false, errorClass: 'LEDGER_WRITE' }, `write ${failAt}`);
    const remaining = await store.readRetry();
    if (failAt === 6) assert.equal(remaining, null, 'terminal CLEARING can be completed safely');
    else assert.ok(remaining?.ok === false || remaining?.finance_retry_after_utc === 'CLAIMED', `write ${failAt} must block`);
  }
});

test('readRetry rejects malformed or partial nonempty state instead of returning a usable retry', async () => {
  for (const [key, value] of [
    ['finance_retry_stage', ''], ['finance_retry_stage', 'payments'],
    ['finance_retry_attempt', ''], ['finance_retry_attempt', 4],
    ['finance_retry_after_utc', ''], ['finance_retry_after_utc', 'invalid'], ['finance_retry_after_utc', '1'],
    ['finance_retry_origin_run_id', ''], ['finance_retry_error_class', 'AUTH']
  ]) {
    const fake = sheetsFake({ controlRows: Object.entries({ ...RETRY_STATE, [key]: value }) });
    const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });
    assert.deepEqual(await store.readRetry(), { ok: false, errorClass: 'LEDGER_WRITE' }, key);
  }
});

test('readRetry finishes a stranded terminal CLEARING sentinel', async () => {
  const fake = sheetsFake({
    controlRows: Object.keys(RETRY_STATE).map(key => [
      key,
      key === 'finance_retry_after_utc' ? 'CLEARING' : ''
    ])
  });
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });

  assert.equal(await store.readRetry(), null);
  assert.equal(
    fake.state.controlRows.find(([key]) => key === 'finance_retry_after_utc')?.[1],
    ''
  );
});

test('duplicate retry control keys cannot hide nonempty partial state', async () => {
  const fake = sheetsFake({ controlRows: [
    ...Object.keys(RETRY_STATE).map(key => [key, '']), ['finance_retry_stage', 'ropPublish']
  ] });
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });
  assert.deepEqual(await store.readRetry(), { ok: false, errorClass: 'LEDGER_WRITE' });
});

const ATTEMPT = {
  runId: 'r1', stage: 'ropPublish', attempt: 2, result: 'FAILED', statusCode: 502,
  errorClass: 'ROP_PUBLISH', retryable: true, startedAtUtc: '2026-09-18T00:00:00.000Z',
  finishedAtUtc: '2026-09-18T00:00:01.000Z', trigger: 'cron', mode: 'intraday',
  retryAfterUtc: '2026-09-18T00:30:01.000Z', deploymentSha: 'sha'
};

test('replaying an identical attempt succeeds without appending a second row', async () => {
  const fake = sheetsFake();
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });
  assert.equal((await store.appendAttempt(ATTEMPT)).ok, true);
  assert.deepEqual(await store.appendAttempt({ ...ATTEMPT }), { ok: true, attemptKey: 'r1:ropPublish:2' });
  assert.equal(fake.state.ledgerRows.length, 1);
});

test('a lost append response succeeds after exact row readback without a second append', async () => {
  const fake = sheetsFake();
  const append = fake.sheets.spreadsheets.values.append;
  fake.sheets.spreadsheets.values.append = async payload => {
    await append(payload);
    throw new Error('provider private transport error');
  };
  const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });
  assert.deepEqual(await store.appendAttempt(ATTEMPT), { ok: true, attemptKey: 'r1:ropPublish:2' });
  assert.equal(fake.state.ledgerRows.length, 1);
});

test('duplicate or conflicting existing attempt rows fail closed without another append', async () => {
  for (const duplicate of [false, true]) {
    const fake = sheetsFake();
    const store = createGoogleSheetsFinanceRunStore({ sheets: fake.sheets, spreadsheetId: 'book' });
    await store.appendAttempt(ATTEMPT);
    if (duplicate) fake.state.ledgerRows.push([...fake.state.ledgerRows[0]]);
    else fake.state.ledgerRows[0][7] = 'SUCCESS';
    const before = fake.state.ledgerRows.length;
    assert.deepEqual(await store.appendAttempt(ATTEMPT), { ok: false, errorClass: 'LEDGER_WRITE' });
    assert.equal(fake.state.ledgerRows.length, before);
  }
});

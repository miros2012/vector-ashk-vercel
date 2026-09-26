import { FINANCE_LEDGER_HEADERS, financeLedgerRow } from './finance-run-ledger.js';
import { validFinanceRetryState } from './finance-retry-policy.js';
import { boundedGoogleSheetsRequest } from './google-sheets-lease.js';

const DEFAULT_LEDGER_SHEET = 'Finance Run Ledger';
const DEFAULT_CONTROL_SHEET = '__vercel_control';
const RETRY_KEYS = Object.freeze([
  'finance_retry_stage',
  'finance_retry_attempt',
  'finance_retry_after_utc',
  'finance_retry_origin_run_id',
  'finance_retry_error_class'
]);
const LEASE_KEY = 'finance_orchestrator_lock';
const LEASE_UNTIL_KEY = 'finance_orchestrator_lock_until_utc';
const IDLE_LEASE = 'IDLE';
const CONTROL_DEFAULTS = Object.freeze({
  ...Object.fromEntries(RETRY_KEYS.map(key => [key, ''])),
  [LEASE_KEY]: IDLE_LEASE,
  [LEASE_UNTIL_KEY]: ''
});

function safeFailure() {
  return { ok: false, errorClass: 'LEDGER_WRITE' };
}

function requiredText(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error('required value missing');
  return normalized;
}

function sheetRange(sheetName, range) {
  return `'${requiredText(sheetName).replace(/'/g, "''")}'!${range}`;
}

function exactCell(value) {
  return String(value ?? '');
}

function exactRowsByKey(rows) {
  const byKey = new Map();
  for (const [key, value] of Array.isArray(rows) ? rows : []) {
    if (!byKey.has(exactCell(key))) byKey.set(exactCell(key), exactCell(value));
  }
  return byKey;
}

function sameValues(left, right) {
  return exactCell(left) === exactCell(right);
}

function controlMarker(rows, key) {
  const index = (Array.isArray(rows) ? rows : []).findIndex(row => exactCell(row?.[0]) === key);
  return index < 0 ? null : { rowNumber: index + 1, value: exactCell(rows[index]?.[1]) };
}

function parseLeaseToken(token) {
  if (token === IDLE_LEASE) return { idle: true };
  const match = token.match(/^([^|]+)\|(.+)$/);
  if (!match) return null;
  const until = new Date(match[2]);
  if (!Number.isFinite(until.getTime())) return null;
  return { idle: false, owner: match[1], leaseUntilUtc: match[2], until };
}

export function createGoogleSheetsFinanceRunStore({
  sheets,
  spreadsheetId,
  ledgerSheet = DEFAULT_LEDGER_SHEET,
  controlSheet = DEFAULT_CONTROL_SHEET,
  now = () => new Date(),
  requestTimeoutMs
} = {}) {
  let schemaReady = false;

  function client() {
    if (!sheets?.spreadsheets?.values?.get
      || !sheets.spreadsheets.values.append
      || !sheets.spreadsheets.values.update
      || !sheets.spreadsheets.get
      || !sheets.spreadsheets.batchUpdate) throw new Error('sheets client missing');
    return sheets;
  }

  function id() {
    return requiredText(spreadsheetId);
  }

  const request = (execute, phase) => boundedGoogleSheetsRequest(execute, requestTimeoutMs, phase);

  async function controlRows() {
    const result = await request(options => client().spreadsheets.values.get({
      spreadsheetId: id(),
      range: sheetRange(controlSheet, 'A:B'),
      valueRenderOption: 'UNFORMATTED_VALUE'
    }, options), 'finance-control-read');
    return result?.data?.values || [];
  }

  async function writeControl(entries) {
    const rows = await controlRows();
    const updates = [];
    const additions = [];
    for (const [key, value] of Object.entries(entries)) {
      const rowIndex = rows.findIndex(row => exactCell(row?.[0]) === key);
      if (rowIndex < 0) additions.push([key, value]);
      else updates.push({ rowNumber: rowIndex + 1, value });
    }
    for (const update of updates) {
      await request(options => client().spreadsheets.values.update({
        spreadsheetId: id(),
        range: sheetRange(controlSheet, `B${update.rowNumber}`),
        valueInputOption: 'RAW',
        requestBody: { values: [[update.value]] }
      }, options), 'finance-control-update');
    }
    if (additions.length) {
      try {
        await request(options => client().spreadsheets.values.append({
          spreadsheetId: id(),
          range: sheetRange(controlSheet, 'A:B'),
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: additions }
        }, options), 'finance-control-append');
      } catch {
        // A transport error may follow a committed append; verify below.
      }
    }
    const readback = exactRowsByKey(await controlRows());
    return Object.entries(entries).every(([key, value]) => sameValues(readback.get(key), value));
  }

  async function controlSheetId() {
    const metadata = await request(options => client().spreadsheets.get({
      spreadsheetId: id(),
      fields: 'sheets.properties(sheetId,title)'
    }, options), 'finance-control-metadata');
    const sheet = (metadata?.data?.sheets || []).find(item => item?.properties?.title === controlSheet);
    const sheetId = Number(sheet?.properties?.sheetId);
    if (!Number.isInteger(sheetId)) throw new Error('control sheet missing');
    return sheetId;
  }

  async function replaceLeaseToken({ sheetId, rowNumber, expected, replacement, searchByRegex = false }) {
    const response = await request(options => client().spreadsheets.batchUpdate({
      spreadsheetId: id(),
      requestBody: {
        requests: [{
          findReplace: {
            find: expected,
            replacement,
            range: {
              sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: 1,
              endColumnIndex: 2
            },
            matchCase: true,
            matchEntireCell: true,
            ...(searchByRegex ? { searchByRegex: true } : {})
          }
        }]
      }
    }, options), 'finance-control-cas');
    return Number(response?.data?.replies?.[0]?.findReplace?.occurrencesChanged || 0) === 1;
  }

  async function ensureSchema() {
    try {
      if (schemaReady) return { ok: true };
      const metadata = await request(options => client().spreadsheets.get({
        spreadsheetId: id(),
        fields: 'sheets.properties(sheetId,title,hidden)'
      }, options), 'finance-schema-metadata');
      const existing = (metadata?.data?.sheets || []).find(sheet => sheet?.properties?.title === ledgerSheet);
      if (!existing) {
        await request(options => client().spreadsheets.batchUpdate({
          spreadsheetId: id(),
          requestBody: { requests: [{ addSheet: { properties: { title: ledgerSheet, hidden: true } } }] }
        }, options), 'finance-schema-add');
      } else if (!existing.properties.hidden) {
        await request(options => client().spreadsheets.batchUpdate({
          spreadsheetId: id(),
          requestBody: {
            requests: [{
              updateSheetProperties: {
                properties: { sheetId: existing.properties.sheetId, hidden: true },
                fields: 'hidden'
              }
            }]
          }
        }, options), 'finance-schema-hide');
      }

      const headerRange = sheetRange(ledgerSheet, 'A1:M1');
      const readHeader = async () => {
        const response = await request(options => client().spreadsheets.values.get({
          spreadsheetId: id(),
          range: headerRange,
          valueRenderOption: 'UNFORMATTED_VALUE'
        }, options), 'finance-schema-header-read');
        return response?.data?.values?.[0] || [];
      };
      let headers = await readHeader();
      if (headers.length !== FINANCE_LEDGER_HEADERS.length
        || headers.some((value, index) => value !== FINANCE_LEDGER_HEADERS[index])) {
        await request(options => client().spreadsheets.values.update({
          spreadsheetId: id(),
          range: headerRange,
          valueInputOption: 'RAW',
          requestBody: { values: [FINANCE_LEDGER_HEADERS] }
        }, options), 'finance-schema-header-update');
        headers = await readHeader();
      }
      if (headers.length !== FINANCE_LEDGER_HEADERS.length
        || headers.some((value, index) => value !== FINANCE_LEDGER_HEADERS[index])) return safeFailure();

      const existingControlRows = await controlRows();
      const missingControlEntries = Object.fromEntries(Object.entries(CONTROL_DEFAULTS)
        .filter(([key]) => !existingControlRows.some(row => exactCell(row?.[0]) === key)));
      if (Object.keys(missingControlEntries).length && !await writeControl(missingControlEntries)) return safeFailure();
      const verifiedControlRows = await controlRows();
      if (Object.keys(CONTROL_DEFAULTS).some(key =>
        verifiedControlRows.filter(row => exactCell(row?.[0]) === key).length !== 1)) return safeFailure();

      schemaReady = true;
      return { ok: true };
    } catch {
      return safeFailure();
    }
  }

  async function appendAttempt(entry) {
    try {
      const schema = await ensureSchema();
      if (!schema.ok) return schema;
      const row = financeLedgerRow(entry);
      const attemptKey = `${row[0]}:${row[5]}:${row[6]}`;
      const readMatching = async () => {
        const response = await request(options => client().spreadsheets.values.get({
          spreadsheetId: id(), range: sheetRange(ledgerSheet, 'A2:M'),
          valueRenderOption: 'UNFORMATTED_VALUE'
        }, options), 'finance-ledger-read');
        return (response?.data?.values || []).filter(value =>
          sameValues(value?.[0], row[0]) && sameValues(value?.[5], row[5]) && sameValues(value?.[6], row[6]));
      };
      const verified = matches => matches.length === 1
        && row.every((value, index) => sameValues(matches[0][index], value));
      // The orchestration lease serializes writers; replay must not append twice.
      const existing = await readMatching();
      if (existing.length) return verified(existing) ? { ok: true, attemptKey } : safeFailure();
      try {
        await request(options => client().spreadsheets.values.append({
          spreadsheetId: id(), range: sheetRange(ledgerSheet, 'A:M'),
          valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] }
        }, options), 'finance-ledger-append');
      } catch {
        // A transport error may follow a committed append. Read back, never retry append.
      }
      return verified(await readMatching()) ? { ok: true, attemptKey } : safeFailure();
    } catch {
      return safeFailure();
    }
  }

  async function readRetry() {
    try {
      const rows = await controlRows();
      if (RETRY_KEYS.some(key => rows.filter(row => exactCell(row?.[0]) === key).length > 1)) return safeFailure();
      const byKey = exactRowsByKey(rows);
      const state = Object.fromEntries(RETRY_KEYS.map(key => [key, byKey.get(key) ?? '']));
      if (RETRY_KEYS.every(key => state[key] === '')) return null;
      const terminalClearing = state.finance_retry_after_utc === 'CLEARING'
        && RETRY_KEYS
          .filter(key => key !== 'finance_retry_after_utc')
          .every(key => state[key] === '');
      if (terminalClearing) {
        return await writeControl({ finance_retry_after_utc: '' }) ? null : safeFailure();
      }
      if (!validFinanceRetryState(state, { allowClaimed: true })) return safeFailure();
      const attempt = Number(state.finance_retry_attempt);
      state.finance_retry_attempt = Number.isFinite(attempt) ? attempt : state.finance_retry_attempt;
      return state;
    } catch {
      return safeFailure();
    }
  }

  async function writeRetry(state = {}) {
    try {
      const entries = Object.fromEntries(RETRY_KEYS.map(key => [key, state[key] ?? '']));
      if (!await writeControl(entries)) return safeFailure();
      const readback = await readRetry();
      if (readback?.ok === false) return readback;
      return { ok: true, state: readback };
    } catch {
      return safeFailure();
    }
  }

  async function clearRetry() {
    try {
      // Keep a durable blocking sentinel until every other field is cleared.
      const sentinel = 'finance_retry_after_utc';
      if (!await writeControl({ [sentinel]: 'CLEARING' })) return safeFailure();
      if (!await writeControl(Object.fromEntries(RETRY_KEYS.filter(key => key !== sentinel).map(key => [key, ''])))) return safeFailure();
      if (!await writeControl({ [sentinel]: '' })) return safeFailure();
      return await readRetry() === null ? { ok: true } : safeFailure();
    } catch {
      return safeFailure();
    }
  }

  async function acquireLease({ runId, leaseMs } = {}) {
    try {
      const owner = requiredText(runId);
      if (owner.includes('|')) throw new Error('invalid lease owner');
      const duration = Number(leaseMs);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('invalid lease duration');
      const current = new Date(typeof now === 'function' ? now() : now);
      if (!Number.isFinite(current.getTime())) throw new Error('invalid current time');
      let marker = controlMarker(await controlRows(), LEASE_KEY);
      if (!marker) return safeFailure();
      if (marker.value === '') {
        const normalized = await replaceLeaseToken({
          sheetId: await controlSheetId(),
          rowNumber: marker.rowNumber,
          expected: '^$',
          replacement: IDLE_LEASE,
          searchByRegex: true
        });
        if (!normalized) return { ok: false, busy: true };
        marker = { ...marker, value: IDLE_LEASE };
      }
      const stored = parseLeaseToken(marker.value);
      if (!stored) return { ok: false, busy: true };
      if (!stored.idle && stored.until.getTime() > current.getTime()) {
        if (stored.owner === owner) return { ok: true, leaseUntilUtc: stored.leaseUntilUtc };
        return { ok: false, busy: true };
      }
      const leaseUntilUtc = new Date(current.getTime() + duration).toISOString();
      const leaseToken = `${owner}|${leaseUntilUtc}`;
      const claimed = await replaceLeaseToken({
        sheetId: await controlSheetId(),
        rowNumber: marker.rowNumber,
        expected: marker.value,
        replacement: leaseToken
      });
      if (!claimed) return { ok: false, busy: true };
      if (!await writeControl({ [LEASE_UNTIL_KEY]: leaseUntilUtc })) return safeFailure();
      return {
        ok: true,
        leaseUntilUtc,
        ...(!stored.idle ? {
          reclaimedLeaseOwner: stored.owner,
          reclaimedLeaseUntilUtc: stored.leaseUntilUtc
        } : {})
      };
    } catch {
      return safeFailure();
    }
  }

  async function releaseLease({ runId } = {}) {
    try {
      const owner = requiredText(runId);
      const marker = controlMarker(await controlRows(), LEASE_KEY);
      const stored = marker && parseLeaseToken(marker.value);
      if (!stored || stored.idle || stored.owner !== owner) return { ok: true, released: false };
      const released = await replaceLeaseToken({
        sheetId: await controlSheetId(),
        rowNumber: marker.rowNumber,
        expected: marker.value,
        replacement: IDLE_LEASE
      });
      if (!released) return { ok: true, released: false };
      if (!await writeControl({ [LEASE_UNTIL_KEY]: '' })) return safeFailure();
      return { ok: true, released: true };
    } catch {
      return safeFailure();
    }
  }

  return { ensureSchema, appendAttempt, readRetry, writeRetry, clearRetry, acquireLease, releaseLease };
}

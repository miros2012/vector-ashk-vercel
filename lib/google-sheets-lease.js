import { randomUUID } from 'node:crypto';

const DEFAULT_CONTROL_SHEET = '__vercel_control';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const IDLE = 'IDLE';

function text(value) {
  return String(value ?? '').trim();
}

function requiredText(value, name) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function escapedSheetName(value) {
  return requiredText(value, 'sheetName').replace(/'/g, "''");
}

function markerRow(rows, key) {
  const markerKey = requiredText(key, 'key');
  const index = (Array.isArray(rows) ? rows : []).findIndex(
    row => text(row?.[0]) === markerKey
  );
  return index < 0 ? null : { rowNumber: index + 1, value: text(rows[index]?.[1]) };
}

function parseLeaseState(value, now) {
  const state = text(value);
  if (state === IDLE) return { claimable: true, expected: state };
  const match = state.match(/^LOCK\|([^|]+)\|(.+)$/);
  if (!match) throw new Error('lease state invalid');
  const expiry = new Date(match[2]);
  if (!Number.isFinite(expiry.getTime())) throw new Error('lease state invalid');
  if (expiry.getTime() > now.getTime()) {
    return { claimable: false, expected: state };
  }
  return { claimable: true, expected: state };
}

async function readRows({ sheets, spreadsheetId, escapedTitle }) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${escapedTitle}'!A:B`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return response?.data?.values || [];
}

async function findSheetId({ sheets, spreadsheetId, title }) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)'
  });
  const sheet = (response?.data?.sheets || []).find(item => item?.properties?.title === title);
  const sheetId = Number(sheet?.properties?.sheetId);
  if (!Number.isInteger(sheetId)) throw new Error('lease control sheet not found');
  return sheetId;
}

async function compareAndSwap({
  sheets,
  spreadsheetId,
  sheetId,
  rowNumber,
  expected,
  replacement
}) {
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
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
          matchEntireCell: true
        }
      }]
    }
  });
  return Number(response?.data?.replies?.[0]?.findReplace?.occurrencesChanged || 0) === 1;
}

export async function withGoogleSheetsLease({
  sheets,
  spreadsheetId,
  key,
  run,
  now = () => new Date(),
  ttlMs = DEFAULT_TTL_MS,
  sheetName = DEFAULT_CONTROL_SHEET
} = {}) {
  if (!sheets?.spreadsheets?.values?.get
      || typeof sheets.spreadsheets.get !== 'function'
      || typeof sheets.spreadsheets.batchUpdate !== 'function') {
    throw new Error('sheets client is required');
  }
  if (typeof run !== 'function') throw new Error('run is required');
  const id = requiredText(spreadsheetId, 'spreadsheetId');
  const leaseKey = requiredText(key, 'key');
  const title = requiredText(sheetName, 'sheetName');
  const escapedTitle = escapedSheetName(title);
  const leaseTtl = Number(ttlMs);
  if (!Number.isFinite(leaseTtl) || leaseTtl <= 0) throw new Error('ttlMs is invalid');
  const currentValue = typeof now === 'function' ? now() : now;
  const current = currentValue instanceof Date ? currentValue : new Date(currentValue);
  if (!Number.isFinite(current.getTime())) throw new Error('now is invalid');

  const rows = await readRows({ sheets, spreadsheetId: id, escapedTitle });
  const marker = markerRow(rows, leaseKey);
  if (!marker) throw new Error('lease marker missing');
  const leaseState = parseLeaseState(marker.value, current);
  if (!leaseState.claimable) throw new Error('lease is held');

  const sheetId = await findSheetId({ sheets, spreadsheetId: id, title });
  const expiry = new Date(current.getTime() + leaseTtl).toISOString();
  const claim = `LOCK|${randomUUID()}|${expiry}`;
  const acquired = await compareAndSwap({
    sheets,
    spreadsheetId: id,
    sheetId,
    rowNumber: marker.rowNumber,
    expected: leaseState.expected,
    replacement: claim
  });
  if (!acquired) throw new Error('lease claim lost');

  let result;
  let failure = null;
  try {
    result = await run();
  } catch (error) {
    failure = error;
  }

  let released = false;
  try {
    released = await compareAndSwap({
      sheets,
      spreadsheetId: id,
      sheetId,
      rowNumber: marker.rowNumber,
      expected: claim,
      replacement: IDLE
    });
  } catch (error) {
    if (!failure) throw error;
  }

  if (!released && !failure) throw new Error('lease release failed');
  if (failure) throw failure;
  return result;
}

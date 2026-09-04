import { createHash, timingSafeEqual } from 'node:crypto';

const DEFAULT_CONTROL_SHEET = '__vercel_control';
const TOKEN_HASH_KEY = 'finance_manual_run_token_sha256';
const TOKEN_EXPIRES_KEY = 'finance_manual_run_expires_utc';
const TOKEN_CONSUMED_KEY = 'finance_manual_run_consumed_utc';

function text(value) {
  return String(value ?? '').trim();
}

function normalizedSheetName(value) {
  const name = text(value);
  if (!name) throw new Error('sheetName is required');
  return name.replace(/'/g, "''");
}

function requiredText(value, name) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function rowIndexByKey(rows = []) {
  const result = new Map();
  for (let index = 0; index < (Array.isArray(rows) ? rows.length : 0); index += 1) {
    const key = text(rows[index]?.[0]);
    if (key && !result.has(key)) result.set(key, index + 1);
  }
  return result;
}

function valueByKey(rows = [], key) {
  const row = (Array.isArray(rows) ? rows : []).find(item => text(item?.[0]) === key);
  return row?.[1] ?? '';
}

function safeHashEquals(leftHex, rightHex) {
  if (!/^[a-f\d]{64}$/i.test(leftHex) || !/^[a-f\d]{64}$/i.test(rightHex)) return false;
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashOneTimeFinanceRunToken(token) {
  const value = requiredText(token, 'token');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function verifyOneTimeFinanceRunToken(providedToken, {
  expectedHash,
  expiresUtc,
  now = new Date()
} = {}) {
  const token = text(providedToken);
  const armedHash = text(expectedHash).toLowerCase();
  const expiryText = text(expiresUtc);
  if (!armedHash || !expiryText) return { ok: false, reason: 'token-not-armed' };
  if (!token) return { ok: false, reason: 'token-missing' };
  if (!/^[a-f\d]{64}$/.test(armedHash)) return { ok: false, reason: 'token-state-invalid' };

  const expiry = new Date(expiryText);
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(expiry.getTime()) || !Number.isFinite(current.getTime())) {
    return { ok: false, reason: 'token-state-invalid' };
  }
  if (current.getTime() >= expiry.getTime()) return { ok: false, reason: 'token-expired' };

  const providedHash = hashOneTimeFinanceRunToken(token);
  if (!safeHashEquals(providedHash, armedHash)) return { ok: false, reason: 'token-mismatch' };
  return { ok: true, reason: 'authorized' };
}

async function readControlRows({ sheets, spreadsheetId, sheetName }) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:B`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return result?.data?.values || [];
}

export async function consumeOneTimeFinanceRunToken({
  sheets,
  spreadsheetId,
  providedToken,
  now = () => new Date(),
  sheetName = DEFAULT_CONTROL_SHEET
} = {}) {
  if (!sheets?.spreadsheets?.values) throw new Error('sheets client is required');
  const id = requiredText(spreadsheetId, 'spreadsheetId');
  const title = normalizedSheetName(sheetName);
  const current = typeof now === 'function' ? now() : now;
  const currentDate = current instanceof Date ? current : new Date(current);
  if (!Number.isFinite(currentDate.getTime())) throw new Error('now is invalid');

  const rows = await readControlRows({ sheets, spreadsheetId: id, sheetName: title });
  const indexes = rowIndexByKey(rows);
  const hashRow = indexes.get(TOKEN_HASH_KEY);
  const expiresRow = indexes.get(TOKEN_EXPIRES_KEY);
  const consumedRow = indexes.get(TOKEN_CONSUMED_KEY);
  if (!hashRow || !expiresRow || !consumedRow) {
    return { ok: false, reason: 'control-marker-missing' };
  }

  const verification = verifyOneTimeFinanceRunToken(providedToken, {
    expectedHash: valueByKey(rows, TOKEN_HASH_KEY),
    expiresUtc: valueByKey(rows, TOKEN_EXPIRES_KEY),
    now: currentDate
  });
  if (!verification.ok) return verification;

  const consumedAt = currentDate.toISOString();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `'${title}'!B${hashRow}`, values: [['']] },
        { range: `'${title}'!B${expiresRow}`, values: [['']] },
        { range: `'${title}'!B${consumedRow}`, values: [[consumedAt]] }
      ]
    }
  });

  const readback = await readControlRows({ sheets, spreadsheetId: id, sheetName: title });
  const clearedHash = text(valueByKey(readback, TOKEN_HASH_KEY));
  const clearedExpiry = text(valueByKey(readback, TOKEN_EXPIRES_KEY));
  const recordedConsumedAt = text(valueByKey(readback, TOKEN_CONSUMED_KEY));
  if (clearedHash || clearedExpiry || recordedConsumedAt !== consumedAt) {
    return { ok: false, reason: 'consume-readback-failed' };
  }

  return { ok: true, reason: 'consumed', consumedAt };
}
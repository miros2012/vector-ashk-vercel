import { google } from 'googleapis';
import { normalizeBalances } from '../lib/tochka-balances.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const BALANCES_SHEET = 'Точка_Остатки';
const DEFAULT_BRIDGE_URL = 'https://tochka-realtime-bridge.onrender.com';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

async function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

function requestKey(req) {
  return String(req.headers?.['x-vector-key'] || req.query?.key || '');
}

function requireInternalKey(req) {
  const expected = String(process.env.TOCHKA_BRIDGE_KEY || '');
  if (!expected) throw new Error('TOCHKA_BRIDGE_KEY missing');
  return requestKey(req) === expected;
}

async function fetchLiveBalances() {
  const key = String(process.env.TOCHKA_BRIDGE_KEY || '');
  if (!key) throw new Error('TOCHKA_BRIDGE_KEY missing');

  const base = String(process.env.TOCHKA_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const r = await fetch(`${base}/balances`, {
    headers: {
      Accept: 'application/json',
      'x-bridge-key': key
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Tochka bridge HTTP ${r.status}: ${text.slice(0, 500)}`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Tochka bridge returned non-JSON: ${text.slice(0, 500)}`);
  }
}

async function mirrorToGoogleSheet(normalized) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }

  const sheets = await sheetsClient();
  const now = new Date().toISOString();
  const rows = normalized.funds;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        {
          range: `'${BALANCES_SHEET}'!A6:A10`,
          values: rows.map(row => [row.dateTime || now])
        },
        {
          range: `'${BALANCES_SHEET}'!E6:F10`,
          values: rows.map(row => [row.closingAvailable, row.expected])
        },
        {
          range: `'${BALANCES_SHEET}'!L6:L10`,
          values: rows.map(row => [row.accountId || ''])
        }
      ]
    }
  });

  return { spreadsheetId: SPREADSHEET_ID, sheet: BALANCES_SHEET, mirroredAt: now };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Use GET or POST' });
  }

  try {
    if (!requireInternalKey(req)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const raw = await fetchLiveBalances();
    const normalized = normalizeBalances(raw);
    const shouldMirror = req.method === 'POST' || String(req.query?.mirror || '') === '1';
    const mirror = shouldMirror ? await mirrorToGoogleSheet(normalized) : null;

    console.log(JSON.stringify({
      event: 'tochka-balances',
      liveCount: normalized.summary.liveCount,
      totalAvailable: normalized.summary.totalAvailable,
      totalExpected: normalized.summary.totalExpected,
      mirrored: Boolean(mirror)
    }));

    return res.status(200).json({
      ok: true,
      source: 'tochka_live',
      fetchedAt: new Date().toISOString(),
      ...normalized,
      mirror
    });
  } catch (e) {
    console.error('balances:', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

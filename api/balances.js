import { google } from 'googleapis';
import { getVercelOidcToken } from '@vercel/oidc';
import { normalizeBalances } from '../lib/tochka-balances.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const BALANCES_SHEET = 'Точка_Остатки';
const DEFAULT_BRIDGE_URL = 'https://tochka-realtime-bridge.onrender.com';
const FRESH_MS = 30000;

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

async function fetchLiveBalances() {
  const token = await getVercelOidcToken();
  if (!token) throw new Error('VERCEL_OIDC_TOKEN unavailable');

  const base = String(process.env.TOCHKA_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const r = await fetch(`${base}/balances`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
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

async function readMirrorStatus(sheets) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${BALANCES_SHEET}'!A6:F10`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const rows = r.data.values || [];
  const timestamps = rows
    .map(row => Date.parse(String(row?.[0] || '')))
    .filter(Number.isFinite);
  const liveCount = rows.filter(row => {
    const value = row?.[4];
    return value !== '' && value !== undefined && Number.isFinite(Number(value));
  }).length;
  const lastMs = timestamps.length ? Math.max(...timestamps) : 0;
  return {
    liveCount,
    lastMs,
    lastUpdated: lastMs ? new Date(lastMs).toISOString() : null
  };
}

function isFresh(status) {
  return status.liveCount === 5 && status.lastMs > 0 && (Date.now() - status.lastMs) < FRESH_MS;
}

async function mirrorToGoogleSheet(normalized, sheets) {
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

  return { mirroredAt: now };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Use GET or POST' });
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google service account secrets missing');
    }

    const sheets = await sheetsClient();
    const before = await readMirrorStatus(sheets);

    if (isFresh(before)) {
      return res.status(200).json({
        ok: true,
        source: 'cached_live',
        refreshed: false,
        liveCount: before.liveCount,
        lastUpdated: before.lastUpdated
      });
    }

    const raw = await fetchLiveBalances();
    const normalized = normalizeBalances(raw);
    const mirror = await mirrorToGoogleSheet(normalized, sheets);

    console.log(JSON.stringify({
      event: 'tochka-balances-refresh',
      liveCount: normalized.summary.liveCount,
      mirroredAt: mirror.mirroredAt,
      trigger: req.method === 'POST' ? String(req.headers?.['x-vector-refresh'] || 'post') : 'get'
    }));

    return res.status(200).json({
      ok: true,
      source: 'tochka_live',
      refreshed: true,
      liveCount: normalized.summary.liveCount,
      lastUpdated: mirror.mirroredAt
    });
  } catch (e) {
    console.error('balances:', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

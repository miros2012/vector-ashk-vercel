import { google } from 'googleapis';
import {
  evaluateTochkaOperationAck,
  normalizeExpectedOperationIdentifiers
} from '../lib/tochka-operation-ack.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const TOCHKA_API_SHEET = 'Точка_API';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

async function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

function requestBody(req) {
  if (req?.body && typeof req.body === 'object') return req.body;
  if (typeof req?.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (String(req?.method || '').toUpperCase() !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }
  if (String(req?.headers?.['x-vector-refresh'] || '').trim() !== 'tochka-webhook') {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const expected = normalizeExpectedOperationIdentifiers(requestBody(req));
  if (!expected.transactionIds.length && !expected.paymentIds.length) {
    return res.status(400).json({ ok: false, error: 'At least one Tochka operation identifier is required' });
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google service account secrets missing');
    }
    const sheets = await sheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${TOCHKA_API_SHEET}'!M2:N`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const result = evaluateTochkaOperationAck({
      rows: response.data.values || [],
      ...expected
    });

    if (!result.ok) {
      return res.status(409).json({
        ok: false,
        mode: 'operation_ack_pending',
        ...result
      });
    }

    return res.status(200).json({
      ok: true,
      mode: 'operation_acknowledged',
      ...result
    });
  } catch (error) {
    console.error('tochka-operation-ack:', error?.name || 'Error');
    return res.status(500).json({ ok: false, error: 'Tochka operation acknowledgement failed' });
  }
}

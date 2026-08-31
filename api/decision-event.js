import { google } from 'googleapis';
import { createDecisionEventApi } from '../lib/decision-event-api.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

let executionHandler;

export default async function handler(req, res) {
  try {
    executionHandler ||= createDecisionEventApi({
      sheets: sheetsClient(),
      spreadsheetId: SPREADSHEET_ID,
      configuredKey: process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || ''
    });
    return await executionHandler(req, res);
  } catch (error) {
    console.error('decision-event:', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}

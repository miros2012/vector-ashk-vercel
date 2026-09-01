import { google } from 'googleapis';
import { createDecisionEffectivenessApi } from '../lib/decision-effectiveness-api.js';
import { createDecisionEffectivenessSheetAdapter } from '../lib/decision-effectiveness-sheet-adapter.js';

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
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return google.sheets({ version: 'v4', auth });
}

let effectivenessHandler;

export default async function handler(req, res) {
  try {
    if (!effectivenessHandler) {
      const adapter = createDecisionEffectivenessSheetAdapter({
        sheets: sheetsClient(),
        spreadsheetId: SPREADSHEET_ID
      });
      effectivenessHandler = createDecisionEffectivenessApi({
        configuredKey: process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '',
        readEffectiveness: adapter.readEffectiveness
      });
    }
    return await effectivenessHandler(req, res);
  } catch (error) {
    console.error('decision-effectiveness-route:', error);
    return res.status(500).json({ ok: false, error: 'decision effectiveness unavailable' });
  }
}

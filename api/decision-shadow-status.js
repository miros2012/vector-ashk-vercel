import { google } from 'googleapis';
import { createDecisionShadowSheetAdapter } from '../lib/decision-shadow-sheet-adapter.js';
import { createDecisionShadowStatusHandler } from '../lib/decision-shadow-status.js';

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

let statusHandler;

export default async function handler(req, res) {
  try {
    if (!statusHandler) {
      const adapter = createDecisionShadowSheetAdapter({
        sheets: sheetsClient(),
        spreadsheetId: SPREADSHEET_ID
      });
      statusHandler = createDecisionShadowStatusHandler({
        runShadow: () => adapter.run()
      });
    }
    return await statusHandler(req, res);
  } catch (error) {
    console.error('decision-shadow-status-route:', error);
    return res.status(500).json({ ok: false, status: 'ERROR' });
  }
}

import { google } from 'googleapis';
import { createDecisionShadowSheetAdapter } from '../lib/decision-shadow-sheet-adapter.js';
import { createDecisionStateSynchronizer } from '../lib/decision-state-sync-service.js';
import { createDecisionStateSyncHandler } from '../lib/decision-state-sync-handler.js';

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

let syncHandler;

export default async function handler(req, res) {
  try {
    if (!syncHandler) {
      const sheets = sheetsClient();
      const shadow = createDecisionShadowSheetAdapter({
        sheets,
        spreadsheetId: SPREADSHEET_ID
      });
      const synchronize = createDecisionStateSynchronizer({
        sheets,
        spreadsheetId: SPREADSHEET_ID,
        runShadow: () => shadow.run(),
        writesEnabled: process.env.DECISION_STATE_WRITES_ENABLED === 'true'
      });
      syncHandler = createDecisionStateSyncHandler({
        configuredKey: process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '',
        synchronize
      });
    }
    return await syncHandler(req, res);
  } catch (error) {
    console.error('decision-sync-route:', error);
    return res.status(500).json({ ok: false, error: 'decision sync route failed' });
  }
}

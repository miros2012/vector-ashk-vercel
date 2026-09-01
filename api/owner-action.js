import { google } from 'googleapis';
import { createOwnerActionApi } from '../lib/owner-action-api.js';
import { createOwnerActionSheetAdapter } from '../lib/owner-action-sheet-adapter.js';

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
  return google.sheets({ version:'v4', auth });
}

let ownerActionHandler;

export default async function handler(req, res) {
  try {
    if (!ownerActionHandler) {
      const adapter = createOwnerActionSheetAdapter({ sheets:sheetsClient(), spreadsheetId:SPREADSHEET_ID });
      ownerActionHandler = createOwnerActionApi({
        configuredKey: process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '',
        readOwnerAction: adapter.readOwnerAction
      });
    }
    return await ownerActionHandler(req, res);
  } catch (error) {
    console.error('owner-action route:', error);
    return res.status(500).json({ ok:false, error:'owner action unavailable' });
  }
}

import { google } from 'googleapis';
import { createCashPhotoAccessStore } from '../lib/cash-photo-access-store.js';
import { createCashPhotoConfigHttpHandler } from '../lib/cash-photo-config-http.js';
import { MAX_CASH_PHOTO_BYTES } from '../lib/cash-photo-upload-service.js';

const SPREADSHEET_ID = process.env.CASH_PHOTO_SPREADSHEET_ID || '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

let liveHandler;

async function buildLiveHandler() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });
  const access = createCashPhotoAccessStore({ sheets, spreadsheetId: SPREADSHEET_ID });
  return createCashPhotoConfigHttpHandler({
    authorize: (token) => access.authorize(token),
    maxBytes: MAX_CASH_PHOTO_BYTES
  });
}

export default async function handler(req, res) {
  try {
    if (!liveHandler) liveHandler = await buildLiveHandler();
    return await liveHandler(req, res);
  } catch (error) {
    console.error('cash photo config initialization failed', error);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ ok: false, error: 'cash_photo_config_unavailable' });
  }
}

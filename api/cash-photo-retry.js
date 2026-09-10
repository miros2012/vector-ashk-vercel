import { google } from 'googleapis';
import { getVercelOidcToken } from '@vercel/oidc';
import { createCashPhotoStore } from '../lib/cash-photo-store.js';
import { createCashPhotoRetryService } from '../lib/cash-photo-retry-service.js';
import { buildCashPhotoGatewayPayload } from '../lib/cash-photo-prompt.js';
import { recognizeWithFallback } from '../lib/cash-photo-recognizer.js';

const SPREADSHEET_ID = process.env.CASH_PHOTO_SPREADSHEET_ID || '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const PHOTO_FOLDER_ID = process.env.CASH_PHOTO_DRIVE_FOLDER_ID || '1PHTv_r47ZEbnH76I7zbC5YgphpELpkfG';
const DEFAULT_MODELS = ['google/gemini-3.8-flash', 'google/gemini-3.5-flash'];

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function configuredModels() {
  const configured = String(process.env.CASH_PHOTO_MODELS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_MODELS;
}

function requestAuthorized(req) {
  const authHeader = String(req?.headers?.authorization || '');
  const cronSecret = String(process.env.CRON_SECRET || '');
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  const vectorKey = String(process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '');
  const suppliedVectorKey = String(req?.headers?.['x-vector-key'] || '');
  return Boolean(vectorKey && suppliedVectorKey === vectorKey);
}

async function googleClients() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  await auth.authorize();
  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth })
  };
}

let retryService;

async function getRetryService() {
  if (retryService) return retryService;
  const { sheets, drive } = await googleClients();
  const store = createCashPhotoStore({ sheets, drive, spreadsheetId: SPREADSHEET_ID, folderId: PHOTO_FOLDER_ID });
  retryService = createCashPhotoRetryService({
    store,
    recognize: async ({ imageBytes, mimeType, branch, year }) => {
      const token = process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
      if (!token) throw new Error('AI Gateway authentication unavailable');
      return recognizeWithFallback({
        token,
        payload: buildCashPhotoGatewayPayload({ imageBytes, mimeType, branch, year }),
        models: configuredModels()
      });
    }
  });
  return retryService;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!requestAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  try {
    const service = await getRetryService();
    const result = await service.retryPending(3);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('cash photo retry failed', error);
    return res.status(503).json({ ok: false, error: 'cash_photo_retry_unavailable' });
  }
}

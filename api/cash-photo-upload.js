import { google } from 'googleapis';
import { getVercelOidcToken } from '@vercel/oidc';
import { createCashPhotoAccessStore } from '../lib/cash-photo-access-store.js';
import { createCashPhotoStore } from '../lib/cash-photo-store.js';
import { createCashPhotoUploadHttpHandler } from '../lib/cash-photo-upload-http.js';
import { createCashPhotoUploadService } from '../lib/cash-photo-upload-service.js';
import { buildCashPhotoGatewayPayload } from '../lib/cash-photo-prompt.js';
import { recognizeWithFallback } from '../lib/cash-photo-recognizer.js';

const SPREADSHEET_ID = process.env.CASH_PHOTO_SPREADSHEET_ID || '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const PHOTO_FOLDER_ID = process.env.CASH_PHOTO_DRIVE_FOLDER_ID || '1PHTv_r47ZEbnH76I7zbC5YgphpELpkfG';
const DEFAULT_MODELS = ['google/gemini-3.8-flash', 'google/gemini-3.5-flash'];

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
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

function configuredModels() {
  const configured = String(process.env.CASH_PHOTO_MODELS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_MODELS;
}

async function aiGatewayToken() {
  return process.env.AI_GATEWAY_API_KEY || await getVercelOidcToken();
}

let liveHandler;

async function buildLiveHandler() {
  const { sheets, drive } = await googleClients();
  const access = createCashPhotoAccessStore({ sheets, spreadsheetId: SPREADSHEET_ID });
  const store = createCashPhotoStore({
    sheets,
    drive,
    spreadsheetId: SPREADSHEET_ID,
    folderId: PHOTO_FOLDER_ID
  });
  const uploadService = createCashPhotoUploadService({
    store,
    recognize: async ({ imageBytes, mimeType, branch, year }) => {
      const token = await aiGatewayToken();
      if (!token) throw new Error('AI Gateway authentication unavailable');
      const payload = buildCashPhotoGatewayPayload({ imageBytes, mimeType, branch, year });
      return recognizeWithFallback({
        token,
        payload,
        models: configuredModels()
      });
    }
  });
  return createCashPhotoUploadHttpHandler({
    authorize: (token) => access.authorize(token),
    uploadService
  });
}

export default async function handler(req, res) {
  try {
    if (!liveHandler) liveHandler = await buildLiveHandler();
    return await liveHandler(req, res);
  } catch (error) {
    console.error('cash photo upload initialization failed', error);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      ok: false,
      error: 'cash_photo_service_unavailable',
      message: 'Сервис загрузки временно недоступен. Попробуйте ещё раз позже.'
    });
  }
}

import { google } from 'googleapis';
import { createRopPublisher } from '../lib/rop-publisher.js';
import { formatDebtorPrioritySheet } from '../lib/rop-debtor-format.js';
import {
  evaluateTochkaOperationAck,
  normalizeExpectedOperationIdentifiers
} from '../lib/tochka-operation-ack.js';

const SOURCE_SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const TARGET_ROP_SPREADSHEET_ID = '19_UF9JUcFf_jHtpugNgcjasi3SsVcZczlaK_spH7gDQ';
const PUBLISH_SCHEDULES = new Set(['35 21 * * *']);
const RANGES = {
  'РОП_Штаб_Утро': 'A:X',
  'РОП_Задачи_Сегодня': 'A:P',
  'РОП_Контроль_Дня': 'A:S',
  'РОП_План_Сентябрь': 'A:H',
  'РОП_Дебиторка_Приоритет': 'A:V'
};

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

let sheetsPromise;
async function getSheets() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  if (!sheetsPromise) {
    sheetsPromise = (async () => {
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: privateKey(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      await auth.authorize();
      return google.sheets({ version: 'v4', auth });
    })();
  }
  return sheetsPromise;
}

async function readSourceSheet(sheetName) {
  const sheets = await getSheets();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SOURCE_SPREADSHEET_ID,
    range: `'${sheetName}'!${RANGES[sheetName]}`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return result.data.values || [];
}

async function readTargetSheet(spreadsheetId, sheetName) {
  const sheets = await getSheets();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${RANGES[sheetName]}`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return result.data.values || [];
}

async function ensureTargetSheet(sheets, spreadsheetId, sheetName, rowCount, columnCount) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
  });
  const existing = (metadata.data.sheets || []).find(sheet => sheet.properties?.title === sheetName);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } } } }]
      }
    });
    return;
  }
  const rows = Number(existing.properties?.gridProperties?.rowCount || 0);
  const columns = Number(existing.properties?.gridProperties?.columnCount || 0);
  if (rows < rowCount || columns < columnCount) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: existing.properties.sheetId,
              gridProperties: {
                rowCount: Math.max(rows, rowCount),
                columnCount: Math.max(columns, columnCount),
                frozenRowCount: 1
              }
            },
            fields: 'gridProperties(rowCount,columnCount,frozenRowCount)'
          }
        }]
      }
    });
  }
}

async function writeTargetSheet(spreadsheetId, sheetName, values) {
  const sheets = await getSheets();
  const columns = String(RANGES[sheetName] || 'A:A').split(':')[1].charCodeAt(0) - 64;
  await ensureTargetSheet(sheets, spreadsheetId, sheetName, Math.max(values.length + 20, 100), columns);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${sheetName}'!${RANGES[sheetName]}` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
  if (sheetName === 'РОП_Дебиторка_Приоритет') {
    await formatDebtorPrioritySheet({ sheets, spreadsheetId, sheetName });
  }
  const readback = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${RANGES[sheetName]}`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const actual = readback.data.values || [];
  if (actual.length !== values.length || String(actual?.[0]?.[0] || '') !== String(values?.[0]?.[0] || '')) {
    throw new Error(`ROP publish verification failed: ${sheetName}`);
  }
}

export const publishRopNow = createRopPublisher({
  targetSpreadsheetId: TARGET_ROP_SPREADSHEET_ID,
  readSheet: readSourceSheet,
  readTargetSheet,
  writeSheet: writeTargetSheet
});

function isAuthorizedCron(req) {
  const expected = String(process.env.CRON_SECRET || '').trim();
  const actual = String(req?.headers?.authorization || '');
  return Boolean(expected) && actual === `Bearer ${expected}`;
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

async function handleTochkaOperationAck(req, res, body) {
  if (String(req?.headers?.['x-vector-refresh'] || '').trim() !== 'tochka-webhook') {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const expected = normalizeExpectedOperationIdentifiers(body);
  if (!expected.transactionIds.length && !expected.paymentIds.length) {
    return res.status(400).json({ ok: false, error: 'At least one Tochka operation identifier is required' });
  }

  try {
    const sheets = await getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SOURCE_SPREADSHEET_ID,
      range: `'Точка_API'!M2:N`,
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

export default async function handler(req, res) {
  const body = requestBody(req);
  if (String(req?.method || '').toUpperCase() === 'POST' && String(body?.mode || '') === 'operation_ack') {
    res.setHeader?.('Cache-Control', 'no-store');
    return handleTochkaOperationAck(req, res, body);
  }

  const schedule = String(req?.headers?.['x-vercel-cron-schedule'] || '');
  if (PUBLISH_SCHEDULES.has(schedule)) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }
    if (!isAuthorizedCron(req)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    try {
      const result = await publishRopNow();
      return res.status(200).json({ ok: true, mode: 'rop_publish', sheets: result.sheets });
    } catch (error) {
      console.error('rop-publish:', error?.name || 'Error');
      return res.status(500).json({ ok: false, error: 'ROP publish failed' });
    }
  }

  const googleReady = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  const oidcReady = Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
  return res.status(200).json({
    ok: true,
    service: 'vector-ashk-backend',
    platform: 'vercel',
    version: '0.7.0',
    timestamp: new Date().toISOString(),
    integrations: {
      ashk: process.env.ASHK_API_KEY ? 'configured' : 'missing_secret',
      googleSheets: googleReady ? 'configured' : 'missing_secret',
      tochkaBalances: oidcReady ? 'vercel_oidc' : 'oidc_unavailable'
    }
  });
}

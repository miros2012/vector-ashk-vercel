import { google } from 'googleapis';
import { buildMasterReportUrl, extractReportRows } from '../lib/master-hours.js';
import { masterReportPeriodForMonth } from '../lib/hours-sync.js';
import { createSyncHoursHandler } from '../lib/sync-hours-handler.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const RAW_SHEET = 'АШК_Часы_Табель__vercel';
const RECONCILIATION_SHEET = 'АШК_Сверка_часов__vercel';
const BOOTSTRAP_SYNC_KEY_SHA256 = '';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

async function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function ensureSheet(sheets, title, rowCount, columnCount) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
  });
  const existing = (metadata.data.sheets || []).find((sheet) => sheet.properties?.title === title);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title, gridProperties: { rowCount, columnCount } }
          }
        }]
      }
    });
    return;
  }
  const currentRows = Number(existing.properties?.gridProperties?.rowCount || 0);
  const currentColumns = Number(existing.properties?.gridProperties?.columnCount || 0);
  if (currentRows < rowCount || currentColumns < columnCount) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: existing.properties.sheetId,
              gridProperties: {
                rowCount: Math.max(currentRows, rowCount),
                columnCount: Math.max(currentColumns, columnCount)
              }
            },
            fields: 'gridProperties(rowCount,columnCount)'
          }
        }]
      }
    });
  }
}

async function fetchReport(month) {
  if (!process.env.ASHK_API_KEY) throw new Error('ASHK_API_KEY missing');
  const { startDate, endDate } = masterReportPeriodForMonth(month);
  const url = buildMasterReportUrl({
    baseUrl: ASHK_BASE_URL,
    buildMode: 1,
    startDate,
    endDate
  });
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      api_key: process.env.ASHK_API_KEY,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(55_000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`ASHK MasterWorkReportDetails returned HTTP ${response.status}`);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('ASHK MasterWorkReportDetails returned invalid JSON');
  }
  return extractReportRows(payload);
}

let clientPromise;
function getSheets() {
  clientPromise ||= sheetsClient();
  return clientPromise;
}

async function writeValues(sheetName, range, values, minimumRows, minimumColumns) {
  const sheets = await getSheets();
  await ensureSheet(sheets, sheetName, Math.max(minimumRows, values.length + 10), minimumColumns);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!${range}`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

const handler = createSyncHoursHandler({
  configuredKey: process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '',
  bootstrapHash: BOOTSTRAP_SYNC_KEY_SHA256,
  rawSheet: RAW_SHEET,
  reconciliationSheet: RECONCILIATION_SHEET,
  fetchReport,
  writeRaw: (values) => writeValues(RAW_SHEET, 'A:O', values, 5000, 15),
  readRaw: async () => {
    const sheets = await getSheets();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${RAW_SHEET}'!A:O`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    return result.data.values || [];
  },
  writeReconciliation: (values) => writeValues(RECONCILIATION_SHEET, 'A:F', values, 500, 6)
});

export default handler;

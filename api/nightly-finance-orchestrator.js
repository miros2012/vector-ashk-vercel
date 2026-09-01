import { google } from 'googleapis';
import syncHours from './sync-hours.js';
import reconcileDecisions from './decision-reconcile-daily.js';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';
import { createAshkReceivablesSource } from '../lib/ashk-receivables-source.js';
import { createReceivablesSyncHandler } from '../lib/receivables-sync-handler.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const RECEIVABLES_DETAIL_SHEET = 'АШК_Дебиторка__vercel';
const RECEIVABLES_SUMMARY_SHEET = 'АШК_Дебиторка_Свод__vercel';

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

async function ensureSheet(sheets, title, rowCount, columnCount) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
  });
  const existing = (metadata.data.sheets || []).find(sheet => sheet.properties?.title === title);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title, gridProperties: { rowCount, columnCount } } } }]
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

async function writeValues(sheetName, range, values, columns) {
  const sheets = await getSheets();
  await ensureSheet(sheets, sheetName, Math.max(values.length + 20, 500), columns);
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

const receivablesSource = createAshkReceivablesSource({
  baseUrl: 'https://app.dscontrol.ru',
  apiKey: process.env.ASHK_API_KEY || '',
  concurrency: 6,
  timeoutMs: 8000
});

const syncReceivables = createReceivablesSyncHandler({
  fetchCurrent: receivablesSource.fetchCurrent,
  writeDetail: values => writeValues(RECEIVABLES_DETAIL_SHEET, 'A:M', values, 13),
  writeSummary: values => writeValues(RECEIVABLES_SUMMARY_SHEET, 'A:F', values, 6)
});

const handler = createNightlyFinanceOrchestrator({
  cronSecret: process.env.CRON_SECRET || '',
  runHours: syncHours,
  runReceivables: syncReceivables,
  runDecisions: reconcileDecisions
});

export default handler;

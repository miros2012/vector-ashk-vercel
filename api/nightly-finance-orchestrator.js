import { google } from 'googleapis';
import syncHours from './sync-hours.js';
import syncPayments from './sync-payments.js';
import reconcileDecisions from './decision-reconcile-daily.js';
import { createNightlyFinanceOrchestrator } from '../lib/nightly-finance-orchestrator.js';
import { createAshkReceivablesSource } from '../lib/ashk-receivables-source.js';
import { createReceivablesSyncHandler } from '../lib/receivables-sync-handler.js';
import { buildRopDailyControlWorkbook } from '../lib/rop-daily-control.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const RECEIVABLES_DETAIL_SHEET = 'АШК_Дебиторка__vercel';
const RECEIVABLES_SUMMARY_SHEET = 'АШК_Дебиторка_Свод__vercel';
const PAYMENTS_STAGING_SHEET = 'АШК_Оплаты__vercel';
const ROP_PLAN_SHEET = 'РОП_План_Сентябрь';
const ROP_CONTROL_SHEET = 'РОП_Контроль_Дня';
const ROP_UNMATCHED_SHEET = 'РОП_Неопознанные_Оплаты__diag';
const CURRENT_MONTH_CONTRACTS_SHEET = 'АШК_Контракты_ТекущийМесяц__vercel';
const BUSINESS_TZ = 'Asia/Yekaterinburg';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function tyumenToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type)?.value || '';
  const year = part('year');
  const monthNumber = part('month');
  const day = part('day');
  if (!year || !monthNumber || !day) throw new Error('Tyumen business date unavailable');
  return {
    date: `${year}-${monthNumber}-${day}`,
    month: `${year}-${monthNumber}`
  };
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

async function readValues(sheetName, range) {
  const sheets = await getSheets();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!${range}`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return result.data.values || [];
}

async function syncRopDailyControl({ groups, contractsByGroup }) {
  const { date, month } = tyumenToday();
  const [planValues, paymentValues] = await Promise.all([
    readValues(ROP_PLAN_SHEET, 'A:H'),
    readValues(PAYMENTS_STAGING_SHEET, 'A:H')
  ]);

  const workbook = buildRopDailyControlWorkbook({
    planValues,
    groups,
    contractsByGroup,
    paymentValues,
    month,
    asOfDate: date
  });

  await writeValues(
    CURRENT_MONTH_CONTRACTS_SHEET,
    'A:J',
    workbook.currentMonthContractsValues,
    10
  );
  await writeValues(ROP_CONTROL_SHEET, 'A:S', workbook.controlValues, 19);
  await writeValues(ROP_UNMATCHED_SHEET, 'A:G', workbook.unmatchedPaymentValues, 7);

  const [contractsReadback, controlReadback, unmatchedReadback] = await Promise.all([
    readValues(CURRENT_MONTH_CONTRACTS_SHEET, 'A:J'),
    readValues(ROP_CONTROL_SHEET, 'A:S'),
    readValues(ROP_UNMATCHED_SHEET, 'A:G')
  ]);
  const contractsVerified = contractsReadback.length === workbook.currentMonthContractsValues.length
    && String(contractsReadback?.[0]?.[0] || '') === 'StudentId';
  const controlVerified = controlReadback.length === workbook.controlValues.length
    && String(controlReadback?.[0]?.[0] || '') === 'Дата';
  const unmatchedVerified = unmatchedReadback.length === workbook.unmatchedPaymentValues.length
    && String(unmatchedReadback?.[0]?.[0] || '') === 'ID оплаты';
  if (!contractsVerified || !controlVerified || !unmatchedVerified) {
    throw new Error('ROP daily control readback verification failed');
  }

  console.log(JSON.stringify({
    event: 'rop-daily-control-sync',
    month,
    asOfDate: date,
    controlRows: workbook.controlValues.length - 1,
    currentMonthContracts: workbook.metrics.currentMonthContracts,
    unmatchedPayments: workbook.metrics.unmatchedPayments,
    unmatchedPaymentAmount: workbook.metrics.unmatchedPaymentAmount,
    verified: true
  }));

  return {
    ok: true,
    month,
    asOfDate: date,
    controlRows: workbook.controlValues.length - 1,
    currentMonthContracts: workbook.metrics.currentMonthContracts,
    unmatchedPayments: workbook.metrics.unmatchedPayments,
    unmatchedPaymentAmount: workbook.metrics.unmatchedPaymentAmount,
    verified: true
  };
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
  writeSummary: values => writeValues(RECEIVABLES_SUMMARY_SHEET, 'A:F', values, 6),
  readDetail: () => readValues(RECEIVABLES_DETAIL_SHEET, 'A:M'),
  readSummary: () => readValues(RECEIVABLES_SUMMARY_SHEET, 'A:F'),
  afterVerified: syncRopDailyControl
});

export const runReceivablesNow = syncReceivables;

const handler = createNightlyFinanceOrchestrator({
  cronSecret: process.env.CRON_SECRET || '',
  runHours: syncHours,
  runPayments: syncPayments,
  runReceivables: syncReceivables,
  runDecisions: reconcileDecisions
});

export default handler;

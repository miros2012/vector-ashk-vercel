import { google } from 'googleapis';
import { createAshkReceivablesSource } from './lib/ashk-receivables-source.js';
import { buildReceivableRows, buildReceivableSummary } from './lib/ashk-receivables.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const DETAIL = 'АШК_Дебиторка__vercel';
const SUMMARY = 'АШК_Дебиторка_Свод__vercel';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
  throw new Error('Google service account secrets missing');
}

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: privateKey(),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
await auth.authorize();
const sheets = google.sheets({ version: 'v4', auth });

async function ensureSheet(title, rows, columns) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'
  });
  const existing = (metadata.data.sheets || []).find(sheet => sheet.properties?.title === title);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title, gridProperties: { rowCount: rows, columnCount: columns } } } }] }
    });
  }
}

async function replaceValues(title, range, values, columns) {
  await ensureSheet(title, Math.max(values.length + 20, 500), columns);
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${title}'!${range}` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

const source = createAshkReceivablesSource({
  baseUrl: 'https://app.dscontrol.ru',
  apiKey: process.env.ASHK_API_KEY || '',
  concurrency: 6,
  timeoutMs: 8000
});
const { groups, contractsByGroup } = await source.fetchCurrent();
const rows = buildReceivableRows(groups, contractsByGroup);
const summary = buildReceivableSummary(rows);

const detailValues = [[
  'StudentId','GroupId','Филиал','Менеджер','Договор','Дата договора','Статус',
  'Продажи','Оплачено','Долг','Долг основной услуги','Основная услуга','Последняя оплата'
], ...rows.map(row => [
  row.studentId,row.groupId,row.branch,row.manager,row.contractName,row.contractDate,row.state,
  row.salesSum,row.debitSum,row.debt,row.mainProductDebt,row.mainProductName,row.lastPaymentDate
])];

const summaryValues = [['Тип','Объект','Договоров','Долг','Продажи','Оплачено'],
  ['ИТОГО','',summary.total.contracts,summary.total.debt,summary.total.salesSum,summary.total.debitSum],
  ...summary.byManager.map(item => ['МЕНЕДЖЕР',item.manager,item.contracts,item.debt,item.salesSum,item.debitSum]),
  ...summary.byBranch.map(item => ['ФИЛИАЛ',item.branch,item.contracts,item.debt,item.salesSum,item.debitSum])
];

await replaceValues(DETAIL, 'A:M', detailValues, 13);
await replaceValues(SUMMARY, 'A:F', summaryValues, 6);

const readback = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${SUMMARY}'!A1:F2`,
  valueRenderOption: 'UNFORMATTED_VALUE'
});
const totalRow = readback.data.values?.[1] || [];
const readbackContracts = Number(totalRow[2] || 0);
const readbackDebt = Number(totalRow[3] || 0);
if (readbackContracts !== summary.total.contracts || Math.abs(readbackDebt - summary.total.debt) > 0.01) {
  throw new Error('Receivables staging readback mismatch');
}

console.log('ASHK_RECEIVABLES_STAGING_VERIFIED', JSON.stringify({
  debtorContracts: summary.total.contracts,
  debtTotal: summary.total.debt,
  managers: summary.byManager.length,
  branches: summary.byBranch.length,
  detailRowsWritten: detailValues.length,
  readbackOk: true
}));

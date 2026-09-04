import { google } from 'googleapis';
import { paymentMetrics, paymentMetricsMatch } from '../lib/payments-staging-verification.js';
import { createAshkWebSession } from '../lib/ashk-web-session.js';
import {
  attributePaymentsToSales,
  createAshkSaleSource
} from '../lib/ashk-sale-attribution.js';
import { writeControlMarker } from '../lib/google-sheets-sync-marker.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const STAGING_SHEET = 'АШК_Оплаты__vercel';
const SALES_STAGING_SHEET = 'АШК_Продажи__vercel';
const LIVE_SHEET = 'АШК_Оплаты';
const TZ = 'Asia/Yekaterinburg';

function pad2(n) { return String(n).padStart(2, '0'); }
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(/\u00A0/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function tyumenParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = t => Number(parts.find(p => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}
function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}
async function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}
async function ensureSheet(sheets, title) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)'
  });
  const existing = (meta.data.sheets || []).find(s => s.properties?.title === title);
  if (existing) return existing.properties.sheetId;
  const r = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  return r.data.replies?.[0]?.addSheet?.properties?.sheetId;
}
function ashkHeaders() {
  const apiKey = process.env.ASHK_API_KEY;
  if (!apiKey) throw new Error('ASHK_API_KEY missing');
  return {
    'api_key': apiKey,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json'
  };
}
async function fetchAshkData(path) {
  const r = await fetch(`${ASHK_BASE_URL}${path}`, { headers: ashkHeaders() });
  const responseText = await r.text();
  if (!r.ok) throw new Error(`АШК HTTP ${r.status}: ${responseText.slice(0, 500)}`);
  let json;
  try { json = JSON.parse(responseText); } catch { throw new Error(`АШК вернул не JSON: ${responseText.slice(0, 500)}`); }
  if (json?.success === false) throw new Error(`АШК success=false: ${JSON.stringify(json.data || json).slice(0, 500)}`);
  return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
}
async function fetchAshkMonth() {
  const { year, month, day } = tyumenParts();
  const all = [];
  for (let startDay = 1; startDay <= day; startDay += 7) {
    const endDay = Math.min(startDay + 6, day);
    const startDate = `${year}-${pad2(month)}-${pad2(startDay)}T00:00:00`;
    const endDate = `${year}-${pad2(month)}-${pad2(endDay)}T23:59:59`;
    const path = `/api/PaymentRecordExternalDebitList?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}`;
    const data = await fetchAshkData(path);
    all.push(...data);
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  const byId = new Map();
  for (const item of all) {
    const id = String(item?.Id ?? '').trim();
    if (id) byId.set(id, item);
  }
  return [...byId.values()].sort((a, b) => String(a.PayDate ?? '').localeCompare(String(b.PayDate ?? '')));
}

async function fetchAshkCashboxOperations() {
  const { year, month, day } = tyumenParts();
  const startDate = `${year}-${pad2(month)}-01T00:00:00`;
  const endDate = `${year}-${pad2(month)}-${pad2(day)}T23:59:59`;
  const path = `/api/CashboxOperationList?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}`;
  return fetchAshkData(path);
}

function dateTimeKey(value) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : '';
}

function moneyKey(value) {
  return String(Math.round(toNumber(value) * 100));
}

function operationMatchKey(date, amount) {
  const timestamp = dateTimeKey(date);
  return timestamp ? `${timestamp}\u0000${moneyKey(amount)}` : '';
}

export function attributePaymentsToCashboxOperations(payments, operations) {
  const operationsByKey = new Map();
  for (const operation of Array.isArray(operations) ? operations : []) {
    const key = operationMatchKey(operation?.Created, operation?.Amount);
    if (!key) continue;
    const list = operationsByKey.get(key) || [];
    list.push(operation);
    operationsByKey.set(key, list);
  }

  const metrics = { total: 0, attributed: 0, noMatch: 0, ambiguous: 0, employeeEmpty: 0 };
  const items = (Array.isArray(payments) ? payments : []).map(payment => {
    metrics.total += 1;
    const candidates = operationsByKey.get(operationMatchKey(payment?.PayDate, payment?.Debit)) || [];
    if (!candidates.length) {
      metrics.noMatch += 1;
      return { ...payment, PaymentEmployeeName: '' };
    }
    const employees = [...new Set(candidates.map(item => String(item?.EmployeeName ?? '').trim()).filter(Boolean))];
    if (!employees.length) {
      metrics.employeeEmpty += 1;
      return { ...payment, PaymentEmployeeName: '' };
    }
    if (employees.length > 1) {
      metrics.ambiguous += 1;
      return { ...payment, PaymentEmployeeName: '' };
    }
    metrics.attributed += 1;
    return { ...payment, PaymentEmployeeName: employees[0] };
  });
  return { items, metrics };
}
async function readMetrics(sheets, sheetName) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A2:H`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return paymentMetrics(r.data.values || []);
}

function saleMetrics(values) {
  const rows = Array.isArray(values) ? values : [];
  return {
    rows: rows.length,
    sumTotal: Math.round(rows.reduce((sum, row) => sum + toNumber(row?.[6]), 0) * 100) / 100,
    paidTotal: Math.round(rows.reduce((sum, row) => sum + toNumber(row?.[7]), 0) * 100) / 100
  };
}

function saleMetricsMatch(actual, expected) {
  return actual.rows === expected.rows
    && Math.abs(actual.sumTotal - expected.sumTotal) < 0.01
    && Math.abs(actual.paidTotal - expected.paidTotal) < 0.01;
}

async function readSaleMetrics(sheets) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SALES_STAGING_SHEET}'!A2:H`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return saleMetrics(result.data.values || []);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }
  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google service account secrets missing');
    }
    const [rawItems, sheets] = await Promise.all([fetchAshkMonth(), sheetsClient()]);
    const operations = await fetchAshkCashboxOperations();
    const comparisonAttribution = attributePaymentsToCashboxOperations(rawItems, operations);
    const { year, month, day } = tyumenParts();
    const session = createAshkWebSession({
      baseUrl: ASHK_BASE_URL,
      login: process.env['ASHK_WEB_LOGIN'],
      password: process.env['ASHK_WEB_PASSWORD']
    });
    const saleSource = createAshkSaleSource({ session, concurrency: 4 });
    const saleResult = await saleSource.fetchForPayments({
      payments: rawItems,
      startDate: `${year}-${pad2(month)}-01`,
      endDate: `${year}-${pad2(month)}-${pad2(day)}`
    });
    const saleAttribution = attributePaymentsToSales(comparisonAttribution.items, saleResult.sales);
    const items = saleAttribution.items;

    await Promise.all([
      ensureSheet(sheets, STAGING_SHEET),
      ensureSheet(sheets, SALES_STAGING_SHEET)
    ]);
    const headers = [[
      'Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit',
      'PaymentEmployeeName','SaleEmployeeName','SaleAttributionStatus'
    ]];
    const rows = items.map(item => [
      item.Id ?? '', item.PayDate ?? '', item.StudentId ?? '', item.SaleId ?? '',
      item.ProductId ?? '', item.ProductName ?? '', toNumber(item.SaleSum), toNumber(item.Debit),
      item.PaymentEmployeeName ?? '', item.SaleEmployeeName ?? '', item.SaleAttributionStatus ?? ''
    ]);
    const salesHeaders = [[
      'Id','Date','EmployeeName','StudentOwnerName','StudentId','ProductName','Sum','Paid'
    ]];
    const salesRows = saleResult.sales.map(item => [
      item.Id ?? '', item.Date ?? '', item.EmployeeName ?? '', item.StudentOwnerName ?? '',
      item.StudentId ?? '', item.ProductName ?? '', toNumber(item.Sum), toNumber(item.Paid)
    ]);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STAGING_SHEET}'!A:K`
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STAGING_SHEET}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [...headers, ...rows] }
    });
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SALES_STAGING_SHEET}'!A:H`
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SALES_STAGING_SHEET}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [...salesHeaders, ...salesRows] }
    });

    const stagingExpected = paymentMetrics(rows);
    const salesExpected = saleMetrics(salesRows);
    const [stagingReadback, salesReadback] = await Promise.all([
      readMetrics(sheets, STAGING_SHEET),
      readSaleMetrics(sheets)
    ]);
    if (!paymentMetricsMatch(stagingReadback, stagingExpected)
      || !saleMetricsMatch(salesReadback, salesExpected)) {
      console.error('sync-payments-staging-verification: mismatch');
      return res.status(502).json({ ok: false, error: 'Payment or sale staging verification failed' });
    }

    const paymentsLastSuccessUtc = new Date().toISOString();
    await writeControlMarker({
      sheets,
      spreadsheetId: SPREADSHEET_ID,
      key: 'payments_last_success_utc',
      value: paymentsLastSuccessUtc
    });

    const live = await readMetrics(sheets, LIVE_SHEET);
    const comparison = {
      rowDiff: stagingExpected.rows - live.rows,
      debitDiff: Math.round((stagingExpected.debitTotal - live.debitTotal) * 100) / 100,
      sameRows: stagingExpected.rows === live.rows,
      sameDebit: Math.abs(stagingExpected.debitTotal - live.debitTotal) < 0.01
    };
    console.log(JSON.stringify({
      event: 'sync-payments-staging',
      staging: stagingExpected,
      verified: true,
      sourceLastSuccessUtc: paymentsLastSuccessUtc,
      live,
      comparison,
      saleSource: saleResult.metrics,
      saleAttribution: saleAttribution.metrics,
      cashboxComparison: comparisonAttribution.metrics,
      credentials: 'configured'
    }));
    return res.status(200).json({
      ok: true,
      mode: 'staging_only',
      verified: true,
      sourceLastSuccessUtc: paymentsLastSuccessUtc,
      spreadsheetId: SPREADSHEET_ID,
      stagingSheet: STAGING_SHEET,
      salesStagingSheet: SALES_STAGING_SHEET,
      liveSheet: LIVE_SHEET,
      staging: stagingExpected,
      salesStaging: salesExpected,
      live,
      comparison,
      saleSource: saleResult.metrics,
      saleAttribution: saleAttribution.metrics,
      cashboxComparison: comparisonAttribution.metrics,
      credentials: 'configured',
      note: 'Рабочий лист не изменён.'
    });
  } catch (error) {
    console.error(error?.name || 'Error');
    return res.status(500).json({ ok: false, error: 'Payment staging sync failed' });
  }
}
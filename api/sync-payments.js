import { google } from 'googleapis';
import { paymentMetrics, paymentMetricsMatch } from '../lib/payments-staging-verification.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const STAGING_SHEET = 'АШК_Оплаты__vercel';
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
    const attribution = attributePaymentsToCashboxOperations(rawItems, operations);
    const items = attribution.items;
    await ensureSheet(sheets, STAGING_SHEET);
    const headers = [['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit','PaymentEmployeeName']];
    const rows = items.map(item => [
      item.Id ?? '', item.PayDate ?? '', item.StudentId ?? '', item.SaleId ?? '',
      item.ProductId ?? '', item.ProductName ?? '', toNumber(item.SaleSum), toNumber(item.Debit),
      item.PaymentEmployeeName ?? ''
    ]);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STAGING_SHEET}'!A:I`
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STAGING_SHEET}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [...headers, ...rows] }
    });

    const stagingExpected = paymentMetrics(rows);
    const stagingReadback = await readMetrics(sheets, STAGING_SHEET);
    if (!paymentMetricsMatch(stagingReadback, stagingExpected)) {
      console.error('sync-payments-staging-verification: mismatch');
      return res.status(502).json({ ok: false, error: 'Payment staging verification failed' });
    }

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
      live,
      comparison,
      employeeAttribution: attribution.metrics
    }));
    return res.status(200).json({
      ok: true,
      mode: 'staging_only',
      verified: true,
      spreadsheetId: SPREADSHEET_ID,
      stagingSheet: STAGING_SHEET,
      liveSheet: LIVE_SHEET,
      staging: stagingExpected,
      live,
      comparison,
      employeeAttribution: attribution.metrics,
      note: 'Рабочий лист не изменён.'
    });
  } catch (error) {
    console.error(error?.name || 'Error');
    return res.status(500).json({ ok: false, error: 'Payment staging sync failed' });
  }
}

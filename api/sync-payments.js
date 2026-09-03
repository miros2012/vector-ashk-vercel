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
async function fetchAshkMonth() {
  const apiKey = process.env.ASHK_API_KEY;
  if (!apiKey) throw new Error('ASHK_API_KEY missing');
  const { year, month, day } = tyumenParts();
  const all = [];
  for (let startDay = 1; startDay <= day; startDay += 7) {
    const endDay = Math.min(startDay + 6, day);
    const startDate = `${year}-${pad2(month)}-${pad2(startDay)}T00:00:00`;
    const endDate = `${year}-${pad2(month)}-${pad2(endDay)}T23:59:59`;
    const url = `${ASHK_BASE_URL}/api/PaymentRecordExternalDebitList?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}`;
    const r = await fetch(url, {
      headers: {
        'api_key': apiKey,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json'
      }
    });
    const responseText = await r.text();
    if (!r.ok) throw new Error(`АШК HTTP ${r.status}: ${responseText.slice(0, 500)}`);
    let json;
    try { json = JSON.parse(responseText); } catch { throw new Error(`АШК вернул не JSON: ${responseText.slice(0, 500)}`); }
    if (json?.success === false) throw new Error(`АШК success=false: ${JSON.stringify(json.data || json).slice(0, 500)}`);
    const data = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
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

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function safeSchemaSample(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') return `[object:${Object.keys(value).sort().join(',')}]`;
  return String(value);
}

export function summarizePaymentSchema(items) {
  const fields = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    for (const [field, value] of Object.entries(item || {})) {
      const current = fields.get(field) || { types: new Set(), samples: new Set() };
      current.types.add(valueType(value));
      const sample = safeSchemaSample(value);
      if (sample && current.samples.size < 5) current.samples.add(sample);
      fields.set(field, current);
    }
  }
  const staffPattern = /employee|staff|worker|manager|owner|user|author|creator|createdby|cashier|operator|сотрудник/i;
  const sorted = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    fields: sorted.map(([field, meta]) => ({ field, types: [...meta.types].sort() })),
    staffCandidates: sorted
      .filter(([field]) => staffPattern.test(field))
      .map(([field, meta]) => ({ field, types: [...meta.types].sort(), samples: [...meta.samples] }))
  };
}

export async function inspectAshkPaymentSchema() {
  return summarizePaymentSchema(await fetchAshkMonth());
}

function schemaPaths(value, prefix = '', depth = 0, result = new Map()) {
  if (depth > 4 || value === null || value === undefined) return result;
  if (Array.isArray(value)) {
    result.set(prefix || '[]', 'array');
    for (const item of value.slice(0, 3)) schemaPaths(item, `${prefix}[]`, depth + 1, result);
    return result;
  }
  if (typeof value !== 'object') {
    if (prefix) result.set(prefix, typeof value);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    result.set(path, valueType(child));
    schemaPaths(child, path, depth + 1, result);
  }
  return result;
}

async function inspectRelatedPaymentEndpoints(sample) {
  const apiKey = process.env.ASHK_API_KEY;
  const candidates = [
    `/api/PaymentRecordExternalGet?param=${encodeURIComponent(sample.Id ?? '')}`,
    `/api/PaymentRecordGet?param=${encodeURIComponent(sample.Id ?? '')}`,
    `/api/SaleExternalGet?param=${encodeURIComponent(sample.SaleId ?? '')}`,
    `/api/SaleGet?param=${encodeURIComponent(sample.SaleId ?? '')}`,
    `/api/CashboxExternalGet?param=${encodeURIComponent(sample.CashboxId ?? '')}`,
    `/api/CashboxGet?param=${encodeURIComponent(sample.CashboxId ?? '')}`,
    '/api/CashboxList'
  ];
  const results = [];
  for (const path of candidates) {
    const response = await fetch(`${ASHK_BASE_URL}${path}`, {
      headers: {
        'api_key': apiKey,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json'
      }
    });
    const body = await response.text();
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* schema-only diagnostic */ }
    results.push({
      endpoint: path.replace(/=[^&]+/g, '=…'),
      status: response.status,
      success: payload?.success,
      schema: payload ? [...schemaPaths(payload).entries()].map(([field, type]) => ({ field, type })) : []
    });
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return results;
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
    const [items, sheets] = await Promise.all([fetchAshkMonth(), sheetsClient()]);
    await ensureSheet(sheets, STAGING_SHEET);
    const headers = [['Id','PayDate','StudentId','SaleId','ProductId','ProductName','SaleSum','Debit']];
    const rows = items.map(item => [
      item.Id ?? '', item.PayDate ?? '', item.StudentId ?? '', item.SaleId ?? '',
      item.ProductId ?? '', item.ProductName ?? '', toNumber(item.SaleSum), toNumber(item.Debit)
    ]);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STAGING_SHEET}'!A:H`
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
    const paymentSchema = summarizePaymentSchema(items);
    const relatedPaymentEndpoints = req.query?.inspectDetails === '1' && items[0]
      ? await inspectRelatedPaymentEndpoints(items[0])
      : undefined;
    console.log(JSON.stringify({
      event: 'sync-payments-staging',
      staging: stagingExpected,
      verified: true,
      live,
      comparison,
      paymentFields: paymentSchema.fields,
      relatedPaymentEndpoints
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
      note: 'Рабочий лист не изменён.'
    });
  } catch (error) {
    console.error(error?.name || 'Error');
    return res.status(500).json({ ok: false, error: 'Payment staging sync failed' });
  }
}

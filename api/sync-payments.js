import { google } from 'googleapis';

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
    const text = await r.text();
    if (!r.ok) throw new Error(`АШК HTTP ${r.status}: ${text.slice(0, 500)}`);
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`АШК вернул не JSON: ${text.slice(0, 500)}`); }
    if (json?.success === false) throw new Error(`АШК success=false: ${JSON.stringify(json.data || json).slice(0, 500)}`);
    const data = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    all.push(...data);
    await new Promise(r2 => setTimeout(r2, 1100));
  }
  const byId = new Map();
  for (const item of all) {
    const id = String(item?.Id ?? '').trim();
    if (id) byId.set(id, item);
  }
  const items = [...byId.values()].sort((a, b) => String(a.PayDate ?? '').localeCompare(String(b.PayDate ?? '')));
  return items;
}
function metricsFromRows(rows) {
  const debitTotal = rows.reduce((s, r) => s + toNumber(r[7]), 0);
  const dates = rows.map(r => String(r[1] ?? '')).filter(Boolean).sort();
  return {
    rows: rows.length,
    debitTotal: Math.round(debitTotal * 100) / 100,
    minPayDate: dates[0] || null,
    maxPayDate: dates.at(-1) || null
  };
}
async function readLiveMetrics(sheets) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${LIVE_SHEET}'!A2:H`
  });
  const values = r.data.values || [];
  return metricsFromRows(values.filter(row => String(row[0] ?? '').trim()));
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
    const staging = metricsFromRows(rows);
    const live = await readLiveMetrics(sheets);
    const comparison = {
      rowDiff: staging.rows - live.rows,
      debitDiff: Math.round((staging.debitTotal - live.debitTotal) * 100) / 100,
      sameRows: staging.rows === live.rows,
      sameDebit: Math.abs(staging.debitTotal - live.debitTotal) < 0.01
    };
    console.log(JSON.stringify({ event: 'sync-payments-staging', staging, live, comparison }));
    return res.status(200).json({
      ok: true,
      mode: 'staging_only',
      spreadsheetId: SPREADSHEET_ID,
      stagingSheet: STAGING_SHEET,
      liveSheet: LIVE_SHEET,
      staging,
      live,
      comparison,
      note: 'Рабочий лист не изменён.'
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}

const BASE = 'https://app.dscontrol.ru';
const apiKey = process.env.ASHK_API_KEY;
if (!apiKey) throw new Error('ASHK_API_KEY missing');

const startDate = '2026-08-01T00:00:00';
const endDate = '2026-08-30T23:59:59';
const url = `${BASE}/api/SaleExternalList?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}`;
const r = await fetch(url, {
  headers: {
    api_key: apiKey,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json'
  }
});
const text = await r.text();
let json;
try { json = JSON.parse(text); } catch { throw new Error(`ASHK non-JSON HTTP ${r.status}`); }
const data = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
const first = data[0] && typeof data[0] === 'object' ? data[0] : {};
const itemKeys = Object.keys(first).sort();
const keyTypes = Object.fromEntries(itemKeys.map(k => [k, first[k] === null ? 'null' : Array.isArray(first[k]) ? 'array' : typeof first[k]]));
const debtLikeKeys = itemKeys.filter(k => /(debt|debit|balance|remain|rest|paid|pay|sum|amount|price|employee|manager|user|office|branch|student|contract|sale)/i.test(k));
console.log('ASHK_SALE_EXTERNAL_SCHEMA_OK', JSON.stringify({
  status: r.status,
  success: json?.success !== false,
  rowCount: data.length,
  topLevelKeys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).sort() : [],
  itemKeys,
  keyTypes,
  debtLikeKeys
}));
if (!r.ok || json?.success === false) {
  const message = json?.data?.Message ?? json?.Message ?? 'ASHK request failed';
  throw new Error(String(message).slice(0, 220));
}

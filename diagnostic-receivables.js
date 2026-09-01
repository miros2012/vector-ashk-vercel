const BASE = 'https://app.dscontrol.ru';
const apiKey = process.env.ASHK_API_KEY;
if (!apiKey) throw new Error('ASHK_API_KEY missing');

const headers = {
  api_key: apiKey,
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/json'
};

async function request(path) {
  const r = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`ASHK non-JSON HTTP ${r.status}`); }
  if (!r.ok || json?.success === false) {
    const message = json?.data?.Message ?? json?.Message ?? text;
    throw new Error(String(message).replace(/\s+/g, ' ').slice(0, 220));
  }
  return json;
}

const startDate = '2026-08-01T00:00:00';
const endDate = '2026-08-30T23:59:59';
const saleJson = await request(`/api/SaleExternalList?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}`);
const sales = Array.isArray(saleJson?.data) ? saleJson.data : [];
const studentIds = [...new Set(sales.map(x => Number(x?.StudentId)).filter(Number.isFinite))].slice(0, 3);
if (!studentIds.length) throw new Error('No StudentId in SaleExternalList');

const required = ['Id','OwnerName','TrainingRoomName','SalesSum','Debt','OverDebt','DebitSum','ContractDate','ContractName','State'];
const samples = [];
for (const studentId of studentIds) {
  const json = await request(`/api/StudentExternalGet?param=${encodeURIComponent(studentId)}`);
  const item = json?.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json;
  const keys = Object.keys(item || {}).sort();
  const present = Object.fromEntries(required.map(key => [key, Object.prototype.hasOwnProperty.call(item || {}, key)]));
  const numericTypes = Object.fromEntries(['SalesSum','Debt','OverDebt','DebitSum'].map(key => [key, typeof item?.[key]]));
  samples.push({ keys, present, numericTypes });
  await new Promise(resolve => setTimeout(resolve, 250));
}

console.log('ASHK_STUDENT_RECEIVABLES_SCHEMA_OK', JSON.stringify({
  sampleCount: samples.length,
  required,
  samples
}));

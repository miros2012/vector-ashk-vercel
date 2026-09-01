const BASE = 'https://app.dscontrol.ru';
const apiKey = process.env.ASHK_API_KEY;
if (!apiKey) throw new Error('ASHK_API_KEY missing');

const headers = {
  api_key: apiKey,
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/json'
};

async function request(path) {
  const r = await fetch(`${BASE}${path}`, { headers });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { r, json, text };
}

function messageOf(json, text) {
  return String(json?.data?.Message ?? json?.Message ?? text ?? '').replace(/\s+/g, ' ').slice(0, 180);
}

function classify(status, message) {
  const m = String(message || '').toLowerCase();
  if (/invalid command name|unknown api call|unknown command/.test(m)) return 'unknown';
  if (status === 404) return 'unknown';
  return 'recognized';
}

const startDate = '2026-08-01T00:00:00';
const endDate = '2026-08-30T23:59:59';
const sale = await request(`/api/SaleExternalList?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}`);
if (!sale.r.ok || sale.json?.success === false) throw new Error(`SaleExternalList: ${messageOf(sale.json, sale.text)}`);
const sales = Array.isArray(sale.json?.data) ? sale.json.data : [];
const sampleStudentId = sales.find(x => Number.isFinite(Number(x?.StudentId)))?.StudentId;
if (!sampleStudentId) throw new Error('No StudentId found in SaleExternalList sample');

const names = [
  'StudentExternalList',
  'StudentExternal',
  'StudentList',
  'StudentInfo',
  'StudentGet',
  'ContractExternalList',
  'ContractExternal',
  'ContractList',
  'StudentContractExternalList',
  'StudentContractList',
  'EducationContractExternalList',
  'EmployeeExternalList',
  'EmployeeList',
  'OfficeExternalList',
  'OfficeList',
  'BranchExternalList',
  'BranchList',
  'UserExternalList',
  'UserList'
];

const results = [];
for (const name of names) {
  const variants = [
    `/api/${name}`,
    `/api/${name}?StudentId=${encodeURIComponent(sampleStudentId)}`,
    `/api/${name}?Id=${encodeURIComponent(sampleStudentId)}`
  ];
  let best = null;
  for (const path of variants) {
    const { r, json, text } = await request(path);
    const message = messageOf(json, text);
    const classification = classify(r.status, message);
    const row = { name, path: path.replace(String(sampleStudentId), ':studentId'), status: r.status, classification, message };
    if (!best || (best.classification === 'unknown' && classification === 'recognized') || (best.status >= 400 && r.status < 400)) best = row;
    if (r.status < 400 && json?.success !== false) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  results.push(best);
}

console.log('ASHK_STUDENT_LINK_DISCOVERY_OK', JSON.stringify({
  candidates: results.length,
  recognized: results.filter(x => x?.classification === 'recognized'),
  unknownCount: results.filter(x => x?.classification === 'unknown').length
}));

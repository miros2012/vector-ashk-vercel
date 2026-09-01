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

function asArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

const groupJson = await request('/api/StudyGroupList');
const groups = asArray(groupJson);
if (!groups.length) throw new Error('StudyGroupList returned no active groups');

let selected = null;
let students = [];
for (const group of groups.slice(0, 12)) {
  const id = Number(group?.Id);
  if (!Number.isFinite(id)) continue;
  const listJson = await request(`/api/StudentExternalList?StudyGroupId=${encodeURIComponent(id)}`);
  const rows = asArray(listJson);
  if (rows.length) {
    selected = group;
    students = rows;
    break;
  }
}
if (!students.length) throw new Error('No contracts found in sampled active groups');

const first = students[0] || {};
const itemKeys = Object.keys(first).sort();
const receivableKeys = itemKeys.filter(k => /(debt|debit|sales|paid|owner|trainingroom|contract|state|mainproduct)/i.test(k));
console.log('ASHK_STUDENT_LIST_SCHEMA_OK', JSON.stringify({
  activeGroupCount: groups.length,
  sampledGroupContractCount: students.length,
  groupState: selected?.State ?? null,
  itemKeys,
  receivableKeys,
  hasDebt: Object.prototype.hasOwnProperty.call(first, 'Debt'),
  hasOverDebt: Object.prototype.hasOwnProperty.call(first, 'OverDebt'),
  hasSalesSum: Object.prototype.hasOwnProperty.call(first, 'SalesSum'),
  hasOwnerName: Object.prototype.hasOwnProperty.call(first, 'OwnerName'),
  hasTrainingRoomName: Object.prototype.hasOwnProperty.call(first, 'TrainingRoomName')
}));

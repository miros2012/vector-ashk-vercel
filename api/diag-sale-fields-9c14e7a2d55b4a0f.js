const ASHK_BASE_URL = 'https://app.dscontrol.ru';

function pad2(n) { return String(n).padStart(2, '0'); }

function tyumenParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  try {
    const apiKey = process.env.ASHK_API_KEY;
    if (!apiKey) throw new Error('ASHK_API_KEY missing');
    const { year, month, day } = tyumenParts();
    const url = new URL('/api/SaleExternalList', ASHK_BASE_URL);
    url.searchParams.set('StartDate', `${year}-${pad2(month)}-01T00:00:00`);
    url.searchParams.set('EndDate', `${year}-${pad2(month)}-${pad2(day)}T23:59:59`);
    const response = await fetch(url, { headers: {
      api_key: apiKey, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json'
    }});
    const json = await response.json();
    if (!response.ok || json?.success === false) return res.status(502).json({ ok: false, status: response.status });
    const items = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    const keys = [...new Set(items.flatMap(item => Object.keys(item || {})))].sort();
    const candidateKeys = keys.filter(key => /employee|manager|owner|user|author|creator|createdby|seller/i.test(key));
    const populated = Object.fromEntries(candidateKeys.map(key => [
      key, items.filter(item => item?.[key] !== null && item?.[key] !== undefined && String(item[key]).trim() !== '').length
    ]));
    return res.status(200).json({ ok: true, rows: items.length, keys, candidateKeys, populated });
  } catch {
    return res.status(500).json({ ok: false });
  }
}

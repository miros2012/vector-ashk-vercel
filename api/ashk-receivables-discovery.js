import { probeAshkReceivables } from '../lib/ashk-receivables-discovery.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }
  try {
    const results = await probeAshkReceivables({
      baseUrl: ASHK_BASE_URL,
      apiKey: process.env.ASHK_API_KEY
    });
    const recognized = results.filter(row => row.classification === 'recognized');
    const uncertain = results.filter(row => row.classification === 'uncertain');
    console.log(JSON.stringify({
      event: 'ashk-receivables-discovery',
      candidates: results.length,
      recognized: recognized.map(({ name, status, message }) => ({ name, status, message })),
      uncertain: uncertain.map(({ name, status, message }) => ({ name, status, message }))
    }));
    return res.status(200).json({
      ok: true,
      mode: 'read_only_discovery',
      candidates: results.length,
      recognized,
      uncertain
    });
  } catch (error) {
    console.error('ashk-receivables-discovery:', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}

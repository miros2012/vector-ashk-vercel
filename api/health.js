import { probeAshkReceivables } from '../lib/ashk-receivables-discovery.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';

export default async function handler(req, res) {
  const googleReady = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  const oidcReady = Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);

  if (String(req.query?.receivablesDiscovery || '') === '1') {
    if (process.env.VERCEL_ENV !== 'preview') {
      return res.status(404).json({ ok: false, error: 'Preview-only diagnostic' });
    }
    try {
      const results = await probeAshkReceivables({
        baseUrl: ASHK_BASE_URL,
        apiKey: process.env.ASHK_API_KEY,
        delayMs: 400
      });
      const recognized = results.filter(row => row.classification === 'recognized');
      const uncertain = results.filter(row => row.classification === 'uncertain');
      console.log(JSON.stringify({
        event: 'ashk-receivables-discovery',
        candidates: results.length,
        recognized,
        uncertain
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

  return res.status(200).json({
    ok: true,
    service: 'vector-ashk-backend',
    platform: 'vercel',
    version: '0.7.0',
    timestamp: new Date().toISOString(),
    integrations: {
      ashk: process.env.ASHK_API_KEY ? 'configured' : 'missing_secret',
      googleSheets: googleReady ? 'configured' : 'missing_secret',
      tochkaBalances: oidcReady ? 'vercel_oidc' : 'oidc_unavailable'
    }
  });
}

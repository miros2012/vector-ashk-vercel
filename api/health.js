import { createHash, timingSafeEqual } from 'node:crypto';
import nightlyFinanceOrchestrator from './nightly-finance-orchestrator.js';

const ONE_TIME_TOKEN_HASH = 'e5a7595324562257f36b13dee83549198633b8d753fc6fcde31cd39e13c8c663';

function oneTimeTokenMatches(value) {
  const digest = createHash('sha256').update(String(value || '')).digest('hex');
  return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(ONE_TIME_TOKEN_HASH, 'hex'));
}

export default async function handler(req, res) {
  if (oneTimeTokenMatches(req?.headers?.['x-manual-token'])) {
    const cronSecret = String(process.env.CRON_SECRET || '').trim();
    if (!cronSecret) return res.status(500).json({ ok: false, error: 'CRON_SECRET missing' });
    const internalReq = {
      ...req,
      method: 'GET',
      headers: {
        ...(req?.headers || {}),
        authorization: `Bearer ${cronSecret}`
      }
    };
    return nightlyFinanceOrchestrator(internalReq, res);
  }

  const googleReady = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  const oidcReady = Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
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

import syncHours from './sync-hours.js';

function isControlledHoursPreview() {
  return process.env.VERCEL_ENV === 'preview' &&
    String(process.env.VERCEL_GIT_COMMIT_REF || '').startsWith('preview-nightly-finance-orchestrator-v4');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const previewGate = String(req.query?.previewHoursGate || '');
  if (previewGate && isControlledHoursPreview()) {
    const secret = String(process.env.CRON_SECRET || '').trim();

    if (previewGate === 'verify') {
      if (!secret) {
        return res.status(503).json({ ok: false, error: 'preview cron secret missing' });
      }

      req.method = 'GET';
      req.body = {};
      req.query = {};
      req.headers = {
        ...(req.headers || {}),
        authorization: `Bearer ${secret}`
      };
      return syncHours(req, res);
    }

    return res.status(400).json({ ok: false, error: 'invalid preview gate mode' });
  }

  const googleReady = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  const oidcReady = Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
  res.status(200).json({
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

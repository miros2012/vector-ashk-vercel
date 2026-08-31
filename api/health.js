// Preview diagnostic: exposes only configured/missing flags, never secret values.
export default function handler(req, res) {
  const googleReady = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  const oidcReady = Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
  const hoursCronReady = Boolean(process.env.CRON_SECRET);
  const hoursManualSyncReady = Boolean(process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY);
  res.status(200).json({
    ok: true,
    service: 'vector-ashk-backend',
    platform: 'vercel',
    version: '0.7.0',
    timestamp: new Date().toISOString(),
    integrations: {
      ashk: process.env.ASHK_API_KEY ? 'configured' : 'missing_secret',
      googleSheets: googleReady ? 'configured' : 'missing_secret',
      tochkaBalances: oidcReady ? 'vercel_oidc' : 'oidc_unavailable',
      hoursCron: hoursCronReady ? 'configured' : 'missing_secret',
      hoursManualSync: hoursManualSyncReady ? 'configured' : 'missing_secret'
    }
  });
}

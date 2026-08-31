export default function handler(req, res) {
  const googleReady = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  const tochkaBalancesReady = Boolean(process.env.TOCHKA_BRIDGE_KEY);
  res.status(200).json({
    ok: true,
    service: 'vector-ashk-backend',
    platform: 'vercel',
    version: '0.6.0',
    timestamp: new Date().toISOString(),
    integrations: {
      ashk: process.env.ASHK_API_KEY ? 'configured' : 'missing_secret',
      googleSheets: googleReady ? 'configured' : 'missing_secret',
      tochkaBalances: tochkaBalancesReady ? 'configured' : 'missing_secret'
    }
  });
}

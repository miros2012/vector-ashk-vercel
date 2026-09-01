import syncHours from './sync-hours.js';

function isControlledPreview() {
  return process.env.VERCEL_ENV === 'preview' &&
    String(process.env.VERCEL_GIT_COMMIT_REF || '').startsWith('preview-nightly-finance-orchestrator-v3');
}

export default async function verifyNightlyPreview(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isControlledPreview()) {
    return res.status(404).json({ ok: false, error: 'not available' });
  }

  const secret = String(process.env.CRON_SECRET || '').trim();
  const execute = String(req.query?.execute || '') === 'hours';

  if (!execute) {
    return res.status(200).json({
      ok: true,
      cronSecretConfigured: Boolean(secret),
      writesPerformed: false
    });
  }

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

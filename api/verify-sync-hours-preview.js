import syncHours from './sync-hours.js';

export default async function verifySyncHoursPreview(req, res) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const manualKey = String(process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '').trim();

  if (!cronSecret && !manualKey) {
    return res.status(500).json({ ok: false, error: 'No sync auth key configured in Preview' });
  }

  req.query = {};
  req.headers = { ...(req.headers || {}) };

  if (cronSecret) {
    req.method = 'GET';
    req.headers.authorization = `Bearer ${cronSecret}`;
  } else {
    req.method = 'POST';
    req.body = { month: '2026-08' };
    req.headers['x-vector-key'] = manualKey;
  }

  return syncHours(req, res);
}

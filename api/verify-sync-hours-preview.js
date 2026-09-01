import syncHours from './sync-hours.js';

export default async function verifySyncHoursPreview(req, res) {
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ ok: false, error: 'CRON_SECRET missing in Preview' });
  }

  req.method = 'GET';
  req.query = {};
  req.headers = {
    ...(req.headers || {}),
    authorization: `Bearer ${process.env.CRON_SECRET}`
  };

  return syncHours(req, res);
}

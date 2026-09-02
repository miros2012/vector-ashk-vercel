function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function createDecisionEffectivenessApi({
  configuredKey = '',
  readEffectiveness,
  now = () => new Date()
}) {
  return async function decisionEffectivenessApi(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    const key = requestKey(req);
    if (!configuredKey || key !== configuredKey) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    try {
      const metrics = await readEffectiveness();
      return res.status(200).json({
        ok: true,
        metrics,
        checkedAt: now().toISOString()
      });
    } catch (error) {
      console.error('decision-effectiveness:', error);
      return res.status(500).json({ ok: false, error: 'decision effectiveness unavailable' });
    }
  };
}

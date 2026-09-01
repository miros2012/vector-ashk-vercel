function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function createDecisionEffectivenessApi({ configuredKey = '', readEffectiveness }) {
  if (typeof readEffectiveness !== 'function') throw new Error('readEffectiveness is required');
  return async function decisionEffectivenessApi(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Use GET' });
    const key = requestKey(req);
    if (!configuredKey || key !== configuredKey) return res.status(403).json({ ok:false, error:'forbidden' });
    try {
      return res.status(200).json({ ok:true, metrics: await readEffectiveness() });
    } catch (error) {
      console.error('decision-effectiveness:', error);
      return res.status(500).json({ ok:false, error:'decision effectiveness unavailable' });
    }
  };
}

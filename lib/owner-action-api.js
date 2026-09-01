function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function createOwnerActionApi({ configuredKey = '', readOwnerAction, now = () => new Date() }) {
  return async function ownerActionApi(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Use GET' });
    const key = requestKey(req);
    if (!configuredKey || key !== configuredKey) return res.status(403).json({ ok:false, error:'forbidden' });
    try {
      const view = await readOwnerAction();
      return res.status(200).json({ ok:true, ...view, checkedAt:now().toISOString() });
    } catch (error) {
      console.error('owner-action:', error);
      return res.status(500).json({ ok:false, error:'owner action unavailable' });
    }
  };
}

function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function createDecisionStateSyncHandler({ configuredKey = '', synchronize } = {}) {
  if (typeof synchronize !== 'function') throw new Error('synchronize is required');

  return async function decisionStateSyncHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Use POST' });
    }

    const key = requestKey(req);
    if (!configuredKey || key !== configuredKey) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    try {
      const result = await synchronize({ dryRun: req.body?.commit !== true });
      return res.status(200).json({
        ok: true,
        dryRun: Boolean(result.dryRun),
        total: Number(result.total) || 0,
        matchesBefore: Number(result.matchesBefore) || 0,
        writeCount: Number(result.writeCount) || 0,
        verified: Boolean(result.verified),
        matchesAfter: result.matchesAfter === null || result.matchesAfter === undefined
          ? null
          : Number(result.matchesAfter)
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (message === 'decision state writes are disabled') {
        return res.status(409).json({ ok: false, error: message });
      }
      if (message === 'post-write shadow verification failed') {
        return res.status(502).json({ ok: false, error: message });
      }
      console.error('decision-state-sync:', error);
      return res.status(500).json({ ok: false, error: 'decision state sync failed' });
    }
  };
}

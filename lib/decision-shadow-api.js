function requestKey(req) {
  const direct = String(req.headers?.['x-vector-key'] || '').trim();
  if (direct) return direct;
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function createDecisionShadowApi({ configuredKey = '', runShadow }) {
  if (typeof runShadow !== 'function') throw new Error('runShadow is required');

  return async function decisionShadowApi(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    const key = requestKey(req);
    if (!configuredKey || key !== configuredKey) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    try {
      const result = await runShadow();
      const comparison = result?.comparison || {};
      const rules = Array.isArray(comparison.results)
        ? comparison.results.map((row) => ({
            ruleId: row.ruleId,
            match: Boolean(row.match),
            fields: Array.isArray(row.fields) ? row.fields : [],
            active: Boolean(row.shadow?.active),
            amount: row.shadow?.amount ?? null,
            dueDate: row.shadow?.dueDate ?? null,
            linkedObjects: Array.isArray(row.shadow?.linkedObjects) ? row.shadow.linkedObjects : []
          }))
        : [];

      return res.status(200).json({
        ok: true,
        mode: 'shadow',
        matches: Number(comparison.matches || 0),
        total: Number(comparison.total || 0),
        mismatches: Array.isArray(comparison.mismatches)
          ? comparison.mismatches.map((row) => ({ ruleId: row.ruleId, fields: row.fields || [] }))
          : [],
        rules
      });
    } catch (error) {
      console.error('decision-shadow:', error);
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  };
}

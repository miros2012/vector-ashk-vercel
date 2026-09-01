export function createDecisionShadowStatusHandler({ runShadow, now = () => new Date() }) {
  if (typeof runShadow !== 'function') throw new Error('runShadow is required');

  return async function decisionShadowStatusHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    try {
      const result = await runShadow();
      const comparison = result?.comparison || {};
      const total = Math.max(Number(comparison.total) || 0, 0);
      const matches = Math.max(Number(comparison.matches) || 0, 0);
      const drift = Array.isArray(comparison.mismatches)
        ? comparison.mismatches.length
        : Math.max(total - matches, 0);

      return res.status(200).json({
        ok: true,
        status: drift === 0 && matches === total ? 'MATCH' : 'DRIFT',
        matches,
        total,
        drift,
        checkedAt: now().toISOString()
      });
    } catch (error) {
      console.error('decision-shadow-status:', error);
      return res.status(500).json({ ok: false, status: 'ERROR' });
    }
  };
}

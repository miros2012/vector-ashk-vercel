function publicAggregate(result) {
  return {
    ok: result?.ok !== false,
    mode: String(result?.mode || 'dry-run'),
    verified: Boolean(result?.verified),
    total: Number(result?.total ?? 0),
    matches: Number(result?.matches ?? 0),
    writeCount: Number(result?.writeCount ?? 0),
    trigger: 'daily-cron'
  };
}

export function createDecisionDailyReconciliationHandler({ cronSecret, reconcile, logger = console } = {}) {
  if (typeof reconcile !== 'function') throw new Error('reconcile is required');

  return async function decisionDailyReconciliationHandler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    const configuredSecret = String(cronSecret || '');
    if (!configuredSecret) {
      return res.status(503).json({ ok: false, error: 'Cron unavailable' });
    }

    if (String(req.headers?.authorization || '') !== `Bearer ${configuredSecret}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
      const result = await reconcile({ trigger: 'daily-cron' });
      return res.status(200).json(publicAggregate(result));
    } catch (error) {
      logger?.error?.('decision-daily-reconciliation:', error);
      return res.status(500).json({ ok: false, error: 'Daily reconciliation failed' });
    }
  };
}

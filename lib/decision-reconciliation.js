function publicResult(result, trigger) {
  const dryRun = result?.dryRun !== false;
  const matches = dryRun
    ? Number(result?.matchesBefore ?? 0)
    : Number(result?.matchesAfter ?? result?.matchesBefore ?? 0);

  return {
    ok: result?.ok !== false,
    mode: dryRun ? 'dry-run' : 'commit',
    verified: Boolean(result?.verified),
    total: Number(result?.total ?? 0),
    matches,
    writeCount: Number(result?.writeCount ?? 0),
    trigger
  };
}

export function createDecisionReconciler({ synchronize, writesEnabled = false, logger = console, audit = null } = {}) {
  if (typeof synchronize !== 'function') throw new Error('synchronize is required');

  return async function reconcileDecisionState({ trigger = 'unknown' } = {}) {
    try {
      const result = await synchronize({ dryRun: !writesEnabled });
      const publicValue = publicResult(result, String(trigger || 'unknown'));

      if (audit?.record) {
        try {
          await audit.record(publicValue);
        } catch (auditError) {
          logger?.error?.('decision-reconciliation-audit:', auditError);
        }
      }

      return publicValue;
    } catch (error) {
      logger?.error?.('decision-reconciliation:', error);
      throw new Error('decision reconciliation failed', { cause: error });
    }
  };
}
function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function createDecisionReconciliationAudit({ appendRow, now = () => new Date(), logger = console } = {}) {
  if (typeof appendRow !== 'function') throw new Error('appendRow is required');

  return {
    async record(result = {}) {
      const total = safeNumber(result.total);
      const matches = safeNumber(result.matches);
      const row = [
        now().toISOString(),
        String(result.trigger || 'unknown'),
        String(result.mode || 'unknown'),
        matches,
        total,
        Math.max(total - matches, 0),
        Boolean(result.verified),
        safeNumber(result.writeCount),
        result.ok === false ? 'FAIL' : 'OK'
      ];

      try {
        await appendRow(row);
        return { ok: true, recorded: true };
      } catch (error) {
        logger?.error?.('decision-reconciliation-audit:', error);
        return { ok: false, recorded: false };
      }
    }
  };
}

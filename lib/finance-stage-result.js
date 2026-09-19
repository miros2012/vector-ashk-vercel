const RETRYABLE = new Set(['ASHK_FETCH', 'SHEETS_WRITE', 'SHEETS_READBACK', 'ROP_PUBLISH', 'TIME_BUDGET']);
const PERMANENT = new Set(['READBACK_MISMATCH', 'ROP_BUILD', 'LEDGER_WRITE', 'AUTH', 'VALIDATION', 'UNCLASSIFIED']);

export const FINANCE_RETRYABLE_ERROR_CLASSES = Object.freeze([...RETRYABLE]);

export function sanitizeFinanceStageFailure({ statusCode = 500, errorClass = 'UNCLASSIFIED' } = {}) {
  const normalized = RETRYABLE.has(errorClass) || PERMANENT.has(errorClass)
    ? errorClass
    : 'UNCLASSIFIED';
  return {
    ok: false,
    statusCode: Number(statusCode) || 500,
    errorClass: normalized,
    retryable: RETRYABLE.has(normalized)
  };
}

export function financeStageSuccess({ statusCode = 200, body } = {}) {
  return { ok: true, statusCode: Number(statusCode) || 200, body };
}

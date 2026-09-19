import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { FINANCE_RETRYABLE_ERROR_CLASSES } from './finance-stage-result.js';

const RETRY_DELAYS_MS = Object.freeze({ 1: 10 * 60 * 1000, 2: 30 * 60 * 1000 });

export function validFinanceRetryState(state, { allowClaimed = false } = {}) {
  const attempt = Number(state?.finance_retry_attempt);
  const after = state?.finance_retry_after_utc;
  const date = new Date(after);
  return ['receivablesSource', 'ropPublish'].includes(state?.finance_retry_stage)
    && Number.isInteger(attempt) && attempt >= 2 && attempt <= 3
    && typeof after === 'string' && Boolean(after.trim())
    && ((allowClaimed && after === 'CLAIMED') || (Number.isFinite(date.getTime()) && date.toISOString() === after))
    && typeof state?.finance_retry_origin_run_id === 'string' && Boolean(state.finance_retry_origin_run_id.trim())
    && FINANCE_RETRYABLE_ERROR_CLASSES.includes(state?.finance_retry_error_class);
}

export function nextFinanceRetry({ failure, attempt, now, runId, stage }) {
  if (!['receivablesSource', 'ropPublish'].includes(stage)
    || !failure?.retryable || attempt >= 3 || !RETRY_DELAYS_MS[attempt]) return null;

  const retryAfter = new Date(new Date(now).getTime() + RETRY_DELAYS_MS[attempt]);
  return {
    finance_retry_stage: stage,
    finance_retry_attempt: attempt + 1,
    finance_retry_after_utc: retryAfter.toISOString(),
    finance_retry_origin_run_id: runId,
    finance_retry_error_class: failure.errorClass ?? ''
  };
}

export function recoveryStages(stage, { includeOwnerActions = false } = {}) {
  const tail = ['dataHealth', 'decisions'];
  if (includeOwnerActions) tail.push('ownerActionQueue');
  if (stage === 'receivablesSource') return ['receivablesSource', 'ropPublish', ...tail];
  if (stage === 'ropPublish') return ['ropPublish', ...tail];
  return [];
}

export function createFinanceRunId(now = new Date(), random = cryptoRandomBytes(16)) {
  const bytes = typeof random === 'function' ? random(16) : random;
  const suffix = Buffer.from(bytes).toString('hex');
  return `${new Date(now).toISOString()}-${suffix}`;
}

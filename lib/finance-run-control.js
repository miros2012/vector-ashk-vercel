import { sanitizeFinanceStageFailure } from './finance-stage-result.js';
import { createFinanceRunId, nextFinanceRetry, validFinanceRetryState } from './finance-retry-policy.js';

const LEASE_MS = 4 * 60 * 1000;
const ROUTE_BUDGET_MS = 180_000;
const DEFAULT_MINIMUM_REMAINING_MS = 90_000;
const CLAIMED_RETRY_AFTER_UTC = 'CLAIMED';

function currentTime(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function ledgerFailure() {
  return sanitizeFinanceStageFailure({ statusCode: 500, errorClass: 'LEDGER_WRITE' });
}

function stageFailure(value) {
  return sanitizeFinanceStageFailure({
    statusCode: value?.statusCode,
    errorClass: value?.errorClass
  });
}

function successResult(value) {
  return { ...value, ok: true, statusCode: Number(value?.statusCode) || 200 };
}

function recoveryFor(context, stage, attempt) {
  const recovery = context?.recovery;
  return recovery?.stage === stage && Number(recovery.attempt) === Number(attempt);
}

function blockRecovery(context) {
  context.recoveryBlocked = true;
  return ledgerFailure();
}

export function createFinanceRunControl({
  store,
  now = () => new Date(),
  requestStartedAt,
  minimumRemainingMs = DEFAULT_MINIMUM_REMAINING_MS,
  randomBytes,
  deploymentSha = '',
  log = console.error
} = {}) {
  if (!store || typeof store !== 'object') throw new Error('store is required');
  const deadline = currentTime(requestStartedAt ?? now).getTime() + ROUTE_BUDGET_MS;
  const configuredMinimum = Number(minimumRemainingMs);
  const minimum = Number.isFinite(configuredMinimum) && configuredMinimum > 0 && configuredMinimum <= ROUTE_BUDGET_MS
    ? configuredMinimum : DEFAULT_MINIMUM_REMAINING_MS;

  async function begin({ trigger = '', mode = '' } = {}) {
    try {
      const schema = await store.ensureSchema();
      if (schema?.ok !== true) return ledgerFailure();

      const startedAt = currentTime(now);
      const runId = createFinanceRunId(startedAt, randomBytes);
      const lease = await store.acquireLease({ runId, leaseMs: LEASE_MS });
      if (lease?.busy) return { ok: false, statusCode: 409 };
      if (lease?.ok !== true) return ledgerFailure();
      return {
        ok: true,
        runId,
        startedAtUtc: startedAt.toISOString(),
        trigger: String(trigger),
        mode: String(mode),
        ...(lease.reclaimedLeaseOwner && lease.reclaimedLeaseUntilUtc ? {
          reclaimedLeaseOwner: String(lease.reclaimedLeaseOwner),
          reclaimedLeaseUntilUtc: String(lease.reclaimedLeaseUntilUtc)
        } : {})
      };
    } catch {
      return ledgerFailure();
    }
  }

  async function pendingRecovery(context) {
    if (context?.ok !== true) return null;
    try {
      const state = await store.readRetry();
      if (!state) return null;
      const claimed = state?.finance_retry_after_utc === CLAIMED_RETRY_AFTER_UTC;
      const reclaimedUntil = new Date(context.reclaimedLeaseUntilUtc);
      const staleClaim = claimed
        && validFinanceRetryState(state, { allowClaimed: true })
        && String(state.finance_retry_origin_run_id || '') === context.reclaimedLeaseOwner
        && Number.isFinite(reclaimedUntil.getTime())
        && reclaimedUntil.getTime() <= currentTime(now).getTime();
      if (state?.ok === false || (claimed ? !staleClaim : !validFinanceRetryState(state))) {
        return blockRecovery(context);
      }
      const dueAt = claimed ? null : new Date(state.finance_retry_after_utc);
      const attempt = Number(state.finance_retry_attempt);
      if (dueAt && dueAt.getTime() > currentTime(now).getTime()) return null;
      const recovery = {
        stage: state.finance_retry_stage,
        attempt,
        originRunId: String(state.finance_retry_origin_run_id || ''),
        errorClass: String(state.finance_retry_error_class || '')
      };
      const claim = {
        ...state,
        finance_retry_after_utc: CLAIMED_RETRY_AFTER_UTC,
        finance_retry_origin_run_id: context.runId
      };
      if ((await store.writeRetry(claim))?.ok !== true) return blockRecovery(context);
      context.recovery = recovery;
      context.recoveryClaim = claim;
      return recovery;
    } catch {
      return blockRecovery(context);
    }
  }

  async function runStage(context, { stage, attempt, execute } = {}) {
    if (context?.ok !== true) return { ok: false, statusCode: Number(context?.statusCode) || 409 };
    if (context.recoveryBlocked) return ledgerFailure();
    if (typeof execute !== 'function') throw new Error('stage execute is required');

    const startedAtUtc = currentTime(now).toISOString();
    let outcome;
    try {
      outcome = deadline - currentTime(now).getTime() < minimum
        ? sanitizeFinanceStageFailure({ statusCode: 503, errorClass: 'TIME_BUDGET' })
        : await execute();
    } catch {
      outcome = sanitizeFinanceStageFailure({ statusCode: 500, errorClass: 'UNCLASSIFIED' });
    }

    const succeeded = outcome?.ok === true;
    const result = succeeded ? successResult(outcome) : stageFailure(outcome);
    const retry = succeeded ? null : nextFinanceRetry({
      failure: result,
      attempt: Number(attempt),
      now: currentTime(now),
      runId: context.runId,
      stage
    });
    const recoveryAttempt = recoveryFor(context, stage, attempt);
    const recovered = succeeded && recoveryAttempt;
    const ledgerEntry = {
      runId: context.runId,
      startedAtUtc,
      finishedAtUtc: currentTime(now).toISOString(),
      trigger: context.trigger,
      mode: context.mode,
      stage,
      attempt: Number(attempt),
      result: succeeded ? (recovered ? 'RECOVERED' : 'SUCCESS') : 'FAILED',
      statusCode: result.statusCode,
      errorClass: succeeded ? '' : result.errorClass,
      retryable: succeeded ? false : result.retryable,
      retryAfterUtc: retry?.finance_retry_after_utc || '',
      deploymentSha: String(deploymentSha || '')
    };

    let appended;
    try {
      appended = await store.appendAttempt(ledgerEntry);
    } catch {
      appended = null;
    }
    if (appended?.ok !== true) {
      if (!recoveryAttempt) {
        try { await store.clearRetry(); } catch {}
      }
      const failure = ledgerFailure();
      log({ stage, errorClass: failure.errorClass, attempt: Number(attempt), retryable: failure.retryable });
      return failure;
    }

    try {
      if (succeeded) {
        if (recovered && (await store.clearRetry())?.ok !== true) return ledgerFailure();
        return result;
      }
      if (retry) {
        if ((await store.writeRetry(retry))?.ok !== true) {
          if (!recoveryAttempt) {
            try { await store.clearRetry(); } catch {}
          }
          const failure = ledgerFailure();
          log({ stage, errorClass: failure.errorClass, attempt: Number(attempt), retryable: failure.retryable });
          return failure;
        }
      } else if ((await store.clearRetry())?.ok !== true) {
        return ledgerFailure();
      }
    } catch {
      return ledgerFailure();
    }

    log({ stage, errorClass: result.errorClass, attempt: Number(attempt), retryable: result.retryable });
    return result;
  }

  async function finish(context) {
    if (context?.ok !== true || !context.runId) return { ok: true, released: false };
    try {
      return await store.releaseLease({ runId: context.runId });
    } catch {
      return ledgerFailure();
    }
  }

  return { begin, runStage, pendingRecovery, finish };
}

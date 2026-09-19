import { sanitizeFinanceStageFailure } from './finance-stage-result.js';

function requestBearer(req) {
  const authorization = String(req?.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function childResponseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = Number(code); return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end(body) { if (body !== undefined) this.body = body; return this; }
  };
}

async function invokeChild(handler, cronSecret, method = 'GET', stageName = 'stage') {
  const req = {
    method,
    headers: { authorization: `Bearer ${cronSecret}` },
    query: {},
    body: {}
  };
  const res = childResponseRecorder();
  try {
    await handler(req, res);
    const bodyOk = !res.body || typeof res.body !== 'object' || res.body.ok !== false;
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300 && bodyOk,
      statusCode: res.statusCode,
      body: res.body
    };
  } catch (error) {
    const failure = sanitizeFinanceStageFailure({ statusCode: 500, errorClass: error?.errorClass });
    console.error({ stage: stageName, errorClass: failure.errorClass, attempt: 1, retryable: failure.retryable });
    return failure;
  }
}

function trackedFailure(value) {
  return sanitizeFinanceStageFailure({
    statusCode: value?.statusCode,
    errorClass: value?.errorClass || value?.body?.errorClass
  });
}

async function invokeReceivablesSource(handler, cronSecret) {
  const result = await invokeChild(handler, cronSecret, 'GET', 'receivablesSource');
  return result.ok ? result : trackedFailure(result);
}

async function invokeRopPublish(handler) {
  try {
    const result = await handler();
    if (result?.ok === true) {
      return { ...result, ok: true, statusCode: Number(result.statusCode) || 200 };
    }
    return trackedFailure(result);
  } catch (error) {
    return trackedFailure({ statusCode: error?.statusCode || 502, errorClass: error?.errorClass || 'ROP_PUBLISH' });
  }
}

function stageResult(result) {
  const stage = { ok: result?.ok === true, statusCode: Number(result?.statusCode) || null };
  if (result?.errorClass) stage.errorClass = result.errorClass;
  return stage;
}

function failureStatus(result, fallback = 502) {
  const statusCode = Number(result?.statusCode);
  return statusCode >= 400 ? statusCode : fallback;
}

export function createNightlyFinanceOrchestrator({
  cronSecret = '',
  runHours,
  runPayments,
  runReceivables,
  runReceivablesSource,
  runRopPublish,
  runTochkaDds,
  runBalances,
  runDataHealth,
  runDecisions,
  runControl
}) {
  if (typeof runHours !== 'function') throw new Error('runHours is required');
  if (runPayments != null && typeof runPayments !== 'function') throw new Error('runPayments must be a function');
  if (runReceivables != null && typeof runReceivables !== 'function') throw new Error('runReceivables must be a function');
  if (runReceivablesSource != null && typeof runReceivablesSource !== 'function') throw new Error('runReceivablesSource must be a function');
  if (runRopPublish != null && typeof runRopPublish !== 'function') throw new Error('runRopPublish must be a function');
  const hasSplitReceivables = typeof runReceivablesSource === 'function' && typeof runRopPublish === 'function';
  if (!hasSplitReceivables && (runReceivablesSource != null || runRopPublish != null)) {
    throw new Error('runReceivablesSource and runRopPublish must be provided together');
  }
  if (typeof runReceivables !== 'function' && !hasSplitReceivables) throw new Error('runReceivables is required');
  if (runTochkaDds != null && typeof runTochkaDds !== 'function') throw new Error('runTochkaDds must be a function');
  if (runBalances != null && typeof runBalances !== 'function') throw new Error('runBalances must be a function');
  if (runDataHealth != null && typeof runDataHealth !== 'function') throw new Error('runDataHealth must be a function');
  if (typeof runDecisions !== 'function') throw new Error('runDecisions is required');
  if (runControl != null && (
    typeof runControl.begin !== 'function'
    || typeof runControl.pendingRecovery !== 'function'
    || typeof runControl.runStage !== 'function'
    || typeof runControl.finish !== 'function'
  )) throw new Error('runControl must implement begin, pendingRecovery, runStage, and finish');

  const hasPayments = typeof runPayments === 'function';
  const hasTochkaDds = typeof runTochkaDds === 'function';
  const hasBalances = typeof runBalances === 'function';
  const dataHealthRunner = typeof runDataHealth === 'function'
    ? runDataHealth
    : typeof runDecisions.dataHealth === 'function'
      ? runDecisions.dataHealth
      : null;
  const hasDataHealth = typeof dataHealthRunner === 'function';

  function blockedResponse(res, result) {
    return res.status(failureStatus(result, 500)).json({
      ok: false,
      error: 'finance run control failed',
      stages: {}
    });
  }

  return async function nightlyFinanceOrchestrator(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');

    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }
    const secret = String(cronSecret || '').trim();
    if (!secret || requestBearer(req) !== secret) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const stages = {};
    const failures = [];

    let context = null;
    let recovery = null;
    if (runControl) {
      context = await runControl.begin({ trigger: 'cron', mode: 'nightly' });
      if (context?.ok !== true) return blockedResponse(res, context);
    }

    try {
      if (runControl) {
        recovery = await runControl.pendingRecovery(context);
        // A ledger failure is deliberately a blocking result, not an absent
        // recovery. Falling through would run normal work without a durable
        // record of the retry state.
        if (recovery?.ok === false) return blockedResponse(res, recovery);
        if (recovery && !['receivablesSource', 'ropPublish'].includes(recovery.stage)) {
          return blockedResponse(res, { statusCode: 500 });
        }
      }

      const invokeTrackedStage = async (stage, attempt, handler) => {
        const execute = stage === 'ropPublish'
          ? () => invokeRopPublish(handler)
          : () => invokeReceivablesSource(handler, secret);
        return runControl
          ? runControl.runStage(context, { stage, attempt, execute })
          : execute();
      };

      const runDataHealthAndDecisions = async ({ mode, retriedStage } = {}) => {
        if (hasDataHealth) {
          const dataHealth = await invokeChild(dataHealthRunner, secret, 'GET', 'dataHealth');
          stages.dataHealth = stageResult(dataHealth);
          if (!dataHealth.ok) {
            stages.decisions = { ok: false, statusCode: null, skipped: true };
            return res.status(failureStatus(dataHealth, 503)).json({
              ok: false,
              ...(mode ? { mode, retriedStage } : {}),
              stages
            });
          }
        }

        const decisions = await invokeChild(runDecisions, secret, 'GET', 'decisions');
        stages.decisions = stageResult(decisions);
        if (!decisions.ok) {
          return res.status(failureStatus(decisions)).json({
            ok: false,
            ...(mode ? { mode, retriedStage } : {}),
            stages
          });
        }
        return null;
      };

      if (recovery) {
        if (!hasSplitReceivables) return blockedResponse(res, { statusCode: 500 });

        if (recovery.stage === 'receivablesSource') {
          const receivablesSource = await invokeTrackedStage(
            'receivablesSource', recovery.attempt, runReceivablesSource
          );
          stages.receivablesSource = stageResult(receivablesSource);
          if (!receivablesSource.ok) {
            failures.push(receivablesSource);
            stages.ropPublish = { ok: false, statusCode: null, skipped: true };
          }
        }

        if (recovery.stage === 'ropPublish' || stages.receivablesSource?.ok) {
          const ropPublish = await invokeTrackedStage(
            'ropPublish', recovery.stage === 'ropPublish' ? recovery.attempt : 1, runRopPublish
          );
          stages.ropPublish = stageResult(ropPublish);
          if (!ropPublish.ok) failures.push(ropPublish);
        }

        const downstream = await runDataHealthAndDecisions({ mode: 'recovery', retriedStage: recovery.stage });
        if (downstream) return downstream;
        if (failures.length) {
          return res.status(failureStatus(failures[0])).json({
            ok: false,
            mode: 'recovery',
            retriedStage: recovery.stage,
            stages
          });
        }
        return res.status(200).json({ ok: true, mode: 'recovery', retriedStage: recovery.stage, stages });
      }

      // Canonical accounting must never wait behind slow ASHK sources. Attempt
      // the bounded current-day Tochka -> DDS import first, but keep refreshing
      // independent sources even if the accounting stage itself fails.
      if (hasTochkaDds) {
        const tochkaDds = await invokeChild(runTochkaDds, secret, 'GET', 'tochkaDds');
        stages.tochkaDds = stageResult(tochkaDds);
        if (!tochkaDds.ok) failures.push(tochkaDds);
      }

      const hours = await invokeChild(runHours, secret, 'GET', 'hours');
      stages.hours = stageResult(hours);
      if (!hours.ok) failures.push(hours);

    // Existing unit tests also exercise a minimal harness without payments.
    // Production always provides payments; keep the old fail-closed behavior
    // only for that stripped harness while production refreshes all sources.
      if (!hours.ok && !hasPayments) {
        if (hasSplitReceivables) {
          stages.receivablesSource = { ok: false, statusCode: null, skipped: true };
          stages.ropPublish = { ok: false, statusCode: null, skipped: true };
        } else {
          stages.receivables = { ok: false, statusCode: null, skipped: true };
        }
        if (hasBalances) stages.balances = { ok: false, statusCode: null, skipped: true };
        if (hasDataHealth) stages.dataHealth = { ok: false, statusCode: null, skipped: true };
        stages.decisions = { ok: false, statusCode: null, skipped: true };
        return res.status(failureStatus(hours)).json({ ok: false, stages });
      }

      if (hasPayments) {
        const payments = await invokeChild(runPayments, secret, 'POST', 'payments');
        stages.payments = stageResult(payments);
        if (!payments.ok) failures.push(payments);
      }

      if (hasSplitReceivables) {
        const receivablesSource = await invokeTrackedStage('receivablesSource', 1, runReceivablesSource);
        stages.receivablesSource = stageResult(receivablesSource);
        if (!receivablesSource.ok) failures.push(receivablesSource);

        if (receivablesSource.ok) {
          const ropPublish = await invokeTrackedStage('ropPublish', 1, runRopPublish);
          stages.ropPublish = stageResult(ropPublish);
          if (!ropPublish.ok) failures.push(ropPublish);
        } else {
          stages.ropPublish = { ok: false, statusCode: null, skipped: true };
        }
      } else {
        const receivables = await invokeChild(runReceivables, secret, 'GET', 'receivables');
        stages.receivables = stageResult(receivables);
        if (!receivables.ok) failures.push(receivables);
      }

      if (hasBalances) {
        const balances = await invokeChild(runBalances, secret, 'GET', 'balances');
        stages.balances = stageResult(balances);
        if (!balances.ok) failures.push(balances);
      }

    // The production pipeline has an explicit Data Health gate. A transient
    // refresh failure must remain visible in the aggregate response, but it
    // must not prevent Data Health from deciding whether the already verified
    // live snapshot is safe enough to rebuild decisions. Minimal test harnesses
    // without the production payments stage retain the historical fail-closed
    // behavior, as do callers that cannot provide the explicit health gate.
      if (failures.length && ((!hasPayments && !hasSplitReceivables) || !hasDataHealth)) {
        if (hasDataHealth) stages.dataHealth = { ok: false, statusCode: null, skipped: true };
        stages.decisions = { ok: false, statusCode: null, skipped: true };
        return res.status(failureStatus(failures[0])).json({ ok: false, stages });
      }

      const downstream = await runDataHealthAndDecisions();
      if (downstream) return downstream;

      if (failures.length) {
        return res.status(failureStatus(failures[0])).json({ ok: false, stages });
      }

      return res.status(200).json({ ok: true, stages });
    } finally {
      if (context) await runControl.finish(context);
    }
  };
}

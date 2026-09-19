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

async function invokeChild(handler, secret, method = 'GET', stageName = 'stage') {
  const req = {
    method,
    headers: { authorization: `Bearer ${secret}` },
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

async function invokeReceivablesSource(handler, secret) {
  const result = await invokeChild(handler, secret, 'GET', 'receivablesSource');
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

function decisionStage(result) {
  const body = result?.body && typeof result.body === 'object' ? result.body : {};
  const mode = String(body.mode || '');
  const verified = body.verified === true;
  const matches = Number(body.matches);
  const total = Number(body.total);
  const countsValid = Number.isFinite(matches) && matches >= 0
    && Number.isFinite(total) && total >= 0;
  const ok = result?.ok === true
    && mode === 'commit'
    && verified
    && countsValid
    && matches === total;

  return {
    ok,
    statusCode: Number(result?.statusCode) || 0,
    mode,
    verified,
    matches: countsValid ? matches : null,
    total: countsValid ? total : null
  };
}

function ownerActionQueueStage(value, ok = value?.ok === true) {
  return {
    ok,
    staged: Math.max(Number(value?.staged) || 0, 0),
    ready: Math.max(Number(value?.ready) || 0, 0),
    succeeded: Math.max(Number(value?.succeeded) || 0, 0),
    failed: Math.max(Number(value?.failed) || 0, 0)
  };
}

export function createIntradayRopOrchestrator({
  cronSecret = '',
  runPayments,
  runReceivables,
  refreshRop,
  runReceivablesSource,
  runRopPublish,
  runTochkaDds,
  runBalances,
  runDataHealth,
  runDecisions,
  runOwnerActionQueue,
  runControl,
  recoveryOnly = false
} = {}) {
  if (typeof runPayments !== 'function') throw new Error('runPayments is required');
  if (runReceivables != null && typeof runReceivables !== 'function') throw new Error('runReceivables must be a function');
  if (refreshRop != null && typeof refreshRop !== 'function') throw new Error('refreshRop must be a function');
  if (runReceivablesSource != null && typeof runReceivablesSource !== 'function') throw new Error('runReceivablesSource must be a function');
  if (runRopPublish != null && typeof runRopPublish !== 'function') throw new Error('runRopPublish must be a function');
  const hasSplitReceivables = typeof runReceivablesSource === 'function' && typeof runRopPublish === 'function';
  if (!hasSplitReceivables && (runReceivablesSource != null || runRopPublish != null)) {
    throw new Error('runReceivablesSource and runRopPublish must be provided together');
  }
  if (!hasSplitReceivables && typeof refreshRop !== 'function') throw new Error('refreshRop is required');
  if (runTochkaDds != null && typeof runTochkaDds !== 'function') throw new Error('runTochkaDds must be a function');
  if (runBalances != null && typeof runBalances !== 'function') throw new Error('runBalances must be a function');
  if (typeof runDataHealth !== 'function') throw new Error('runDataHealth is required');
  if (typeof runDecisions !== 'function') throw new Error('runDecisions is required');
  if (typeof runOwnerActionQueue !== 'function') throw new Error('runOwnerActionQueue is required');
  if (runControl != null && (
    typeof runControl.begin !== 'function'
    || typeof runControl.pendingRecovery !== 'function'
    || typeof runControl.runStage !== 'function'
    || typeof runControl.finish !== 'function'
  )) throw new Error('runControl must implement begin, pendingRecovery, runStage, and finish');
  if (typeof recoveryOnly !== 'boolean') throw new Error('recoveryOnly must be a boolean');
  const hasReceivables = typeof runReceivables === 'function';
  const hasTochkaDds = typeof runTochkaDds === 'function';
  const hasBalances = typeof runBalances === 'function';

  function blockedResponse(res, result) {
    return res.status(failureStatus(result, 500)).json({
      ok: false,
      error: 'finance run control failed',
      stages: {}
    });
  }

  function appendSkippedTail(stages) {
    if (hasTochkaDds && !stages.tochkaDds) stages.tochkaDds = { ok: false, statusCode: null, skipped: true };
    if (hasBalances && !stages.balances) stages.balances = { ok: false, statusCode: null, skipped: true };
    if (!stages.dataHealth) stages.dataHealth = { ok: false, statusCode: null, skipped: true };
    if (!stages.decisions) stages.decisions = { ok: false, statusCode: null, skipped: true };
    if (!stages.ownerActionQueue) stages.ownerActionQueue = { ok: false, skipped: true };
    return stages;
  }

  function successfulSourceStages({ payments, receivables, rop, tochkaDds, balances }) {
    const stages = {
      payments: { ok: true, statusCode: payments.statusCode },
      rop: { ok: true, liveDate: rop.liveDate || rop.asOfDate || '' }
    };
    if (hasReceivables) stages.receivables = { ok: true, statusCode: receivables.statusCode };
    if (hasTochkaDds) stages.tochkaDds = { ok: true, statusCode: tochkaDds.statusCode };
    if (hasBalances) stages.balances = { ok: true, statusCode: balances.statusCode };
    return stages;
  }

  return async function intradayRopOrchestrator(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }
    const secret = String(cronSecret || '').trim();
    if (!secret || requestBearer(req) !== secret) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    let context = null;
    if (runControl) {
      context = await runControl.begin({ trigger: 'cron', mode: 'intraday' });
      if (context?.ok !== true) return blockedResponse(res, context);
    }

    try {
      let recovery = null;
      if (runControl) {
        recovery = await runControl.pendingRecovery(context);
        // A failed ledger read is a hard stop. Normal work must never run
        // while retry state is unknown.
        if (recovery?.ok === false) return blockedResponse(res, recovery);
        if (recovery && !['receivablesSource', 'ropPublish'].includes(recovery.stage)) {
          return blockedResponse(res, { statusCode: 500 });
        }
      }

      if (!recovery && recoveryOnly) {
        return res.status(200).json({ ok: true, mode: 'recovery_idle', stages: {} });
      }

      const invokeTrackedStage = async (stage, attempt, handler) => {
        const execute = stage === 'ropPublish'
          ? () => invokeRopPublish(handler)
          : () => invokeReceivablesSource(handler, secret);
        return runControl
          ? runControl.runStage(context, { stage, attempt, execute })
          : execute();
      };

      const runGatedTail = async (stages, { mode, retriedStage, includeOwnerActions = true } = {}) => {
        const responseMeta = mode ? { mode, retriedStage } : {};
        const dataHealth = await invokeChild(runDataHealth, secret, 'GET', 'dataHealth');
        stages.dataHealth = { ok: dataHealth.ok, statusCode: dataHealth.statusCode };
        if (!dataHealth.ok) {
          appendSkippedTail(stages);
          return res.status(failureStatus(dataHealth, 503)).json({ ok: false, ...responseMeta, stages });
        }

        const decisions = await invokeChild(runDecisions, secret, 'GET', 'decisions');
        stages.decisions = decisionStage(decisions);
        if (!stages.decisions.ok) {
          appendSkippedTail(stages);
          return res.status(failureStatus(decisions)).json({ ok: false, ...responseMeta, stages });
        }

        if (!includeOwnerActions) {
          stages.ownerActionQueue = { ok: false, skipped: true };
          return null;
        }

        let ownerActionQueue;
        try {
          ownerActionQueue = await runOwnerActionQueue();
        } catch {
          ownerActionQueue = null;
        }
        stages.ownerActionQueue = ownerActionQueueStage(ownerActionQueue);
        if (!stages.ownerActionQueue.ok) {
          return res.status(502).json({ ok: false, ...responseMeta, stages });
        }
        return null;
      };

      if (recovery) {
        if (!hasSplitReceivables) return blockedResponse(res, { statusCode: 500 });
        const stages = {};
        const failures = [];

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
          stages.ropPublish = {
            ...stageResult(ropPublish),
            ...(ropPublish?.ok ? { liveDate: ropPublish.liveDate || ropPublish.asOfDate || '' } : {})
          };
          if (!ropPublish.ok) failures.push(ropPublish);
        }

        const downstream = await runGatedTail(stages, {
          mode: 'recovery',
          retriedStage: recovery.stage,
          includeOwnerActions: !recoveryOnly
        });
        if (downstream) return downstream;
        if (failures.length) {
          return res.status(failureStatus(failures[0])).json({
            ok: false, mode: 'recovery', retriedStage: recovery.stage, stages
          });
        }
        return res.status(200).json({ ok: true, mode: 'recovery', retriedStage: recovery.stage, stages });
      }

      if (hasSplitReceivables) {
        let tochkaDds = null;
        if (hasTochkaDds) tochkaDds = await invokeChild(runTochkaDds, secret, 'GET', 'tochkaDds');

        const payments = await invokeChild(runPayments, secret, 'POST', 'payments');
        const receivablesSource = await invokeTrackedStage('receivablesSource', 1, runReceivablesSource);
        if (!payments.ok || !receivablesSource.ok) {
          const failed = !payments.ok ? payments : receivablesSource;
          const stages = {
            payments: { ok: payments.ok, statusCode: payments.statusCode },
            receivablesSource: stageResult(receivablesSource),
            ropPublish: { ok: false, statusCode: null, skipped: true }
          };
          if (hasTochkaDds) stages.tochkaDds = { ok: tochkaDds.ok, statusCode: tochkaDds.statusCode };
          return res.status(failureStatus(failed)).json({ ok: false, stages: appendSkippedTail(stages) });
        }

        const ropPublish = await invokeTrackedStage('ropPublish', 1, runRopPublish);
        if (!ropPublish.ok) {
          const stages = {
            payments: { ok: true, statusCode: payments.statusCode },
            receivablesSource: stageResult(receivablesSource),
            ropPublish: stageResult(ropPublish)
          };
          if (hasTochkaDds) stages.tochkaDds = { ok: tochkaDds.ok, statusCode: tochkaDds.statusCode };
          return res.status(failureStatus(ropPublish)).json({ ok: false, stages: appendSkippedTail(stages) });
        }

        const stages = {
          payments: { ok: true, statusCode: payments.statusCode },
          receivablesSource: stageResult(receivablesSource),
          ropPublish: { ...stageResult(ropPublish), liveDate: ropPublish.liveDate || ropPublish.asOfDate || '' }
        };
        if (hasTochkaDds) {
          stages.tochkaDds = { ok: tochkaDds.ok, statusCode: tochkaDds.statusCode };
          if (!tochkaDds.ok) {
            return res.status(failureStatus(tochkaDds)).json({ ok: false, mode: 'intraday_rop', stages: appendSkippedTail(stages) });
          }
        }
        if (hasBalances) {
          const balances = await invokeChild(runBalances, secret, 'GET', 'balances');
          stages.balances = { ok: balances.ok, statusCode: balances.statusCode };
          if (!balances.ok) {
            return res.status(failureStatus(balances)).json({ ok: false, mode: 'intraday_rop', stages: appendSkippedTail(stages) });
          }
        }
        const downstream = await runGatedTail(stages, { mode: 'intraday_rop' });
        if (downstream) return downstream;
        return res.status(200).json({ ok: true, mode: 'intraday_rop', stages });
      }

      // Accounting import is bounded and must not sit behind slow ASHK calls.
      // Attempt it first, then still refresh independent ASHK/ROP sources so a
      // DDS error does not make those datasets stale as well.
      let tochkaDds = null;
      if (hasTochkaDds) {
        tochkaDds = await invokeChild(runTochkaDds, secret, 'GET', 'tochkaDds');
      }

      const payments = await invokeChild(runPayments, secret, 'POST', 'payments');
      let receivables = null;
      if (hasReceivables) {
        // Receivables is an independent ASHK source. Refresh it even if payments
        // failed so a single source outage cannot leave both datasets stale.
        receivables = await invokeChild(runReceivables, secret, 'GET', 'receivables');
      }

      if (!payments.ok || (hasReceivables && !receivables.ok)) {
        const failed = !payments.ok ? payments : receivables;
        const stages = {
          payments: { ok: payments.ok, statusCode: payments.statusCode },
          rop: { ok: false, skipped: true }
        };
        if (hasReceivables) stages.receivables = { ok: receivables.ok, statusCode: receivables.statusCode };
        if (hasTochkaDds) stages.tochkaDds = { ok: tochkaDds.ok, statusCode: tochkaDds.statusCode };
        const statusCode = failed.statusCode >= 400 ? failed.statusCode : 502;
        return res.status(statusCode).json({ ok: false, stages: appendSkippedTail(stages) });
      }

      const verifiedReceivablesRop = receivables?.body?.afterVerified;
      const rop = verifiedReceivablesRop?.ok === true
        && verifiedReceivablesRop?.standalonePublished === true
        ? verifiedReceivablesRop
        : await refreshRop();
      if (!rop?.ok) {
        const stages = {
          payments: { ok: true, statusCode: payments.statusCode },
          rop: { ok: false }
        };
        if (hasReceivables) stages.receivables = { ok: true, statusCode: receivables.statusCode };
        if (hasTochkaDds) stages.tochkaDds = { ok: tochkaDds.ok, statusCode: tochkaDds.statusCode };
        return res.status(502).json({ ok: false, stages: appendSkippedTail(stages) });
      }

      if (hasTochkaDds && !tochkaDds.ok) {
        const statusCode = tochkaDds.statusCode >= 400 ? tochkaDds.statusCode : 502;
        const stages = {
          payments: { ok: true, statusCode: payments.statusCode },
          rop: { ok: true, liveDate: rop.liveDate || rop.asOfDate || '' },
          tochkaDds: { ok: false, statusCode: tochkaDds.statusCode }
        };
        if (hasReceivables) stages.receivables = { ok: true, statusCode: receivables.statusCode };
        return res.status(statusCode).json({ ok: false, mode: 'intraday_rop', stages: appendSkippedTail(stages) });
      }

      let balances;
      if (hasBalances) {
        balances = await invokeChild(runBalances, secret, 'GET', 'balances');
        if (!balances.ok) {
          const statusCode = balances.statusCode >= 400 ? balances.statusCode : 502;
          const stages = successfulSourceStages({ payments, receivables, rop, tochkaDds, balances });
          stages.balances = { ok: false, statusCode: balances.statusCode };
          return res.status(statusCode).json({ ok: false, mode: 'intraday_rop', stages: appendSkippedTail(stages) });
        }
      }

      const stages = successfulSourceStages({ payments, receivables, rop, tochkaDds, balances });
      const dataHealth = await invokeChild(runDataHealth, secret, 'GET', 'dataHealth');
      stages.dataHealth = { ok: dataHealth.ok, statusCode: dataHealth.statusCode };
      if (!dataHealth.ok) {
        const statusCode = dataHealth.statusCode >= 400 ? dataHealth.statusCode : 503;
        return res.status(statusCode).json({ ok: false, mode: 'intraday_rop', stages: appendSkippedTail(stages) });
      }

      const decisions = await invokeChild(runDecisions, secret, 'GET', 'decisions');
      stages.decisions = decisionStage(decisions);
      if (!stages.decisions.ok) {
        const statusCode = decisions.statusCode >= 400 ? decisions.statusCode : 502;
        return res.status(statusCode).json({ ok: false, mode: 'intraday_rop', stages: appendSkippedTail(stages) });
      }

      let ownerActionQueue;
      try {
        ownerActionQueue = await runOwnerActionQueue();
      } catch {
        ownerActionQueue = null;
      }
      stages.ownerActionQueue = ownerActionQueueStage(ownerActionQueue);
      if (!stages.ownerActionQueue.ok) return res.status(502).json({ ok: false, mode: 'intraday_rop', stages });

      return res.status(200).json({ ok: true, mode: 'intraday_rop', stages });
    } catch {
      console.error({ stage: 'intraday', errorClass: 'UNCLASSIFIED', attempt: 1, retryable: false });
      return res.status(500).json({ ok: false, error: 'Intraday ROP orchestration failed' });
    } finally {
      if (context) await runControl.finish(context);
    }
  };
}

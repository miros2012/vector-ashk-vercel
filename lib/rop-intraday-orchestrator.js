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
    const errorClass = String(error?.name || 'Error');
    const errorMessage = String(error?.message || 'stage failed').slice(0, 240);
    console.error('intraday-rop-stage-failed', { stage: stageName, errorClass, errorMessage });
    return { ok: false, statusCode: 500, errorClass, errorMessage };
  }
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
  runTochkaDds,
  runBalances,
  runDataHealth,
  runDecisions,
  runOwnerActionQueue
} = {}) {
  if (typeof runPayments !== 'function') throw new Error('runPayments is required');
  if (runReceivables != null && typeof runReceivables !== 'function') throw new Error('runReceivables must be a function');
  if (typeof refreshRop !== 'function') throw new Error('refreshRop is required');
  if (runTochkaDds != null && typeof runTochkaDds !== 'function') throw new Error('runTochkaDds must be a function');
  if (runBalances != null && typeof runBalances !== 'function') throw new Error('runBalances must be a function');
  if (typeof runDataHealth !== 'function') throw new Error('runDataHealth is required');
  if (typeof runDecisions !== 'function') throw new Error('runDecisions is required');
  if (typeof runOwnerActionQueue !== 'function') throw new Error('runOwnerActionQueue is required');
  const hasReceivables = typeof runReceivables === 'function';
  const hasTochkaDds = typeof runTochkaDds === 'function';
  const hasBalances = typeof runBalances === 'function';

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

    try {
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
    } catch (error) {
      console.error('intraday-rop-orchestrator:', error?.name || 'Error', String(error?.message || '').slice(0, 240));
      return res.status(500).json({ ok: false, error: 'Intraday ROP orchestration failed' });
    }
  };
}

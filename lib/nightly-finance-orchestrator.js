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
    const errorClass = String(error?.name || 'Error');
    const errorMessage = String(error?.message || 'stage failed').slice(0, 240);
    console.error('nightly-finance-stage-failed', { stage: stageName, errorClass, errorMessage });
    return { ok: false, statusCode: 500, errorClass, errorMessage };
  }
}

function stageResult(result) {
  const stage = { ok: result?.ok === true, statusCode: Number(result?.statusCode) || null };
  if (result?.errorClass) stage.errorClass = result.errorClass;
  if (result?.errorMessage) stage.errorMessage = result.errorMessage;
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
  runTochkaDds,
  runBalances,
  runDataHealth,
  runDecisions
}) {
  if (typeof runHours !== 'function') throw new Error('runHours is required');
  if (runPayments != null && typeof runPayments !== 'function') throw new Error('runPayments must be a function');
  if (typeof runReceivables !== 'function') throw new Error('runReceivables is required');
  if (runTochkaDds != null && typeof runTochkaDds !== 'function') throw new Error('runTochkaDds must be a function');
  if (runBalances != null && typeof runBalances !== 'function') throw new Error('runBalances must be a function');
  if (runDataHealth != null && typeof runDataHealth !== 'function') throw new Error('runDataHealth must be a function');
  if (typeof runDecisions !== 'function') throw new Error('runDecisions is required');

  const hasPayments = typeof runPayments === 'function';
  const hasTochkaDds = typeof runTochkaDds === 'function';
  const hasBalances = typeof runBalances === 'function';
  const dataHealthRunner = typeof runDataHealth === 'function'
    ? runDataHealth
    : typeof runDecisions.dataHealth === 'function'
      ? runDecisions.dataHealth
      : null;
  const hasDataHealth = typeof dataHealthRunner === 'function';

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

    // These source refreshes are deliberately independent: one ASHK failure must
    // never suppress the other sources and leave the morning HQ stale for a day.
    const hours = await invokeChild(runHours, secret, 'GET', 'hours');
    stages.hours = stageResult(hours);
    if (!hours.ok) failures.push(hours);

    if (hasPayments) {
      const payments = await invokeChild(runPayments, secret, 'POST', 'payments');
      stages.payments = stageResult(payments);
      if (!payments.ok) failures.push(payments);
    }

    const receivables = await invokeChild(runReceivables, secret, 'GET', 'receivables');
    stages.receivables = stageResult(receivables);
    if (!receivables.ok) failures.push(receivables);

    // Bank/DDS refreshes are independent from ASHK and should also get a chance
    // to advance even when an ASHK source is degraded.
    if (hasTochkaDds) {
      const tochkaDds = await invokeChild(runTochkaDds, secret, 'GET', 'tochkaDds');
      stages.tochkaDds = stageResult(tochkaDds);
      if (!tochkaDds.ok) failures.push(tochkaDds);
    }

    if (hasBalances) {
      const balances = await invokeChild(runBalances, secret, 'GET', 'balances');
      stages.balances = stageResult(balances);
      if (!balances.ok) failures.push(balances);
    }

    // Decision writes remain fail-closed. We refresh as much source data as
    // possible first, then stop before writes if any required source failed.
    if (failures.length) {
      if (hasDataHealth) stages.dataHealth = { ok: false, statusCode: null, skipped: true };
      stages.decisions = { ok: false, statusCode: null, skipped: true };
      return res.status(failureStatus(failures[0])).json({ ok: false, stages });
    }

    if (hasDataHealth) {
      const dataHealth = await invokeChild(dataHealthRunner, secret, 'GET', 'dataHealth');
      stages.dataHealth = stageResult(dataHealth);
      if (!dataHealth.ok) {
        stages.decisions = { ok: false, statusCode: null, skipped: true };
        return res.status(failureStatus(dataHealth, 503)).json({ ok: false, stages });
      }
    }

    const decisions = await invokeChild(runDecisions, secret, 'GET', 'decisions');
    stages.decisions = stageResult(decisions);
    if (!decisions.ok) {
      return res.status(failureStatus(decisions)).json({ ok: false, stages });
    }

    return res.status(200).json({ ok: true, stages });
  };
}

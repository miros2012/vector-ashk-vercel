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
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = Number(code);
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end(body) {
      if (body !== undefined) this.body = body;
      return this;
    }
  };
}

async function invokeChild(handler, cronSecret, method = 'GET') {
  const req = {
    method,
    headers: { authorization: `Bearer ${cronSecret}` },
    query: {},
    body: {}
  };
  const res = childResponseRecorder();
  await handler(req, res);
  const bodyOk = !res.body || typeof res.body !== 'object' || res.body.ok !== false;
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300 && bodyOk,
    statusCode: res.statusCode,
    body: res.body
  };
}

export function createNightlyFinanceOrchestrator({
  cronSecret = '',
  runHours,
  runPayments,
  runReceivables,
  runDataHealth,
  runDecisions
}) {
  if (typeof runHours !== 'function') throw new Error('runHours is required');
  if (runPayments != null && typeof runPayments !== 'function') throw new Error('runPayments must be a function');
  if (typeof runReceivables !== 'function') throw new Error('runReceivables is required');
  if (runDataHealth != null && typeof runDataHealth !== 'function') throw new Error('runDataHealth must be a function');
  if (typeof runDecisions !== 'function') throw new Error('runDecisions is required');

  const hasPayments = typeof runPayments === 'function';
  const dataHealthRunner = typeof runDataHealth === 'function'
    ? runDataHealth
    : typeof runDecisions.dataHealth === 'function'
      ? runDecisions.dataHealth
      : null;
  const hasDataHealth = typeof dataHealthRunner === 'function';

  function skippedTail(stages) {
    if (hasDataHealth) stages.dataHealth = { ok: false, statusCode: null, skipped: true };
    stages.decisions = { ok: false, statusCode: null, skipped: true };
    return stages;
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

    try {
      const hours = await invokeChild(runHours, secret);
      if (!hours.ok) {
        const statusCode = hours.statusCode >= 400 ? hours.statusCode : 502;
        const stages = { hours: { ok: false, statusCode: hours.statusCode } };
        if (hasPayments) stages.payments = { ok: false, statusCode: null, skipped: true };
        stages.receivables = { ok: false, statusCode: null, skipped: true };
        return res.status(statusCode).json({ ok: false, stages: skippedTail(stages) });
      }

      let payments;
      if (hasPayments) {
        payments = await invokeChild(runPayments, secret, 'POST');
        if (!payments.ok) {
          const statusCode = payments.statusCode >= 400 ? payments.statusCode : 502;
          const stages = {
            hours: { ok: true, statusCode: hours.statusCode },
            payments: { ok: false, statusCode: payments.statusCode },
            receivables: { ok: false, statusCode: null, skipped: true }
          };
          return res.status(statusCode).json({ ok: false, stages: skippedTail(stages) });
        }
      }

      const receivables = await invokeChild(runReceivables, secret);
      if (!receivables.ok) {
        const statusCode = receivables.statusCode >= 400 ? receivables.statusCode : 502;
        const stages = { hours: { ok: true, statusCode: hours.statusCode } };
        if (hasPayments) stages.payments = { ok: true, statusCode: payments.statusCode };
        stages.receivables = { ok: false, statusCode: receivables.statusCode };
        return res.status(statusCode).json({ ok: false, stages: skippedTail(stages) });
      }

      let dataHealth;
      if (hasDataHealth) {
        dataHealth = await invokeChild(dataHealthRunner, secret);
        if (!dataHealth.ok) {
          const statusCode = dataHealth.statusCode >= 400 ? dataHealth.statusCode : 503;
          const stages = { hours: { ok: true, statusCode: hours.statusCode } };
          if (hasPayments) stages.payments = { ok: true, statusCode: payments.statusCode };
          stages.receivables = { ok: true, statusCode: receivables.statusCode };
          stages.dataHealth = { ok: false, statusCode: dataHealth.statusCode };
          stages.decisions = { ok: false, statusCode: null, skipped: true };
          return res.status(statusCode).json({ ok: false, stages });
        }
      }

      const decisions = await invokeChild(runDecisions, secret);
      if (!decisions.ok) {
        const statusCode = decisions.statusCode >= 400 ? decisions.statusCode : 502;
        const stages = { hours: { ok: true, statusCode: hours.statusCode } };
        if (hasPayments) stages.payments = { ok: true, statusCode: payments.statusCode };
        stages.receivables = { ok: true, statusCode: receivables.statusCode };
        if (hasDataHealth) stages.dataHealth = { ok: true, statusCode: dataHealth.statusCode };
        stages.decisions = { ok: false, statusCode: decisions.statusCode };
        return res.status(statusCode).json({ ok: false, stages });
      }

      const stages = { hours: { ok: true, statusCode: hours.statusCode } };
      if (hasPayments) stages.payments = { ok: true, statusCode: payments.statusCode };
      stages.receivables = { ok: true, statusCode: receivables.statusCode };
      if (hasDataHealth) stages.dataHealth = { ok: true, statusCode: dataHealth.statusCode };
      stages.decisions = { ok: true, statusCode: decisions.statusCode };
      return res.status(200).json({ ok: true, stages });
    } catch (error) {
      console.error('nightly-finance-orchestrator:', error?.name || 'Error');
      return res.status(500).json({ ok: false, error: 'Nightly finance orchestration failed' });
    }
  };
}

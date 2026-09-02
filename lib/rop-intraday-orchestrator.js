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

async function invokePayments(handler, secret) {
  const req = {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
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

export function createIntradayRopOrchestrator({ cronSecret = '', runPayments, refreshRop } = {}) {
  if (typeof runPayments !== 'function') throw new Error('runPayments is required');
  if (typeof refreshRop !== 'function') throw new Error('refreshRop is required');

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
      const payments = await invokePayments(runPayments, secret);
      if (!payments.ok) {
        const statusCode = payments.statusCode >= 400 ? payments.statusCode : 502;
        return res.status(statusCode).json({
          ok: false,
          stages: {
            payments: { ok: false, statusCode: payments.statusCode },
            rop: { ok: false, skipped: true }
          }
        });
      }

      const rop = await refreshRop();
      if (!rop?.ok) {
        return res.status(502).json({
          ok: false,
          stages: {
            payments: { ok: true, statusCode: payments.statusCode },
            rop: { ok: false }
          }
        });
      }

      return res.status(200).json({
        ok: true,
        mode: 'intraday_rop',
        stages: {
          payments: { ok: true, statusCode: payments.statusCode },
          rop: { ok: true, liveDate: rop.liveDate || rop.asOfDate || '' }
        }
      });
    } catch (error) {
      console.error('intraday-rop-orchestrator:', error?.name || 'Error');
      return res.status(500).json({ ok: false, error: 'Intraday ROP orchestration failed' });
    }
  };
}

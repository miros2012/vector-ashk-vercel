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

async function invokeChild(handler, cronSecret) {
  const req = {
    method: 'GET',
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
  runDecisions
}) {
  if (typeof runHours !== 'function') throw new Error('runHours is required');
  if (typeof runDecisions !== 'function') throw new Error('runDecisions is required');

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
        return res.status(statusCode).json({
          ok: false,
          stages: {
            hours: { ok: false, statusCode: hours.statusCode },
            decisions: { ok: false, statusCode: null, skipped: true }
          }
        });
      }

      const decisions = await invokeChild(runDecisions, secret);
      if (!decisions.ok) {
        const statusCode = decisions.statusCode >= 400 ? decisions.statusCode : 502;
        return res.status(statusCode).json({
          ok: false,
          stages: {
            hours: { ok: true, statusCode: hours.statusCode },
            decisions: { ok: false, statusCode: decisions.statusCode }
          }
        });
      }

      return res.status(200).json({
        ok: true,
        stages: {
          hours: { ok: true, statusCode: hours.statusCode },
          decisions: { ok: true, statusCode: decisions.statusCode }
        }
      });
    } catch (error) {
      console.error('nightly-finance-orchestrator:', error);
      return res.status(500).json({ ok: false, error: 'Nightly finance orchestration failed' });
    }
  };
}

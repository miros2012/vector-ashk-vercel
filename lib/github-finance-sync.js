const EXPECTED = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  audience: 'vector-finance-sync-v1',
  repository: 'miros2012/vector-ashk-vercel',
  repositoryId: '1350493825',
  ownerId: '46207692',
  ref: 'refs/heads/main',
  workflowRef: 'miros2012/vector-ashk-vercel/.github/workflows/hourly-project-continuation.yml@refs/heads/main',
  subject: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main'
});

function text(value) {
  return String(value ?? '').trim();
}

function positiveIntegerText(value, name) {
  const normalized = text(value);
  if (!/^\d+$/.test(normalized) || Number(normalized) < 1) throw new Error(`${name} is invalid`);
  return normalized;
}

function bearerToken(value) {
  const match = String(value || '').match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
}

function requestBody(req) {
  if (req?.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req?.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export function authorizeFinanceSyncClaims(claims = {}) {
  const eventName = text(claims.event_name);
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud || '')];
  const valid = claims.iss === EXPECTED.issuer
    && audience.includes(EXPECTED.audience)
    && claims.sub === EXPECTED.subject
    && claims.repository === EXPECTED.repository
    && String(claims.repository_id) === EXPECTED.repositoryId
    && String(claims.repository_owner_id) === EXPECTED.ownerId
    && claims.ref === EXPECTED.ref
    && claims.workflow_ref === EXPECTED.workflowRef
    && ['schedule', 'workflow_dispatch'].includes(eventName);
  if (!valid) throw new Error('forbidden finance sync claims');
  positiveIntegerText(claims.run_id, 'run_id');
  positiveIntegerText(claims.run_attempt, 'run_attempt');
  if (eventName === 'workflow_dispatch' && String(claims.actor_id) !== EXPECTED.ownerId) {
    throw new Error('forbidden finance sync actor');
  }
  return { eventName };
}

export function createGitHubFinanceSyncHandler({
  verifyToken,
  cronSecret = '',
  runIntraday,
  runFull
} = {}) {
  if (typeof verifyToken !== 'function') throw new Error('verifyToken is required');
  if (typeof runIntraday !== 'function') throw new Error('runIntraday is required');
  if (typeof runFull !== 'function') throw new Error('runFull is required');

  return async function githubFinanceSyncHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Use POST' });
    }

    const body = requestBody(req);
    if (body.mode !== 'finance_sync' || !['intraday', 'full'].includes(body.kind)) {
      return res.status(400).json({ ok: false, error: 'invalid finance sync request' });
    }

    const secret = text(cronSecret);
    if (!secret) return res.status(503).json({ ok: false, error: 'finance sync unavailable' });

    const token = bearerToken(req?.headers?.authorization);
    if (!token) return res.status(403).json({ ok: false, error: 'forbidden' });

    try {
      const claims = await verifyToken(token, { audience: EXPECTED.audience });
      authorizeFinanceSyncClaims(claims);
    } catch {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const runner = body.kind === 'full' ? runFull : runIntraday;
    const schedule = body.kind === 'full' ? '30 21 * * *' : '0 7 * * *';
    const childReq = {
      method: 'GET',
      headers: {
        authorization: `Bearer ${secret}`,
        'x-vercel-cron-schedule': schedule,
        'x-vector-finance-trigger': 'github-actions'
      },
      query: {},
      body: {}
    };
    return runner(childReq, res);
  };
}

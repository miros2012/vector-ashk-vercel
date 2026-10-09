import { buildAshkPaymentArchive, validateAshkPaymentArchivePeriod } from './ashk-payment-archive.js';

const EXPECTED = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  audience: 'vector-finance-sync-v1',
  repository: 'miros2012/vector-ashk-vercel',
  repositoryId: '1350493825',
  ownerId: '46207692',
  ref: 'refs/heads/main',
  workflowRef: 'miros2012/vector-ashk-vercel/.github/workflows/ashk-payment-archive.yml@refs/heads/main',
  subject: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main'
});

function text(value) {
  return String(value ?? '').trim();
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

function positiveInteger(value) {
  return /^\d+$/.test(text(value)) && Number(value) > 0;
}

export function authorizePaymentArchiveClaims(claims = {}) {
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud || '')];
  const valid = claims.iss === EXPECTED.issuer
    && audience.includes(EXPECTED.audience)
    && claims.sub === EXPECTED.subject
    && claims.repository === EXPECTED.repository
    && String(claims.repository_id) === EXPECTED.repositoryId
    && String(claims.repository_owner_id) === EXPECTED.ownerId
    && claims.ref === EXPECTED.ref
    && claims.workflow_ref === EXPECTED.workflowRef
    && claims.event_name === 'workflow_dispatch'
    && String(claims.actor_id) === EXPECTED.ownerId
    && positiveInteger(claims.run_id)
    && String(claims.run_attempt) === '1';
  if (!valid) throw new Error('forbidden payment archive claims');
  return { eventName: 'workflow_dispatch' };
}

export function createGitHubPaymentArchiveHandler({
  verifyToken,
  apiKey = '',
  buildArchive = buildAshkPaymentArchive
} = {}) {
  if (typeof verifyToken !== 'function') throw new Error('verifyToken is required');
  if (typeof buildArchive !== 'function') throw new Error('buildArchive is required');

  return async function githubPaymentArchiveHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Use POST' });
    }

    const body = requestBody(req);
    if (body.mode !== 'payment_archive') {
      return res.status(400).json({ ok: false, error: 'invalid payment archive request' });
    }
    try {
      validateAshkPaymentArchivePeriod(body);
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid payment archive period' });
    }
    const token = bearerToken(req?.headers?.authorization);
    if (!token) return res.status(403).json({ ok: false, error: 'forbidden' });
    try {
      const claims = await verifyToken(token, { audience: EXPECTED.audience });
      authorizePaymentArchiveClaims(claims);
    } catch {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    if (!text(apiKey)) {
      return res.status(503).json({ ok: false, error: 'payment archive unavailable' });
    }

    try {
      const archive = await buildArchive({
        startDate: body.startDate,
        endDate: body.endDate,
        apiKey: text(apiKey)
      });
      return res.status(200).json({
        ok: true,
        mode: 'read_only_payment_archive',
        ...archive
      });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: String(error?.message || error).slice(0, 300)
      });
    }
  };
}

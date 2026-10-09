import { buildAshkSaleArchive, validateAshkSaleArchivePeriod } from './ashk-sale-archive.js';
import { createAshkWebSession } from './ashk-web-session.js';

const EXPECTED = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  audience: 'vector-finance-sync-v1',
  repository: 'miros2012/vector-ashk-vercel',
  repositoryId: '1350493825',
  ownerId: '46207692',
  ref: 'refs/heads/main',
  workflowRef: 'miros2012/vector-ashk-vercel/.github/workflows/ashk-sale-archive.yml@refs/heads/main',
  subject: 'repo:miros2012@46207692/vector-ashk-vercel@1350493825:ref:refs/heads/main'
});

function text(value) {
  return String(value ?? '').trim();
}

function requestBody(req) {
  if (req?.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  if (typeof req?.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function bearerToken(value) {
  return String(value || '').match(/^Bearer\s+([^\s]+)$/i)?.[1] || '';
}

function positiveInteger(value) {
  return /^\d+$/.test(text(value)) && Number(value) > 0;
}

export function saleArchiveFailureCode(error) {
  const message = String(error?.message || error || '');
  if (/anti-forgery|login|two-factor|credentials/i.test(message)) return 'SOURCE_AUTH';
  if (/no trustworthy total_count/i.test(message)) return 'SOURCE_TOTAL_COUNT';
  if (/total_count changed/i.test(message)) return 'SOURCE_TOTAL_COUNT_CHANGED';
  if (/incomplete|pagination/i.test(message)) return 'SOURCE_INCOMPLETE';
  if (/money fact/i.test(message)) return 'SOURCE_MONEY';
  if (/invalid Date|outside archive period/i.test(message)) return 'SOURCE_DATE';
  if (/no data array/i.test(message)) return 'SOURCE_SHAPE';
  if (/web request|authenticated endpoint returned non-JSON/i.test(message)) return 'SOURCE_HTTP';
  return 'SOURCE_UNKNOWN';
}

export function authorizeSaleArchiveClaims(claims = {}) {
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
  if (!valid) throw new Error('forbidden sale archive claims');
  return { eventName: 'workflow_dispatch' };
}

export function createGitHubSaleArchiveHandler({
  verifyToken,
  login = '',
  password = '',
  createSession = createAshkWebSession,
  buildArchive = buildAshkSaleArchive
} = {}) {
  if (typeof verifyToken !== 'function') throw new Error('verifyToken is required');
  if (typeof createSession !== 'function') throw new Error('createSession is required');
  if (typeof buildArchive !== 'function') throw new Error('buildArchive is required');

  return async function githubSaleArchiveHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Use POST' });
    }
    const body = requestBody(req);
    if (body.mode !== 'sale_archive') {
      return res.status(400).json({ ok: false, error: 'invalid sale archive request' });
    }
    try {
      validateAshkSaleArchivePeriod(body);
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid sale archive period' });
    }
    const token = bearerToken(req?.headers?.authorization);
    if (!token) return res.status(403).json({ ok: false, error: 'forbidden' });
    try {
      const claims = await verifyToken(token, { audience: EXPECTED.audience });
      authorizeSaleArchiveClaims(claims);
    } catch {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    if (!text(login) || !text(password)) {
      return res.status(503).json({ ok: false, error: 'sale archive unavailable' });
    }
    try {
      const session = createSession({
        baseUrl: 'https://app.dscontrol.ru',
        login: text(login),
        password: text(password)
      });
      const archive = await buildArchive({
        startDate: body.startDate,
        endDate: body.endDate,
        session
      });
      return res.status(200).json({ ok: true, mode: 'read_only_sale_archive', ...archive });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'sale archive source failed',
        code: saleArchiveFailureCode(error)
      });
    }
  };
}

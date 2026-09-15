import syncPayments from '../api/sync-payments.js';
import { firstRequestQueryValue, parseRequestQuery } from './request-query.js';

function text(value) {
  return String(value ?? '').trim();
}

function sanitizeUrl(value) {
  const raw = text(value);
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, 'https://internal.invalid');
    parsed.searchParams.delete('finance_run_token');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return raw.replace(/([?&])finance_run_token=[^&]*&?/g, (_, prefix) => prefix === '?' ? '?' : '')
      .replace(/[?&]$/, '');
  }
}

function authorizedRequest(req, cronSecret, method = 'GET') {
  const query = parseRequestQuery(req);
  delete query.finance_run_token;
  const clone = Object.create(req || null);
  Object.defineProperties(clone, {
    method: {
      value: method,
      enumerable: true,
      configurable: true
    },
    headers: {
      value: { ...(req?.headers || {}), authorization: `Bearer ${cronSecret}` },
      enumerable: true,
      configurable: true
    },
    query: {
      value: query,
      enumerable: true,
      configurable: true
    },
    url: {
      value: sanitizeUrl(req?.url),
      enumerable: true,
      configurable: true
    }
  });
  if ('originalUrl' in (req || {})) {
    Object.defineProperty(clone, 'originalUrl', {
      value: sanitizeUrl(req?.originalUrl),
      enumerable: true,
      configurable: true
    });
  }
  return clone;
}

export function hasManualFinanceRunToken(req) {
  return Boolean(firstRequestQueryValue(req, 'finance_run_token'));
}

export function createManualFinanceRunHandler({
  cronSecret,
  consumeToken,
  runNightly,
  runPayments = syncPayments
} = {}) {
  if (typeof consumeToken !== 'function') throw new Error('consumeToken is required');
  if (typeof runNightly !== 'function') throw new Error('runNightly is required');
  if (typeof runPayments !== 'function') throw new Error('runPayments must be a function');

  return async function manualFinanceRunHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }

    const secret = text(cronSecret);
    if (!secret) {
      return res.status(503).json({ ok: false, error: 'Manual finance run unavailable' });
    }

    const stage = text(firstRequestQueryValue(req, 'stage')).toLowerCase();
    if (stage && stage !== 'payments') {
      return res.status(400).json({ ok: false, error: 'Unsupported manual finance stage' });
    }

    const token = firstRequestQueryValue(req, 'finance_run_token');
    if (!token) return res.status(403).json({ ok: false, error: 'forbidden' });

    let consumed;
    try {
      consumed = await consumeToken(token);
    } catch (error) {
      console.error('manual-finance-run-token:', error?.name || 'Error');
      return res.status(503).json({ ok: false, error: 'Manual finance run unavailable' });
    }
    if (!consumed?.ok) return res.status(403).json({ ok: false, error: 'forbidden' });

    if (stage === 'payments') {
      return runPayments(authorizedRequest(req, secret, 'POST'), res);
    }
    return runNightly(authorizedRequest(req, secret, 'GET'), res);
  };
}

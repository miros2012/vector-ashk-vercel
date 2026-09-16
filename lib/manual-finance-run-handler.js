import syncPayments from '../api/sync-payments.js';
import { createAshkWebSession } from './ashk-web-session.js';
import { probeAshkPaymentReportEndpoints } from './ashk-payment-report-probe.js';
import { probeAshkReportRoutes } from './ashk-report-route-probe.js';
import { firstRequestQueryValue, parseRequestQuery } from './request-query.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const TYUMEN_TZ = 'Asia/Yekaterinburg';

function text(value) {
  return String(value ?? '').trim();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function tyumenPaymentPeriod() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TYUMEN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = type => Number(parts.find(part => part.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(day)}`
  };
}

async function defaultPaymentReportProbe() {
  const session = createAshkWebSession({
    baseUrl: ASHK_BASE_URL,
    login: process.env.ASHK_WEB_LOGIN,
    password: process.env.ASHK_WEB_PASSWORD
  });
  return probeAshkPaymentReportEndpoints({
    session,
    ...tyumenPaymentPeriod()
  });
}

async function defaultReportRouteProbe() {
  const session = createAshkWebSession({
    baseUrl: ASHK_BASE_URL,
    login: process.env.ASHK_WEB_LOGIN,
    password: process.env.ASHK_WEB_PASSWORD
  });
  return probeAshkReportRoutes({ session });
}

function sanitizeUrl(value, stripKeys = []) {
  const raw = text(value);
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, 'https://internal.invalid');
    parsed.searchParams.delete('finance_run_token');
    for (const key of stripKeys) parsed.searchParams.delete(key);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    let sanitized = raw.replace(/([?&])finance_run_token=[^&]*&?/g, (_, prefix) => prefix === '?' ? '?' : '')
      .replace(/[?&]$/, '');
    for (const key of stripKeys) {
      sanitized = sanitized
        .replace(new RegExp(`([?&])${key}=[^&]*&?`, 'g'), (_, prefix) => prefix === '?' ? '?' : '')
        .replace(/[?&]$/, '');
    }
    return sanitized;
  }
}

function authorizedRequest(req, cronSecret, method = 'GET', stripKeys = []) {
  const query = parseRequestQuery(req);
  delete query.finance_run_token;
  for (const key of stripKeys) delete query[key];
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
      value: sanitizeUrl(req?.url, stripKeys),
      enumerable: true,
      configurable: true
    }
  });
  if ('originalUrl' in (req || {})) {
    Object.defineProperty(clone, 'originalUrl', {
      value: sanitizeUrl(req?.originalUrl, stripKeys),
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
  runPayments = syncPayments,
  runPaymentProbe = defaultPaymentReportProbe,
  runReportRouteProbe = defaultReportRouteProbe
} = {}) {
  if (typeof consumeToken !== 'function') throw new Error('consumeToken is required');
  if (typeof runNightly !== 'function') throw new Error('runNightly is required');
  if (typeof runPayments !== 'function') throw new Error('runPayments must be a function');
  if (typeof runPaymentProbe !== 'function') throw new Error('runPaymentProbe must be a function');
  if (typeof runReportRouteProbe !== 'function') throw new Error('runReportRouteProbe must be a function');

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
    const probe = text(firstRequestQueryValue(req, 'probe')).toLowerCase();
    const supportedProbe = stage === 'payments' && ['payment-report', 'report-routes'].includes(probe);
    if (probe && !supportedProbe) {
      return res.status(400).json({ ok: false, error: 'Unsupported manual finance probe' });
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
      if (probe === 'report-routes') {
        try {
          const candidates = await runReportRouteProbe();
          console.log(JSON.stringify({ event: 'ashk-report-route-probe', candidates }));
          return res.status(200).json({ ok: true, probe: 'report-routes', candidates });
        } catch (error) {
          console.error('ashk-report-route-probe:', error?.name || 'Error');
          return res.status(502).json({ ok: false, error: 'Report route probe failed' });
        }
      }
      if (probe === 'payment-report') {
        try {
          const results = await runPaymentProbe();
          console.log(JSON.stringify({ event: 'ashk-payment-report-probe', results }));
        } catch (error) {
          console.error('ashk-payment-report-probe:', error?.name || 'Error');
          return res.status(502).json({ ok: false, error: 'Payment report probe failed' });
        }
      }
      return runPayments(authorizedRequest(req, secret, 'POST', ['probe']), res);
    }
    return runNightly(authorizedRequest(req, secret, 'GET'), res);
  };
}

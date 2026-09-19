import syncPayments from '../api/sync-payments.js';
import { createAshkWebSession } from './ashk-web-session.js';
import { probeAshkAdminKpiReports } from './ashk-admin-kpi-live-probe.js';
import { probeAshkPaymentRecordModule } from './ashk-paymentrecord-module-probe.js';
import { probeAshkPaymentReportDiagnostics } from './ashk-payment-report-probe.js';
import { probeAshkReportRoutes } from './ashk-report-route-probe.js';
import { probeAshkReportKeywordHints } from './ashk-report-keyword-probe.js';
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

function reportDate(isoDate) {
  const match = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Invalid report date');
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function webSession() {
  return createAshkWebSession({
    baseUrl: ASHK_BASE_URL,
    login: process.env.ASHK_WEB_LOGIN,
    password: process.env.ASHK_WEB_PASSWORD
  });
}

async function defaultPaymentReportProbe() {
  return probeAshkPaymentReportDiagnostics({
    session: webSession(),
    ...tyumenPaymentPeriod()
  });
}

async function defaultPaymentRecordModuleProbe() {
  return probeAshkPaymentRecordModule({ session: webSession() });
}

async function defaultReportRouteProbe() {
  return probeAshkReportRoutes({ session: webSession() });
}

async function defaultReportKeywordProbe() {
  return probeAshkReportKeywordHints({ session: webSession() });
}

async function defaultAdminKpiProbe() {
  const period = tyumenPaymentPeriod();
  return probeAshkAdminKpiReports({
    session: webSession(),
    startDate: reportDate(period.startDate),
    endDate: reportDate(period.endDate)
  });
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
  runControl,
  runPayments = syncPayments,
  runPaymentProbe = defaultPaymentReportProbe,
  runPaymentRecordModuleProbe = defaultPaymentRecordModuleProbe,
  runReportRouteProbe = defaultReportRouteProbe,
  runReportKeywordProbe = defaultReportKeywordProbe,
  runAdminKpiProbe = defaultAdminKpiProbe
} = {}) {
  if (typeof consumeToken !== 'function') throw new Error('consumeToken is required');
  if (typeof runNightly !== 'function') throw new Error('runNightly is required');
  if (typeof runPayments !== 'function') throw new Error('runPayments must be a function');
  if (typeof runPaymentProbe !== 'function') throw new Error('runPaymentProbe must be a function');
  if (typeof runPaymentRecordModuleProbe !== 'function') throw new Error('runPaymentRecordModuleProbe must be a function');
  if (typeof runReportRouteProbe !== 'function') throw new Error('runReportRouteProbe must be a function');
  if (typeof runReportKeywordProbe !== 'function') throw new Error('runReportKeywordProbe must be a function');
  if (typeof runAdminKpiProbe !== 'function') throw new Error('runAdminKpiProbe must be a function');

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
    const supportedProbe = stage === 'payments'
      && ['payment-report', 'payment-record-module', 'report-routes', 'report-keywords', 'admin-kpi-report'].includes(probe);
    if (probe && !supportedProbe) {
      return res.status(400).json({ ok: false, error: 'Unsupported manual finance probe' });
    }

    const token = firstRequestQueryValue(req, 'finance_run_token');
    if (!token) return res.status(403).json({ ok: false, error: 'forbidden' });

    let consumed;
    try {
      consumed = await consumeToken(token);
    } catch {
      console.error({ stage: 'manualToken', errorClass: 'AUTH', attempt: 1, retryable: false });
      return res.status(503).json({ ok: false, error: 'Manual finance run unavailable' });
    }
    if (!consumed?.ok) return res.status(403).json({ ok: false, error: 'forbidden' });

    let context = null;
    if (stage === 'payments' && runControl) {
      context = await runControl.begin({ trigger: 'manual', mode: 'payments' });
      if (context?.ok !== true) {
        return res.status(Number(context?.statusCode) || 500).json({ ok: false, error: 'finance run control failed' });
      }
    }
    try {
      if (stage === 'payments') {
        if (probe === 'payment-record-module') {
          try {
            const result = await runPaymentRecordModuleProbe();
            return res.status(200).json({ ok: true, probe: 'payment-record-module', result });
          } catch {
            console.error({ stage: probe, errorClass: 'UNCLASSIFIED', attempt: 1, retryable: false });
            return res.status(502).json({ ok: false, error: 'Payment record module probe failed' });
          }
        }
        if (probe === 'admin-kpi-report') {
          try {
            const result = await runAdminKpiProbe();
            return res.status(200).json({ ok: true, probe: 'admin-kpi-report', result });
          } catch {
            console.error({ stage: probe, errorClass: 'UNCLASSIFIED', attempt: 1, retryable: false });
            return res.status(502).json({ ok: false, error: 'Admin KPI report probe failed' });
          }
        }
        if (probe === 'report-routes') {
          try {
            const candidates = await runReportRouteProbe();
            return res.status(200).json({ ok: true, probe: 'report-routes', candidates });
          } catch {
            console.error({ stage: probe, errorClass: 'UNCLASSIFIED', attempt: 1, retryable: false });
            return res.status(502).json({ ok: false, error: 'Report route probe failed' });
          }
        }
        if (probe === 'report-keywords') {
          try {
            const result = await runReportKeywordProbe();
            return res.status(200).json({ ok: true, probe: 'report-keywords', result });
          } catch {
            console.error({ stage: probe, errorClass: 'UNCLASSIFIED', attempt: 1, retryable: false });
            return res.status(502).json({ ok: false, error: 'Report keyword probe failed' });
          }
        }
        if (probe === 'payment-report') {
          try {
            await runPaymentProbe();
          } catch {
            console.error({ stage: probe, errorClass: 'UNCLASSIFIED', attempt: 1, retryable: false });
            return res.status(502).json({ ok: false, error: 'Payment report probe failed' });
          }
        }
        return await runPayments(authorizedRequest(req, secret, 'POST', ['probe']), res);
      }
      return await runNightly(authorizedRequest(req, secret, 'GET'), res);
    } finally {
      if (context) await runControl.finish(context);
    }
  };
}

import {
  buildMasterReportUrl,
  extractReportRows,
  summarizeMasterHours
} from '../lib/master-hours.js';
import { verifyGitHubActionsOidcToken } from '../lib/github-actions-oidc.js';
import { createGitHubFinanceSyncHandler } from '../lib/github-finance-sync.js';
import { createGitHubPaymentArchiveHandler } from '../lib/github-payment-archive.js';
import { authorizeBearer } from '../lib/request-authorization.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const START_DATE = '2026-08-01T00:00:00';
const END_DATE = '2026-08-31T23:59:59';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getReport(buildMode) {
  const url = buildMasterReportUrl({
    baseUrl: ASHK_BASE_URL,
    buildMode,
    startDate: START_DATE,
    endDate: END_DATE
  });
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      api_key: process.env.ASHK_API_KEY,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(55_000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ASHK MasterWorkReportDetails returned HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('ASHK MasterWorkReportDetails returned invalid JSON');
  }
  const rows = extractReportRows(payload);
  return {
    totalCount: Number.isFinite(Number(payload.total_count)) ? Number(payload.total_count) : null,
    position: Number.isFinite(Number(payload.pos)) ? Number(payload.pos) : null,
    totals: payload.totals ?? null,
    ...summarizeMasterHours(rows)
  };
}

async function runFinanceHandler(req, res) {
  const { default: financeHandler } = await import('./nightly-finance-orchestrator.js');
  return financeHandler(req, res);
}

const githubFinanceSyncHandler = createGitHubFinanceSyncHandler({
  verifyToken: verifyGitHubActionsOidcToken,
  cronSecret: process.env.CRON_SECRET || '',
  runIntraday: runFinanceHandler,
  runRecovery: runFinanceHandler,
  runFull: runFinanceHandler
});

const githubPaymentArchiveHandler = createGitHubPaymentArchiveHandler({
  verifyToken: verifyGitHubActionsOidcToken,
  apiKey: process.env.ASHK_API_KEY || ''
});

export function createMasterHoursDiagnosticHandler({
  financeSyncHandler = githubFinanceSyncHandler,
  paymentArchiveHandler = githubPaymentArchiveHandler,
  runMasterHoursReport
} = {}) {
  const reportRunner = runMasterHoursReport || (async () => {
    const byOccupationType = await getReport(0);
    await delay(400);
    const byTrainingHourType = await getReport(1);
    return { byOccupationType, byTrainingHourType };
  });

  return async function masterHoursDiagnosticHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'POST') {
      const mode = req?.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? String(req.body.mode || '')
        : '';
      if (mode === 'finance_sync') return financeSyncHandler(req, res);
      if (mode === 'payment_archive') return paymentArchiveHandler(req, res);
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    if (!authorizeBearer(req, process.env.CRON_SECRET)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    if (!process.env.ASHK_API_KEY) {
      return res.status(500).json({ ok: false, error: 'ASHK integration is not configured' });
    }

    try {
      const reports = await reportRunner();
      return res.status(200).json({
        ok: true,
        mode: 'read_only_master_hours_report',
        source: 'GET /api/MasterWorkReportDetails',
        period: { startDate: START_DATE, endDate: END_DATE, localTime: true },
        reports
      });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        source: 'GET /api/MasterWorkReportDetails',
        error: String(error?.message || error)
      });
    }
  };
}

export default createMasterHoursDiagnosticHandler();

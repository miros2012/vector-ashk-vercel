import { google } from 'googleapis';
import { getVercelOidcToken } from '@vercel/oidc';
import { normalizeBalances } from '../lib/tochka-balances.js';
import { evaluateDataHealthSnapshot, parseDataHealthSnapshot } from '../lib/data-health-snapshot.js';
import { createDecisionShadowSheetAdapter } from '../lib/decision-shadow-sheet-adapter.js';
import { createDecisionStateSynchronizer } from '../lib/decision-state-sync-service.js';
import { createDecisionReconciler } from '../lib/decision-reconciliation.js';
import { createDecisionReconciliationAudit } from '../lib/decision-reconciliation-audit.js';
import { createDecisionReconciliationAuditAppender } from '../lib/decision-reconciliation-audit-sheet.js';
import { createDecisionEventApi } from '../lib/decision-event-api.js';
import { createOwnerActionControlSheetAdapter } from '../lib/owner-action-control-sheet-adapter.js';
import { createOwnerActionQueueApi } from '../lib/owner-action-queue-api.js';
import { createOwnerActionQueueSheetAdapter } from '../lib/owner-action-queue-sheet-adapter.js';
import {
  evaluateTochkaWebhookReadiness,
  evaluateCandidateBalanceReadiness
} from '../lib/tochka-webhook-readiness.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const BALANCES_SHEET = 'Точка_Остатки';
const DATA_HEALTH_SHEET = 'Data Health Snapshot';
const DECISION_AUDIT_SHEET = 'Rule Engine Audit';
const DEFAULT_BRIDGE_URL = 'https://tochka-realtime-bridge.onrender.com';
const FRESH_MS = 30000;
const INTERNAL_OWNER_ACTION_KEY = 'owner-action-internal-only';
const TOCHKA_READINESS_ATTEMPTS = 4;
const TOCHKA_READINESS_DELAY_MS = 750;

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function requestBearer(req) {
  const authorization = String(req?.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function fetchLiveBalances() {
  const token = await getVercelOidcToken();
  if (!token) throw new Error('VERCEL_OIDC_TOKEN unavailable');

  const base = String(process.env.TOCHKA_BRIDGE_URL || DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const r = await fetch(`${base}/balances`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Tochka bridge HTTP ${r.status}: ${text.slice(0, 500)}`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Tochka bridge returned non-JSON: ${text.slice(0, 500)}`);
  }
}

async function readMirrorStatus(sheets) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${BALANCES_SHEET}'!A6:F10`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const rows = r.data.values || [];
  const timestamps = rows
    .map(row => Date.parse(String(row?.[0] || '')))
    .filter(Number.isFinite);
  const liveCount = rows.filter(row => {
    const value = row?.[4];
    return value !== '' && value !== undefined && Number.isFinite(Number(value));
  }).length;
  const lastMs = timestamps.length ? Math.max(...timestamps) : 0;
  return {
    liveCount,
    lastMs,
    lastUpdated: lastMs ? new Date(lastMs).toISOString() : null
  };
}

function isFresh(status) {
  return status.liveCount === 5 && status.lastMs > 0 && (Date.now() - status.lastMs) < FRESH_MS;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTochkaWebhookReadiness(sheets) {
  let readiness = evaluateTochkaWebhookReadiness([]);
  for (let attempt = 0; attempt < TOCHKA_READINESS_ATTEMPTS; attempt += 1) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${DATA_HEALTH_SHEET}'!A1:H50`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    readiness = evaluateTochkaWebhookReadiness(response.data.values || []);
    if (readiness.mirrorReady) return readiness;
    if (attempt + 1 < TOCHKA_READINESS_ATTEMPTS) {
      await delay(TOCHKA_READINESS_DELAY_MS);
    }
  }
  return readiness;
}

async function readDecisionDataHealth(sheets) {
  let health = {
    ok: false,
    status: 'BLOCKED',
    staleCoreSources: [],
    missingCoreSources: [],
    warnings: [],
    consistencyErrors: ['data health unavailable']
  };

  for (let attempt = 0; attempt < TOCHKA_READINESS_ATTEMPTS; attempt += 1) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${DATA_HEALTH_SHEET}'!A1:H50`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const snapshot = parseDataHealthSnapshot(response.data.values || []);
    health = evaluateDataHealthSnapshot(snapshot);
    if (health.ok) return health;
    if (attempt + 1 < TOCHKA_READINESS_ATTEMPTS) {
      await delay(TOCHKA_READINESS_DELAY_MS);
    }
  }

  return health;
}

async function mirrorToGoogleSheet(normalized, sheets) {
  const now = new Date().toISOString();
  const rows = normalized.funds;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        {
          range: `'${BALANCES_SHEET}'!A6:A10`,
          values: rows.map(row => [row.dateTime || now])
        },
        {
          range: `'${BALANCES_SHEET}'!E6:F10`,
          values: rows.map(row => [row.closingAvailable, row.expected])
        },
        {
          range: `'${BALANCES_SHEET}'!L6:L10`,
          values: rows.map(row => [row.accountId || ''])
        }
      ]
    }
  });

  return { mirroredAt: now };
}

async function ensureBalanceMirror(sheets) {
  const before = await readMirrorStatus(sheets);
  if (isFresh(before)) {
    return {
      source: 'cached_live',
      refreshed: false,
      liveCount: before.liveCount,
      lastUpdated: before.lastUpdated
    };
  }

  const raw = await fetchLiveBalances();
  const normalized = normalizeBalances(raw);
  const mirror = await mirrorToGoogleSheet(normalized, sheets);
  return {
    source: 'tochka_live',
    refreshed: true,
    liveCount: normalized.summary.liveCount,
    lastUpdated: mirror.mirroredAt
  };
}

async function reconcileDecisionState(sheets) {
  const shadow = createDecisionShadowSheetAdapter({
    sheets,
    spreadsheetId: SPREADSHEET_ID
  });
  const synchronize = createDecisionStateSynchronizer({
    sheets,
    spreadsheetId: SPREADSHEET_ID,
    runShadow: () => shadow.run(),
    writesEnabled: process.env.DECISION_STATE_WRITES_ENABLED === 'true'
  });
  const appendRow = createDecisionReconciliationAuditAppender({
    sheets,
    spreadsheetId: SPREADSHEET_ID,
    sheetName: DECISION_AUDIT_SHEET
  });
  const audit = createDecisionReconciliationAudit({ appendRow });
  const reconcile = createDecisionReconciler({
    synchronize,
    writesEnabled: process.env.DECISION_STATE_WRITES_ENABLED === 'true',
    audit
  });
  return reconcile({ trigger: 'balances' });
}

function failedReconciliationStatus() {
  return {
    ok: false,
    mode: 'error',
    verified: false,
    total: 0,
    matches: 0,
    writeCount: 0,
    trigger: 'balances'
  };
}

function blockedReconciliationStatus(dataHealth) {
  return {
    ...failedReconciliationStatus(),
    mode: 'blocked_data_health',
    dataHealthStatus: dataHealth?.status || 'BLOCKED'
  };
}

function internalDecisionCommand(decisionApi, configuredKey) {
  return async (command) => {
    const response = {
      body: { ok: false, error: 'decision lifecycle unavailable' },
      setHeader() {},
      status() { return this; },
      json(body) { this.body = body; return this; }
    };
    await decisionApi({
      method: 'POST',
      headers: { 'x-vector-key': configuredKey },
      body: command
    }, response);
    return response.body;
  };
}

async function processOwnerActionQueue(sheets) {
  const configuredKey = process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || INTERNAL_OWNER_ACTION_KEY;
  const queue = createOwnerActionQueueSheetAdapter({ sheets, spreadsheetId: SPREADSHEET_ID });
  const control = createOwnerActionControlSheetAdapter({ sheets, spreadsheetId: SPREADSHEET_ID });
  const decisionApi = createDecisionEventApi({ sheets, spreadsheetId: SPREADSHEET_ID, configuredKey });
  const queueApi = createOwnerActionQueueApi({
    configuredKey,
    readControl: control.readControl,
    appendCommand: control.appendCommand,
    setControlState: control.setControlState,
    clearDashboardInputs: control.clearDashboardInputs,
    readReadyCommands: queue.readReadyCommands,
    markCommand: queue.markCommand,
    executeCommand: internalDecisionCommand(decisionApi, configuredKey)
  });
  const response = {
    body: null,
    setHeader() {},
    status() { return this; },
    json(body) { this.body = body; return this; }
  };
  await queueApi({ method: 'POST', headers: { 'x-vector-key': configuredKey } }, response);
  if (!response.body?.ok) throw new Error('owner action queue processing failed');
  return response.body;
}

function failedOwnerActionQueueStatus() {
  return { ok: false, staged: 0, ready: 0, succeeded: 0, failed: 0 };
}

function blockedOwnerActionQueueStatus(dataHealth) {
  return {
    ...failedOwnerActionQueueStatus(),
    mode: 'blocked_data_health',
    dataHealthStatus: dataHealth?.status || 'BLOCKED'
  };
}

export async function refreshBalancesMirrorOnly(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (String(req?.method || '').toUpperCase() !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret || requestBearer(req) !== secret) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google service account secrets missing');
    }
    const sheets = await sheetsClient();
    const before = await readMirrorStatus(sheets);
    const raw = await fetchLiveBalances();
    const normalized = normalizeBalances(raw);
    const readiness = await readTochkaWebhookReadiness(sheets);
    if (!readiness.mirrorReady) {
      console.warn(JSON.stringify({
        event: 'tochka-balances-mirror-only-blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        missingDdsCount: readiness.missingDdsCount,
        accountingReady: readiness.accountingReady,
        reasons: readiness.reasons
      }));
      return res.status(409).json({
        ok: false,
        error: 'Tochka operation journal not ready for balance mirror',
        mode: 'mirror_blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        missingDdsCount: readiness.missingDdsCount,
        accountingReady: readiness.accountingReady
      });
    }

    const candidateReadiness = evaluateCandidateBalanceReadiness({ readiness, normalized });
    if (!candidateReadiness.ok) {
      console.warn(JSON.stringify({
        event: 'tochka-balances-mirror-only-candidate-blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        candidateTimestamp: candidateReadiness.candidateTimestamp,
        skewMinutes: candidateReadiness.skewMinutes,
        reason: candidateReadiness.reason
      }));
      return res.status(409).json({
        ok: false,
        error: 'Tochka candidate balance is ahead of operation journal',
        mode: 'candidate_balance_blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        candidateTimestamp: candidateReadiness.candidateTimestamp,
        skewMinutes: candidateReadiness.skewMinutes,
        reason: candidateReadiness.reason,
        accountingReady: readiness.accountingReady,
        missingDdsCount: readiness.missingDdsCount
      });
    }

    let result;
    if (isFresh(before)) {
      result = {
        source: 'cached_live',
        refreshed: false,
        liveCount: before.liveCount,
        lastUpdated: before.lastUpdated
      };
    } else {
      const mirror = await mirrorToGoogleSheet(normalized, sheets);
      result = {
        source: 'tochka_live',
        refreshed: true,
        liveCount: normalized.summary.liveCount,
        lastUpdated: mirror.mirroredAt
      };
    }

    console.log(JSON.stringify({
      event: 'tochka-balances-mirror-only',
      source: result.source,
      refreshed: result.refreshed,
      liveCount: result.liveCount,
      lastUpdated: result.lastUpdated,
      operationAgeHours: readiness.operationAgeHours,
      candidateTimestamp: candidateReadiness.candidateTimestamp,
      skewMinutes: candidateReadiness.skewMinutes,
      accountingReady: readiness.accountingReady,
      missingDdsCount: readiness.missingDdsCount
    }));
    return res.status(200).json({
      ok: true,
      ...result,
      operationAgeHours: readiness.operationAgeHours,
      candidateTimestamp: candidateReadiness.candidateTimestamp,
      skewMinutes: candidateReadiness.skewMinutes,
      accountingReady: readiness.accountingReady,
      missingDdsCount: readiness.missingDdsCount
    });
  } catch (error) {
    console.error('balances-mirror-only:', error?.name || 'Error');
    return res.status(500).json({ ok: false, error: 'Balance mirror refresh failed' });
  }
}

export async function refreshBalancesFromTochkaWebhook(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (String(req?.method || '').toUpperCase() !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }
  if (String(req?.headers?.['x-vector-refresh'] || '').trim() !== 'tochka-webhook') {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google service account secrets missing');
    }
    const sheets = await sheetsClient();
    const raw = await fetchLiveBalances();
    const normalized = normalizeBalances(raw);
    const readiness = await readTochkaWebhookReadiness(sheets);
    if (!readiness.mirrorReady) {
      console.warn(JSON.stringify({
        event: 'tochka-webhook-balance-mirror-blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        missingDdsCount: readiness.missingDdsCount,
        accountingReady: readiness.accountingReady,
        reasons: readiness.reasons
      }));
      return res.status(409).json({
        ok: false,
        error: 'Tochka operation journal not ready for balance mirror',
        mode: 'mirror_blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        missingDdsCount: readiness.missingDdsCount,
        accountingReady: readiness.accountingReady
      });
    }

    const candidateReadiness = evaluateCandidateBalanceReadiness({ readiness, normalized });
    if (!candidateReadiness.ok) {
      console.warn(JSON.stringify({
        event: 'tochka-webhook-candidate-balance-blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        candidateTimestamp: candidateReadiness.candidateTimestamp,
        skewMinutes: candidateReadiness.skewMinutes,
        reason: candidateReadiness.reason
      }));
      return res.status(409).json({
        ok: false,
        error: 'Tochka candidate balance is ahead of operation journal',
        mode: 'candidate_balance_blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        candidateTimestamp: candidateReadiness.candidateTimestamp,
        skewMinutes: candidateReadiness.skewMinutes,
        reason: candidateReadiness.reason,
        accountingReady: readiness.accountingReady,
        missingDdsCount: readiness.missingDdsCount
      });
    }

    const mirror = await mirrorToGoogleSheet(normalized, sheets);
    console.log(JSON.stringify({
      event: 'tochka-webhook-balance-mirror-only',
      liveCount: normalized.summary.liveCount,
      mirroredAt: mirror.mirroredAt,
      operationAgeHours: readiness.operationAgeHours,
      candidateTimestamp: candidateReadiness.candidateTimestamp,
      skewMinutes: candidateReadiness.skewMinutes,
      accountingReady: readiness.accountingReady,
      missingDdsCount: readiness.missingDdsCount
    }));
    return res.status(200).json({
      ok: true,
      source: 'tochka_live',
      refreshed: true,
      liveCount: normalized.summary.liveCount,
      lastUpdated: mirror.mirroredAt,
      mode: 'mirror_only',
      operationAgeHours: readiness.operationAgeHours,
      candidateTimestamp: candidateReadiness.candidateTimestamp,
      skewMinutes: candidateReadiness.skewMinutes,
      accountingReady: readiness.accountingReady,
      missingDdsCount: readiness.missingDdsCount
    });
  } catch (error) {
    console.error('tochka-webhook-balance-mirror-only:', error?.name || 'Error');
    return res.status(500).json({ ok: false, error: 'Balance mirror refresh failed' });
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Use GET or POST' });
  }

  if (
    String(req?.method || '').toUpperCase() === 'POST' &&
    String(req?.headers?.['x-vector-refresh'] || '').trim() === 'tochka-webhook'
  ) {
    return refreshBalancesFromTochkaWebhook(req, res);
  }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      throw new Error('Google service account secrets missing');
    }

    const sheets = await sheetsClient();
    const before = await readMirrorStatus(sheets);

    if (isFresh(before)) {
      return res.status(200).json({
        ok: true,
        source: 'cached_live',
        refreshed: false,
        liveCount: before.liveCount,
        lastUpdated: before.lastUpdated
      });
    }

    const raw = await fetchLiveBalances();
    const normalized = normalizeBalances(raw);
    const readiness = await readTochkaWebhookReadiness(sheets);
    if (!readiness.mirrorReady) {
      console.warn(JSON.stringify({
        event: 'tochka-balances-refresh-blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        missingDdsCount: readiness.missingDdsCount,
        accountingReady: readiness.accountingReady,
        reasons: readiness.reasons
      }));
      return res.status(409).json({
        ok: false,
        error: 'Tochka operation journal not ready for balance mirror',
        mode: 'mirror_blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        missingDdsCount: readiness.missingDdsCount,
        accountingReady: readiness.accountingReady
      });
    }

    const candidateReadiness = evaluateCandidateBalanceReadiness({ readiness, normalized });
    if (!candidateReadiness.ok) {
      console.warn(JSON.stringify({
        event: 'tochka-balances-refresh-candidate-blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        candidateTimestamp: candidateReadiness.candidateTimestamp,
        skewMinutes: candidateReadiness.skewMinutes,
        reason: candidateReadiness.reason
      }));
      return res.status(409).json({
        ok: false,
        error: 'Tochka candidate balance is ahead of operation journal',
        mode: 'candidate_balance_blocked',
        operationStatus: readiness.operationStatus,
        operationAgeHours: readiness.operationAgeHours,
        candidateTimestamp: candidateReadiness.candidateTimestamp,
        skewMinutes: candidateReadiness.skewMinutes,
        reason: candidateReadiness.reason,
        accountingReady: readiness.accountingReady,
        missingDdsCount: readiness.missingDdsCount
      });
    }

    const mirror = await mirrorToGoogleSheet(normalized, sheets);
    const dataHealth = await readDecisionDataHealth(sheets);

    if (!dataHealth.ok) {
      const decisionReconciliation = blockedReconciliationStatus(dataHealth);
      const ownerActionQueue = blockedOwnerActionQueueStatus(dataHealth);
      console.warn(JSON.stringify({
        event: 'tochka-balances-decisions-blocked',
        liveCount: normalized.summary.liveCount,
        mirroredAt: mirror.mirroredAt,
        dataHealthStatus: dataHealth.status,
        staleCoreSources: dataHealth.staleCoreSources,
        missingCoreSources: dataHealth.missingCoreSources,
        consistencyErrors: dataHealth.consistencyErrors
      }));
      return res.status(200).json({
        ok: true,
        source: 'tochka_live',
        refreshed: true,
        liveCount: normalized.summary.liveCount,
        lastUpdated: mirror.mirroredAt,
        mode: 'decisions_blocked',
        dataHealth,
        decisionReconciliation,
        ownerActionQueue
      });
    }

    let decisionReconciliation;
    try {
      decisionReconciliation = await reconcileDecisionState(sheets);
    } catch (error) {
      console.error('balances-decision-reconciliation:', error);
      decisionReconciliation = failedReconciliationStatus();
    }

    let ownerActionQueue;
    try {
      ownerActionQueue = await processOwnerActionQueue(sheets);
    } catch (error) {
      console.error('balances-owner-action-queue:', error);
      ownerActionQueue = failedOwnerActionQueueStatus();
    }

    console.log(JSON.stringify({
      event: 'tochka-balances-refresh',
      liveCount: normalized.summary.liveCount,
      mirroredAt: mirror.mirroredAt,
      trigger: req.method === 'POST' ? String(req.headers?.['x-vector-refresh'] || 'post') : 'get',
      dataHealthStatus: dataHealth.status,
      decisionReconciliationOk: decisionReconciliation.ok,
      decisionReconciliationMode: decisionReconciliation.mode,
      ownerActionQueueOk: ownerActionQueue.ok,
      ownerActionQueueSucceeded: ownerActionQueue.succeeded
    }));

    return res.status(200).json({
      ok: true,
      source: 'tochka_live',
      refreshed: true,
      liveCount: normalized.summary.liveCount,
      lastUpdated: mirror.mirroredAt,
      dataHealth,
      decisionReconciliation,
      ownerActionQueue
    });
  } catch (e) {
    console.error('balances:', e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}

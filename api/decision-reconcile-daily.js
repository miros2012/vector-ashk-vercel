import { google } from 'googleapis';
import { createDecisionShadowSheetAdapter } from '../lib/decision-shadow-sheet-adapter.js';
import { createDecisionStateSynchronizer } from '../lib/decision-state-sync-service.js';
import { createDecisionReconciler } from '../lib/decision-reconciliation.js';
import { createDecisionDailyReconciliationHandler } from '../lib/decision-daily-reconciliation-handler.js';
import { createDecisionReconciliationAudit } from '../lib/decision-reconciliation-audit.js';
import { createDecisionReconciliationAuditAppender } from '../lib/decision-reconciliation-audit-sheet.js';
import { evaluateDataHealthSnapshot, parseDataHealthSnapshot } from '../lib/data-health-snapshot.js';
import { evaluateTochkaDdsCoverage } from '../lib/tochka-dds-health.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const DECISION_AUDIT_SHEET = 'Rule Engine Audit';
const DATA_HEALTH_SHEET = 'Data Health Snapshot';
const BUSINESS_TZ = 'Asia/Yekaterinburg';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function requestBearer(req) {
  const authorization = String(req?.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function currentBusinessDateSerial(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = type => Number(parts.find(part => part.type === type)?.value || 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) throw new Error('Business date unavailable');
  return Math.trunc((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000);
}

async function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function runDataHealth(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (String(req?.method || '').toUpperCase() !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Use GET' });
  }
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (!cronSecret || requestBearer(req) !== cronSecret) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    const sheets = await sheetsClient();
    const result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [
        `'${DATA_HEALTH_SHEET}'!A1:D40`,
        `'Точка_API'!A2:P`,
        `'ДДС: месяц'!M5:M30000`
      ],
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const ranges = result.data.valueRanges || [];
    const snapshot = parseDataHealthSnapshot(ranges[0]?.values || []);
    const health = evaluateDataHealthSnapshot(snapshot);
    const tochkaDds = evaluateTochkaDdsCoverage({
      tochkaRows: ranges[1]?.values || [],
      ddsSourceRows: ranges[2]?.values || [],
      businessDateSerial: currentBusinessDateSerial()
    });

    const staleCoreSources = [...health.staleCoreSources];
    const consistencyErrors = [...health.consistencyErrors];
    if (!tochkaDds.ok) {
      staleCoreSources.push('tochkaDds');
      consistencyErrors.push('tochka operations missing from DDS');
    }
    const uniqueStaleCoreSources = [...new Set(staleCoreSources)];
    const uniqueConsistencyErrors = [...new Set(consistencyErrors)];
    const ok = health.ok && tochkaDds.ok;
    const body = {
      ok,
      status: ok ? health.status : 'BLOCKED',
      staleCoreSources: uniqueStaleCoreSources,
      missingCoreSources: health.missingCoreSources,
      warnings: health.warnings,
      consistencyErrors: uniqueConsistencyErrors,
      tochkaDds
    };
    console.log(JSON.stringify({ event: 'finance-data-health', ...body }));
    return res.status(ok ? 200 : 503).json(body);
  } catch (error) {
    console.error('finance-data-health:', error?.name || 'Error');
    return res.status(503).json({ ok: false, error: 'Finance data health check failed' });
  }
}

let reconcilePromise;
function getReconcile() {
  if (!reconcilePromise) {
    reconcilePromise = sheetsClient().then((sheets) => {
      const shadow = createDecisionShadowSheetAdapter({
        sheets,
        spreadsheetId: SPREADSHEET_ID
      });
      const writesEnabled = process.env.DECISION_STATE_WRITES_ENABLED === 'true';
      const synchronize = createDecisionStateSynchronizer({
        sheets,
        spreadsheetId: SPREADSHEET_ID,
        runShadow: () => shadow.run(),
        writesEnabled
      });
      const appendRow = createDecisionReconciliationAuditAppender({
        sheets,
        spreadsheetId: SPREADSHEET_ID,
        sheetName: DECISION_AUDIT_SHEET
      });
      const audit = createDecisionReconciliationAudit({ appendRow });
      return createDecisionReconciler({ synchronize, writesEnabled, audit });
    });
  }
  return reconcilePromise;
}

const handler = createDecisionDailyReconciliationHandler({
  cronSecret: process.env.CRON_SECRET || '',
  reconcile: async (input) => {
    const reconcile = await getReconcile();
    return reconcile(input);
  }
});

handler.dataHealth = runDataHealth;

export default handler;

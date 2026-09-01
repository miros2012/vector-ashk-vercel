import { google } from 'googleapis';
import { createDecisionShadowSheetAdapter } from '../lib/decision-shadow-sheet-adapter.js';
import { createDecisionStateSynchronizer } from '../lib/decision-state-sync-service.js';
import { createDecisionReconciler } from '../lib/decision-reconciliation.js';
import { createDecisionDailyReconciliationHandler } from '../lib/decision-daily-reconciliation-handler.js';
import { createDecisionReconciliationAudit } from '../lib/decision-reconciliation-audit.js';
import { createDecisionReconciliationAuditAppender } from '../lib/decision-reconciliation-audit-sheet.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';
const DECISION_AUDIT_SHEET = 'Rule Engine Audit';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
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

export default handler;
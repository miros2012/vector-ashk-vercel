import { google } from 'googleapis';
import { createDecisionEffectivenessApi } from '../lib/decision-effectiveness-api.js';
import { createDecisionEffectivenessSheetAdapter } from '../lib/decision-effectiveness-sheet-adapter.js';
import { createDecisionEventApi } from '../lib/decision-event-api.js';
import { createOwnerActionApi } from '../lib/owner-action-api.js';
import { createOwnerActionControlSheetAdapter } from '../lib/owner-action-control-sheet-adapter.js';
import { createOwnerActionQueueApi } from '../lib/owner-action-queue-api.js';
import { createOwnerActionQueueSheetAdapter } from '../lib/owner-action-queue-sheet-adapter.js';
import { createOwnerActionSheetAdapter } from '../lib/owner-action-sheet-adapter.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function sheetsClient(readonly = false) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: [readonly
      ? 'https://www.googleapis.com/auth/spreadsheets.readonly'
      : 'https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

function configuredKey() {
  return process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '';
}

function executeThroughDecisionApi(decisionApi, key) {
  return async (command) => {
    const response = {
      code: 500,
      body: { ok: false, error: 'decision lifecycle unavailable' },
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await decisionApi({
      method: 'POST', headers: { 'x-vector-key': key }, body: command
    }, response);
    return response.body;
  };
}

let executionHandler;
let ownerActionHandler;
let effectivenessHandler;
let queueHandler;

function createOwnerActionHandler() {
  const adapter = createOwnerActionSheetAdapter({
    sheets: sheetsClient(true), spreadsheetId: SPREADSHEET_ID
  });
  return createOwnerActionApi({ configuredKey: configuredKey(), readOwnerAction: adapter.readOwnerAction });
}

function createEffectivenessHandler() {
  const adapter = createDecisionEffectivenessSheetAdapter({
    sheets: sheetsClient(true), spreadsheetId: SPREADSHEET_ID
  });
  return createDecisionEffectivenessApi({
    configuredKey: configuredKey(), readEffectiveness: adapter.readEffectiveness
  });
}

function createQueueHandler() {
  const key = configuredKey();
  const sheets = sheetsClient();
  const queue = createOwnerActionQueueSheetAdapter({ sheets, spreadsheetId: SPREADSHEET_ID });
  const control = createOwnerActionControlSheetAdapter({ sheets, spreadsheetId: SPREADSHEET_ID });
  const decisionApi = createDecisionEventApi({ sheets, spreadsheetId: SPREADSHEET_ID, configuredKey: key });
  return createOwnerActionQueueApi({
    configuredKey: key,
    readControl: control.readControl,
    appendCommand: control.appendCommand,
    setControlState: control.setControlState,
    clearDashboardInputs: control.clearDashboardInputs,
    readReadyCommands: queue.readReadyCommands,
    markCommand: queue.markCommand,
    executeCommand: executeThroughDecisionApi(decisionApi, key)
  });
}

export default async function handler(req, res) {
  try {
    const ownerRoute = String(req.query?.ownerRoute || '').trim();
    if (ownerRoute === 'action') {
      ownerActionHandler ||= createOwnerActionHandler();
      return await ownerActionHandler(req, res);
    }
    if (ownerRoute === 'effectiveness') {
      effectivenessHandler ||= createEffectivenessHandler();
      return await effectivenessHandler(req, res);
    }
    if (ownerRoute === 'queue') {
      queueHandler ||= createQueueHandler();
      return await queueHandler(req, res);
    }
    executionHandler ||= createDecisionEventApi({
      sheets: sheetsClient(),
      spreadsheetId: SPREADSHEET_ID,
      configuredKey: configuredKey()
    });
    return await executionHandler(req, res);
  } catch (error) {
    console.error('decision-event:', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}

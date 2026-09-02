import { google } from 'googleapis';
import { createDecisionEventApi } from '../lib/decision-event-api.js';
import { createOwnerActionQueueApi } from '../lib/owner-action-queue-api.js';
import { createOwnerActionQueueSheetAdapter } from '../lib/owner-action-queue-sheet-adapter.js';
import { createOwnerActionControlSheetAdapter } from '../lib/owner-action-control-sheet-adapter.js';

const SPREADSHEET_ID = '1HuTTbdJ2kmnjMH14O0OQZHQBGsOsBtCPXqT--nngD10';

function privateKey() {
  return String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function sheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account secrets missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

function executeThroughDecisionApi(decisionApi, configuredKey) {
  return async (command) => {
    const response = {
      code: 500,
      body: { ok: false, error: 'decision lifecycle unavailable' },
      setHeader() {},
      status(code) { this.code = code; return this; },
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

let queueHandler;

export default async function handler(req, res) {
  try {
    if (!queueHandler) {
      const configuredKey = process.env.VECTOR_SYNC_KEY || process.env.TOCHKA_BRIDGE_KEY || '';
      const sheets = sheetsClient();
      const queue = createOwnerActionQueueSheetAdapter({ sheets, spreadsheetId: SPREADSHEET_ID });
      const control = createOwnerActionControlSheetAdapter({ sheets, spreadsheetId: SPREADSHEET_ID });
      const decisionApi = createDecisionEventApi({ sheets, spreadsheetId: SPREADSHEET_ID, configuredKey });
      queueHandler = createOwnerActionQueueApi({
        configuredKey,
        readControl: control.readControl,
        appendCommand: control.appendCommand,
        setControlState: control.setControlState,
        clearDashboardInputs: control.clearDashboardInputs,
        readReadyCommands: queue.readReadyCommands,
        markCommand: queue.markCommand,
        executeCommand: executeThroughDecisionApi(decisionApi, configuredKey)
      });
    }
    return await queueHandler(req, res);
  } catch (error) {
    console.error('owner-action-queue-route:', error);
    return res.status(500).json({ ok: false, error: 'owner action queue unavailable' });
  }
}

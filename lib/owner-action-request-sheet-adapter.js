import { normalizeOwnerActionRequest } from './owner-action-request.js';

const CONTROL_RANGE = "'Owner Action Control'!A2:L2";
const DASHBOARD_INPUT_RANGE = "'Панель собственника'!O54:O57";

function nowIso(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('now must return a valid Date');
  return value.toISOString();
}

export function createOwnerActionRequestSheetAdapter({ sheets, spreadsheetId, now = () => new Date() }) {
  if (!sheets?.spreadsheets?.values?.batchGet || !sheets?.spreadsheets?.values?.batchUpdate) {
    throw new Error('sheets batchGet and batchUpdate are required');
  }
  if (!String(spreadsheetId || '').trim()) throw new Error('spreadsheetId is required');

  return {
    async readPending() {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [CONTROL_RANGE],
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const row = response.data.valueRanges?.[0]?.values?.[0] || [];
      const command = normalizeOwnerActionRequest({
        ruleId: row[0],
        expectedExecutionStatus: row[1],
        requestedAction: row[3],
        result: row[4],
        evidence: row[5],
        actualEffect: row[6]
      });
      if (!command) return null;
      const processedRequestId = String(row[8] || '').trim();
      if (processedRequestId && processedRequestId === command.requestId) return null;
      return { command };
    },

    async markSent(requestId) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: [{ range:"'Owner Action Control'!J2:L2", values:[['SENT', '', nowIso(now)]] }]
        }
      });
    },

    async markSuccess(requestId, body = {}) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range:"'Owner Action Control'!I2:L2", values:[[String(requestId || ''), 'SUCCESS', '', nowIso(now)]] },
            { range:DASHBOARD_INPUT_RANGE, values:[[''], [''], [''], ['']] }
          ]
        }
      });
    },

    async markError(requestId, message, { consume = false } = {}) {
      const data = [
        { range:"'Owner Action Control'!J2:L2", values:[['ERROR', String(message || '').slice(0, 500), nowIso(now)]] }
      ];
      if (consume && requestId) {
        data.unshift({ range:"'Owner Action Control'!I2", values:[[String(requestId)]] });
        data.push({ range:"'Панель собственника'!O54", values:[['']] });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption:'RAW', data }
      });
    }
  };
}

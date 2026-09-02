function text(value) {
  return String(value ?? '').trim();
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createOwnerActionControlSheetAdapter({
  sheets,
  spreadsheetId,
  controlSheet = 'Owner Action Control',
  queueSheet = 'Owner Action Queue',
  dashboardSheet = 'Панель собственника'
}) {
  return {
    async readControl() {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${controlSheet}'!A2:L2`,
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const row = response.data.values?.[0] || [];
      return {
        ruleId: text(row[0]),
        expectedExecutionStatus: text(row[1]),
        verificationStatus: text(row[2]),
        requestedAction: text(row[3]),
        result: text(row[4]),
        evidence: text(row[5]),
        actualEffect: numberOrNull(row[6]),
        currentRequestId: text(row[7]),
        processedRequestId: text(row[8]),
        transportStatus: text(row[9]),
        lastError: text(row[10]),
        updatedAt: text(row[11])
      };
    },

    async appendCommand(command) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${queueSheet}'!A2:M200`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[
          text(command.requestId), text(command.ruleId), text(command.action),
          text(command.expectedExecutionStatus), text(command.actor), text(command.result),
          text(command.verificationStatus), command.actualEffect ?? '', text(command.evidence),
          text(command.commandStatus), String(command.response ?? ''), text(command.createdAt),
          text(command.processedAt)
        ]] }
      });
    },

    async setControlState({
      currentRequestId = '', processedRequestId = '', transportStatus = '',
      lastError = '', updatedAt = ''
    }) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${controlSheet}'!H2:L2`,
        valueInputOption: 'RAW',
        requestBody: { values: [[
          text(currentRequestId), text(processedRequestId), text(transportStatus),
          String(lastError ?? ''), text(updatedAt)
        ]] }
      });
    },

    async clearDashboardInputs() {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${dashboardSheet}'!O54:O57`,
        requestBody: {}
      });
    }
  };
}

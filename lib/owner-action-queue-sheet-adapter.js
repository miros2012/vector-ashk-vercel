function text(value) {
  return String(value ?? '').trim();
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function ownerActionQueueCommandFromRow(row = [], rowNumber) {
  return {
    _row: Number(rowNumber),
    requestId: text(row[0]),
    ruleId: text(row[1]),
    action: text(row[2]),
    expectedExecutionStatus: text(row[3]),
    actor: text(row[4]),
    result: text(row[5]),
    verificationStatus: text(row[6]),
    actualEffect: numberOrNull(row[7]),
    evidence: text(row[8]),
    commandStatus: text(row[9]),
    response: text(row[10]),
    createdAt: text(row[11]),
    processedAt: text(row[12])
  };
}

export function createOwnerActionQueueSheetAdapter({
  sheets,
  spreadsheetId,
  queueSheet = 'Owner Action Queue'
}) {
  return {
    async readReadyCommands() {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${queueSheet}'!A2:M200`,
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      return (response.data.values || [])
        .map((row, index) => ownerActionQueueCommandFromRow(row, index + 2))
        .filter((command) => command.commandStatus === 'READY');
    },

    async markCommand(rowNumber, { commandStatus = '', response = '', processedAt = '' }) {
      const row = Number(rowNumber);
      if (!Number.isInteger(row) || row < 2) throw new Error('rowNumber must be >= 2');
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `'${queueSheet}'!J${row}:K${row}`, values: [[text(commandStatus), String(response ?? '')]] },
            { range: `'${queueSheet}'!M${row}`, values: [[text(processedAt)]] }
          ]
        }
      });
    }
  };
}

function value(row, index) {
  return row?.[index] ?? '';
}

function numberOrBlank(input) {
  if (input === '' || input === null || input === undefined) return '';
  const number = Number(input);
  return Number.isFinite(number) ? number : '';
}

function iso(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('now must be a valid Date');
  return date.toISOString();
}

export function createOwnerActionRequestSheetAdapter({
  sheets,
  spreadsheetId,
  controlSheet = 'Owner Action Control'
}) {
  async function write(data) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data
      }
    });
  }

  return {
    async readControl() {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: [`'${controlSheet}'!A2:L2`],
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const row = response.data.valueRanges?.[0]?.values?.[0] || [];
      return {
        ruleId: String(value(row, 0) || '').trim(),
        expectedExecutionStatus: String(value(row, 1) || '').trim(),
        verificationStatus: String(value(row, 2) || '').trim(),
        requestedAction: String(value(row, 3) || '').trim(),
        result: String(value(row, 4) || '').trim(),
        evidence: String(value(row, 5) || '').trim(),
        actualEffect: numberOrBlank(value(row, 6)),
        currentRequest: String(value(row, 7) || '').trim(),
        processedRequestId: String(value(row, 8) || '').trim(),
        transportStatus: String(value(row, 9) || '').trim(),
        lastError: String(value(row, 10) || '').trim(),
        updatedAt: value(row, 11) || null
      };
    },

    async claimRequest(requestId, now) {
      await write([
        { range: `'${controlSheet}'!H2`, values: [[String(requestId || '').trim()]] },
        { range: `'${controlSheet}'!J2:L2`, values: [['SENT', '', iso(now)]] }
      ]);
    },

    async markSuccess(requestId, _result, now) {
      await write([
        { range: `'${controlSheet}'!I2:L2`, values: [[String(requestId || '').trim(), 'SUCCESS', '', iso(now)]] }
      ]);
    },

    async markError(requestId, message, now) {
      const safeMessage = String(message || '').slice(0, 300);
      const data = [];
      if (String(requestId || '').trim()) {
        data.push({ range: `'${controlSheet}'!H2`, values: [[String(requestId).trim()]] });
      }
      data.push({ range: `'${controlSheet}'!J2:L2`, values: [['ERROR', safeMessage, iso(now)]] });
      await write(data);
    }
  };
}

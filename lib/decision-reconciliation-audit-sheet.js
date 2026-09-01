export function createDecisionReconciliationAuditAppender({
  sheets,
  spreadsheetId,
  sheetName = 'Rule Engine Audit'
} = {}) {
  if (!sheets?.spreadsheets?.values?.append) throw new Error('sheets append client is required');
  if (!spreadsheetId) throw new Error('spreadsheetId is required');

  return async function appendDecisionReconciliationAuditRow(row) {
    if (!Array.isArray(row) || row.length !== 9) {
      throw new Error('audit row must contain exactly 9 columns');
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${String(sheetName).replace(/'/g, "''")}'!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
  };
}

const DEFAULT_CONTROL_SHEET = '__vercel_control';

function requiredText(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function findControlMarkerRow(rows = [], key) {
  const markerKey = requiredText(key, 'key');
  const index = (Array.isArray(rows) ? rows : []).findIndex(
    row => String(row?.[0] ?? '').trim() === markerKey
  );
  return index < 0 ? null : index + 1;
}

export async function writeControlMarker({
  sheets,
  spreadsheetId,
  key,
  value = new Date().toISOString(),
  sheetName = DEFAULT_CONTROL_SHEET
} = {}) {
  if (!sheets?.spreadsheets?.values) throw new Error('sheets client is required');
  const id = requiredText(spreadsheetId, 'spreadsheetId');
  const markerKey = requiredText(key, 'key');
  const markerValue = requiredText(value, 'value');
  const title = requiredText(sheetName, 'sheetName').replace(/'/g, "''");

  const readback = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${title}'!A:B`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const rows = readback?.data?.values || [];
  const existingRow = findControlMarkerRow(rows, markerKey);

  if (existingRow !== null) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${title}'!B${existingRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[markerValue]] }
    });
    return {
      key: markerKey,
      value: markerValue,
      rowNumber: existingRow,
      created: false
    };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: `'${title}'!A:B`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[markerKey, markerValue]] }
  });
  return {
    key: markerKey,
    value: markerValue,
    rowNumber: rows.length + 1,
    created: true
  };
}
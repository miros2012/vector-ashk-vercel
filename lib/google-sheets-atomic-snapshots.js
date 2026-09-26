function requiredText(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function columnName(columnCount) {
  let value = columnCount;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function normalizedSnapshot(snapshot, index) {
  const sheetName = requiredText(snapshot?.sheetName, `snapshots[${index}].sheetName`);
  const columnCount = Number(snapshot?.columnCount);
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new Error(`snapshots[${index}].columnCount must be a positive integer`);
  }
  if (!Array.isArray(snapshot?.values) || snapshot.values.length < 1) {
    throw new Error(`snapshots[${index}].values must include a header row`);
  }
  const values = snapshot.values.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length > columnCount) {
      throw new Error(`snapshots[${index}].values[${rowIndex}] exceeds columnCount`);
    }
    return Array.from({ length: columnCount }, (_, columnIndex) => row[columnIndex] ?? '');
  });
  const quotedName = `'${sheetName.replace(/'/g, "''")}'`;
  return { sheetName, columnCount, lastColumn: columnName(columnCount), quotedName, values };
}

export async function replaceSheetSnapshotsAtomically({ sheets, spreadsheetId, snapshots } = {}) {
  if (!sheets?.spreadsheets?.values?.batchGet || !sheets?.spreadsheets?.values?.batchUpdate) {
    throw new Error('sheets values batch client is required');
  }
  const id = requiredText(spreadsheetId, 'spreadsheetId');
  if (!Array.isArray(snapshots) || snapshots.length < 1) {
    throw new Error('snapshots are required');
  }
  const normalized = snapshots.map(normalizedSnapshot);
  const readRanges = normalized.map(item => `${item.quotedName}!A1:${item.lastColumn}`);
  const current = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: readRanges,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const currentRanges = current?.data?.valueRanges || [];
  const data = normalized.map((item, index) => {
    const previousHeight = Array.isArray(currentRanges[index]?.values)
      ? currentRanges[index].values.length
      : 0;
    const height = Math.max(previousHeight, item.values.length);
    const values = [...item.values];
    while (values.length < height) values.push(Array(item.columnCount).fill(''));
    return {
      range: `${item.quotedName}!A1:${item.lastColumn}${height}`,
      values
    };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: 'RAW', data }
  });
  return { ranges: data.map(item => item.range) };
}

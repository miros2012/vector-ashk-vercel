const ROP_SHEETS = [
  'РОП_Штаб_Утро',
  'РОП_Задачи_Сегодня',
  'РОП_Контроль_Дня',
  'РОП_План_Сентябрь'
];

export function createRopPublisher({ targetSpreadsheetId, readSheet, writeSheet } = {}) {
  const target = String(targetSpreadsheetId || '').trim();
  if (!target) throw new Error('targetSpreadsheetId is required');
  if (typeof readSheet !== 'function') throw new Error('readSheet is required');
  if (typeof writeSheet !== 'function') throw new Error('writeSheet is required');

  return async function publishRop() {
    const snapshots = [];
    for (const sheetName of ROP_SHEETS) {
      const values = await readSheet(sheetName);
      if (!Array.isArray(values) || !values.length) {
        throw new Error(`ROP source sheet is empty: ${sheetName}`);
      }
      snapshots.push({ sheetName, values });
    }

    for (const snapshot of snapshots) {
      await writeSheet(target, snapshot.sheetName, snapshot.values);
    }

    return { ok: true, sheets: snapshots.length };
  };
}

export { ROP_SHEETS };

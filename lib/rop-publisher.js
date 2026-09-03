const ROP_SHEETS = [
  'РОП_Штаб_Утро',
  'РОП_Задачи_Сегодня',
  'РОП_Контроль_Дня',
  'РОП_План_Сентябрь',
  'РОП_Дебиторка_Приоритет'
];

function taskKey(row) {
  return `${String(row?.[0] || '').trim()}\u0000${String(row?.[3] || '').trim()}`;
}

function mergeTaskManualFields(sourceValues, targetValues) {
  if (!Array.isArray(sourceValues) || sourceValues.length < 2) return sourceValues;
  const existing = new Map();
  for (const row of Array.isArray(targetValues) ? targetValues.slice(1) : []) {
    const key = taskKey(row);
    if (!key || key === '\u0000') continue;
    existing.set(key, {
      status: String(row?.[14] || '').trim(),
      note: String(row?.[15] || '').trim()
    });
  }
  return sourceValues.map((row, index) => {
    if (index === 0) return row;
    const manual = existing.get(taskKey(row));
    if (!manual) return row;
    const next = [...row];
    if (manual.status) next[14] = manual.status;
    if (manual.note) next[15] = manual.note;
    return next;
  });
}

const DEBTOR_MANUAL_HEADERS = ['Результат контакта','Обещанная сумма','Обещанная дата','Комментарий'];

function mergeDebtorManualFields(sourceValues, targetValues) {
  if (!Array.isArray(sourceValues) || sourceValues.length < 2) return sourceValues;
  const sourceHeaders = sourceValues[0] || [];
  const targetHeaders = Array.isArray(targetValues?.[0]) ? targetValues[0] : [];
  const sourceIdx = new Map(sourceHeaders.map((name, index) => [String(name || '').trim(), index]));
  const targetIdx = new Map(targetHeaders.map((name, index) => [String(name || '').trim(), index]));
  if (!sourceIdx.has('StudentId') || !targetIdx.has('StudentId')) return sourceValues;
  const existing = new Map();
  for (const row of Array.isArray(targetValues) ? targetValues.slice(1) : []) {
    const id = Number(row?.[targetIdx.get('StudentId')]);
    if (!(id > 0)) continue;
    existing.set(id, Object.fromEntries(DEBTOR_MANUAL_HEADERS.map(header => [header, row?.[targetIdx.get(header)] ?? ''])));
  }
  return sourceValues.map((row, index) => {
    if (index === 0) return row;
    const manual = existing.get(Number(row?.[sourceIdx.get('StudentId')]));
    if (!manual) return row;
    const next = [...row];
    for (const header of DEBTOR_MANUAL_HEADERS) {
      if (sourceIdx.has(header) && manual[header] !== '' && manual[header] != null) {
        next[sourceIdx.get(header)] = manual[header];
      }
    }
    return next;
  });
}

export async function syncRopSourceThenPublishTarget({ refreshSource, publishTarget } = {}) {
  if (typeof refreshSource !== 'function') throw new Error('refreshSource is required');
  if (typeof publishTarget !== 'function') throw new Error('publishTarget is required');

  const source = await refreshSource();
  if (!source?.ok) return source;

  const target = await publishTarget();
  if (!target?.ok) throw new Error('Standalone ROP publish failed');

  return {
    ...source,
    standalonePublished: true,
    standaloneSheets: Number(target.sheets || 0)
  };
}

export function createRopPublisher({ targetSpreadsheetId, readSheet, readTargetSheet, writeSheet } = {}) {
  const target = String(targetSpreadsheetId || '').trim();
  if (!target) throw new Error('targetSpreadsheetId is required');
  if (typeof readSheet !== 'function') throw new Error('readSheet is required');
  if (readTargetSheet != null && typeof readTargetSheet !== 'function') throw new Error('readTargetSheet must be a function');
  if (typeof writeSheet !== 'function') throw new Error('writeSheet is required');

  return async function publishRop() {
    const snapshots = [];
    for (const sheetName of ROP_SHEETS) {
      let values = await readSheet(sheetName);
      if (!Array.isArray(values) || !values.length) {
        throw new Error(`ROP source sheet is empty: ${sheetName}`);
      }
      if (sheetName === 'РОП_Задачи_Сегодня' && readTargetSheet) {
        const targetValues = await readTargetSheet(target, sheetName);
        values = mergeTaskManualFields(values, targetValues);
      }
      if (sheetName === 'РОП_Дебиторка_Приоритет' && readTargetSheet) {
        const targetValues = await readTargetSheet(target, sheetName);
        values = mergeDebtorManualFields(values, targetValues);
      }
      snapshots.push({ sheetName, values });
    }

    for (const snapshot of snapshots) {
      await writeSheet(target, snapshot.sheetName, snapshot.values);
    }

    return { ok: true, sheets: snapshots.length };
  };
}

export { ROP_SHEETS, mergeTaskManualFields, mergeDebtorManualFields };

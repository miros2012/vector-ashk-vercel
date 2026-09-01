function sheetSerial(isoDate) {
  const text = String(isoDate || '').slice(0, 10);
  if (!text) return '';
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`invalid due date: ${isoDate}`);
  return Math.trunc((timestamp - Date.UTC(1899, 11, 30)) / 86400000);
}

function cell(range, value) {
  return { range, values: [[value]] };
}

export function buildDecisionStateUpdates(comparison = {}) {
  const results = Array.isArray(comparison?.results) ? comparison.results : [];
  if (!results.length && Number(comparison?.total) > 0) {
    throw new Error('shadow comparison results are required');
  }

  const updates = [];
  for (const result of results) {
    const ruleId = String(result?.ruleId || '').trim() || '<unknown>';
    const row = Number(result?.current?._row);
    if (!Number.isInteger(row) || row < 2) {
      throw new Error(`missing current decision row: ${ruleId}`);
    }

    const shadow = result?.shadow || {};
    const active = Boolean(shadow.active);
    const amount = active
      ? (shadow.amount === null || shadow.amount === undefined || shadow.amount === '' ? '' : Number(shadow.amount))
      : 0;
    const linkedObjects = active && Array.isArray(shadow.linkedObjects)
      ? [...new Set(shadow.linkedObjects.map((item) => String(item || '').trim()).filter(Boolean))].join(', ')
      : '';

    updates.push(
      cell(`'Решения'!H${row}`, active ? sheetSerial(shadow.dueDate) : ''),
      cell(`'Решения'!J${row}`, active ? 'Активно' : 'Неактивно'),
      cell(`'Решения'!M${row}`, Number.isFinite(amount) ? amount : amount),
      cell(`'Решения'!P${row}`, linkedObjects)
    );
  }

  return updates;
}

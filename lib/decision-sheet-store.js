function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function valueOrBlank(value) {
  return value === null || value === undefined ? '' : value;
}

export function decisionFromSheetRow(row = [], rowNumber) {
  return {
    ruleId: String(row[0] || '').trim(),
    ruleStatus: String(row[9] || '').trim(),
    executionStatus: String(row[10] || 'Не начато').trim(),
    plannedEffect: numberOrNull(row[12]) ?? 0,
    actualEffect: numberOrNull(row[13]),
    startedAt: valueOrBlank(row[17]) || null,
    completedAt: valueOrBlank(row[18]) || null,
    result: String(row[19] || ''),
    verificationStatus: String(row[20] || 'Не проверено').trim(),
    lastCheckedAt: valueOrBlank(row[21]) || null,
    _row: Number(rowNumber)
  };
}

export function buildDecisionUpdates(rowNumber, next) {
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 2) throw new Error('rowNumber must be >= 2');
  return [
    {
      range: `'Решения'!K${row}`,
      values: [[String(next.executionStatus || '')]]
    },
    {
      range: `'Решения'!N${row}`,
      values: [[next.actualEffect === null || next.actualEffect === undefined ? '' : Number(next.actualEffect)]]
    },
    {
      range: `'Решения'!R${row}:V${row}`,
      values: [[
        valueOrBlank(next.startedAt),
        valueOrBlank(next.completedAt),
        String(next.result || ''),
        String(next.verificationStatus || 'Не проверено'),
        valueOrBlank(next.lastCheckedAt)
      ]]
    }
  ];
}

export function buildHistoryRow(event, eventId) {
  return [
    String(eventId || '').trim(),
    String(event.ruleId || '').trim(),
    String(event.type || '').trim(),
    String(event.at || '').trim(),
    String(event.before || '').trim(),
    String(event.after || '').trim(),
    String(event.actor || '').trim(),
    Number.isFinite(Number(event.plannedEffect)) ? Number(event.plannedEffect) : 0,
    event.actualEffect === null || event.actualEffect === undefined ? '' : Number(event.actualEffect),
    String(event.evidence || '').trim(),
    String(event.comment || event.result || '').trim()
  ];
}

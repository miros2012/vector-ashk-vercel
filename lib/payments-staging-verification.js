function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(/\u00A0/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function paymentMetrics(rows) {
  const safeRows = (Array.isArray(rows) ? rows : [])
    .filter(row => Array.isArray(row) && String(row?.[0] ?? '').trim());
  const debitTotal = safeRows.reduce((sum, row) => sum + toNumber(row[7]), 0);
  const dates = safeRows.map(row => String(row[1] ?? '')).filter(Boolean).sort();
  return {
    rows: safeRows.length,
    debitTotal: Math.round(debitTotal * 100) / 100,
    minPayDate: dates[0] || null,
    maxPayDate: dates.at(-1) || null
  };
}

export function paymentMetricsMatch(actual, expected) {
  if (!actual || !expected) return false;
  return Number(actual.rows) === Number(expected.rows)
    && Math.abs(Number(actual.debitTotal) - Number(expected.debitTotal)) < 0.01
    && String(actual.minPayDate ?? '') === String(expected.minPayDate ?? '')
    && String(actual.maxPayDate ?? '') === String(expected.maxPayDate ?? '');
}

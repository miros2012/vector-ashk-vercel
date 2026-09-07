const REQUIRED_HEADERS = [
  'Дата',
  'Остаток на начало',
  'Поступления всего',
  'Выплаты всего',
  'Резерв / блокировка'
];

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite`);
  }
  return normalizeZero(value);
}

function nonNegativeNumber(value, field) {
  const normalized = finiteNumber(value, field);
  if (normalized < 0) throw new Error(`${field} must be non-negative`);
  return normalized;
}

function positiveInteger(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function findLabelValue(rows, label) {
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const index = row.findIndex((value) => value === label);
    if (index !== -1) return row[index + 1];
  }
  throw new Error(`${label} is missing`);
}

function findHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) continue;
    if (REQUIRED_HEADERS.every((header) => row.includes(header))) {
      return {
        rowIndex,
        indexes: Object.fromEntries(
          REQUIRED_HEADERS.map((header) => [header, row.indexOf(header)])
        )
      };
    }
  }
  throw new Error('forecast daily header is missing');
}

function sheetSerialToIso(value) {
  const timestamp = Date.UTC(1899, 11, 30) + Math.trunc(value) * 86400000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function parseOwnerForecastSheetValues(rows) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');

  const horizonDays = positiveInteger(
    findLabelValue(rows, 'Горизонт'),
    'horizonDays'
  );
  const availableCash = nonNegativeNumber(
    findLabelValue(rows, 'Стартовый остаток'),
    'availableCash'
  );
  const header = findHeader(rows);
  const dailyRows = rows.slice(header.rowIndex + 1, header.rowIndex + 1 + horizonDays);

  const parsed = dailyRows.map((row) => {
    const date = sheetSerialToIso(row[header.indexes['Дата']]);
    return {
      date,
      openingCash: Number(row[header.indexes['Остаток на начало']]),
      inflow: Number(row[header.indexes['Поступления всего']]),
      outflow: Number(row[header.indexes['Выплаты всего']]),
      reserve: Number(row[header.indexes['Резерв / блокировка']])
    };
  });

  return {
    availableCash,
    horizonDays,
    openingCash: parsed[0].openingCash,
    flows: parsed.map((day) => ({
      date: day.date,
      inflow: day.inflow,
      outflow: day.outflow
    })),
    protectedReserves: parsed.map((day) => ({
      date: day.date,
      amount: day.reserve
    }))
  };
}

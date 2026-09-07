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

function findUniqueLabelValue(rows, label) {
  const matches = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (let index = 0; index < row.length; index += 1) {
      if (row[index] === label) matches.push({ row, index });
    }
  }

  if (matches.length === 0) throw new Error(`${label} is missing`);
  if (matches.length !== 1) throw new Error(`${label} must appear exactly once`);

  const match = matches[0];
  if (match.index + 1 >= match.row.length) throw new Error(`${label} value is missing`);
  return match.row[match.index + 1];
}

function findHeader(rows) {
  const matches = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) continue;
    if (REQUIRED_HEADERS.every((header) => row.includes(header))) {
      matches.push({ rowIndex, row });
    }
  }

  if (matches.length === 0) throw new Error('forecast daily header is missing');
  if (matches.length !== 1) throw new Error('forecast daily header must appear exactly once');

  const { rowIndex, row } = matches[0];
  const indexes = {};
  for (const header of REQUIRED_HEADERS) {
    const occurrences = row.filter((value) => value === header).length;
    if (occurrences !== 1) {
      throw new Error(`${header} must appear exactly once in daily header`);
    }
    indexes[header] = row.indexOf(header);
  }

  return { rowIndex, indexes };
}

function sheetSerialToIso(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('date serial must be a finite integer');
  }
  const timestamp = Date.UTC(1899, 11, 30) + value * 86400000;
  if (!Number.isFinite(timestamp)) throw new Error('date serial must be a finite integer');
  return new Date(timestamp).toISOString().slice(0, 10);
}

function validateForecastDates(parsed) {
  const seen = new Set();
  for (let index = 0; index < parsed.length; index += 1) {
    const date = parsed[index].date;
    if (seen.has(date)) throw new Error('forecast dates contain a duplicate');
    seen.add(date);

    if (index > 0) {
      const previous = Date.parse(`${parsed[index - 1].date}T00:00:00.000Z`);
      const current = Date.parse(`${date}T00:00:00.000Z`);
      if (current - previous !== 86400000) {
        throw new Error('forecast dates must be consecutive');
      }
    }
  }
}

export function parseOwnerForecastSheetValues(rows) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');

  const horizonDays = positiveInteger(
    findUniqueLabelValue(rows, 'Горизонт'),
    'horizonDays'
  );
  const availableCash = nonNegativeNumber(
    findUniqueLabelValue(rows, 'Стартовый остаток'),
    'availableCash'
  );
  const header = findHeader(rows);
  const dailyRows = rows.slice(header.rowIndex + 1, header.rowIndex + 1 + horizonDays);
  if (dailyRows.length !== horizonDays) {
    throw new Error('daily rows must match horizonDays');
  }

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
  validateForecastDates(parsed);

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

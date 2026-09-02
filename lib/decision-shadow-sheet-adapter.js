import { buildDecisionFinancialSnapshot, compareDecisionShadow } from './decision-shadow.js';

const RANGES = [
  "'Прогноз 30 дней'!D1:H2",
  "'Корректировки обязательств'!B2:F500",
  "'Обязательства'!A2:N500",
  "'АШК_Дебиторка_Свод__vercel'!A2:F2",
  "'Каталог правил'!A2:N200",
  "'Решения'!A2:Q200"
];

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sheetsDateToIso(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = Date.UTC(1899, 11, 30) + Math.trunc(value) * 86400000;
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const ru = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function previousDay(date) {
  const iso = sheetsDateToIso(date);
  if (!iso) return null;
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
}

function forecastFacts(rows) {
  if (rows.length >= 2) {
    return {
      asOfDate: previousDay(rows[0]?.[0]),
      cashGapDate: sheetsDateToIso(rows[1]?.[0]),
      cashGapAmount: finiteOrNull(rows[1]?.[4]) ?? 0
    };
  }
  const row = rows[0] || [];
  return {
    asOfDate: previousDay(row[0]),
    cashGapDate: sheetsDateToIso(row[1]),
    cashGapAmount: finiteOrNull(row[2]) ?? 0
  };
}

function parseAdjustments(rows) {
  return rows
    .filter((row) => row?.some((value) => value !== '' && value !== null && value !== undefined))
    .map((row) => ({
      obligationId: String(row?.[0] || '').trim(),
      type: String(row?.[1] || '').trim(),
      direction: String(row?.[2] || '').trim(),
      amount: finiteOrNull(row?.[3]) ?? 0,
      status: String(row?.[4] || '').trim()
    }));
}

function parseObligations(rows) {
  return rows
    .filter((row) => String(row?.[13] || '').trim())
    .map((row) => ({
      id: String(row?.[13] || '').trim(),
      dueDate: sheetsDateToIso(row?.[0]),
      remaining: finiteOrNull(row?.[5]),
      priority: String(row?.[6] || '').trim(),
      status: String(row?.[7] || '').trim()
    }));
}

function parseReceivables(rows) {
  const row = rows.find((candidate) => String(candidate?.[0] || '').trim().toUpperCase() === 'ИТОГО');
  if (!row) throw new Error('receivables summary total is missing');
  const values = [row?.[2], row?.[3], row?.[4], row?.[5]].map(finiteOrNull);
  if (values.some((value) => value === null || value < 0) || !Number.isInteger(values[0])) {
    throw new Error('receivables summary total is invalid');
  }
  const [contracts, debt, sales, paid] = values;
  return { contracts, debt, sales, paid };
}

function parseCatalog(rows) {
  return rows
    .filter((row) => String(row?.[0] || '').trim())
    .map((row) => ({
      ruleId: String(row?.[0] || '').trim(),
      evaluatorKey: String(row?.[2] || '').trim(),
      slaDays: finiteOrNull(row?.[10]),
      enabled: row?.[12] === true || String(row?.[12] || '').trim().toLowerCase() === 'true',
      version: finiteOrNull(row?.[13]) ?? 1
    }));
}

function splitObjects(value) {
  return [...new Set(String(value || '').split(/[,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function parseDecisions(rows) {
  return rows
    .map((row, index) => ({ row, sheetRow: index + 2 }))
    .filter(({ row }) => String(row?.[0] || '').trim())
    .map(({ row, sheetRow }) => ({
      _row: sheetRow,
      ruleId: String(row?.[0] || '').trim(),
      active: String(row?.[9] || '').trim() === 'Активно',
      dueDate: sheetsDateToIso(row?.[7]),
      amount: finiteOrNull(row?.[12]),
      linkedObjects: splitObjects(row?.[15])
    }));
}

export function createDecisionShadowSheetAdapter({ sheets, spreadsheetId, now = () => new Date() }) {
  if (!sheets?.spreadsheets?.values?.batchGet) throw new Error('sheets batchGet is required');
  if (!String(spreadsheetId || '').trim()) throw new Error('spreadsheetId is required');

  return {
    async run() {
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: RANGES,
        valueRenderOption: 'UNFORMATTED_VALUE'
      });
      const ranges = response.data.valueRanges || [];
      const forecast = forecastFacts(ranges[0]?.values || []);
      const adjustmentRows = parseAdjustments(ranges[1]?.values || []);
      const obligationRows = parseObligations(ranges[2]?.values || []);
      const receivables = parseReceivables(ranges[3]?.values || []);
      const catalog = parseCatalog(ranges[4]?.values || []);
      const currentDecisions = parseDecisions(ranges[5]?.values || []);
      const snapshot = buildDecisionFinancialSnapshot({ ...forecast, adjustmentRows, obligationRows, receivables });
      const comparison = compareDecisionShadow({ catalog, snapshot, currentDecisions, now: now() });
      return { snapshot, catalog, currentDecisions, comparison };
    }
  };
}

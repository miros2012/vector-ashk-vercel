import { createHash, timingSafeEqual } from 'node:crypto';

export const BUSINESS_TIME_ZONE = 'Asia/Yekaterinburg';

export const HOURS_RAW_HEADERS = [
  'Key',
  'Month',
  'FactDate',
  'FactStart',
  'EmployeeId',
  'MasterName',
  'ContractName',
  'SessionTypeName',
  'Hours',
  'ParallelHours',
  'VisitState',
  'MainProductName',
  'VehicleName',
  'Source',
  'LoadedAt'
];

function finiteNumber(value) {
  const number = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function validOffsetlessLocalMatch(raw) {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) return null;

  return {
    date: `${yearText}-${monthText}-${dayText}`,
    time: `${hourText}:${minuteText}:${secondText}`
  };
}

export function businessDateFromFactStart(value, timeZone = BUSINESS_TIME_ZONE) {
  const raw = text(value);
  if (!raw) return '';

  const localMatch = validOffsetlessLocalMatch(raw);
  if (localMatch) return localMatch.date;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) return '';

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return localDateParts(date, timeZone);
}

function normalizedBusinessStart(value, timeZone = BUSINESS_TIME_ZONE) {
  const raw = text(value);
  const localMatch = validOffsetlessLocalMatch(raw);
  if (localMatch) return `${localMatch.date}T${localMatch.time}`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) return '';

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = localDateParts(date, timeZone);
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const part = (type) => timeParts.find((item) => item.type === type)?.value;
  return `${datePart}T${part('hour')}:${part('minute')}:${part('second')}`;
}

export function masterReportPeriodForMonth(month) {
  const match = String(month ?? '').match(/^(\d{4})-(\d{2})$/);
  const monthNumber = Number(match?.[2]);
  if (!match || monthNumber < 1 || monthNumber > 12) {
    throw new Error('month must be a valid YYYY-MM value');
  }
  const year = Number(match[1]);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startDate: `${month}-01T00:00:00`,
    endDate: `${month}-${String(lastDay).padStart(2, '0')}T23:59:59`
  };
}

function normalizedRow(row, month, loadedAt) {
  const date = businessDateFromFactStart(row?.FactStart);
  const businessStart = normalizedBusinessStart(row?.FactStart);
  if (!date || !businessStart || !date.startsWith(`${month}-`)) {
    throw new Error(`ASHK row is outside requested month ${month}: ${text(row?.FactStart) || '(missing FactStart)'}`);
  }
  const values = {
    month,
    factDate: date,
    factStart: text(row?.FactStart),
    employeeId: text(row?.EmployeeId),
    masterName: text(row?.MasterName),
    contractName: text(row?.ContractName),
    sessionTypeName: text(row?.SessionTypeName) || '(без типа)',
    hours: finiteNumber(row?.Hours),
    parallelHours: finiteNumber(row?.ParallelHours),
    visitState: row?.VisitState ?? '',
    mainProductName: text(row?.MainProductName),
    vehicleName: text(row?.VehicleName),
    source: 'MasterWorkReportDetails',
    loadedAt
  };
  values.key = JSON.stringify([
    values.employeeId,
    businessStart,
    values.contractName,
    values.sessionTypeName
  ]);
  return values;
}

function metricsFromNormalizedRows(rows) {
  const metrics = { rows: rows.length, hours: 0, byDate: {}, byType: {} };
  for (const row of rows) {
    metrics.hours += row.hours;
    const date = metrics.byDate[row.factDate] || { rows: 0, hours: 0 };
    date.rows += 1;
    date.hours += row.hours;
    metrics.byDate[row.factDate] = date;
    const type = metrics.byType[row.sessionTypeName] || { rows: 0, hours: 0 };
    type.rows += 1;
    type.hours += row.hours;
    metrics.byType[row.sessionTypeName] = type;
  }
  metrics.byDate = Object.fromEntries(Object.entries(metrics.byDate).sort());
  metrics.byType = Object.fromEntries(
    Object.entries(metrics.byType).sort(([left], [right]) => left.localeCompare(right, 'ru'))
  );
  return metrics;
}

function toRawValues(rows) {
  return [
    HOURS_RAW_HEADERS,
    ...rows.map((row) => [
      row.key,
      row.month,
      row.factDate,
      row.factStart,
      row.employeeId,
      row.masterName,
      row.contractName,
      row.sessionTypeName,
      row.hours,
      row.parallelHours,
      row.visitState,
      row.mainProductName,
      row.vehicleName,
      row.source,
      row.loadedAt
    ])
  ];
}

function toReconciliationValues(metrics, month, loadedAt, sourceRows, duplicateRows) {
  const rows = [
    ['Section', 'Key', 'Rows', 'Hours', 'Month', 'LoadedAt'],
    ['total', 'MasterWorkReportDetails', metrics.rows, metrics.hours, month, loadedAt],
    ['control', 'Source rows', sourceRows, '', month, loadedAt],
    ['control', 'Stable-key rows superseded', duplicateRows, '', month, loadedAt],
    ['control', 'Business timezone', '', BUSINESS_TIME_ZONE, month, loadedAt]
  ];
  for (const [date, value] of Object.entries(metrics.byDate)) {
    rows.push(['date', date, value.rows, value.hours, month, loadedAt]);
  }
  for (const [type, value] of Object.entries(metrics.byType)) {
    rows.push(['type', type, value.rows, value.hours, month, loadedAt]);
  }
  return rows;
}

export function buildHoursImportWorkbook(apiRows, { month, loadedAt }) {
  masterReportPeriodForMonth(month);
  const byKey = new Map();
  for (const apiRow of apiRows) {
    const row = normalizedRow(apiRow, month, loadedAt);
    byKey.set(row.key, row);
  }
  const rows = [...byKey.values()].sort((left, right) =>
    left.factStart.localeCompare(right.factStart) || left.key.localeCompare(right.key)
  );
  const metrics = metricsFromNormalizedRows(rows);
  const duplicateRows = apiRows.length - rows.length;
  return {
    sourceRows: apiRows.length,
    duplicateRows,
    metrics,
    rawValues: toRawValues(rows),
    reconciliationValues: toReconciliationValues(metrics, month, loadedAt, apiRows.length, duplicateRows)
  };
}

export function metricsFromHoursSheetValues(values) {
  const data = values.slice(1).filter((row) => text(row?.[0]));
  return {
    rows: data.length,
    hours: data.reduce((sum, row) => sum + finiteNumber(row?.[8]), 0)
  };
}

export function compareHoursMetrics(source, staging) {
  const rowDiff = staging.rows - source.rows;
  const hoursDiff = Math.round((staging.hours - source.hours) * 1000) / 1000;
  return { ok: rowDiff === 0 && hoursDiff === 0, rowDiff, hoursDiff };
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

export function isAuthorizedSyncKey(providedKey, { configuredKey = '', bootstrapHash = '' } = {}) {
  const provided = text(providedKey);
  if (!provided) return false;
  if (configuredKey && timingSafeEqual(sha256(provided), sha256(configuredKey))) return true;
  if (/^[a-f\d]{64}$/i.test(bootstrapHash)) {
    return timingSafeEqual(sha256(provided), Buffer.from(bootstrapHash, 'hex'));
  }
  return false;
}

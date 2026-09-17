import { boundedGoogleSheetsRequest, withGoogleSheetsLease } from './google-sheets-lease.js';

const READY_SHEET = 'API → ДДС готово';
const DDS_SHEET = 'ДДС: месяц';
const JOURNAL_SHEET = 'Журнал Точка → ДДС';
const BUSINESS_TZ = 'Asia/Yekaterinburg';
const IMPORT_LEASE_KEY = 'tochka_dds_import_lock';
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DDS_FIRST_DATA_ROW = 5;
const DDS_LAST_DATA_ROW = 30000;
const DDS_RECOVERY_SCAN_ROWS = 2000;
const READY_HEADERS = [
  'Месяц','Мсц (цифрой)','Дата','Сумма','Кошелек','Направление бизнеса',
  'Контрагент','Назначение платежа','Статья','Платеж/поступл','Вид д-ти',
  'Месяц P&L','Комментарий P&L','Ключ дубля','transactionId'
];

function text(value) {
  return String(value ?? '').trim();
}

function requiredText(value, name) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(text(value).replace(/\u00a0/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = SHEETS_EPOCH_UTC + Math.trunc(value) * 86400000;
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return '';
}

function ruDate(isoDate) {
  const match = text(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('businessDate must be YYYY-MM-DD');
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function businessTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('now is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('day')}.${part('month')}.${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function validateHeader(values) {
  const header = Array.isArray(values?.[0]) ? values[0] : [];
  for (let index = 0; index < READY_HEADERS.length; index += 1) {
    if (text(header[index]) !== READY_HEADERS[index]) {
      throw new Error(`Tochka ready header mismatch at column ${index + 1}`);
    }
  }
}

function ddsKeyFromComment(value) {
  const comment = text(value);
  const prefix = 'Точка API | ';
  return comment.startsWith(prefix) ? comment.slice(prefix.length).trim() : '';
}

function ddsKeyCounts(values) {
  const counts = new Map();
  for (const row of Array.isArray(values) ? values : []) {
    const key = ddsKeyFromComment(row?.[0]);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function journalKeyCounts(values) {
  const counts = new Map();
  for (const row of Array.isArray(values) ? values : []) {
    const key = text(row?.[0]);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function validateCurrentDayRow(row, rowNumber, businessDate, importedAt) {
  if (!Array.isArray(row)) throw new Error(`Invalid current-day Tochka row ${rowNumber}`);
  const amount = numberValue(row[3]);
  const key = text(row[13]);
  const transactionId = text(row[14]);
  const requiredIndexes = [0, 1, 4, 7, 8, 9, 10, 11, 12, 13, 14];
  if (requiredIndexes.some(index => !text(row[index]))) {
    throw new Error(`Invalid current-day Tochka row ${rowNumber}: required field missing`);
  }
  if (amount === null || amount === 0) {
    throw new Error(`Invalid current-day Tochka row ${rowNumber}: amount`);
  }
  if (text(row[12]) !== `Точка API | ${key}`) {
    throw new Error(`Invalid current-day Tochka row ${rowNumber}: DDS comment key`);
  }
  if (!key.endsWith(`|${transactionId}`)) {
    throw new Error(`Invalid current-day Tochka row ${rowNumber}: transaction key`);
  }
  const expectedFlow = amount > 0 ? 'Поступление' : 'Выбытие';
  if (text(row[9]) !== expectedFlow) {
    throw new Error(`Invalid current-day Tochka row ${rowNumber}: cash-flow direction`);
  }
  if (normalizedDate(row[2]) !== businessDate) {
    throw new Error(`Invalid current-day Tochka row ${rowNumber}: business date`);
  }

  const counterparty = text(row[6]).toUpperCase();
  const purpose = text(row[7]).toUpperCase();
  const category = text(row[8]).toUpperCase();
  if (
    amount < 0
    && category === 'ПРОДАЖИ'
    && counterparty.includes('БАНК ТОЧКА')
    && purpose.includes('ПОКУПКА ТОВАРА')
  ) {
    throw new Error(`Invalid current-day Tochka row ${rowNumber}: card purchase classified as sales`);
  }

  return {
    key,
    ddsRow: row.slice(0, 13),
    journalRow: [key, transactionId, ruDate(businessDate), businessTimestamp(importedAt), 'Импортировано']
  };
}

function verifyKeys({ counts, keys, label }) {
  for (const key of keys) {
    if (Number(counts.get(key) || 0) !== 1) {
      throw new Error(`${label} readback verification failed`);
    }
  }
}

function rowHasAnyValue(row, startColumn = 0, endColumn = 19) {
  const values = Array.isArray(row) ? row : [];
  for (let index = startColumn; index < endColumn; index += 1) {
    if (text(values[index]) !== '') return true;
  }
  return false;
}

function hasAnyValue(values) {
  return (Array.isArray(values) ? values : []).some(row => rowHasAnyValue(row));
}

function isShiftedArtifactBlock(values) {
  let hasShiftedValue = false;
  for (const row of Array.isArray(values) ? values : []) {
    if (rowHasAnyValue(row, 0, 6)) return false;
    if (rowHasAnyValue(row, 6, 19)) hasShiftedValue = true;
  }
  return hasShiftedValue;
}

function findContiguousEmptyBlock(values, blockSize, scanRows) {
  const size = Number(blockSize);
  const limit = Number(scanRows);
  if (!Number.isInteger(size) || size < 1 || !Number.isInteger(limit) || limit < size) return null;
  for (let offset = 0; offset <= limit - size; offset += 1) {
    let empty = true;
    for (let index = offset; index < offset + size; index += 1) {
      if (rowHasAnyValue(values?.[index])) {
        empty = false;
        break;
      }
    }
    if (empty) return offset;
  }
  return null;
}

function requestBearer(req) {
  const authorization = text(req?.headers?.authorization);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function findNextDdsRow(anchorValues, startRow = DDS_FIRST_DATA_ROW) {
  const firstRow = Number(startRow);
  if (!Number.isInteger(firstRow) || firstRow < 1) {
    throw new Error('startRow must be a positive integer');
  }

  let lastOccupiedIndex = -1;
  for (let index = 0; index < (Array.isArray(anchorValues) ? anchorValues.length : 0); index += 1) {
    if (text(anchorValues[index]?.[0])) lastOccupiedIndex = index;
  }
  return firstRow + lastOccupiedIndex + 1;
}

export function buildCurrentDayTochkaDdsPlan({
  readyValues,
  ddsCommentValues,
  journalValues,
  businessDate,
  now = new Date()
} = {}) {
  const date = requiredText(businessDate, 'businessDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('businessDate must be YYYY-MM-DD');
  const importedAt = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(importedAt.getTime())) throw new Error('now is invalid');
  validateHeader(readyValues);

  const existingDds = ddsKeyCounts(ddsCommentValues);
  const existingJournal = journalKeyCounts(journalValues);
  const eligibleKeys = [];
  const ddsRows = [];
  const journalRows = [];
  const seen = new Set();

  for (let index = 1; index < (Array.isArray(readyValues) ? readyValues.length : 0); index += 1) {
    const row = readyValues[index];
    if (!Array.isArray(row) || row.every(value => text(value) === '')) continue;

    const rowDate = normalizedDate(row[2]);
    if (!rowDate || rowDate > date) continue;
    const isCurrentDay = rowDate === date;
    const rawKey = text(row[13]);
    const ddsCountBefore = rawKey ? Number(existingDds.get(rawKey) || 0) : 0;
    const journalCountBefore = rawKey ? Number(existingJournal.get(rawKey) || 0) : 0;

    // Fully integrated historical rows do not need to be revalidated. This
    // keeps old malformed artifacts from blocking today's accounting run.
    if (!isCurrentDay && ddsCountBefore === 1 && journalCountBefore === 1) continue;

    let normalized;
    try {
      normalized = validateCurrentDayRow(row, index + 1, rowDate, importedAt);
    } catch (error) {
      if (isCurrentDay) throw error;
      continue;
    }

    if (seen.has(normalized.key)) {
      throw new Error(`Duplicate Tochka key in ready rows: ${normalized.key}`);
    }
    seen.add(normalized.key);

    const ddsCount = Number(existingDds.get(normalized.key) || 0);
    const journalCount = Number(existingJournal.get(normalized.key) || 0);
    if (ddsCount > 1) throw new Error('DDS duplicate key before import');
    if (journalCount > 1) throw new Error('Journal duplicate key before import');

    // Preserve strict current-day verification even for an idempotent no-op,
    // while older rows are included only when DDS or journal actually missed them.
    if (!isCurrentDay && ddsCount === 1 && journalCount === 1) continue;
    eligibleKeys.push(normalized.key);
    if (ddsCount === 0) ddsRows.push(normalized.ddsRow);
    if (journalCount === 0) journalRows.push(normalized.journalRow);
  }

  return { businessDate: date, eligibleKeys, ddsRows, journalRows };
}

async function syncCurrentDayTochkaDdsUnlocked({
  sheets,
  spreadsheetId,
  businessDate,
  now = () => new Date(),
  requestTimeoutMs
} = {}) {
  const valuesApi = sheets?.spreadsheets?.values;
  if (!valuesApi?.batchGet || !valuesApi?.append || !valuesApi?.get) {
    throw new Error('sheets values client is required');
  }
  const id = requiredText(spreadsheetId, 'spreadsheetId');
  const current = typeof now === 'function' ? now() : now;
  const ranges = [
    `'${READY_SHEET}'!A1:O3000`,
    `'${DDS_SHEET}'!M${DDS_FIRST_DATA_ROW}:M${DDS_LAST_DATA_ROW}`,
    `'${JOURNAL_SHEET}'!A2:E3000`,
    `'${DDS_SHEET}'!A${DDS_FIRST_DATA_ROW}:A${DDS_LAST_DATA_ROW}`
  ];
  const snapshot = await boundedGoogleSheetsRequest(options => valuesApi.batchGet({
    spreadsheetId: id,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE'
  }, options), requestTimeoutMs);
  const valueRanges = snapshot?.data?.valueRanges || [];
  const plan = buildCurrentDayTochkaDdsPlan({
    readyValues: valueRanges[0]?.values || [],
    ddsCommentValues: valueRanges[1]?.values || [],
    journalValues: valueRanges[2]?.values || [],
    businessDate,
    now: current
  });

  if (!plan.eligibleKeys.length) {
    return {
      ok: true,
      businessDate: plan.businessDate,
      eligibleRows: 0,
      ddsAppended: 0,
      journalAppended: 0,
      verified: true
    };
  }

  if (plan.ddsRows.length) {
    if (typeof valuesApi.update !== 'function') {
      throw new Error('sheets values update client is required');
    }
    const candidateStartRow = findNextDdsRow(
      valueRanges[3]?.values || [],
      DDS_FIRST_DATA_ROW
    );
    const candidateEndRow = candidateStartRow + plan.ddsRows.length - 1;
    if (candidateStartRow < DDS_FIRST_DATA_ROW || candidateEndRow > DDS_LAST_DATA_ROW) {
      throw new Error('DDS target capacity exceeded');
    }

    const targetReadback = await boundedGoogleSheetsRequest(options => valuesApi.get({
      spreadsheetId: id,
      range: `'${DDS_SHEET}'!A${candidateStartRow}:S${candidateEndRow}`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    }, options), requestTimeoutMs);

    let ddsStartRow = candidateStartRow;
    if (hasAnyValue(targetReadback?.data?.values || [])) {
      const occupiedValues = targetReadback?.data?.values || [];
      if (!isShiftedArtifactBlock(occupiedValues)) {
        throw new Error('DDS target rows are not empty');
      }

      const scanRows = Math.min(
        DDS_RECOVERY_SCAN_ROWS,
        DDS_LAST_DATA_ROW - candidateStartRow + 1
      );
      if (scanRows < plan.ddsRows.length) throw new Error('DDS recovery capacity exceeded');
      const scanEndRow = candidateStartRow + scanRows - 1;
      const recoveryScan = await boundedGoogleSheetsRequest(options => valuesApi.get({
        spreadsheetId: id,
        range: `'${DDS_SHEET}'!A${candidateStartRow}:S${scanEndRow}`,
        valueRenderOption: 'UNFORMATTED_VALUE'
      }, options), requestTimeoutMs);
      const offset = findContiguousEmptyBlock(
        recoveryScan?.data?.values || [],
        plan.ddsRows.length,
        scanRows
      );
      if (offset === null) throw new Error('DDS recovery window has no empty block');
      ddsStartRow = candidateStartRow + offset;

      const recoveryEndRow = ddsStartRow + plan.ddsRows.length - 1;
      const recoveryTarget = await boundedGoogleSheetsRequest(options => valuesApi.get({
        spreadsheetId: id,
        range: `'${DDS_SHEET}'!A${ddsStartRow}:S${recoveryEndRow}`,
        valueRenderOption: 'UNFORMATTED_VALUE'
      }, options), requestTimeoutMs);
      if (hasAnyValue(recoveryTarget?.data?.values || [])) {
        throw new Error('DDS recovery target rows are not empty');
      }
    }

    const ddsEndRow = ddsStartRow + plan.ddsRows.length - 1;
    if (ddsEndRow > DDS_LAST_DATA_ROW) throw new Error('DDS target capacity exceeded');
    await boundedGoogleSheetsRequest(options => valuesApi.update({
      spreadsheetId: id,
      range: `'${DDS_SHEET}'!A${ddsStartRow}:M${ddsEndRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: plan.ddsRows }
    }, options), requestTimeoutMs);
  }

  const ddsReadback = await boundedGoogleSheetsRequest(options => valuesApi.get({
    spreadsheetId: id,
    range: `'${DDS_SHEET}'!M${DDS_FIRST_DATA_ROW}:M${DDS_LAST_DATA_ROW}`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  }, options), requestTimeoutMs);
  verifyKeys({
    counts: ddsKeyCounts(ddsReadback?.data?.values || []),
    keys: plan.eligibleKeys,
    label: 'DDS'
  });

  const journalBeforeWrite = await boundedGoogleSheetsRequest(options => valuesApi.get({
    spreadsheetId: id,
    range: `'${JOURNAL_SHEET}'!A2:E3000`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  }, options), requestTimeoutMs);
  const currentJournal = journalKeyCounts(journalBeforeWrite?.data?.values || []);
  const journalRows = plan.journalRows.filter(row => !currentJournal.has(text(row[0])));
  if (journalRows.length) {
    await boundedGoogleSheetsRequest(options => valuesApi.append({
      spreadsheetId: id,
      range: `'${JOURNAL_SHEET}'!A:E`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: journalRows }
    }, options), requestTimeoutMs);
  }

  const journalReadback = await boundedGoogleSheetsRequest(options => valuesApi.get({
    spreadsheetId: id,
    range: `'${JOURNAL_SHEET}'!A2:E3000`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  }, options), requestTimeoutMs);
  verifyKeys({
    counts: journalKeyCounts(journalReadback?.data?.values || []),
    keys: plan.eligibleKeys,
    label: 'Journal'
  });

  return {
    ok: true,
    businessDate: plan.businessDate,
    eligibleRows: plan.eligibleKeys.length,
    ddsAppended: plan.ddsRows.length,
    journalAppended: journalRows.length,
    verified: true
  };
}

export async function syncCurrentDayTochkaDds(args = {}) {
  const sheets = args?.sheets;
  const spreadsheetId = requiredText(args?.spreadsheetId, 'spreadsheetId');
  return withGoogleSheetsLease({
    sheets,
    spreadsheetId,
    key: IMPORT_LEASE_KEY,
    requestTimeoutMs: args?.requestTimeoutMs,
    run: () => syncCurrentDayTochkaDdsUnlocked({ ...args, spreadsheetId })
  });
}

export function createTochkaDdsImportHandler({ cronSecret, runImport } = {}) {
  if (typeof runImport !== 'function') throw new Error('runImport is required');
  return async function tochkaDdsImportHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Use GET' });
    }
    const secret = text(cronSecret);
    if (!secret || requestBearer(req) !== secret) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    try {
      const result = await runImport();
      if (!result?.ok || result?.verified !== true) {
        return res.status(502).json({ ok: false, error: 'Tochka DDS import verification failed' });
      }
      return res.status(200).json({
        ok: true,
        mode: 'tochka_dds_current_day',
        businessDate: result.businessDate,
        eligibleRows: Number(result.eligibleRows || 0),
        ddsAppended: Number(result.ddsAppended || 0),
        journalAppended: Number(result.journalAppended || 0),
        verified: true
      });
    } catch (error) {
      const message = String(error?.message || '').replace(/[\r\n]+/g, ' ').slice(0, 500);
      console.error('tochka-dds-current-day:', error?.name || 'Error', message);
      return res.status(502).json({ ok: false, error: 'Tochka DDS import failed' });
    }
  };
}

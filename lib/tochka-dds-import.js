import { withGoogleSheetsLease } from './google-sheets-lease.js';

const READY_SHEET = 'API → ДДС готово';
const DDS_SHEET = 'ДДС: месяц';
const JOURNAL_SHEET = 'Журнал Точка → ДДС';
const BUSINESS_TZ = 'Asia/Yekaterinburg';
const IMPORT_LEASE_KEY = 'tochka_dds_import_lock';
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
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

function requestBearer(req) {
  const authorization = text(req?.headers?.authorization);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
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
    if (normalizedDate(row[2]) !== date) continue;
    const normalized = validateCurrentDayRow(row, index + 1, date, importedAt);
    if (seen.has(normalized.key)) throw new Error(`Duplicate Tochka key in current-day ready rows: ${normalized.key}`);
    seen.add(normalized.key);
    eligibleKeys.push(normalized.key);
    if (!existingDds.has(normalized.key)) ddsRows.push(normalized.ddsRow);
    if (!existingJournal.has(normalized.key)) journalRows.push(normalized.journalRow);
  }

  return { businessDate: date, eligibleKeys, ddsRows, journalRows };
}

async function writeDdsRows({ valuesApi, spreadsheetId, rows }) {
  if (!rows.length) return;

  // Google Sheets values.append infers a logical table inside the supplied range.
  // When a previous failed write left data shifted into G:S, append can infer that
  // shifted table and move a valid A:M payload into G:S again. Production Google
  // clients expose values.update, so anchor new DDS rows to an explicit A:M range
  // after the last occupied row across A:S. The append fallback exists only for
  // older/test clients that do not expose update.
  if (typeof valuesApi.update === 'function') {
    const bodyRead = await valuesApi.get({
      spreadsheetId,
      range: `'${DDS_SHEET}'!A5:S30000`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const occupied = Array.isArray(bodyRead?.data?.values) ? bodyRead.data.values : [];
    const startRow = 5 + occupied.length;
    const endRow = startRow + rows.length - 1;
    if (endRow > 30000) throw new Error('DDS explicit write range exhausted');
    await valuesApi.update({
      spreadsheetId,
      range: `'${DDS_SHEET}'!A${startRow}:M${endRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: rows }
    });
    return;
  }

  await valuesApi.append({
    spreadsheetId,
    range: `'${DDS_SHEET}'!A5:M30000`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
}

async function syncCurrentDayTochkaDdsUnlocked({
  sheets,
  spreadsheetId,
  businessDate,
  now = () => new Date()
} = {}) {
  const valuesApi = sheets?.spreadsheets?.values;
  if (!valuesApi?.batchGet || !valuesApi?.append || !valuesApi?.get) {
    throw new Error('sheets values client is required');
  }
  const id = requiredText(spreadsheetId, 'spreadsheetId');
  const current = typeof now === 'function' ? now() : now;
  const ranges = [
    `'${READY_SHEET}'!A1:O3000`,
    `'${DDS_SHEET}'!M5:M30000`,
    `'${JOURNAL_SHEET}'!A2:E3000`
  ];
  const snapshot = await valuesApi.batchGet({
    spreadsheetId: id,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
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

  await writeDdsRows({ valuesApi, spreadsheetId: id, rows: plan.ddsRows });

  const ddsReadback = await valuesApi.get({
    spreadsheetId: id,
    range: `'${DDS_SHEET}'!M5:M30000`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  verifyKeys({
    counts: ddsKeyCounts(ddsReadback?.data?.values || []),
    keys: plan.eligibleKeys,
    label: 'DDS'
  });

  const journalBeforeWrite = await valuesApi.get({
    spreadsheetId: id,
    range: `'${JOURNAL_SHEET}'!A2:E3000`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const currentJournal = journalKeyCounts(journalBeforeWrite?.data?.values || []);
  const journalRows = plan.journalRows.filter(row => !currentJournal.has(text(row[0])));
  if (journalRows.length) {
    await valuesApi.append({
      spreadsheetId: id,
      range: `'${JOURNAL_SHEET}'!A:E`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: journalRows }
    });
  }

  const journalReadback = await valuesApi.get({
    spreadsheetId: id,
    range: `'${JOURNAL_SHEET}'!A2:E3000`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
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

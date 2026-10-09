import { createHash } from 'node:crypto';

const REQUIRED_PERIOD = Object.freeze({ startDate: '2026-09-01', endDate: '2026-09-30' });
const ARCHIVE_FIELDS = Object.freeze([
  'Id',
  'Date',
  'EmployeeName',
  'StudentOwnerName',
  'StudentId',
  'ProductName',
  'Sum',
  'Paid'
]);

function strictDate(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return null;
  return parsed;
}

function strictArchiveDateTime(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/);
  if (!match || !strictDate(match[1])) return null;
  if (match[2] !== undefined) {
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    const second = Number(match[4]);
    const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
    const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
    if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
  }
  return { text, date: match[1] };
}

function moneyFact(value, field, id) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`invalid sale money fact ${field} for ASHK sale ${id}`);
  }
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid sale money fact ${field} for ASHK sale ${id}`);
  }
  return parsed;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function canonicalSale(source) {
  const item = {};
  for (const field of ARCHIVE_FIELDS) item[field] = source?.[field] ?? null;
  item.Id = String(item.Id ?? '').trim();
  item.Date = String(item.Date ?? '').trim();
  if (!item.Id) throw new Error('ASHK sale ID is missing');
  if (!item.Date) throw new Error(`ASHK sale ${item.Id} has no Date`);
  if (!strictArchiveDateTime(item.Date)) throw new Error(`ASHK sale ${item.Id} has invalid Date`);
  moneyFact(item.Sum, 'Sum', item.Id);
  moneyFact(item.Paid, 'Paid', item.Id);
  return item;
}

export function validateAshkSaleArchivePeriod({ startDate, endDate } = {}) {
  const start = strictDate(startDate);
  const end = strictDate(endDate);
  const dayCount = start && end ? Math.floor((end - start) / 86_400_000) + 1 : 0;
  if (!start || !end
    || String(startDate) !== REQUIRED_PERIOD.startDate
    || String(endDate) !== REQUIRED_PERIOD.endDate
    || dayCount !== 30) {
    throw new Error('invalid sale archive period');
  }
  return { startDate: REQUIRED_PERIOD.startDate, endDate: REQUIRED_PERIOD.endDate, dayCount };
}

export function createAshkSaleArchiveEvidence({ period: inputPeriod, sourceRows, sales: records } = {}) {
  const period = validateAshkSaleArchivePeriod(inputPeriod);
  if (!Array.isArray(records)) throw new Error('archive sales must be an array');
  const rawCount = Number(sourceRows);
  if (!Number.isInteger(rawCount) || rawCount < records.length) {
    throw new Error('invalid sale archive source row count');
  }

  const byId = new Map();
  for (const source of records) {
    const item = canonicalSale(source);
    const saleDate = strictArchiveDateTime(item.Date).date;
    if (saleDate < period.startDate || saleDate > period.endDate) {
      throw new Error(`ASHK sale ${item.Id} is outside archive period`);
    }
    const previous = byId.get(item.Id);
    if (previous && canonicalJson(previous) !== canonicalJson(item)) {
      throw new Error(`conflicting ASHK sale ID: ${item.Id}`);
    }
    byId.set(item.Id, item);
  }

  const sales = [...byId.values()].sort((left, right) => {
    const byDate = left.Date.localeCompare(right.Date);
    return byDate || left.Id.localeCompare(right.Id);
  });
  let sum = 0;
  let paid = 0;
  for (const item of sales) {
    sum = roundMoney(sum + moneyFact(item.Sum, 'Sum', item.Id));
    paid = roundMoney(paid + moneyFact(item.Paid, 'Paid', item.Id));
  }
  const summary = {
    sourceRows: rawCount,
    rows: sales.length,
    sum,
    paid,
    unpaid: roundMoney(sum - paid),
    firstSaleDate: sales[0]?.Date ?? null,
    lastSaleDate: sales.at(-1)?.Date ?? null
  };
  const facts = { period, summary, sales };
  const sha256 = createHash('sha256').update(canonicalJson(facts)).digest('hex');
  return { ...facts, sha256 };
}

export function verifyAshkSaleArchive(archive) {
  let expected;
  try {
    expected = createAshkSaleArchiveEvidence({
      period: archive?.period,
      sourceRows: archive?.summary?.sourceRows,
      sales: archive?.sales
    });
  } catch {
    throw new Error('sale archive evidence mismatch');
  }
  const actual = {
    period: archive?.period,
    summary: archive?.summary,
    sales: archive?.sales,
    sha256: archive?.sha256
  };
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error('sale archive evidence mismatch');
  }
  return expected;
}

export async function buildAshkSaleArchive({
  startDate,
  endDate,
  session,
  pageSize = 500,
  maxPages = 100
} = {}) {
  const period = validateAshkSaleArchivePeriod({ startDate, endDate });
  if (typeof session?.requestJson !== 'function') {
    throw new Error('ASHK sale archive requires an authenticated session');
  }
  const count = Math.max(1, Math.min(1000, Number(pageSize) || 500));
  const pageLimit = Math.max(1, Math.min(500, Number(maxPages) || 100));
  const records = [];
  const seenIds = new Set();
  let start = 0;
  let totalCount = null;
  let pages = 0;

  while (pages < pageLimit) {
    const response = await session.requestJson('/api/SaleList', {
      Period: 'Custom',
      StartDate: period.startDate,
      EndDate: period.endDate,
      IncludeWalletSales: false,
      start,
      count
    });
    pages += 1;
    if (response?.success === false || !Array.isArray(response?.data)) {
      throw new Error('ASHK sale archive response has no data array');
    }
    const reported = Number(response.total_count);
    if (!Number.isSafeInteger(reported) || reported < 0) {
      throw new Error('ASHK sale archive response has no trustworthy total_count');
    }
    if (totalCount !== null && reported !== totalCount) {
      throw new Error('ASHK sale archive total_count changed during pagination');
    }
    totalCount = reported;
    let newIds = 0;
    for (const source of response.data) {
      const id = String(source?.Id ?? '').trim();
      if (id && !seenIds.has(id)) newIds += 1;
      if (id) seenIds.add(id);
      records.push(source);
    }
    if (records.length > totalCount) throw new Error('incomplete ASHK sale archive');
    if (records.length === totalCount) {
      if (totalCount > 0 && !newIds) {
        throw new Error('incomplete ASHK sale archive: pagination made no unique progress');
      }
      break;
    }
    if (!response.data.length) throw new Error('incomplete ASHK sale archive');
    if (!newIds) throw new Error('incomplete ASHK sale archive: pagination made no unique progress');
    const nextStart = start + response.data.length;
    if (!(nextStart > start)) throw new Error('ASHK sale archive pagination made no progress');
    start = nextStart;
  }

  if (totalCount === null || records.length !== totalCount) {
    throw new Error('incomplete ASHK sale archive');
  }
  return createAshkSaleArchiveEvidence({ period, sourceRows: records.length, sales: records });
}

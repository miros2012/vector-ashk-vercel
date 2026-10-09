import { createHash } from 'node:crypto';
import { fetchAshkWithRetry } from './ashk-transient-fetch.js';

const ASHK_BASE_URL = 'https://app.dscontrol.ru';
const ARCHIVE_FIELDS = Object.freeze([
  'Id',
  'PayDate',
  'StudentId',
  'SaleId',
  'ProductId',
  'ProductName',
  'SaleSum',
  'Debit'
]);

function strictDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function money(value) {
  const normalized = typeof value === 'number'
    ? value
    : Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(normalized)) return 0;
  return Math.round((normalized + Number.EPSILON) * 100) / 100;
}

function canonicalPayment(item) {
  const payment = {};
  for (const field of ARCHIVE_FIELDS) payment[field] = item?.[field] ?? null;
  payment.Id = String(payment.Id ?? '').trim();
  payment.PayDate = String(payment.PayDate ?? '').trim();
  payment.SaleSum = money(payment.SaleSum);
  payment.Debit = money(payment.Debit);
  if (!payment.Id) throw new Error('ASHK payment ID is missing');
  if (!payment.PayDate) throw new Error(`ASHK payment ${payment.Id} has no PayDate`);
  return payment;
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function parsePayload(text, status) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`ASHK archive returned invalid JSON (HTTP ${status})`);
  }
  if (payload?.success === false) throw new Error('ASHK archive returned success=false');
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw new Error('ASHK archive response has no data array');
  return rows;
}

export function validateAshkPaymentArchivePeriod({ startDate, endDate } = {}) {
  const start = strictDate(startDate);
  const end = strictDate(endDate);
  const dayCount = start && end ? Math.floor((end - start) / 86_400_000) + 1 : 0;
  if (!start || !end || dayCount < 1 || dayCount > 31) {
    throw new Error('invalid archive period');
  }
  return { startDate: isoDate(start), endDate: isoDate(end), dayCount };
}

export async function buildAshkPaymentArchive({
  startDate,
  endDate,
  apiKey,
  fetchFn = globalThis.fetch,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
} = {}) {
  const period = validateAshkPaymentArchivePeriod({ startDate, endDate });
  const key = String(apiKey ?? '').trim();
  if (!key) throw new Error('ASHK_API_KEY is not configured');
  if (typeof fetchFn !== 'function') throw new Error('fetchFn is required');

  const start = strictDate(period.startDate);
  const end = strictDate(period.endDate);
  const records = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    const batchEnd = new Date(Math.min(addDays(cursor, 6).getTime(), end.getTime()));
    const batchStartText = `${isoDate(cursor)}T00:00:00`;
    const batchEndText = `${isoDate(batchEnd)}T23:59:59`;
    const url = new URL('/api/PaymentRecordExternalDebitList', ASHK_BASE_URL);
    url.searchParams.set('StartDate', batchStartText);
    url.searchParams.set('EndDate', batchEndText);

    const response = await fetchAshkWithRetry({
      fetchFn,
      url: url.toString(),
      options: {
        method: 'GET',
        headers: {
          api_key: key,
          'X-Requested-With': 'XMLHttpRequest',
          accept: 'application/json'
        },
        signal: AbortSignal.timeout(55_000)
      },
      maxAttempts: 2,
      retryDelayMs: 350,
      sleep
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`ASHK archive returned HTTP ${response.status}`);
    records.push(...parsePayload(responseText, response.status));
    if (batchEnd < end) await sleep(1_100);
  }

  const byId = new Map();
  for (const source of records) {
    const payment = canonicalPayment(source);
    const paymentDate = payment.PayDate.slice(0, 10);
    if (!strictDate(paymentDate)
      || paymentDate < period.startDate
      || paymentDate > period.endDate) {
      throw new Error(`ASHK payment ${payment.Id} is outside archive period`);
    }
    const previous = byId.get(payment.Id);
    if (previous && canonicalJson(previous) !== canonicalJson(payment)) {
      throw new Error(`conflicting ASHK payment ID: ${payment.Id}`);
    }
    byId.set(payment.Id, payment);
  }

  const payments = [...byId.values()].sort((left, right) => {
    const byDate = left.PayDate.localeCompare(right.PayDate);
    return byDate || left.Id.localeCompare(right.Id);
  });
  let positive = 0;
  let refunds = 0;
  let net = 0;
  for (const payment of payments) {
    const debit = money(payment.Debit);
    if (debit > 0) positive = money(positive + debit);
    if (debit < 0) refunds = money(refunds + Math.abs(debit));
    net = money(net + debit);
  }
  const summary = {
    rows: payments.length,
    positive,
    refunds,
    net,
    firstPayDate: payments[0]?.PayDate ?? null,
    lastPayDate: payments.at(-1)?.PayDate ?? null
  };
  const archiveFacts = { period, summary, payments };
  const sha256 = createHash('sha256').update(canonicalJson(archiveFacts)).digest('hex');
  return { ...archiveFacts, sha256 };
}

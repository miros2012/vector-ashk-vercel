function text(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\u00a0/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.Items)) return payload.Items;
  return [];
}

function statusFromError(error) {
  const match = String(error?.message || '').match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

function isAlina(value) {
  return /(?:кумаритова.*алина|алина.*кумаритова)/iu.test(text(value));
}

export const PAYMENT_PERIOD_CANDIDATES = Object.freeze([
  Object.freeze({ name: 'pay-date', fromKey: 'PayDateFrom', toKey: 'PayDateTo' }),
  Object.freeze({ name: 'date', fromKey: 'DateFrom', toKey: 'DateTo' }),
  Object.freeze({ name: 'payment-date', fromKey: 'PaymentDateFrom', toKey: 'PaymentDateTo' }),
  Object.freeze({ name: 'start-finish', fromKey: 'Start', toKey: 'Finish' }),
  Object.freeze({ name: 'start-date', fromKey: 'StartDate', toKey: 'EndDate' })
]);

function summarizeCandidate(candidate, payload) {
  const rows = rowsFromPayload(payload);
  const totalRaw = payload?.total_count ?? payload?.TotalCount;
  const totalCount = Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : rows.length;
  let debitTotal = 0;
  let alinaPositive = 0;
  let alinaNet = 0;
  const dates = [];
  for (const row of rows) {
    const amount = roundMoney(toNumber(row?.Debit));
    debitTotal = roundMoney(debitTotal + amount);
    const payDate = text(row?.PayDate);
    if (payDate) dates.push(payDate);
    if (isAlina(row?.EmployeeName)) {
      if (amount > 0) alinaPositive = roundMoney(alinaPositive + amount);
      alinaNet = roundMoney(alinaNet + amount);
    }
  }
  dates.sort();
  return {
    name: candidate.name,
    fromKey: candidate.fromKey,
    toKey: candidate.toKey,
    rows: rows.length,
    totalCount,
    debitTotal: roundMoney(debitTotal),
    alinaPositive: roundMoney(alinaPositive),
    alinaNet: roundMoney(alinaNet),
    minPayDate: dates[0] || '',
    maxPayDate: dates.at(-1) || ''
  };
}

export async function probeAshkPaymentPeriodCandidates({ session, startDate, endDate } = {}) {
  if (!session || typeof session.requestJson !== 'function') {
    throw new Error('ASHK payment period candidate probe requires an authenticated session');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(text(endDate))) {
    throw new Error('ASHK payment period candidate probe requires YYYY-MM-DD period');
  }

  const results = [];
  for (const candidate of PAYMENT_PERIOD_CANDIDATES) {
    try {
      const payload = await session.requestJson('/api/PaymentRecordDebitList', {
        [candidate.fromKey]: startDate,
        [candidate.toKey]: endDate,
        start: 0,
        count: 1000
      });
      results.push(summarizeCandidate(candidate, payload));
    } catch (error) {
      results.push({
        name: candidate.name,
        fromKey: candidate.fromKey,
        toKey: candidate.toKey,
        errorStatus: statusFromError(error)
      });
    }
  }
  return results;
}

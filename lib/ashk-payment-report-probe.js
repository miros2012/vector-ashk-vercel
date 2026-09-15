export const PAYMENT_REPORT_CANDIDATES = Object.freeze([
  '/api/PaymentRecordList',
  '/api/PaymentRecordDebitList',
  '/api/PaymentList',
  '/api/FinanceOperationList',
  '/api/PaymentRecordExternalDebitList'
]);

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function findRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.Items)) return payload.Items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.Items)) return payload.data.Items;
  return [];
}

export function summarizePayloadShape(payload) {
  const rows = findRows(payload);
  const rowFields = new Set();
  for (const row of rows.slice(0, 5)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const field of Object.keys(row)) rowFields.add(field);
  }
  const fields = [...rowFields].sort();
  return {
    topLevelKeys: objectKeys(payload),
    rowCount: rows.length,
    rowFields: fields,
    staffFields: fields.filter(field => /employee|cashier|manager|owner|user|creator|createdby|author|operator/i.test(field)),
    moneyFields: fields.filter(field => /amount|debit|credit|sum|paid|payment|cash|card|total/i.test(field))
  };
}

function statusFromError(error) {
  const match = String(error?.message || '').match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

export async function probeAshkPaymentReportEndpoints({ session, startDate, endDate } = {}) {
  if (!session || typeof session.requestJson !== 'function') throw new Error('ASHK session is required');
  if (!startDate || !endDate) throw new Error('Probe period is required');

  const results = [];
  for (const endpoint of PAYMENT_REPORT_CANDIDATES) {
    try {
      const payload = await session.requestJson(endpoint, {
        StartDate: startDate,
        EndDate: endDate
      });
      results.push({ endpoint, ok: true, status: 200, schema: summarizePayloadShape(payload) });
    } catch (error) {
      results.push({ endpoint, ok: false, status: statusFromError(error) });
    }
  }
  return results;
}

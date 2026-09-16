export function normalizeSaleId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(/\u00A0/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function summarizeSaleStaffCandidates(payments, sales) {
  const saleById = new Map(
    (Array.isArray(sales) ? sales : [])
      .map(sale => [normalizeSaleId(sale?.Id), sale])
      .filter(([id]) => id)
  );
  const staffPattern = /employee|cashier|manager|owner|user|creator|createdby|author|operator|seller|responsible|agent/i;
  const fields = new Set();
  for (const sale of Array.isArray(sales) ? sales : []) {
    for (const [field, value] of Object.entries(sale || {})) {
      if (staffPattern.test(field) && typeof value === 'string') fields.add(field);
    }
  }

  const totals = Object.fromEntries([...fields].sort().map(field => [field, new Map()]));
  let unresolvedPayments = 0;
  let unresolvedAmount = 0;
  for (const payment of Array.isArray(payments) ? payments : []) {
    const amount = toNumber(payment?.Debit);
    const sale = saleById.get(normalizeSaleId(payment?.SaleId));
    if (!sale) {
      unresolvedPayments += 1;
      unresolvedAmount = roundMoney(unresolvedAmount + amount);
      continue;
    }
    for (const field of fields) {
      const name = String(sale?.[field] ?? '').trim();
      if (!name) continue;
      const byName = totals[field];
      byName.set(name, roundMoney((byName.get(name) || 0) + amount));
    }
  }

  return {
    fields: [...fields].sort(),
    totals: Object.fromEntries([...fields].sort().map(field => [
      field,
      [...totals[field].entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru-RU'))
    ])),
    unresolvedPayments,
    unresolvedAmount: roundMoney(unresolvedAmount)
  };
}

export function attributePaymentsToSales(payments, sales) {
  const saleById = new Map(
    (Array.isArray(sales) ? sales : [])
      .map(sale => [normalizeSaleId(sale?.Id), sale])
      .filter(([id]) => id)
  );
  const metrics = { total: 0, attributed: 0, saleIdEmpty: 0, saleNotFound: 0, employeeEmpty: 0 };
  const items = (Array.isArray(payments) ? payments : []).map(payment => {
    metrics.total += 1;
    const saleId = normalizeSaleId(payment?.SaleId);
    if (!saleId) {
      metrics.saleIdEmpty += 1;
      return { ...payment, SaleEmployeeName: '', SaleAttributionStatus: 'SALE_ID_EMPTY' };
    }
    const sale = saleById.get(saleId);
    if (!sale) {
      metrics.saleNotFound += 1;
      return { ...payment, SaleEmployeeName: '', SaleAttributionStatus: 'SALE_NOT_FOUND' };
    }
    const employee = String(sale?.EmployeeName ?? '').trim();
    if (!employee) {
      metrics.employeeEmpty += 1;
      return { ...payment, SaleEmployeeName: '', SaleAttributionStatus: 'SALE_EMPLOYEE_EMPTY' };
    }
    metrics.attributed += 1;
    return { ...payment, SaleEmployeeName: employee, SaleAttributionStatus: 'OK_SALE_EMPLOYEE' };
  });
  return { items, metrics };
}

async function mapLimit(values, requestedConcurrency, worker) {
  const concurrency = Math.max(1, Math.min(6, Number(requestedConcurrency) || 1));
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

export function createAshkSaleSource({ session, concurrency = 2 }) {
  if (typeof session?.requestJson !== 'function') {
    throw new Error('ASHK sale source requires an authenticated session');
  }

  async function fetchForPayments({ payments, startDate, endDate }) {
    const periodResponse = await session.requestJson('/api/SaleList', {
      Period: 'Custom',
      StartDate: startDate,
      EndDate: endDate,
      IncludeWalletSales: false
    });
    const periodSales = Array.isArray(periodResponse?.data) ? periodResponse.data : [];
    const saleById = new Map(
      periodSales
        .map(sale => [normalizeSaleId(sale?.Id), sale])
        .filter(([id]) => id)
    );
    const referencedIds = [...new Set(
      (Array.isArray(payments) ? payments : [])
        .map(payment => normalizeSaleId(payment?.SaleId))
        .filter(Boolean)
    )];
    const missingIds = referencedIds.filter(id => !saleById.has(id));
    const details = await mapLimit(missingIds, concurrency, async saleId => {
      const response = await session.requestJson('/api/SaleGet', { param: saleId });
      return response?.data || null;
    });
    for (const sale of details) {
      const saleId = normalizeSaleId(sale?.Id);
      if (saleId) saleById.set(saleId, sale);
    }
    return {
      sales: [...saleById.values()],
      metrics: {
        periodSales: periodSales.length,
        referencedSaleIds: referencedIds.length,
        detailRequests: missingIds.length,
        resolvedSales: saleById.size
      }
    };
  }

  return { fetchForPayments };
}

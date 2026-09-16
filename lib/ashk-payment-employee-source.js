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

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function createAshkPaymentEmployeeSource({ session, pageSize = 200, maxPages = 100 } = {}) {
  if (!session || typeof session.requestJson !== 'function') {
    throw new Error('ASHK payment employee source requires an authenticated session');
  }
  const count = Math.max(1, Math.min(1000, Number(pageSize) || 200));
  const pageLimit = Math.max(1, Math.min(500, Number(maxPages) || 100));

  async function fetchPeriod({ startDate, endDate } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(text(endDate))) {
      throw new Error('ASHK payment employee source requires YYYY-MM-DD period');
    }

    const byId = new Map();
    let start = 0;
    let totalCount = null;
    let pages = 0;

    while (pages < pageLimit) {
      const payload = await session.requestJson('/api/PaymentRecordDebitList', {
        StartDate: startDate,
        EndDate: endDate,
        start,
        count
      });
      pages += 1;
      const pageRows = rowsFromPayload(payload);
      const reportedTotal = finiteNonNegative(payload?.total_count ?? payload?.TotalCount);
      if (reportedTotal !== null) {
        if (totalCount !== null && reportedTotal !== totalCount) {
          throw new Error('ASHK PaymentRecordDebitList total_count changed during pagination');
        }
        totalCount = reportedTotal;
      }

      const before = byId.size;
      for (const row of pageRows) {
        const id = text(row?.Id);
        if (!id) throw new Error('ASHK PaymentRecordDebitList row missing Id');
        byId.set(id, row);
      }
      const added = byId.size - before;

      if (totalCount !== null && byId.size >= totalCount) break;
      if (!pageRows.length) {
        if (totalCount === null || byId.size === totalCount) break;
        throw new Error('ASHK PaymentRecordDebitList ended before total_count');
      }
      if (added <= 0) {
        throw new Error('ASHK PaymentRecordDebitList pagination made no progress');
      }

      const reportedPos = finiteNonNegative(payload?.pos ?? payload?.Pos);
      const nextStart = (reportedPos ?? start) + pageRows.length;
      if (!(nextStart > start)) {
        throw new Error('ASHK PaymentRecordDebitList pagination made no progress');
      }
      start = nextStart;
    }

    if (pages >= pageLimit && (totalCount === null || byId.size < totalCount)) {
      throw new Error('ASHK PaymentRecordDebitList pagination page limit exceeded');
    }
    if (totalCount !== null && byId.size !== totalCount) {
      throw new Error('ASHK PaymentRecordDebitList row count does not match total_count');
    }

    const rows = [...byId.values()].sort((a, b) => {
      const dateOrder = text(a?.PayDate).localeCompare(text(b?.PayDate));
      return dateOrder || text(a?.Id).localeCompare(text(b?.Id));
    });
    return {
      rows,
      metrics: {
        rows: rows.length,
        totalCount: totalCount ?? rows.length,
        pages
      }
    };
  }

  return { fetchPeriod };
}

export function summarizePaymentEmployeeTotals(rows) {
  const totals = new Map();
  let unattributedRows = 0;
  let unattributedAmount = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const employee = text(row?.EmployeeName);
    const amount = roundMoney(toNumber(row?.Debit));
    if (!employee) {
      unattributedRows += 1;
      unattributedAmount = roundMoney(unattributedAmount + amount);
      continue;
    }
    const current = totals.get(employee) || { employee, positive: 0, negative: 0, net: 0, rows: 0 };
    current.rows += 1;
    if (amount > 0) current.positive = roundMoney(current.positive + amount);
    if (amount < 0) current.negative = roundMoney(current.negative + amount);
    current.net = roundMoney(current.net + amount);
    totals.set(employee, current);
  }

  return {
    totals: [...totals.values()].sort((a, b) => a.employee.localeCompare(b.employee, 'ru-RU')),
    unattributedRows,
    unattributedAmount: roundMoney(unattributedAmount)
  };
}

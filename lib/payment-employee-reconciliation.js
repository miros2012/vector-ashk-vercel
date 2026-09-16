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

function indexById(rows, kind) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = text(row?.Id);
    if (!id) throw new Error(`${kind} payment row missing Id`);
    if (map.has(id)) throw new Error(`duplicate ${kind} payment id`);
    map.set(id, row);
  }
  return map;
}

function sameMoney(a, b) {
  return Math.abs(roundMoney(toNumber(a)) - roundMoney(toNumber(b))) < 0.01;
}

function sameIdentity(a, b) {
  return text(a?.PayDate) === text(b?.PayDate)
    && sameMoney(a?.Debit, b?.Debit)
    && text(a?.StudentId) === text(b?.StudentId)
    && text(a?.SaleId) === text(b?.SaleId);
}

export function reconcilePaymentEmployees(externalRows, internalRows) {
  const external = indexById(externalRows, 'external');
  const internal = indexById(internalRows, 'internal');
  if (external.size !== internal.size) throw new Error('payment id coverage mismatch');
  for (const id of external.keys()) {
    if (!internal.has(id)) throw new Error('payment id coverage mismatch');
  }

  let employeeAttributed = 0;
  let employeeEmpty = 0;
  let debitTotal = 0;
  const items = (Array.isArray(externalRows) ? externalRows : []).map(row => {
    const id = text(row?.Id);
    const match = internal.get(id);
    if (!sameIdentity(row, match)) throw new Error(`payment row mismatch: ${id}`);
    const employee = text(match?.EmployeeName);
    if (employee) employeeAttributed += 1;
    else employeeEmpty += 1;
    debitTotal = roundMoney(debitTotal + toNumber(row?.Debit));
    return { ...row, PaymentEmployeeName: employee };
  });

  return {
    items,
    metrics: {
      rows: items.length,
      debitTotal,
      employeeAttributed,
      employeeEmpty
    }
  };
}

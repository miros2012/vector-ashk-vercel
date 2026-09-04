function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

export function normalizeExpectedOperationIdentifiers(input = {}) {
  return {
    transactionIds: unique(input?.transactionIds),
    paymentIds: unique(input?.paymentIds)
  };
}

export function evaluateTochkaOperationAck({ rows = [], transactionIds = [], paymentIds = [] } = {}) {
  const expected = normalizeExpectedOperationIdentifiers({ transactionIds, paymentIds });
  const expectedCount = expected.transactionIds.length + expected.paymentIds.length;
  if (expectedCount === 0) {
    return {
      ok: false,
      reason: 'identifiers_missing',
      expectedCount: 0,
      matchedCount: 0,
      matchedTransactionIds: [],
      matchedPaymentIds: [],
      missingTransactionIds: [],
      missingPaymentIds: []
    };
  }

  const transactionSet = new Set();
  const paymentSet = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const transactionId = text(row?.[0]);
    const paymentId = text(row?.[1]);
    if (transactionId) transactionSet.add(transactionId);
    if (paymentId) paymentSet.add(paymentId);
  }

  const matchedTransactionIds = expected.transactionIds.filter((id) => transactionSet.has(id));
  const matchedPaymentIds = expected.paymentIds.filter((id) => paymentSet.has(id));
  const missingTransactionIds = expected.transactionIds.filter((id) => !transactionSet.has(id));
  const missingPaymentIds = expected.paymentIds.filter((id) => !paymentSet.has(id));
  const matchedCount = matchedTransactionIds.length + matchedPaymentIds.length;

  return {
    ok: missingTransactionIds.length === 0 && missingPaymentIds.length === 0,
    reason: missingTransactionIds.length || missingPaymentIds.length ? 'operation_not_visible_yet' : null,
    expectedCount,
    matchedCount,
    matchedTransactionIds,
    matchedPaymentIds,
    missingTransactionIds,
    missingPaymentIds
  };
}

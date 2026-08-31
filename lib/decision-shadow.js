import { evaluateDecisionCatalog } from './decision-rule-engine.js';

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function isEstimate(status) {
  return String(status || '').trim().toLowerCase() === 'оценка';
}

function isUnconfirmed(status) {
  return String(status || '').trim().toLowerCase().startsWith('требует');
}

export function buildDecisionFinancialSnapshot({
  asOfDate,
  cashGapAmount = 0,
  cashGapDate = null,
  adjustmentRows = [],
  obligationRows = []
} = {}) {
  const estimated = adjustmentRows.filter((row) => isEstimate(row?.status));
  const estimatedAmount = estimated.reduce((sum, row) => {
    const amount = Math.max(finiteOrNull(row?.amount) ?? 0, 0);
    const direction = String(row?.direction || '').trim().toLowerCase();
    if (direction === 'увеличение') return sum - amount;
    if (direction === 'уменьшение') return sum + amount;
    return sum;
  }, 0);

  const unconfirmed = obligationRows.filter((row) => isUnconfirmed(row?.status));
  const unconfirmedFinite = unconfirmed
    .map((row) => finiteOrNull(row?.remaining))
    .filter((value) => value !== null && value > 0);

  const criticalPayments = obligationRows
    .filter((row) => String(row?.priority || '').trim().toLowerCase() === 'критический')
    .map((row) => ({
      id: String(row?.id || '').trim(),
      dueDate: String(row?.dueDate || '').slice(0, 10),
      amount: Math.max(finiteOrNull(row?.remaining) ?? 0, 0)
    }))
    .filter((row) => row.id && row.dueDate && row.amount > 0);

  return {
    asOfDate: String(asOfDate || '').slice(0, 10) || null,
    cash: {
      gapAmount: Math.max(finiteOrNull(cashGapAmount) ?? 0, 0),
      gapDate: String(cashGapDate || '').slice(0, 10) || null
    },
    obligations: {
      estimatedAdjustments: {
        count: estimated.length,
        amount: Math.max(estimatedAmount, 0),
        objectIds: unique(estimated.map((row) => row?.obligationId))
      },
      unconfirmed: {
        count: unconfirmed.length,
        amount: unconfirmedFinite.length ? unconfirmedFinite.reduce((sum, value) => sum + value, 0) : null,
        objectIds: unique(unconfirmed.map((row) => row?.id))
      },
      criticalPayments
    }
  };
}

function sameAmount(left, right) {
  if (left === null || left === undefined || left === '') {
    return right === null || right === undefined || right === '';
  }
  if (right === null || right === undefined || right === '') return false;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.01;
}

function sameObjects(left = [], right = []) {
  const a = unique(Array.isArray(left) ? left : []).sort();
  const b = unique(Array.isArray(right) ? right : []).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function compareDecisionShadow({ catalog = [], snapshot = {}, currentDecisions = [], now = new Date() } = {}) {
  const shadowRows = evaluateDecisionCatalog(catalog, snapshot, now);
  const currentById = new Map(currentDecisions.map((row) => [String(row?.ruleId || '').trim(), row]));

  const results = shadowRows.map((shadow) => {
    const current = currentById.get(shadow.ruleId) || null;
    const fields = [];
    if (!current) {
      fields.push('missing_current');
    } else {
      const currentActive = Boolean(current.active);
      if (currentActive !== shadow.active) fields.push('active');
      if (currentActive && shadow.active) {
        if (!sameAmount(current.amount, shadow.amount)) fields.push('amount');
        const currentDue = String(current.dueDate || '').slice(0, 10) || null;
        const shadowDue = String(shadow.dueDate || '').slice(0, 10) || null;
        if (currentDue !== shadowDue) fields.push('dueDate');
        if (!sameObjects(current.linkedObjects, shadow.linkedObjects)) fields.push('linkedObjects');
      }
    }
    return { ruleId: shadow.ruleId, match: fields.length === 0, fields, current, shadow };
  });

  const mismatches = results.filter((row) => !row.match);
  return {
    total: results.length,
    matches: results.length - mismatches.length,
    mismatches,
    results
  };
}

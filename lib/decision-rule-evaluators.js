function finiteOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function objectIds(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function dateEpoch(date) {
  const text = String(date || '').slice(0, 10);
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function businessDate(snapshot, now) {
  const explicit = String(snapshot?.asOfDate || '').slice(0, 10);
  if (dateEpoch(explicit) !== null) return explicit;
  return now.toISOString().slice(0, 10);
}

function base(active, amount = 0, dueDate = null, linkedObjects = [], facts = {}) {
  return { active: Boolean(active), amount, dueDate, linkedObjects, facts };
}

function cashGap(snapshot) {
  const gapAmount = Math.max(finiteOr(snapshot?.cash?.gapAmount, 0), 0);
  const gapDate = String(snapshot?.cash?.gapDate || '').slice(0, 10) || null;
  return base(gapAmount > 0, gapAmount, gapDate, [], { gapAmount, gapDate });
}

function estimatedAdjustments(snapshot) {
  const data = snapshot?.obligations?.estimatedAdjustments || {};
  const count = Math.max(Math.trunc(finiteOr(data.count, 0)), 0);
  const amount = Math.max(finiteOr(data.amount, 0), 0);
  const linkedObjects = objectIds(data.objectIds);
  return base(count > 0, amount, null, linkedObjects, { count, amount });
}

function unconfirmedObligations(snapshot) {
  const data = snapshot?.obligations?.unconfirmed || {};
  const count = Math.max(Math.trunc(finiteOr(data.count, 0)), 0);
  const amount = nullableFinite(data.amount);
  const linkedObjects = objectIds(data.objectIds);
  return base(count > 0, amount, null, linkedObjects, { count, amount });
}

function criticalPaymentDue(snapshot, now) {
  const today = businessDate(snapshot, now);
  const todayEpoch = dateEpoch(today);
  const payments = Array.isArray(snapshot?.obligations?.criticalPayments)
    ? snapshot.obligations.criticalPayments
    : [];

  const eligible = payments
    .map((payment) => ({
      id: String(payment?.id || '').trim(),
      dueDate: String(payment?.dueDate || '').slice(0, 10),
      amount: Math.max(finiteOr(payment?.amount, 0), 0),
      priority: String(payment?.priority || '').trim().toLowerCase()
    }))
    .filter((payment) => {
      const dueEpoch = dateEpoch(payment.dueDate);
      if (dueEpoch === null || todayEpoch === null) return false;
      const days = Math.round((dueEpoch - todayEpoch) / 86400000);
      const critical = !payment.priority || payment.priority === 'критический';
      return payment.amount > 0 && (days < 0 || (critical && days <= 3));
    });

  if (!eligible.length) return base(false, 0, null, [], { count: 0, asOfDate: today });

  const overdue = eligible.filter((payment) => dateEpoch(payment.dueDate) < todayEpoch);
  const selected = overdue.length ? overdue : eligible;
  const earliestDate = selected
    .map((payment) => payment.dueDate)
    .sort()[0];
  const actionable = overdue.length
    ? selected.slice().sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id))
    : selected.filter((payment) => payment.dueDate === earliestDate);
  const amount = actionable.reduce((sum, payment) => sum + payment.amount, 0);
  const linkedObjects = actionable.map((payment) => payment.id).filter(Boolean);
  return base(true, amount, earliestDate, linkedObjects, {
    count: actionable.length,
    asOfDate: today,
    overdue: overdue.length > 0
  });
}

export function evaluateDecisionRule(evaluatorKey, snapshot = {}, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date');
  const key = String(evaluatorKey || '').trim();
  if (key === 'cash_gap_30d') return cashGap(snapshot);
  if (key === 'estimated_obligation_adjustments') return estimatedAdjustments(snapshot);
  if (key === 'unconfirmed_obligations') return unconfirmedObligations(snapshot);
  if (key === 'critical_payment_due_3d') return criticalPaymentDue(snapshot, now);
  throw new Error(`unsupported evaluator: ${key || '<empty>'}`);
}

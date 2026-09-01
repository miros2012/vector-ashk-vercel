function numeric(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function allowedActions(decision) {
  const execution = String(decision.executionStatus || '').trim();
  const verification = String(decision.verificationStatus || 'Не проверено').trim();
  if (execution === 'Не начато') return ['start'];
  if (execution === 'В работе') return ['complete'];
  if (execution === 'Готово' && verification === 'Не проверено') {
    return ['verify_confirmed', 'verify_no_effect', 'verify_na'];
  }
  return [];
}

function publicDecision(decision) {
  return {
    ruleId: String(decision.ruleId || '').trim(),
    title: String(decision.title || '').trim(),
    deviation: String(decision.deviation || '').trim(),
    recommendation: String(decision.recommendation || '').trim(),
    task: String(decision.task || '').trim(),
    assignee: String(decision.assignee || '').trim(),
    deadline: decision.deadline || null,
    priority: String(decision.priority || '').trim(),
    executionStatus: String(decision.executionStatus || '').trim(),
    verificationStatus: String(decision.verificationStatus || 'Не проверено').trim(),
    plannedEffect: numeric(decision.plannedEffect, 0),
    actualEffect: numeric(decision.actualEffect, null),
    linkedObject: String(decision.linkedObject || '').trim(),
    lastResult: String(decision.lastResult || '').trim(),
    lastChecked: decision.lastChecked || null,
    allowedActions: allowedActions(decision)
  };
}

export function buildOwnerActionView(decisions = []) {
  const active = decisions
    .filter((d) => String(d?.ruleStatus || '').trim() === 'Активно')
    .sort((a, b) => {
      const ar = numeric(a.rank, Number.POSITIVE_INFINITY);
      const br = numeric(b.rank, Number.POSITIVE_INFINITY);
      if (ar !== br) return ar - br;
      const ad = String(a.deadline || '9999-12-31');
      const bd = String(b.deadline || '9999-12-31');
      if (ad !== bd) return ad.localeCompare(bd);
      return String(a.ruleId || '').localeCompare(String(b.ruleId || ''));
    });

  return {
    activeCount: active.length,
    top: active.length ? publicDecision(active[0]) : null
  };
}

function allowedActions(decision) {
  const execution = String(decision?.executionStatus || '').trim();
  const verification = String(decision?.verificationStatus || 'Не проверено').trim();
  if (execution === 'Не начато') return ['start'];
  if (execution === 'В работе') return ['complete'];
  if (execution === 'Готово' && verification === 'Не проверено') {
    return ['verify_confirmed', 'verify_no_effect', 'verify_na'];
  }
  return [];
}

function deadlineKey(value) {
  const text = String(value || '').trim();
  if (!text) return '9999-12-31';
  return text;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicDecision(decision) {
  return {
    ruleId: String(decision.ruleId || '').trim(),
    title: String(decision.title || '').trim(),
    deviation: String(decision.deviation || '').trim(),
    recommendation: String(decision.recommendation || '').trim(),
    task: String(decision.task || '').trim(),
    assignee: String(decision.assignee || '').trim(),
    deadline: decision.deadline ?? null,
    priority: String(decision.priority || '').trim(),
    executionStatus: String(decision.executionStatus || 'Не начато').trim(),
    verificationStatus: String(decision.verificationStatus || 'Не проверено').trim(),
    plannedEffect: numberOrNull(decision.plannedEffect) ?? 0,
    actualEffect: numberOrNull(decision.actualEffect),
    linkedObject: String(decision.linkedObject || '').trim(),
    lastResult: String(decision.lastResult || '').trim(),
    lastChecked: decision.lastChecked ?? null,
    allowedActions: allowedActions(decision)
  };
}

export function buildOwnerActionView(decisions = []) {
  const active = decisions
    .filter((decision) => String(decision?.ruleStatus || '').trim() === 'Активно')
    .slice()
    .sort((a, b) => {
      const rankA = Number.isFinite(Number(a.rank)) ? Number(a.rank) : Number.MAX_SAFE_INTEGER;
      const rankB = Number.isFinite(Number(b.rank)) ? Number(b.rank) : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      const deadlineCompare = deadlineKey(a.deadline).localeCompare(deadlineKey(b.deadline));
      if (deadlineCompare) return deadlineCompare;
      return String(a.ruleId || '').localeCompare(String(b.ruleId || ''));
    });

  return {
    top: active.length ? publicDecision(active[0]) : null,
    activeCount: active.length
  };
}
